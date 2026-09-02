// Nao conformidades / ocorrencias (secoes 13, 24 e 25).
//
// Uma nao conformidade responde "o que deu errado". Ela nasce de um checklist
// (F3, ainda por vir) ou de um ticket promovido pela supervisao. O ciclo tem
// duas etapas de saida propositais: "resolvida" e quem executou dizendo que
// arrumou; "validada" e a supervisao confirmando que arrumou mesmo.
import { consultar, consultarUm, executar, agora } from '../nucleo/banco.js'
import { erro } from '../nucleo/http.js'
import { registrarEvento } from '../nucleo/auditoria.js'
import { exigirAutenticado } from '../seguranca/sessao.js'
import { exigir, pode } from '../seguranca/permissoes.js'
import { CRITICIDADES } from '../nucleo/template.js'

export const STATUS_NC = ['aberta', 'em_tratamento', 'resolvida', 'validada', 'encerrada']

const TRANSICOES = {
  aberta: ['em_tratamento', 'encerrada'],
  em_tratamento: ['resolvida', 'aberta', 'encerrada'],
  resolvida: ['validada', 'em_tratamento'],   // reprovar a solucao devolve ao tratamento
  validada: ['encerrada'],
  encerrada: [],
}

const CAMPOS = `n.*, v.placa, v.modelo, r.nome AS responsavel_nome`
const DE = `FROM nao_conformidades n
  JOIN veiculos v ON v.id = n.veiculo_id
  LEFT JOIN usuarios r ON r.id = n.responsavel_id`

function buscarNaEmpresa(empresaId, id) {
  const linha = consultarUm(`SELECT ${CAMPOS} ${DE} WHERE n.id = ? AND n.empresa_id = ?`, [id, empresaId])
  if (!linha) throw erro.naoEncontrado('Ocorrencia nao encontrada nesta empresa.')
  return linha
}

export function registrarRotasOcorrencias(rotas) {
  rotas.get('/api/ocorrencias', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'nc.ler')

    const status = ctx.query.get('status')
    const criticidade = ctx.query.get('criticidade')
    const veiculoId = ctx.query.get('veiculo_id')

    let sql = `SELECT ${CAMPOS} ${DE} WHERE n.empresa_id = ?`
    const params = [eu.empresa_id]
    if (status && STATUS_NC.includes(status)) { sql += ' AND n.status = ?'; params.push(status) }
    else if (!status) sql += ` AND n.status NOT IN ('encerrada')`
    if (criticidade && CRITICIDADES.includes(criticidade)) {
      sql += ' AND n.criticidade = ?'; params.push(criticidade)
    }
    if (veiculoId) { sql += ' AND n.veiculo_id = ?'; params.push(veiculoId) }
    // Mais critico primeiro, depois mais antigo: o que esta parado ha mais
    // tempo com risco alto e' o que precisa de resposta.
    sql += ` ORDER BY CASE n.criticidade
               WHEN 'critico' THEN 0 WHEN 'alto' THEN 1 WHEN 'medio' THEN 2
               WHEN 'baixo' THEN 3 ELSE 4 END, n.aberta_em`

    return { ocorrencias: consultar(sql, params) }
  })

  rotas.get('/api/ocorrencias/:id', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'nc.ler')
    const ocorrencia = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    const historico = consultar(
      `SELECT acao, ator_nome, criado_em, antes, depois FROM eventos_auditoria
        WHERE entidade = 'nao_conformidade' AND entidade_id = ? ORDER BY criado_em`,
      [ocorrencia.id])
    // Historico do mesmo item no mesmo veiculo: base do "problema ja existente"
    // da secao 23.
    const recorrencia = ocorrencia.item_id
      ? consultar(
          `SELECT id, descricao, criticidade, status, aberta_em FROM nao_conformidades
            WHERE empresa_id = ? AND veiculo_id = ? AND item_id = ? AND id <> ?
            ORDER BY aberta_em DESC LIMIT 5`,
          [eu.empresa_id, ocorrencia.veiculo_id, ocorrencia.item_id, ocorrencia.id])
      : []
    return { ocorrencia, historico, recorrencia }
  })

  rotas.post('/api/ocorrencias/:id/status', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'nc.tratar')
    const antes = buscarNaEmpresa(eu.empresa_id, ctx.params.id)

    const novo = String(ctx.corpo.status || '')
    if (!STATUS_NC.includes(novo)) throw erro.requisicao('Status invalido.')
    if (novo === antes.status) throw erro.requisicao('A ocorrencia ja esta neste status.')
    if (!TRANSICOES[antes.status].includes(novo)) {
      throw erro.conflito(`Transicao ${antes.status} -> ${novo} nao permitida.`)
    }

    const resolucao = String(ctx.corpo.resolucao || '').trim() || null
    if (novo === 'resolvida' && !resolucao && !antes.resolucao) {
      throw erro.requisicao('Descreva o que foi feito para resolver.')
    }
    // Validar e' ato de conferencia: quem resolveu nao valida a propria solucao.
    if (novo === 'validada' && antes.responsavel_id === eu.id && !pode(eu, 'usuarios.ativar')) {
      throw erro.permissao('Quem executou a correcao nao valida a propria solucao.')
    }

    const ts = agora()
    executar(
      `UPDATE nao_conformidades SET status = ?, resolucao = COALESCE(?, resolucao),
              resolvida_em = CASE WHEN ? IN ('resolvida','validada') AND resolvida_em IS NULL
                                  THEN ? ELSE resolvida_em END
        WHERE id = ? AND empresa_id = ?`,
      [novo, resolucao, novo, ts, antes.id, eu.empresa_id],
    )

    // Encerrar a ultima ocorrencia critica de um veiculo bloqueado nao o
    // libera sozinho: liberar veiculo continua sendo decisao explicita (D7/secao 13).
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: `ocorrencia.${novo}`,
      entidade: 'nao_conformidade', entidadeId: antes.id,
      antes: { status: antes.status }, depois: { status: novo, resolucao }, ip: ctx.ip,
    })
    return { ocorrencia: buscarNaEmpresa(eu.empresa_id, antes.id) }
  })

  rotas.post('/api/ocorrencias/:id/atribuir', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'nc.tratar')
    const antes = buscarNaEmpresa(eu.empresa_id, ctx.params.id)

    const responsavel = consultarUm(
      `SELECT id, nome, papel FROM usuarios WHERE id = ? AND empresa_id = ? AND status = 'ativo'`,
      [String(ctx.corpo.responsavel_id || ''), eu.empresa_id])
    if (!responsavel) throw erro.naoEncontrado('Responsavel nao encontrado ou inativo.')
    if (!pode(responsavel, 'nc.tratar')) {
      throw erro.requisicao(`O papel "${responsavel.papel}" nao trata ocorrencias.`)
    }

    const novoStatus = antes.status === 'aberta' ? 'em_tratamento' : antes.status
    executar('UPDATE nao_conformidades SET responsavel_id = ?, status = ? WHERE id = ? AND empresa_id = ?',
      [responsavel.id, novoStatus, antes.id, eu.empresa_id])

    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'ocorrencia.atribuida',
      entidade: 'nao_conformidade', entidadeId: antes.id,
      antes: { responsavel: antes.responsavel_nome, status: antes.status },
      depois: { responsavel: responsavel.nome, status: novoStatus }, ip: ctx.ip,
    })
    return { ocorrencia: buscarNaEmpresa(eu.empresa_id, antes.id) }
  })
}

// ------------------------------------------------------------- auditoria

export function registrarRotasAuditoria(rotas) {
  rotas.get('/api/auditoria', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'auditoria.ler')

    const entidade = ctx.query.get('entidade')
    const acao = ctx.query.get('acao')
    const busca = (ctx.query.get('busca') || '').trim().toLowerCase()
    const limite = Math.min(Number(ctx.query.get('limite') || 100), 500)

    let sql = `SELECT id, ator_nome, acao, entidade, entidade_id, antes, depois, ip, criado_em
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
