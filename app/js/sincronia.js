// Sincronizacao da fila offline (secao 28).
//
// Desenho deliberado: quem finaliza um checklist NUNCA espera a rede. A
// inspecao vai para a fila local e a tela ja segue. O envio acontece depois,
// sozinho, e pode falhar quantas vezes precisar.

import { fila, contexto, fotos } from './armazem.js'

const ouvintes = new Set()
let enviando = false

export function aoMudar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn) }
function avisar() { for (const fn of ouvintes) fn() }

export const estado = {
  online: navigator.onLine,
  enviando: false,
  pendentes: 0,
  ultimoErro: null,
}

async function recontar() {
  const pendentes = await fila.pendentes()
  estado.pendentes = pendentes.length
  avisar()
  return pendentes
}

export async function iniciar() {
  addEventListener('online', () => { estado.online = true; avisar(); sincronizar() })
  addEventListener('offline', () => { estado.online = false; avisar() })
  // Voltar para a aba e' o momento mais provavel de ter recuperado sinal.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sincronizar()
  })
  await recontar()
  sincronizar()
}

async function enviarUma(item) {
  const resposta = await fetch('/api/inspecoes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      cliente_uuid: item.cliente_uuid,
      solicitacao_id: item.solicitacao_id,
      template_id: item.template_id,
      momento: item.momento,
      respostas: item.respostas,
      km_informado: item.km_informado,
      assinatura: item.assinatura,
      iniciada_em: item.iniciada_em,
      finalizada_em: item.finalizada_em,
    }),
  })

  const dados = await resposta.json().catch(() => ({}))

  if (resposta.ok) {
    await fila.marcar(item.cliente_uuid, {
      estado: 'enviada',
      inspecao_id: dados.inspecao?.id,
      resultado_servidor: dados.resumo?.resultado,
      estado_veiculo: dados.resumo?.estado_veiculo_previsto,
      erro: null,
    })
    // Fotos ja enviadas nao precisam ocupar a cota do aparelho.
    for (const foto of await fotos.daInspecao(item.cliente_uuid)) await fotos.remover(foto.id)
    return { ok: true, dados }
  }

  // 4xx nao adianta repetir: o servidor recusou por regra, nao por rede.
  // Fica marcada como "recusada" para o motorista ver o motivo — nunca some
  // em silencio.
  if (resposta.status >= 400 && resposta.status < 500) {
    await fila.marcar(item.cliente_uuid, {
      estado: 'recusada',
      erro: dados.mensagem || 'O servidor recusou esta inspecao.',
    })
    return { ok: false, permanente: true, mensagem: dados.mensagem }
  }

  await fila.marcar(item.cliente_uuid, {
    estado: 'pendente',
    tentativas: (item.tentativas || 0) + 1,
    erro: dados.mensagem || 'Falha temporaria no envio.',
  })
  return { ok: false, permanente: false }
}

export async function sincronizar() {
  if (enviando || !navigator.onLine) return { enviadas: 0 }
  enviando = true
  estado.enviando = true
  estado.ultimoErro = null
  avisar()

  let enviadas = 0
  try {
    const pendentes = (await fila.pendentes()).filter((i) => i.estado === 'pendente')
    for (const item of pendentes) {
      try {
        const r = await enviarUma(item)
        if (r.ok) enviadas += 1
        // Falha de rede no meio da fila: para e tenta tudo de novo depois.
        if (!r.ok && !r.permanente) break
      } catch (falha) {
        // Queda de rede no meio da fila: registra o motivo no proprio item
        // para a tela da fila explicar a espera, e para a proxima tentativa.
        estado.ultimoErro = falha.message
        await fila.marcar(item.cliente_uuid, {
          estado: 'pendente',
          tentativas: (item.tentativas || 0) + 1,
          erro: 'Sem conexao com o servidor. Sera reenviado automaticamente.',
        })
        break
      }
    }
  } finally {
    enviando = false
    estado.enviando = false
    await recontar()
  }
  return { enviadas }
}

// Baixa o contexto do dia e guarda. Se nao houver rede, devolve o que ja tem
// no armazem — e' o que permite abrir o app no patio sem sinal.
export async function atualizarContexto() {
  try {
    const resposta = await fetch('/api/app/inicio', { credentials: 'same-origin' })
    if (resposta.status === 401) return { erro: 'sessao' }
    if (!resposta.ok) throw new Error('falha')
    const dados = await resposta.json()
    await contexto.guardar({ ...dados, baixado_em: new Date().toISOString() })
    return { dados, doCache: false }
  } catch {
    const guardado = await contexto.ler()
    if (!guardado) return { erro: 'sem_contexto' }
    return { dados: guardado, doCache: true }
  }
}
