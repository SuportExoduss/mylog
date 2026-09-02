// Governanca de credenciais (secoes 8 e 3 do roadmap).
// Toda leitura e escrita e' presa ao empresa_id da sessao — nunca ao corpo da requisicao.
import { consultar, consultarUm, executar, novoId, agora } from '../nucleo/banco.js'
import { erro } from '../nucleo/http.js'
import { registrarEvento, semSegredos } from '../nucleo/auditoria.js'
import { exigirAutenticado, revogarSessoesDoUsuario } from '../seguranca/sessao.js'
import { exigir, PAPEIS } from '../seguranca/permissoes.js'
import { gerarHashSenha, validarForcaSenha } from '../seguranca/senha.js'

export const STATUS_CREDENCIAL = ['pendente', 'ativo', 'bloqueado', 'suspenso', 'desativado']

// Transicoes permitidas (secao 25). Fora daqui, a API recusa.
const TRANSICOES = {
  pendente: ['ativo', 'desativado'],
  ativo: ['bloqueado', 'suspenso', 'desativado'],
  bloqueado: ['ativo', 'desativado'],
  suspenso: ['ativo', 'desativado'],
  desativado: [],
}

const CAMPOS_PUBLICOS = `id, empresa_id, nome, email, matricula, papel, status,
  ativado_em, senha_definida, criado_em, atualizado_em`

function buscarNaEmpresa(empresaId, usuarioId) {
  const alvo = consultarUm(
    `SELECT ${CAMPOS_PUBLICOS} FROM usuarios WHERE id = ? AND empresa_id = ?`,
    [usuarioId, empresaId],
  )
  if (!alvo) throw erro.naoEncontrado('Usuario nao encontrado nesta empresa.')
  return alvo
}

function contarAdminsAtivos(empresaId, exceto) {
  const linha = consultarUm(
    `SELECT COUNT(*) AS total FROM usuarios
      WHERE empresa_id = ? AND papel = 'adm' AND status = 'ativo' AND id <> ?`,
    [empresaId, exceto || ''],
  )
  return linha?.total ?? 0
}

export function registrarRotasUsuarios(rotas) {
  // ------------------------------------------------------------------ lista
  rotas.get('/api/usuarios', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'usuarios.ler')
    const status = ctx.query.get('status')
    const busca = (ctx.query.get('busca') || '').trim().toLowerCase()

    let sql = `SELECT ${CAMPOS_PUBLICOS} FROM usuarios WHERE empresa_id = ?`
    const params = [eu.empresa_id]
    if (status && STATUS_CREDENCIAL.includes(status)) { sql += ' AND status = ?'; params.push(status) }
    if (busca) { sql += ' AND (lower(nome) LIKE ? OR lower(email) LIKE ?)'; params.push(`%${busca}%`, `%${busca}%`) }
    sql += ' ORDER BY CASE status WHEN \'pendente\' THEN 0 ELSE 1 END, nome'

    return { usuarios: consultar(sql, params) }
  })

  // ------------------------------------------------------------------ criar
  rotas.post('/api/usuarios', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'usuarios.escrever')

    const nome = String(ctx.corpo.nome || '').trim()
    const email = String(ctx.corpo.email || '').trim().toLowerCase()
    const papel = String(ctx.corpo.papel || 'colaborador')
    const matricula = String(ctx.corpo.matricula || '').trim() || null
    const senha = String(ctx.corpo.senha || '')

    if (nome.length < 3) throw erro.requisicao('Informe o nome completo.')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw erro.requisicao('Email invalido.')
    if (!PAPEIS.includes(papel)) throw erro.requisicao('Papel invalido.')
    const problemaSenha = validarForcaSenha(senha)
    if (problemaSenha) throw erro.requisicao(problemaSenha)

    if (consultarUm('SELECT id FROM usuarios WHERE email = ?', [email])) {
      throw erro.conflito('Ja existe um usuario com este email.')
    }

    const { hash, salt } = gerarHashSenha(senha)
    const id = novoId('usuario')
    const ts = agora()
    // Nasce PENDENTE. Liberar o acesso e' um ato separado e explicito do ADM.
    executar(
      `INSERT INTO usuarios
         (id, empresa_id, nome, email, matricula, papel, status,
          senha_hash, senha_salt, senha_definida, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, 'pendente', ?, ?, 1, ?, ?)`,
      [id, eu.empresa_id, nome, email, matricula, papel, hash, salt, ts, ts],
    )

    const criado = buscarNaEmpresa(eu.empresa_id, id)
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'usuario.criado',
      entidade: 'usuario', entidadeId: id, depois: semSegredos(criado), ip: ctx.ip,
    })
    return { usuario: criado }
  })

  // --------------------------------------------------------------- detalhe
  rotas.get('/api/usuarios/:id', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'usuarios.ler')
    const alvo = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    const vinculos = consultar(
      `SELECT v.id, v.principal, v.valido_de, v.valido_ate, v.criado_em,
              ve.id AS veiculo_id, ve.placa, ve.modelo, ve.marca, ve.status AS veiculo_status
         FROM vinculos v
         JOIN veiculos ve ON ve.id = v.veiculo_id
        WHERE v.usuario_id = ? AND v.empresa_id = ? AND v.revogado_em IS NULL
        ORDER BY v.principal DESC, ve.placa`,
      [alvo.id, eu.empresa_id],
    )
    return { usuario: alvo, vinculos }
  })

  // -------------------------------------------------------------- atualizar
  rotas.patch('/api/usuarios/:id', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'usuarios.escrever')
    const antes = buscarNaEmpresa(eu.empresa_id, ctx.params.id)

    const nome = ctx.corpo.nome === undefined ? antes.nome : String(ctx.corpo.nome).trim()
    const matricula = ctx.corpo.matricula === undefined
      ? antes.matricula : (String(ctx.corpo.matricula).trim() || null)
    const papel = ctx.corpo.papel === undefined ? antes.papel : String(ctx.corpo.papel)

    if (nome.length < 3) throw erro.requisicao('Informe o nome completo.')
    if (!PAPEIS.includes(papel)) throw erro.requisicao('Papel invalido.')
    if (papel !== antes.papel && antes.papel === 'adm' && contarAdminsAtivos(eu.empresa_id, antes.id) === 0) {
      throw erro.conflito('Esta empresa ficaria sem nenhum administrador ativo.')
    }

    executar(
      'UPDATE usuarios SET nome = ?, matricula = ?, papel = ?, atualizado_em = ? WHERE id = ? AND empresa_id = ?',
      [nome, matricula, papel, agora(), antes.id, eu.empresa_id],
    )
    const depois = buscarNaEmpresa(eu.empresa_id, antes.id)

    // Mudanca de papel altera permissao: as sessoes abertas precisam cair.
    if (papel !== antes.papel) revogarSessoesDoUsuario(antes.id)

    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'usuario.atualizado',
      entidade: 'usuario', entidadeId: antes.id,
      antes: semSegredos(antes), depois: semSegredos(depois), ip: ctx.ip,
    })
    return { usuario: depois }
  })

  // ----------------------------------------------------------------- status
  rotas.post('/api/usuarios/:id/status', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'usuarios.ativar')
    const antes = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    const novo = String(ctx.corpo.status || '')
    const motivo = String(ctx.corpo.motivo || '').trim() || null

    if (!STATUS_CREDENCIAL.includes(novo)) throw erro.requisicao('Status invalido.')
    if (novo === antes.status) throw erro.requisicao('O usuario ja esta neste status.')
    if (!TRANSICOES[antes.status].includes(novo)) {
      throw erro.conflito(`Transicao ${antes.status} -> ${novo} nao permitida.`)
    }
    // Um ADM nao muda o proprio status: evita trancar a si mesmo para fora.
    if (antes.id === eu.id) throw erro.conflito('Voce nao pode alterar o proprio status de acesso.')
    if (antes.papel === 'adm' && novo !== 'ativo' && contarAdminsAtivos(eu.empresa_id, antes.id) === 0) {
      throw erro.conflito('Esta empresa ficaria sem nenhum administrador ativo.')
    }

    const ts = agora()
    const ativando = novo === 'ativo'
    executar(
      `UPDATE usuarios SET status = ?, atualizado_em = ?,
              ativado_em = COALESCE(ativado_em, ?), ativado_por = COALESCE(ativado_por, ?)
        WHERE id = ? AND empresa_id = ?`,
      [novo, ts, ativando ? ts : null, ativando ? eu.id : null, antes.id, eu.empresa_id],
    )
    // Perder o status "ativo" derruba tudo que esta aberto, web e Android.
    if (!ativando) revogarSessoesDoUsuario(antes.id)

    const depois = buscarNaEmpresa(eu.empresa_id, antes.id)
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: `credencial.${novo}`,
      entidade: 'usuario', entidadeId: antes.id,
      antes: { status: antes.status }, depois: { status: novo, motivo }, ip: ctx.ip,
    })
    return { usuario: depois }
  })

  // ------------------------------------------------------- redefinir senha
  rotas.post('/api/usuarios/:id/senha', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'usuarios.escrever')
    const alvo = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    const nova = String(ctx.corpo.senha || '')
    const problema = validarForcaSenha(nova)
    if (problema) throw erro.requisicao(problema)

    const { hash, salt } = gerarHashSenha(nova)
    executar(
      'UPDATE usuarios SET senha_hash = ?, senha_salt = ?, senha_definida = 1, atualizado_em = ? WHERE id = ? AND empresa_id = ?',
      [hash, salt, agora(), alvo.id, eu.empresa_id],
    )
    revogarSessoesDoUsuario(alvo.id)
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'senha.redefinida_pelo_adm',
      entidade: 'usuario', entidadeId: alvo.id, ip: ctx.ip,
    })
    return { ok: true }
  })

  // ------------------------------------------------------ revogar sessoes
  rotas.post('/api/usuarios/:id/sessoes/revogar', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'usuarios.ativar')
    const alvo = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    revogarSessoesDoUsuario(alvo.id)
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'sessoes.revogadas',
      entidade: 'usuario', entidadeId: alvo.id, ip: ctx.ip,
    })
    return { ok: true }
  })
}
