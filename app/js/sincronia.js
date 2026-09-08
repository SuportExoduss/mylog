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
  // A fila viu um 401. Nao e' erro de rede nem recusa de regra: e' credencial
  // vencida, e o unico jeito de sair disso e' entrar de novo. Sem este aviso a
  // pessoa fica num beco — a fila nao envia porque a sessao morreu, e o "sair"
  // recusa porque ha fila pendente.
  sessaoExpirada: false,
}

// Retentativa com espera crescente.
//
// O envio so era disparado por evento: voltar a ficar online, voltar para a
// aba, abrir o app, ou tocar no botao. No patio, com 4G oscilando, o aparelho
// continua "online" — tem sinal, so nao passa dado —, entao o evento `online`
// nunca chega, e quem fica com o app na frente terminando o dia nunca troca de
// aba. O item ficava parado dizendo "Sera reenviado automaticamente", que era
// uma promessa que o codigo nao cumpria.
//
// A espera cresce para nao gastar bateria insistindo: quinze segundos, meio
// minuto, um, dois, cinco — e para nos cinco.
const ESPERAS = [15_000, 30_000, 60_000, 120_000, 300_000]
let tentativaAtual = 0
let relogioRetentativa = null

function pararRetentativa() {
  clearTimeout(relogioRetentativa)
  relogioRetentativa = null
  tentativaAtual = 0
}

// Nem todo 4xx e' definitivo, e tratar como se fosse APAGA EVIDENCIA.
//
// A fila descartava a foto do aparelho em qualquer resposta 4xx, com a razao
// "recusa por regra nao melhora tentando de novo". A razao esta certa; a
// conta de quais respostas sao recusa por regra, nao estava.
//
//   401  a sessao venceu. A do PWA dura 12 horas: quem termina o dia e
//        sincroniza na manha seguinte cai exatamente aqui. Nao e' recusa —
//        e' credencial vencida, e basta entrar de novo.
//   429  o freio de tentativas. Literalmente um pedido para tentar MAIS TARDE.
//   408  o servidor desistiu de esperar o corpo.
//
// Nos tres, apagar a foto perde para sempre a prova de um checklist que o
// servidor ja aceitou. O roadmap 28 diz "fila que nunca apaga item em
// silencio", e era exatamente isso que acontecia.
//
// O resto do 4xx continua definitivo: imagem que nao e' imagem, inspecao de
// outra pessoa, pergunta que nao existe. Insistir nesses so gastaria bateria e
// espaco.
const NAO_DEFINITIVOS = new Set([401, 408, 425, 429])

export function recusaDefinitiva(status) {
  return status >= 400 && status < 500 && !NAO_DEFINITIVOS.has(status)
}

// A decisao, separada do relogio. Sem fila nao ha o que reenviar; sem rede,
// quem acorda e' o evento `online`, que chega na hora certa e nao gasta nada
// esperando. Separada porque decisao se testa; `setTimeout`, nao.
export function deveRetentar({ pendentes, online }) {
  return Boolean(pendentes) && Boolean(online)
}

// Quanto esperar na enesima tentativa seguida. O desvio de ate 20% existe
// porque quarenta aparelhos voltando juntos quando a torre volta nao podem
// bater no servidor no mesmo segundo.
export function proximaEspera(tentativa, sorteio = Math.random) {
  const base = ESPERAS[Math.min(tentativa, ESPERAS.length - 1)]
  return base + sorteio() * base * 0.2
}

function agendarRetentativa() {
  clearTimeout(relogioRetentativa)
  if (!deveRetentar({ pendentes: estado.pendentes, online: navigator.onLine })) {
    relogioRetentativa = null
    return
  }
  const espera = proximaEspera(tentativaAtual)
  tentativaAtual += 1
  relogioRetentativa = setTimeout(() => { relogioRetentativa = null; sincronizar() }, espera)
}

async function recontar() {
  const pendentes = await fila.pendentes()
  estado.pendentes = pendentes.length
  avisar()
  return pendentes
}

export async function iniciar() {
  // Todo evento zera a espera antes de tentar: a rede acabou de mudar de
  // estado, entao a tentativa de agora nao herda o castigo da anterior.
  addEventListener('online', () => {
    estado.online = true; avisar(); pararRetentativa(); sincronizar()
  })
  addEventListener('offline', () => {
    estado.online = false; avisar()
    // Sem rede nao adianta relogio: quem acorda e' o evento `online`.
    clearTimeout(relogioRetentativa)
    relogioRetentativa = null
  })
  // Voltar para a aba e' o momento mais provavel de ter recuperado sinal.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { pararRetentativa(); sincronizar() }
  })
  await recontar()
  sincronizar()
}

function blobParaBase64(blob) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () => resolve(String(leitor.result).split(',')[1])
    leitor.onerror = () => reject(leitor.error)
    leitor.readAsDataURL(blob)
  })
}

// Devolve duas contas: quantas ficaram para tras, e quantas o servidor RECUSOU.
//
// A segunda faltava, e a falta era pior que a perda. Uma foto recusada em
// definitivo — imagem acima do limite, arquivo que nao e' imagem — era apagada
// do aparelho e nao entrava em conta nenhuma: `restantes` continuava zero, a
// inspecao era marcada como `enviada` com `erro: null`, e o motorista via um
// checklist completo. A foto simplesmente deixava de existir, no aparelho e no
// servidor, sem uma linha dizendo isso.
//
// O roadmap 28 diz "fila que nunca apaga item em silencio". Esta era a segunda
// porta do mesmo silencio: a D54 fechou a de erro passageiro, e esta e' a de
// recusa definitiva.
async function enviarFotos(clienteUuid, inspecaoId) {
  if (!inspecaoId) return { restantes: 0, recusadas: [] }
  const pendentes = await fotos.daInspecao(clienteUuid)
  let restantes = 0
  const recusadas = []

  for (const foto of pendentes) {
    try {
      const resposta = await fetch(`/api/inspecoes/${inspecaoId}/evidencias`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          cliente_id: foto.id,
          pergunta_id: foto.pergunta_id,
          tipo_mime: foto.blob.type || 'image/jpeg',
          capturado_em: foto.capturado_em,
          conteudo: await blobParaBase64(foto.blob),
        }),
      })
      if (resposta.ok) {
        // Confirmada no servidor: sai da cota do aparelho.
        await fotos.remover(foto.id)
      } else if (recusaDefinitiva(resposta.status)) {
        // Recusa por regra nao melhora tentando de novo; a foto so ocuparia
        // espaco para sempre. Sessao vencida e freio NAO entram aqui.
        //
        // Mas antes de apagar, ANOTA: quem executou o checklist precisa saber
        // que aquela foto nao entrou, e por que.
        const dados = await resposta.json().catch(() => ({}))
        recusadas.push({
          pergunta_id: foto.pergunta_id,
          motivo: dados.mensagem || `O servidor recusou a foto (${resposta.status}).`,
        })
        await fotos.remover(foto.id)
      } else {
        if (resposta.status === 401) { estado.sessaoExpirada = true; avisar() }
        restantes += 1
      }
    } catch {
      restantes += 1
    }
  }
  return { restantes, recusadas }
}

async function enviarUma(item) {
  const resposta = await fetch('/api/inspecoes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      cliente_uuid: item.cliente_uuid,
      // Um dos dois identifica o carro: solicitacao (pedido liberado) ou
      // veiculo direto (checklist diario avulso, roadmap 8.2).
      solicitacao_id: item.solicitacao_id || null,
      veiculo_id: item.veiculo_id || null,
      // Preventiva: o retorno encerra a manutencao e agenda a proxima, entao
      // as duas coisas viajam juntas na fila offline (roadmap 14.2.3).
      preventiva_id: item.preventiva_id || null,
      proxima_preventiva: item.proxima_preventiva || null,
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
    // Passou: a sessao esta viva de novo.
    estado.sessaoExpirada = false
    const inspecaoId = dados.inspecao?.id
    // As fotos sobem DEPOIS, uma a uma. Se alguma falhar, a inspecao ja esta
    // gravada e a foto continua no aparelho para a proxima tentativa — nunca
    // se perde evidencia por causa de um upload interrompido.
    const { restantes, recusadas } = await enviarFotos(item.cliente_uuid, inspecaoId)

    // A foto recusada nao impede a inspecao de ficar `enviada` — ela ESTA no
    // servidor, e insistir nao muda isso. Mas o aviso vai junto e fica: uma
    // evidencia que nao entrou e' exatamente o que alguem vai procurar meses
    // depois, num sinistro.
    const aviso = [
      restantes ? `${restantes} foto(s) ainda no aparelho.` : null,
      recusadas.length
        ? `${recusadas.length} foto(s) recusada(s): ${recusadas[0].motivo}`
        : null,
    ].filter(Boolean).join(' ')

    await fila.marcar(item.cliente_uuid, {
      estado: restantes === 0 ? 'enviada' : 'pendente',
      inspecao_id: inspecaoId,
      resultado_servidor: dados.resumo?.resultado,
      estado_veiculo: dados.resumo?.estado_veiculo_previsto,
      fotos_pendentes: restantes,
      fotos_recusadas: recusadas,
      erro: aviso || null,
    })
    return { ok: true, dados }
  }

  // Recusa por regra nao adianta repetir. Fica marcada como "recusada" para o
  // motorista ver o motivo — nunca some em silencio.
  //
  // Sessao vencida e freio ficam de fora: marcar o checklist do dia como
  // "recusada" porque a credencial expirou de madrugada mostraria ao motorista
  // uma reprovacao que nunca existiu, e pararia de tentar.
  if (recusaDefinitiva(resposta.status)) {
    await fila.marcar(item.cliente_uuid, {
      estado: 'recusada',
      erro: dados.mensagem || 'O servidor recusou esta inspecao.',
    })
    return { ok: false, permanente: true, mensagem: dados.mensagem }
  }

  if (resposta.status === 401) { estado.sessaoExpirada = true; avisar() }

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
        // Ja aceita pelo servidor: falta so terminar de subir as fotos.
        if (item.inspecao_id) {
          const { restantes, recusadas } = await enviarFotos(item.cliente_uuid, item.inspecao_id)
          // Mesmo aviso do primeiro envio: a foto recusada nao pode sumir sem
          // deixar recado, seja no envio inicial ou na retentativa.
          const aviso = [
            restantes ? `${restantes} foto(s) ainda no aparelho.` : null,
            recusadas.length
              ? `${recusadas.length} foto(s) recusada(s): ${recusadas[0].motivo}`
              : null,
          ].filter(Boolean).join(' ')
          await fila.marcar(item.cliente_uuid, {
            estado: restantes === 0 ? 'enviada' : 'pendente',
            fotos_pendentes: restantes,
            fotos_recusadas: [...(item.fotos_recusadas || []), ...recusadas],
            erro: aviso || null,
          })
          if (restantes === 0) enviadas += 1
          continue
        }
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
    // Fila vazia zera a contagem: a proxima falha comeca de novo nos quinze
    // segundos, e nao nos cinco minutos que sobraram da ultima vez.
    if (estado.pendentes) agendarRetentativa()
    else pararRetentativa()
  }
  return { enviadas }
}

// Puxa as fotos de exemplo das perguntas para o cache do service worker.
//
// A API.md manda o cliente fazer isto — "baixe e guarde no aparelho: o
// checklist precisa abrir sem sinal" — e o cliente de referencia nao fazia. A
// foto so era pedida quando a pergunta aparecia na tela, e a pergunta aparece
// no patio, que e' onde nao ha sinal. A imagem quebrava justamente no momento
// para o qual ela existe.
//
// Basta pedir: o service worker guarda toda resposta boa que passa por ele.
// Falha de uma nao atrapalha as outras nem o contexto, que ja esta salvo.
async function baixarFotosDeExemplo(modelos = []) {
  const urls = new Set()
  for (const modelo of modelos) {
    for (const pergunta of modelo?.estrutura?.perguntas || []) {
      if (pergunta.foto_exibicao) urls.add(pergunta.foto_exibicao)
    }
  }
  for (const url of urls) {
    try { await fetch(url, { credentials: 'same-origin' }) } catch { /* fica para a proxima */ }
  }
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
    // Sem esperar: a tela nao pode ficar parada por causa de imagem de
    // exemplo, e a falha de uma nao pode derrubar o contexto que ja chegou.
    baixarFotosDeExemplo(dados.modelos)
    return { dados, doCache: false }
  } catch {
    const guardado = await contexto.ler()
    if (!guardado) return { erro: 'sem_contexto' }
    return { dados: guardado, doCache: true }
  }
}
