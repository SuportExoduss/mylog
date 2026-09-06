// Sino de notificacoes (roadmap 15).
//
// Fica no alto, a direita, em toda tela do painel. Um ponto vermelho quando ha
// aviso novo — sem numero: o que importa e' "tem coisa nova". Numero grande
// vira aviso que a pessoa aprende a ignorar, e aviso ignorado nao e' aviso.
import { api } from './api.js'
import { elemento, notificar } from './ui.js'

// Recarrega sozinho, mas devagar. Notificacao nao e' cotacao de bolsa: um
// minuto de atraso nao muda decisao nenhuma, e bater no servidor a cada
// segundo com quarenta pessoas logadas custa mais do que informa.
const INTERVALO = 60_000

function quando(iso) {
  const d = new Date(iso)
  const minutos = Math.round((Date.now() - d.getTime()) / 60000)
  if (minutos < 1) return 'agora'
  if (minutos < 60) return `ha ${minutos} min`
  const horas = Math.round(minutos / 60)
  if (horas < 24) return `ha ${horas}h`
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function montarSino(contexto) {
  const area = document.getElementById('area-sino')
  if (!area) return { parar: () => {} }

  let notificacoes = []
  let naoLidas = 0
  let aberto = false
  let relogio = null

  const ponto = elemento('span', { classe: 'sino-ponto oculto', 'aria-hidden': 'true' })

  const gatilho = elemento('button', {
    classe: 'sino-gatilho', type: 'button',
    'aria-label': 'Notificacoes',
    aoClick: (evento) => { evento.stopPropagation(); alternar() },
  }, [desenho(), ponto])

  const lista = elemento('div', { classe: 'sino-lista oculto' })
  const caixa = elemento('div', { classe: 'sino' }, [gatilho, lista])

  // Sino desenhado a mao, na cor do texto: sem fonte de icone, sem imagem, e
  // acompanha o tema claro/escuro sozinho.
  function desenho() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('width', '20')
    svg.setAttribute('height', '20')
    svg.setAttribute('fill', 'none')
    svg.setAttribute('aria-hidden', 'true')
    svg.innerHTML = `
      <path d="M6 9a6 6 0 1 1 12 0c0 3.2.7 5 1.6 6H4.4C5.3 14 6 12.2 6 9Z"
            stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
      <path d="M10 18.5a2 2 0 0 0 4 0" stroke="currentColor" stroke-width="1.7"
            stroke-linecap="round"/>`
    return svg
  }

  function fechar() {
    aberto = false
    lista.classList.add('oculto')
    gatilho.setAttribute('aria-expanded', 'false')
    document.removeEventListener('click', fechar)
  }

  function alternar() {
    if (aberto) return fechar()
    aberto = true
    desenharLista()
    lista.classList.remove('oculto')
    gatilho.setAttribute('aria-expanded', 'true')
    setTimeout(() => document.addEventListener('click', fechar), 0)
  }

  async function abrirNotificacao(n) {
    fechar()
    if (!n.lida_em) {
      try {
        const r = await api.marcarLida(n.id)
        naoLidas = r.nao_lidas
        n.lida_em = new Date().toISOString()
        atualizarPonto()
      } catch { /* a navegacao importa mais que a marca */ }
    }
    if (n.destino) contexto.irPara(n.destino)
  }

  function atualizarPonto() {
    ponto.classList.toggle('oculto', naoLidas === 0)
    gatilho.setAttribute('aria-label',
      naoLidas ? `Notificacoes — ${naoLidas} nao lida(s)` : 'Notificacoes')
  }

  function desenharLista() {
    const itens = notificacoes.map((n) => elemento('button', {
      classe: `sino-item sino-item--${n.nivel}${n.lida_em ? '' : ' sino-item--nova'}`,
      type: 'button',
      aoClick: (evento) => { evento.stopPropagation(); abrirNotificacao(n) },
    }, [
      elemento('span', { texto: n.texto }),
      elemento('span', { classe: 'sino-quando', texto: quando(n.criado_em) }),
    ]))

    lista.replaceChildren(
      elemento('div', { classe: 'sino-topo' }, [
        elemento('strong', { texto: naoLidas ? `${naoLidas} nao lida(s)` : 'Notificacoes' }),
        naoLidas
          ? elemento('button', {
              classe: 'botao botao--suave botao--pequeno', type: 'button',
              texto: 'Marcar todas como lidas',
              aoClick: async (evento) => {
                evento.stopPropagation()
                const r = await api.marcarLida()
                naoLidas = r.nao_lidas
                for (const n of notificacoes) n.lida_em = n.lida_em || new Date().toISOString()
                atualizarPonto()
                desenharLista()
              },
            })
          : null,
      ].filter(Boolean)),
      itens.length
        ? elemento('div', {}, itens)
        : elemento('div', { classe: 'sino-vazio', texto: 'Nenhuma notificacao ainda.' }),
    )
  }

  async function carregar() {
    try {
      const r = await api.notificacoes()
      notificacoes = r.notificacoes
      naoLidas = r.nao_lidas
      atualizarPonto()
      if (aberto) desenharLista()
    } catch {
      // Sino nao derruba tela: sem rede, ele so nao atualiza.
    }
  }

  area.replaceChildren(caixa)
  atualizarPonto()
  carregar()
  relogio = setInterval(carregar, INTERVALO)

  return {
    recarregar: carregar,
    parar: () => {
      clearInterval(relogio)
      document.removeEventListener('click', fechar)
      area.replaceChildren()
    },
  }
}

export { notificar }
