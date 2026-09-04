// Usuarios e cargos (roadmap 8).
//
// A Frota cadastra; o colaborador ativa a si mesmo trocando a senha inicial.
// Toda leitura e escrita e' presa ao empresa_id da sessao — nunca ao corpo.
import crypto from 'node:crypto'
import { consultar, consultarUm, executar, novoId, agora } from '../nucleo/banco.js'
import { erro } from '../nucleo/http.js'
import { registrarEvento } from '../nucleo/auditoria.js'
import { exigirAutenticado, revogarSessoesDoUsuario } from '../seguranca/sessao.js'
import { exigirFrota, ehFrota } from '../seguranca/nivel.js'
import { gerarHashSenha } from '../seguranca/senha.js'

export const STATUS_CREDENCIAL = ['pendente', 'ativo', 'bloqueado', 'suspenso', 'desativado']

// Transicoes permitidas (roadmap 18). "ativo" so se alcanca trocando a senha,
// entao a Frota nunca escreve "ativo" diretamente a partir de "pendente".
const TRANSICOES = {
  pendente: ['bloqueado', 'suspenso', 'desativado'],
  ativo: ['bloqueado', 'suspenso', 'desativado'],
  bloqueado: ['ativo', 'desativado'],
  suspenso: ['ativo', 'desativado'],
  desativado: [],
}

const CAMPOS = `u.id, u.empresa_id, u.nome, u.cpf, u.email, u.telefone, u.cargo_id,
  u.acessa_painel, u.usa_veiculo_diario, u.status, u.deve_trocar_senha,
  u.primeiro_acesso_em, u.criado_em, u.atualizado_em, c.nome AS cargo_nome`

const DE = `FROM usuarios u LEFT JOIN cargos c ON c.id = u.cargo_id`

// Senha inicial: alfanumerica, sem caracteres que se confundem lidos em voz
// alta ou escritos a mao (O/0, I/l/1). Quem repassa a senha e' uma pessoa.
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

export function gerarSenhaInicial(tamanho = 10) {
  const bytes = crypto.randomBytes(tamanho)
  let senha = ''
  for (let i = 0; i < tamanho; i += 1) senha += ALFABETO[bytes[i] % ALFABETO.length]
  // Garante ao menos uma letra e um numero, que e' o que validarForcaSenha exige.
  return `${senha.slice(0, -2)}${ALFABETO[bytes[0] % 26]}${2 + (bytes[1] % 8)}`
}

export function limparCpf(bruto) {
  return String(bruto || '').replace(/\D/g, '')
}

// Validacao real do digito verificador: CPF errado no cadastro so aparece no
// dia em que alguem precisa do registro para valer.
export function cpfValido(cpf) {
  if (!/^\d{11}$/.test(cpf)) return false
  if (/^(\d)\1{10}$/.test(cpf)) return false
  const digito = (ate) => {
    let soma = 0
    for (let i = 0; i < ate; i += 1) soma += Number(cpf[i]) * (ate + 1 - i)
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }
  return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10])
}

function buscarNaEmpresa(empresaId, usuarioId) {
  const alvo = consultarUm(`SELECT ${CAMPOS} ${DE} WHERE u.id = ? AND u.empresa_id = ?`,
    [usuarioId, empresaId])
  if (!alvo) throw erro.naoEncontrado('Usuario nao encontrado nesta empresa.')
  return alvo
}

function contarFrotaAtiva(empresaId, exceto) {
  return consultarUm(
    `SELECT COUNT(*) AS total FROM usuarios
      WHERE empresa_id = ? AND acessa_painel = 1
        AND status IN ('ativo', 'pendente') AND id <> ?`,
    [empresaId, exceto || ''])?.total ?? 0
}

export function registrarRotasUsuarios(rotas) {
  // ------------------------------------------------------------------ cargos
  rotas.get('/api/cargos', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    return {
      cargos: consultar(
        `SELECT c.id, c.nome, c.ativo, c.criado_em,
                (SELECT COUNT(*) FROM usuarios u WHERE u.cargo_id = c.id) AS usuarios
           FROM cargos c WHERE c.empresa_id = ? ORDER BY c.nome`,
        [eu.empresa_id]),
    }
  })

  rotas.post('/api/cargos', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const nome = String(ctx.corpo.nome || '').trim()
    if (nome.length < 2) throw erro.requisicao('Informe o nome do cargo.')
    if (consultarUm('SELECT id FROM cargos WHERE empresa_id = ? AND nome = ? COLLATE NOCASE',
      [eu.empresa_id, nome])) {
      throw erro.conflito('Ja existe um cargo com este nome.')
    }
    const id = novoId('cargo')
    const ts = agora()
    executar('INSERT INTO cargos (id, empresa_id, nome, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)',
      [id, eu.empresa_id, nome, ts, ts])
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'cargo.criado',
      entidade: 'cargo', entidadeId: id, depois: { nome }, ip: ctx.ip,
    })
    return { cargo: consultarUm('SELECT * FROM cargos WHERE id = ?', [id]) }
  })

  rotas.patch('/api/cargos/:id', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const antes = consultarUm('SELECT * FROM cargos WHERE id = ? AND empresa_id = ?',
      [ctx.params.id, eu.empresa_id])
    if (!antes) throw erro.naoEncontrado('Cargo nao encontrado.')
    const nome = String(ctx.corpo.nome ?? antes.nome).trim()
    if (nome.length < 2) throw erro.requisicao('Informe o nome do cargo.')
    executar('UPDATE cargos SET nome = ?, atualizado_em = ? WHERE id = ?', [nome, agora(), antes.id])
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'cargo.atualizado',
      entidade: 'cargo', entidadeId: antes.id,
      antes: { nome: antes.nome }, depois: { nome }, ip: ctx.ip,
    })
    return { cargo: consultarUm('SELECT * FROM cargos WHERE id = ?', [antes.id]) }
  })

  rotas.delete('/api/cargos/:id', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const cargo = consultarUm('SELECT * FROM cargos WHERE id = ? AND empresa_id = ?',
      [ctx.params.id, eu.empresa_id])
    if (!cargo) throw erro.naoEncontrado('Cargo nao encontrado.')
    const emUso = consultarUm('SELECT COUNT(*) AS total FROM usuarios WHERE cargo_id = ?', [cargo.id])
    if (emUso.total > 0) {
      throw erro.conflito(`${emUso.total} usuario(s) usam este cargo. Troque o cargo deles antes.`)
    }
    executar('DELETE FROM cargos WHERE id = ?', [cargo.id])
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'cargo.removido',
      entidade: 'cargo', entidadeId: cargo.id, antes: { nome: cargo.nome }, ip: ctx.ip,
    })
    return { ok: true }
  })

  // ---------------------------------------------------------------- usuarios
  rotas.get('/api/usuarios', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const status = ctx.query.get('status')
    const busca = (ctx.query.get('busca') || '').trim().toLowerCase()

    let sql = `SELECT ${CAMPOS} ${DE} WHERE u.empresa_id = ?`
    const params = [eu.empresa_id]
    if (status && STATUS_CREDENCIAL.includes(status)) { sql += ' AND u.status = ?'; params.push(status) }
    // "Desativado" nao aparece em lugar nenhum como se estivesse em uso
    // (roadmap 8.3): so surge quando explicitamente filtrado.
    else if (!status) sql += ` AND u.status <> 'desativado'`
    if (busca) {
      sql += ' AND (lower(u.nome) LIKE ? OR lower(u.email) LIKE ? OR u.cpf LIKE ?)'
      params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`)
    }
    sql += ` ORDER BY CASE u.status WHEN 'pendente' THEN 0 ELSE 1 END, u.nome`
    return { usuarios: consultar(sql, params) }
  })

  rotas.post('/api/usuarios', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))

    const nome = String(ctx.corpo.nome || '').trim()
    const cpf = limparCpf(ctx.corpo.cpf)
    const email = String(ctx.corpo.email || '').trim().toLowerCase()
    const telefone = String(ctx.corpo.telefone || '').trim() || null
    const cargoId = String(ctx.corpo.cargo_id || '') || null
    const acessaPainel = ctx.corpo.acessa_painel ? 1 : 0
    // Usa veiculo todos os dias (roadmap 8.2). Decide se a pessoa faz
    // checklist diario avulso ou pega carro por solicitacao — e, com isso, se
    // o retorno e' exigido dela.
    const usaVeiculoDiario = ctx.corpo.usa_veiculo_diario ? 1 : 0

    if (nome.length < 3) throw erro.requisicao('Informe o nome completo.')
    if (!cpfValido(cpf)) throw erro.requisicao('CPF invalido.')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw erro.requisicao('Email invalido.')
    if (!telefone) throw erro.requisicao('Informe o telefone.')
    if (!cargoId) throw erro.requisicao('Escolha o cargo.')

    const cargo = consultarUm('SELECT id, nome FROM cargos WHERE id = ? AND empresa_id = ?',
      [cargoId, eu.empresa_id])
    if (!cargo) throw erro.naoEncontrado('Cargo nao encontrado nesta empresa.')

    if (consultarUm('SELECT id FROM usuarios WHERE email = ?', [email])) {
      throw erro.conflito('Ja existe um usuario com este email.')
    }
    if (consultarUm('SELECT id FROM usuarios WHERE empresa_id = ? AND cpf = ?', [eu.empresa_id, cpf])) {
      throw erro.conflito('Ja existe um usuario com este CPF.')
    }

    // A senha inicial e' gerada aqui, nao digitada pela Frota (roadmap 8.1).
    const senhaInicial = gerarSenhaInicial()
    const { hash, salt } = gerarHashSenha(senhaInicial)
    const id = novoId('usuario')
    const ts = agora()

    executar(
      `INSERT INTO usuarios
         (id, empresa_id, nome, cpf, email, telefone, cargo_id, acessa_painel,
          usa_veiculo_diario, status, senha_hash, senha_salt, deve_trocar_senha,
          criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?, ?, 1, ?, ?)`,
      [id, eu.empresa_id, nome, cpf, email, telefone, cargoId, acessaPainel,
       usaVeiculoDiario, hash, salt, ts, ts],
    )

    const criado = buscarNaEmpresa(eu.empresa_id, id)
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, alvoId: id, acao: 'usuario.criado',
      entidade: 'usuario', entidadeId: id,
      depois: {
        nome, email, cargo: cargo.nome, acessa_painel: Boolean(acessaPainel),
        usa_veiculo_diario: Boolean(usaVeiculoDiario),
      }, ip: ctx.ip,
    })
    // A senha so viaja nesta resposta, para a Frota repassar. Nao fica em log
    // nem em auditoria.
    return { usuario: criado, senha_inicial: senhaInicial }
  })

  rotas.get('/api/usuarios/:id', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    return { usuario: buscarNaEmpresa(eu.empresa_id, ctx.params.id) }
  })

  rotas.patch('/api/usuarios/:id', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const antes = buscarNaEmpresa(eu.empresa_id, ctx.params.id)

    const nome = ctx.corpo.nome === undefined ? antes.nome : String(ctx.corpo.nome).trim()
    const telefone = ctx.corpo.telefone === undefined
      ? antes.telefone : (String(ctx.corpo.telefone).trim() || null)
    const cargoId = ctx.corpo.cargo_id === undefined ? antes.cargo_id : String(ctx.corpo.cargo_id)
    const acessaPainel = ctx.corpo.acessa_painel === undefined
      ? antes.acessa_painel : (ctx.corpo.acessa_painel ? 1 : 0)
    const usaVeiculoDiario = ctx.corpo.usa_veiculo_diario === undefined
      ? antes.usa_veiculo_diario : (ctx.corpo.usa_veiculo_diario ? 1 : 0)

    if (nome.length < 3) throw erro.requisicao('Informe o nome completo.')
    if (cargoId && !consultarUm('SELECT id FROM cargos WHERE id = ? AND empresa_id = ?',
      [cargoId, eu.empresa_id])) {
      throw erro.naoEncontrado('Cargo nao encontrado nesta empresa.')
    }
    if (antes.acessa_painel && !acessaPainel && contarFrotaAtiva(eu.empresa_id, antes.id) === 0) {
      throw erro.conflito('Esta empresa ficaria sem ninguem na equipe da frota.')
    }

    executar(
      `UPDATE usuarios SET nome = ?, telefone = ?, cargo_id = ?, acessa_painel = ?,
              usa_veiculo_diario = ?, atualizado_em = ?
        WHERE id = ? AND empresa_id = ?`,
      [nome, telefone, cargoId, acessaPainel, usaVeiculoDiario, agora(), antes.id, eu.empresa_id],
    )
    const depois = buscarNaEmpresa(eu.empresa_id, antes.id)

    // Mudar o nivel de acesso muda o que a pessoa alcanca: as sessoes caem.
    if (acessaPainel !== antes.acessa_painel) revogarSessoesDoUsuario(antes.id)

    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, alvoId: antes.id, acao: 'usuario.atualizado',
      entidade: 'usuario', entidadeId: antes.id,
      antes: {
        nome: antes.nome, cargo: antes.cargo_nome,
        acessa_painel: Boolean(antes.acessa_painel),
        usa_veiculo_diario: Boolean(antes.usa_veiculo_diario),
      },
      depois: {
        nome: depois.nome, cargo: depois.cargo_nome,
        acessa_painel: Boolean(depois.acessa_painel),
        usa_veiculo_diario: Boolean(depois.usa_veiculo_diario),
      },
      ip: ctx.ip,
    })
    return { usuario: depois }
  })

  rotas.post('/api/usuarios/:id/status', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const antes = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    const novo = String(ctx.corpo.status || '')
    const motivo = String(ctx.corpo.motivo || '').trim() || null

    if (!STATUS_CREDENCIAL.includes(novo)) throw erro.requisicao('Status invalido.')
    if (novo === antes.status) throw erro.requisicao('O usuario ja esta neste status.')
    if (!TRANSICOES[antes.status].includes(novo)) {
      throw erro.conflito(`Transicao ${antes.status} -> ${novo} nao permitida.`)
    }
    if (antes.id === eu.id) throw erro.conflito('Voce nao pode alterar o proprio status de acesso.')
    if (antes.acessa_painel && novo !== 'ativo' && contarFrotaAtiva(eu.empresa_id, antes.id) === 0) {
      throw erro.conflito('Esta empresa ficaria sem ninguem na equipe da frota.')
    }

    executar('UPDATE usuarios SET status = ?, atualizado_em = ? WHERE id = ? AND empresa_id = ?',
      [novo, agora(), antes.id, eu.empresa_id])
    if (novo !== 'ativo') revogarSessoesDoUsuario(antes.id)

    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, alvoId: antes.id, acao: `credencial.${novo}`,
      entidade: 'usuario', entidadeId: antes.id,
      antes: { status: antes.status }, depois: { status: novo, motivo }, ip: ctx.ip,
    })
    return { usuario: buscarNaEmpresa(eu.empresa_id, antes.id) }
  })

  // Nova senha aleatoria. O usuario volta a "pendente" ate trocar, exatamente
  // como no primeiro acesso (roadmap 8.4).
  rotas.post('/api/usuarios/:id/senha', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const alvo = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    if (alvo.status === 'desativado') throw erro.conflito('Usuario desativado nao recebe senha nova.')

    const senhaInicial = gerarSenhaInicial()
    const { hash, salt } = gerarHashSenha(senhaInicial)
    executar(
      `UPDATE usuarios SET senha_hash = ?, senha_salt = ?, deve_trocar_senha = 1,
              status = CASE WHEN status = 'ativo' THEN 'pendente' ELSE status END,
              atualizado_em = ?
        WHERE id = ? AND empresa_id = ?`,
      [hash, salt, agora(), alvo.id, eu.empresa_id],
    )
    revogarSessoesDoUsuario(alvo.id)
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, alvoId: alvo.id, acao: 'senha.redefinida_pela_frota',
      entidade: 'usuario', entidadeId: alvo.id, ip: ctx.ip,
    })
    return { ok: true, senha_inicial: senhaInicial, email: alvo.email }
  })

  // ------------------------------------------------ historico do usuario
  // Roadmap 8.5: tudo que o colaborador fez ou deixou de fazer, com data e
  // hora. Junta o que ELE fez (ator) com o que fizeram SOBRE ele (alvo).
  rotas.get('/api/usuarios/:id/historico', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    // A Frota ve qualquer um; o colaborador ve apenas o proprio historico.
    if (!ehFrota(eu) && eu.id !== ctx.params.id) {
      throw erro.permissao('Voce so pode consultar o proprio historico.')
    }
    const alvo = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    const limite = Math.min(Number(ctx.query.get('limite') || 200), 500)

    const eventos = consultar(
      `SELECT acao, entidade, entidade_id, ator_id, ator_nome, antes, depois, criado_em
         FROM eventos_auditoria
        WHERE empresa_id = ? AND (ator_id = ? OR alvo_id = ?)
        ORDER BY criado_em DESC LIMIT ?`,
      [eu.empresa_id, alvo.id, alvo.id, limite])

    const inspecoes = consultar(
      `SELECT i.id, i.momento, i.resultado, i.km_informado, i.finalizada_em,
              v.placa, v.modelo, t.nome AS checklist
         FROM inspecoes i
         JOIN veiculos v ON v.id = i.veiculo_id
         JOIN templates t ON t.id = i.template_id
        WHERE i.empresa_id = ? AND i.usuario_id = ?
        ORDER BY i.iniciada_em DESC LIMIT ?`,
      [eu.empresa_id, alvo.id, limite])

    const solicitacoes = consultar(
      `SELECT s.id, s.numero, s.status, s.janela_inicio, s.janela_fim, s.motivo,
              s.motivo_atraso, s.devolvido_em, v.placa
         FROM solicitacoes s JOIN veiculos v ON v.id = s.veiculo_id
        WHERE s.empresa_id = ? AND s.solicitante_id = ?
        ORDER BY s.criado_em DESC LIMIT ?`,
      [eu.empresa_id, alvo.id, limite])

    const ocorrencias = consultar(
      `SELECT o.id, o.descricao, o.prioridade, o.status, o.aberta_em, v.placa
         FROM ocorrencias o
         JOIN veiculos v ON v.id = o.veiculo_id
         JOIN inspecoes i ON i.id = o.inspecao_id
        WHERE o.empresa_id = ? AND i.usuario_id = ?
        ORDER BY o.aberta_em DESC LIMIT ?`,
      [eu.empresa_id, alvo.id, limite])

    return {
      usuario: alvo,
      eventos: eventos.map((e) => ({
        ...e,
        antes: e.antes ? JSON.parse(e.antes) : null,
        depois: e.depois ? JSON.parse(e.depois) : null,
        feito_por_ele: e.ator_id === alvo.id,
      })),
      inspecoes,
      solicitacoes,
      ocorrencias,
    }
  })
}
