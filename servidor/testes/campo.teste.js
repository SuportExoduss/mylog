// Execucao do checklist no aplicativo de campo, sobre o DOM minimo.
//
// Esta e' a tela que decide se o checklist vai ser feito direito: quem
// preenche esta de pe no patio, com pressa e as vezes de luva. Um botao que
// mente sobre o que falta nao e' detalhe de acabamento — e' o motorista
// girando na tela ate desistir.
//
// Fotos e assinatura ficam de fora: dependem de IndexedDB, camera e canvas.
// O roadmap 26 registra isso como passe manual obrigatorio.
import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from './dom.js'

let tela
beforeEach(() => { tela = montarDom({ ids: ['app'] }) })
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 0))
  tela.desmontar()
})

const { executarChecklist } = await import('../../app/js/checklist.js')

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
