// Execucao do checklist no aplicativo de campo (roadmap 11.4).
//
// A tela e' deliberadamente estreita: uma pergunta por vez, foto de exemplo no
// meio, e dois botoes embaixo — OCORRENCIA em vermelho a esquerda, OK em verde
// a direita. Quem preenche isso esta de pe no patio, com pressa e as vezes de
// luva; cada toque a mais e' um checklist que nao vai ser feito direito.
import { fotos, uuid } from './armazem.js'
import { avaliarInspecao, avaliarResposta } from '../../compartilhado/template.js'

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

// --------------------------------------------------------------- camera

// Uma foto de 12 MP ocupa ~4 MB. Dez perguntas com quatro fotos encheriam a
// cota do navegador antes do fim do dia — e a fila de fotos e' o risco real
// do offline. Reduz para 1280px antes de guardar.
const LADO_MAXIMO = 1280
const QUALIDADE = 0.72

async function comprimir(arquivo) {
  try {
    const bitmap = await createImageBitmap(arquivo)
    const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height))
    const largura = Math.round(bitmap.width * escala)
    const altura = Math.round(bitmap.height * escala)
    const tela = new OffscreenCanvas(largura, altura)
    tela.getContext('2d').drawImage(bitmap, 0, 0, largura, altura)
    bitmap.close()
    return await tela.convertToBlob({ type: 'image/jpeg', quality: QUALIDADE })
  } catch {
    // Navegador sem OffscreenCanvas: guarda o original em vez de perder a foto.
    return arquivo
  }
}

// Abre a camera do aparelho. `capture` faz o Android ir direto para a camera
// traseira em vez de abrir a galeria.
//
// NUNCA depender so do evento da camera: se o seletor nao abrir, se o aparelho
// nao tiver camera, ou se a pessoa cancelar, o "change" simplesmente nao vem —
// e o motorista fica preso na tela sem saida. Por isso quem chama sempre tem
// uma folha visivel com alternativa, e esta funcao apenas avisa quando (e se)
// um arquivo chegar.
function pedirFoto({ daGaleria = false } = {}) {
  return new Promise((resolve) => {
    const entrada = elemento('input', { type: 'file', accept: 'image/*', hidden: true })
    if (!daGaleria) entrada.setAttribute('capture', 'environment')
    entrada.addEventListener('change', () => {
      const arquivo = entrada.files?.[0] || null
      entrada.remove()
      resolve(arquivo)
    })
    document.body.append(entrada)
    entrada.click()
  })
}

// --------------------------------------------------------------- assinatura

export function painelAssinatura({ aoAssinar }) {
  const tela = elemento('canvas', { classe: 'assinatura', width: 600, height: 220 })
  const ctx = tela.getContext('2d')
  let desenhando = false
  let temTraco = false

  function posicao(evento) {
    const r = tela.getBoundingClientRect()
    const p = evento.touches?.[0] || evento
    return { x: (p.clientX - r.left) * (tela.width / r.width), y: (p.clientY - r.top) * (tela.height / r.height) }
  }
  function comecar(e) { e.preventDefault(); desenhando = true; const { x, y } = posicao(e); ctx.beginPath(); ctx.moveTo(x, y) }
  function mover(e) {
    if (!desenhando) return
    e.preventDefault()
    const { x, y } = posicao(e)
    ctx.lineTo(x, y); ctx.stroke()
    temTraco = true
  }
  function parar() {
    if (!desenhando) return
    desenhando = false
    if (temTraco) aoAssinar(tela.toDataURL('image/png'))
  }

  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.strokeStyle = '#111'
  for (const [evento, fn] of [['pointerdown', comecar], ['pointermove', mover],
    ['pointerup', parar], ['pointerleave', parar]]) tela.addEventListener(evento, fn)

  const limpar = elemento('button', {
    classe: 'botao botao--suave', type: 'button', texto: 'Limpar',
    aoClick: () => { ctx.clearRect(0, 0, tela.width, tela.height); temTraco = false; aoAssinar(null) },
  })

  return elemento('div', { classe: 'assinatura-caixa' }, [tela, limpar])
}

// ------------------------------------------------------------- execucao

// tarefa: { solicitacao_id, momento, template_id, veiculo, janela_fim, atrasada }
// modelo: { id, nome, versao, exige_assinatura, estrutura }
export function executarChecklist({ tarefa, modelo, aoConcluir, aoSair }) {
  const clienteUuid = uuid()
  const estrutura = modelo.estrutura
  const perguntas = estrutura.perguntas
  const respostas = {}
  let km = null
  let assinatura = null
  let indice = -1   // -1 = tela de quilometragem

  const raiz = elemento('div', { classe: 'execucao' })

  const momentoRotulo = tarefa.momento === 'saida' ? 'SAIDA' : 'RETORNO'

  // Quantas perguntas ja tem resposta — define ate onde as setas navegam.
  const respondidas = () => perguntas.filter((p) => respostas[p.id]).length

  function cabecalho({ comContagem = true } = {}) {
    return elemento('header', { classe: 'exec-topo' }, [
      elemento('button', {
        classe: 'exec-voltar', type: 'button', 'aria-label': 'Sair do checklist',
        texto: '←', aoClick: confirmarSaida,
      }),
      elemento('div', { classe: 'exec-contexto' }, [
        elemento('div', { classe: 'exec-modelo', texto: `${modelo.nome}: ` }),
        elemento('span', { classe: 'exec-placa dado', texto: tarefa.veiculo.placa }),
        elemento('span', { classe: `exec-momento exec-momento--${tarefa.momento}`, texto: momentoRotulo }),
      ]),
      comContagem ? contagem() : elemento('div', {}),
    ])
  }

  // Setas so navegam entre perguntas JA respondidas — nao da para pular adiante.
  //
  // Excecao no fim: com tudo respondido, a seta direita leva ao resumo. Sem
  // isso, quem volta do resumo para corrigir uma pergunta so consegue voltar
  // respondendo a ultima de novo — e responder de novo so para navegar e' o
  // tipo de atrito que faz o checklist ser preenchido no automatico.
  function contagem() {
    const limite = respondidas()
    const tudoRespondido = limite === perguntas.length
    const podeAvancar = indice < limite && (indice < perguntas.length - 1 || tudoRespondido)

    return elemento('div', { classe: 'exec-contagem' }, [
      elemento('button', {
        classe: 'exec-seta', type: 'button', texto: '‹', 'aria-label': 'Pergunta anterior',
        disabled: indice <= 0,
        aoClick: () => { indice -= 1; desenhar() },
      }),
      elemento('span', { classe: 'exec-passo dado', texto: `pergunta ${indice + 1} / ${perguntas.length}` }),
      elemento('button', {
        classe: 'exec-seta', type: 'button',
        texto: tudoRespondido && indice === perguntas.length - 1 ? '✓' : '›',
        'aria-label': tudoRespondido && indice === perguntas.length - 1 ? 'Ir ao resumo' : 'Proxima pergunta',
        disabled: !podeAvancar,
        aoClick: () => { indice += 1; desenhar() },
      }),
    ])
  }

  function confirmarSaida() {
    raiz.append(folha({
      titulo: 'Sair do checklist?',
      texto: 'As respostas desta execucao serao perdidas. O veiculo continua aguardando o checklist.',
      acoes: [
        { rotulo: 'Continuar preenchendo', suave: true },
        { rotulo: 'Sair e perder', perigo: true, aoClick: aoSair },
      ],
    }))
  }

  // Folha que sobe de baixo: e' onde ficam as tres opcoes depois da foto.
  function folha({ titulo, texto, acoes, filhos = [] }) {
    const fundo = elemento('div', { classe: 'folha-fundo' })
    const fechar = () => fundo.remove()
    fundo.append(elemento('div', { classe: 'folha' }, [
      elemento('h2', { classe: 'folha-titulo', texto: titulo }),
      texto ? elemento('p', { classe: 'folha-texto', texto }) : null,
      ...filhos,
      elemento('div', { classe: 'folha-acoes' }, acoes.map((a) => elemento('button', {
        classe: `botao botao--grande${a.suave ? ' botao--suave' : ''}${a.perigo ? ' botao--perigo' : ''}${a.ok ? ' botao--ok' : ''}`,
        type: 'button',
        texto: a.rotulo,
        aoClick: () => { fechar(); a.aoClick?.() },
      }))),
    ]))
    return fundo
  }

  // --------------------------------------------------- captura de fotos

  async function guardarFoto(arquivo, perguntaId) {
    const comprimida = await comprimir(arquivo)
    const id = `${clienteUuid}:${perguntaId}:${Date.now()}`
    await fotos.guardar({
      id, cliente_uuid: clienteUuid, pergunta_id: perguntaId,
      blob: comprimida, bytes: comprimida.size, capturado_em: new Date().toISOString(),
    })
    return id
  }

  function contarFotos(perguntaId) {
    return (respostas[perguntaId]?.fotos_ids || []).length
  }

  // As tres opcoes depois de cada foto, exatamente como o roadmap descreve.
  // A folha e' desenhada de imediato, antes de a camera responder: se o
  // aparelho nao abrir a camera, ainda ha caminho para frente.
  function aposFoto({ pergunta, maximo, aoTerminar }) {
    const atual = contarFotos(pergunta.id)
    raiz.append(folha({
      titulo: atual ? `Foto ${atual} de ate ${maximo}` : 'Nenhuma foto capturada',
      texto: atual >= maximo
        ? 'Limite de fotos atingido para esta pergunta.'
        : atual ? null : 'A camera nao respondeu ou foi cancelada.',
      acoes: [
        atual ? {
          rotulo: 'Tirar novamente',
          suave: true,
          aoClick: async () => {
            const ids = respostas[pergunta.id].fotos_ids
            const removida = ids.pop()
            if (removida) await fotos.remover(removida)
            capturar({ pergunta, maximo, aoTerminar })
          },
        } : null,
        atual < maximo ? {
          rotulo: atual ? 'Adicionar + foto' : 'Abrir camera',
          suave: Boolean(atual),
          aoClick: () => capturar({ pergunta, maximo, aoTerminar }),
        } : null,
        atual < maximo ? {
          rotulo: 'Escolher da galeria',
          suave: true,
          aoClick: () => capturar({ pergunta, maximo, aoTerminar, daGaleria: true }),
        } : null,
        { rotulo: 'Proximo', ok: true, aoClick: aoTerminar },
      ].filter(Boolean),
    }))
  }

  // Dispara a camera e ja mostra a folha. Quando (e se) a foto chegar, a folha
  // e' redesenhada com a contagem nova.
  function capturar({ pergunta, maximo, aoTerminar, daGaleria = false }) {
    const folhaAtual = () => raiz.querySelector('.folha-fundo')

    pedirFoto({ daGaleria }).then(async (arquivo) => {
      if (!arquivo) return
      const id = await guardarFoto(arquivo, pergunta.id)
      respostas[pergunta.id].fotos_ids.push(id)
      folhaAtual()?.remove()
      aposFoto({ pergunta, maximo, aoTerminar })
    })

    folhaAtual()?.remove()
    aposFoto({ pergunta, maximo, aoTerminar })
  }

  // ----------------------------------------------------------- desfechos

  function avancar() {
    if (indice < perguntas.length - 1) { indice += 1; desenhar() }
    else desenharResumo()
  }

  function marcarOk(pergunta) {
    respostas[pergunta.id] = { desfecho: 'ok', fotos_ids: [], respondido_em: new Date().toISOString() }
    const modo = pergunta.foto_ok || 'opcional'
    const maximo = pergunta.max_fotos_ok ?? 1

    if (modo === 'nao_capturar') return avancar()
    if (modo === 'obrigatorio') return capturar({ pergunta, maximo, aoTerminar: avancar })

    // Opcional: pergunta antes de abrir a camera.
    raiz.append(folha({
      titulo: 'Quer registrar uma foto?',
      texto: 'Esta pergunta nao exige foto, mas ela vira evidencia no relatorio.',
      acoes: [
        { rotulo: 'Abrir camera', aoClick: () => capturar({ pergunta, maximo, aoTerminar: avancar }) },
        { rotulo: 'Escolher da galeria', suave: true,
          aoClick: () => capturar({ pergunta, maximo, aoTerminar: avancar, daGaleria: true }) },
        { rotulo: 'Seguir sem foto', suave: true, aoClick: avancar },
      ],
    }))
  }

  // O roadmap manda abrir a camera ANTES de escolher a opcao de problema.
  // Como a exigencia de foto vive na opcao, conferimos depois da escolha: se a
  // opcao exigia foto e a pessoa cancelou a camera, voltamos a pedir.
  function marcarOcorrencia(pergunta) {
    respostas[pergunta.id] = {
      desfecho: 'ocorrencia', fotos_ids: [], opcao_id: null, relatorio: null,
      respondido_em: new Date().toISOString(),
    }
    const maiorLimite = Math.max(1, ...(pergunta.opcoes_problema || []).map((o) => o.max_fotos ?? 1))
    capturar({ pergunta, maximo: maiorLimite, aoTerminar: () => escolherProblema(pergunta) })
  }

  function escolherProblema(pergunta) {
    const opcoes = pergunta.opcoes_problema || []
    raiz.append(folha({
      titulo: 'O que foi encontrado?',
      texto: pergunta.titulo,
      filhos: [
        elemento('div', { classe: 'opcoes' }, opcoes.map((o) => elemento('button', {
          classe: 'opcao', type: 'button',
          aoClick: () => confirmarProblema(pergunta, o),
        }, [
          elemento('span', { classe: 'opcao-nome', texto: o.nome }),
          o.abrir_ocorrencia
            ? elemento('span', { classe: `opcao-selo selo--${o.prioridade}`, texto: o.prioridade })
            : elemento('span', { classe: 'opcao-selo selo--registro', texto: 'so registra' }),
        ]))),
      ],
      acoes: [
        { rotulo: 'Escrever relatorio', suave: true, aoClick: () => escreverRelatorio(pergunta) },
      ],
    }))
  }

  async function confirmarProblema(pergunta, opcao) {
    respostas[pergunta.id].opcao_id = opcao.id
    respostas[pergunta.id].relatorio = null

    const modo = opcao.foto || 'opcional'
    const maximo = opcao.max_fotos ?? 1
    const jaTem = contarFotos(pergunta.id)

    if (modo === 'obrigatorio' && jaTem === 0) {
      return capturar({ pergunta, maximo, aoTerminar: avancar })
    }
    // Foto a mais que o limite da opcao escolhida: descarta as excedentes em
    // vez de barrar a pessoa por algo que ela nao sabia ao tirar.
    if (jaTem > maximo) {
      const ids = respostas[pergunta.id].fotos_ids
      while (ids.length > maximo) await fotos.remover(ids.pop())
    }
    avancar()
  }

  function escreverRelatorio(pergunta) {
    const area = elemento('textarea', {
      classe: 'relatorio', rows: 5,
      placeholder: 'Descreva o que voce encontrou.',
    })
    const fundo = folha({
      titulo: 'Escrever relatorio',
      texto: 'Use quando nenhuma opcao descrever o que voce viu.',
      filhos: [area],
      acoes: [
        { rotulo: 'Voltar as opcoes', suave: true, aoClick: () => escolherProblema(pergunta) },
        {
          rotulo: 'Confirmar',
          aoClick: () => {
            const texto = area.value.trim()
            if (texto.length < 5) return escreverRelatorio(pergunta)
            respostas[pergunta.id].opcao_id = null
            respostas[pergunta.id].relatorio = texto
            avancar()
          },
        },
      ],
    })
    raiz.append(fundo)
    setTimeout(() => area.focus(), 60)
  }

  // ---------------------------------------------------------- telas

  function desenharKm() {
    const entrada = elemento('input', {
      classe: 'km-entrada dado', type: 'number', inputmode: 'numeric',
      placeholder: String(tarefa.veiculo.km_atual ?? 0),
      value: km ?? '',
    })
    const aviso = elemento('p', { classe: 'exec-aviso oculto' })

    raiz.replaceChildren(
      cabecalho({ comContagem: false }),
      elemento('main', { classe: 'exec-corpo exec-corpo--km' }, [
        elemento('h1', { classe: 'km-titulo', texto: 'Quilometragem do hodometro' }),
        elemento('p', { classe: 'km-sub',
          texto: `${tarefa.veiculo.marca || ''} ${tarefa.veiculo.modelo} · ultima leitura ${(tarefa.veiculo.km_atual ?? 0).toLocaleString('pt-BR')} km`.trim() }),
        entrada,
        aviso,
      ]),
      elemento('footer', { classe: 'exec-rodape exec-rodape--unico' }, [
        elemento('button', {
          classe: 'botao botao--grande botao--ok', type: 'button', texto: 'Comecar checklist',
          aoClick: () => {
            const valor = Number(entrada.value)
            if (!entrada.value || !Number.isFinite(valor) || valor < 0) {
              aviso.textContent = 'Informe a quilometragem que aparece no painel do veiculo.'
              aviso.classList.remove('oculto')
              return
            }
            km = Math.trunc(valor)
            indice = 0
            desenhar()
          },
        }),
      ]),
    )
    setTimeout(() => entrada.focus(), 80)
  }

  function desenharPergunta() {
    const p = perguntas[indice]
    const jaRespondida = Boolean(respostas[p.id])

    const ilustracao = p.foto_exibicao
      ? elemento('img', { classe: 'exec-foto', src: p.foto_exibicao, alt: `Exemplo: ${p.titulo}` })
      : elemento('div', { classe: 'exec-foto exec-foto--vazia', texto: p.titulo })

    raiz.replaceChildren(
      cabecalho(),
      elemento('main', { classe: 'exec-corpo' }, [
        elemento('h1', { classe: 'exec-pergunta', texto: p.titulo }),
        ilustracao,
        jaRespondida
          ? elemento('p', { classe: 'exec-ja-respondida',
              texto: respostas[p.id].desfecho === 'ok'
                ? 'Ja respondida como OK. Responder de novo substitui.'
                : 'Ja respondida como ocorrencia. Responder de novo substitui.' })
          : null,
      ]),
      // Vermelho a esquerda, verde a direita (roadmap 21).
      elemento('footer', { classe: 'exec-rodape' }, [
        elemento('button', {
          classe: 'botao botao--grande botao--ocorrencia', type: 'button',
          texto: 'OCORRENCIA', aoClick: () => marcarOcorrencia(p),
        }),
        elemento('button', {
          classe: 'botao botao--grande botao--ok', type: 'button',
          texto: 'OK', aoClick: () => marcarOk(p),
        }),
      ]),
    )
  }

  function desenharResumo() {
    const juizo = avaliarInspecao(estrutura, materializar(), {
      politicas: tarefa.politicas || {},
      exige_assinatura: modelo.exige_assinatura,
      assinatura,
    })

    const linhas = perguntas.map((p) => {
      const r = respostas[p.id]
      const juizoItem = r ? avaliarResposta(p, { ...r, fotos: (r.fotos_ids || []).length }) : null
      return elemento('button', {
        classe: 'resumo-linha', type: 'button',
        aoClick: () => { indice = perguntas.indexOf(p); desenhar() },
      }, [
        elemento('span', { classe: 'resumo-titulo', texto: p.titulo }),
        elemento('span', {
          classe: `resumo-selo ${!r ? 'selo--pendente' : r.desfecho === 'ok' ? 'selo--ok' : `selo--${juizoItem?.prioridade || 'registro'}`}`,
          texto: !r ? 'sem resposta' : r.desfecho === 'ok' ? 'OK' : (juizoItem?.descricao || 'ocorrencia'),
        }),
      ])
    })

    raiz.replaceChildren(
      cabecalho({ comContagem: false }),
      elemento('main', { classe: 'exec-corpo exec-corpo--resumo' }, [
        elemento('h1', { classe: 'exec-pergunta', texto: 'Antes de finalizar' }),
        elemento('div', { classe: 'resumo-numeros' }, [
          bloco(juizo.conformes, 'conformes'),
          bloco(juizo.ocorrencias.length, 'ocorrencias'),
          bloco(juizo.pendencias.length, 'pendencias'),
        ]),
        juizo.estado_veiculo_previsto !== 'disponivel'
          ? elemento('p', { classe: `exec-consequencia exec-consequencia--${juizo.estado_veiculo_previsto}`,
              texto: juizo.estado_veiculo_previsto === 'bloqueado'
                ? `Este checklist vai BLOQUEAR o veiculo. ${juizo.motivo}`
                : `O veiculo ficara com pendencia. ${juizo.motivo}` })
          : null,
        elemento('div', { classe: 'resumo-lista' }, linhas),
        modelo.exige_assinatura
          ? elemento('section', { classe: 'resumo-assinatura' }, [
              elemento('h2', { classe: 'folha-titulo', texto: 'Assinatura do condutor' }),
              painelAssinatura({ aoAssinar: (dados) => { assinatura = dados; desenharResumo() } }),
            ])
          : null,
      ]),
      elemento('footer', { classe: 'exec-rodape exec-rodape--unico' }, [
        elemento('button', {
          classe: 'botao botao--grande botao--ok', type: 'button',
          texto: juizo.pode_finalizar ? 'Finalizar checklist' : 'Falta responder',
          disabled: !juizo.pode_finalizar,
          aoClick: () => aoConcluir({
            cliente_uuid: clienteUuid,
            solicitacao_id: tarefa.solicitacao_id,
            template_id: modelo.id,
            momento: tarefa.momento,
            km_informado: km,
            assinatura,
            respostas: materializar(),
            iniciada_em: inicio,
            resumo: juizo,
          }),
        }),
      ]),
    )
  }

  function bloco(valor, rotulo) {
    return elemento('div', { classe: 'resumo-bloco' }, [
      elemento('span', { classe: 'resumo-valor dado', texto: String(valor) }),
      elemento('span', { classe: 'resumo-rotulo', texto: rotulo }),
    ])
  }

  // O motor conta fotos, nao guarda ids: converte na hora de julgar e de enviar.
  function materializar() {
    const saida = {}
    for (const [id, r] of Object.entries(respostas)) {
      saida[id] = {
        desfecho: r.desfecho,
        opcao_id: r.opcao_id || undefined,
        relatorio: r.relatorio || undefined,
        fotos: (r.fotos_ids || []).length,
        fotos_ids: r.fotos_ids || [],
        respondido_em: r.respondido_em,
      }
    }
    return saida
  }

  function desenhar() {
    if (indice < 0) return desenharKm()
    if (indice >= perguntas.length) return desenharResumo()
    desenharPergunta()
  }

  const inicio = new Date().toISOString()
  desenhar()
  return raiz
}
