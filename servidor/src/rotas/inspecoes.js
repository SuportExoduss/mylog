// Execucao de checklist (roadmap 11).
//
// O aplicativo julga a inspecao na hora para mostrar o resumo ao colaborador.
// Quando ela chega aqui, o servidor RE-JULGA do zero, com o mesmo motor e a
// versao do modelo que foi respondida. Qualquer resultado que venha no corpo e'
// ignorado: um aparelho no patio e' cliente nao confiavel, e o resultado do
// checklist e' o que bloqueia ou libera um caminhao.
import { consultar, consultarUm, executar, novoId, agora, transacao } from '../nucleo/banco.js'
import { erro } from '../nucleo/http.js'
import { registrarEvento } from '../nucleo/auditoria.js'
import { exigirAutenticado } from '../seguranca/sessao.js'
import { ehFrota } from '../seguranca/nivel.js'
import { registrarKm } from './veiculos.js'
import { avaliarInspecao, cargoLiberado, MOMENTOS } from '../../../compartilhado/template.js'

function politicas(empresaId) {
  const linha = consultarUm('SELECT politicas FROM empresas WHERE id = ?', [empresaId])
  try { return JSON.parse(linha?.politicas || '{}') } catch { return {} }
}

// Modelo publicado que atende aquele tipo de veiculo e aquele cargo.
// Desempate por data de publicacao: vence o mais recente.
function checklistsDisponiveis(empresaId, tipoVeiculo, cargoId) {
  return consultar(
    `SELECT * FROM templates
      WHERE empresa_id = ? AND status = 'publicado' AND tipo_veiculo = ?
      ORDER BY publicado_em DESC`,
    [empresaId, tipoVeiculo])
    .map((t) => ({ ...t, cargos_liberados: JSON.parse(t.cargos_liberados) }))
    .filter((t) => cargoLiberado(t.cargos_liberados, cargoId))
}

export function registrarRotasInspecoes(rotas) {
  // ------------------------------------------------------- inicio do app
  // Uma requisicao devolve tudo que o aplicativo precisa para o dia inteiro
  // offline: as solicitacoes ativas da pessoa, o veiculo de cada uma e o
  // checklist que ela pode executar nele.
  rotas.get('/api/app/inicio', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    const p = politicas(eu.empresa_id)

    const solicitacoes = consultar(
      `SELECT s.*, v.placa, v.modelo, v.marca, v.tipo, v.km_atual, v.status AS veiculo_status
         FROM solicitacoes s JOIN veiculos v ON v.id = s.veiculo_id
        WHERE s.empresa_id = ? AND s.solicitante_id = ?
          AND s.status IN ('aprovada', 'em_uso')
        ORDER BY s.janela_inicio`,
      [eu.empresa_id, eu.id])

    const tarefas = []
    const modelos = new Map()

    for (const s of solicitacoes) {
      const candidatos = checklistsDisponiveis(eu.empresa_id, s.tipo, eu.cargo_id)
      if (!candidatos.length) continue
      const modelo = candidatos[0]
      modelos.set(modelo.id, {
        id: modelo.id,
        codigo: modelo.codigo,
        nome: modelo.nome,
        versao: modelo.versao,
        exige_assinatura: Boolean(modelo.exige_assinatura),
        estrutura: JSON.parse(modelo.estrutura),
      })
      // Aprovada -> falta a saida. Em uso -> falta o retorno (roadmap 11.5).
      tarefas.push({
        solicitacao_id: s.id,
        numero: s.numero,
        momento: s.status === 'aprovada' ? 'saida' : 'retorno',
        janela_inicio: s.janela_inicio,
        janela_fim: s.janela_fim,
        motivo: s.motivo,
        atrasada: s.status === 'em_uso' && s.janela_fim < agora(),
        template_id: modelo.id,
        veiculo: {
          id: s.veiculo_id, placa: s.placa, marca: s.marca,
          modelo: s.modelo, tipo: s.tipo, km_atual: s.km_atual,
        },
      })
    }

    return {
      usuario: { id: eu.id, nome: eu.nome, cargo_id: eu.cargo_id, cargo_nome: eu.cargo_nome },
      tarefas,
      modelos: [...modelos.values()],
      politicas: { bloqueio_por_critica: p.bloqueio_por_critica !== false },
      gerado_em: agora(),
    }
  })

  // ------------------------------------------------------------- enviar
  rotas.post('/api/inspecoes', async (ctx) => {
    const eu = exigirAutenticado(ctx)

    const clienteUuid = String(ctx.corpo.cliente_uuid || '').trim()
    if (clienteUuid.length < 8) {
      throw erro.requisicao('cliente_uuid ausente: o aplicativo precisa gerar um id por inspecao.')
    }

    // Idempotencia: reenvio da fila offline devolve a inspecao existente em vez
    // de duplicar. A resposta pode ter se perdido no caminho, a inspecao nao.
    const jaExiste = consultarUm(
      'SELECT * FROM inspecoes WHERE empresa_id = ? AND cliente_uuid = ?',
      [eu.empresa_id, clienteUuid])
    if (jaExiste) return { inspecao: jaExiste, repetida: true }

    const momento = String(ctx.corpo.momento || 'saida')
    if (!MOMENTOS.includes(momento)) throw erro.requisicao('Momento invalido: use saida ou retorno.')

    const solicitacao = consultarUm(
      'SELECT * FROM solicitacoes WHERE id = ? AND empresa_id = ?',
      [String(ctx.corpo.solicitacao_id || ''), eu.empresa_id])
    if (!solicitacao) throw erro.naoEncontrado('Solicitacao nao encontrada.')

    // A autorizacao e' reconferida aqui: nao basta o app ter mostrado a tarefa.
    if (solicitacao.solicitante_id !== eu.id && !ehFrota(eu)) {
      throw erro.permissao('Esta solicitacao pertence a outra pessoa.')
    }
    const esperado = solicitacao.status === 'aprovada' ? 'saida'
      : solicitacao.status === 'em_uso' ? 'retorno' : null
    if (esperado === null) {
      throw erro.conflito(`Solicitacao ${solicitacao.status} nao aceita checklist.`)
    }
    if (momento !== esperado) {
      throw erro.conflito(`Esta solicitacao espera o checklist de ${esperado}.`)
    }

    const veiculo = consultarUm('SELECT * FROM veiculos WHERE id = ? AND empresa_id = ?',
      [solicitacao.veiculo_id, eu.empresa_id])

    const modeloLinha = consultarUm('SELECT * FROM templates WHERE id = ? AND empresa_id = ?',
      [String(ctx.corpo.template_id || ''), eu.empresa_id])
    if (!modeloLinha) throw erro.naoEncontrado('Checklist nao encontrado.')

    const estrutura = JSON.parse(modeloLinha.estrutura)
    const cargos = JSON.parse(modeloLinha.cargos_liberados)
    if (!ehFrota(eu) && !cargoLiberado(cargos, eu.cargo_id)) {
      throw erro.permissao('Seu cargo nao esta liberado para este checklist.')
    }

    // Respostas vem como { pergunta_id: { desfecho, opcao_id, relatorio, fotos } }
    const respostas = ctx.corpo.respostas && typeof ctx.corpo.respostas === 'object'
      ? ctx.corpo.respostas : {}
    const assinatura = String(ctx.corpo.assinatura || '') || null

    // RE-JULGAMENTO. O que o app calculou nao entra na conta.
    const juizo = avaliarInspecao(estrutura, respostas, {
      politicas: politicas(eu.empresa_id),
      exige_assinatura: Boolean(modeloLinha.exige_assinatura),
      assinatura,
    })
    if (!juizo.pode_finalizar) {
      throw erro.requisicao(
        `Checklist incompleto: ${juizo.pendencias.map((p) => `${p.titulo} (${p.motivo})`).join('; ')}`)
    }

    const id = novoId('inspecao')
    const ts = agora()
    const km = ctx.corpo.km_informado

    transacao(() => {
      executar(
        `INSERT INTO inspecoes (id, empresa_id, veiculo_id, usuario_id, template_id, solicitacao_id,
                                momento, status, km_informado, iniciada_em, finalizada_em,
                                resultado, assinatura, cliente_uuid, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'finalizada', ?, ?, ?, ?, ?, ?, ?)`,
        [id, eu.empresa_id, veiculo.id, eu.id, modeloLinha.id, solicitacao.id,
         momento, km ?? null, ctx.corpo.iniciada_em || ts, ts,
         juizo.resultado, assinatura, clienteUuid, ts])

      for (const [perguntaId, r] of Object.entries(respostas)) {
        executar(
          `INSERT INTO respostas (id, empresa_id, inspecao_id, pergunta_id, desfecho,
                                  opcao_id, relatorio, respondido_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [novoId('resposta'), eu.empresa_id, id, perguntaId, r.desfecho,
           r.opcao_id || null, r.relatorio || null, r.respondido_em || ts])
      }

      // Cada ocorrencia julgada vira registro na fila da Frota.
      for (const oc of juizo.ocorrencias) {
        executar(
          `INSERT INTO ocorrencias (id, empresa_id, inspecao_id, veiculo_id, pergunta_id,
                                    descricao, prioridade, status, aberta_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'aberta', ?)`,
          [novoId('ocorrencia'), eu.empresa_id, id, veiculo.id, oc.pergunta_id,
           `${oc.titulo}: ${oc.descricao}`, oc.prioridade, ts])
      }

      // Estado do veiculo conforme a politica da empresa.
      if (juizo.estado_veiculo_previsto !== 'disponivel') {
        executar('UPDATE veiculos SET status = ?, motivo_status = ?, atualizado_em = ? WHERE id = ?',
          [juizo.estado_veiculo_previsto, juizo.motivo, ts, veiculo.id])
      }

      // Saida coloca a solicitacao em uso. O retorno e' fechado pela rota de
      // devolucao, que e' quem sabe pedir o motivo do atraso.
      if (momento === 'saida') {
        executar(`UPDATE solicitacoes SET status = 'em_uso', inspecao_saida = ?, atualizado_em = ? WHERE id = ?`,
          [id, ts, solicitacao.id])
      } else {
        executar('UPDATE solicitacoes SET inspecao_retorno = ?, atualizado_em = ? WHERE id = ?',
          [id, ts, solicitacao.id])
      }
    })

    // O hodometro do checklist e' leitura de KM como qualquer outra.
    if (km !== undefined && km !== null && km !== '') {
      try {
        registrarKm(veiculo, km, { motivo: 'Leitura no checklist', ator: eu, ip: ctx.ip })
      } catch (falha) {
        // KM menor que o registrado nao derruba a inspecao: a inspecao ja
        // aconteceu no mundo. Fica o registro de que o numero nao bateu.
        registrarEvento({
          empresaId: eu.empresa_id, ator: eu, acao: 'veiculo.km_recusado',
          entidade: 'veiculo', entidadeId: veiculo.id,
          depois: { informado: km, atual: veiculo.km_atual, inspecao: id }, ip: ctx.ip,
        })
      }
    }

    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, alvoId: eu.id, acao: `checklist.${momento}`,
      entidade: 'inspecao', entidadeId: id,
      depois: {
        placa: veiculo.placa, resultado: juizo.resultado,
        ocorrencias: juizo.ocorrencias.length, estado_veiculo: juizo.estado_veiculo_previsto,
      },
      ip: ctx.ip,
    })

    return {
      inspecao: consultarUm('SELECT * FROM inspecoes WHERE id = ?', [id]),
      resumo: juizo,
    }
  })

  // ------------------------------------------------------------ consulta
  rotas.get('/api/inspecoes', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    const veiculoId = ctx.query.get('veiculo_id')
    const momento = ctx.query.get('momento')

    let sql = `SELECT i.*, v.placa, v.modelo, u.nome AS usuario_nome, t.nome AS checklist
                 FROM inspecoes i
                 JOIN veiculos v ON v.id = i.veiculo_id
                 JOIN usuarios u ON u.id = i.usuario_id
                 JOIN templates t ON t.id = i.template_id
                WHERE i.empresa_id = ?`
    const params = [eu.empresa_id]
    if (!ehFrota(eu)) { sql += ' AND i.usuario_id = ?'; params.push(eu.id) }
    if (veiculoId) { sql += ' AND i.veiculo_id = ?'; params.push(veiculoId) }
    if (momento && MOMENTOS.includes(momento)) { sql += ' AND i.momento = ?'; params.push(momento) }
    sql += ' ORDER BY i.iniciada_em DESC LIMIT 100'

    return { inspecoes: consultar(sql, params) }
  })

  rotas.get('/api/inspecoes/:id', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    const inspecao = consultarUm(
      `SELECT i.*, v.placa, v.modelo, u.nome AS usuario_nome,
              t.nome AS checklist, t.versao AS checklist_versao, t.estrutura
         FROM inspecoes i
         JOIN veiculos v ON v.id = i.veiculo_id
         JOIN usuarios u ON u.id = i.usuario_id
         JOIN templates t ON t.id = i.template_id
        WHERE i.id = ? AND i.empresa_id = ?`,
      [ctx.params.id, eu.empresa_id])
    if (!inspecao) throw erro.naoEncontrado('Inspecao nao encontrada.')
    if (!ehFrota(eu) && inspecao.usuario_id !== eu.id) {
      throw erro.permissao('Esta inspecao e de outra pessoa.')
    }

    const respostas = consultar('SELECT * FROM respostas WHERE inspecao_id = ?', [inspecao.id])
    const ocorrencias = consultar('SELECT * FROM ocorrencias WHERE inspecao_id = ?', [inspecao.id])
    const { estrutura, ...resto } = inspecao
    return { inspecao: resto, estrutura: JSON.parse(estrutura), respostas, ocorrencias }
  })
}
