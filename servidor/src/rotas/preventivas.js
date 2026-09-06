// Vistorias preventivas (secoes 18 a 21).
//
// Modelo: cada ciclo e' uma LINHA. Concluir uma preventiva nao reescreve a
// linha existente — ela vira "realizada" e nasce a proxima. Assim o historico
// do veiculo fica legivel: da para ver toda manutencao feita, com km, data,
// responsavel e o que foi combinado como proximo alvo.
import { consultar, consultarUm, executar, novoId, agora, transacao } from '../nucleo/banco.js'
import { erro } from '../nucleo/http.js'
import { registrarEvento } from '../nucleo/auditoria.js'
import { exigirAutenticado } from '../seguranca/sessao.js'
import { exigirFrota } from '../seguranca/nivel.js'
import { avaliarPreventiva, avaliarPreventivas, descreverFolga } from '../nucleo/preventivas.js'
import { encerrarCiclo } from '../nucleo/ciclo_preventiva.js'

// Teto da consulta. Uma frota de setenta carros passa de mil pedidos no
// primeiro ano; sem teto, a tela baixa o historico inteiro e monta uma
// tabela de milhares de linhas para alguem que queria ver os de hoje.
// O mesmo formato de /api/execucoes: a resposta diz `total` e `limite`, e a
// tela avisa quando cortou em vez de mentir que aquilo e tudo.
const LIMITE_PAGINA = 500

const MODOS = ['km', 'data']
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/

function buscarNaEmpresa(empresaId, id) {
  const linha = consultarUm(
    `SELECT p.*, v.placa, v.modelo, v.marca, v.km_atual
       FROM preventivas p JOIN veiculos v ON v.id = p.veiculo_id
      WHERE p.id = ? AND p.empresa_id = ?`, [id, empresaId])
  if (!linha) throw erro.naoEncontrado('Preventiva nao encontrada nesta empresa.')
  return linha
}

// Acrescenta status recalculado e a folga em linguagem humana.
function enriquecer(linha) {
  const avaliacao = avaliarPreventiva(linha, linha.km_atual)
  return {
    ...linha,
    status: linha.status === 'realizada' ? 'realizada' : avaliacao.status,
    restante: avaliacao.restante,
    unidade: avaliacao.unidade,
    folga: linha.status === 'realizada' ? 'concluida' : descreverFolga(avaliacao),
  }
}

function validarAlvo({ modo, proximo_km, proxima_data }, kmAtual) {
  if (!MODOS.includes(modo)) throw erro.requisicao('Modo invalido. Use "km" ou "data".')

  if (modo === 'km') {
    const alvo = Number(proximo_km)
    if (!Number.isFinite(alvo) || alvo <= 0) throw erro.requisicao('Informe o KM-alvo da proxima preventiva.')
    // Um alvo ja vencido no momento do cadastro quase sempre e' erro de digitacao.
    if (kmAtual != null && alvo <= Number(kmAtual)) {
      throw erro.requisicao(
        `O KM-alvo (${alvo}) precisa ser maior que a quilometragem atual do veiculo (${kmAtual}).`)
    }
    return { proximo_km: Math.trunc(alvo), proxima_data: null }
  }

  const data = String(proxima_data || '').slice(0, 10)
  if (!DATA_ISO.test(data)) throw erro.requisicao('Informe a data-alvo no formato AAAA-MM-DD.')
  return { proximo_km: null, proxima_data: data }
}

// Modelo que executa a preventiva (roadmap 14.2). Precisa existir na empresa,
// estar publicado e ser de finalidade preventiva — um checklist padrao aqui
// perguntaria a coisa errada e nao encerraria manutencao nenhuma.
function validarModelo(empresaId, templateId) {
  if (!templateId) return null
  const modelo = consultarUm(
    `SELECT id, nome, finalidade, status FROM templates WHERE id = ? AND empresa_id = ?`,
    [String(templateId), empresaId])
  if (!modelo) throw erro.naoEncontrado('Checklist nao encontrado nesta empresa.')
  if (modelo.finalidade !== 'preventiva') {
    throw erro.requisicao('Escolha um checklist de preventiva, nao um checklist padrao.')
  }
  if (modelo.status !== 'publicado') {
    throw erro.conflito('Este checklist ainda e rascunho. Publique antes de usar na preventiva.')
  }
  return modelo
}

export function registrarRotasPreventivas(rotas) {
  // ------------------------------------------------------------------ lista
  rotas.get('/api/preventivas', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    avaliarPreventivas(eu.empresa_id)

    const status = ctx.query.get('status')
    const veiculoId = ctx.query.get('veiculo_id')
    const incluirRealizadas = ctx.query.get('historico') === '1'

    let sql = `SELECT p.*, v.placa, v.modelo, v.marca, v.km_atual, u.nome AS concluida_por_nome,
                      t.nome AS checklist_nome
                 FROM preventivas p
                 JOIN veiculos v ON v.id = p.veiculo_id
                 LEFT JOIN usuarios u ON u.id = p.concluida_por
                 LEFT JOIN templates t ON t.id = p.template_id
                WHERE p.empresa_id = ?`
    const params = [eu.empresa_id]
    if (!incluirRealizadas && !status) sql += ` AND p.status <> 'realizada'`
    if (status) { sql += ' AND p.status = ?'; params.push(status) }
    if (veiculoId) { sql += ' AND p.veiculo_id = ?'; params.push(veiculoId) }
    // Vencida primeiro: o painel e' fila de acao, nao ordem alfabetica.
    sql += ` ORDER BY CASE p.status
               WHEN 'vencida' THEN 0 WHEN 'muito_proxima' THEN 1 WHEN 'proxima' THEN 2
               WHEN 'em_dia' THEN 3 ELSE 4 END, v.placa LIMIT ${LIMITE_PAGINA}`

    const linhas = consultar(sql, params).map(enriquecer)
    return { preventivas: linhas, total: linhas.length, limite: LIMITE_PAGINA }
  })

  // --------------------------------------------------------------- detalhe
  rotas.get('/api/preventivas/:id', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const preventiva = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    const historico = consultar(
      `SELECT p.*, u.nome AS concluida_por_nome FROM preventivas p
         LEFT JOIN usuarios u ON u.id = p.concluida_por
        WHERE p.veiculo_id = ? AND p.empresa_id = ? AND p.status = 'realizada'
        ORDER BY p.concluida_em DESC LIMIT 20`,
      [preventiva.veiculo_id, eu.empresa_id])
    return { preventiva: enriquecer(preventiva), historico }
  })

  // ------------------------------------------------------------------ criar
  rotas.post('/api/preventivas', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))

    const veiculo = consultarUm('SELECT * FROM veiculos WHERE id = ? AND empresa_id = ?',
      [String(ctx.corpo.veiculo_id || ''), eu.empresa_id])
    if (!veiculo) throw erro.naoEncontrado('Veiculo nao encontrado nesta empresa.')

    const emAberto = consultarUm(
      `SELECT id FROM preventivas WHERE veiculo_id = ? AND status <> 'realizada'`, [veiculo.id])
    if (emAberto) {
      throw erro.conflito('Este veiculo ja tem uma preventiva em aberto. Conclua ou ajuste a existente.')
    }

    const modo = String(ctx.corpo.modo || '')
    const alvo = validarAlvo({ modo, ...ctx.corpo }, veiculo.km_atual)

    const modelo = validarModelo(eu.empresa_id, ctx.corpo.template_id)

    const id = novoId('preventiva')
    const ts = agora()
    executar(
      `INSERT INTO preventivas (id, empresa_id, veiculo_id, modo, ultimo_servico_km, ultimo_servico_data,
                                proximo_km, proxima_data, alerta_antes_km, alerta_antes_dias,
                                template_id, status, observacoes, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'em_dia', ?, ?, ?)`,
      [id, eu.empresa_id, veiculo.id, modo, veiculo.km_atual, ts.slice(0, 10),
       alvo.proximo_km, alvo.proxima_data,
       Number(ctx.corpo.alerta_antes_km || 500), Number(ctx.corpo.alerta_antes_dias || 7),
       modelo?.id ?? null,
       String(ctx.corpo.observacoes || '').trim() || null, ts, ts],
    )
    avaliarPreventivas(eu.empresa_id)

    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'preventiva.criada',
      entidade: 'preventiva', entidadeId: id,
      depois: { placa: veiculo.placa, modo, ...alvo }, ip: ctx.ip,
    })
    return { preventiva: enriquecer(buscarNaEmpresa(eu.empresa_id, id)) }
  })

  // ---------------------------------------------------------- reagendar
  // Secao 20: mudanca excepcional de alvo e' permitida, mas com motivo e rastro.
  rotas.patch('/api/preventivas/:id', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const antes = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    if (antes.status === 'realizada') {
      throw erro.conflito('Preventiva concluida faz parte do historico e nao pode ser alterada.')
    }

    const motivo = String(ctx.corpo.motivo || '').trim()
    if (!motivo) throw erro.requisicao('Informe o motivo do reagendamento.')

    const modo = ctx.corpo.modo === undefined ? antes.modo : String(ctx.corpo.modo)
    const alvo = validarAlvo({
      modo,
      proximo_km: ctx.corpo.proximo_km ?? antes.proximo_km,
      proxima_data: ctx.corpo.proxima_data ?? antes.proxima_data,
    }, antes.km_atual)

    const alertaKm = ctx.corpo.alerta_antes_km === undefined
      ? antes.alerta_antes_km : Number(ctx.corpo.alerta_antes_km)
    const alertaDias = ctx.corpo.alerta_antes_dias === undefined
      ? antes.alerta_antes_dias : Number(ctx.corpo.alerta_antes_dias)

    const modelo = ctx.corpo.template_id === undefined
      ? { id: antes.template_id }
      : validarModelo(eu.empresa_id, ctx.corpo.template_id)

    executar(
      `UPDATE preventivas SET modo = ?, proximo_km = ?, proxima_data = ?,
              alerta_antes_km = ?, alerta_antes_dias = ?, template_id = ?, atualizado_em = ?
        WHERE id = ? AND empresa_id = ?`,
      [modo, alvo.proximo_km, alvo.proxima_data, alertaKm, alertaDias,
       modelo?.id ?? null, agora(), antes.id, eu.empresa_id],
    )
    avaliarPreventivas(eu.empresa_id)

    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'preventiva.reagendada',
      entidade: 'preventiva', entidadeId: antes.id,
      antes: { modo: antes.modo, proximo_km: antes.proximo_km, proxima_data: antes.proxima_data },
      depois: { modo, ...alvo, motivo }, ip: ctx.ip,
    })
    return { preventiva: enriquecer(buscarNaEmpresa(eu.empresa_id, antes.id)) }
  })

  // ---------------------------------------------------------- concluir
  // Secao 19, passos 4 a 7: registra o servico feito E ja define o proximo
  // ciclo. Nao existe "concluir e decidir depois" — e' assim que uma frota
  // perde o controle da manutencao.
  rotas.post('/api/preventivas/:id/concluir', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const atual = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    if (atual.status === 'realizada') throw erro.conflito('Esta preventiva ja foi concluida.')

    const kmRealizado = ctx.corpo.km_realizado == null || ctx.corpo.km_realizado === ''
      ? atual.km_atual : Number(ctx.corpo.km_realizado)
    if (!Number.isFinite(kmRealizado) || kmRealizado < 0) {
      throw erro.requisicao('Quilometragem da execucao invalida.')
    }
    const dataRealizada = String(ctx.corpo.data_realizada || agora().slice(0, 10)).slice(0, 10)
    if (!DATA_ISO.test(dataRealizada)) throw erro.requisicao('Data da execucao invalida.')

    const servico = String(ctx.corpo.servico || '').trim()
    if (servico.length < 3) throw erro.requisicao('Descreva o servico executado.')

    // O proximo ciclo pode trocar de metodo: veiculo que envelhece sai de KM
    // para data, e vice-versa (secao 18).
    const proximoModo = String(ctx.corpo.proximo_modo || atual.modo)
    const kmDepois = Math.max(Number(atual.km_atual), Math.trunc(kmRealizado))
    const proximoAlvo = validarAlvo({
      modo: proximoModo,
      proximo_km: ctx.corpo.proximo_km,
      proxima_data: ctx.corpo.proxima_data,
    }, kmDepois)

    let idProxima = null
    transacao(() => {
      // Mesmo caminho que o checklist de preventiva usa ao finalizar o retorno
      // (roadmap 14.2.3): duas portas, um ato so.
      idProxima = encerrarCiclo({
        atual, empresaId: eu.empresa_id, atorId: eu.id,
        kmRealizado, dataRealizada, servico,
        proximo: { modo: proximoModo, ...proximoAlvo },
        alertas: { km: ctx.corpo.alerta_antes_km, dias: ctx.corpo.alerta_antes_dias },
      }).idProxima
    })
    avaliarPreventivas(eu.empresa_id)

    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'preventiva.concluida',
      entidade: 'preventiva', entidadeId: atual.id,
      antes: { modo: atual.modo, proximo_km: atual.proximo_km, proxima_data: atual.proxima_data },
      depois: {
        placa: atual.placa, servico, km: Math.trunc(kmRealizado), data: dataRealizada,
        proxima: { modo: proximoModo, ...proximoAlvo },
      },
      ip: ctx.ip,
    })
    return {
      concluida: enriquecer(buscarNaEmpresa(eu.empresa_id, atual.id)),
      proxima: enriquecer(buscarNaEmpresa(eu.empresa_id, idProxima)),
    }
  })
}
