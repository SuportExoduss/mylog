// A tela inicial do aplicativo de campo, sobre o DOM minimo.
//
// E' a primeira tela que o colaborador ve depois de entrar, e a unica porta
// para executar qualquer checklist. Ate aqui ela nao tinha nenhum teste: o
// arquivo `app/js/app.js` era o unico do projeto sem cobertura de tela.
//
// O que este arquivo exercita e' o CAMINHO — quem entra, o que aparece, o que
// abre, o que sai junto com a sessao. Camera, IndexedDB e service worker ficam
// de fora; o roadmap 26 registra que eles seguem sendo passe manual.
import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom, Evento } from './dom.js'

// O modulo `sincronia` le `navigator.onLine` na importacao. Precisa existir
// antes dela — `montarDom` instala o dele depois, a cada teste.
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true }, configurable: true, writable: true,
})

const assentar = async (voltas = 8) => {
  for (let i = 0; i < voltas; i += 1) await new Promise((r) => setImmediate(r))
}

// ------------------------------------------------------ depositos de mentira
const armazem = await import('../../app/js/armazem.js')
const sincronia = await import('../../app/js/sincronia.js')

let guardado = null
armazem.contexto.guardar = async (d) => { guardado = d }
armazem.contexto.ler = async () => guardado
armazem.contexto.limpar = async () => { guardado = null }

let naFila = []
armazem.fila.enfileirar = async (i) => { naFila.push({ ...i, estado: 'pendente', tentativas: 0 }) }
armazem.fila.todas = async () => naFila
armazem.fila.pendentes = async () => naFila.filter((i) => i.estado !== 'enviada')
armazem.fila.marcar = async () => {}
armazem.fila.remover = async () => {}
armazem.fila.limparEnviadasAntigas = async () => {}

armazem.fotos.guardar = async () => {}
armazem.fotos.ler = async () => null
armazem.fotos.remover = async () => {}
armazem.fotos.daInspecao = async () => []

// ------------------------------------------------------------- rede de mentira
let temRede = true
let respostas = {}
const pedidos = []

globalThis.fetch = async (url, opcoes = {}) => {
  const caminho = String(url).split('?')[0]
  pedidos.push({ caminho, metodo: opcoes.method || 'GET' })
  if (!temRede) throw new TypeError('Failed to fetch')
  const r = respostas[caminho]
  if (!r) return { ok: false, status: 404, json: async () => ({}) }
  // `falha` derruba UM endereco so: e' assim que se testa a rede caindo no
  // meio do caminho, entre o login e o download do contexto.
  if (r.falha) throw new TypeError('Failed to fetch')
  const corpo = typeof r.corpo === 'function' ? r.corpo(opcoes) : r.corpo
  const status = r.status ?? 200
  return { ok: status < 400, status, json: async () => corpo, blob: async () => null }
}

// -------------------------------------------------------------------- fixture
const MODELO = {
  id: 7, codigo: 'CHK-DIA', nome: 'Checklist diario', versao: 1,
  finalidade: 'operacional', exige_assinatura: false, periodicidade: 'diaria',
  dias_semana: [], horario_limite: '08:00',
  estrutura: { perguntas: [{ id: 'pneus', titulo: 'Pneus', foto_ok: 'nao_capturar', max_fotos_ok: 1, opcoes_problema: [] }] },
}

const ANA = { id: 11, nome: 'Ana Souza', cargo_id: 3, cargo_nome: 'Motorista', usa_veiculo_diario: false }
const BRUNO = { id: 22, nome: 'Bruno Lima', cargo_id: 4, cargo_nome: 'Mecanico', usa_veiculo_diario: false }

const VEICULO = { id: 5, placa: 'ABC1D23', marca: 'Fiat', modelo: 'Strada', tipo: 'leve', km_atual: 1000, status: 'disponivel' }

function contextoDe({
  usuario = ANA, tarefas = [], preventivas = [], avulso = [], modelos = [MODELO],
} = {}) {
  return { usuario, tarefas, preventivas, avulso, modelos,
    politicas: { bloqueio_por_critica: true }, gerado_em: '2026-09-08T09:00:00.000Z' }
}

const TAREFA = {
  solicitacao_id: 1, numero: 'S-1', momento: 'saida',
  janela_inicio: '2026-09-08T09:00:00.000Z', janela_fim: '2026-09-08T18:00:00.000Z',
  motivo: 'Entrega', atrasada: false, template_id: MODELO.id, veiculo: VEICULO,
}
const PREVENTIVA = {
  preventiva_id: 2, momento: 'saida', status: 'vencida', modo: 'km',
  alvo: '20000 km', template_id: MODELO.id, veiculo: VEICULO,
}
const AVULSO = { veiculo: VEICULO, templates: [MODELO.id] }

// --------------------------------------------------------------------- ajuda
let tela
let conta = 0

// Abre o aplicativo do zero, como quem toca no icone. Cada abertura importa
// `app.js` de novo — o modulo se inicia sozinho na importacao.
async function abrirApp() {
  await import(`../../app/js/app.js?volta=${conta += 1}`)
  await assentar()
}

const textoDaTela = () => tela.corpo.querySelector('#app').textContent
const cartoes = () => tela.corpo.querySelectorAll('.tarefa')
const botaoDeTexto = (t) => tela.corpo.querySelectorAll('button')
  .find((b) => b.textContent.trim() === t)

// A execucao nao comeca nas perguntas: abre na leitura do hodometro, que e' o
// que amarra o checklist ao carro. So depois vem a primeira pergunta.
async function comecarChecklist(km = '41850') {
  assert.match(textoDaTela(), /Quilometragem do hodometro/,
    'a execucao abre pedindo o hodometro')
  tela.corpo.querySelector('#app').querySelector('input').value = km
  botaoDeTexto('Comecar checklist').click()
  await assentar()
}

beforeEach(() => {
  tela = montarDom({ ids: ['app'] })
  temRede = true
  guardado = null
  naFila = []
  pedidos.length = 0
  sincronia.estado.sessaoExpirada = false
  sincronia.estado.pendentes = 0
  sincronia.estado.ultimoErro = null
  sincronia.estado.online = true
  respostas = {
    '/api/auth/eu': { corpo: { usuario: ANA } },
    '/api/app/inicio': { corpo: contextoDe() },
    '/api/auth/sair': { corpo: { ok: true } },
    '/api/auth/login': { corpo: { usuario: ANA } },
  }
})

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 0))
  tela.desmontar()
})

// ============================================================ abertura basica
test('inicio: com sessao valida abre a tela da pessoa, com as tarefas dela', async () => {
  respostas['/api/app/inicio'].corpo = contextoDe({ tarefas: [TAREFA] })
  await abrirApp()

  const texto = textoDaTela()
  assert.match(texto, /Ola, Ana/, 'o titulo cumprimenta quem entrou')
  assert.match(texto, /Motorista/, 'e mostra o cargo, que e o que decide o checklist')
  assert.match(texto, /ABC1D23/, 'a placa da tarefa aparece')
  assert.equal(cartoes().length, 1)
})

test('inicio: sem nada para fazer, a tela diz o que esperar', async () => {
  await abrirApp()
  assert.match(textoDaTela(), /Nenhum veiculo aguardando checklist/)
  assert.equal(cartoes().length, 0)
})

// ====================================================== o contexto tem dono
test('inicio: sair leva junto o contexto baixado', async () => {
  // O contexto guardado tem nome, cargo, placas e as tarefas de quem estava
  // usando. Ficando no aparelho depois do "Sair", a proxima abertura SEM REDE
  // caia no caminho offline e devolvia essa tela inteira — sem senha, para
  // quem quer que estivesse com o aparelho na mao.
  //
  // O aparelho do patio passa de mao em mao. Sair tem que significar sair.
  respostas['/api/app/inicio'].corpo = contextoDe({ tarefas: [TAREFA] })
  await abrirApp()
  assert.ok(guardado, 'controle: o contexto foi baixado e guardado')

  botaoDeTexto('Sair').click()
  await assentar()
  assert.match(textoDaTela(), /Entrar/, 'volta para o login')
  assert.equal(guardado, null, 'e o contexto baixado sai junto')

  // A prova do que isso protege: reabrir sem rede nao pode voltar para a Ana.
  tela.desmontar()
  tela = montarDom({ ids: ['app'] })
  temRede = false
  await abrirApp()
  const texto = textoDaTela()
  assert.doesNotMatch(texto, /Ola, Ana/, 'sem sessao e sem rede, ninguem volta para a tela da Ana')
  assert.doesNotMatch(texto, /ABC1D23/, 'nem para as tarefas dela')
  assert.match(texto, /Entrar/, 'a tela e a de login')
})

test('inicio: quem entra nao herda a tela de quem usou o aparelho antes', async () => {
  // Ana usou o aparelho e o contexto dela ficou guardado. Bruno entra, e a
  // rede cai no instante seguinte — entre o login e o download.
  //
  // O caminho offline devolvia o contexto guardado sem olhar de quem era: o
  // Bruno recebia o nome da Ana, o cargo da Ana, os veiculos e os checklists
  // da Ana para executar. O aviso de "sem conexao" aparecia; o nome trocado,
  // ninguem repara.
  guardado = { ...contextoDe({ usuario: ANA, tarefas: [TAREFA] }), baixado_em: '2026-09-08T08:00:00.000Z' }

  // Sem sessao o servidor recusa as duas portas, como recusa de verdade.
  respostas['/api/auth/eu'] = { status: 401, corpo: {} }
  respostas['/api/app/inicio'] = { status: 401, corpo: {} }
  await abrirApp()
  assert.match(textoDaTela(), /Entrar/, 'controle: comeca no login')

  respostas['/api/auth/login'] = { corpo: { usuario: BRUNO } }
  respostas['/api/app/inicio'] = { falha: true, corpo: {} }

  const campos = tela.corpo.querySelectorAll('input')
  campos[0].value = 'bruno@empresa.com'
  campos[1].value = 'segredo'
  tela.corpo.querySelector('form').dispatchEvent(new Evento('submit'))
  await assentar()

  const texto = textoDaTela()
  assert.doesNotMatch(texto, /Ola, Ana/, 'o Bruno nao pode ser cumprimentado como Ana')
  assert.doesNotMatch(texto, /Motorista/, 'nem receber o cargo dela, que e o que libera checklist')
  assert.doesNotMatch(texto, /ABC1D23/, 'nem as tarefas dela')
})

test('inicio: o proprio dono reabre sem rede e continua vendo o que baixou', async () => {
  // O contrario do teste acima, e igualmente importante: a confirmacao do dono
  // nao pode fechar a abertura offline legitima. Quem baixou o contexto abre o
  // aplicativo no patio, sem sinal, e ve o que tem para fazer.
  guardado = { ...contextoDe({ usuario: ANA, tarefas: [TAREFA] }), baixado_em: '2026-09-08T08:00:00.000Z' }
  temRede = false
  await abrirApp()

  const texto = textoDaTela()
  assert.match(texto, /Ola, Ana/, 'a Ana volta para a tela dela')
  assert.match(texto, /ABC1D23/, 'com as tarefas que ela baixou')
  assert.match(texto, /Sem conexao/, 'e a tela avisa que o que ela ve e do cache')
})

test('inicio: soluco na primeira chamada nao faz a tela mentir que esta offline', async () => {
  // `/api/auth/eu` falha sozinho — um soluco de sinal — e o contexto vem
  // normalmente pela rede logo depois.
  //
  // A abertura tinha uma copia de `carregar` que marcava "veio do cache" fixo,
  // sem olhar de onde o dado veio. A tela abria com dado FRESCO estampando
  // "Sem conexao. Mostrando o que foi baixado em algum momento."
  //
  // Esse aviso e' o que separa "o que eu fiz ja saiu do aparelho" de "ainda
  // esta aqui comigo". Um aviso que aparece sem motivo deixa de ser lido.
  respostas['/api/auth/eu'] = { falha: true, corpo: {} }
  respostas['/api/app/inicio'].corpo = contextoDe({ tarefas: [TAREFA] })
  await abrirApp()

  const texto = textoDaTela()
  assert.match(texto, /Ola, Ana/, 'a tela abre assim mesmo — o contexto chegou')
  assert.match(texto, /ABC1D23/, 'com a tarefa que veio agora pela rede')
  assert.doesNotMatch(texto, /Sem conexao/,
    'e sem dizer que esta offline, porque o dado acabou de chegar pela rede')
})

test('inicio: sem contexto nenhum, a tela diz o que fazer', async () => {
  // A copia caia num login mudo. Quem abre o aplicativo pela primeira vez no
  // patio, sem sinal, precisa saber que falta baixar — nao ficar olhando um
  // formulario que nao vai funcionar.
  temRede = false
  await abrirApp()
  assert.match(textoDaTela(), /Conecte-se uma vez/,
    'o login explica que ainda nao ha nada baixado neste aparelho')
})

// ================================================================ o toque morto
test('inicio: cartao sem checklist liberado nao se oferece para ser tocado', async () => {
  // As tres aberturas — tarefa, preventiva e avulso — comecam com
  // `if (!modelo) return`. O cartao continuava sendo um botao: a pessoa tocava,
  // nada acontecia, e ela tocava de novo. Um botao que nao responde le-se como
  // aplicativo quebrado, nao como explicacao.
  //
  // Fora isso, o cartao avulso nao dizia UMA PALAVRA sobre o motivo — os outros
  // dois ja diziam. Ficava so a placa e o silencio.
  respostas['/api/app/inicio'].corpo = contextoDe({
    tarefas: [TAREFA], preventivas: [PREVENTIVA], avulso: [AVULSO], modelos: [],
  })
  await abrirApp()

  const cartao = cartoes()
  assert.equal(cartao.length, 3, 'os tres cartoes aparecem — some-los seria pior')
  for (const c of cartao) {
    assert.equal(c.disabled, true, 'sem checklist liberado, o cartao nao convida o toque')
  }

  const antes = textoDaTela()
  for (const c of cartao) c.click()
  await assentar()
  assert.equal(textoDaTela(), antes, 'e tocar nao leva a lugar nenhum, sem tela intermediaria')

  // Cada um dos tres diz por que, com todas as letras.
  assert.equal(
    tela.corpo.querySelectorAll('.tarefa-alerta')
      .filter((a) => /Nenhum checklist liberado/.test(a.textContent)).length,
    3,
    'os tres explicam o motivo — inclusive o avulso, que antes ficava calado')
})

test('inicio: com checklist liberado, o cartao abre a execucao', async () => {
  // O contrario do teste acima: travar o cartao sem modelo nao pode travar o
  // caminho normal, que e' o unico jeito de executar um checklist no MyLog.
  respostas['/api/app/inicio'].corpo = contextoDe({ tarefas: [TAREFA] })
  await abrirApp()

  const cartao = cartoes()[0]
  assert.equal(cartao.disabled, false, 'com modelo, o cartao esta liberado')
  cartao.click()
  await assentar()
  await comecarChecklist()
  assert.match(textoDaTela(), /Pneus/, 'a primeira pergunta do checklist aparece')
})

test('inicio: preventiva e avulso tambem abrem', async () => {
  respostas['/api/app/inicio'].corpo = contextoDe({ preventivas: [PREVENTIVA] })
  await abrirApp()
  assert.match(textoDaTela(), /VENCIDA/, 'a preventiva vencida se anuncia como vencida')
  cartoes()[0].click()
  await assentar()
  await comecarChecklist()
  assert.match(textoDaTela(), /Pneus/, 'a preventiva abre o checklist dela')

  tela.desmontar()
  tela = montarDom({ ids: ['app'] })
  respostas['/api/app/inicio'].corpo = contextoDe({ avulso: [AVULSO] })
  await abrirApp()
  assert.match(textoDaTela(), /Escolha o veiculo/, 'o avulso explica que a pessoa escolhe o carro')
  cartoes()[0].click()
  await assentar()
  await comecarChecklist()
  assert.match(textoDaTela(), /Pneus/, 'e abre o checklist do carro escolhido')
})

test('inicio: o que precisa de aviso aparece com aviso', async () => {
  respostas['/api/app/inicio'].corpo = contextoDe({
    tarefas: [{ ...TAREFA, momento: 'retorno', atrasada: true }],
    avulso: [{ ...AVULSO, veiculo: { ...VEICULO, status: 'com_pendencia' } }],
  })
  await abrirApp()
  const texto = textoDaTela()
  assert.match(texto, /Passou do prazo de devolucao/, 'a tarefa atrasada avisa')
  assert.match(texto, /RETORNO/, 'e diz que o momento e o retorno, nao a saida')
  assert.match(texto, /ocorrencia em aberto/, 'e o carro com pendencia avisa antes do toque')
})
