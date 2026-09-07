// Rotas de identidade (roadmap 8).
//
// Diferenca central em relacao a v2.0: "ativo" nao e' mais um ato da Frota.
// O cadastro nasce PENDENTE, com senha inicial gerada pelo sistema, e vira
// ATIVO no momento em que o proprio colaborador troca essa senha. Enquanto
// nao trocar, a sessao existe mas nao abre nenhuma outra rota.
import { consultarUm, executar, agora } from '../nucleo/banco.js'
import { erro } from '../nucleo/http.js'
import { registrarEvento } from '../nucleo/auditoria.js'
import { conferirSenha, gerarHashSenha, validarForcaSenha } from '../seguranca/senha.js'
import {
  criarSessao, revogarSessao, revogarSessoesDoUsuario,
  cabecalhoCookie, cabecalhoCookieVazio, exigirSessao,
} from '../seguranca/sessao.js'
import { perfilPublico } from '../seguranca/nivel.js'
import { conferirFreio, contarFalha, contarAlvo, limparFreio, LIMITES } from '../seguranca/freio.js'

const MOTIVO_STATUS = {
  bloqueado: 'Acesso revogado. Procure a equipe da frota.',
  suspenso: 'Acesso suspenso. Procure a equipe da frota.',
  desativado: 'Cadastro encerrado.',
}

function carregarComCargo(id) {
  return consultarUm(
    `SELECT u.*, c.nome AS cargo_nome FROM usuarios u
       LEFT JOIN cargos c ON c.id = u.cargo_id
      WHERE u.id = ?`, [id])
}

export function registrarRotasAutenticacao(rotas) {
  rotas.post('/api/auth/login', async (ctx) => {
    const email = String(ctx.corpo.email || '').trim().toLowerCase()
    const senha = String(ctx.corpo.senha || '')
    const origem = ctx.corpo.origem === 'app' ? 'app' : 'web'
    if (!email || !senha) throw erro.requisicao('Informe email e senha.')

    // Duas contagens, dois ataques diferentes. A por email+ip pega quem
    // martela a senha de UMA pessoa. A por ip conta EMAILS DISTINTOS que
    // falharam ali, e pega quem espalha uma senha por muitas contas — que
    // passaria folgado pela primeira, porque nunca repete o mesmo email.
    const chaveFreio = `login|${email}|${ctx.ip}`
    const chaveIp = `ip|${ctx.ip}`
    conferirFreio(chaveIp, LIMITES.loginPorIp)
    conferirFreio(chaveFreio, LIMITES.login)

    const usuario = consultarUm(
      `SELECT u.*, c.nome AS cargo_nome FROM usuarios u
         LEFT JOIN cargos c ON c.id = u.cargo_id
        WHERE u.email = ? COLLATE NOCASE`, [email])
    const senhaConfere = usuario && conferirSenha(senha, usuario.senha_hash, usuario.senha_salt)

    if (!usuario || !senhaConfere) {
      contarFalha(chaveFreio)
      contarAlvo(chaveIp, email)
      if (usuario) {
        registrarEvento({
          empresaId: usuario.empresa_id, alvoId: usuario.id, acao: 'login.falha',
          entidade: 'usuario', entidadeId: usuario.id, ip: ctx.ip,
        })
      }
      throw erro.autenticacao('Email ou senha invalidos.')
    }

    // Acertou: a contagem dela zera. Sem isto, quem errou sete vezes e acertou
    // na oitava ficaria a um erro do bloqueio pelos quinze minutos seguintes.
    limparFreio(chaveFreio)

    // Bloqueado, suspenso e desativado nao entram de jeito nenhum.
    // Pendente entra — mas so alcanca a troca de senha.
    if (usuario.status !== 'ativo' && usuario.status !== 'pendente') {
      registrarEvento({
        empresaId: usuario.empresa_id, alvoId: usuario.id, acao: 'login.bloqueado',
        entidade: 'usuario', entidadeId: usuario.id,
        depois: { status: usuario.status }, ip: ctx.ip,
      })
      const recusa = erro.permissao(MOTIVO_STATUS[usuario.status] || 'Acesso indisponivel.')
      recusa.codigo = 'credencial_' + usuario.status
      throw recusa
    }

    // A empresa inteira pode estar suspensa. Vem DEPOIS da conferencia de
    // senha de proposito: quem chuta uma senha recebe 401 sem descobrir nada
    // sobre a situacao comercial do cliente.
    const empresa = consultarUm('SELECT status FROM empresas WHERE id = ?', [usuario.empresa_id])
    if (empresa?.status !== 'ativa') {
      registrarEvento({
        empresaId: usuario.empresa_id, alvoId: usuario.id, acao: 'login.empresa_suspensa',
        entidade: 'usuario', entidadeId: usuario.id,
        depois: { empresa_status: empresa?.status ?? 'inexistente' }, ip: ctx.ip,
      })
      const recusa = erro.permissao(
        'O acesso desta empresa esta suspenso. Procure o responsavel pelo contrato.')
      recusa.codigo = 'empresa_suspensa'
      throw recusa
    }

    const { token, expira } = criarSessao(usuario, origem)
    ctx.res.setHeader('set-cookie', cabecalhoCookie(token, expira))
    registrarEvento({
      empresaId: usuario.empresa_id, ator: usuario, alvoId: usuario.id, acao: 'login.sucesso',
      entidade: 'usuario', entidadeId: usuario.id, depois: { origem }, ip: ctx.ip,
    })
    return { usuario: perfilPublico(usuario), token, expira_em: expira }
  })

  rotas.post('/api/auth/sair', async (ctx) => {
    if (ctx.token) revogarSessao(ctx.token)
    if (ctx.usuario) {
      registrarEvento({
        empresaId: ctx.usuario.empresa_id, ator: ctx.usuario, alvoId: ctx.usuario.id,
        acao: 'logout', entidade: 'usuario', entidadeId: ctx.usuario.id, ip: ctx.ip,
      })
    }
    ctx.res.setHeader('set-cookie', cabecalhoCookieVazio())
    return { ok: true }
  })

  // Responde mesmo para quem ainda deve trocar a senha: o cliente precisa
  // saber disso para mandar a pessoa para a tela certa.
  rotas.get('/api/auth/eu', async (ctx) => {
    const usuario = exigirSessao(ctx)
    return { usuario: perfilPublico(usuario) }
  })

  // Troca de senha. Serve tanto para o primeiro acesso quanto para a troca
  // voluntaria depois — e e' o que transforma "pendente" em "ativo".
  rotas.post('/api/auth/senha', async (ctx) => {
    const usuario = exigirSessao(ctx)
    const atual = String(ctx.corpo.senha_atual || '')
    const nova = String(ctx.corpo.senha_nova || '')

    // A troca pede a senha ATUAL, e nao tinha freio: quem pegasse uma sessao
    // aberta poderia adivinhar a senha atual a vontade e assumir a conta.
    const chaveFreio = `senha|${usuario.id}`
    conferirFreio(chaveFreio, LIMITES.senha)

    const completo = carregarComCargo(usuario.id)
    if (!conferirSenha(atual, completo.senha_hash, completo.senha_salt)) {
      contarFalha(chaveFreio)
      registrarEvento({
        empresaId: completo.empresa_id, alvoId: completo.id, acao: 'senha.atual_incorreta',
        entidade: 'usuario', entidadeId: completo.id, ip: ctx.ip,
      })
      throw erro.autenticacao('Senha atual incorreta.')
    }
    limparFreio(chaveFreio)
    const problema = validarForcaSenha(nova)
    if (problema) throw erro.requisicao(problema)
    if (nova === atual) throw erro.requisicao('A nova senha precisa ser diferente da atual.')

    const primeiroAcesso = Boolean(completo.deve_trocar_senha)
    const { hash, salt } = gerarHashSenha(nova)
    const ts = agora()

    executar(
      `UPDATE usuarios
          SET senha_hash = ?, senha_salt = ?, deve_trocar_senha = 0,
              status = CASE WHEN status = 'pendente' THEN 'ativo' ELSE status END,
              primeiro_acesso_em = COALESCE(primeiro_acesso_em, ?),
              atualizado_em = ?
        WHERE id = ?`,
      [hash, salt, primeiroAcesso ? ts : null, ts, usuario.id],
    )

    // Trocar a senha derruba as outras sessoes; a atual cairia junto, entao
    // emitimos uma nova em seguida.
    revogarSessoesDoUsuario(usuario.id)
    const atualizado = carregarComCargo(usuario.id)
    const { token, expira } = criarSessao(atualizado, ctx.usuario.origem === 'app' ? 'app' : 'web')
    ctx.res.setHeader('set-cookie', cabecalhoCookie(token, expira))

    registrarEvento({
      empresaId: usuario.empresa_id, ator: usuario, alvoId: usuario.id,
      acao: primeiroAcesso ? 'primeiro_acesso' : 'senha.alterada',
      entidade: 'usuario', entidadeId: usuario.id, ip: ctx.ip,
    })
    return { usuario: perfilPublico(atualizado), token, expira_em: expira }
  })
}
