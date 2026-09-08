// Shell do painel: sessao, navegacao e montagem das telas.
import { api, ErroApi } from './api.js'
import { elemento, limpar, notificar, marca, alternarTema, ROTULO_NIVEL } from './ui.js'
import { telaPainel } from './painel.js'
import { telaVeiculos } from './veiculos.js'
import { telaSolicitacoes } from './solicitacoes.js'
import { telaOcorrencias, telaAuditoria } from './ocorrencias.js'
import { telaPreventivas } from './preventivas.js'
import { telaTemplates } from './templates.js'
import { telaExecucoes } from './execucoes.js'
import { telaCategorias } from './categorias.js'
import { montarSino } from './sino.js'
import { telaUsuarios } from './usuarios.js'
import { telaConfiguracoes } from './configuracoes.js'
import { guardarMarca, marcaComEmpresa, pintar } from './marca.js'

// Todas as telas sao da Frota: o painel nao admite quem foi cadastrado como
// somente aplicativo, e a recusa acontece no login (rotas/autenticacao.js).
// `quem` continua aqui como segunda barreira — se algum dia alguem entrar por
// um caminho que ninguem previu, nao encontra tela montada.
const TELAS = [
  { chave: 'painel', rotulo: 'Painel', quem: 'frota', montar: telaPainel },
  { chave: 'veiculos', rotulo: 'Frota', quem: 'frota', montar: telaVeiculos },
  { chave: 'solicitacoes', rotulo: 'Solicitacoes', quem: 'frota', montar: telaSolicitacoes },
  { chave: 'ocorrencias', rotulo: 'Ocorrencias', quem: 'frota', montar: telaOcorrencias },
  { chave: 'preventivas', rotulo: 'Preventivas', quem: 'frota', montar: telaPreventivas },
  // "Checklists" abre duas linhas ao passar o mouse (roadmap 11.8). Sao coisas
  // diferentes empilhadas na mesma palavra: FEITOS e' operacao, aberta todo
  // dia; MODELOS e' cadastro, mexido de vez em quando.
  { chave: 'execucoes',
    rotulo: 'Checklists',
    quem: 'frota',
    montar: telaExecucoes,
    filhos: [
      { chave: 'execucoes', rotulo: 'Checklists feitos', dica: 'o que aconteceu' },
      { chave: 'templates', rotulo: 'Modelos de checklist', dica: 'o que deve acontecer', quem: 'frota' },
    ] },
  { chave: 'templates', rotulo: 'Modelos de checklist', quem: 'frota', montar: telaTemplates, oculto: true },
  { chave: 'categorias', rotulo: 'Categorias de uso', quem: 'frota', montar: telaCategorias, oculto: true },
  { chave: 'usuarios', rotulo: 'Usuarios', quem: 'frota', montar: telaUsuarios },
  { chave: 'auditoria', rotulo: 'Auditoria', quem: 'frota', montar: telaAuditoria },

  // No FIM da lista, e' de proposito, e com separacao visual: tudo acima e'
  // operacao, aberta todo dia. Configuracoes e' aparencia da empresa, mexida
  // uma vez e revisitada raramente. Misturar as duas coisas na mesma altura da
  // lateral faria a pessoa procurar "Frota" e ler "Configuracoes" no caminho.
  { chave: 'configuracoes', rotulo: 'Configuracoes', quem: 'frota',
    montar: telaConfiguracoes, aoPe: true },
]

const estado = { usuario: null, telaAtual: null, parametros: {} }

// Devolvido pela tela que precisa desfazer algo ao sair. Ver `desmontarTela`.
let desmontarTelaAtual = null

// Desfaz o que a tela atual deixou FORA do proprio no'.
//
// Existe porque sair de uma tela nao e' so trocar o conteudo: a de
// configuracoes pinta a PREVIA da marca numa folha de estilo no `<head>` e
// leva o painel para o tema que esta sendo editado. Nada disso e' alcancado
// por `limpar(conteudo)`.
function desmontarTela() {
  desmontarTelaAtual?.()
  desmontarTelaAtual = null
}

const contexto = {
  get usuario() { return estado.usuario },
  get parametros() { return estado.parametros },
  get ehFrota() { return estado.usuario?.nivel === 'frota' },
  irPara: (chave, parametros) => navegar(chave, parametros),
  // O sino descobre a sessao vencida antes de qualquer tela, porque ele bate
  // no servidor sozinho a cada minuto. Quando descobre, avisa por aqui.
  aoExpirarSessao: () => encerrarSessao(),
  // A tela de configuracoes avisa quando publicou: a lateral redesenha com a
  // marca nova sem recarregar a pagina.
  marcaMudou: () => desenharMarcaLateral(),
}

function desenharMarcaLateral() {
  const alvo = document.getElementById('app-marca')
  if (!alvo) return
  limpar(alvo)
  alvo.append(marcaComEmpresa())
}

// ------------------------------------------------------------- navegacao

function podeVer(tela) {
  return tela.quem === 'todos' || contexto.ehFrota
}

// Inclui as telas ocultas: elas existem para navegar, so nao ganham botao
// proprio no menu (chega-se a elas pelo submenu ou por um link de outra tela).
function telasVisiveis() {
  return TELAS.filter(podeVer)
}

function filhosVisiveis(tela) {
  return (tela.filhos || []).filter(podeVer)
}

function desenharNavegacao() {
  const nav = document.getElementById('nav')
  limpar(nav)

  for (const tela of telasVisiveis()) {
    if (tela.oculto) continue
    // `aoPe` empurra o item para baixo de tudo, com uma linha antes. E' a
    // separacao entre operacao e cadastro de aparencia.
    if (tela.aoPe) {
      nav.append(elemento('button', {
        classe: `nav-ao-pe${tela.chave === estado.telaAtual ? ' ativo' : ''}`,
        texto: tela.rotulo,
        aoClick: () => navegar(tela.chave),
      }))
      continue
    }

    const filhos = filhosVisiveis(tela)
    // Uma linha so quando o submenu nao acrescenta nada: item com um unico
    // filho e' menu que existe para nao dizer nada.
    if (filhos.length < 2) {
      nav.append(elemento('button', {
        classe: tela.chave === estado.telaAtual ? 'ativo' : '',
        texto: tela.rotulo,
        aoClick: () => navegar(tela.chave),
      }))
      continue
    }

    const ativo = filhos.some((f) => f.chave === estado.telaAtual)
    const gatilho = elemento('button', {
      classe: `nav-pai${ativo ? ' ativo' : ''}`,
      'aria-expanded': String(ativo),
      texto: tela.rotulo,
      // Clicar tambem abre: teclado e toque nao tem "passar o mouse".
      aoClick: () => navegar(filhos[0].chave),
    })

    // O envoltorio interno existe por causa da animacao: `grid-template-rows`
    // de 0fr para 1fr define UMA faixa. Com dois botoes soltos, o segundo cai
    // numa faixa implicita e os dois se sobrepoem quando fechado.
    const lista = elemento('div', { classe: 'nav-filhos' }, [
      elemento('div', { classe: 'nav-filhos-interno' }, filhos.map((filho) =>
      elemento('button', {
        classe: `nav-filho${filho.chave === estado.telaAtual ? ' ativo' : ''}`,
        aoClick: (evento) => { evento.stopPropagation(); navegar(filho.chave) },
      }, [
        elemento('span', { classe: 'nav-filho-rotulo', texto: filho.rotulo }),
        filho.dica ? elemento('span', { classe: 'nav-filho-dica', texto: filho.dica }) : null,
      ]))),
    ])

    nav.append(elemento('div', { classe: `nav-grupo${ativo ? ' aberto' : ''}` }, [gatilho, lista]))
  }
}

// Onde cada nivel comeca: a Frota no panorama, o colaborador no que ele veio
// fazer. Tambem e' o destino quando o #hash guardado nao vale para este usuario.
function telaPadrao() {
  return 'painel'
}

// `voltando` distingue a navegacao que a pessoa pediu da que o navegador
// desfez: a primeira empilha, a segunda nao — senao o botao Voltar criaria
// entradas novas e nunca sairia do lugar.
async function navegar(chave, parametros = {}, { voltando = false } = {}) {
  const visiveis = telasVisiveis()
  const tela = visiveis.find((t) => t.chave === chave)
    || visiveis.find((t) => t.chave === telaPadrao())
    || visiveis[0]
  if (!tela) return

  // Trocar de tela fecha o que estiver aberto por cima dela. Sem isto, voltar
  // com um modal aberto trocaria a tela por baixo e deixaria o modal boiando
  // sobre outro assunto.
  limpar(document.getElementById('area-modal'))

  const mesmaTela = estado.telaAtual === tela.chave
  estado.telaAtual = tela.chave
  estado.parametros = parametros

  // Era sempre `replaceState`, e por isso o painel nao tinha historico: tres
  // telas navegadas e `history.length` continuava igual. O botao Voltar —
  // reflexo de quem passa o dia numa aba — jogava a pessoa para fora do
  // aplicativo. Reentrar na MESMA tela continua substituindo, senao mudar um
  // filtro encheria a pilha de entradas iguais.
  const entrada = { chave: tela.chave, parametros }
  if (voltando || mesmaTela) {
    history.replaceState(entrada, '', `#${tela.chave}`)
  } else {
    history.pushState(entrada, '', `#${tela.chave}`)
  }
  desenharNavegacao()

  const conteudo = document.getElementById('conteudo')
  // Sem desfazer aqui, quem espia uma cor e navega para outra secao leva a cor
  // nao publicada junto, e acha que salvou.
  desmontarTela()
  limpar(conteudo)
  try {
    const desmontar = await tela.montar(conteudo, contexto)
    if (typeof desmontar === 'function') desmontarTelaAtual = desmontar
  } catch (falha) {
    if (falha instanceof ErroApi && falha.status === 401) { await encerrarSessao(); return }
    if (falha instanceof ErroApi && falha.codigo === 'troca_de_senha_obrigatoria') {
      return exigirTrocaDeSenha()
    }
    limpar(conteudo)
    conteudo.append(elemento('div', { classe: 'aviso aviso--erro', texto: falha.message }))
  }
}

// Voltar e Avancar do navegador. So valem com sessao aberta: fora dela a pilha
// e' do navegador, e mexer nela seria prender a pessoa na tela de login.
addEventListener('popstate', (evento) => {
  if (!estado.usuario) return
  const alvo = evento.state || {}
  navegar(alvo.chave || location.hash.slice(1) || telaPadrao(), alvo.parametros || {},
    { voltando: true })
})

// ---------------------------------------------------------------- sessao

// Trocar de tela SEMPRE desmonta o que estava no ar.
//
// O desmonte estava em `navegar`, e so la. Por isso o logout escapava: ele
// troca a tela sem navegar. Quem espiasse uma cor na tela de configuracoes e
// clicasse em "Sair" ia parar num login pintado com a cor NAO PUBLICADA da
// empresa anterior, e com a preferencia de tema sequestrada — a folha de
// previa e o `data-tema` forcado ficavam no `<head>` e no elemento raiz, que
// `limpar(conteudo)` nao alcanca.
//
// Consertar so o logout deixaria a proxima porta aberta. Aqui dentro nao ha
// porta: trocar de tela e desmontar viraram a mesma coisa.
function mostrar(telaId) {
  desmontarTela()
  for (const id of ['tela-login', 'tela-app']) {
    document.getElementById(id).classList.toggle('oculto', id !== telaId)
  }
}

// Roadmap 8.1: enquanto a senha inicial nao for trocada, nao ha mais nada.
function exigirTrocaDeSenha() {
  mostrar('tela-app')
  limpar(document.getElementById('nav'))
  const conteudo = document.getElementById('conteudo')
  limpar(conteudo)

  const atual = elemento('input', { type: 'password', autocomplete: 'current-password', required: true })
  const nova = elemento('input', { type: 'password', autocomplete: 'new-password', required: true })
  const aviso = elemento('div', { classe: 'aviso aviso--erro oculto' })

  conteudo.append(elemento('form', {
    classe: 'login-caixa',
    aoSubmit: async (evento) => {
      evento.preventDefault()
      aviso.classList.add('oculto')
      try {
        const { usuario } = await api.trocarSenha(atual.value, nova.value)
        notificar('Senha alterada. Bem-vindo ao MyLog.')
        entrarNoApp(usuario)
      } catch (falha) {
        aviso.textContent = falha.message
        aviso.classList.remove('oculto')
      }
    },
  }, [
    elemento('h1', { classe: 'marca-nome', html: 'Primeiro acesso' }),
    elemento('p', { classe: 'login-sub',
      texto: 'Troque a senha inicial para liberar o sistema. Ela foi gerada e nao deve continuar em uso.' }),
    aviso,
    elemento('div', { classe: 'campo' }, [elemento('label', { texto: 'Senha atual' }), atual]),
    elemento('div', { classe: 'campo' }, [
      elemento('label', { texto: 'Nova senha' }), nova,
      elemento('div', { classe: 'campo-dica', texto: 'Minimo de 8 caracteres, com letras e numeros.' }),
    ]),
    elemento('button', { classe: 'botao botao--largo esp-t-4', type: 'submit', texto: 'Trocar senha e entrar' }),
  ]))
}

// O sino vive fora das telas: precisa sobreviver a navegacao, e por isso e'
// montado uma vez ao entrar e desmontado ao sair.
let sino = null

// O nivel de acesso e' escolhido no cadastro: total, ou somente aplicativo
// (roadmap 3). Quem foi marcado como somente aplicativo errou de porta.
//
// A recusa acontece AQUI, no shell, e nao no login do servidor. O token nao
// pertence a um cliente: barrar por um campo do corpo seria teatro — bastaria
// mandar `origem: 'app'` para passar — e ainda trancaria, sem explicacao, um
// aplicativo Android que esquecesse o campo. O que se restringe e' a
// INTERFACE, entao a interface e' quem restringe.
//
// Nao e' seguranca: as rotas administrativas ja recusam com 403, e ha teste
// provando. E' coerencia — duas interfaces para a mesma pessoa dobram o que ha
// para manter, testar e proteger, e a fase seguinte multiplica cada tela por
// empresa.
function portaErrada(usuario) {
  mostrar('tela-login')
  const aviso = document.getElementById('login-aviso')
  aviso.replaceChildren(
    `${usuario.nome.split(' ')[0]}, seu acesso e pelo aplicativo. `,
    elemento('a', { href: '/app/', texto: 'Abrir o aplicativo' }),
  )
  aviso.classList.remove('oculto')
  document.getElementById('form-login').reset()
  // A sessao fica aberta de proposito: o aplicativo vai reaproveita-la, e
  // pedir a senha de novo na tela seguinte seria castigo por ter errado a
  // porta com a credencial certa.
}

function entrarNoApp(usuario, marca) {
  if (!usuario.acessa_painel) return portaErrada(usuario)

  estado.usuario = usuario
  // A marca chega no MESMO pacote que diz quem a pessoa e', e e' aplicada
  // antes de qualquer tela montar: nao existe instante em que o painel mostra
  // a marca de uma empresa e os dados de outra.
  guardarMarca(marca)
  desenharMarcaLateral()
  document.getElementById('perfil-nome').textContent = usuario.nome
  document.getElementById('perfil-papel').textContent =
    `${ROTULO_NIVEL[usuario.nivel]}${usuario.cargo_nome ? ' · ' + usuario.cargo_nome : ''}`
  mostrar('tela-app')

  if (usuario.deve_trocar_senha) return exigirTrocaDeSenha()

  sino?.parar()
  sino = montarSino(contexto)
  navegar(location.hash.slice(1) || telaPadrao())
}

async function encerrarSessao() {
  try { await api.sair() } catch { /* a sessao ja podia estar invalida */ }
  // Para o relogio do sino: sem isso ele continuaria batendo no servidor
  // depois do logout, tomando 401 a cada minuto.
  sino?.parar()
  sino = null
  estado.usuario = null
  estado.telaAtual = null
  // A tela de login nao e' de empresa nenhuma. Deixar a marca da ultima
  // empresa ali diria, para quem pega o computador depois, quem esteve
  // logado — e pintaria o login de uma empresa para alguem de outra.
  guardarMarca(null)
  desenharMarcaLateral()
  mostrar('tela-login')
  document.getElementById('form-login').reset()
}

// ----------------------------------------------------------------- login

document.getElementById('form-login').addEventListener('submit', async (evento) => {
  evento.preventDefault()
  const aviso = document.getElementById('login-aviso')
  const botao = document.getElementById('login-botao')
  aviso.classList.add('oculto')
  botao.disabled = true
  botao.textContent = 'Entrando...'
  try {
    const { usuario, marca } = await api.login(
      document.getElementById('login-email').value.trim(),
      document.getElementById('login-senha').value,
    )
    entrarNoApp(usuario, marca)
  } catch (falha) {
    aviso.textContent = falha.message
    aviso.classList.remove('oculto')
  } finally {
    botao.disabled = false
    botao.textContent = 'Entrar'
  }
})

document.getElementById('botao-sair').addEventListener('click', async () => {
  await encerrarSessao()
  notificar('Sessao encerrada.')
})

document.getElementById('botao-tema').addEventListener('click', () => {
  notificar(alternarTema() === 'escuro' ? 'Tema escuro.' : 'Tema claro.')
})

// ------------------------------------------------------------- inicio

// A marca e' desenhada, nao escrita no HTML: um lugar so define o simbolo.
// O login mostra so o MyLog: quem ainda nao entrou nao tem empresa.
document.getElementById('login-marca').append(marca({ grande: true }))
desenharMarcaLateral()

async function iniciar() {
  try {
    const { usuario, marca } = await api.eu()
    entrarNoApp(usuario, marca)
  } catch {
    mostrar('tela-login')
    document.getElementById('login-email').focus()
  }
}

iniciar()
