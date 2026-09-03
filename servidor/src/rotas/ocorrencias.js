// Ocorrencias e trilha de auditoria (roadmap 12).
//
// Ocorrencia responde "o que deu errado". Nasce de uma pergunta de checklist
// respondida como Ocorrencia, quando a opcao de problema escolhida esta
// marcada como "abrir ocorrencia: sim". A prioridade vem do modelo, nao e'
// digitada na hora.
import { consultar, consultarUm, executar, agora } from '../nucleo/banco.js'
import { erro } from '../nucleo/http.js'
import { registrarEvento } from '../nucleo/auditoria.js'
import { exigirAutenticado } from '../seguranca/sessao.js'
import { exigirFrota } from '../seguranca/nivel.js'
import { PRIORIDADES } from '../../../compartilhado/template.js'

export const STATUS_OCORRENCIA = ['aberta', 'em_tratamento', 'resolvida', 'encerrada']

const TRANSICOES = {
  aberta: ['em_tratamento', 'encerrada'],
  em_tratamento: ['resolvida', 'aberta', 'encerrada'],
  resolvida: ['encerrada', 'em_tratamento'],  // reabrir se a solucao nao pegou
  encerrada: [],
}

const CAMPOS = 'o.*, v.placa, v.modelo, r.nome AS responsavel_nome'
const DE = `FROM ocorrencias o
  JOIN veiculos v ON v.id = o.veiculo_id
  LEFT JOIN usuarios r ON r.id = o.responsavel_id`

function buscarNaEmpresa(empresaId, id) {
  const linha = consultarUm(`SELECT ${CAMPOS} ${DE} WHERE o.id = ? AND o.empresa_id = ?`,
    [id, empresaId])
  if (!linha) throw erro.naoEncontrado('Ocorrencia nao encontrada nesta empresa.')
  return linha
}

export function registrarRotasOcorrencias(rotas) {
  rotas.get('/api/ocorrencias', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const status = ctx.query.get('status')
    const prioridade = ctx.query.get('prioridade')
    const veiculoId = ctx.query.get('veiculo_id')

    let sql = `SELECT ${CAMPOS} ${DE} WHERE o.empresa_id = ?`
    const params = [eu.empresa_id]
    if (status && STATUS_OCORRENCIA.includes(status)) { sql += ' AND o.status = ?'; params.push(status) }
    else if (!status) sql += ` AND o.status <> 'encerrada'`
    if (prioridade && PRIORIDADES.includes(prioridade)) {
      sql += ' AND o.prioridade = ?'; params.push(prioridade)
    }
    if (veiculoId) { sql += ' AND o.veiculo_id = ?'; params.push(veiculoId) }
    // Mais grave primeiro, depois mais antiga: o que esta parado ha mais tempo
    // com risco alto e' o que precisa de resposta.
    sql += ` ORDER BY CASE o.prioridade
               WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
             o.aberta_em`

    return { ocorrencias: consultar(sql, params) }
  })

  rotas.get('/api/ocorrencias/:id', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const ocorrencia = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    const historico = consultar(
      `SELECT acao, ator_nome, criado_em, antes, depois FROM eventos_auditoria
        WHERE entidade = 'ocorrencia' AND entidade_id = ? ORDER BY criado_em`,
      [ocorrencia.id])
    // Historico da mesma pergunta no mesmo veiculo: base do "problema ja
    // existente" (roadmap 16).
    const recorrencia = ocorrencia.pergunta_id
      ? consultar(
          `SELECT id, descricao, prioridade, status, aberta_em FROM ocorrencias
            WHERE empresa_id = ? AND veiculo_id = ? AND pergunta_id = ? AND id <> ?
            ORDER BY aberta_em DESC LIMIT 5`,
          [eu.empresa_id, ocorrencia.veiculo_id, ocorrencia.pergunta_id, ocorrencia.id])
      : []
    return { ocorrencia, historico, recorrencia }
  })

  rotas.post('/api/ocorrencias/:id/status', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const antes = buscarNaEmpresa(eu.empresa_id, ctx.params.id)

    const novo = String(ctx.corpo.status || '')
    if (!STATUS_OCORRENCIA.includes(novo)) throw erro.requisicao('Status invalido.')
    if (novo === antes.status) throw erro.requisicao('A ocorrencia ja esta neste status.')
    if (!TRANSICOES[antes.status].includes(novo)) {
      throw erro.conflito(`Transicao ${antes.status} -> ${novo} nao permitida.`)
    }

    const resolucao = String(ctx.corpo.resolucao || '').trim() || null
    if (novo === 'resolvida' && !resolucao && !antes.resolucao) {
      throw erro.requisicao('Descreva o que foi feito para resolver.')
    }

    const ts = agora()
    executar(
      `UPDATE ocorrencias SET status = ?, resolucao = COALESCE(?, resolucao),
              resolvida_em = CASE WHEN ? = 'resolvida' AND resolvida_em IS NULL THEN ? ELSE resolvida_em END
        WHERE id = ? AND empresa_id = ?`,
      [novo, resolucao, novo, ts, antes.id, eu.empresa_id])

    // Encerrar a ocorrencia NAO desbloqueia o veiculo sozinho: liberar veiculo
    // continua sendo decisao explicita, com motivo (roadmap 9.3).
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: `ocorrencia.${novo}`,
      entidade: 'ocorrencia', entidadeId: antes.id,
      antes: { status: antes.status }, depois: { status: novo, resolucao }, ip: ctx.ip,
    })
    return { ocorrencia: buscarNaEmpresa(eu.empresa_id, antes.id) }
  })

  rotas.post('/api/ocorrencias/:id/atribuir', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const antes = buscarNaEmpresa(eu.empresa_id, ctx.params.id)

    const responsavel = consultarUm(
      `SELECT id, nome, acessa_painel FROM usuarios
        WHERE id = ? AND empresa_id = ? AND status = 'ativo'`,
      [String(ctx.corpo.responsavel_id || ''), eu.empresa_id])
    if (!responsavel) throw erro.naoEncontrado('Responsavel nao encontrado ou inativo.')
    if (!responsavel.acessa_painel) {
      throw erro.requisicao('So quem esta na equipe da frota pode ser responsavel por ocorrencia.')
    }

    const novoStatus = antes.status === 'aberta' ? 'em_tratamento' : antes.status
    executar('UPDATE ocorrencias SET responsavel_id = ?, status = ? WHERE id = ? AND empresa_id = ?',
      [responsavel.id, novoStatus, antes.id, eu.empresa_id])

    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, alvoId: responsavel.id, acao: 'ocorrencia.atribuida',
      entidade: 'ocorrencia', entidadeId: antes.id,
      antes: { responsavel: antes.responsavel_nome, status: antes.status },
      depois: { responsavel: responsavel.nome, status: novoStatus }, ip: ctx.ip,
    })
    return { ocorrencia: buscarNaEmpresa(eu.empresa_id, antes.id) }
  })
}

// ------------------------------------------------------------- auditoria

export function registrarRotasAuditoria(rotas) {
  rotas.get('/api/auditoria', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))

    const entidade = ctx.query.get('entidade')
    const acao = ctx.query.get('acao')
    const busca = (ctx.query.get('busca') || '').trim().toLowerCase()
    const limite = Math.min(Number(ctx.query.get('limite') || 100), 500)

    let sql = `SELECT id, ator_nome, alvo_id, acao, entidade, entidade_id, antes, depois, ip, criado_em
                 FROM eventos_auditoria WHERE empresa_id = ?`
    const params = [eu.empresa_id]
    if (entidade) { sql += ' AND entidade = ?'; params.push(entidade) }
    if (acao) { sql += ' AND acao LIKE ?'; params.push(`${acao}%`) }
    if (busca) {
      sql += ' AND (lower(ator_nome) LIKE ? OR lower(acao) LIKE ? OR lower(depois) LIKE ?)'
      params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`)
    }
    sql += ' ORDER BY criado_em DESC LIMIT ?'
    params.push(limite)

    const eventos = consultar(sql, params).map((e) => ({
      ...e,
      antes: e.antes ? JSON.parse(e.antes) : null,
      depois: e.depois ? JSON.parse(e.depois) : null,
    }))

    const acoes = consultar(
      `SELECT acao, COUNT(*) AS total FROM eventos_auditoria
        WHERE empresa_id = ? GROUP BY acao ORDER BY acao`, [eu.empresa_id])

    return { eventos, acoes, limite }
  })
}
