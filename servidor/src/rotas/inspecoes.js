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
import { notificarFrota } from '../nucleo/notificacoes.js'
import { exigirAutenticado } from '../seguranca/sessao.js'
import { ehFrota } from '../seguranca/nivel.js'
import { registrarKm, agrava } from './veiculos.js'
import {
  avaliarInspecao, cargoLiberado, conferirProximaPreventiva, MOMENTOS,
} from '../../../compartilhado/template.js'
import { encerrarCiclo } from '../nucleo/ciclo_preventiva.js'
import { avaliarPreventivas } from '../nucleo/preventivas.js'

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

    // O status da preventiva e' derivado do relogio e do hodometro. Sem
    // recalcular aqui, o aplicativo mostraria "em dia" numa preventiva ja
    // vencida — o painel recalcula, o app nao recalculava, e os dois diziam
    // coisas diferentes sobre a mesma linha.
    avaliarPreventivas(eu.empresa_id)

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
        // O aplicativo escolhe a TELA por aqui: preventiva no retorno tem
        // outro fluxo (roadmap 14.2.2). Sem o campo, cairia no padrao.
        finalidade: modelo.finalidade,
        exige_assinatura: Boolean(modelo.exige_assinatura),
        periodicidade: modelo.periodicidade,
        dias_semana: JSON.parse(modelo.dias_semana || '[]'),
        horario_limite: modelo.horario_limite,
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

    // Preventivas com modelo de checklist (roadmap 14.2). A preventiva vencida
    // ou proxima vira tarefa: saida antes do servico, retorno depois. Sao os
    // dois momentos obrigatorios, e o retorno e' que encerra a manutencao.
    const preventivas = []
    const emAberto = consultar(
      // O modelo vem no mesmo SELECT, com prefixo. A versao anterior buscava o
      // template dentro do laco — uma consulta por preventiva, quase sempre
      // pelo MESMO modelo, ja que uma frota costuma ter um checklist de
      // preventiva e nao quarenta.
      `SELECT p.*, v.placa, v.marca, v.modelo, v.tipo, v.km_atual,
              t.id AS t_id, t.codigo AS t_codigo, t.nome AS t_nome, t.versao AS t_versao,
              t.finalidade AS t_finalidade, t.exige_assinatura AS t_assinatura,
              t.periodicidade AS t_periodicidade, t.dias_semana AS t_dias,
              t.horario_limite AS t_limite, t.cargos_liberados AS t_cargos,
              t.estrutura AS t_estrutura
         FROM preventivas p
         JOIN veiculos v ON v.id = p.veiculo_id
         JOIN templates t ON t.id = p.template_id
        WHERE p.empresa_id = ? AND p.status <> 'realizada'
          AND t.status = 'publicado' AND t.finalidade = 'preventiva'
        ORDER BY CASE p.status WHEN 'vencida' THEN 0 ELSE 1 END, p.atualizado_em`,
      [eu.empresa_id])

    for (const prev of emAberto) {
      const modelo = {
        id: prev.t_id, codigo: prev.t_codigo, nome: prev.t_nome, versao: prev.t_versao,
        finalidade: prev.t_finalidade, exige_assinatura: prev.t_assinatura,
        periodicidade: prev.t_periodicidade, dias_semana: prev.t_dias,
        horario_limite: prev.t_limite, cargos_liberados: prev.t_cargos,
        estrutura: prev.t_estrutura,
      }
      // Cargo vale aqui como em qualquer modelo: o checklist do mecanico so
      // aparece para o mecanico (roadmap 11.2.3).
      if (!cargoLiberado(JSON.parse(modelo.cargos_liberados), eu.cargo_id)) continue

      modelos.set(modelo.id, {
        id: modelo.id,
        codigo: modelo.codigo,
        nome: modelo.nome,
        versao: modelo.versao,
        finalidade: modelo.finalidade,
        exige_assinatura: Boolean(modelo.exige_assinatura),
        periodicidade: modelo.periodicidade,
        dias_semana: JSON.parse(modelo.dias_semana || '[]'),
        horario_limite: modelo.horario_limite,
        estrutura: JSON.parse(modelo.estrutura),
      })

      preventivas.push({
        preventiva_id: prev.id,
        momento: prev.inspecao_saida ? 'retorno' : 'saida',
        status: prev.status,
        modo: prev.modo,
        alvo: prev.modo === 'km' ? `${prev.proximo_km} km` : prev.proxima_data,
        template_id: modelo.id,
        veiculo: {
          id: prev.veiculo_id, placa: prev.placa, marca: prev.marca,
          modelo: prev.modelo, tipo: prev.tipo, km_atual: prev.km_atual,
        },
      })
    }

    // Checklist diario avulso (roadmap 8.2). Quem sai com carro toda manha nao
    // pede veiculo: pega um no galpao e faz o checklist nele. Nao ha condutor
    // fixo, entao o aparelho precisa da lista de carros para a pessoa escolher.
    const avulso = []
    if (eu.usa_veiculo_diario || ehFrota(eu)) {
      const disponiveis = consultar(
        `SELECT id, placa, marca, modelo, tipo, km_atual, status FROM veiculos
          WHERE empresa_id = ? AND status IN ('disponivel', 'com_pendencia')
          ORDER BY placa`,
        [eu.empresa_id])

      for (const v of disponiveis) {
        const candidatos = checklistsDisponiveis(eu.empresa_id, v.tipo, eu.cargo_id)
        if (!candidatos.length) continue
        for (const modelo of candidatos) {
          if (modelos.has(modelo.id)) continue
          modelos.set(modelo.id, {
            id: modelo.id,
            codigo: modelo.codigo,
            nome: modelo.nome,
            versao: modelo.versao,
            finalidade: modelo.finalidade,
            exige_assinatura: Boolean(modelo.exige_assinatura),
            periodicidade: modelo.periodicidade,
            dias_semana: JSON.parse(modelo.dias_semana || '[]'),
            horario_limite: modelo.horario_limite,
            estrutura: JSON.parse(modelo.estrutura),
          })
        }
        avulso.push({ veiculo: v, templates: candidatos.map((m) => m.id) })
      }
    }

    return {
      usuario: {
        id: eu.id, nome: eu.nome, cargo_id: eu.cargo_id, cargo_nome: eu.cargo_nome,
        usa_veiculo_diario: Boolean(eu.usa_veiculo_diario),
      },
      tarefas,
      preventivas,
      avulso,
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

    // Tres caminhos. Com SOLICITACAO: saida e retorno amarrados a uma reserva
    // (roadmap 8.2). Com PREVENTIVA: saida antes do servico e retorno depois,
    // e o retorno encerra a manutencao (14.2). Sem nenhum dos dois: checklist
    // diario avulso, de quem sai com carro toda manha.
    const solicitacaoId = String(ctx.corpo.solicitacao_id || '')
    const preventivaId = String(ctx.corpo.preventiva_id || '')
    let solicitacao = null
    let preventiva = null
    let veiculo = null

    if (solicitacaoId && preventivaId) {
      throw erro.requisicao('Um checklist atende uma solicitacao ou uma preventiva, nunca as duas.')
    }

    if (preventivaId) {
      preventiva = consultarUm(
        `SELECT p.*, v.km_atual FROM preventivas p
           JOIN veiculos v ON v.id = p.veiculo_id
          WHERE p.id = ? AND p.empresa_id = ?`, [preventivaId, eu.empresa_id])
      if (!preventiva) throw erro.naoEncontrado('Preventiva nao encontrada nesta empresa.')
      if (preventiva.status === 'realizada') {
        throw erro.conflito('Esta preventiva ja foi concluida.')
      }
      // Saida e retorno, nesta ordem e os dois obrigatorios (roadmap 14.2.1).
      const esperado = preventiva.inspecao_saida ? 'retorno' : 'saida'
      if (momento !== esperado) {
        throw erro.conflito(`Esta preventiva espera o checklist de ${esperado}.`)
      }
      veiculo = consultarUm('SELECT * FROM veiculos WHERE id = ? AND empresa_id = ?',
        [preventiva.veiculo_id, eu.empresa_id])
    } else if (solicitacaoId) {
      solicitacao = consultarUm('SELECT * FROM solicitacoes WHERE id = ? AND empresa_id = ?',
        [solicitacaoId, eu.empresa_id])
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
      veiculo = consultarUm('SELECT * FROM veiculos WHERE id = ? AND empresa_id = ?',
        [solicitacao.veiculo_id, eu.empresa_id])
    } else {
      if (!eu.usa_veiculo_diario && !ehFrota(eu)) {
        throw erro.permissao(
          'Checklist sem solicitacao e para quem usa veiculo todos os dias. Peca um veiculo primeiro.')
      }
      // Avulso nao tem devolucao: nao existe retorno sem alguem a quem devolver.
      if (momento !== 'saida') {
        throw erro.requisicao('Checklist avulso nao tem retorno: o carro nao foi reservado.')
      }
      veiculo = consultarUm('SELECT * FROM veiculos WHERE id = ? AND empresa_id = ?',
        [String(ctx.corpo.veiculo_id || ''), eu.empresa_id])
      if (!veiculo) throw erro.naoEncontrado('Escolha o veiculo do checklist.')
      if (veiculo.status === 'bloqueado') {
        throw erro.conflito(`Veiculo bloqueado: ${veiculo.motivo_status || 'liberacao pendente da frota'}.`)
      }
    }

    const modeloLinha = consultarUm('SELECT * FROM templates WHERE id = ? AND empresa_id = ?',
      [String(ctx.corpo.template_id || ''), eu.empresa_id])
    if (!modeloLinha) throw erro.naoEncontrado('Checklist nao encontrado.')

    const estrutura = JSON.parse(modeloLinha.estrutura)
    const cargos = JSON.parse(modeloLinha.cargos_liberados)
    // Cargo vale para TODO MUNDO, inclusive a frota. O exemplo que define a
    // regra e' o checklist pos-manutencao do mecanico — e o mecanico e' da
    // frota (roadmap 11.2.3). Abrir excecao aqui esvaziaria a regra
    // exatamente no caso que a criou.
    //
    // A lista ja escondia o modelo; sem esta linha, o servidor aceitaria um
    // envio que a tela nunca ofereceu — e tela e servidor diriam coisas
    // diferentes sobre a mesma regra.
    if (!cargoLiberado(cargos, eu.cargo_id)) {
      throw erro.permissao('Seu cargo nao esta liberado para este checklist.')
    }

    // Respostas vem como { pergunta_id: { desfecho, opcao_id, relatorio, fotos } }
    const respostas = ctx.corpo.respostas && typeof ctx.corpo.respostas === 'object'
      ? ctx.corpo.respostas : {}
    const assinatura = String(ctx.corpo.assinatura || '') || null

    // Modelo de preventiva so roda dentro de uma preventiva, e preventiva so
    // roda com modelo de preventiva. Trocar um pelo outro daria um checklist
    // que pergunta a coisa errada — e, no retorno, encerraria manutencao
    // nenhuma.
    if (modeloLinha.finalidade === 'preventiva' && !preventiva) {
      throw erro.requisicao('Este checklist executa uma preventiva. Abra pela preventiva do veiculo.')
    }
    if (preventiva && modeloLinha.finalidade !== 'preventiva') {
      throw erro.requisicao('Preventiva exige um checklist de preventiva.')
    }

    // RE-JULGAMENTO. O que o app calculou nao entra na conta.
    const juizo = avaliarInspecao(estrutura, respostas, {
      politicas: politicas(eu.empresa_id),
      exige_assinatura: Boolean(modeloLinha.exige_assinatura),
      assinatura,
      finalidade: modeloLinha.finalidade,
      momento,
      proxima_preventiva: ctx.corpo.proxima_preventiva,
    })
    if (!juizo.pode_finalizar) {
      throw erro.requisicao(
        `Checklist incompleto: ${juizo.pendencias.map((p) => `${p.titulo} (${p.motivo})`).join('; ')}`)
    }

    const id = novoId('inspecao')
    const ts = agora()
    const km = ctx.corpo.km_informado

    // QUANDO O CHECKLIST ACONTECEU, e nao quando ele chegou.
    //
    // `finalizada_em` era carimbado com a hora do recebimento. Num checklist
    // feito offline isso e' a hora do sincronismo: quem preencheu as 07h50 no
    // patio e so pegou sinal as 14h aparecia como atrasado, e quem terminou as
    // 23h50 caia no dia seguinte — some do dia certo e vira falta no relatorio
    // de quem nao fez. O aparelho ja mandava o instante certo, e o servidor o
    // descartava. `iniciada_em` ja era aceito; era so `finalizada_em` que faltava.
    //
    // Aceitar nao e' confiar cegamente: relogio de celular atrasa, adianta e
    // pode ser mexido. O instante e' aceito dentro de uma janela sensata e,
    // fora dela, cai para a hora do recebimento com registro na auditoria —
    // mesmo tratamento que o KM que nao bate ja recebe.
    const instanteDoAparelho = (valor, { minimoIso } = {}) => {
      const bruto = String(valor || '')
      if (!bruto) return { iso: ts, informado: null }
      const d = new Date(bruto)
      if (Number.isNaN(d.getTime())) return { iso: ts, informado: bruto, recusado: 'ilegivel' }
      const agoraMs = new Date(ts).getTime()
      // Cinco minutos de folga para relogio adiantado; o futuro nao existe.
      if (d.getTime() > agoraMs + 5 * 60_000) {
        return { iso: ts, informado: bruto, recusado: 'no_futuro' }
      }
      // Trinta dias e' mais que qualquer fila offline plausivel.
      if (d.getTime() < agoraMs - 30 * 86400_000) {
        return { iso: ts, informado: bruto, recusado: 'antigo_demais' }
      }
      if (minimoIso && d.getTime() < new Date(minimoIso).getTime()) {
        return { iso: minimoIso, informado: bruto, recusado: 'antes_do_inicio' }
      }
      return { iso: d.toISOString(), informado: bruto }
    }

    const inicio = instanteDoAparelho(ctx.corpo.iniciada_em)
    const fim = instanteDoAparelho(ctx.corpo.finalizada_em, { minimoIso: inicio.iso })
    const relogioSuspeito = [inicio, fim].filter((x) => x.recusado)

    transacao(() => {
      // Numero sequencial por empresa: e' o que a operacao cita em voz alta
      // ("confere o 21713016"). Calculado dentro da transacao para dois envios
      // simultaneos nao pegarem o mesmo numero.
      const numero = (consultarUm(
        'SELECT MAX(numero) AS maior FROM inspecoes WHERE empresa_id = ?',
        [eu.empresa_id])?.maior ?? 0) + 1

      executar(
        `INSERT INTO inspecoes (id, empresa_id, numero, veiculo_id, usuario_id, template_id,
                                solicitacao_id, preventiva_id, momento, status, km_informado,
                                iniciada_em, finalizada_em, resultado, assinatura,
                                cliente_uuid, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'finalizada', ?, ?, ?, ?, ?, ?, ?)`,
        [id, eu.empresa_id, numero, veiculo.id, eu.id, modeloLinha.id,
         solicitacao?.id ?? null, preventiva?.id ?? null,
         momento, km ?? null, inicio.iso, fim.iso,
         juizo.resultado, assinatura, clienteUuid, ts])

      for (const [perguntaId, r] of Object.entries(respostas)) {
        // No retorno de preventiva nao existe OK nem Ocorrencia: a resposta e'
        // "foi feito manutencao?" mais o relatorio. `desfecho` fica em 'ok'
        // porque a coluna e' obrigatoria e nada foi reprovado — o que importa
        // esta em manutencao_feita.
        const ehRetornoPreventiva = Boolean(preventiva) && momento === 'retorno'
        executar(
          `INSERT INTO respostas (id, empresa_id, inspecao_id, pergunta_id, desfecho,
                                  opcao_id, relatorio, manutencao_feita, respondido_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [novoId('resposta'), eu.empresa_id, id, perguntaId,
           ehRetornoPreventiva ? 'ok' : r.desfecho,
           ehRetornoPreventiva ? null : (r.opcao_id || null),
           r.relatorio || null,
           ehRetornoPreventiva ? (r.manutencao_feita ? 1 : 0) : null,
           r.respondido_em || ts])
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

      // Estado do veiculo conforme a politica da empresa. So aplica se o
      // checklist APERTAR a restricao: um retorno com problema medio nao pode
      // rebaixar para "com pendencia" um carro que estava bloqueado — liberar
      // veiculo bloqueado e' decisao da Frota, com motivo (roadmap 9.3).
      if (agrava(veiculo.status, juizo.estado_veiculo_previsto)) {
        executar('UPDATE veiculos SET status = ?, motivo_status = ?, atualizado_em = ? WHERE id = ?',
          [juizo.estado_veiculo_previsto, juizo.motivo, ts, veiculo.id])
      }

      // Preventiva: a saida so registra que comecou; o RETORNO encerra o ciclo
      // e agenda a proxima, no mesmo ato (roadmap 14.2.3). Dentro da mesma
      // transacao da inspecao: ou as duas coisas acontecem, ou nenhuma.
      if (preventiva && momento === 'saida') {
        executar('UPDATE preventivas SET inspecao_saida = ?, atualizado_em = ? WHERE id = ?',
          [id, ts, preventiva.id])
      } else if (preventiva) {
        executar('UPDATE preventivas SET inspecao_retorno = ?, atualizado_em = ? WHERE id = ?',
          [id, ts, preventiva.id])
        const servicos = juizo.servicos || []
        encerrarCiclo({
          atual: preventiva,
          empresaId: eu.empresa_id,
          atorId: eu.id,
          kmRealizado: km ?? preventiva.km_atual,
          dataRealizada: ts.slice(0, 10),
          servico: servicos.length
            ? servicos.map((x) => x.titulo).join('; ')
            : 'Preventiva executada sem intervencao em nenhum item.',
          proximo: juizo.proxima_preventiva,
        })
      }

      // Saida coloca a solicitacao em uso. O retorno e' fechado pela rota de
      // devolucao, que e' quem sabe pedir o motivo do atraso.
      // Checklist avulso nao tem solicitacao para atualizar.
      if (solicitacao && momento === 'saida') {
        executar(`UPDATE solicitacoes SET status = 'em_uso', inspecao_saida = ?, atualizado_em = ? WHERE id = ?`,
          [id, ts, solicitacao.id])
      } else if (solicitacao) {
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

    // Ocorrencia critica para o carro. Quem libera veiculo precisa saber no
    // momento em que acontece, nao quando abrir o painel — pode haver alguem
    // esperando esse carro no patio agora.
    const criticas = juizo.ocorrencias.filter((o) => o.prioridade === 'critica')
    if (criticas.length) {
      notificarFrota({
        empresaId: eu.empresa_id, tipo: 'ocorrencia', nivel: 'critico',
        texto: `${veiculo.placa}: ${criticas[0].titulo} — ${criticas[0].descricao}`
          + (juizo.estado_veiculo_previsto === 'bloqueado' ? ' O veiculo foi BLOQUEADO.' : ''),
        destino: 'ocorrencias', entidadeId: id, exceto: eu.id,
      })
    } else if (juizo.ocorrencias.length && juizo.maior_prioridade === 'alta') {
      notificarFrota({
        empresaId: eu.empresa_id, tipo: 'ocorrencia', nivel: 'atencao',
        texto: `${veiculo.placa}: ${juizo.ocorrencias.length} ocorrencia(s), maior prioridade alta.`,
        destino: 'ocorrencias', entidadeId: id, exceto: eu.id,
      })
    }

    // Preventiva encerrada: a Frota precisa saber que o carro voltou da
    // oficina e que ja existe um proximo alvo agendado.
    if (preventiva && momento === 'retorno') {
      notificarFrota({
        empresaId: eu.empresa_id, tipo: 'preventiva',
        texto: `Preventiva de ${veiculo.placa} concluida por ${eu.nome}: `
          + `${juizo.itens_com_manutencao || 0} item(ns) com servico.`,
        destino: 'preventivas', entidadeId: preventiva.id, exceto: eu.id,
      })
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

    // Relogio do aparelho fora da janela nao derruba a inspecao: ela aconteceu
    // no mundo. Fica o registro de que a hora informada nao foi usada, para o
    // caso de alguem perguntar depois por que aquele checklist esta com a hora
    // da sincronizacao.
    if (relogioSuspeito.length) {
      registrarEvento({
        empresaId: eu.empresa_id, ator: eu, acao: 'inspecao.relogio_recusado',
        entidade: 'inspecao', entidadeId: id,
        depois: {
          recebido_em: ts,
          iniciada: inicio.recusado ? { informado: inicio.informado, motivo: inicio.recusado } : null,
          finalizada: fim.recusado ? { informado: fim.informado, motivo: fim.recusado } : null,
        },
        ip: ctx.ip,
      })
    }

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
