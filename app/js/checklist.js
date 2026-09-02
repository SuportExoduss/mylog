// Execucao do checklist (secoes 10, 11, 12 e 27).
//
// Usa o MESMO motor do servidor, servido de /compartilhado/template.js. O
// resumo que o motorista ve antes de finalizar e' calculado com a mesma funcao
// que o servidor vai usar para julgar — entao nao existe a surpresa de
// aprovar no celular e reprovar na sincronizacao.
import {
  itensAplicaveis, avaliarResposta, resumirInspecao,
} from '/compartilhado/template.js'
import { fotos as depositoFotos, uuid } from './armazem.js'

export function elemento(tag, atributos = {}, filhos = []) {
  const el = document.createElement(tag)
  for (const [chave, valor] of Object.entries(atributos)) {
    if (valor === null || valor === undefined || valor === false) continue
    if (chave === 'classe') el.className = valor
    else if (chave === 'texto') el.textContent = valor
    else if (chave.startsWith('ao')) el.addEventListener(chave.slice(2).toLowerCase(), valor)
    else el.setAttribute(chave, valor)
  }
  for (const filho of [].concat(filhos)) {
    if (filho === null || filho === undefined || filho === false) continue
    el.append(typeof filho === 'string' ? document.createTextNode(filho) : filho)
  }
  return el
}

// Painel de assinatura. Vive aqui porque a assinatura e' um TIPO DE ITEM do
// template (secao 11) — quem decide se a inspecao exige assinatura e' o ADM ao
// montar o checklist, nao o codigo do aplicativo.
export function painelAssinatura({ valorInicial = null, aoAssinar }) {
  const tela = elemento('canvas', {
    classe: 'assinatura-tela' + (valorInicial ? ' assinatura-tela--assinada' : ''),
    width: 520, height: 180,
  })
  const ctx = tela.getContext('2d')
  let desenhando = false
  let assinou = Boolean(valorInicial)

  function ponto(evento) {
    const caixa = tela.getBoundingClientRect()
    return {
      x: (evento.clientX - caixa.left) * (tela.width / caixa.width),
      y: (evento.clientY - caixa.top) * (tela.height / caixa.height),
    }
  }

  tela.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    tela.setPointerCapture(e.pointerId)
    desenhando = true
    const p = ponto(e)
    ctx.beginPath(); ctx.moveTo(p.x, p.y)
  })
  tela.addEventListener('pointermove', (e) => {
    if (!desenhando) return
    e.preventDefault()
    const p = ponto(e)
    ctx.lineTo(p.x, p.y); ctx.stroke()
    if (!assinou) { assinou = true; tela.classList.add('assinatura-tela--assinada') }
  })
  const parar = () => {
    if (!desenhando) return
    desenhando = false
    if (assinou) aoAssinar(tela.toDataURL('image/png'))
  }
  tela.addEventListener('pointerup', parar)
  tela.addEventListener('pointercancel', parar)
  tela.addEventListener('pointerleave', parar)

  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = getComputedStyle(document.body).color

  if (valorInicial) {
    const img = new Image()
    img.onload = () => ctx.drawImage(img, 0, 0, tela.width, tela.height)
    img.src = valorInicial
  }

  return elemento('div', {}, [
    tela,
    elemento('div', { classe: 'linha esp-t-1' }, [
      elemento('button', {
        classe: 'botao botao--suave botao--mini', type: 'button', texto: 'Limpar',
        aoClick: () => {
          ctx.clearRect(0, 0, tela.width, tela.height)
          assinou = false
          tela.classList.remove('assinatura-tela--assinada')
          aoAssinar(null)
        },
      }),
      elemento('span', { classe: 'campo-dica', texto: 'Assine com o dedo ou a caneta.' }),
    ]),
  ])
}

const OPCOES_PADRAO = {
  ok_nok: [
    { valor: 'ok', rotulo: 'OK', tom: 'ok' },
    { valor: 'nok', rotulo: 'Nao OK', tom: 'nok' },
  ],
  sim_nao: [
    { valor: 'sim', rotulo: 'Sim' },
    { valor: 'nao', rotulo: 'Nao' },
  ],
}

// Desenha um item e devolve o elemento. `aoResponder` avisa a tela para
// recalcular — itens condicionais podem aparecer ou sumir a cada resposta.
function desenharItem(item, respostas, aoResponder) {
  const resposta = respostas[item.id]
  const valorAtual = resposta && typeof resposta === 'object' ? resposta.valor : resposta
  const juizo = valorAtual === undefined || valorAtual === '' ? null : avaliarResposta(item, valorAtual)

  const corpo = elemento('div', {
    classe: `item${juizo?.conforme === true ? ' item--ok' : ''}${juizo?.conforme === false ? ' item--nok' : ''}`,
  }, [
    elemento('div', { classe: 'item-secao', texto: item.secao_titulo }),
    elemento('div', { classe: 'item-pergunta', texto: item.rotulo }),
  ])

  function responder(valor, extras = {}) {
    const anterior = respostas[item.id]
    respostas[item.id] = {
      ...(typeof anterior === 'object' ? anterior : {}),
      valor,
      ...extras,
    }
    aoResponder()
  }

  // ---- escolhas (ok_nok, sim_nao, selecao)
  if (item.tipo === 'ok_nok' || item.tipo === 'sim_nao' || item.tipo === 'selecao') {
    const opcoes = item.tipo === 'selecao'
      ? item.opcoes.map((o) => ({
          valor: o.valor,
          rotulo: o.rotulo || o.valor,
          tom: o.conforme === false ? 'nok' : 'ok',
        }))
      : OPCOES_PADRAO[item.tipo].map((o) => {
          if (item.tipo !== 'sim_nao') return o
          const conforme = o.valor === (item.valor_conforme || 'sim')
          return { ...o, tom: conforme ? 'ok' : 'nok' }
        })

    corpo.append(elemento('div', {
      classe: opcoes.length > 2 ? 'escolhas escolhas--coluna' : 'escolhas',
    }, opcoes.map((o) => elemento('button', {
      type: 'button',
      classe: 'escolha' + (valorAtual === o.valor
        ? ` escolha--marcada-${o.tom || 'neutra'}` : ''),
      texto: o.rotulo,
      aoClick: () => responder(o.valor),
    }))))
  }

  // ---- numero
  if (item.tipo === 'numero') {
    const entrada = elemento('input', {
      type: 'number', inputmode: 'decimal', classe: '',
      placeholder: item.unidade ? `Valor em ${item.unidade}` : 'Valor',
    })
    entrada.value = valorAtual ?? ''
    entrada.addEventListener('change', () => responder(entrada.value))
    const envolucro = elemento('div', { classe: 'campo' }, [entrada])
    if (item.minimo != null || item.maximo != null) {
      envolucro.append(elemento('div', {
        classe: 'campo-dica',
        texto: `Aceito entre ${item.minimo ?? '—'} e ${item.maximo ?? '—'} ${item.unidade || ''}`.trim(),
      }))
    }
    corpo.append(envolucro)
  }

  // ---- texto
  if (item.tipo === 'texto') {
    const area = elemento('textarea', { rows: 3, placeholder: 'Descreva' })
    area.value = valorAtual ?? ''
    area.addEventListener('change', () => responder(area.value))
    corpo.append(elemento('div', { classe: 'campo' }, [area]))
  }

  // ---- data / hora
  if (item.tipo === 'datahora') {
    const entrada = elemento('input', { type: 'date' })
    entrada.value = (valorAtual || '').slice(0, 10)
    entrada.addEventListener('change', () => responder(entrada.value))
    corpo.append(elemento('div', { classe: 'campo' }, [entrada]))
  }

  // ---- assinatura
  if (item.tipo === 'assinatura') {
    corpo.append(painelAssinatura({
      valorInicial: valorAtual || null,
      aoAssinar: (dataUrl) => responder(dataUrl || ''),
    }))
  }

  // ---- observacao livre quando nao conforme
  if (juizo?.conforme === false) {
    const obs = elemento('textarea', { rows: 2, placeholder: 'O que voce observou? (opcional)' })
    obs.value = (typeof resposta === 'object' ? resposta.observacao : '') || ''
    obs.addEventListener('change', () => {
      respostas[item.id] = { ...respostas[item.id], observacao: obs.value }
    })
    corpo.append(elemento('div', { classe: 'campo item-extra' }, [obs]))
  }

  // ---- evidencia
  const exigeFoto = item.foto_obrigatoria_se_nok && juizo?.conforme === false
  const temFoto = Boolean(resposta && typeof resposta === 'object' && resposta.tem_evidencia)
  if (item.tipo === 'foto' || exigeFoto || temFoto) {
    corpo.append(areaFoto(item, resposta, exigeFoto, temFoto, responder))
  }

  return corpo
}

function areaFoto(item, resposta, exigeFoto, temFoto, responder) {
  const entrada = elemento('input', {
    type: 'file', accept: 'image/*', capture: 'environment', classe: 'oculto',
  })
  const area = elemento('label', {
    classe: 'foto-area' + (temFoto ? ' foto-area--pronta' : (exigeFoto ? ' foto-area--exigida' : '')),
  }, [entrada])

  if (temFoto && resposta.foto_url) {
    area.append(elemento('img', { classe: 'foto-miniatura', src: resposta.foto_url, alt: '' }))
  }
  area.append(elemento('div', {
    classe: 'foto-texto',
    texto: temFoto
      ? 'Foto anexada. Toque para trocar.'
      : (exigeFoto
          ? 'Foto obrigatoria para este item. Toque para fotografar.'
          : 'Toque para fotografar.'),
  }))

  entrada.addEventListener('change', async () => {
    const arquivo = entrada.files?.[0]
    if (!arquivo) return
    const comprimida = await comprimir(arquivo)
    const id = uuid()
    // A foto vai para o deposito separado, com o contexto que a torna prova:
    // quem, qual veiculo, qual item, quando (secao 15).
    await depositoFotos.guardar({
      id,
      cliente_uuid: item.__cliente_uuid,
      item_id: item.id,
      blob: comprimida,
      capturado_em: new Date().toISOString(),
    })
    responder(
      resposta && typeof resposta === 'object' ? resposta.valor : resposta,
      { tem_evidencia: true, foto_id: id, foto_url: URL.createObjectURL(comprimida) },
    )
  })

  return area
}

// Comprime antes de guardar: uma foto de celular moderno tem 4-8 MB e a cota do
// navegador nao aguenta um dia de checklist assim.
async function comprimir(arquivo, ladoMaximo = 1600, qualidade = .75) {
  try {
    const bitmap = await createImageBitmap(arquivo)
    const escala = Math.min(1, ladoMaximo / Math.max(bitmap.width, bitmap.height))
    const largura = Math.round(bitmap.width * escala)
    const altura = Math.round(bitmap.height * escala)
    const tela = new OffscreenCanvas(largura, altura)
    tela.getContext('2d').drawImage(bitmap, 0, 0, largura, altura)
    return await tela.convertToBlob({ type: 'image/jpeg', quality: qualidade })
  } catch {
    return arquivo   // navegador sem OffscreenCanvas: guarda o original
  }
}

// ------------------------------------------------------------- tela

export function desenharChecklist({ estrutura, respostas, clienteUuid, aoMudar }) {
  const area = elemento('div', {})

  function redesenhar() {
    const aplicaveis = itensAplicaveis(estrutura, respostas)
    const respondidos = aplicaveis.filter((i) => {
      const r = respostas[i.id]
      const v = r && typeof r === 'object' ? r.valor : r
      return v !== undefined && v !== null && v !== ''
    }).length

    const cabecalho = elemento('div', {}, [
      elemento('div', { classe: 'progresso-texto' }, [
        elemento('span', { texto: `${respondidos} de ${aplicaveis.length} itens` }),
        elemento('span', {
          texto: `${Math.round((respondidos / Math.max(aplicaveis.length, 1)) * 100)}%`,
        }),
      ]),
      elemento('div', { classe: 'progresso' }, [
        elemento('div', {
          classe: 'progresso-barra',
          style: `width:${(respondidos / Math.max(aplicaveis.length, 1)) * 100}%`,
        }),
      ]),
    ])

    area.replaceChildren(cabecalho, ...aplicaveis.map((item) =>
      desenharItem({ ...item, __cliente_uuid: clienteUuid }, respostas, () => {
        redesenhar()
        aoMudar()
      })))
  }

  redesenhar()
  return { area, redesenhar }
}

export { resumirInspecao }
