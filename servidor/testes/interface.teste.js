// Testes de tela sobre o DOM minimo de `dom.js`.
//
// Existem por um motivo especifico: os 99 testes de API e de motor passavam
// enquanto a senha inicial gerada nunca chegava a aparecer no painel. Suite
// verde, funcionalidade morta. Estes testes cobrem a fronteira que faltava —
// o que a tela faz, nao o que a rota devolve.
import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from './dom.js'

let tela

beforeEach(() => { tela = montarDom() })

// O menu de acoes registra o ouvinte de "clicar fora" num setTimeout(0). Se o
// documento for desmontado antes desse timer rodar, ele acorda sem `document`
// e derruba o processo. Drenar a fila antes de desmontar e' cuidado do
// arcabouco, nao remendo de defeito da tela: no navegador o documento nunca
// deixa de existir.
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 0))
  tela.desmontar()
})

// ui.js so toca em `document` dentro das funcoes, entao pode ser importado
// uma vez; cada teste troca o documento por baixo.
const uiDoTeste = await import('../../web/js/ui.js')
const { elemento, abrirModal, limpar } = uiDoTeste

const area = () => tela.documento.getElementById('area-modal')
const botaoPorTexto = (raiz, texto) =>
  raiz.querySelectorAll('button').find((b) => b.textContent.trim() === texto)

function abrirCadastro({ aoConfirmar, campos }) {
  abrirModal({
    titulo: 'Novo usuario',
    campos: campos || [{ nome: 'nome', rotulo: 'Nome', obrigatorio: true }],
    confirmar: 'Criar cadastro',
    aoConfirmar,
  })
}

// ------------------------------------------------------------ estrutura

test('modal: abre dentro da area e monta os campos declarados', () => {
  abrirModal({
    titulo: 'Editar veiculo',
    subtitulo: 'ABC1D23',
    campos: [
      { nome: 'marca', rotulo: 'Marca', valor: 'Fiat' },
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'select',
        opcoes: [{ valor: 'pickup', rotulo: 'Pick-up' }], valor: 'pickup' },
    ],
    aoConfirmar: async () => {},
  })

  assert.equal(area().querySelectorAll('.fundo-modal').length, 1)
  assert.equal(area().querySelector('#campo-marca').value, 'Fiat')
  assert.equal(area().querySelector('#campo-tipo').tagName, 'SELECT')
  assert.match(area().textContent, /Editar veiculo/)
  assert.match(area().textContent, /ABC1D23/)
})

test('modal: abrir um novo substitui o anterior, nao empilha', () => {
  abrirModal({ titulo: 'Primeiro', campos: [], aoConfirmar: async () => {} })
  abrirModal({ titulo: 'Segundo', campos: [], aoConfirmar: async () => {} })

  assert.equal(area().querySelectorAll('.fundo-modal').length, 1)
  assert.match(area().textContent, /Segundo/)
  assert.doesNotMatch(area().textContent, /Primeiro/)
})

// ------------------------------------------------- o bug que motivou tudo

test('modal: o que o aoConfirmar abriu sobrevive ao fechamento', async () => {
  // Este e' o D34. `abrirModal` fazia `limpar(area)` depois do `aoConfirmar`;
  // como criar usuario abre, de dentro do `aoConfirmar`, a janela que mostra
  // a senha inicial gerada, essa janela era apagada antes de alguem ler.
  // A senha nao fica em log nem em auditoria: sumia de vez.
  const SENHA = 'QUMcZK8WE4'

  abrirCadastro({
    aoConfirmar: async () => {
      area().replaceChildren(elemento('div', { classe: 'fundo-modal' }, [
        elemento('form', { classe: 'modal' }, [
          elemento('h3', { texto: 'Usuario criado' }),
          elemento('input', { classe: 'dado', readonly: true, value: SENHA }),
        ]),
      ]))
    },
  })

  area().querySelector('#campo-nome').value = 'Paulo Reis'
  botaoPorTexto(area(), 'Criar cadastro').click()
  await new Promise((r) => setImmediate(r))

  assert.match(area().textContent, /Usuario criado/,
    'a janela aberta pelo aoConfirmar nao pode ser apagada pelo fechamento')
  assert.equal(area().querySelector('.dado').value, SENHA,
    'a senha inicial precisa continuar legivel: ela nao volta')
})

test('modal: sem encadeamento, confirmar fecha e a area fica limpa', async () => {
  let chamou = false
  abrirCadastro({ aoConfirmar: async () => { chamou = true } })

  area().querySelector('#campo-nome').value = 'Ana'
  botaoPorTexto(area(), 'Criar cadastro').click()
  await new Promise((r) => setImmediate(r))

  assert.equal(chamou, true)
  assert.equal(area().filhos.length, 0, 'o modal precisa sumir depois de salvar')
})

// ------------------------------------------------------------- rejeicao

test('modal: erro do servidor aparece no modal e nao fecha a tela', async () => {
  abrirCadastro({
    aoConfirmar: async () => { throw new Error('CPF ja cadastrado nesta empresa.') },
  })

  area().querySelector('#campo-nome').value = 'Repetido'
  botaoPorTexto(area(), 'Criar cadastro').click()
  await new Promise((r) => setImmediate(r))

  assert.equal(area().querySelectorAll('.fundo-modal').length, 1,
    'quem errou precisa poder corrigir sem redigitar tudo')
  assert.match(area().textContent, /CPF ja cadastrado/)
  assert.equal(area().querySelector('#campo-nome').value, 'Repetido')
  assert.equal(botaoPorTexto(area(), 'Criar cadastro').disabled, false,
    'o botao precisa voltar a funcionar depois do erro')
})

test('modal: cancelar fecha sem chamar o aoConfirmar', () => {
  let chamou = false
  abrirCadastro({ aoConfirmar: async () => { chamou = true } })

  botaoPorTexto(area(), 'Cancelar').click()

  assert.equal(chamou, false)
  assert.equal(area().filhos.length, 0)
})

// -------------------------------------------------------- campos ocultos

test('modal: campo escondido nao entra no resultado', async () => {
  // Espelha a edicao de veiculo: o motivo da correcao de KM so existe quando
  // o KM anda para tras. Se o campo nao fazia sentido, o valor que sobrou
  // nele tambem nao faz.
  let recebido = null
  abrirModal({
    titulo: 'Editar ABC1D23',
    campos: [
      { nome: 'km_atual', rotulo: 'Quilometragem', tipo: 'number', valor: '42100' },
      { nome: 'motivo_km', rotulo: 'Motivo da correcao',
        visivelQuando: (v) => Number(v.km_atual) < 42100 },
    ],
    aoConfirmar: async (v) => { recebido = v },
  })

  const km = area().querySelector('#campo-km_atual')
  const motivo = area().querySelector('#campo-motivo_km')
  const envolucro = motivo.closest('.campo')

  assert.equal(envolucro.classList.contains('oculto'), true,
    'sem correcao para tras, o motivo nem aparece')

  motivo.value = 'texto que sobrou'
  km.value = '100'
  km.dispatchEvent(new Event('change'))

  assert.equal(envolucro.classList.contains('oculto'), false,
    'KM menor que o atual precisa revelar o motivo')

  km.value = '50000'
  km.dispatchEvent(new Event('change'))
  botaoPorTexto(area(), 'Salvar').click()
  await new Promise((r) => setImmediate(r))

  assert.equal(recebido.motivo_km, '',
    'campo escondido na hora de salvar nao pode levar valor junto')
  assert.equal(recebido.km_atual, '50000')
})

// ------------------------------------------------------------- limpar()

test('limpar remove todos os filhos e nao sobra texto', () => {
  const caixa = elemento('div', {}, [
    elemento('span', { texto: 'a' }),
    elemento('span', { texto: 'b' }),
  ])
  assert.equal(caixa.filhos.length, 2)
  limpar(caixa)
  assert.equal(caixa.filhos.length, 0)
  assert.equal(caixa.textContent, '')
})

// ------------------------------------------------------ escape por padrao

test('elemento nunca escreve texto do banco como marcacao', () => {
  // A defesa contra XSS no painel e' estrutural: `texto` vira textContent, e
  // `html` so e' usado com marcacao escrita a mao no proprio codigo.
  const malicioso = '<script>roubar()</script>'
  const no = elemento('div', { texto: malicioso })
  assert.equal(no.textContent, malicioso)
  assert.equal(no.innerHTML, '', 'nada de dado do banco virando marcacao')
})

// --------------------------------------------------------- menu de acoes

// Roadmap 21: nenhuma lista tem botao solto na linha. O menu de tres pontos
// e' o unico caminho para agir sobre um item, entao o comportamento dele vale
// para a tabela inteira do painel.
test('menu: nasce fechado e abre no clique do gatilho', () => {
  const { menuAcoes } = uiDoTeste
  const caixa = menuAcoes([{ rotulo: 'Editar', aoClick: () => {} }])
  area().append(caixa)

  const lista = caixa.querySelector('.menu-lista')
  assert.equal(lista.classList.contains('oculto'), true)

  caixa.querySelector('.botao--icone').click()
  assert.equal(lista.classList.contains('oculto'), false)
})

test('menu: abrir um fecha o outro — so um aberto por vez', () => {
  const { menuAcoes } = uiDoTeste
  const primeiro = menuAcoes([{ rotulo: 'Editar', aoClick: () => {} }])
  const segundo = menuAcoes([{ rotulo: 'Bloquear', aoClick: () => {} }])
  area().append(primeiro, segundo)

  primeiro.querySelector('.botao--icone').click()
  segundo.querySelector('.botao--icone').click()

  assert.equal(primeiro.querySelector('.menu-lista').classList.contains('oculto'), true,
    'dois menus abertos numa tabela viram sobreposicao ilegivel')
  assert.equal(segundo.querySelector('.menu-lista').classList.contains('oculto'), false)
})

test('menu: escolher uma acao executa e fecha', () => {
  const { menuAcoes } = uiDoTeste
  let executou = null
  const caixa = menuAcoes([
    { rotulo: 'Editar', aoClick: () => { executou = 'editar' } },
    { rotulo: 'Desativar', perigo: true, aoClick: () => { executou = 'desativar' } },
  ])
  area().append(caixa)

  caixa.querySelector('.botao--icone').click()
  const itens = caixa.querySelectorAll('.menu-item')
  assert.equal(itens.length, 2)
  assert.equal(itens[1].classList.contains('menu-item--perigo'), true)

  itens[1].click()
  assert.equal(executou, 'desativar')
  assert.equal(caixa.querySelector('.menu-lista').classList.contains('oculto'), true)
})

test('menu: lista de acoes vazia nao rende gatilho nenhum', () => {
  const { menuAcoes } = uiDoTeste
  // As telas montam a lista com condicionais e passam `null` no meio: uma
  // linha sem acao disponivel nao pode exibir um menu que abre vazio.
  const caixa = menuAcoes([null, false, undefined])
  assert.equal(caixa.tagName, 'SPAN')
  assert.equal(caixa.filhos.length, 0)
})
