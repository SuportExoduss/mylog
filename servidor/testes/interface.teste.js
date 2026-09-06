// Testes de tela sobre o DOM minimo de `dom.js`.
//
// Existem por um motivo especifico: os 99 testes de API e de motor passavam
// enquanto a senha inicial gerada nunca chegava a aparecer no painel. Suite
// verde, funcionalidade morta. Estes testes cobrem a fronteira que faltava —
// o que a tela faz, nao o que a rota devolve.
import test, { beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from './dom.js'

let tela

// O sino mora fora da area de modal: ele precisa do proprio ancoradouro.
beforeEach(() => { tela = montarDom({ ids: ['area-modal', 'area-sino'] }) })

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

// Drena a fila de microtarefas. Um `setImmediate` so nao basta quando a cadeia
// tem mais de um `await` — e a do campo de imagem tem: comprimir, subir,
// desenhar.
const assentar = async (voltas = 3) => {
  for (let i = 0; i < voltas; i += 1) await new Promise((r) => setImmediate(r))
}
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

// ------------------------------------------------- campo de imagem

test('modal: o campo de imagem sobe o arquivo e mostra a previa', async () => {
  // Roadmap 11.3: a criacao da pergunta pede upload, nao uma URL digitada.
  // Vale para os dois tipos de modelo — padrao e preventiva usam este editor.
  let enviado = null
  let salvo = null

  abrirModal({
    titulo: 'Nova pergunta',
    campos: [
      { nome: 'titulo', rotulo: 'Titulo', valor: 'Pinca de freio' },
      { nome: 'foto_exibicao', rotulo: 'Foto de exemplo', tipo: 'imagem', valor: '',
        aoEnviar: async (arquivo) => { enviado = arquivo; return '/imagens/modelo/t1/abc.jpg' } },
    ],
    confirmar: 'Adicionar',
    aoConfirmar: async (v) => { salvo = v },
  })

  const bloco = area().querySelector('.campo-imagem')
  assert.ok(bloco, 'o campo de imagem precisa existir')
  assert.match(area().textContent, /Nenhuma imagem escolhida/)
  assert.ok(botaoPorTexto(area(), 'Escolher imagem'))
  // Sem CSS aqui: "escondido" e a classe `oculto`, que e como o resto do
  // painel esconde coisa.
  const escondido = (b) => b.classList.contains('oculto')
  assert.equal(escondido(botaoPorTexto(area(), 'Remover')), true, 'sem imagem, nada a remover')
  assert.equal(escondido(bloco.querySelector('img')), true)

  // O navegador dispara "change" depois de escolher o arquivo.
  const entrada = bloco.querySelector('input')
  entrada.files = [{ name: 'pinca.jpg', type: 'image/jpeg' }]
  entrada.dispatchEvent(new Event('change'))
  await assentar()

  assert.equal(enviado.name, 'pinca.jpg', 'o arquivo vai para quem sabe onde guardar')
  assert.match(area().textContent, /Imagem salva/)
  assert.equal(bloco.querySelector('img').getAttribute('src'), '/imagens/modelo/t1/abc.jpg')
  assert.equal(escondido(botaoPorTexto(area(), 'Remover')), false)
  assert.equal(escondido(bloco.querySelector('img')), false)
  assert.ok(botaoPorTexto(area(), 'Trocar imagem'), 'com imagem, o botao muda de nome')

  botaoPorTexto(area(), 'Adicionar').click()
  await new Promise((r) => setImmediate(r))
  assert.equal(salvo.foto_exibicao, '/imagens/modelo/t1/abc.jpg',
    'o que fica na estrutura da pergunta e a URL')
})

test('modal: remover a imagem limpa o valor', async () => {
  let salvo = null
  abrirModal({
    titulo: 'Editar pergunta',
    campos: [
      { nome: 'foto_exibicao', rotulo: 'Foto de exemplo', tipo: 'imagem',
        valor: '/imagens/modelo/t1/antiga.jpg',
        aoEnviar: async () => '/imagens/modelo/t1/nova.jpg' },
    ],
    aoConfirmar: async (v) => { salvo = v },
  })

  // Abre ja com a imagem que a pergunta tinha.
  assert.equal(area().querySelector('img').getAttribute('src'), '/imagens/modelo/t1/antiga.jpg')

  botaoPorTexto(area(), 'Remover').click()
  assert.match(area().textContent, /Nenhuma imagem escolhida/)

  botaoPorTexto(area(), 'Salvar').click()
  await new Promise((r) => setImmediate(r))
  assert.equal(salvo.foto_exibicao, '')
})

test('modal: falha no envio nao apaga a imagem que ja estava la', async () => {
  abrirModal({
    titulo: 'Editar pergunta',
    campos: [
      { nome: 'foto_exibicao', rotulo: 'Foto de exemplo', tipo: 'imagem',
        valor: '/imagens/modelo/t1/antiga.jpg',
        aoEnviar: async () => { throw new Error('Imagem acima do limite de 4 MB.') } },
    ],
    aoConfirmar: async () => {},
  })

  const entrada = area().querySelector('.campo-imagem input')
  entrada.files = [{ name: 'enorme.jpg', type: 'image/jpeg' }]
  entrada.dispatchEvent(new Event('change'))
  await assentar()

  assert.match(area().textContent, /acima do limite/)
  assert.equal(area().querySelector('img').getAttribute('src'), '/imagens/modelo/t1/antiga.jpg',
    'envio que falhou nao pode derrubar o que ja funcionava')
})

// ---------------------------------------------------------------- sino

const { montarSino } = await import('../../web/js/sino.js')

// Servidor de mentira no lugar do `fetch`. Devolve o que a rota decidir e
// guarda os caminhos chamados — e' a contagem de chamadas que prova se o
// relogio do sino parou ou nao.
function servidorFalso(rota) {
  const chamadas = []
  const anterior = globalThis.fetch
  globalThis.fetch = async (caminho, opcoes) => {
    chamadas.push(caminho)
    const r = rota(caminho, opcoes)
    return { ok: r.status < 400, status: r.status, json: async () => r.corpo }
  }
  chamadas.restaurar = () => { globalThis.fetch = anterior }
  return chamadas
}

const aviso = (id, texto, extra) => ({
  id, texto, nivel: 'info', destino: null, lida_em: null,
  criado_em: new Date().toISOString(), ...extra,
})

test('sino: o ponto vermelho aparece com aviso novo e some ao marcar todas', async () => {
  const chamadas = servidorFalso((caminho) => (caminho.includes('/lidas')
    ? { status: 200, corpo: { nao_lidas: 0 } }
    : { status: 200, corpo: { nao_lidas: 2, notificacoes: [
        aviso('n1', 'Solicitacao aguardando aprovacao'),
        aviso('n2', 'Preventiva do ABC1D23 venceu'),
      ] } }))
  const sino = montarSino({ irPara: () => {} })
  try {
    await assentar()

    const ponto = tela.documento.querySelector('.sino-ponto')
    assert.ok(!ponto.classList.contains('oculto'), 'com 2 nao lidas o ponto tem que aparecer')

    tela.documento.querySelector('.sino-gatilho').click()
    assert.match(tela.documento.querySelector('.sino-lista').textContent, /Preventiva do ABC1D23/)

    botaoPorTexto(tela.documento.body, 'Marcar todas como lidas').click()
    await assentar()
    assert.ok(ponto.classList.contains('oculto'), 'sem nao lida, o ponto some')
  } finally {
    sino.parar()
    chamadas.restaurar()
  }
})

test('sino: sessao vencida para o relogio e avisa o app', async () => {
  // Sem isto o sino descobre o 401 e continua batendo nele a cada minuto,
  // para sempre — a sessao pode cair com a tela aberta e ninguem na frente.
  const chamadas = servidorFalso(() => ({ status: 401, corpo: { erro: 'nao_autenticado' } }))
  mock.timers.enable({ apis: ['setInterval'] })
  let expirou = 0
  const sino = montarSino({ irPara: () => {}, aoExpirarSessao: () => { expirou += 1 } })
  try {
    await assentar()
    assert.equal(expirou, 1, 'quem descobre a sessao vencida e o sino: ele tem que avisar')
    assert.equal(chamadas.length, 1)

    mock.timers.tick(5 * 60_000)
    await assentar()
    assert.equal(chamadas.length, 1, 'depois do 401 o sino nao pode bater no servidor de novo')
  } finally {
    sino.parar()
    mock.timers.reset()
    chamadas.restaurar()
  }
})

test('sino: sem rede o sino se cala, mas continua tentando', async () => {
  // Falta de rede nao e' sessao vencida. Derrubar a sessao por causa de um
  // tunel seria pior que nao mostrar o aviso.
  const chamadas = servidorFalso(() => { throw new Error('offline') })
  mock.timers.enable({ apis: ['setInterval'] })
  let expirou = 0
  const sino = montarSino({ irPara: () => {}, aoExpirarSessao: () => { expirou += 1 } })
  try {
    await assentar()
    assert.equal(expirou, 0, 'sem rede nao desloga ninguem')
    mock.timers.tick(60_000)
    await assentar()
    assert.ok(chamadas.length > 1, 'e o relogio segue: a rede volta')
  } finally {
    sino.parar()
    mock.timers.reset()
    chamadas.restaurar()
  }
})

test('sino: clicar no aviso marca como lido e leva para a tela', async () => {
  const chamadas = servidorFalso((caminho) => (caminho.includes('/lidas')
    ? { status: 200, corpo: { nao_lidas: 0 } }
    : { status: 200, corpo: { nao_lidas: 1, notificacoes: [
        aviso('n1', 'Ocorrencia grave no ABC1D23', { destino: 'ocorrencias' }),
      ] } }))
  let foi = null
  const sino = montarSino({ irPara: (chave) => { foi = chave } })
  try {
    await assentar()
    tela.documento.querySelector('.sino-gatilho').click()
    botaoPorTexto(tela.documento.body, 'Ocorrencia grave no ABC1D23agora').click()
    await assentar()

    assert.equal(foi, 'ocorrencias')
    assert.ok(chamadas.some((c) => c.includes('/lidas')), 'abrir o aviso o marca como lido')
    assert.ok(tela.documento.querySelector('.sino-lista').classList.contains('oculto'),
      'a lista fecha ao navegar')
  } finally {
    sino.parar()
    chamadas.restaurar()
  }
})

// ------------------------------------------- ocorrencias filtradas por carro

const { telaOcorrencias } = await import('../../web/js/ocorrencias.js')

test('ocorrencias: chegar pelo veiculo filtra por ele, e da o caminho de volta', async () => {
  // O servidor aceita `veiculo_id` desde cedo; a tela nunca mandava. Quem abre
  // o historico de um carro e clica em "abrir as ocorrencias deste veiculo"
  // precisa cair na lista dele, nao na frota inteira.
  const chamadas = servidorFalso(() => ({ status: 200, corpo: { ocorrencias: [] } }))
  const raiz = tela.documento.createElement('div')
  tela.corpo.append(raiz)
  let voltou
  try {
    await telaOcorrencias(raiz, {
      ehFrota: true,
      parametros: { veiculo: 'veic-7', placa: 'ABC1D23' },
      irPara: (chave, params) => { voltou = { chave, params } },
    })

    assert.ok(chamadas.some((c) => c.includes('veiculo_id=veic-7')),
      `a tela precisa mandar o filtro; mandou: ${chamadas.join(' ')}`)
    assert.match(raiz.textContent, /ABC1D23/, 'a placa filtrada tem que estar visivel')

    botaoPorTexto(raiz, 'so ABC1D23 · limpar').click()
    assert.deepEqual(voltou, { chave: 'ocorrencias', params: undefined },
      'limpar volta para a lista inteira')
  } finally {
    chamadas.restaurar()
  }
})

test('ocorrencias: sem veiculo na URL, nenhum filtro de veiculo e nenhuma etiqueta', async () => {
  const chamadas = servidorFalso(() => ({ status: 200, corpo: { ocorrencias: [] } }))
  const raiz = tela.documento.createElement('div')
  tela.corpo.append(raiz)
  try {
    await telaOcorrencias(raiz, { ehFrota: true, parametros: {}, irPara: () => {} })
    assert.ok(!chamadas.some((c) => c.includes('veiculo_id')),
      'filtro vazio nao pode virar `veiculo_id=` na URL')
    assert.ok(!raiz.textContent.includes('limpar'))
  } finally {
    chamadas.restaurar()
  }
})
