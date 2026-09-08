// Envio ao vivo (roadmap 19, reescrito).
//
// O MyLog teve uma fila offline: o checklist terminava no aparelho, ficava
// guardado no IndexedDB e subia sozinho depois. Ela saiu por decisao de
// produto — a internet e' necessaria para operar, e o mesmo contrato vale para
// o Android nativo (D58).
//
// O que isso muda no desenho: o `Finalizar` agora e' uma chamada de rede como
// qualquer outra, e ela pode falhar. A regra que sobra da era offline, e que
// continua valendo, e' a mais importante das duas: FALHAR NAO PODE PERDER O
// TRABALHO. Quem respondeu quarenta perguntas com foto no patio nao refaz.
// Por isso o envio devolve o motivo em vez de estourar, e quem chamou mantem
// a inspecao inteira na mao para tentar de novo.
//
// Reenviar e' seguro: a inspecao tem `cliente_uuid` e a evidencia tem
// `cliente_id`, e o servidor devolve o registro que ja existe em vez de
// duplicar. Isso vale mesmo quando a resposta se perdeu no caminho de volta.

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID()
  return 'ins-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

// Estes tres codigos nao sao "a foto e' invalida": sao "tente de novo".
// Insistir neles resolve; insistir nos outros nao.
const PASSAGEIROS = new Set([401, 408, 425, 429, 500, 502, 503, 504])

export function recusaDefinitiva(status) {
  return status >= 400 && !PASSAGEIROS.has(status)
}

function blobParaBase64(blob) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () => resolve(String(leitor.result).split(',')[1])
    leitor.onerror = () => reject(leitor.error)
    leitor.readAsDataURL(blob)
  })
}

// O contexto do aplicativo: quem sou eu, o que tenho para fazer, com que
// modelo. Sem cache — sem rede nao ha tela.
export async function baixarContexto() {
  const resposta = await fetch('/api/app/inicio', { credentials: 'same-origin' })
  if (resposta.status === 401) return { erro: 'sessao' }
  if (!resposta.ok) throw new Error('falha')
  return { dados: await resposta.json() }
}

// Sobe as fotos uma a uma, DEPOIS da inspecao.
//
// Uma a uma de proposito: a inspecao ja esta gravada, e uma foto que falha nao
// derruba as outras nem o checklist. As que falharam voltam na lista para
// serem tentadas de novo; as que o servidor RECUSOU voltam com o motivo — uma
// evidencia que nao entrou e' exatamente o que alguem procura meses depois,
// num sinistro, e ela nunca pode sumir em silencio.
async function enviarFotos(inspecaoId, acervo) {
  const restantes = []
  const recusadas = []

  for (const foto of acervo) {
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
      if (resposta.ok) continue
      if (recusaDefinitiva(resposta.status)) {
        const dados = await resposta.json().catch(() => ({}))
        recusadas.push({
          pergunta_id: foto.pergunta_id,
          motivo: dados.mensagem || `O servidor recusou a foto (${resposta.status}).`,
        })
      } else {
        restantes.push(foto)
      }
    } catch {
      restantes.push(foto)
    }
  }
  return { restantes, recusadas }
}

// Envia a inspecao e as fotos dela. Nunca estoura: devolve o que aconteceu.
//
// `{ ok: true, inspecao, restantes, recusadas }` — a inspecao esta gravada.
//   `restantes` sao fotos que nao subiram e continuam na mao de quem chamou.
// `{ ok: false, sessao, motivo }` — nada foi gravado, da para tentar de novo.
export async function enviarInspecao(inspecao) {
  const acervo = inspecao.fotos || []
  let resposta
  try {
    resposta = await fetch('/api/inspecoes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        cliente_uuid: inspecao.cliente_uuid,
        // Um dos dois identifica o carro: solicitacao (pedido liberado) ou
        // veiculo direto (checklist diario avulso, roadmap 8.2).
        solicitacao_id: inspecao.solicitacao_id || null,
        veiculo_id: inspecao.veiculo_id || null,
        // Preventiva: o retorno encerra a manutencao e agenda a proxima, entao
        // as duas coisas viajam juntas (roadmap 14.2.3).
        preventiva_id: inspecao.preventiva_id || null,
        proxima_preventiva: inspecao.proxima_preventiva || null,
        template_id: inspecao.template_id,
        momento: inspecao.momento,
        respostas: inspecao.respostas,
        km_informado: inspecao.km_informado,
        assinatura: inspecao.assinatura,
        iniciada_em: inspecao.iniciada_em,
        finalizada_em: inspecao.finalizada_em,
      }),
    })
  } catch {
    return { ok: false, motivo: 'Sem conexao com o servidor.' }
  }

  const dados = await resposta.json().catch(() => ({}))

  if (!resposta.ok) {
    if (resposta.status === 401) {
      return { ok: false, sessao: true, motivo: 'Sua sessao expirou.' }
    }
    return { ok: false, motivo: dados.mensagem || 'O servidor recusou o checklist.' }
  }

  const { restantes, recusadas } = await enviarFotos(dados.inspecao?.id, acervo)
  return { ok: true, inspecao: dados.inspecao, restantes, recusadas }
}
