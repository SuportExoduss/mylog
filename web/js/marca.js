// Aplicar a marca da empresa no painel (roadmap 7 — White Label).
//
// A marca chega DENTRO do pacote de sessao (`/api/auth/login`, `/api/auth/eu`),
// e nunca sozinha: e' assim que nao existe um instante em que a tela mostra a
// marca de uma empresa e os dados de outra.
//
// Este arquivo so PINTA. Quem valida cor, quem confere contraste e quem decide
// o que e' personalizavel e' `compartilhado/marca.js` — o mesmo arquivo que o
// servidor usa. Duas implementacoes divergiriam no dia seguinte.
import { CHAVES, tokensEfetivos } from '../../compartilhado/marca.js'
import { elemento, simbolo } from './ui.js'

let atual = null

// Por que uma folha de estilo, e nao `raiz.style.setProperty`.
//
// A primeira versao escrevia os tokens no elemento raiz, em linha. Funcionava,
// e estava errada por dois motivos.
//
// O DESIGN.md proibe estilo embutido no JS, e ha varredura cobrando — pela
// razao certa: medida em `style` nao aparece no `estilo.css`, nao entra na
// conta de nenhum ajuste e nao responde a tema.
//
// E o segundo motivo e' o que importa aqui: estilo em linha nao tem tema. Um
// unico conjunto de tokens sobreviveria a troca de claro para escuro, e a cor
// do tema anterior ficaria por cima do tema que acabou de entrar — de graca,
// sem ninguem perceber, ate alguem trocar o tema com uma marca personalizada.
// Consertar isso exigiria repintar em toda troca, inclusive na do SISTEMA.
//
// Esta folha espelha a cascata que o `estilo.css` ja usa: um bloco claro, um
// para quem segue o sistema no escuro, um para quem escolheu escuro no botao.
// O navegador resolve, como resolve para o resto do tema, e nao ha o que
// repintar.
function folha() {
  let no = document.getElementById('marca-da-empresa')
  if (!no) {
    no = document.createElement('style')
    no.id = 'marca-da-empresa'
    // No fim do <head>: mesma especificidade que o `:root` do estilo.css, e
    // vem depois — entao vence, sem precisar de `!important`.
    document.head.append(no)
  }
  return no
}

// Só `--<chave da lista>: #rrggbb`. As chaves saem de `CHAVES`, e os valores
// de `tokensEfetivos`, que devolve cor normalizada ou o padrao MyLog. Nada
// vindo do servidor chega a esta string sem passar por essas duas peneiras.
function bloco(tema) {
  const t = tokensEfetivos(atual?.tokens?.[tema], tema)
  return CHAVES.map((c) => `--${c}:${t[c]};`).join('')
}

export function pintar() {
  folha().textContent = [
    `:root{${bloco('claro')}}`,
    `@media (prefers-color-scheme: dark){:root:not([data-tema="claro"]){${bloco('escuro')}}}`,
    `:root[data-tema="escuro"]{${bloco('escuro')}}`,
    `:root[data-tema="claro"]{${bloco('claro')}}`,
  ].join('\n')
}

export function guardarMarca(marca) {
  atual = marca || null
  pintar()
}

export function marcaGuardada() {
  return atual
}

// ------------------------------------------------------------- co-branding

// A marca do contratante AO LADO da do MyLog, nunca no lugar dela
// (arquitetura 7). Nao ha parametro para esconder o MyLog, e e' de proposito:
// a ausencia do caminho e' a garantia.
export function marcaComEmpresa({ grande = false } = {}) {
  const m = atual
  const temEmpresa = Boolean(m?.logo_url || m?.nome_exibicao)

  const mylog = elemento('div', { classe: 'marca' }, [
    simbolo(grande ? 'marca-simbolo marca-simbolo--grande' : 'marca-simbolo'),
    elemento('div', {
      classe: grande ? 'marca-nome marca-nome--grande' : 'marca-nome',
      html: 'My<span>Log</span>',
    }),
  ])

  if (!temEmpresa) return mylog

  const daEmpresa = elemento('div', { classe: 'marca-empresa' }, [
    m.logo_url
      ? elemento('img', {
          classe: 'marca-empresa-logo', src: m.logo_url,
          // O nome vai no `alt` porque a logo PODE nao carregar — e uma logo
          // que nao carrega nao pode deixar o cabecalho sem identificar a
          // empresa.
          alt: m.nome_exibicao || 'Logo da empresa',
        })
      : null,
    m.nome_exibicao
      ? elemento('div', { classe: 'marca-empresa-nome', texto: m.nome_exibicao })
      : null,
  ])

  return elemento('div', { classe: `co-marca${grande ? ' co-marca--grande' : ''}` }, [
    daEmpresa,
    elemento('div', { classe: 'co-marca-por' }, [
      elemento('span', { classe: 'co-marca-rotulo', texto: 'por' }),
      mylog,
    ]),
  ])
}

// A PREVIA da tela de configuracoes: o mesmo mecanismo, noutra folha.
//
// Folha separada de proposito, e depois da outra: enquanto ela existe, vence a
// marca publicada; some, e a publicada volta sozinha. Sem estado para desfazer
// errado, e sem risco de a previa "vazar" para o que esta no ar.
export function preverMarca(tokensPorTema) {
  let no = document.getElementById('marca-em-previa')
  if (!no) {
    no = document.createElement('style')
    no.id = 'marca-em-previa'
    document.head.append(no)
  }
  const daPrevia = (tema) => {
    const t = tokensEfetivos(tokensPorTema?.[tema], tema)
    return CHAVES.map((c) => `--${c}:${t[c]};`).join('')
  }
  no.textContent = [
    `:root{${daPrevia('claro')}}`,
    `@media (prefers-color-scheme: dark){:root:not([data-tema="claro"]){${daPrevia('escuro')}}}`,
    `:root[data-tema="escuro"]{${daPrevia('escuro')}}`,
    `:root[data-tema="claro"]{${daPrevia('claro')}}`,
  ].join('\n')
}

export function encerrarPrevia() {
  document.getElementById('marca-em-previa')?.remove()
}
