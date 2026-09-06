// Painel de supervisao (roadmap 7). Uma requisicao devolve todos os cards:
// o painel precisa abrir mostrando o que exige acao, sem varias idas ao servidor.
import { consultar, consultarUm } from '../nucleo/banco.js'
import { exigirAutenticado } from '../seguranca/sessao.js'
import { exigirFrota } from '../seguranca/nivel.js'
import { avaliarPreventivas } from '../nucleo/preventivas.js'
import { quemNaoFez, venceu } from '../nucleo/cobranca.js'
import { diaLocal } from '../nucleo/relogio.js'

function contarPorChave(linhas) {
  const saida = {}
  for (const linha of linhas) saida[linha.chave] = linha.total
  return saida
}

export function registrarRotasPainel(rotas) {
  rotas.get('/api/painel', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const empresa = eu.empresa_id
    const agoraIso = new Date().toISOString()
    const hoje = agoraIso.slice(0, 10)

    // O status das preventivas e' derivado de KM/data; recalcula antes de exibir.
    avaliarPreventivas(empresa)

    const frota = contarPorChave(consultar(
      'SELECT status AS chave, COUNT(*) AS total FROM veiculos WHERE empresa_id = ? GROUP BY status',
      [empresa]))

    const usuarios = contarPorChave(consultar(
      `SELECT status AS chave, COUNT(*) AS total FROM usuarios
        WHERE empresa_id = ? AND status <> 'desativado' GROUP BY status`, [empresa]))

    const checklistsHoje = consultarUm(
      `SELECT COUNT(*) AS total FROM inspecoes
        WHERE empresa_id = ? AND substr(iniciada_em, 1, 10) = ?`, [empresa, hoje])?.total ?? 0

    const saidasAbertas = consultarUm(
      `SELECT COUNT(*) AS total FROM solicitacoes
        WHERE empresa_id = ? AND status = 'em_uso'`, [empresa])?.total ?? 0

    const ocorrencias = contarPorChave(consultar(
      `SELECT prioridade AS chave, COUNT(*) AS total FROM ocorrencias
        WHERE empresa_id = ? AND status IN ('aberta', 'em_tratamento')
        GROUP BY prioridade`, [empresa]))

    const solicitacoes = contarPorChave(consultar(
      'SELECT status AS chave, COUNT(*) AS total FROM solicitacoes WHERE empresa_id = ? GROUP BY status',
      [empresa]))

    const devolucoesAtrasadas = consultarUm(
      `SELECT COUNT(*) AS total FROM solicitacoes
        WHERE empresa_id = ? AND status = 'em_uso' AND janela_fim < ?`,
      [empresa, agoraIso])?.total ?? 0

    const preventivas = contarPorChave(consultar(
      'SELECT status AS chave, COUNT(*) AS total FROM preventivas WHERE empresa_id = ? GROUP BY status',
      [empresa]))

    // Fila de acao: o que a Frota precisa resolver hoje, ordenado por urgencia.
    const alertas = []

    // Checklist nao realizado (roadmap 11.2.2). Estado derivado, calculado
    // aqui: nao existe tabela de faltas, porque guardar falta seria guardar
    // uma acusacao que o proprio sistema pode ter que retirar — bastaria o
    // checklist subir da fila offline dez minutos depois.
    const agoraLocal = new Date()
    const cobranca = quemNaoFez(empresa, diaLocal(agoraLocal))
    // So cobra depois do prazo. Antes disso a pessoa nao esta devendo nada —
    // esta trabalhando.
    const vencidos = cobranca.faltantes.filter((f) => venceu(f, agoraLocal))
    if (vencidos.length) {
      alertas.push({
        nivel: 'critico', tipo: 'checklist', destino: 'execucoes',
        texto: vencidos.length === 1
          ? `${vencidos[0].nome} nao fez o checklist de hoje (prazo ${vencidos[0].horario_limite}).`
          : `${vencidos.length} colaboradores nao fizeram o checklist de hoje.`,
      })
    }

    const atrasadas = consultar(
      `SELECT s.numero, s.janela_fim, v.placa, u.nome AS solicitante
         FROM solicitacoes s
         JOIN veiculos v ON v.id = s.veiculo_id
         JOIN usuarios u ON u.id = s.solicitante_id
        WHERE s.empresa_id = ? AND s.status = 'em_uso' AND s.janela_fim < ?
        ORDER BY s.janela_fim LIMIT 10`, [empresa, agoraIso])
    for (const s of atrasadas) {
      alertas.push({
        nivel: 'critico', tipo: 'solicitacao', destino: 'solicitacoes',
        texto: `Devolucao atrasada: ${s.placa} com ${s.solicitante} desde ${s.janela_fim.slice(0, 16).replace('T', ' ')}.`,
      })
    }

    const criticas = consultar(
      `SELECT o.id, o.descricao, v.placa FROM ocorrencias o
         JOIN veiculos v ON v.id = o.veiculo_id
        WHERE o.empresa_id = ? AND o.prioridade = 'critica'
          AND o.status IN ('aberta','em_tratamento')
        ORDER BY o.aberta_em DESC LIMIT 10`, [empresa])
    for (const o of criticas) {
      alertas.push({
        nivel: 'critico', tipo: 'ocorrencia', destino: 'ocorrencias',
        texto: `Ocorrencia critica em ${o.placa}: ${o.descricao}`,
      })
    }

    const vencidas = consultar(
      `SELECT p.modo, p.proximo_km, p.proxima_data, v.placa, v.modelo, v.km_atual
         FROM preventivas p JOIN veiculos v ON v.id = p.veiculo_id
        WHERE p.empresa_id = ? AND p.status = 'vencida' ORDER BY v.placa LIMIT 10`, [empresa])
    for (const p of vencidas) {
      alertas.push({
        nivel: 'critico', tipo: 'preventiva', destino: 'preventivas',
        texto: p.modo === 'km'
          ? `Preventiva vencida: ${p.placa} (${p.modelo}) — ${p.km_atual} km, alvo era ${p.proximo_km} km.`
          : `Preventiva vencida: ${p.placa} (${p.modelo}) — venceu em ${p.proxima_data}.`,
      })
    }

    const pendentes = solicitacoes.pendente || 0
    if (pendentes > 0) {
      alertas.push({
        nivel: 'atencao', tipo: 'solicitacao', destino: 'solicitacoes',
        texto: `${pendentes} solicitacao(oes) aguardando aprovacao.`,
      })
    }

    const bloqueados = consultar(
      `SELECT placa, modelo, motivo_status FROM veiculos
        WHERE empresa_id = ? AND status = 'bloqueado' ORDER BY placa LIMIT 10`, [empresa])
    for (const v of bloqueados) {
      alertas.push({
        nivel: 'critico', tipo: 'veiculo', destino: 'veiculos',
        texto: `Veiculo bloqueado: ${v.placa} (${v.modelo})${v.motivo_status ? ' — ' + v.motivo_status : ''}`,
      })
    }

    const semPrimeiroAcesso = usuarios.pendente || 0
    if (semPrimeiroAcesso > 0) {
      alertas.push({
        nivel: 'atencao', tipo: 'usuario', destino: 'usuarios',
        texto: `${semPrimeiroAcesso} usuario(s) ainda nao fizeram o primeiro acesso.`,
      })
    }

    return {
      gerado_em: agoraIso,
      frota: { total: Object.values(frota).reduce((a, b) => a + b, 0), por_status: frota },
      cobranca: {
        exigido: cobranca.exigido,
        cobrados: cobranca.cobrados,
        faltando: cobranca.faltantes.length,
        vencidos: vencidos.length,
      },
      checklists: { hoje: checklistsHoje, veiculos_em_uso: saidasAbertas },
      ocorrencias: {
        abertas: Object.values(ocorrencias).reduce((a, b) => a + b, 0),
        por_prioridade: ocorrencias,
      },
      solicitacoes: {
        por_status: solicitacoes,
        pendentes,
        em_uso: solicitacoes.em_uso || 0,
        atrasadas: devolucoesAtrasadas,
      },
      preventivas: { por_status: preventivas },
      usuarios: { por_status: usuarios, pendentes: semPrimeiroAcesso },
      alertas,
    }
  })
}
