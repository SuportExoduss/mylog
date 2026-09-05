// Encerrar uma preventiva e agendar a proxima (roadmap 14.1 e 14.2.3).
//
// Existe como modulo proprio porque duas portas levam ao mesmo lugar: o botao
// "Concluir e agendar proxima" no painel, e o checklist de preventiva
// finalizado no aparelho. Se cada porta tivesse a sua copia, um dia elas
// divergiriam — e a divergencia aqui e' uma frota sem agenda de manutencao.
import { consultarUm, executar, novoId, agora } from './banco.js'

// Fecha o ciclo atual e abre o proximo, num ato so. Recebe o alvo ja validado.
// NAO abre transacao: quem chama decide o escopo, porque o checklist grava a
// inspecao junto e as duas coisas precisam cair ou passar juntas.
export function encerrarCiclo({
  atual, empresaId, atorId, kmRealizado, dataRealizada, servico, proximo, alertas = {},
}) {
  const ts = agora()
  const idProxima = novoId('preventiva')
  const km = Math.trunc(Number(kmRealizado))

  executar(
    `UPDATE preventivas SET status = 'realizada', concluida_por = ?, concluida_em = ?,
            ultimo_servico_km = ?, ultimo_servico_data = ?, observacoes = ?, atualizado_em = ?
      WHERE id = ? AND empresa_id = ?`,
    [atorId, ts, km, dataRealizada, servico, ts, atual.id, empresaId],
  )

  // A execucao da manutencao tambem e' leitura de hodometro.
  if (km > Number(atual.km_atual ?? 0)) {
    executar('UPDATE veiculos SET km_atual = ?, atualizado_em = ? WHERE id = ?',
      [km, ts, atual.veiculo_id])
  }

  executar(
    `INSERT INTO preventivas (id, empresa_id, veiculo_id, modo, ultimo_servico_km,
                              ultimo_servico_data, proximo_km, proxima_data,
                              alerta_antes_km, alerta_antes_dias, template_id,
                              status, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'em_dia', ?, ?)`,
    [idProxima, empresaId, atual.veiculo_id, proximo.modo, km, dataRealizada,
     proximo.proximo_km, proximo.proxima_data,
     Number(alertas.km ?? atual.alerta_antes_km ?? 500),
     Number(alertas.dias ?? atual.alerta_antes_dias ?? 7),
     // O modelo acompanha o ciclo: quem faz preventiva por checklist continua
     // fazendo no proximo, sem ninguem reconfigurar.
     atual.template_id ?? null, ts, ts],
  )

  return { idProxima }
}

export function preventivaDoVeiculo(empresaId, veiculoId) {
  return consultarUm(
    `SELECT p.*, v.km_atual, v.placa FROM preventivas p
       JOIN veiculos v ON v.id = p.veiculo_id
      WHERE p.empresa_id = ? AND p.veiculo_id = ? AND p.status <> 'realizada'
      ORDER BY p.criado_em LIMIT 1`,
    [empresaId, veiculoId])
}
