// Shell do painel: sessao, navegacao e montagem das telas.
import { api, ErroApi } from './api.js'
import { elemento, limpar, notificar, ROTULO_PAPEL } from './ui.js'
import { telaPainel } from './painel.js'
import { telaUsuarios } from './usuarios.js'
import { telaVeiculos } from './veiculos.js'
import { telaTemplates } from './templates.js'
import { telaPreventivas } from './preventivas.js'

const TELAS = [
  { chave: 'painel', rotulo: 'Painel', capacidade: 'painel.ver', montar: telaPainel },
  { chave: 'veiculos', rotulo: 'Frota', capacidade: 'veiculos.ler', montar: telaVeiculos },
  { chave: 'preventivas', rotulo: 'Preventivas', capacidade: 'preventivas.ler', montar: telaPreventivas },
  { chave: 'templates', rotulo: 'Checklists', capacidade: 'templates.ler', montar: telaTemplates },
  { chave: 'usuarios', rotulo: 'Usuarios', capacidade: 'usuarios.ler', montar: telaUsuarios },
]

const estado = { usuario: null, telaAtual: null, parametros: {} }

const contexto = {
  get usuario() { return estado.usuario },
  get parametros() { return estado.parametros },
  pode: (capacidade) => estado.usuario?.capacidades?.includes(capacidade) ?? false,
  irPara: (chave, parametros) => navegar(chave, parametros),
}

// ------------------------------------------------------------- navegacao

function telasVisiveis() {
  return TELAS.filter((tela) => contexto.pode(tela.capacidade))
}

function desenharNavegacao() {
  const nav = document.getElementById('nav')
  limpar(nav)
  for (const tela of telasVisiveis()) {
    nav.append(elemento('button', {
      classe: tela.chave === estado.telaAtual ? 'ativo' : '',
      texto: tela.rotulo,
      aoClick: () => navegar(tela.chave),
    }))
  }
}

async function navegar(chave, parametros = {}) {
  const tela = telasVisiveis().find((t) => t.chave === chave) || telasVisiveis()[0]
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

function entrarNoApp(usuario) {
  estado.usuario = usuario
  document.getElementById('perfil-nome').textContent = usuario.nome
  document.getElementById('perfil-papel').textContent = ROTULO_PAPEL[usuario.papel] || usuario.papel
  mostrar('tela-app')
  const alvo = location.hash.slice(1)
  navegar(alvo || 'painel')
}

async function encerrarSessao() {
  try { await api.sair() } catch { /* a sessao ja podia estar invalida */ }
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

// ------------------------------------------------------------- inicio

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
