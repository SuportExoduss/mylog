// Tickets e solicitacoes (secoes 16, 17 e 24).
//
// Distincao que o roadmap faz questao de manter (secao 24):
//   ticket           = o que alguem SOLICITOU
//   nao conformidade = o que deu ERRADO num checklist
// Sao entidades separadas. Nem todo ticket vira manutencao.
//
// Regra de seguranca da secao 16: o solicitante escolhe o veiculo, mas nunca
// altera placa, modelo ou qualquer dado mestre. Isso e' garantido pelo RBAC —
// quem so tem "tickets.abrir" nao tem "veiculos.escrever".
import { consultar, consultarUm, executar, novoId, agora, transacao } from '../nucleo/banco.js'
import { erro } from '../nucleo/http.js'
import { registrarEvento } from '../nucleo/auditoria.js'
import { exigirAutenticado } from '../seguranca/sessao.js'
import { exigir, pode } from '../seguranca/permissoes.js'

export const CATEGORIAS = ['problema', 'dano', 'limpeza', 'documentacao', 'solicitacao', 'outro']
export const PRIORIDADES = ['normal', 'alta']

export const STATUS_TICKET = [
  'aberto', 'em_triagem', 'atribuido', 'em_andamento', 'resolvido', 'fechado',
]

// Secao 25. Reabrir e' possivel a partir de "resolvido"; "fechado" e' terminal.
const TRANSICOES = {
  aberto: ['em_triagem', 'atribuido', 'em_andamento', 'resolvido', 'fechado'],
  em_triagem: ['atribuido', 'em_andamento', 'resolvido', 'fechado'],
  atribuido: ['em_andamento', 'em_triagem', 'resolvido', 'fechado'],
  em_andamento: ['resolvido', 'em_triagem', 'fechado'],
  resolvido: ['fechado', 'em_andamento'],
  fechado: [],
}

// Prazo padrao por prioridade, em horas. Base do "ticket atrasado" do painel.
const PRAZO_HORAS = { alta: 8, normal: 72 }

const CAMPOS = `t.*, v.placa, v.modelo, v.marca,
  s.nome AS solicitante_nome, r.nome AS responsavel_nome`

const DE = `FROM tickets t
  LEFT JOIN veiculos v ON v.id = t.veiculo_id
  JOIN usuarios s ON s.id = t.solicitante_id
  LEFT JOIN usuarios r ON r.id = t.responsavel_id`

function buscarNaEmpresa(empresaId, id) {
  const linha = consultarUm(`SELECT ${CAMPOS} ${DE} WHERE t.id = ? AND t.empresa_id = ?`, [id, empresaId])
  if (!linha) throw erro.naoEncontrado('Ticket nao encontrado nesta empresa.')
  return linha
}

function proximoNumero(empresaId) {
  const linha = consultarUm('SELECT MAX(numero) AS maior FROM tickets WHERE empresa_id = ?', [empresaId])
  return (linha?.maior ?? 0) + 1
}

export function registrarRotasTickets(rotas) {
  // ------------------------------------------------------------------ lista
  rotas.get('/api/tickets', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    // Quem so pode abrir ticket enxerga apenas os proprios.
    const vejoTudo = pode(eu, 'tickets.ler')
    if (!vejoTudo) exigir(eu, 'tickets.abrir')

    const status = ctx.query.get('status')
    const categoria = ctx.query.get('categoria')
    const abertos = ctx.query.get('abertos') === '1'

    let sql = `SELECT ${CAMPOS} ${DE} WHERE t.empresa_id = ?`
    const params = [eu.empresa_id]
    if (!vejoTudo) { sql += ' AND t.solicitante_id = ?'; params.push(eu.id) }
    if (status && STATUS_TICKET.includes(status)) { sql += ' AND t.status = ?'; params.push(status) }
    if (categoria && CATEGORIAS.includes(categoria)) { sql += ' AND t.categoria = ?'; params.push(categoria) }
    if (abertos) sql += ` AND t.status NOT IN ('resolvido', 'fechado')`
    // Atrasado no topo, depois prioridade alta, depois mais antigo primeiro.
    sql += ` ORDER BY
      CASE WHEN t.prazo_em IS NOT NULL AND t.prazo_em < ? AND t.status NOT IN ('resolvido','fechado')
           THEN 0 ELSE 1 END,
      CASE t.prioridade WHEN 'alta' THEN 0 ELSE 1 END,
      t.criado_em`
    params.push(agora())

    const tickets = consultar(sql, params).map((t) => ({
      ...t,
      atrasado: Boolean(t.prazo_em && t.prazo_em < agora() && !['resolvido', 'fechado'].includes(t.status)),
    }))
    return { tickets, vejo_todos: vejoTudo }
  })

  // --------------------------------------------------------------- detalhe
  rotas.get('/api/tickets/:id', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    const ticket = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    // Quem nao trata tickets so ve o proprio.
    if (!pode(eu, 'tickets.ler') && ticket.solicitante_id !== eu.id) {
      throw erro.permissao('Este ticket pertence a outro solicitante.')
    }
    const historico = consultar(
      `SELECT acao, ator_nome, criado_em, depois FROM eventos_auditoria
        WHERE entidade = 'ticket' AND entidade_id = ? ORDER BY criado_em`,
      [ticket.id])
    return { ticket, historico }
  })

  // ------------------------------------------------------------------ abrir
  rotas.post('/api/tickets', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'tickets.abrir')

    const categoria = String(ctx.corpo.categoria || '')
    const prioridade = String(ctx.corpo.prioridade || 'normal')
    const descricao = String(ctx.corpo.descricao || '').trim()
    const veiculoId = String(ctx.corpo.veiculo_id || '') || null

    if (!CATEGORIAS.includes(categoria)) throw erro.requisicao('Categoria invalida.')
    if (!PRIORIDADES.includes(prioridade)) throw erro.requisicao('Prioridade invalida.')
    if (descricao.length < 10) {
      throw erro.requisicao('Descreva a necessidade com pelo menos 10 caracteres.')
    }

    // O veiculo e' escolhido de uma lista da propria empresa, nunca digitado.
    let veiculo = null
    if (veiculoId) {
      veiculo = consultarUm('SELECT id, placa, modelo FROM veiculos WHERE id = ? AND empresa_id = ?',
        [veiculoId, eu.empresa_id])
      if (!veiculo) throw erro.naoEncontrado('Veiculo nao encontrado nesta empresa.')
    }
    // Categorias que falam do ativo exigem dizer QUAL ativo.
    if (!veiculo && ['problema', 'dano', 'limpeza', 'documentacao'].includes(categoria)) {
      throw erro.requisicao('Escolha o veiculo pelo modelo ou pela placa.')
    }

    const id = novoId('ticket')
    const ts = agora()
    const prazo = new Date(Date.now() + PRAZO_HORAS[prioridade] * 3600 * 1000).toISOString()
    const numero = proximoNumero(eu.empresa_id)

    executar(
      `INSERT INTO tickets (id, empresa_id, numero, solicitante_id, veiculo_id, categoria,
                            prioridade, descricao, status, prazo_em, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aberto', ?, ?)`,
      [id, eu.empresa_id, numero, eu.id, veiculo?.id ?? null, categoria, prioridade, descricao, prazo, ts],
    )
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'ticket.aberto',
      entidade: 'ticket', entidadeId: id,
      depois: { numero, categoria, prioridade, veiculo: veiculo?.placa ?? null }, ip: ctx.ip,
    })
    return { ticket: buscarNaEmpresa(eu.empresa_id, id) }
  })

  // ----------------------------------------------------------------- tratar
  rotas.post('/api/tickets/:id/status', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'tickets.tratar')
    const antes = buscarNaEmpresa(eu.empresa_id, ctx.params.id)

    const novo = String(ctx.corpo.status || '')
    if (!STATUS_TICKET.includes(novo)) throw erro.requisicao('Status invalido.')
    if (novo === antes.status) throw erro.requisicao('O ticket ja esta neste status.')
    if (!TRANSICOES[antes.status].includes(novo)) {
      throw erro.conflito(`Transicao ${antes.status} -> ${novo} nao permitida.`)
    }

    const resolucao = String(ctx.corpo.resolucao || '').trim() || null
    // Fechar sem dizer o que foi feito deixa o solicitante sem resposta.
    if (novo === 'resolvido' && !resolucao && !antes.resolucao) {
      throw erro.requisicao('Descreva a solucao antes de marcar como resolvido.')
    }

    const ts = agora()
    executar(
      `UPDATE tickets SET status = ?, resolucao = COALESCE(?, resolucao),
              fechado_em = CASE WHEN ? = 'fechado' THEN ? ELSE fechado_em END
        WHERE id = ? AND empresa_id = ?`,
      [novo, resolucao, novo, ts, antes.id, eu.empresa_id],
    )
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: `ticket.${novo}`,
      entidade: 'ticket', entidadeId: antes.id,
      antes: { status: antes.status }, depois: { status: novo, resolucao }, ip: ctx.ip,
    })
    return { ticket: buscarNaEmpresa(eu.empresa_id, antes.id) }
  })

  rotas.post('/api/tickets/:id/atribuir', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'tickets.tratar')
    const antes = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    if (antes.status === 'fechado') throw erro.conflito('Ticket fechado nao recebe responsavel.')

    const responsavelId = String(ctx.corpo.responsavel_id || '')
    const responsavel = consultarUm(
      `SELECT id, nome, papel FROM usuarios WHERE id = ? AND empresa_id = ? AND status = 'ativo'`,
      [responsavelId, eu.empresa_id])
    if (!responsavel) throw erro.naoEncontrado('Responsavel nao encontrado ou inativo.')
    if (!pode(responsavel, 'tickets.tratar')) {
      throw erro.requisicao(`O papel "${responsavel.papel}" nao trata tickets.`)
    }

    // Atribuir move de "aberto"/"em triagem" para "atribuido" no mesmo gesto.
    const novoStatus = ['aberto', 'em_triagem'].includes(antes.status) ? 'atribuido' : antes.status
    executar('UPDATE tickets SET responsavel_id = ?, status = ? WHERE id = ? AND empresa_id = ?',
      [responsavel.id, novoStatus, antes.id, eu.empresa_id])

    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'ticket.atribuido',
      entidade: 'ticket', entidadeId: antes.id,
      antes: { responsavel: antes.responsavel_nome, status: antes.status },
      depois: { responsavel: responsavel.nome, status: novoStatus }, ip: ctx.ip,
    })
    return { ticket: buscarNaEmpresa(eu.empresa_id, antes.id) }
  })

  // ------------------------------------------------ ticket vira ocorrencia
  // Secao 24: um ticket PODE gerar uma ocorrencia. Nao e' automatico — quem
  // decide e' a supervisao, e a ligacao entre os dois fica registrada.
  rotas.post('/api/tickets/:id/ocorrencia', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'nc.tratar')
    const ticket = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    if (!ticket.veiculo_id) throw erro.requisicao('Ticket sem veiculo nao vira ocorrencia de frota.')

    const criticidade = String(ctx.corpo.criticidade || 'medio')
    if (!['informativo', 'baixo', 'medio', 'alto', 'critico'].includes(criticidade)) {
      throw erro.requisicao('Criticidade invalida.')
    }

    const id = novoId('nao_conformidade')
    const ts = agora()
    transacao(() => {
      executar(
        `INSERT INTO nao_conformidades (id, empresa_id, veiculo_id, descricao, criticidade,
                                        status, responsavel_id, aberta_em)
         VALUES (?, ?, ?, ?, ?, 'aberta', ?, ?)`,
        [id, eu.empresa_id, ticket.veiculo_id,
         `[Ticket #${ticket.numero}] ${ticket.descricao}`, criticidade,
         ticket.responsavel_id, ts],
      )
      if (ticket.status === 'aberto' || ticket.status === 'em_triagem') {
        executar(`UPDATE tickets SET status = 'em_andamento' WHERE id = ?`, [ticket.id])
      }
    })

    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'ticket.virou_ocorrencia',
      entidade: 'ticket', entidadeId: ticket.id,
      depois: { ocorrencia_id: id, criticidade }, ip: ctx.ip,
    })
    return { ocorrencia_id: id, ticket: buscarNaEmpresa(eu.empresa_id, ticket.id) }
  })
}
