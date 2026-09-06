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

// "frota" = so a equipe da frota alcanca. "todos" = qualquer usuario ativo.
const TELAS = [
  { chave: 'painel', rotulo: 'Painel', quem: 'frota', montar: telaPainel },
  { chave: 'veiculos', rotulo: 'Frota', quem: 'todos', montar: telaVeiculos },
  { chave: 'solicitacoes', rotulo: 'Solicitacoes', quem: 'todos', montar: telaSolicitacoes },
  { chave: 'ocorrencias', rotulo: 'Ocorrencias', quem: 'frota', montar: telaOcorrencias },
  { chave: 'preventivas', rotulo: 'Preventivas', quem: 'frota', montar: telaPreventivas },
  // "Checklists" abre duas linhas ao passar o mouse (roadmap 11.8). Sao coisas
  // diferentes empilhadas na mesma palavra: FEITOS e' operacao, aberta todo
  // dia; MODELOS e' cadastro, mexido de vez em quando.
  { chave: 'execucoes',
    rotulo: 'Checklists',
    quem: 'todos',
    montar: telaExecucoes,
    filhos: [
      { chave: 'execucoes', rotulo: 'Checklists feitos', dica: 'o que aconteceu' },
      { chave: 'templates', rotulo: 'Modelos de checklist', dica: 'o que deve acontecer', quem: 'frota' },
    ] },
  { chave: 'templates', rotulo: 'Modelos de checklist', quem: 'frota', montar: telaTemplates, oculto: true },
  { chave: 'categorias', rotulo: 'Categorias de uso', quem: 'frota', montar: telaCategorias, oculto: true },
  { chave: 'usuarios', rotulo: 'Usuarios', quem: 'frota', montar: telaUsuarios },
  { chave: 'auditoria', rotulo: 'Auditoria', quem: 'frota', montar: telaAuditoria },
]

const estado = { usuario: null, telaAtual: null, parametros: {} }

const contexto = {
  get usuario() { return estado.usuario },
  get parametros() { return estado.parametros },
  get ehFrota() { return estado.usuario?.nivel === 'frota' },
  irPara: (chave, parametros) => navegar(chave, parametros),
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
  return contexto.ehFrota ? 'painel' : 'solicitacoes'
}

async function navegar(chave, parametros = {}) {
  const visiveis = telasVisiveis()
  const tela = visiveis.find((t) => t.chave === chave)
    || visiveis.find((t) => t.chave === telaPadrao())
    || visiveis[0]
  if (!tela) return
  estado.telaAtual = tela.chave
  estado.parametros = parametros
  history.replaceState(null, '', `#${tela.chave}`)
  desenharNavegacao()

  const conteudo = document.getElementById('conteudo')
  limpar(conteudo)
  try {
    await tela.montar(conteudo, contexto)
  } catch (falha) {
    if (falha instanceof ErroApi && falha.status === 401) { await encerrarSessao(); return }
    if (falha instanceof ErroApi && falha.codigo === 'troca_de_senha_obrigatoria') {
      return exigirTrocaDeSenha()
    }
    limpar(conteudo)
    conteudo.append(elemento('div', { classe: 'aviso aviso--erro', texto: falha.message }))
  }
}

// ---------------------------------------------------------------- sessao

function mostrar(telaId) {
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

function entrarNoApp(usuario) {
  estado.usuario = usuario
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
    const { usuario } = await api.login(
      document.getElementById('login-email').value.trim(),
      document.getElementById('login-senha').value,
    )
    entrarNoApp(usuario)
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
document.getElementById('login-marca').append(marca({ grande: true }))
document.getElementById('app-marca').append(marca())

async function iniciar() {
  try {
    const { usuario } = await api.eu()
    entrarNoApp(usuario)
  } catch {
    mostrar('tela-login')
    document.getElementById('login-email').focus()
  }
}

iniciar()
