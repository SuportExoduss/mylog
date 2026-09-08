// DOM minimo para testar as telas sem instalar dependencia (decisao D1).
//
// Nao e' um navegador e nao pretende ser: nao tem layout, nao tem CSS, nao
// calcula visibilidade. Implementa exatamente o que `web/js/ui.js` e
// `app/js/checklist.js` chamam — criar no, pendurar, remover, ouvir evento,
// disparar evento, e achar por seletor simples.
//
// Existe por causa de um bug concreto: `abrirModal` limpava a area de modais
// depois do `aoConfirmar`, apagando a janela que mostrava a senha inicial
// gerada. Nenhum dos testes de API pegava — todos passavam, e a senha sumia.
// Ver DECISOES D34 e roadmap 26.
//
// Se um teste precisar de algo que nao esta aqui, o certo e' acrescentar o
// pedaco que falta, nao trocar isto por um navegador de verdade.

// Seletor suportado: lista separada por virgula, e dentro de cada item uma
// cadeia de descendentes separada por espaco. Cada elo e' `tag`, `.classe`,
// `#id` ou combinacao (`div.campo`, `button#salvar`).
//
// O combinador descendente precisa existir: sem ele, ".campo-imagem input"
// casava com a propria div e o teste disparava evento no elemento errado —
// silenciosamente, que e' o pior jeito de errar num arcabouco de teste.
function analisarElo(bruto) {
  return {
    tag: bruto.match(/^[a-zA-Z][\w-]*/)?.[0] || null,
    id: bruto.match(/#([\w-]+)/)?.[1] || null,
    classes: [...bruto.matchAll(/\.([\w-]+)/g)].map((m) => m[1]),
  }
}

function analisarSeletor(seletor) {
  const texto = String(seletor)
  // O que este DOM nao entende ele recusa, em vez de casar com outra coisa.
  if (/[>+~[\]:]/.test(texto)) {
    throw new Error(
      `Seletor "${texto}" usa sintaxe que o DOM de teste nao implementa. `
      + 'Acrescente o suporte em testes/dom.js ou simplifique o seletor.')
  }
  return texto.split(',').map((parte) => parte.trim().split(/\s+/).filter(Boolean).map(analisarElo))
}

function eloCombina(no, { tag, id, classes }) {
  return (!tag || no.tagName === tag.toUpperCase())
    && (!id || no.id === id)
    && classes.every((c) => no.classList.contains(c))
}

// A cadeia e' lida de tras para frente: o ultimo elo tem que ser o proprio no,
// e os anteriores tem que aparecer entre os ancestrais, na ordem.
function combina(no, cadeias) {
  return cadeias.some((cadeia) => {
    if (!cadeia.length) return false
    if (!eloCombina(no, cadeia[cadeia.length - 1])) return false
    let atual = no.parentNode
    for (let i = cadeia.length - 2; i >= 0; i -= 1) {
      while (atual && !eloCombina(atual, cadeia[i])) atual = atual.parentNode
      if (!atual) return false
      atual = atual.parentNode
    }
    return true
  })
}

// Atributo booleano <-> propriedade, como o navegador faz.
const BOOLEANOS = {
  disabled: 'disabled', required: 'required', readonly: 'readOnly',
  checked: 'checked', hidden: 'hidden',
}

class Evento {
  constructor(tipo, opcoes = {}) {
    this.type = tipo
    this.bubbles = opcoes.bubbles !== false
    this.target = null
    this.defaultPrevented = false
    this.propagacaoParada = false
  }

  preventDefault() { this.defaultPrevented = true }
  stopPropagation() { this.propagacaoParada = true }
}

class No {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.filhos = []
    this.parentNode = null
    this.atributos = new Map()
    this.ouvintes = new Map()
    this.dataset = {}
    this.style = {}
    this._texto = ''
    this._valor = ''
    this.disabled = false
    this.required = false
    this.readOnly = false
    this.checked = false

    const dono = this
    this.classList = {
      add: (...cs) => dono.classesSet(new Set([...dono.classes(), ...cs])),
      remove: (...cs) => dono.classesSet(new Set(dono.classes().filter((c) => !cs.includes(c)))),
      contains: (c) => dono.classes().includes(c),
      toggle: (c, forcar) => {
        const tem = dono.classList.contains(c)
        const querer = forcar === undefined ? !tem : Boolean(forcar)
        if (querer) dono.classList.add(c); else dono.classList.remove(c)
        return querer
      },
    }
  }

  classes() { return String(this.className || '').split(/\s+/).filter(Boolean) }
  classesSet(conjunto) { this.className = [...conjunto].join(' ') }

  get className() { return this.atributos.get('class') || '' }
  set className(v) { this.atributos.set('class', String(v)) }

  get id() { return this.atributos.get('id') || '' }
  set id(v) { this.atributos.set('id', String(v)) }

  get type() { return this.atributos.get('type') || '' }
  set type(v) { this.atributos.set('type', String(v)) }

  // `img.src = url` e `a.href = url` escrevem o ATRIBUTO no navegador. Sem
  // refletir, um teste que le getAttribute('src') recebe null enquanto a tela
  // real mostraria a imagem — e o teste acusaria um defeito que nao existe.
  get src() { return this.atributos.get('src') || '' }
  set src(v) { this.atributos.set('src', String(v)) }

  get href() { return this.atributos.get('href') || '' }
  set href(v) { this.atributos.set('href', String(v)) }

  // No navegador, o atributo `value` de um controle define o valor INICIAL; a
  // propriedade `.value` e' estado vivo e passa a mandar assim que alguem
  // escreve nela. Sem essa distincao, `elemento('input', { value: senha })` —
  // que cai no setAttribute — devolveria vazio, e o teste acusaria a tela por
  // um defeito que e' deste arquivo.
  get value() { return this._valorSujo ? this._valor : (this.atributos.get('value') ?? '') }

  set value(v) {
    this._valorSujo = true
    this._valor = v === null || v === undefined ? '' : String(v)
  }

  setAttribute(nome, valor) {
    this.atributos.set(nome, String(valor))
    // No navegador, atributo booleano e propriedade sao o mesmo estado:
    // `setAttribute('disabled', ...)` deixa `.disabled` verdadeiro. Sem
    // refletir, um teste que confere `botao.disabled` leria sempre false e
    // aprovaria uma tela que deixa clicar no que devia estar travado.
    if (nome in BOOLEANOS) this[BOOLEANOS[nome]] = valor !== false && valor !== 'false'
  }

  removeAttribute(nome) {
    this.atributos.delete(nome)
    if (nome in BOOLEANOS) this[BOOLEANOS[nome]] = false
  }
  getAttribute(nome) { return this.atributos.has(nome) ? this.atributos.get(nome) : null }

  get firstChild() { return this.filhos[0] || null }

  get textContent() {
    if (this._texto) return this._texto
    return this.filhos.map((f) => f.textContent).join('')
  }

  set textContent(v) {
    this.filhos = []
    this._texto = v === null || v === undefined ? '' : String(v)
  }

  // Nao interpreta marcacao: guarda cru. Os testes olham estrutura, nao HTML.
  get innerHTML() { return this._html || '' }
  set innerHTML(v) { this._html = String(v) }

  // `append` e `replaceChildren` do navegador NAO ignoram `null`: convertem em
  // texto. `raiz.replaceChildren(a, null, b)` escreve a palavra "null" na tela,
  // entre os dois.
  //
  // Este DOM ignorava, e a mentira era do tipo que fabrica confianca: a tela
  // inicial do aplicativo mostrou "null" no navegador de verdade, em todas as
  // telas, com a suite inteira verde. Quem filtra nulo e' o `elemento()`, e so
  // ele — quem chama `append` cru tem que filtrar por conta.
  append(...nos) {
    for (const no of nos) {
      const filho = (no instanceof No || no instanceof Texto)
        ? no
        : new Texto(String(no))
      filho.parentNode?.removeChild(filho)
      filho.parentNode = this
      this.filhos.push(filho)
    }
  }

  removeChild(filho) {
    const i = this.filhos.indexOf(filho)
    if (i >= 0) { this.filhos.splice(i, 1); filho.parentNode = null }
    return filho
  }

  remove() { this.parentNode?.removeChild(this) }

  // Insere logo depois deste no'. E' como a tira de conexao volta a aparecer
  // quando a rede cai, sem redesenhar a tela por baixo de quem responde.
  after(...nos) {
    const pai = this.parentNode
    if (!pai) return
    const onde = pai.filhos.indexOf(this)
    const novos = nos.filter((n) => n !== null && n !== undefined)
    for (const n of novos) { n.parentNode?.removeChild(n); n.parentNode = pai }
    pai.filhos.splice(onde + 1, 0, ...novos)
  }

  // Troca este no' por outro, no mesmo lugar. E' como a tira de conexao se
  // atualiza sem redesenhar a tela inteira.
  replaceWith(...nos) {
    const pai = this.parentNode
    if (!pai) return
    const onde = pai.filhos.indexOf(this)
    const novos = nos.filter((n) => n !== null && n !== undefined)
    for (const n of novos) { n.parentNode?.removeChild(n); n.parentNode = pai }
    pai.filhos.splice(onde, 1, ...novos)
    this.parentNode = null
  }

  replaceChildren(...nos) {
    for (const f of [...this.filhos]) this.removeChild(f)
    this._texto = ''
    this.append(...nos)
  }

  descendentes() {
    return this.filhos.flatMap((f) => (f instanceof No ? [f, ...f.descendentes()] : []))
  }

  querySelector(seletor) { return this.querySelectorAll(seletor)[0] || null }

  querySelectorAll(seletor) {
    const partes = analisarSeletor(seletor)
    return this.descendentes().filter((n) => combina(n, partes))
  }

  closest(seletor) {
    const partes = analisarSeletor(seletor)
    let atual = this
    while (atual) {
      if (combina(atual, partes)) return atual
      atual = atual.parentNode
    }
    return null
  }

  // <select>: as opcoes sao os filhos <option>.
  get options() { return this.filhos.filter((f) => f.tagName === 'OPTION') }

  get selectedOptions() {
    return this.options.filter((o) => o.getAttribute('value') === this.value)
  }

  addEventListener(tipo, fn) {
    if (!this.ouvintes.has(tipo)) this.ouvintes.set(tipo, [])
    this.ouvintes.get(tipo).push(fn)
  }

  removeEventListener(tipo, fn) {
    const lista = this.ouvintes.get(tipo)
    if (lista) this.ouvintes.set(tipo, lista.filter((f) => f !== fn))
  }

  // Sobe pela arvore como o navegador faz: e' isso que permite testar se um
  // clique no formulario fecha (ou nao) o fundo do modal.
  dispatchEvent(evento) {
    const ev = typeof evento === 'string' ? new Evento(evento) : evento
    ev.target = ev.target || this
    let atual = this
    while (atual) {
      for (const fn of atual.ouvintes.get(ev.type) || []) {
        ev.currentTarget = atual
        fn(ev)
        if (ev.propagacaoParada) return !ev.defaultPrevented
      }
      if (!ev.bubbles) break
      atual = atual.parentNode
    }
    return !ev.defaultPrevented
  }

  // Clicar num submit dispara o submit do formulario, como no navegador.
  // Controle desabilitado nao dispara clique nenhum — e' o navegador que
  // decide isso, nao o ouvinte. Sem esta linha, um teste que clica num botao
  // travado veria a acao acontecer, e passaria PROVANDO O CONTRARIO do que
  // acontece no aparelho: e' o tipo de teste que da confianca falsa.
  static SEM_CLIQUE_QUANDO_TRAVADO = new Set([
    'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'FIELDSET', 'OPTION', 'OPTGROUP',
  ])

  click() {
    if (this.disabled && No.SEM_CLIQUE_QUANDO_TRAVADO.has(this.tagName)) return
    this.dispatchEvent(new Evento('click'))
    if (this.tagName === 'BUTTON' && this.type === 'submit') {
      this.closest('form')?.dispatchEvent(new Evento('submit'))
    }
  }

  focus() { this.focado = true }
  select() { this.selecionado = true }

  // <canvas> sem pixels: registra as chamadas e devolve um tracado vazio.
  // Da para testar que a assinatura foi exigida e capturada; nao da para
  // testar o desenho, e este arquivo nao finge que da.
  getContext() {
    if (!this._contexto) {
      const nada = () => {}
      this._contexto = {
        beginPath: nada, moveTo: nada, lineTo: nada, stroke: nada, clearRect: nada,
        lineWidth: 0, lineCap: '', strokeStyle: '',
      }
    }
    return this._contexto
  }

  toDataURL() { return 'data:image/png;base64,' }

  // Sem layout nao ha geometria: devolve zeros. Quem depende de posicao real
  // — como abrir o menu para cima perto do rodape — nao da para testar aqui,
  // e fingir um retangulo plausivel so criaria confianca falsa.
  getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } }
}

class Texto extends No {
  constructor(texto) { super('#text'); this._texto = String(texto) }
  get textContent() { return this._texto }
  set textContent(v) { this._texto = String(v) }
  descendentes() { return [] }
}

// Instala um `document` global e devolve como desmontar. Cada teste monta o
// seu: estado de tela nao pode vazar de um teste para o outro.
export function montarDom({ ids = ['area-modal'] } = {}) {
  const raiz = new No('html')
  // O `head` existe porque o documento de verdade tem um, e o codigo usa: e'
  // onde a folha de estilo da marca da empresa e' pendurada. Sem ele, o
  // aplicativo estourava na abertura e dezoito testes caiam de uma vez —
  // apontando para o DOM de mentira, e nao para o codigo.
  const cabeca = new No('head')
  const corpo = new No('body')
  raiz.append(cabeca, corpo)
  for (const id of ids) {
    const alvo = new No('div')
    alvo.id = id
    corpo.append(alvo)
  }

  const documento = {
    documentElement: raiz,
    head: cabeca,
    body: corpo,
    createElement: (tag) => new No(tag),
    createElementNS: (_ns, tag) => new No(tag),
    createTextNode: (t) => new Texto(t),
    getElementById: (id) => raiz.descendentes().find((n) => n.id === id) || null,
    querySelector: (s) => corpo.querySelector(s),
    querySelectorAll: (s) => corpo.querySelectorAll(s),
    addEventListener: (t, f) => corpo.addEventListener(t, f),
    removeEventListener: (t, f) => corpo.removeEventListener(t, f),
  }

  // A janela precisa ouvir de verdade: o aplicativo de campo escuta `online`
  // nela e na raiz global, e a sincronia escuta `visibilitychange` no
  // documento. Sem isto, `window.addEventListener` estoura na importacao.
  const ouvintesDaJanela = new Map()
  const janela = {
    innerHeight: 800,
    innerWidth: 1280,
    addEventListener: (t, f) => {
      if (!ouvintesDaJanela.has(t)) ouvintesDaJanela.set(t, [])
      ouvintesDaJanela.get(t).push(f)
    },
    removeEventListener: (t, f) => {
      const l = ouvintesDaJanela.get(t)
      if (l) ouvintesDaJanela.set(t, l.filter((g) => g !== f))
    },
    dispatchEvent: (evento) => {
      const ev = typeof evento === 'string' ? new Evento(evento) : evento
      for (const fn of [...(ouvintesDaJanela.get(ev.type) || [])]) fn(ev)
      return true
    },
  }
  documento.visibilityState = 'visible'
  documento.dispatchEvent = (evento) => corpo.dispatchEvent(evento)

  // `navigator.onLine` decide a tira de conexao inteira. Comeca online: e' o
  // caso comum, e cada teste que quer o outro troca por escrito.
  const navegador = { onLine: true }

  const anteriores = {
    document: globalThis.document,
    Event: globalThis.Event,
    window: globalThis.window,
    navigator: globalThis.navigator,
    addEventListener: globalThis.addEventListener,
    removeEventListener: globalThis.removeEventListener,
  }
  globalThis.document = documento
  globalThis.Event = Evento
  globalThis.window = janela
  Object.defineProperty(globalThis, 'navigator', {
    value: navegador, configurable: true, writable: true,
  })
  globalThis.addEventListener = janela.addEventListener
  globalThis.removeEventListener = janela.removeEventListener

  return {
    documento,
    corpo,
    janela,
    navegador,
    clicar: (no) => no.click(),
    // Clique solto na pagina: e' assim que um menu aberto se fecha.
    clicarFora: () => corpo.dispatchEvent(new Evento('click')),
    // Cai a rede / volta a rede, como o navegador anuncia.
    rede: (online) => {
      navegador.onLine = online
      janela.dispatchEvent(new Evento(online ? 'online' : 'offline'))
    },
    desmontar: () => {
      globalThis.document = anteriores.document
      globalThis.Event = anteriores.Event
      globalThis.window = anteriores.window
      Object.defineProperty(globalThis, 'navigator', {
        value: anteriores.navigator, configurable: true, writable: true,
      })
      globalThis.addEventListener = anteriores.addEventListener
      globalThis.removeEventListener = anteriores.removeEventListener
    },
  }
}

// O projeto esconde de um jeito so: a classe `oculto`, que e'
// `display: none !important`. Sem isto, um teste que procura um botao acha o
// que esta escondido e passa acreditando que a pessoa o ve — o inverso exato
// do que o teste queria provar.
export function estaVisivel(no) {
  for (let atual = no; atual; atual = atual.parentNode) {
    if (atual.classList?.contains('oculto')) return false
  }
  return true
}

export { No, Texto, Evento }
