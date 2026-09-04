// Solicitacao de veiculo (roadmap 10).
//
// Nao e' chamado de suporte: e' reserva de carro com janela de horario. Quem
// nao tem carro a disposicao o tempo todo pede um, a Frota aprova, e a
// retirada e a devolucao passam por checklist.
import { consultar, consultarUm, executar, novoId, agora, transacao } from '../nucleo/banco.js'
import { erro } from '../nucleo/http.js'
import { registrarEvento } from '../nucleo/auditoria.js'
import { exigirAutenticado } from '../seguranca/sessao.js'
import { exigirFrota, ehFrota } from '../seguranca/nivel.js'

export const STATUS_SOLICITACAO = [
  'pendente', 'aprovada', 'recusada', 'em_uso',
  'devolvida', 'devolvida_com_atraso', 'cancelada',
]

// Estados em que a reserva ocupa o veiculo na janela. "pendente" NAO entra:
// pedido pendente ainda nao tem placa — ele pede uma categoria. So ocupa carro
// quem ja foi liberado (roadmap 10.4).

const CAMPOS = `s.*, v.placa, v.modelo, v.marca, v.tipo, v.status AS veiculo_status,
  u.nome AS solicitante_nome, a.nome AS aprovador_nome, cat.nome AS categoria_nome`

// LEFT JOIN em veiculos, e nao JOIN: a solicitacao nasce SEM placa. Quem pede
// escolhe uma categoria de uso; a Frota escolhe o carro na hora de liberar
// (roadmap 10.3). Com JOIN, todo pedido pendente sumiria da lista.
const DE = `FROM solicitacoes s
  LEFT JOIN veiculos v ON v.id = s.veiculo_id
  LEFT JOIN categorias_uso cat ON cat.id = s.categoria_id
  JOIN usuarios u ON u.id = s.solicitante_id
  LEFT JOIN usuarios a ON a.id = s.aprovada_por`

function politicas(empresaId) {
  const linha = consultarUm('SELECT politicas FROM empresas WHERE id = ?', [empresaId])
  try { return JSON.parse(linha?.politicas || '{}') } catch { return {} }
}

function buscarNaEmpresa(empresaId, id) {
  const linha = consultarUm(`SELECT ${CAMPOS} ${DE} WHERE s.id = ? AND s.empresa_id = ?`,
    [id, empresaId])
  if (!linha) throw erro.naoEncontrado('Solicitacao nao encontrada nesta empresa.')
  return linha
}

function comAtraso(s) {
  const atrasada = s.status === 'em_uso' && s.janela_fim < agora()
  return { ...s, atrasada }
}

// Duas reservas do mesmo carro nao podem se sobrepor no tempo. A checagem e'
// feita no servidor porque a tela do solicitante pode estar desatualizada.
function conflito(empresaId, veiculoId, inicio, fim, exceto) {
  return consultarUm(
    `SELECT s.id, s.numero, s.janela_inicio, s.janela_fim, u.nome AS solicitante
       FROM solicitacoes s JOIN usuarios u ON u.id = s.solicitante_id
      WHERE s.empresa_id = ? AND s.veiculo_id = ? AND s.id <> ?
        AND s.status IN ('aprovada','em_uso')
        AND s.janela_inicio < ? AND s.janela_fim > ?
      LIMIT 1`,
    [empresaId, veiculoId, exceto || '', fim, inicio])
}

function validarJanela(corpo) {
  const inicio = String(corpo.janela_inicio || '')
  const fim = String(corpo.janela_fim || '')
  const dtInicio = new Date(inicio)
  const dtFim = new Date(fim)

  if (Number.isNaN(dtInicio.getTime()) || Number.isNaN(dtFim.getTime())) {
    throw erro.requisicao('Informe a data e o horario de inicio e de fim.')
  }
  if (dtFim <= dtInicio) throw erro.requisicao('O fim da janela precisa ser depois do inicio.')
  if (dtFim - dtInicio > 30 * 24 * 3600 * 1000) {
    throw erro.requisicao('A janela nao pode passar de 30 dias.')
  }
  return { inicio: dtInicio.toISOString(), fim: dtFim.toISOString() }
}

export function registrarRotasSolicitacoes(rotas) {
  // ------------------------------------------------------------------ lista
  rotas.get('/api/solicitacoes', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    const vejoTudo = ehFrota(eu)
    const status = ctx.query.get('status')
    const abertas = ctx.query.get('abertas') === '1'

    let sql = `SELECT ${CAMPOS} ${DE} WHERE s.empresa_id = ?`
    const params = [eu.empresa_id]
    if (!vejoTudo) { sql += ' AND s.solicitante_id = ?'; params.push(eu.id) }
    if (status && STATUS_SOLICITACAO.includes(status)) { sql += ' AND s.status = ?'; params.push(status) }
    if (abertas) sql += ` AND s.status IN ('pendente','aprovada','em_uso')`
    // Pendente de aprovacao primeiro; depois em uso; depois por janela.
    sql += ` ORDER BY CASE s.status
               WHEN 'pendente' THEN 0 WHEN 'em_uso' THEN 1 WHEN 'aprovada' THEN 2 ELSE 3 END,
             s.janela_inicio`

    return { solicitacoes: consultar(sql, params).map(comAtraso), vejo_todas: vejoTudo }
  })

  // Veiculos livres numa janela. Quem consulta e' a FROTA, na hora de liberar:
  // e' aqui que o pedido ganha placa. O solicitante nao chama esta rota — ele
  // nao ve placas na tela de pedido (roadmap 10.4).
  rotas.get('/api/solicitacoes/disponiveis', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const { inicio, fim } = validarJanela({
      janela_inicio: ctx.query.get('janela_inicio'),
      janela_fim: ctx.query.get('janela_fim'),
    })
    const categoriaId = ctx.query.get('categoria_id') || null

    // A ordem dos parametros segue a ordem dos "?" no TEXTO da consulta, e a
    // subconsulta da categoria aparece antes do WHERE. Por isso ela entra
    // primeiro na lista.
    let filtroCategoria = ''
    const params = []
    if (categoriaId) {
      // Marca quais sao da categoria pedida, sem esconder o resto: se nao
      // houver carro na categoria, a Frota ainda precisa poder liberar outro,
      // explicando o porque (roadmap 10.4).
      filtroCategoria = `, (SELECT COUNT(*) FROM veiculo_categorias vc
                             WHERE vc.veiculo_id = v.id AND vc.categoria_id = ?) AS da_categoria`
      params.push(categoriaId)
    }
    params.push(eu.empresa_id, fim, inicio)

    const veiculos = consultar(
      `SELECT v.*${filtroCategoria} FROM veiculos v
        WHERE v.empresa_id = ? AND v.status = 'disponivel'
          AND NOT EXISTS (
            SELECT 1 FROM solicitacoes s
             WHERE s.veiculo_id = v.id
               AND s.status IN ('aprovada','em_uso')
               AND s.janela_inicio < ? AND s.janela_fim > ?)
        ORDER BY v.placa`,
      params)

    return {
      // Da categoria primeiro na lista: e' o que a Frota quer ver no topo.
      veiculos: categoriaId
        ? veiculos
            .map((v) => ({ ...v, da_categoria: Boolean(v.da_categoria) }))
            .sort((a, b) => Number(b.da_categoria) - Number(a.da_categoria))
        : veiculos,
      janela: { inicio, fim },
    }
  })

  rotas.get('/api/solicitacoes/:id', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    const s = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    if (!ehFrota(eu) && s.solicitante_id !== eu.id) {
      throw erro.permissao('Esta solicitacao pertence a outra pessoa.')
    }
    return { solicitacao: comAtraso(s) }
  })

  // ------------------------------------------------------------------ pedir
  rotas.post('/api/solicitacoes', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    const { inicio, fim } = validarJanela(ctx.corpo)
    const motivo = String(ctx.corpo.motivo || '').trim()
    if (motivo.length < 10) throw erro.requisicao('Descreva o motivo com pelo menos 10 caracteres.')

    // Quem pede escolhe CATEGORIA, nunca placa (roadmap 10.3). A recusa e'
    // explicita e nao silenciosa: se alguem injetar veiculo_id na requisicao,
    // o pedido falha em vez de reservar um carro pelas costas da Frota.
    if (ctx.corpo.veiculo_id) {
      throw erro.requisicao('Quem escolhe o veiculo e a equipe da frota, na liberacao.')
    }

    const categoria = consultarUm(
      'SELECT * FROM categorias_uso WHERE id = ? AND empresa_id = ? AND ativo = 1',
      [String(ctx.corpo.categoria_id || ''), eu.empresa_id])
    if (!categoria) throw erro.naoEncontrado('Escolha uma categoria de uso disponivel.')

    // Antecedencia minima. Padrao de 24 h, configuravel por empresa; quando
    // "antecedencia_rigida" e' falso o pedido passa e so fica marcado.
    const p = politicas(eu.empresa_id)
    const horas = Number(p.antecedencia_horas ?? 24)
    const antecedenciaReal = (new Date(inicio) - Date.now()) / 3600000
    const semAntecedencia = antecedenciaReal < horas
    if (semAntecedencia && p.antecedencia_rigida === true) {
      throw erro.requisicao(
        `O pedido precisa ser feito com ${horas}h de antecedencia. Faltam ${Math.max(0, antecedenciaReal).toFixed(1)}h para o inicio.`)
    }

    const numero = (consultarUm('SELECT MAX(numero) AS maior FROM solicitacoes WHERE empresa_id = ?',
      [eu.empresa_id])?.maior ?? 0) + 1
    const id = novoId('solicitacao')
    const ts = agora()

    executar(
      `INSERT INTO solicitacoes (id, empresa_id, numero, solicitante_id, categoria_id,
                                 janela_inicio, janela_fim, motivo, status, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?, ?)`,
      [id, eu.empresa_id, numero, eu.id, categoria.id, inicio, fim, motivo, ts, ts],
    )
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, alvoId: eu.id, acao: 'solicitacao.aberta',
      entidade: 'solicitacao', entidadeId: id,
      depois: { numero, categoria: categoria.nome, inicio, fim, sem_antecedencia: semAntecedencia },
      ip: ctx.ip,
    })
    return {
      solicitacao: buscarNaEmpresa(eu.empresa_id, id),
      aviso_antecedencia: semAntecedencia
        ? `Pedido feito com menos de ${horas}h de antecedencia. A frota pode nao conseguir atender.`
        : null,
    }
  })

  // --------------------------------------------------------------- aprovar
  rotas.post('/api/solicitacoes/:id/aprovar', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const antes = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    if (antes.status !== 'pendente') {
      throw erro.conflito(`Solicitacao ${antes.status} nao pode ser aprovada.`)
    }

    // Escolher a placa E aprovar sao um ato so (roadmap 10.4). Nao existe
    // "aprovo agora e digo o carro depois": isso deixaria o colaborador de pe
    // no patio sem saber o que pegar.
    const veiculo = consultarUm('SELECT * FROM veiculos WHERE id = ? AND empresa_id = ?',
      [String(ctx.corpo.veiculo_id || ''), eu.empresa_id])
    if (!veiculo) throw erro.requisicao('Escolha o veiculo que sera liberado.')
    if (veiculo.status !== 'disponivel') {
      throw erro.conflito(`O veiculo esta ${veiculo.status.replace('_', ' ')}. Resolva antes de liberar.`)
    }

    // Reconfere o choque: outra reserva pode ter sido aprovada nesse meio-tempo.
    const choque = conflito(eu.empresa_id, veiculo.id, antes.janela_inicio, antes.janela_fim, antes.id)
    if (choque && choque.id) {
      const outra = consultarUm('SELECT status FROM solicitacoes WHERE id = ?', [choque.id])
      if (outra && ['aprovada', 'em_uso'].includes(outra.status)) {
        throw erro.conflito(`O veiculo ja foi liberado para a solicitacao #${choque.numero} nesse horario.`)
      }
    }

    // Entregar carro fora da categoria pedida e' permitido — a frota real nem
    // sempre tem o que foi pedido — mas nao em silencio: quem pediu tem que
    // saber por que recebeu outra coisa.
    const daCategoria = !antes.categoria_id || consultarUm(
      'SELECT 1 AS ok FROM veiculo_categorias WHERE veiculo_id = ? AND categoria_id = ?',
      [veiculo.id, antes.categoria_id])
    const motivoCategoria = String(ctx.corpo.motivo_categoria || '').trim() || null
    if (!daCategoria && !motivoCategoria) {
      throw erro.requisicao(
        `Este veiculo nao atende a categoria pedida (${antes.categoria_nome}). Explique o porque para liberar assim mesmo.`)
    }

    const ts = agora()
    executar(
      `UPDATE solicitacoes SET status = 'aprovada', veiculo_id = ?, motivo_categoria = ?,
              aprovada_por = ?, aprovada_em = ?, atualizado_em = ?
        WHERE id = ? AND empresa_id = ?`,
      [veiculo.id, daCategoria ? null : motivoCategoria, eu.id, ts, ts, antes.id, eu.empresa_id])
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, alvoId: antes.solicitante_id, acao: 'solicitacao.aprovada',
      entidade: 'solicitacao', entidadeId: antes.id,
      depois: {
        numero: antes.numero, placa: veiculo.placa, modelo: veiculo.modelo,
        categoria_pedida: antes.categoria_nome,
        fora_da_categoria: !daCategoria, motivo_categoria: daCategoria ? null : motivoCategoria,
      },
      ip: ctx.ip,
    })
    return { solicitacao: buscarNaEmpresa(eu.empresa_id, antes.id) }
  })

  rotas.post('/api/solicitacoes/:id/recusar', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const antes = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    if (antes.status !== 'pendente') {
      throw erro.conflito(`Solicitacao ${antes.status} nao pode ser recusada.`)
    }
    const motivo = String(ctx.corpo.motivo || '').trim()
    // Recusar sem dizer por que deixa o colaborador sem saber o que corrigir.
    if (motivo.length < 5) throw erro.requisicao('Informe o motivo da recusa.')

    executar(
      `UPDATE solicitacoes SET status = 'recusada', motivo_recusa = ?, aprovada_por = ?, atualizado_em = ?
        WHERE id = ? AND empresa_id = ?`,
      [motivo, eu.id, agora(), antes.id, eu.empresa_id])
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, alvoId: antes.solicitante_id, acao: 'solicitacao.recusada',
      entidade: 'solicitacao', entidadeId: antes.id,
      depois: { numero: antes.numero, motivo }, ip: ctx.ip,
    })
    return { solicitacao: buscarNaEmpresa(eu.empresa_id, antes.id) }
  })

  rotas.post('/api/solicitacoes/:id/cancelar', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    const antes = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    if (!ehFrota(eu) && antes.solicitante_id !== eu.id) {
      throw erro.permissao('Esta solicitacao pertence a outra pessoa.')
    }
    if (!['pendente', 'aprovada'].includes(antes.status)) {
      throw erro.conflito('So da para cancelar antes da retirada.')
    }
    executar(`UPDATE solicitacoes SET status = 'cancelada', atualizado_em = ? WHERE id = ?`,
      [agora(), antes.id])
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, alvoId: antes.solicitante_id, acao: 'solicitacao.cancelada',
      entidade: 'solicitacao', entidadeId: antes.id, depois: { numero: antes.numero }, ip: ctx.ip,
    })
    return { solicitacao: buscarNaEmpresa(eu.empresa_id, antes.id) }
  })

  // ----------------------------------------------------- devolucao atrasada
  // O aplicativo chama esta rota ANTES de fechar o checklist de retorno, para
  // saber se precisa pedir o motivo do atraso (roadmap 10.2, passo 7).
  rotas.get('/api/solicitacoes/:id/devolucao', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    const s = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    if (!ehFrota(eu) && s.solicitante_id !== eu.id) {
      throw erro.permissao('Esta solicitacao pertence a outra pessoa.')
    }
    const atrasada = agora() > s.janela_fim
    const minutos = Math.round((Date.now() - new Date(s.janela_fim).getTime()) / 60000)
    return {
      atrasada,
      exige_motivo: atrasada,
      minutos_de_atraso: atrasada ? minutos : 0,
      mensagem: atrasada
        ? 'Notamos que passou do prazo de retorno. Descreva o motivo.'
        : null,
    }
  })

  // ------------------------------------------------------------- devolver
  rotas.post('/api/solicitacoes/:id/devolver', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    const antes = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    if (!ehFrota(eu) && antes.solicitante_id !== eu.id) {
      throw erro.permissao('Esta solicitacao pertence a outra pessoa.')
    }
    if (antes.status !== 'em_uso') {
      throw erro.conflito('Esta solicitacao nao esta em uso.')
    }

    const ts = agora()
    const atrasada = ts > antes.janela_fim
    const motivoAtraso = String(ctx.corpo.motivo_atraso || '').trim()
    if (atrasada && motivoAtraso.length < 5) {
      throw erro.requisicao('Notamos que passou do prazo de retorno. Descreva o motivo.')
    }

    transacao(() => {
      executar(
        `UPDATE solicitacoes SET status = ?, devolvido_em = ?, motivo_atraso = ?, atualizado_em = ?
          WHERE id = ? AND empresa_id = ?`,
        [atrasada ? 'devolvida_com_atraso' : 'devolvida', ts,
         atrasada ? motivoAtraso : null, ts, antes.id, eu.empresa_id])
      // O veiculo so volta a "disponivel" se nao ficou bloqueado pelo checklist.
      executar(
        `UPDATE veiculos SET status = 'disponivel', atualizado_em = ?
          WHERE id = ? AND status NOT IN ('bloqueado','manutencao','com_pendencia')`,
        [ts, antes.veiculo_id])
    })

    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, alvoId: antes.solicitante_id,
      acao: atrasada ? 'solicitacao.devolvida_com_atraso' : 'solicitacao.devolvida',
      entidade: 'solicitacao', entidadeId: antes.id,
      depois: { numero: antes.numero, placa: antes.placa, motivo_atraso: atrasada ? motivoAtraso : null },
      ip: ctx.ip,
    })
    return { solicitacao: buscarNaEmpresa(eu.empresa_id, antes.id) }
  })
}

