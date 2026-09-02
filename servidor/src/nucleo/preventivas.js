// Motor de alertas de preventiva (secoes 21 e 22).
// Regras deterministicas e explicaveis: dado o mesmo veiculo e a mesma data,
// o resultado e' sempre o mesmo, e a UI consegue dizer POR QUE esta amarelo.
import { consultar, executar, agora } from './banco.js'

export const STATUS_PREVENTIVA = ['em_dia', 'proxima', 'muito_proxima', 'vencida', 'realizada']

const DIA_MS = 24 * 3600 * 1000

// "muito proxima" = dentro da janela de alerta configurada.
// "proxima"       = dentro de tres vezes essa janela — tempo de se organizar.
const FATOR_ATENCAO = 3

export function diasEntre(dataAlvoISO, referencia = new Date()) {
  const alvo = new Date(`${String(dataAlvoISO).slice(0, 10)}T00:00:00Z`).getTime()
  const hoje = new Date(`${referencia.toISOString().slice(0, 10)}T00:00:00Z`).getTime()
  return Math.round((alvo - hoje) / DIA_MS)
}

// Entrada pura: devolve status e a folga restante, sem tocar no banco.
export function avaliarPreventiva(preventiva, kmAtualVeiculo, referencia = new Date()) {
  if (preventiva.modo === 'km') {
    // Sem alvo nao ha vencimento. Testar o valor cru: Number(null) daria 0,
    // e 0 seria lido como "alvo ja atingido".
    if (preventiva.proximo_km === null || preventiva.proximo_km === undefined || preventiva.proximo_km === '') {
      return { status: 'em_dia', restante: null, unidade: 'km' }
    }
    const alvo = Number(preventiva.proximo_km)
    if (!Number.isFinite(alvo)) return { status: 'em_dia', restante: null, unidade: 'km' }
    const restante = alvo - Number(kmAtualVeiculo || 0)
    const janela = Number(preventiva.alerta_antes_km || 0)
    if (restante <= 0) return { status: 'vencida', restante, unidade: 'km' }
    if (restante <= janela) return { status: 'muito_proxima', restante, unidade: 'km' }
    if (restante <= janela * FATOR_ATENCAO) return { status: 'proxima', restante, unidade: 'km' }
    return { status: 'em_dia', restante, unidade: 'km' }
  }

  const alvo = preventiva.proxima_data
  if (!alvo) return { status: 'em_dia', restante: null, unidade: 'dias' }
  const restante = diasEntre(alvo, referencia)
  const janela = Number(preventiva.alerta_antes_dias || 0)
  if (restante <= 0) return { status: 'vencida', restante, unidade: 'dias' }
  if (restante <= janela) return { status: 'muito_proxima', restante, unidade: 'dias' }
  if (restante <= janela * FATOR_ATENCAO) return { status: 'proxima', restante, unidade: 'dias' }
  return { status: 'em_dia', restante, unidade: 'dias' }
}

// Recalcula e grava o status de todas as preventivas abertas de uma empresa.
// "realizada" e' terminal: so sai desse estado quando o ADM agenda a proxima.
export function avaliarPreventivas(empresaId, referencia = new Date()) {
  const linhas = consultar(
    `SELECT p.*, v.km_atual FROM preventivas p
       JOIN veiculos v ON v.id = p.veiculo_id
      WHERE p.empresa_id = ? AND p.status <> 'realizada'`,
    [empresaId],
  )
  let alterados = 0
  for (const linha of linhas) {
    const { status } = avaliarPreventiva(linha, linha.km_atual, referencia)
    if (status !== linha.status) {
      executar('UPDATE preventivas SET status = ?, atualizado_em = ? WHERE id = ?',
        [status, agora(), linha.id])
      alterados += 1
    }
  }
  return alterados
}

export function descreverFolga(avaliacao) {
  if (avaliacao.restante === null) return 'sem alvo definido'
  if (avaliacao.unidade === 'km') {
    return avaliacao.restante <= 0
      ? `${Math.abs(avaliacao.restante)} km alem do alvo`
      : `faltam ${avaliacao.restante} km`
  }
  return avaliacao.restante <= 0
    ? `venceu ha ${Math.abs(avaliacao.restante)} dia(s)`
    : `faltam ${avaliacao.restante} dia(s)`
}
