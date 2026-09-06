// Notificacoes (roadmap 15).
//
// Aviso dirigido a UMA pessoa, criado no momento do fato. Nao existe varredura
// procurando o que avisar: quem sabe que um pedido chegou e' a rota que o
// criou, e e' la que a notificacao nasce.
//
// Nao confundir com eventos_auditoria: aquilo e' o historico de tudo que
// aconteceu, imutavel, para conferencia. Isto e' caixa de entrada — some da
// lista assim que a pessoa le, e ninguem presta contas com base nela.
import { consultar, executar, novoId, agora } from './banco.js'

export const NIVEIS = ['informativo', 'atencao', 'critico']

// Nunca notifica quem causou o fato. Receber aviso da propria acao e' ruido, e
// ruido ensina a ignorar o sino — que e' o pior estrago que uma notificacao
// pode fazer.
export function notificar({
  empresaId, destinatarios, tipo, nivel = 'informativo', texto, destino, entidadeId, exceto,
}) {
  const alvos = [...new Set((destinatarios || []).filter(Boolean))]
    .filter((id) => id !== exceto)
  if (!alvos.length) return 0

  const ts = agora()
  for (const destinatario of alvos) {
    executar(
      `INSERT INTO notificacoes (id, empresa_id, destinatario_id, tipo, nivel, texto,
                                 destino, entidade_id, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [novoId('notificacao'), empresaId, destinatario, tipo,
       NIVEIS.includes(nivel) ? nivel : 'informativo',
       texto, destino || null, entidadeId || null, ts],
    )
  }
  return alvos.length
}

// A equipe da frota inteira. E' o destinatario de quase tudo que acontece na
// operacao: pedido novo, ocorrencia critica, preventiva vencida.
export function equipeDaFrota(empresaId) {
  return consultar(
    `SELECT id FROM usuarios
      WHERE empresa_id = ? AND acessa_painel = 1 AND status = 'ativo'`,
    [empresaId]).map((u) => u.id)
}

export function notificarFrota(dados) {
  return notificar({ ...dados, destinatarios: equipeDaFrota(dados.empresaId) })
}
