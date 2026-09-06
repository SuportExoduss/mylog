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

// ------------------------------------------------- painel: para onde o clique leva

const { telaPainel } = await import('../../web/js/painel.js')

const PAINEL = {
  frota: { total: 12, por_status: { disponivel: 8, bloqueado: 3, com_pendencia: 1 } },
  solicitacoes: { pendentes: 2, em_uso: 1, atrasadas: 0 },
  checklists: { hoje: 7, veiculos_em_uso: 1 },
  ocorrencias: { abertas: 4, por_prioridade: { critica: 1, alta: 3 } },
  preventivas: { por_status: { vencida: 2, muito_proxima: 1, em_dia: 9 } },
  usuarios: { por_status: { ativo: 30, pendente: 2 } },
  alertas: [
    // O aviso da cobranca de checklist: `tipo` que o mapa antigo do painel nao
    // conhecia, e por isso caia no `|| 'painel'`.
    { nivel: 'critico', tipo: 'checklist', destino: 'execucoes',
      texto: '3 colaboradores nao fizeram o checklist de hoje.' },
    { nivel: 'atencao', tipo: 'usuario', destino: 'usuarios',
      texto: '2 cadastros sem primeiro acesso.' },
  ],
}

async function montarPainel(aoNavegar) {
  const chamadas = servidorFalso(() => ({ status: 200, corpo: PAINEL }))
  const raiz = tela.documento.createElement('div')
  tela.corpo.append(raiz)
  await telaPainel(raiz, {
    ehFrota: true,
    usuario: { nome: 'Andre Roberth' },
    parametros: {},
    irPara: (chave, params) => aoNavegar({ chave, params }),
  })
  return { raiz, chamadas }
}

test('painel: o alerta leva para onde o SERVIDOR disse, nao para um mapa local', async () => {
  // Havia um mapa por `tipo` dentro do painel, e ele nao tinha 'checklist'.
  // O aviso mais novo — quem nao fez o checklist do dia — caia no padrao e
  // recarregava a propria tela. Clique morto, sem erro nenhum.
  let foi = null
  const { raiz, chamadas } = await montarPainel((d) => { foi = d })
  try {
    const aviso = raiz.querySelectorAll('.fila-item')
      .find((n) => n.textContent.includes('nao fizeram o checklist'))
    assert.ok(aviso, 'o alerta de cobranca precisa aparecer na fila de acao')

    aviso.click()
    assert.equal(foi?.chave, 'execucoes',
      'o alerta de checklist tem que abrir a tela de checklists feitos')
  } finally {
    chamadas.restaurar()
  }
})

test('painel: clicar no selo abre a lista JA filtrada por aquele status', async () => {
  // As telas de destino sempre souberam ler o filtro; era o painel que nunca
  // mandava. "3 bloqueados" abria a frota inteira e a pessoa procurava os tres
  // de novo.
  let foi = null
  const { raiz, chamadas } = await montarPainel((d) => { foi = d })
  try {
    const bloqueados = raiz.querySelectorAll('.selo')
      .find((n) => n.textContent.includes('bloqueado'))
    assert.ok(bloqueados, 'o selo de bloqueados precisa existir com 3 veiculos')

    bloqueados.click()
    assert.equal(foi?.chave, 'veiculos')
    assert.deepEqual(foi?.params, { status: 'bloqueado' })

    const criticas = raiz.querySelectorAll('.selo')
      .find((n) => n.textContent.includes('critica'))
    criticas.click()
    assert.equal(criticas.getAttribute('role'), 'button')
    assert.equal(criticas.getAttribute('tabindex'), '0')
    assert.equal(foi?.chave, 'ocorrencias')
    assert.deepEqual(foi?.params, { prioridade: 'critica' },
      'na tela de ocorrencias o filtro desta contagem e prioridade, nao status')
  } finally {
    chamadas.restaurar()
  }
})

test('painel: o clique no selo nao dispara o do card por baixo', async () => {
  // Sem parar a propagacao, o card abriria a lista inteira POR CIMA da
  // filtrada: a pessoa clica em "3 bloqueados" e ve os doze.
  const navegacoes = []
  const { raiz, chamadas } = await montarPainel((d) => navegacoes.push(d))
  try {
    raiz.querySelectorAll('.selo').find((n) => n.textContent.includes('bloqueado')).click()
    assert.equal(navegacoes.length, 1, `esperava uma navegacao, houve ${navegacoes.length}`)
    assert.deepEqual(navegacoes[0].params, { status: 'bloqueado' })
  } finally {
    chamadas.restaurar()
  }
})

// ------------------------------------------- modelos: padrao x preventiva

const { telaTemplates } = await import('../../web/js/templates.js')

// Servidor de mentira que guarda o corpo enviado, nao so o caminho: o que esta
// em julgamento aqui e' o que a tela MANDA.
function servidorComCorpo(rota) {
  const pedidos = []
  const anterior = globalThis.fetch
  globalThis.fetch = async (caminho, opcoes = {}) => {
    pedidos.push({ caminho, corpo: opcoes.body ? JSON.parse(opcoes.body) : null })
    const r = rota(caminho, opcoes)
    return { ok: r.status < 400, status: r.status, json: async () => r.corpo }
  }
  pedidos.restaurar = () => { globalThis.fetch = anterior }
  return pedidos
}

const RESPOSTAS = (caminho) => {
  if (caminho.startsWith('/api/cargos')) {
    return { status: 200, corpo: { cargos: [{ id: 'cg1', nome: 'Manutencao' }] } }
  }
  if (caminho.startsWith('/api/templates')) {
    return { status: 200, corpo: { templates: [], template: { id: 't-novo' } } }
  }
  return { status: 200, corpo: {} }
}

test('modelos: a secao de preventiva CRIA modelo de preventiva', async () => {
  // Este era o buraco: `criarTemplate` nunca mandava `finalidade`, entao o
  // servidor gravava 'padrao' sempre. Nao havia como criar um modelo de
  // preventiva pela interface — so a semente criava — e a tela de agendamento
  // pedia um modelo que ninguem podia fazer.
  const pedidos = servidorComCorpo(RESPOSTAS)
  const raiz = tela.documento.createElement('div')
  tela.corpo.append(raiz)
  try {
    await telaTemplates(raiz, {
      ehFrota: true,
      parametros: { finalidade: 'preventiva' },
      irPara: () => {},
    })
    await assentar()

    // A lista ja pede so os de preventiva.
    assert.ok(pedidos.some((p) => p.caminho.includes('finalidade=preventiva')),
      `a lista tem que filtrar por finalidade; pediu: ${pedidos.map((p) => p.caminho).join(' ')}`)

    botaoPorTexto(raiz, '+ Novo modelo de preventiva').click()
    await assentar()

    const modal = tela.documento.getElementById('area-modal')
    assert.match(modal.textContent, /Novo modelo de preventiva/)
    // O aviso do que a preventiva exige, para quem esta montando nao descobrir
    // depois, no patio.
    assert.match(modal.textContent, /Saida e retorno sao obrigatorios/)
    // Frequencia nao existe para preventiva: quem diz quando ela acontece e' o
    // agendamento, por KM ou por data.
    assert.ok(!/Com que frequencia/.test(modal.textContent),
      'oferecer ritmo semanal a uma preventiva e oferecer uma cobranca que nunca vai existir')

    const campos = modal.querySelectorAll('input')
    campos[0].value = 'Preventiva de 10.000 km'
    campos[1].value = 'preventiva-10k'
    botaoPorTexto(modal, 'Criar rascunho').click()
    await assentar()

    const criacao = pedidos.find((p) => p.corpo && p.corpo.codigo === 'preventiva-10k')
    assert.ok(criacao, 'a criacao tem que sair')
    assert.equal(criacao.corpo.finalidade, 'preventiva',
      'sem isto o servidor grava "padrao" e o modelo nunca aparece no agendamento')
  } finally {
    pedidos.restaurar()
  }
})

test('modelos: a secao padrao continua criando padrao', async () => {
  const pedidos = servidorComCorpo(RESPOSTAS)
  const raiz = tela.documento.createElement('div')
  tela.corpo.append(raiz)
  try {
    await telaTemplates(raiz, { ehFrota: true, parametros: {}, irPara: () => {} })
    await assentar()

    assert.ok(pedidos.some((p) => p.caminho.includes('finalidade=padrao')))

    botaoPorTexto(raiz, '+ Novo checklist').click()
    await assentar()

    const modal = tela.documento.getElementById('area-modal')
    assert.match(modal.textContent, /Com que frequencia/,
      'o checklist padrao continua tendo ritmo, que e o que alimenta a cobranca')

    const campos = modal.querySelectorAll('input')
    campos[0].value = 'Diario padrao'
    campos[1].value = 'diario-padrao'
    botaoPorTexto(modal, 'Criar rascunho').click()
    await assentar()

    const criacao = pedidos.find((p) => p.corpo && p.corpo.codigo === 'diario-padrao')
    assert.equal(criacao.corpo.finalidade, 'padrao')
  } finally {
    pedidos.restaurar()
  }
})

test('sino: marcar todas que falha nao apaga o ponto vermelho', async () => {
  // Apagar na tela o que o servidor nao marcou faria o aviso sumir e voltar no
  // minuto seguinte, sem explicacao. O ponto vermelho e' a verdade ate o
  // servidor confirmar.
  const chamadas = servidorFalso((caminho) => (caminho.includes('/lidas')
    ? { status: 500, corpo: { erro: 'erro_interno', mensagem: 'Falha inesperada.' } }
    : { status: 200, corpo: { nao_lidas: 3, notificacoes: [aviso('n1', 'Preventiva vencida')] } }))
  const sino = montarSino({ irPara: () => {} })
  try {
    await assentar()
    const ponto = tela.documento.querySelector('.sino-ponto')
    assert.ok(!ponto.classList.contains('oculto'))

    tela.documento.querySelector('.sino-gatilho').click()
    botaoPorTexto(tela.documento.body, 'Marcar todas como lidas').click()
    await assentar()

    assert.ok(!ponto.classList.contains('oculto'),
      'o servidor recusou: o ponto tem que continuar vermelho')
    assert.match(tela.documento.querySelector('.sino-lista').textContent, /3 nao lida/)
  } finally {
    sino.parar()
    chamadas.restaurar()
  }
})

// ------------------------------- todo valor do dominio tem rotulo e tom na tela

// O dominio define os valores; a tela define como cada um se chama e de que cor
// e'. Sao dois lugares de proposito — rotulo e' assunto de interface. Mas um
// valor novo no dominio sem rotulo na tela nao aparece como erro: aparece como
// `undefined` numa celula, ou como selo sem cor.
//
// E' o mesmo cuidado que MOTIVOS_PENDENCIA ja tinha: acrescentar um motivo sem
// dar-lhe frase e' teste vermelho, nao tela muda no patio.
const motor = await import('../../compartilhado/template.js')
const preventivas = await import('../src/nucleo/preventivas.js')
const ocorrenciasSrv = await import('../src/rotas/ocorrencias.js')
const solicitacoesSrv = await import('../src/rotas/solicitacoes.js')
const usuariosSrv = await import('../src/rotas/usuarios.js')
const veiculosSrv = await import('../src/rotas/veiculos.js')

test('vocabulario: todo status e prioridade do dominio tem rotulo e tom', () => {
  const pares = [
    ['prioridade de ocorrencia', motor.PRIORIDADES,
      uiDoTeste.ROTULO_PRIORIDADE, uiDoTeste.TOM_PRIORIDADE],
    ['status de preventiva', preventivas.STATUS_PREVENTIVA,
      uiDoTeste.ROTULO_STATUS_PREVENTIVA, uiDoTeste.TOM_STATUS_PREVENTIVA],
    ['tipo de veiculo', motor.TIPOS_VEICULO, uiDoTeste.ROTULO_TIPO_VEICULO, null],
    ['status de ocorrencia', ocorrenciasSrv.STATUS_OCORRENCIA,
      uiDoTeste.ROTULO_STATUS_OCORRENCIA, uiDoTeste.TOM_STATUS_OCORRENCIA],
    ['status de solicitacao', solicitacoesSrv.STATUS_SOLICITACAO,
      uiDoTeste.ROTULO_STATUS_SOLICITACAO, uiDoTeste.TOM_STATUS_SOLICITACAO],
    ['status de credencial', usuariosSrv.STATUS_CREDENCIAL,
      uiDoTeste.ROTULO_STATUS_USUARIO, uiDoTeste.TOM_STATUS_USUARIO],
    ['status de veiculo', veiculosSrv.STATUS_VEICULO,
      uiDoTeste.ROTULO_STATUS_VEICULO, uiDoTeste.TOM_STATUS_VEICULO],
  ]

  for (const [nome, valores, rotulos, tons] of pares) {
    assert.ok(Array.isArray(valores) && valores.length, `${nome}: lista vazia na varredura`)
    const semRotulo = valores.filter((v) => !rotulos?.[v])
    assert.deepEqual(semRotulo, [], `${nome} sem rotulo na tela: ${semRotulo.join(', ')}`)
    if (tons) {
      const semTom = valores.filter((v) => !tons[v])
      assert.deepEqual(semTom, [], `${nome} sem tom na tela: ${semTom.join(', ')}`)
    }
  }
})

test('vocabulario: os estados de execucao que o motor produz sao os que a tela conhece', () => {
  // `classificarExecucao` so devolve dois; o terceiro, 'nao_realizado', e'
  // derivado no servidor por quem tem a lista de quem devia fazer. A lista
  // existe para que os tres andem juntos.
  assert.deepEqual(motor.ESTADOS_EXECUCAO, ['no_prazo', 'atrasado', 'nao_realizado'])
  const produzidos = new Set([
    motor.classificarExecucao({ horario_limite: '08:00' }, 7 * 60),
    motor.classificarExecucao({ horario_limite: '08:00' }, 9 * 60),
  ])
  for (const e of produzidos) {
    assert.ok(motor.ESTADOS_EXECUCAO.includes(e), `${e} nao esta na lista de estados`)
  }
})

