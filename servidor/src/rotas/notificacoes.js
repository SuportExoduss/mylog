// Caixa de entrada do usuario (roadmap 15).
//
// O sino no painel le daqui. Duas perguntas, so: "tem coisa nova?" e "quais
// sao?". Marcar como lida e' a terceira, e e' o unico jeito de o ponto
// vermelho apagar — nao existe expiracao por tempo, porque aviso que some
// sozinho e' aviso que ninguem viu.
import { consultar, consultarUm, executar, agora } from '../nucleo/banco.js'
import { erro } from '../nucleo/http.js'
import { exigirAutenticado } from '../seguranca/sessao.js'

const LIMITE = 50

export function registrarRotasNotificacoes(rotas) {
  rotas.get('/api/notificacoes', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    // Nao lidas primeiro, e dentro de cada grupo a mais recente no topo.
    const notificacoes = consultar(
      `SELECT id, tipo, nivel, texto, destino, entidade_id, lida_em, criado_em
         FROM notificacoes
        WHERE empresa_id = ? AND destinatario_id = ?
        ORDER BY CASE WHEN lida_em IS NULL THEN 0 ELSE 1 END, criado_em DESC
        LIMIT ${LIMITE}`,
      [eu.empresa_id, eu.id])

    const naoLidas = consultarUm(
      `SELECT COUNT(*) AS n FROM notificacoes
        WHERE empresa_id = ? AND destinatario_id = ? AND lida_em IS NULL`,
      [eu.empresa_id, eu.id])?.n ?? 0

    return { notificacoes, nao_lidas: Number(naoLidas), limite: LIMITE }
  })

  // Uma, ou todas. A tela usa as duas: clicar numa notificacao marca aquela;
  // "marcar todas como lidas" limpa o ponto de uma vez.
  rotas.post('/api/notificacoes/lidas', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    const id = String(ctx.corpo.id || '')
    const ts = agora()

    if (id) {
      const alvo = consultarUm(
        'SELECT id FROM notificacoes WHERE id = ? AND empresa_id = ? AND destinatario_id = ?',
        [id, eu.empresa_id, eu.id])
      // Caixa de entrada e' de UMA pessoa: nem a frota marca a do outro como
      // lida. Devolver "nao encontrada" tambem evita descobrir ids alheios.
      if (!alvo) throw erro.naoEncontrado('Notificacao nao encontrada.')
      executar('UPDATE notificacoes SET lida_em = ? WHERE id = ? AND lida_em IS NULL', [ts, id])
    } else {
      executar(
        `UPDATE notificacoes SET lida_em = ?
          WHERE empresa_id = ? AND destinatario_id = ? AND lida_em IS NULL`,
        [ts, eu.empresa_id, eu.id])
    }

    const naoLidas = consultarUm(
      `SELECT COUNT(*) AS n FROM notificacoes
        WHERE empresa_id = ? AND destinatario_id = ? AND lida_em IS NULL`,
      [eu.empresa_id, eu.id])?.n ?? 0
    return { ok: true, nao_lidas: Number(naoLidas) }
  })
}
