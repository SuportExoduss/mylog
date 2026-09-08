// A tela inicial do aplicativo de campo, sobre o DOM minimo.
//
// E' a primeira tela que o colaborador ve depois de entrar, e a unica porta
// para executar qualquer checklist. Ate aqui ela nao tinha nenhum teste: o
// arquivo `app/js/app.js` era o unico do projeto sem cobertura de tela.
//
// O que este arquivo exercita e' o CAMINHO — quem entra, o que aparece, o que
// abre, o que sai junto com a sessao. Camera, IndexedDB e service worker ficam
// de fora; o roadmap 26 registra que eles seguem sendo passe manual.
import test, { after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom, Evento, estaVisivel } from './dom.js'

// `montarDom` instala o `navigator` de cada teste; este e' o de antes dele,
// para os modulos que leem `navigator` ja na importacao.
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true }, configurable: true, writable: true,
})

const assentar = async (voltas = 8) => {
  for (let i = 0; i < voltas; i += 1) await new Promise((r) => setImmediate(r))
}

// A foto e' comprimida com OffscreenCanvas e virada base64 com FileReader —
// nenhum dos dois existe no Node. Aqui nao se testa captura: se testa a tela.
globalThis.FileReader = class {
  readAsDataURL() { setTimeout(() => this.onload?.(), 0) }
  get result() { return 'data:image/jpeg;base64,AAAA' }
}

// ------------------------------------------------------------- rede de mentira
let temRede = true
let respostas = {}
const pedidos = []

const enviadas = []

globalThis.fetch = async (url, opcoes = {}) => {
  const caminho = String(url).split('?')[0]
  pedidos.push({ caminho, metodo: opcoes.method || 'GET' })
  if (caminho === '/api/inspecoes' && opcoes.method === 'POST') {
    enviadas.push(JSON.parse(opcoes.body))
  }
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
// O DOM e' montado UMA vez para o arquivo inteiro, e nao um por teste.
//
// `app.js` se inicia na importacao e assina `sincronia.aoMudar`. Reimportando
// o modulo a cada teste — que e' como se simula abrir o aplicativo de novo —
// essas assinaturas se acumulam, e as antigas seguem apontando para o `#app`
// que capturaram. Com um DOM novo por teste, a assinatura velha ia desenhar a
// tira de conexao num documento ja desmontado, depois do teste ter acabado.
//
// No aparelho isso nao existe: `app.js` e' carregado uma vez so. Mantendo o
// mesmo `#app`, as assinaturas velhas redesenham a tira do no' vivo — que e'
// exatamente o que a assinatura nova faria. O isolamento que importa (tela
// limpa, rede, fila, contexto) volta no `beforeEach`.
const tela = montarDom({ ids: ['app'] })
const area = tela.corpo.querySelector('#app')
let conta = 0

// Abre o aplicativo do zero, como quem toca no icone. Cada abertura importa
// `app.js` de novo — o modulo se inicia sozinho na importacao.
async function abrirApp() {
  await import(`../../app/js/app.js?volta=${conta += 1}`)
  await assentar()
}

const textoDaTela = () => tela.corpo.querySelector('#app').textContent
const cartoes = () => tela.corpo.querySelectorAll('.tarefa')
// Botao que a pessoa VE. Um botao escondido por `oculto` nao conta: quem esta
// no patio nao pode tocar no que nao aparece.
const botaoDeTexto = (t) => tela.corpo.querySelectorAll('button')
  .find((b) => b.textContent.trim() === t && estaVisivel(b))

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
  area.replaceChildren()
  tela.navegador.onLine = true
  temRede = true
  enviadas.length = 0
  pedidos.length = 0
  respostas = {
    '/api/auth/eu': { corpo: { usuario: ANA } },
    '/api/app/inicio': { corpo: contextoDe() },
    '/api/auth/sair': { corpo: { ok: true } },
    '/api/auth/login': { corpo: { usuario: ANA } },
    '/api/inspecoes': { corpo: { inspecao: { id: 'ins-1' } } },
  }
})

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 0))
})

after(() => tela.desmontar())

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

// ================================================= nada fica guardado no aparelho
test('sessao: sair leva junto tudo que estava na tela', async () => {
  // O aplicativo ja guardou o contexto — nome, cargo, placas e tarefas — num
  // deposito local, para abrir sem sinal. Aquilo custou dois furos de verdade:
  // depois do "Sair", uma abertura offline devolvia a tela inteira sem pedir
  // senha; e a rede caindo logo apos o login entregava a tela de quem usou o
  // aparelho antes para quem acabou de entrar.
  //
  // Sem deposito nao ha nenhum dos dois. Este teste guarda a propriedade, e
  // nao a correcao: quem reintroduzir um cache passa por aqui.
  respostas['/api/app/inicio'].corpo = contextoDe({ tarefas: [TAREFA] })
  await abrirApp()
  assert.match(textoDaTela(), /ABC1D23/, 'controle: a tarefa estava na tela')

  botaoDeTexto('Sair').click()
  await assentar()
  assert.match(textoDaTela(), /Entrar/, 'volta para o login')

  // Reabrir sem servidor: nao pode sobrar nada de onde reconstruir a tela.
  area.replaceChildren()
  respostas['/api/auth/eu'] = { status: 401, corpo: {} }
  temRede = false
  await abrirApp()
  const texto = textoDaTela()
  assert.doesNotMatch(texto, /Ola, Ana/, 'ninguem volta para a tela da Ana')
  assert.doesNotMatch(texto, /ABC1D23/, 'nem para as tarefas dela')
  assert.match(texto, /Entrar/, 'a tela e a de login')
})

test('sessao: sem servidor a tela diz que falta internet, e nao que falta senha', async () => {
  // Sao duas coisas diferentes e a pessoa age diferente em cada uma: numa ela
  // procura sinal, na outra ela procura a senha. Dizer a errada faz o
  // motorista digitar a senha certa tres vezes achando que errou.
  temRede = false
  await abrirApp()
  assert.match(textoDaTela(), /precisa de internet/,
    'o login explica que o problema e a conexao')
})

test('sessao: quem nunca entrou nao recebe aviso de sessao vencida', async () => {
  // Este teste ja existiu ao contrario, afirmando que a abertura sem sessao
  // dizia "Sua sessao expirou" — e passava, porque o codigo fazia isso. Quem
  // pegou foi o navegador, na primeira abertura limpa.
  //
  // As duas frases mandam a pessoa fazer coisas diferentes: uma manda procurar
  // sinal, a outra manda entrar de novo. Para quem abre o aplicativo pela
  // primeira vez, as duas mandam procurar um problema que nao existe.
  respostas['/api/auth/eu'] = { status: 401, corpo: {} }
  respostas['/api/app/inicio'] = { status: 401, corpo: {} }
  await abrirApp()

  const texto = textoDaTela()
  assert.match(texto, /Entrar/, 'a tela e a de login')
  assert.doesNotMatch(texto, /expirou/i, 'sem sessao nenhuma, nada expirou')
  assert.doesNotMatch(texto, /Sem conexao/, 'e o servidor respondeu — nao e a rede')
})

test('sessao: a sessao que vence DURANTE o uso avisa com essas palavras', async () => {
  // Aqui a pessoa estava dentro, e a credencial morreu no meio. Agora sim.
  await abrirApp()
  assert.match(textoDaTela(), /Ola, Ana/, 'controle: entrou e esta na tela dela')

  respostas['/api/app/inicio'] = { status: 401, corpo: {} }
  botaoDeTexto('Atualizar').click()
  await assentar()
  assert.match(textoDaTela(), /sessao expirou/i, 'e ai sim o assunto e a credencial')
})

test('inicio: soluco na primeira chamada nao derruba a abertura', async () => {
  // `/api/auth/eu` falha sozinho — um soluco de sinal — e o contexto vem
  // normalmente pela rede logo depois. A abertura tem que seguir: quem
  // respondeu a segunda chamada respondeu que a sessao esta viva.
  respostas['/api/auth/eu'] = { falha: true, corpo: {} }
  respostas['/api/app/inicio'].corpo = contextoDe({ tarefas: [TAREFA] })
  await abrirApp()

  const texto = textoDaTela()
  assert.match(texto, /Ola, Ana/, 'a tela abre assim mesmo — o contexto chegou')
  assert.match(texto, /ABC1D23/, 'com a tarefa que veio agora pela rede')
  assert.doesNotMatch(texto, /Sem conexao/,
    'e sem avisar de conexao, porque o dado acabou de chegar pela rede')
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

  area.replaceChildren()
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

// ================================================================= devolucao
// Leva a tarefa ate o fim: hodometro, todas as perguntas em OK, e finalizar.
async function executarTudoOk() {
  await comecarChecklist()
  while (botaoDeTexto('OK')) { botaoDeTexto('OK').click(); await assentar(1) }
  await assentar()
  const final = tela.corpo.querySelector('.exec-final')
  assert.ok(final, 'o resumo tem o botao de finalizar')
  final.click()
  await assentar()
}

const RETORNO = {
  ...TAREFA, momento: 'retorno',
  janela_fim: '2020-01-01T10:00:00.000Z',   // ha muito tempo: atrasada
}

test('devolucao: no retorno atrasado o motivo e pedido antes de encerrar', async () => {
  respostas['/api/app/inicio'].corpo = contextoDe({ tarefas: [RETORNO] })
  respostas['/api/solicitacoes/1/devolver'] = { corpo: { ok: true } }
  await abrirApp()
  cartoes()[0].click()
  await assentar()
  await executarTudoOk()

  assert.match(textoDaTela(), /Passou do prazo/, 'a tela do atraso aparece')
  botaoDeTexto('Enviar motivo e devolver').click()
  await assentar()
  assert.match(textoDaTela(), /Descreva o motivo do atraso/,
    'sem motivo escrito, nao encerra')

  tela.corpo.querySelector('textarea').value = 'a base estava fechada quando cheguei'
  botaoDeTexto('Enviar motivo e devolver').click()
  await assentar()
  assert.match(textoDaTela(), /Devolucao registrada com o motivo do atraso/)
  assert.ok(pedidos.some((p) => p.caminho === '/api/solicitacoes/1/devolver' && p.metodo === 'POST'),
    'e o motivo foi para o servidor')
})

test('devolucao: sem rede a tela nao vira ratoeira', async () => {
  // Esta tela nao tinha saida nenhuma: sem seta de voltar e com um unico
  // botao, que e' justamente o que nao funciona sem rede. Quem devolvesse o
  // carro no patio sem sinal ficava preso — o checklist ja na fila, o trabalho
  // feito, e o unico jeito de sair era matar o aplicativo.
  respostas['/api/app/inicio'].corpo = contextoDe({ tarefas: [RETORNO] })
  respostas['/api/solicitacoes/1/devolver'] = { falha: true, corpo: {} }
  await abrirApp()
  cartoes()[0].click()
  await assentar()
  await executarTudoOk()

  assert.equal(enviadas.length, 1, 'controle: o checklist ja subiu, o trabalho esta feito')
  assert.equal(pedidos.filter((p) => p.caminho === '/api/solicitacoes/1/devolver').length, 0,
    'controle: a devolucao em si ainda nao foi tentada')

  tela.corpo.querySelector('textarea').value = 'a base estava fechada quando cheguei'
  botaoDeTexto('Enviar motivo e devolver').click()
  await assentar()

  const sair = botaoDeTexto('Voltar ao inicio')
  assert.ok(sair, 'depois da falha existe um caminho de volta')
  assert.match(textoDaTela(), /ja foi enviado e esta gravado/,
    'e a tela diz o que ja esta seguro — nao promete uma fila que nao existe')
  assert.doesNotMatch(textoDaTela(), /sera enviado sozinho|salvo no aparelho/,
    'nada sobe sozinho depois: sem fila, isso seria mentira tranquilizadora')
  assert.match(textoDaTela(), /a equipe da frota encerra pelo painel/,
    'e quem fecha a devolucao quando ela nao vai')

  sair.click()
  await assentar()
  assert.match(textoDaTela(), /Ola, Ana/, 'e o caminho de volta leva mesmo ao inicio')
})

test('devolucao: enquanto da para encerrar direito, nao ha atalho para sair', async () => {
  // A saida so aparece DEPOIS da falha. Se aparecesse antes, viraria o jeito
  // facil de pular o motivo do atraso — que e' justamente o que esta tela
  // existe para colher.
  respostas['/api/app/inicio'].corpo = contextoDe({ tarefas: [RETORNO] })
  respostas['/api/solicitacoes/1/devolver'] = { corpo: { ok: true } }
  await abrirApp()
  cartoes()[0].click()
  await assentar()
  await executarTudoOk()

  assert.match(textoDaTela(), /Passou do prazo/)
  assert.equal(botaoDeTexto('Voltar ao inicio'), undefined,
    'sem falha, nao ha atalho para sair sem escrever o motivo')
  assert.equal(tela.corpo.querySelector('.topo-voltar'), null,
    'e nem seta de voltar')
})

// ============================================================== envio ao vivo
test('envio: falhou, e o checklist continua inteiro na mao de quem fez', async () => {
  // Sem fila, esta tela e' a unica coisa entre o trabalho feito e o trabalho
  // perdido. Quarenta perguntas e as fotos ja foram respondidas; a rede caiu
  // no ultimo passo. Ela nao pode se fechar sozinha nem voltar ao inicio por
  // engano.
  respostas['/api/app/inicio'].corpo = contextoDe({ tarefas: [TAREFA] })
  respostas['/api/inspecoes'] = { falha: true, corpo: {} }
  await abrirApp()
  cartoes()[0].click()
  await assentar()
  await executarTudoOk()

  assert.match(textoDaTela(), /Nao deu para enviar/)
  assert.match(textoDaTela(), /esta aqui na tela, inteiro/,
    'a tela diz onde o checklist esta')
  assert.ok(botaoDeTexto('Tentar enviar de novo'), 'e oferece a tentativa')

  // Voltou o sinal: a mesma inspecao sobe, com o mesmo identificador.
  respostas['/api/inspecoes'] = { corpo: { inspecao: { id: 'ins-1' } } }
  botaoDeTexto('Tentar enviar de novo').click()
  await assentar()
  assert.equal(enviadas.length, 2, 'a segunda tentativa reenvia a MESMA inspecao')
  assert.equal(enviadas[0].cliente_uuid, enviadas[1].cliente_uuid,
    'com o mesmo cliente_uuid — e por ele que o servidor recusa duplicar')
  assert.equal(enviadas[0].finalizada_em, enviadas[1].finalizada_em,
    'e a mesma hora de conclusao: quem terminou as 09h40 nao terminou as 10h05')
  assert.match(textoDaTela(), /Bom trabalho/, 'e o checklist fecha')
})

test('envio: descartar existe, mas cobra a confirmacao e diz o que custa', async () => {
  // Uma tela sem saida ja custou caro na devolucao. Mas sair daqui perde o
  // checklist de verdade — entao a saida existe, e nao finge que e' de graca.
  respostas['/api/app/inicio'].corpo = contextoDe({ tarefas: [TAREFA] })
  respostas['/api/inspecoes'] = { falha: true, corpo: {} }
  await abrirApp()
  cartoes()[0].click()
  await assentar()
  await executarTudoOk()

  assert.equal(botaoDeTexto('Perder o checklist e voltar'), undefined,
    'de saida, o descarte nao esta a um toque de distancia')

  botaoDeTexto('Descartar e voltar ao inicio').click()
  await assentar()
  assert.match(textoDaTela(), /PERDE este checklist/,
    'a confirmacao diz o que acontece, com todas as letras')

  respostas['/api/app/inicio'].corpo = contextoDe()
  botaoDeTexto('Perder o checklist e voltar').click()
  await assentar()
  assert.match(textoDaTela(), /Ola, Ana/, 'e ai sim volta ao inicio')
})

test('envio: sessao vencida manda entrar de novo, e nao insistir na rede', async () => {
  // "Tentar de novo" com a credencial morta tenta para sempre. A saida daqui
  // e' outra tela.
  respostas['/api/app/inicio'].corpo = contextoDe({ tarefas: [TAREFA] })
  respostas['/api/inspecoes'] = { status: 401, corpo: {} }
  await abrirApp()
  cartoes()[0].click()
  await assentar()
  await executarTudoOk()

  assert.equal(botaoDeTexto('Tentar enviar de novo'), undefined,
    'insistir na rede nao resolve credencial vencida')
  assert.ok(botaoDeTexto('Entrar de novo'), 'o caminho e a credencial')
  assert.match(textoDaTela(), /sessao expirou/i)
})

test('tira: sem rede o aviso aparece antes de comecar, e some quando ela volta', async () => {
  // Na era da fila a tira contava o que ainda nao tinha subido. Agora ela
  // avisa ANTES: ninguem pode comecar quarenta perguntas sem sinal e descobrir
  // no fim que nao da para enviar.
  await abrirApp()
  assert.equal(tela.corpo.querySelector('.tira'), null, 'com rede, nao ha aviso')

  tela.rede(false)
  await assentar()
  assert.match(textoDaTela(), /Nao da para enviar checklist agora/)

  tela.rede(true)
  await assentar()
  assert.equal(tela.corpo.querySelector('.tira'), null, 'voltou a rede, sai o aviso')
})

test('tela: nenhuma tela escreve a palavra "null" para o motorista', async () => {
  // `replaceChildren` do navegador converte `null` em TEXTO: passar um filho
  // condicional que nao existe escreve a palavra "null" na tela, entre os
  // outros. O `elemento()` filtra por dentro; `replaceChildren` e' navegador
  // cru, e nao filtra nada.
  //
  // A tela inicial do aplicativo mostrou "null" em todas as telas, no
  // navegador, com a suite inteira verde — porque o DOM de teste ignorava
  // nulos, e o navegador nao ignora. Quem pegou foi o navegador; este teste
  // existe para nao depender disso de novo.
  // Sem `\b`: o `textContent` cola os elementos sem espaco entre eles, entao a
  // palavra sai grudada — "Ola, AnaMotoristanullNenhum veiculo...". `\bnull\b`
  // nao casa ali, e a primeira versao deste teste nao podia falhar. Foi
  // conferida reintroduzindo o defeito, e passou verde: e' o unico jeito de
  // saber que um teste testa alguma coisa.
  const semNulo = (onde) => {
    const t = textoDaTela()
    assert.doesNotMatch(t, /null/, `a tela "${onde}" escreveu null`)
    assert.doesNotMatch(t, /undefined/, `a tela "${onde}" escreveu undefined`)
  }

  // Inicio COM rede: nao ha tira, e o filho condicional some.
  respostas['/api/app/inicio'].corpo = contextoDe({ tarefas: [RETORNO] })
  await abrirApp()
  semNulo('inicio')

  // Inicio SEM rede: a tira existe, e o rodape tambem.
  tela.rede(false)
  await assentar()
  semNulo('inicio sem rede')
  tela.rede(true)
  await assentar()

  // Execucao, envio e o desfecho: a tela de envio nao tem rodape nenhum.
  respostas['/api/solicitacoes/1/devolver'] = { corpo: { ok: true } }
  cartoes()[0].click()
  await assentar()
  semNulo('hodometro')
  await executarTudoOk()
  semNulo('devolucao')

  tela.corpo.querySelector('textarea').value = 'a base estava fechada quando cheguei'
  botaoDeTexto('Enviar motivo e devolver').click()
  await assentar()
  semNulo('feito')

  // E a tela de falha, que tem aviso, texto, confirmacao escondida e duas acoes.
  area.replaceChildren()
  respostas['/api/inspecoes'] = { falha: true, corpo: {} }
  respostas['/api/app/inicio'].corpo = contextoDe({ tarefas: [TAREFA] })
  await abrirApp()
  cartoes()[0].click()
  await assentar()
  await executarTudoOk()
  semNulo('envio falhou')
})

test('envio: sessao vencida no envio — entrar de novo RETOMA o checklist', async () => {
  // A tela de falha diz, com essas palavras, que entrar de novo envia o
  // checklist em seguida. Ela nao cumpria: o login levava ao inicio e a
  // inspecao morria com a tela — quarenta perguntas e as fotos, feitas no
  // patio, jogadas fora por uma promessa que a tela nao podia cumprir.
  respostas['/api/app/inicio'].corpo = contextoDe({ tarefas: [TAREFA] })
  respostas['/api/inspecoes'] = { status: 401, corpo: {} }
  await abrirApp()
  cartoes()[0].click()
  await assentar()
  await executarTudoOk()

  assert.match(textoDaTela(), /Nao deu para enviar/)
  botaoDeTexto('Entrar de novo').click()
  await assentar()
  assert.match(textoDaTela(), /o checklist sobe em seguida/,
    'a tela de login repete a promessa')

  // Credencial nova, e o servidor volta a aceitar.
  respostas['/api/inspecoes'] = { corpo: { inspecao: { id: 'ins-1' } } }
  const campos = tela.corpo.querySelectorAll('input')
  campos[0].value = 'ana@empresa.com'
  campos[1].value = 'segredo'
  tela.corpo.querySelector('form').dispatchEvent(new Evento('submit'))
  await assentar()

  assert.match(textoDaTela(), /Bom trabalho/, 'o checklist subiu, sem refazer nada')
  assert.equal(enviadas.length, 2, 'foi a MESMA inspecao, tentada duas vezes')
  assert.equal(enviadas[0].cliente_uuid, enviadas[1].cliente_uuid)
})

test('login: quem entra pela porta normal continua indo para o inicio', async () => {
  // A retomada e' excecao, e nao pode virar a regra: quem abre o aplicativo e
  // entra vai para a lista de tarefas, como sempre.
  respostas['/api/auth/eu'] = { status: 401, corpo: {} }
  respostas['/api/app/inicio'] = { status: 401, corpo: {} }
  await abrirApp()

  respostas['/api/app/inicio'] = { corpo: contextoDe({ tarefas: [TAREFA] }) }
  const campos = tela.corpo.querySelectorAll('input')
  campos[0].value = 'ana@empresa.com'
  campos[1].value = 'segredo'
  tela.corpo.querySelector('form').dispatchEvent(new Evento('submit'))
  await assentar()
  assert.match(textoDaTela(), /Ola, Ana/)
  assert.match(textoDaTela(), /ABC1D23/)
})

test('primeiro acesso: da para sair da troca de senha obrigatoria', async () => {
  // A tela nao tinha saida, e a falta sobrevivia ao recarregamento: a sessao ja
  // existe, entao a abertura le `deve_trocar_senha` e volta para ca. Quem
  // entrasse na conta errada prendia o aparelho ate o cookie vencer, doze horas
  // depois — e no patio o aparelho e da equipe, nao da pessoa.
  respostas['/api/auth/eu'] = { corpo: { usuario: { ...ANA, deve_trocar_senha: true } } }
  await abrirApp()
  assert.match(textoDaTela(), /Primeiro acesso/, 'a troca vem antes de tudo')

  // Recarregar nao escapa: e' o que fazia dela uma ratoeira.
  area.replaceChildren()
  await abrirApp()
  assert.match(textoDaTela(), /Primeiro acesso/, 'recarregar traz de volta para ca')

  const sair = botaoDeTexto('Nao sou eu — sair')
  assert.ok(sair, 'existe saida')
  respostas['/api/auth/eu'] = { status: 401, corpo: {} }
  respostas['/api/app/inicio'] = { status: 401, corpo: {} }
  sair.click()
  await assentar()

  assert.match(textoDaTela(), /Entrar/, 'e ela leva ao login')
  assert.ok(pedidos.some((p) => p.caminho === '/api/auth/sair' && p.metodo === 'POST'),
    'encerrando a sessao no servidor — sair nao pode ser so trocar de tela')
})

test('primeiro acesso: a troca continua obrigatoria — sair nao e pular', async () => {
  respostas['/api/auth/eu'] = { corpo: { usuario: { ...ANA, deve_trocar_senha: true } } }
  await abrirApp()
  assert.doesNotMatch(textoDaTela(), /Ola, Ana/,
    'nao ha caminho para a tela inicial sem trocar a senha')
  assert.equal(botaoDeTexto('Atualizar'), undefined)
})
