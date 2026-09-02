// Rotas de identidade. A credencial e' governada pelo ADM (secao 8 do roadmap):
// existir cadastro nao basta, o status precisa estar "ativo".
import { consultarUm, executar, agora } from '../nucleo/banco.js'
import { erro } from '../nucleo/http.js'
import { registrarEvento } from '../nucleo/auditoria.js'
import { conferirSenha, gerarHashSenha, validarForcaSenha } from '../seguranca/senha.js'
import {
  criarSessao, revogarSessao, revogarSessoesDoUsuario,
  cabecalhoCookie, cabecalhoCookieVazio, exigirAutenticado,
} from '../seguranca/sessao.js'
import { capacidadesDe } from '../seguranca/permissoes.js'

const MOTIVO_STATUS = {
  pendente: 'Cadastro criado, mas ainda nao liberado pelo administrador.',
  bloqueado: 'Acesso revogado. Procure o administrador.',
  suspenso: 'Acesso suspenso. Procure o administrador.',
  desativado: 'Cadastro encerrado.',
}

// Freio simples de forca bruta, por email+ip, em memoria.
const tentativas = new Map()
const JANELA_MS = 15 * 60 * 1000
const LIMITE = 8

function conferirFreio(chave) {
  const registro = tentativas.get(chave)
  if (!registro) return
  if (Date.now() - registro.desde > JANELA_MS) { tentativas.delete(chave); return }
  if (registro.contagem >= LIMITE) {
    throw erro.requisicao('Muitas tentativas. Aguarde alguns minutos e tente de novo.')
  }
}

function contarFalha(chave) {
  const registro = tentativas.get(chave)
  if (!registro || Date.now() - registro.desde > JANELA_MS) {
    tentativas.set(chave, { contagem: 1, desde: Date.now() })
  } else {
    registro.contagem += 1
  }
}

function perfilPublico(usuario) {
  return {
    id: usuario.id,
    empresa_id: usuario.empresa_id,
    nome: usuario.nome,
    email: usuario.email,
    papel: usuario.papel,
    status: usuario.status,
    capacidades: capacidadesDe(usuario),
  }
}

export function registrarRotasAutenticacao(rotas) {
  rotas.post('/api/auth/login', async (ctx) => {
    const email = String(ctx.corpo.email || '').trim().toLowerCase()
    const senha = String(ctx.corpo.senha || '')
    const origem = ctx.corpo.origem === 'android' ? 'android' : 'web'
    if (!email || !senha) throw erro.requisicao('Informe email e senha.')

    const chaveFreio = `${email}|${ctx.ip}`
    conferirFreio(chaveFreio)

    const usuario = consultarUm(
      'SELECT * FROM usuarios WHERE email = ? COLLATE NOCASE', [email],
    )
    const senhaConfere = usuario && conferirSenha(senha, usuario.senha_hash, usuario.senha_salt)

    if (!usuario || !senhaConfere) {
      contarFalha(chaveFreio)
      if (usuario) {
        registrarEvento({
          empresaId: usuario.empresa_id, ator: null, acao: 'login.falha',
          entidade: 'usuario', entidadeId: usuario.id, ip: ctx.ip,
        })
      }
      throw erro.autenticacao('Email ou senha invalidos.')
    }

    // Credencial correta, mas o ADM ainda decide se pode entrar.
    if (usuario.status !== 'ativo') {
      registrarEvento({
        empresaId: usuario.empresa_id, ator: null, acao: 'login.bloqueado',
        entidade: 'usuario', entidadeId: usuario.id,
        depois: { status: usuario.status }, ip: ctx.ip,
      })
      const recusa = erro.permissao(MOTIVO_STATUS[usuario.status] || 'Acesso indisponivel.')
      recusa.codigo = 'credencial_' + usuario.status
      throw recusa
    }

    tentativas.delete(chaveFreio)
    const { token, expira } = criarSessao(usuario, origem)
    ctx.res.setHeader('set-cookie', cabecalhoCookie(token, expira))
    registrarEvento({
      empresaId: usuario.empresa_id, ator: usuario, acao: 'login.sucesso',
      entidade: 'usuario', entidadeId: usuario.id, depois: { origem }, ip: ctx.ip,
    })
    // O token tambem volta no corpo: o Android nao usa cookie.
    return { usuario: perfilPublico(usuario), token, expira_em: expira }
  })

  rotas.post('/api/auth/sair', async (ctx) => {
    if (ctx.token) revogarSessao(ctx.token)
    if (ctx.usuario) {
      registrarEvento({
        empresaId: ctx.usuario.empresa_id, ator: ctx.usuario, acao: 'logout',
        entidade: 'usuario', entidadeId: ctx.usuario.id, ip: ctx.ip,
      })
    }
    ctx.res.setHeader('set-cookie', cabecalhoCookieVazio())
    return { ok: true }
  })

  rotas.get('/api/auth/eu', async (ctx) => {
    const usuario = exigirAutenticado(ctx)
    return { usuario: perfilPublico(usuario) }
  })

  rotas.post('/api/auth/senha', async (ctx) => {
    const usuario = exigirAutenticado(ctx)
    const atual = String(ctx.corpo.senha_atual || '')
    const nova = String(ctx.corpo.senha_nova || '')

    const completo = consultarUm('SELECT * FROM usuarios WHERE id = ?', [usuario.id])
    if (!conferirSenha(atual, completo.senha_hash, completo.senha_salt)) {
      throw erro.autenticacao('Senha atual incorreta.')
    }
    const problema = validarForcaSenha(nova)
    if (problema) throw erro.requisicao(problema)

    const { hash, salt } = gerarHashSenha(nova)
    executar(
      'UPDATE usuarios SET senha_hash = ?, senha_salt = ?, senha_definida = 1, atualizado_em = ? WHERE id = ?',
      [hash, salt, agora(), usuario.id],
    )
    // Trocar a senha derruba as outras sessoes; a atual seria invalidada junto,
    // entao emitimos uma nova em seguida.
    revogarSessoesDoUsuario(usuario.id)
    const { token, expira } = criarSessao(completo, 'web')
    ctx.res.setHeader('set-cookie', cabecalhoCookie(token, expira))

    registrarEvento({
      empresaId: usuario.empresa_id, ator: usuario, acao: 'senha.alterada',
      entidade: 'usuario', entidadeId: usuario.id, ip: ctx.ip,
    })
    return { ok: true }
  })
}
