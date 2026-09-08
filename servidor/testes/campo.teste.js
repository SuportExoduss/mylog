// Execucao do checklist no aplicativo de campo, sobre o DOM minimo.
//
// Esta e' a tela que decide se o checklist vai ser feito direito: quem
// preenche esta de pe no patio, com pressa e as vezes de luva. Um botao que
// mente sobre o que falta nao e' detalhe de acabamento — e' o motorista
// girando na tela ate desistir.
//
// Fotos e assinatura ficam de fora: dependem de IndexedDB, camera e canvas.
// O roadmap 26 registra isso como passe manual obrigatorio.
import test, { beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from './dom.js'

// Drena a fila de microtarefas: as cadeias do envio tem mais de um await.
const assentar = async (voltas = 3) => {
  for (let i = 0; i < voltas; i += 1) await new Promise((r) => setImmediate(r))
}

let tela
beforeEach(() => { tela = montarDom({ ids: ['app'] }) })
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 0))
  tela.desmontar()
})

const { executarChecklist } = await import('../../app/js/checklist.js')

// O deposito de fotos e' IndexedDB, que nao existe aqui. Trocamos so ele por
// um Map: o que estes testes exercitam e' a TELA — quando a foto aparece, o
// que ela desbloqueia, o que trava o Proximo. Guardar bytes num navegador de
// verdade e' outro assunto, e o roadmap 26 registra que ele continua sendo
// passe manual.
const { fotos: depositoDeFotos } = await import('../../app/js/armazem.js')
const fotosGuardadas = new Map()
depositoDeFotos.guardar = async (foto) => { fotosGuardadas.set(foto.id, foto) }
depositoDeFotos.remover = async (id) => { fotosGuardadas.delete(id) }
depositoDeFotos.ler = async (id) => fotosGuardadas.get(id)

// Sem foto obrigatoria em lugar nenhum: o que se testa aqui e' a navegacao e
// o julgamento, nao a captura.
const ESTRUTURA = {
  perguntas: [
    { id: 'lataria', titulo: 'Lataria', foto_ok: 'nao_capturar', max_fotos_ok: 1,
      opcoes_problema: [
        { id: 'risco', nome: 'Risco na pintura', foto: 'nao_capturar', max_fotos: 1,
          abrir_ocorrencia: true, prioridade: 'baixa' },
        { id: 'amassado', nome: 'Lataria amassada', foto: 'nao_capturar', max_fotos: 1,
          abrir_ocorrencia: true, prioridade: 'media' },
      ] },
    { id: 'freios', titulo: 'Freio de servico', foto_ok: 'nao_capturar', max_fotos_ok: 1,
      opcoes_problema: [
        { id: 'folga', nome: 'Folga no pedal', foto: 'nao_capturar', max_fotos: 1,
          abrir_ocorrencia: true, prioridade: 'critica' },
      ] },
  ],
}

function montarChecklist({ exigeAssinatura = false, aoConcluir = () => {}, estrutura = ESTRUTURA } = {}) {
  const raiz = executarChecklist({
    tarefa: {
      solicitacao_id: 'sol_1', momento: 'saida', template_id: 'tpl_1',
      veiculo: { id: 'v1', placa: 'ABC1D23', modelo: 'Strada' },
      politicas: {},
    },
    modelo: {
      id: 'tpl_1', nome: 'Checklist diario', versao: 1,
      exige_assinatura: exigeAssinatura, estrutura,
    },
    aoConcluir,
    aoSair: () => {},
  })
  tela.documento.getElementById('app').append(raiz)
  return raiz
}

const botao = (raiz, texto) =>
  raiz.querySelectorAll('button').find((b) => b.textContent.trim() === texto)
const folha = (raiz) => raiz.querySelector('.folha-fundo')

function comecar(raiz, km = '41850') {
  raiz.querySelector('input').value = km
  botao(raiz, 'Comecar checklist').click()
}

// OCORRENCIA abre primeiro a folha de foto — a camera vem ANTES da escolha do
// problema (roadmap 11.4) e nao trava quando o aparelho nao responde. Aqui ela
// nunca responde, entao segue-se pelo "Proximo" ate a lista de problemas.
function abrirProblema(raiz) {
  botao(raiz, 'OCORRENCIA').click()
  botao(folha(raiz), 'Proximo').click()
  return folha(raiz)
}

const escolher = (raiz, nome) =>
  folha(raiz).querySelectorAll('.opcao').find((o) => o.textContent.includes(nome)).click()

// ---------------------------------------------------------------- entrada

test('campo: o checklist abre pedindo o hodometro antes da primeira pergunta', () => {
  const raiz = montarChecklist()
  assert.match(raiz.textContent, /Quilometragem do hodometro/)
  assert.ok(botao(raiz, 'Comecar checklist'), 'a leitura de KM vem antes de tudo')
})

test('campo: OCORRENCIA a esquerda e OK a direita, nesta ordem', () => {
  // Roadmap 11.4, e o usuario foi explicito: vermelho na esquerda, verde na
  // direita. Trocar os lados troca a resposta de quem preenche no automatico.
  const raiz = montarChecklist()
  comecar(raiz)

  const rodape = raiz.querySelector('.exec-rodape')
  const decisoes = rodape.querySelectorAll('button').map((b) => b.textContent.trim())
  assert.deepEqual(decisoes, ['OCORRENCIA', 'OK'])
})

// -------------------------------------------------------------- navegacao

test('campo: a seta so avanca ate onde ja foi respondido', () => {
  const raiz = montarChecklist()
  comecar(raiz)

  const proxima = () => raiz.querySelectorAll('button').find((b) => ['›', '✓'].includes(b.textContent.trim()))
  assert.equal(proxima().disabled, true, 'sem resposta nao ha para onde ir')

  botao(raiz, 'OK').click()
  assert.match(raiz.textContent, /Freio de servico/, 'responder avanca sozinho')
})

test('campo: com tudo respondido, a seta vira o caminho para o resumo', () => {
  const raiz = montarChecklist()
  comecar(raiz)
  botao(raiz, 'OK').click()
  botao(raiz, 'OK').click()

  assert.match(raiz.textContent, /Antes de finalizar/)
})

test('campo: voltar para corrigir nao apaga o que ja foi respondido', () => {
  const raiz = montarChecklist()
  comecar(raiz)
  botao(raiz, 'OK').click()
  botao(raiz, 'OK').click()

  // Do resumo, clicar na linha leva de volta aquela pergunta.
  const linha = raiz.querySelectorAll('.resumo-linha')
    .find((l) => l.textContent.includes('Lataria'))
  linha.click()

  assert.match(raiz.textContent, /Ja respondida como OK/,
    'a tela precisa avisar que responder de novo substitui')
})

// ----------------------------------------------------------- uma folha so

test('campo: dois toques em OK nao empilham a folha de foto opcional', () => {
  // Este e' o unico caminho onde o empilhamento e' possivel no JS: `capturar()`
  // ja remove a folha antes de redesenhar, mas a folha de foto OPCIONAL e'
  // pendurada direto por `marcarOk`. No navegador o fundo (fixed, inset:0)
  // ainda intercepta o segundo toque, entao a guarda em `folha()` e' a segunda
  // trava, nao a unica. Aqui nao ha CSS: o que se testa e' a invariante em si —
  // uma folha por vez — sem depender de estilo para valer.
  const raiz = montarChecklist({
    estrutura: {
      perguntas: [{
        id: 'lataria', titulo: 'Lataria', foto_ok: 'opcional', max_fotos_ok: 2,
        opcoes_problema: [{ id: 'risco', nome: 'Risco', foto: 'nao_capturar',
          max_fotos: 1, abrir_ocorrencia: true, prioridade: 'baixa' }],
      }],
    },
  })
  comecar(raiz)

  botao(raiz, 'OK').click()
  assert.equal(raiz.querySelectorAll('.folha-fundo').length, 1)
  assert.match(folha(raiz).textContent, /Quer registrar uma foto\?/)

  botao(raiz, 'OK').click()
  assert.equal(raiz.querySelectorAll('.folha-fundo').length, 1,
    'uma folha por vez, sempre')
})

// ------------------------------------------------------------- ocorrencia

test('campo: escolher o problema carrega a prioridade configurada', () => {
  const raiz = montarChecklist()
  comecar(raiz)

  const lista = abrirProblema(raiz)
  assert.match(lista.textContent, /O que foi encontrado\?/)

  const opcoes = lista.querySelectorAll('.opcao').map((o) => o.textContent)
  assert.ok(opcoes.some((t) => /Risco na pintura/.test(t) && /baixa/.test(t)))
  assert.ok(opcoes.some((t) => /Lataria amassada/.test(t) && /media/.test(t)))
})

test('campo: ocorrencia critica avisa que o veiculo sera bloqueado', () => {
  const raiz = montarChecklist()
  comecar(raiz)
  botao(raiz, 'OK').click()                       // lataria conforme

  abrirProblema(raiz)                             // freios
  escolher(raiz, 'Folga no pedal')

  assert.match(raiz.textContent, /BLOQUEAR o veiculo/,
    'quem preenche precisa saber a consequencia antes de finalizar')
})

test('campo: prioridade baixa nao anuncia consequencia que nao existe', () => {
  // Roadmap 12.2: baixa entra na fila e o veiculo segue disponivel. Anunciar
  // pendencia aqui ensinaria o motorista a ignorar o aviso quando ele importa.
  const raiz = montarChecklist()
  comecar(raiz)

  abrirProblema(raiz)
  escolher(raiz, 'Risco na pintura')
  botao(raiz, 'OK').click()

  assert.match(raiz.textContent, /Antes de finalizar/)
  assert.doesNotMatch(raiz.textContent, /BLOQUEAR|ficara com pendencia/)
})

// ----------------------------------------------------------------- resumo

test('campo: o resumo conta conformes e ocorrencias', () => {
  const raiz = montarChecklist()
  comecar(raiz)
  abrirProblema(raiz)
  escolher(raiz, 'Lataria amassada')
  botao(raiz, 'OK').click()

  const numeros = raiz.querySelectorAll('.resumo-numeros')[0].textContent
  assert.match(numeros, /1[\s\S]*conformes/)
  assert.match(numeros, /1[\s\S]*ocorrencias/)
})

test('campo: o botao final nomeia o que falta, nao apenas que falta', () => {
  // O defeito era dizer "Falta responder" com tudo respondido e so a
  // assinatura em branco: manda procurar pergunta vazia que nao existe.
  const raiz = montarChecklist({ exigeAssinatura: true })
  comecar(raiz)
  botao(raiz, 'OK').click()
  botao(raiz, 'OK').click()

  const final = raiz.querySelector('.exec-rodape--unico').querySelector('button')
  assert.equal(final.textContent.trim(), 'Falta assinar')
  assert.equal(final.disabled, true)
})

test('campo: sem pendencia, o botao final libera o envio', () => {
  const raiz = montarChecklist()
  comecar(raiz)
  botao(raiz, 'OK').click()
  botao(raiz, 'OK').click()

  const final = raiz.querySelector('.exec-rodape--unico').querySelector('button')
  assert.equal(final.textContent.trim(), 'Finalizar checklist')
  assert.equal(final.disabled, false)
})

test('campo: o envio leva o julgamento e a leitura do hodometro', () => {
  let enviado = null
  const raiz = montarChecklist({ aoConcluir: (d) => { enviado = d } })
  comecar(raiz, '41850')
  botao(raiz, 'OK').click()
  abrirProblema(raiz)
  escolher(raiz, 'Folga no pedal')

  raiz.querySelector('.exec-rodape--unico').querySelector('button').click()

  assert.equal(enviado.momento, 'saida')
  assert.equal(enviado.km_informado, 41850)
  assert.equal(enviado.solicitacao_id, 'sol_1')
  assert.ok(enviado.cliente_uuid, 'o uuid nasce no aparelho: e ele que evita duplicar na fila')
  assert.equal(enviado.respostas.lataria.desfecho, 'ok')
  assert.equal(enviado.respostas.freios.opcao_id, 'folga')
  assert.equal(enviado.resumo.estado_veiculo_previsto, 'bloqueado')
})

// -------------------------------------- retorno de checklist de preventiva

// Foto obrigatoria: o retorno de preventiva e' fotografico por natureza — a
// prova de que a peca foi mexida e' a imagem dela depois do servico.
const ESTRUTURA_PREVENTIVA = {
  perguntas: [
    { id: 'pinca', titulo: 'Pinca de freio', foto_ok: 'obrigatorio', max_fotos_ok: 2,
      opcoes_problema: [{ id: 'pastilha', nome: 'Pastilha no limite', foto: 'obrigatorio',
        max_fotos: 2, abrir_ocorrencia: true, prioridade: 'alta' }] },
    { id: 'correia', titulo: 'Correia dentada', foto_ok: 'obrigatorio', max_fotos_ok: 2,
      opcoes_problema: [{ id: 'ressecada', nome: 'Correia ressecada', foto: 'obrigatorio',
        max_fotos: 2, abrir_ocorrencia: true, prioridade: 'critica' }] },
  ],
}

function montarPreventiva({ aoConcluir = () => {} } = {}) {
  const raiz = executarChecklist({
    tarefa: {
      preventiva_id: 'prev_1', solicitacao_id: null, momento: 'retorno',
      template_id: 'tpl_prev',
      veiculo: { id: 'v1', placa: 'GHI3J67', modelo: 'Kwid', km_atual: 96700 },
      politicas: {},
    },
    modelo: {
      id: 'tpl_prev', nome: 'Preventiva — revisao', versao: 1,
      finalidade: 'preventiva', exige_assinatura: false,
      estrutura: ESTRUTURA_PREVENTIVA,
    },
    aoConcluir,
    aoSair: () => {},
  })
  tela.documento.getElementById('app').append(raiz)
  return raiz
}

// A camera nunca responde no arcabouco. Como a tela do retorno so avanca com
// foto, injetamos o arquivo direto no input, como o navegador faria.
async function fotografar(raiz) {
  botao(raiz, 'Proximo').click()
  await new Promise((r) => setTimeout(r, 0))
  const entrada = tela.documento.querySelector('input')
  // Blob de verdade: `URL.createObjectURL` do Node recusa objeto simples, e a
  // tela usa o endereco para trocar a foto de exemplo pela foto tirada.
  entrada.files = [new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })]
  entrada.dispatchEvent(new Event('change'))
  await new Promise((r) => setTimeout(r, 0))
}

test('preventiva: o retorno abre com a foto de exemplo e um caminho so', () => {
  // Roadmap 14.2.2: foto de exemplo, e "Proximo" abre a camera. Nao ha OK nem
  // OCORRENCIA aqui — a pergunta do retorno e' outra.
  const raiz = montarPreventiva()
  comecar(raiz, '96900')

  assert.match(raiz.textContent, /Pinca de freio/)
  assert.match(raiz.textContent, /Fotografe a peca como no exemplo/)

  const rodape = raiz.querySelector('.exec-rodape')
  assert.deepEqual(rodape.querySelectorAll('button').map((b) => b.textContent.trim()),
    ['Proximo'])
  assert.equal(botao(raiz, 'OK'), undefined, 'retorno de preventiva nao julga conformidade')
  assert.equal(botao(raiz, 'OCORRENCIA'), undefined)
})

test('preventiva: com a foto, aparece a pergunta do servico e o relatorio', async () => {
  const raiz = montarPreventiva()
  comecar(raiz, '96900')
  await fotografar(raiz)

  assert.match(raiz.textContent, /Foi feito manutencao\?/)
  assert.ok(raiz.querySelector('.exec-relato'), 'toda pergunta tem area de relatorio')
  assert.match(raiz.textContent, /Foto 1 de ate 2/)

  // Os tres botoes do padrao.
  const rodape = raiz.querySelector('.exec-rodape--tres')
  assert.deepEqual(rodape.querySelectorAll('button').map((b) => b.textContent.trim()),
    ['Tirar novamente', '+ foto', 'Proximo'])
})

test('preventiva: sem responder sim ou nao, nao avanca', async () => {
  const raiz = montarPreventiva()
  comecar(raiz, '96900')
  await fotografar(raiz)

  assert.equal(botao(raiz, 'Proximo').disabled, true,
    'a pergunta do servico precisa de resposta')

  botao(raiz, 'Nao').click()
  assert.equal(botao(raiz, 'Proximo').disabled, false)
})

test('preventiva: disse SIM e nao descreveu, o Proximo trava', async () => {
  // Mexer numa peca sem dizer o que foi feito produz registro que nao serve
  // para nada (roadmap 14.2.2).
  const raiz = montarPreventiva()
  comecar(raiz, '96900')
  await fotografar(raiz)

  botao(raiz, 'Sim').click()
  assert.equal(botao(raiz, 'Proximo').disabled, true)
  assert.match(raiz.textContent, /descreva o que foi feito/i)

  const relato = raiz.querySelector('.exec-relato')
  relato.value = 'Pastilha e disco trocados.'
  relato.dispatchEvent(new Event('input'))
  botao(raiz, 'Sim').click()          // redesenha com o texto guardado

  assert.equal(botao(raiz, 'Proximo').disabled, false)
})

test('preventiva: disse NAO, o relatorio segue opcional', async () => {
  const raiz = montarPreventiva()
  comecar(raiz, '96900')
  await fotografar(raiz)

  botao(raiz, 'Nao').click()
  assert.match(raiz.textContent, /Relatorio desta foto/,
    'o campo continua ali, so nao obriga')
  assert.equal(botao(raiz, 'Proximo').disabled, false)
})

test('preventiva: antes da assinatura, o resumo pergunta quando vence a proxima', async () => {
  const raiz = montarPreventiva()
  comecar(raiz, '96900')

  for (const _ of ESTRUTURA_PREVENTIVA.perguntas) {
    await fotografar(raiz)
    botao(raiz, 'Nao').click()
    botao(raiz, 'Proximo').click()
  }

  assert.match(raiz.textContent, /Antes de finalizar/)
  assert.match(raiz.textContent, /Quando vence a proxima\?/)
  assert.ok(botao(raiz, 'Por KM'), 'as mesmas duas opcoes do cadastro')
  assert.ok(botao(raiz, 'Por data'))

  // Sem informar a proxima, nao finaliza.
  const final = raiz.querySelector('.exec-rodape--unico').querySelector('button')
  assert.equal(final.disabled, true)
  assert.match(final.textContent, /proxima/i)
})

test('preventiva: informada a proxima, o envio leva tudo junto', async () => {
  let enviado = null
  const raiz = montarPreventiva({ aoConcluir: (d) => { enviado = d } })
  comecar(raiz, '96900')

  await fotografar(raiz)
  botao(raiz, 'Sim').click()
  const relato = raiz.querySelector('.exec-relato')
  relato.value = 'Pastilha e disco trocados.'
  relato.dispatchEvent(new Event('input'))
  botao(raiz, 'Sim').click()
  botao(raiz, 'Proximo').click()

  await fotografar(raiz)
  botao(raiz, 'Nao').click()
  botao(raiz, 'Proximo').click()

  const km = raiz.querySelector('.exec-numero')
  km.value = '110000'
  km.dispatchEvent(new Event('change'))

  const final = raiz.querySelector('.exec-rodape--unico').querySelector('button')
  assert.equal(final.disabled, false)
  assert.equal(final.textContent.trim(), 'Finalizar checklist')
  final.click()

  assert.equal(enviado.preventiva_id, 'prev_1')
  assert.deepEqual(enviado.proxima_preventiva, { modo: 'km', proximo_km: 110000 })
  assert.equal(enviado.respostas.pinca.manutencao_feita, true)
  assert.equal(enviado.respostas.pinca.relatorio, 'Pastilha e disco trocados.')
  assert.equal(enviado.respostas.correia.manutencao_feita, false)
  assert.equal(enviado.resumo.itens_com_manutencao, 1)
})

// ------------------------------------------ fila: a retentativa que faltava

const sincronia = await import('../../app/js/sincronia.js')
const { fila: filaReal } = await import('../../app/js/armazem.js')

test('fila: a espera cresce e para de crescer', () => {
  // Insistir de segundo em segundo gasta bateria de quem esta no patio o dia
  // inteiro; desistir deixa o checklist no aparelho.
  const semSorteio = () => 0
  const esperas = [0, 1, 2, 3, 4, 5, 9].map((n) => sincronia.proximaEspera(n, semSorteio))
  assert.deepEqual(esperas, [15_000, 30_000, 60_000, 120_000, 300_000, 300_000, 300_000],
    'cresce ate cinco minutos e fica nos cinco')
})

test('fila: o desvio existe, e e pequeno', () => {
  // Quarenta aparelhos voltando juntos quando a torre volta nao podem bater no
  // servidor no mesmo segundo — nem esperar o dobro por causa disso.
  const cheio = sincronia.proximaEspera(0, () => 1)
  const vazio = sincronia.proximaEspera(0, () => 0)
  assert.equal(vazio, 15_000)
  assert.ok(cheio > vazio, 'sem desvio, o rebanho inteiro chega no mesmo instante')
  assert.ok(cheio <= 15_000 * 1.2, `desvio grande demais: ${cheio}`)
})

test('fila: sessao vencida e freio NAO apagam a evidencia do aparelho', () => {
  // A fila descartava a foto do aparelho em qualquer resposta 4xx, com a razao
  // "recusa por regra nao melhora tentando de novo". A razao esta certa; a
  // conta de quais respostas sao recusa por regra, nao estava.
  //
  // A sessao do PWA dura 12 horas. Quem termina o dia no patio e sincroniza na
  // manha seguinte recebe 401 — e recebia com ele a exclusao de TODA foto
  // pendente. A inspecao ja estava no servidor; a prova dela sumia do aparelho
  // e nao existia em lugar nenhum.
  //
  // O roadmap 28 diz "fila que nunca apaga item em silencio". Era exatamente
  // isso que acontecia, e sem nenhuma mensagem.
  const TRANSITORIOS = [
    [401, 'a sessao venceu; basta entrar de novo'],
    [429, 'o freio pediu para tentar mais tarde — literalmente'],
    [408, 'o servidor desistiu de esperar o corpo'],
    [425, 'cedo demais; o proprio nome do status pede espera'],
  ]
  for (const [status, porque] of TRANSITORIOS) {
    assert.equal(sincronia.recusaDefinitiva(status), false,
      `${status} nao pode apagar evidencia: ${porque}`)
  }

  // E o que E' recusa por regra continua sendo. Insistir nesses so gastaria
  // bateria e espaco no aparelho de quem esta no patio.
  const DEFINITIVOS = [
    [400, 'o arquivo nao e uma imagem'],
    [403, 'a inspecao e de outra pessoa'],
    [404, 'a inspecao nao existe'],
    [409, 'a solicitacao mudou de estado'],
    [413, 'a imagem passa do limite'],
    [422, 'o corpo nao faz sentido'],
  ]
  for (const [status, porque] of DEFINITIVOS) {
    assert.equal(sincronia.recusaDefinitiva(status), true,
      `${status} e recusa por regra: ${porque}`)
  }

  // Fora da faixa 4xx nada e' definitivo: 5xx e' problema do servidor, e 2xx
  // nem chega aqui.
  for (const status of [200, 201, 301, 500, 502, 503, 504]) {
    assert.equal(sincronia.recusaDefinitiva(status), false,
      `${status} nao e recusa por regra do cliente`)
  }
})

test('fila: nao arma relogio sem fila nem sem rede', () => {
  // Sem fila nao ha o que reenviar. Sem rede, quem acorda e o evento `online`,
  // que chega na hora certa e nao gasta nada esperando.
  assert.equal(sincronia.deveRetentar({ pendentes: 2, online: true }), true)
  assert.equal(sincronia.deveRetentar({ pendentes: 0, online: true }), false)
  assert.equal(sincronia.deveRetentar({ pendentes: 2, online: false }), false)
})

test('fila: envio que falha volta a tentar sozinho, sem ninguem tocar em nada', async () => {
  // O caso real: 4G oscilando no patio. O aparelho continua "online" — tem
  // sinal, so nao passa dado —, entao o evento `online` nunca chega, e quem
  // fica com o app na frente terminando o dia nunca troca de aba. O item
  // ficava parado dizendo "Sera reenviado automaticamente", que era uma
  // promessa que o codigo nao cumpria.
  // `navigator` do Node so tem getter: em vez de trocar o objeto, redefine a
  // propriedade e devolve a original no fim.
  const navegadorAntes = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const buscaAntes = globalThis.fetch
  const pendentesAntes = filaReal.pendentes
  const marcarAntes = filaReal.marcar

  Object.defineProperty(globalThis, 'navigator',
    { value: { onLine: true }, configurable: true })
  let naFila = [{
    cliente_uuid: 'u1', estado: 'pendente', tentativas: 0,
    template_id: 't1', veiculo_id: 'v1', momento: 'saida', respostas: {},
  }]
  filaReal.pendentes = async () => naFila
  filaReal.marcar = async (uuid, campos) => {
    naFila = naFila.map((i) => (i.cliente_uuid === uuid ? { ...i, ...campos } : i))
  }

  let tentativas = 0
  globalThis.fetch = async () => { tentativas += 1; throw new Error('rede caiu') }

  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    await sincronia.sincronizar()
    assert.equal(tentativas, 1)

    // Ninguem troca de aba, ninguem toca no botao, a rede nao muda de estado.
    // 15s de base mais ate 20% de desvio: 18s cobre o pior caso.
    mock.timers.tick(19_000)
    await assentar(6)
    assert.ok(tentativas >= 2,
      `o relogio tinha que ter disparado o reenvio sozinho; tentativas: ${tentativas}`)

    // Fila vazia: para de tentar em vez de bater no servidor para sempre.
    naFila = []
    const antes = tentativas
    await sincronia.sincronizar()
    mock.timers.tick(10 * 60_000)
    await assentar(6)
    assert.equal(tentativas, antes, 'com a fila vazia nao ha mais nada para reenviar')
  } finally {
    mock.timers.reset()
    Object.defineProperty(globalThis, 'navigator', navegadorAntes)
    globalThis.fetch = buscaAntes
    filaReal.pendentes = pendentesAntes
    filaReal.marcar = marcarAntes
  }
})
