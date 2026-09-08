// Configuracoes da empresa — hoje, White Label (roadmap 7).
//
// A tela edita a APARENCIA, e so ela. Nada aqui toca regra, permissao, dado ou
// historico: e' a fronteira que a arquitetura desenha, e o jeito de mante-la
// visivel e' esta tela nao ter mais nada dentro.
//
// Tres coisas que ela promete, e cumpre:
//
//   PREVIA ANTES DE PUBLICAR. O que a pessoa escolhe pinta o painel INTEIRO na
//   hora, ao vivo, sem salvar. E' a unica prova honesta de que a cor funciona:
//   um quadradinho de amostra nao mostra o botao pressionado, o item ativo do
//   menu nem o anel de foco.
//
//   CONTRASTE CONFERIDO ENQUANTO SE ESCOLHE. Pelo mesmo motor que o servidor
//   usa para recusar (`compartilhado/marca.js`). A tela avisa; o servidor
//   decide. Ninguem descobre que a cor nao serve depois de publicar.
//
//   SAIR SEM PUBLICAR DESFAZ. A previa e' so tela: trocar de secao, ou tocar
//   em "Descartar", devolve o que esta no ar.
import { api } from './api.js'
import { elemento, cabecalhoTela, notificar } from './ui.js'
import { encerrarPrevia, guardarMarca, marcaGuardada, preverMarca } from './marca.js'
import {
  LIMITE_NOME, TEMAS, TOKENS, conferirTema, padraoDoTema, tokensEfetivos,
} from '../../compartilhado/marca.js'

const ROTULO_TEMA = { claro: 'Tema claro', escuro: 'Tema escuro' }

export async function telaConfiguracoes(raiz, contexto) {
  const { marca: doServidor } = await api.marca()

  // O rascunho vive aqui, na tela. Nunca no servidor: "publicar" e' um ato, e
  // um rascunho no banco criaria um segundo estado publicavel que ninguem
  // pediu — e a pergunta "o que esta no ar?" passaria a ter duas respostas.
  const rascunho = {
    nome_exibicao: doServidor.nome_exibicao || '',
    claro: { ...doServidor.definidos.claro },
    escuro: { ...doServidor.definidos.escuro },
  }

  const avisos = elemento('div', { classe: 'config-avisos' })
  const acoes = elemento('div', { classe: 'config-acoes' })
  const corpo = elemento('div', { classe: 'config-corpo' })

  // ------------------------------------------------------------- previa
  // Pinta o painel inteiro com o rascunho, sem salvar nada. Os DOIS temas de
  // uma vez: quem troca o tema no meio da edicao ve a previa do outro, que e'
  // justamente como se confere se o escuro tambem ficou bom.
  function prever() {
    preverMarca({ claro: rascunho.claro, escuro: rascunho.escuro })
  }

  // Tira a folha de previa e o que esta publicado volta sozinho. Chamado ao
  // descartar e ao sair da tela.
  function desfazerPrevia() {
    encerrarPrevia()
    restaurarTema()
  }

  // ------------------------------------------------- ver o tema que se edita
  //
  // A previa so aparece no tema que esta na tela. Editando as cores do tema
  // claro com o painel no escuro, NADA muda — e quem faz isso conclui, com
  // razao, que a funcao esta quebrada.
  //
  // Entao editar um tema leva o painel para ele. E' temporario de proposito:
  // mexe no `data-tema` do documento e nao toca no `localStorage`, entao a
  // preferencia da pessoa volta inteira quando ela sai da tela.
  const temaDeAntes = document.documentElement.dataset.tema || null

  function restaurarTema() {
    if (temaDeAntes) document.documentElement.dataset.tema = temaDeAntes
    else delete document.documentElement.dataset.tema
  }

  function verTema(tema) {
    document.documentElement.dataset.tema = tema
  }

  function temaNaTela() {
    return document.documentElement.dataset.tema
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro')
  }

  function mudou() {
    return JSON.stringify(rascunho) !== JSON.stringify({
      nome_exibicao: doServidor.nome_exibicao || '',
      claro: { ...doServidor.definidos.claro },
      escuro: { ...doServidor.definidos.escuro },
    })
  }

  // ---------------------------------------------------------- conferencia
  function redesenharAvisos() {
    avisos.replaceChildren()
    let algumRuim = false

    for (const tema of TEMAS) {
      const r = conferirTema(rascunho[tema], tema)
      if (r.ok) continue
      algumRuim = true
      avisos.append(elemento('div', { classe: 'aviso aviso--erro' }, [
        elemento('strong', { texto: `${ROTULO_TEMA[tema]}: ` }),
        // Cada par ruim vira uma linha, com o numero medido. "Contraste
        // insuficiente" sozinho nao diz o que corrigir.
        ...r.pares.filter((p) => !p.ok).map((p) =>
          elemento('div', { classe: 'config-aviso-linha', texto: p.mensagem })),
      ]))
    }

    // O botao de publicar so trava por contraste — o servidor recusaria de
    // qualquer jeito, e travar aqui evita a viagem.
    publicar.disabled = algumRuim || !mudou()
    descartar.disabled = !mudou()
    return !algumRuim
  }

  function aoMudarCor(tema, chave, valor) {
    if (valor) rascunho[tema][chave] = valor
    else delete rascunho[tema][chave]
    // Mostra o tema que esta sendo mexido: previa que nao aparece nao e previa.
    if (temaNaTela() !== tema) { verTema(tema); desenhar() }
    prever()
    redesenharAvisos()
  }

  // --------------------------------------------------------------- campos
  function bloco(tema) {
    const padrao = padraoDoTema(tema)
    const efetivo = tokensEfetivos(rascunho[tema], tema)

    const linhas = TOKENS.map((token) => {
      const definido = Boolean(rascunho[tema][token.chave])
      const cor = elemento('input', {
        type: 'color', classe: 'config-cor', value: efetivo[token.chave],
        'aria-label': `${token.rotulo} — ${ROTULO_TEMA[tema]}`,
      })
      const hex = elemento('input', {
        type: 'text', classe: 'config-hex dado', value: efetivo[token.chave],
        maxlength: 7, spellcheck: 'false',
        'aria-label': `${token.rotulo} em hexadecimal — ${ROTULO_TEMA[tema]}`,
      })
      const selo = elemento('span', {
        classe: `config-origem${definido ? ' config-origem--sua' : ''}`,
        texto: definido ? 'sua' : 'padrao MyLog',
      })

      // Os dois campos sao a MESMA cor por dois caminhos. Quem digita o hex de
      // um manual de identidade visual nao quer caçar o tom num seletor; quem
      // esta escolhendo quer o seletor. Manter os dois em sincronia e' o que
      // faz nenhum dos dois mentir.
      const sincronizar = (valor, deQuem) => {
        if (deQuem !== 'cor') cor.value = valor
        if (deQuem !== 'hex') hex.value = valor
        selo.textContent = 'sua'
        selo.classList.add('config-origem--sua')
        aoMudarCor(tema, token.chave, valor)
      }
      cor.addEventListener('input', () => sincronizar(cor.value, 'cor'))
      hex.addEventListener('change', () => {
        const v = hex.value.trim()
        if (/^#?[0-9a-fA-F]{6}$/.test(v)) return sincronizar(v.startsWith('#') ? v : `#${v}`, 'hex')
        // Valor impossivel volta ao que estava, em vez de sumir em silencio.
        hex.value = cor.value
        notificar('Use uma cor no formato #rrggbb.')
      })

      const voltar = elemento('button', {
        classe: 'botao botao--suave botao--mini', type: 'button', texto: 'Padrao',
        title: `Voltar ${token.rotulo.toLowerCase()} ao padrao MyLog`,
        aoClick: () => {
          cor.value = padrao[token.chave]
          hex.value = padrao[token.chave]
          selo.textContent = 'padrao MyLog'
          selo.classList.remove('config-origem--sua')
          aoMudarCor(tema, token.chave, null)
        },
      })

      return elemento('div', { classe: 'config-token' }, [
        elemento('div', { classe: 'config-token-texto' }, [
          elemento('div', { classe: 'config-token-rotulo' }, [
            elemento('span', { texto: token.rotulo }), selo,
          ]),
          elemento('p', { classe: 'config-token-dica', texto: token.dica }),
        ]),
        elemento('div', { classe: 'config-token-campos' }, [cor, hex, voltar]),
      ])
    })

    const naTela = temaNaTela() === tema

    return elemento('section', { classe: `config-bloco${naTela ? ' config-bloco--na-tela' : ''}` }, [
      elemento('header', { classe: 'config-bloco-topo' }, [
        elemento('div', { classe: 'config-bloco-titulo' }, [
          elemento('h2', { texto: ROTULO_TEMA[tema] }),
          naTela
            ? elemento('span', { classe: 'config-origem config-origem--sua', texto: 'na tela' })
            // Sem isto, quem edita o tema que nao esta na tela nao ve nada
            // acontecer. O botao existe para o caso de querer olhar antes de
            // mexer; mexer ja troca sozinho.
            : elemento('button', {
                classe: 'botao botao--suave botao--mini', type: 'button',
                texto: 'Ver este tema',
                aoClick: () => { verTema(tema); desenhar(); prever(); redesenharAvisos() },
              }),
        ]),
        elemento('button', {
          classe: 'botao botao--suave botao--mini', type: 'button',
          texto: 'Voltar ao padrao',
          // Um tema volta ao padrao SOZINHO (roadmap 7): quem so se importa com
          // o claro nao perde o escuro que ajustou.
          aoClick: () => { rascunho[tema] = {}; desenhar(); prever(); redesenharAvisos() },
        }),
      ]),
      elemento('p', { classe: 'config-bloco-dica',
        texto: 'Vale so para este tema. O outro fica como esta.' }),
      ...linhas,
    ])
  }

  // ----------------------------------------------------------------- logo
  function blocoIdentidade() {
    const nome = elemento('input', {
      type: 'text', classe: 'config-nome', value: rascunho.nome_exibicao,
      maxlength: String(LIMITE_NOME), placeholder: 'Nome da sua empresa',
      'aria-label': 'Nome de exibicao',
    })
    nome.addEventListener('input', () => {
      rascunho.nome_exibicao = nome.value
      redesenharAvisos()
    })

    const previaLogo = doServidor.logo_url
      ? elemento('img', { classe: 'config-logo', src: doServidor.logo_url, alt: 'Logo atual' })
      : elemento('div', { classe: 'config-logo config-logo--vazia',
          texto: 'Sem logo — o painel mostra so o MyLog.' })

    const entrada = elemento('input', {
      type: 'file', accept: 'image/png,image/jpeg,image/webp', classe: 'oculto',
    })
    entrada.addEventListener('change', async () => {
      const arquivo = entrada.files?.[0]
      entrada.value = ''
      if (!arquivo) return
      try {
        const conteudo = await lerBase64(arquivo)
        const { marca } = await api.enviarLogo(conteudo)
        // A logo publica NA HORA — nao entra no rascunho. Arquivo nao tem
        // previa honesta: para ver a logo na tela ela precisa estar no
        // servidor. Trocar de novo, ou remover, e' um toque.
        doServidor.logo_url = marca.logo_url
        guardarMarca({ ...marcaGuardada(), logo_url: marca.logo_url })
        notificar('Logo publicada.')
        desenhar()
      } catch (falha) {
        notificar(falha.message)
      }
    })

    return elemento('section', { classe: 'config-bloco' }, [
      elemento('header', { classe: 'config-bloco-topo' }, [
        elemento('h2', { texto: 'Identidade' }),
      ]),
      elemento('p', { classe: 'config-bloco-dica',
        texto: 'O nome e a logo aparecem AO LADO do MyLog, nunca no lugar dele.' }),

      elemento('label', { classe: 'campo' }, [
        elemento('span', { texto: `Nome de exibicao (ate ${LIMITE_NOME} caracteres)` }),
        nome,
      ]),

      elemento('div', { classe: 'config-logo-linha' }, [
        previaLogo,
        elemento('div', { classe: 'config-logo-acoes' }, [
          elemento('button', {
            classe: 'botao botao--suave', type: 'button',
            texto: doServidor.logo_url ? 'Trocar logo' : 'Enviar logo',
            aoClick: () => entrada.click(),
          }),
          doServidor.logo_url
            ? elemento('button', {
                classe: 'botao botao--suave', type: 'button', texto: 'Remover logo',
                aoClick: async () => {
                  try {
                    const { marca } = await api.removerLogo()
                    doServidor.logo_url = marca.logo_url
                    guardarMarca({ ...marcaGuardada(), logo_url: null })
                    notificar('Logo removida. O painel mostra so o MyLog.')
                    desenhar()
                  } catch (falha) { notificar(falha.message) }
                },
              })
            : null,
          elemento('p', { classe: 'config-token-dica',
            texto: 'PNG, JPEG ou WebP, ate 4 MB. A logo publica na hora.' }),
        ]),
        entrada,
      ]),
    ])
  }

  // -------------------------------------------------------------- botoes
  const publicar = elemento('button', {
    classe: 'botao botao--ok', type: 'button', texto: 'Publicar marca',
    aoClick: async () => {
      publicar.disabled = true
      try {
        const { marca, recusadas } = await api.publicarMarca({
          nome_exibicao: rascunho.nome_exibicao,
          // `null` num tema e' o pedido explicito de voltar ao padrao MyLog
          // daquele tema — e so daquele.
          tokens_claro: Object.keys(rascunho.claro).length ? rascunho.claro : null,
          tokens_escuro: Object.keys(rascunho.escuro).length ? rascunho.escuro : null,
        })
        doServidor.nome_exibicao = marca.nome_exibicao
        doServidor.definidos = marca.definidos
        rascunho.nome_exibicao = marca.nome_exibicao || ''
        rascunho.claro = { ...marca.definidos.claro }
        rascunho.escuro = { ...marca.definidos.escuro }

        guardarMarca({
          nome_exibicao: marca.nome_exibicao,
          logo_url: marca.logo_url,
          tokens: marca.efetivos,
        })
        contexto.marcaMudou?.()

        if (recusadas?.length) {
          notificar(`Publicada. ${recusadas.length} valor(es) ignorado(s): ${recusadas[0].motivo}`)
        } else {
          notificar('Marca publicada.')
        }
        desenhar()
        redesenharAvisos()
      } catch (falha) {
        notificar(falha.message)
      } finally {
        redesenharAvisos()
      }
    },
  })

  const descartar = elemento('button', {
    classe: 'botao botao--suave', type: 'button', texto: 'Descartar alteracoes',
    aoClick: () => {
      rascunho.nome_exibicao = doServidor.nome_exibicao || ''
      rascunho.claro = { ...doServidor.definidos.claro }
      rascunho.escuro = { ...doServidor.definidos.escuro }
      desfazerPrevia()
      desenhar()
      redesenharAvisos()
    },
  })

  acoes.append(descartar, publicar)

  // -------------------------------------------------------------- desenho
  function desenhar() {
    corpo.replaceChildren(
      blocoIdentidade(),
      ...TEMAS.map(bloco),
    )
  }

  raiz.append(
    cabecalhoTela({
      titulo: 'Configuracoes',
      descricao: 'Aparencia da empresa. Nada aqui muda regra, permissao ou historico.',
    }),
    elemento('p', { classe: 'config-explica' }, [
      elemento('strong', { texto: 'O que voce escolher pinta este painel na hora, sem salvar. ' }),
      elemento('span', {
        texto: 'Publicar e o que vale para todo mundo da empresa. Mexer nas cores '
          + 'de um tema leva o painel para ele, porque previa que nao aparece nao '
          + 'e previa — sua preferencia de tema volta ao sair daqui. As cores de '
          + 'estado — verde, amarelo, vermelho — nao entram: elas dizem o que a '
          + 'tela significa, e mudar significado nao e aparencia.' }),
    ]),
    avisos,
    corpo,
    elemento('footer', { classe: 'config-rodape' }, [acoes]),
  )

  desenhar()
  redesenharAvisos()
  prever()

  // Sair da tela sem publicar desfaz a previa. Sem isto, quem espia uma cor e
  // navega para outra secao leva a cor nao publicada junto — e acha que salvou.
  return () => desfazerPrevia()
}

function lerBase64(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () => resolve(String(leitor.result))
    leitor.onerror = () => reject(new Error('Nao foi possivel ler a imagem.'))
    leitor.readAsDataURL(arquivo)
  })
}
