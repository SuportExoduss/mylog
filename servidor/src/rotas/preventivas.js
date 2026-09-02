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
import { exigir } from '../seguranca/permissoes.js'
import { avaliarPreventiva, avaliarPreventivas, descreverFolga } from '../nucleo/preventivas.js'

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

export function registrarRotasPreventivas(rotas) {
  // ------------------------------------------------------------------ lista
  rotas.get('/api/preventivas', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'preventivas.ler')
    avaliarPreventivas(eu.empresa_id)

    const status = ctx.query.get('status')
    const veiculoId = ctx.query.get('veiculo_id')
    const incluirRealizadas = ctx.query.get('historico') === '1'

    let sql = `SELECT p.*, v.placa, v.modelo, v.marca, v.km_atual, u.nome AS concluida_por_nome
                 FROM preventivas p
                 JOIN veiculos v ON v.id = p.veiculo_id
                 LEFT JOIN usuarios u ON u.id = p.concluida_por
                WHERE p.empresa_id = ?`
    const params = [eu.empresa_id]
    if (!incluirRealizadas && !status) sql += ` AND p.status <> 'realizada'`
    if (status) { sql += ' AND p.status = ?'; params.push(status) }
    if (veiculoId) { sql += ' AND p.veiculo_id = ?'; params.push(veiculoId) }
    // Vencida primeiro: o painel e' fila de acao, nao ordem alfabetica.
    sql += ` ORDER BY CASE p.status
               WHEN 'vencida' THEN 0 WHEN 'muito_proxima' THEN 1 WHEN 'proxima' THEN 2
               WHEN 'em_dia' THEN 3 ELSE 4 END, v.placa`

    return { preventivas: consultar(sql, params).map(enriquecer) }
  })

  // --------------------------------------------------------------- detalhe
  rotas.get('/api/preventivas/:id', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'preventivas.ler')
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
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'preventivas.escrever')

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

    const id = novoId('preventiva')
    const ts = agora()
    executar(
      `INSERT INTO preventivas (id, empresa_id, veiculo_id, modo, ultimo_servico_km, ultimo_servico_data,
                                proximo_km, proxima_data, alerta_antes_km, alerta_antes_dias,
                                status, observacoes, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'em_dia', ?, ?, ?)`,
      [id, eu.empresa_id, veiculo.id, modo, veiculo.km_atual, ts.slice(0, 10),
       alvo.proximo_km, alvo.proxima_data,
       Number(ctx.corpo.alerta_antes_km || 500), Number(ctx.corpo.alerta_antes_dias || 7),
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
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'preventivas.escrever')
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

    executar(
      `UPDATE preventivas SET modo = ?, proximo_km = ?, proxima_data = ?,
              alerta_antes_km = ?, alerta_antes_dias = ?, atualizado_em = ?
        WHERE id = ? AND empresa_id = ?`,
      [modo, alvo.proximo_km, alvo.proxima_data, alertaKm, alertaDias, agora(),
       antes.id, eu.empresa_id],
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
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'preventivas.escrever')
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

    const ts = agora()
    const idProxima = novoId('preventiva')

    transacao(() => {
      executar(
        `UPDATE preventivas SET status = 'realizada', concluida_por = ?, concluida_em = ?,
                ultimo_servico_km = ?, ultimo_servico_data = ?, observacoes = ?, atualizado_em = ?
          WHERE id = ? AND empresa_id = ?`,
        [eu.id, ts, Math.trunc(kmRealizado), dataRealizada, servico, ts, atual.id, eu.empresa_id],
      )
      // A execucao da manutencao tambem e' leitura de hodometro.
      if (Math.trunc(kmRealizado) > Number(atual.km_atual)) {
        executar('UPDATE veiculos SET km_atual = ?, atualizado_em = ? WHERE id = ?',
          [Math.trunc(kmRealizado), ts, atual.veiculo_id])
      }
      executar(
        `INSERT INTO preventivas (id, empresa_id, veiculo_id, modo, ultimo_servico_km, ultimo_servico_data,
                                  proximo_km, proxima_data, alerta_antes_km, alerta_antes_dias,
                                  status, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'em_dia', ?, ?)`,
        [idProxima, eu.empresa_id, atual.veiculo_id, proximoModo,
         Math.trunc(kmRealizado), dataRealizada,
         proximoAlvo.proximo_km, proximoAlvo.proxima_data,
         Number(ctx.corpo.alerta_antes_km ?? atual.alerta_antes_km ?? 500),
         Number(ctx.corpo.alerta_antes_dias ?? atual.alerta_antes_dias ?? 7), ts, ts],
      )
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
