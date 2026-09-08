// A CASCA do painel, sobre o DOM minimo.
//
// `web/js/app.js` segura o que nenhuma tela sozinha segura: entrar, sair,
// navegar entre secoes, a troca de senha obrigatoria, o tema e a marca da
// empresa. Ate aqui nao tinha nenhum teste de tela — `interface.teste.js`
// importa as telas uma a uma, nunca a casca que as troca.
//
// A falta apareceu como defeito: o desmonte da tela vivia so em `navegar`, e
// por isso o LOGOUT escapava dele. Quem espiasse uma cor na tela de
// configuracoes e clicasse em "Sair" ia parar num login pintado com a cor NAO
// PUBLICADA da empresa anterior, e com a preferencia de tema sequestrada.
import test, { after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom, Evento } from './dom.js'

const assentar = async (voltas = 8) => {
  for (let i = 0; i < voltas; i += 1) await new Promise((r) => setImmediate(r))
}

// ------------------------------------------------------------- a casca HTML
// Os mesmos ids de `web/index.html`. A casca do painel os assume existindo:
// ela desenha DENTRO deles, e nunca os cria.
// A TAG importa: `botao-sair` e' <button> no HTML de verdade, e um teste que
// procura botoes por `querySelectorAll('button')` nao acha um <div>. Espelhar
// a tag errada aqui faria o teste falhar por culpa do arcabouco.
const CASCA = [
  ['tela-login', 'div'], ['form-login', 'form'], ['login-marca', 'div'],
  ['login-aviso', 'div'], ['login-email', 'input'], ['login-senha', 'input'],
  ['login-botao', 'button'], ['tela-app', 'div'], ['app-marca', 'div'],
  ['nav', 'nav'], ['perfil-nome', 'div'], ['perfil-papel', 'div'],
  ['botao-tema', 'button'], ['botao-sair', 'button'], ['area-sino', 'div'],
  ['conteudo', 'main'], ['area-modal', 'div'],
]
const IDS = CASCA.map(([id]) => id)

// O documento e' montado UMA vez para o arquivo inteiro. `app.js` se inicia na
// importacao, e reimportar — que e' como se simula abrir o painel de novo —
// acumula ouvintes que seguem apontando para os nos que capturaram. Com um
// documento novo por teste, os ouvintes velhos acordariam sobre um documento
// ja desmontado. No navegador isso nao existe: `app.js` carrega uma vez so.
const tela = montarDom({ ids: IDS })

// `form-login` precisa ser um <form> de verdade: `app.js` escuta o submit
// dele, e o DOM minimo so faz submit subir de um <form>.
function remontarCasca() {
  const corpo = tela.corpo
  for (const filho of [...corpo.filhos]) corpo.removeChild(filho)
  for (const [id, tag] of CASCA) {
    const no = tela.documento.createElement(tag)
    no.id = id
    if (id === 'botao-sair') no.textContent = 'Sair'
    if (id === 'login-botao') no.textContent = 'Entrar'
    corpo.append(no)
  }
  // As duas telas comecam ocultas, como no HTML.
  tela.documento.getElementById('tela-login').classList.add('oculto')
  tela.documento.getElementById('tela-app').classList.add('oculto')
}

// O sino do painel bate no servidor de minuto em minuto, com `setInterval`.
// O relogio dele e' real e esta certo — mas um timer aberto impede o processo
// do Node de terminar, e `node --test` so imprime quando o arquivo termina: a
// suite ficava pendurada em silencio, sem uma linha de saida, em vez de
// falhar. Ja aconteceu antes por outro motivo, e o sintoma e' o mesmo.
//
// `unref` nao desliga o relogio: ele continua batendo enquanto houver o que
// fazer. So deixa de ser motivo para o processo continuar de pe.
const intervaloReal = globalThis.setInterval
globalThis.setInterval = (...args) => {
  const t = intervaloReal(...args)
  t?.unref?.()
  return t
}

// ---------------------------------------------------------- rede de mentira
let respostas = {}
const pedidos = []

globalThis.fetch = async (url, opcoes = {}) => {
  const caminho = String(url).split('?')[0]
  pedidos.push({ caminho, metodo: opcoes.method || 'GET', corpo: opcoes.body })
  const r = respostas[caminho]
  if (!r) return { ok: false, status: 404, json: async () => ({ mensagem: 'nao encontrado' }) }
  if (r.falha) throw new TypeError('Failed to fetch')
  const status = r.status ?? 200
  return { ok: status < 400, status, json: async () => r.corpo ?? {} }
}

// ------------------------------------------------------------------ fixture
// `nivel` decide o menu inteiro: `contexto.ehFrota` le dele, e sem ele o
// painel abre com a navegacao vazia. Cargo NAO e' permissao — `cargo_nome` e'
// so o que aparece embaixo do nome.
const ADM = {
  id: 'usr_1', nome: 'Andre Roberth', email: 'adm@mylog.local',
  nivel: 'frota', cargo_nome: 'Equipe de frota',
  acessa_painel: 1, deve_trocar_senha: 0,
}

const MARCA = {
  nome_exibicao: 'Transportes Aurora',
  logo_url: null,
  definidos: { claro: {}, escuro: {} },
  efetivos: {
    claro: { marca: '#35539f', 'marca-forte': '#2a4280', tinta: '#ffffff' },
    escuro: { marca: '#7f9dff', 'marca-forte': '#a8bcff', tinta: '#10131a' },
  },
}

const contexto = () => ({ usuario: ADM, marca: MARCA })

let conta = 0
async function abrirPainel() {
  await import(`../../web/js/app.js?volta=${conta += 1}`)
  await assentar()
}

const doc = () => tela.documento
const texto = (id) => doc().getElementById(id)?.textContent ?? ''
const visivel = (id) => !doc().getElementById(id).classList.contains('oculto')
const folhaDePrevia = () => doc().querySelector('#marca-em-previa')
const temaForcado = () => doc().documentElement.getAttribute('data-tema')
const botaoDeTexto = (t) => tela.corpo.querySelectorAll('button')
  .find((b) => b.textContent.trim() === t)

beforeEach(() => {
  remontarCasca()
  pedidos.length = 0
  doc().documentElement.removeAttribute('data-tema')
  folhaDePrevia()?.remove()
  respostas = {
    '/api/auth/eu': { corpo: contexto() },
    '/api/auth/login': { corpo: contexto() },
    '/api/auth/sair': { corpo: { ok: true } },
    '/api/marca': { corpo: { marca: MARCA } },
    '/api/painel': { corpo: { painel: {} } },
    '/api/notificacoes': { corpo: { notificacoes: [], nao_lidas: 0 } },
  }
})

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 0))
})

after(() => tela.desmontar())

// =========================================================== entrar e sair
test('casca: com sessao valida o painel abre com o nome e o cargo', async () => {
  await abrirPainel()
  assert.equal(visivel('tela-app'), true, 'a tela do painel aparece')
  assert.equal(visivel('tela-login'), false, 'e a de login sai')
  assert.match(texto('perfil-nome'), /Andre Roberth/)
})

test('casca: sem sessao o painel para no login', async () => {
  respostas['/api/auth/eu'] = { status: 401, corpo: {} }
  await abrirPainel()
  assert.equal(visivel('tela-login'), true)
  assert.equal(visivel('tela-app'), false)
})

// ================================================ a previa nao vaza do lugar
test('marca: sair da tela de configuracoes NAO leva a cor nao publicada junto', async () => {
  // A tela de configuracoes pinta a PREVIA da marca numa folha de estilo no
  // `<head>` e leva o painel para o tema que esta sendo editado. Nada disso
  // esta dentro do no' da tela, entao `limpar(conteudo)` nao alcanca.
  //
  // O desmonte existia e funcionava — so nao era chamado no logout, que troca
  // de tela sem navegar. Quem espiasse uma cor e clicasse em "Sair" ia parar
  // num login pintado com a cor NAO PUBLICADA da empresa anterior, e com a
  // preferencia de tema sequestrada. A tela de login nao e' de empresa
  // nenhuma: era justamente o que a D59 dizia que nao acontecia.
  await abrirPainel()
  const config = botaoDeTexto('Configuracoes')
  assert.ok(config, 'controle: a Frota ve a secao de configuracoes')
  config.click()
  await assentar()

  // Espia uma cor sem publicar.
  const hex = tela.corpo.querySelectorAll('.config-hex')[0]
  assert.ok(hex, 'controle: a tela de configuracoes tem campo de cor')
  hex.value = '#8b0f6e'
  hex.dispatchEvent(new Evento('change'))
  await assentar()

  assert.ok(folhaDePrevia(), 'controle: a previa esta pintada')

  botaoDeTexto('Sair').click()
  await assentar()

  assert.equal(visivel('tela-login'), true, 'voltou para o login')
  assert.equal(folhaDePrevia(), null,
    'e a folha de previa saiu junto — o login nao e de empresa nenhuma')
  assert.equal(temaForcado(), null,
    'e o tema volta a ser o que a pessoa escolheu, nao o que estava sendo editado')
})

test('marca: navegar para outra secao tambem descarta a previa', async () => {
  // O caminho que ja funcionava. Fica como controle: a correcao do logout nao
  // pode ter quebrado a porta que estava certa.
  await abrirPainel()
  botaoDeTexto('Configuracoes').click()
  await assentar()

  const hex = tela.corpo.querySelectorAll('.config-hex')[0]
  hex.value = '#8b0f6e'
  hex.dispatchEvent(new Evento('change'))
  await assentar()
  assert.ok(folhaDePrevia(), 'controle: a previa esta pintada')

  botaoDeTexto('Painel').click()
  await assentar()
  assert.equal(folhaDePrevia(), null, 'a previa saiu ao navegar')
  assert.equal(temaForcado(), null, 'e o tema tambem')
})

// ============================================ mexer na cor nao arranca o campo
test('marca: editar o tema que NAO esta na tela nao troca o campo por baixo', async () => {
  // `<input type="color">` dispara `input` a cada movimento dentro do seletor
  // do sistema. A tela reconstruia tudo no PRIMEIRO movimento — para mostrar o
  // tema que estava sendo mexido — e o campo que a pessoa segurava era trocado
  // por outro: o seletor aberto ficava preso a um no' fora da arvore, e o
  // resto do arrasto nao chegava em lugar nenhum. Ficava gravada so a primeira
  // cor tocada, que quase nunca e a escolhida.
  //
  // Acontecia exatamente com quem entra no painel claro e vai ajustar o
  // escuro, que e o caminho normal.
  tela.preferirEscuro(false)
  await abrirPainel()
  botaoDeTexto('Configuracoes').click()
  await assentar()

  const blocoEscuro = tela.corpo.querySelectorAll('.config-bloco')
    .find((b) => b.dataset.tema === 'escuro')
  assert.ok(blocoEscuro, 'controle: o bloco do tema escuro esta identificado')
  assert.equal(temaForcado(), null, 'controle: o painel esta no tema claro')

  const cor = blocoEscuro.querySelectorAll('.config-cor')[0]
  assert.ok(cor, 'controle: o bloco escuro tem seletor de cor')

  // Primeiro movimento do arrasto: e aqui que a tela trocava tudo.
  cor.value = '#112233'
  cor.dispatchEvent(new Evento('input'))
  await assentar()

  assert.equal(temaForcado(), 'escuro', 'o painel foi para o tema que esta sendo mexido')

  const depois = tela.corpo.querySelectorAll('.config-bloco')
    .find((b) => b.dataset.tema === 'escuro')
    .querySelectorAll('.config-cor')[0]
  assert.equal(depois, cor,
    'e o campo continua sendo O MESMO no — trocar arranca o seletor da mao de quem mexe')

  // Segundo e terceiro movimentos: continuam chegando, que e o ponto.
  cor.value = '#445566'
  cor.dispatchEvent(new Evento('input'))
  await assentar()
  cor.value = '#778899'
  cor.dispatchEvent(new Evento('input'))
  await assentar()

  assert.equal(tela.corpo.querySelectorAll('.config-bloco')
    .find((b) => b.dataset.tema === 'escuro')
    .querySelectorAll('.config-cor')[0], cor,
    'o campo segue o mesmo depois do arrasto inteiro')

  // E o selo trocou de lado, que e o unico motivo do redesenho existir.
  assert.match(blocoEscuro.textContent, /na tela/,
    'o bloco escuro se anuncia como o que esta na tela')
  const blocoClaro = tela.corpo.querySelectorAll('.config-bloco')
    .find((b) => b.dataset.tema === 'claro')
  assert.match(blocoClaro.textContent, /Ver este tema/,
    'e o claro passa a oferecer o convite para ve-lo')
})
