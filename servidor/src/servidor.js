// Ponto de entrada do MyLog. Serve a API e o painel web no mesmo processo.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { config, avisarSegredoFraco } from './nucleo/config.js'
import { abrirBanco } from './nucleo/banco.js'
import { criarRoteador, lerCorpo, responder, lerCookies, ipDe, ErroHttp, erro } from './nucleo/http.js'
import { usuarioDaSessao, NOME_COOKIE } from './seguranca/sessao.js'
import { registrarRotasAutenticacao } from './rotas/autenticacao.js'
import { registrarRotasUsuarios } from './rotas/usuarios.js'
import { registrarRotasVeiculos } from './rotas/veiculos.js'
import { registrarRotasPainel } from './rotas/painel.js'
import { registrarRotasTemplates } from './rotas/templates.js'
import { registrarRotasPreventivas } from './rotas/preventivas.js'
import { registrarRotasTickets } from './rotas/tickets.js'
import { registrarRotasOcorrencias, registrarRotasAuditoria } from './rotas/ocorrencias.js'
import { registrarRotasInspecoes } from './rotas/inspecoes.js'

avisarSegredoFraco()
abrirBanco()

const rotas = criarRoteador()
registrarRotasAutenticacao(rotas)
registrarRotasPainel(rotas)
registrarRotasUsuarios(rotas)
registrarRotasVeiculos(rotas)
registrarRotasTemplates(rotas)
registrarRotasPreventivas(rotas)
registrarRotasTickets(rotas)
registrarRotasOcorrencias(rotas)
registrarRotasAuditoria(rotas)
registrarRotasInspecoes(rotas)

// ----------------------------------------------------------- arquivos web

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function servirEstatico(caminhoUrl, res) {
  // O motor de checklist e' o mesmo arquivo que o servidor usa: servido daqui,
  // nao copiado. Copia vira divergencia, e divergencia aqui significa o app
  // aprovar offline o que o servidor reprova depois.
  if (caminhoUrl.startsWith('/compartilhado/')) {
    return servirArquivo(path.resolve(config.compartilhadoCaminho, caminhoUrl.slice(15)),
      config.compartilhadoCaminho, res)
  }
  // O aplicativo de campo tem shell proprio; rota desconhecida sob /app cai
  // no index dele, nao no do painel.
  const noApp = caminhoUrl === '/app' || caminhoUrl.startsWith('/app/')
  const raiz = noApp ? config.appCaminho : config.webCaminho
  const relativo = noApp
    ? (caminhoUrl === '/app' || caminhoUrl === '/app/' ? 'index.html' : caminhoUrl.slice(5))
    : (caminhoUrl === '/' ? 'index.html' : caminhoUrl.slice(1))
  const destino = path.resolve(raiz, relativo)
  return servirArquivo(destino, raiz, res)
}

function servirArquivo(destino, raiz, res) {
  // Barra qualquer tentativa de sair da raiz servida.
  if (!destino.startsWith(path.resolve(raiz))) {
    res.writeHead(403).end('Acesso negado')
    return
  }
  fs.readFile(destino, (falha, conteudo) => {
    if (falha) {
      // Rotas resolvidas no cliente: cai no index da raiz correspondente.
      fs.readFile(path.join(raiz, 'index.html'), (falha2, indice) => {
        if (falha2) { res.writeHead(404).end('Nao encontrado'); return }
        res.writeHead(200, { 'content-type': TIPOS['.html'] }).end(indice)
      })
      return
    }
    res.writeHead(200, {
      'content-type': TIPOS[path.extname(destino).toLowerCase()] || 'application/octet-stream',
      'cache-control': config.ambiente === 'desenvolvimento' ? 'no-store' : 'public, max-age=300',
    }).end(conteudo)
  })
}

// ------------------------------------------------------------------ servidor

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

  if (!url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return }
    servirEstatico(url.pathname, res)
    return
  }

  try {
    const encontrado = rotas.resolver(req.method, url.pathname)
    if (!encontrado) throw erro.naoEncontrado('Rota inexistente.')

    const cookies = lerCookies(req)
    const cabecalho = req.headers.authorization || ''
    const token = cabecalho.startsWith('Bearer ')
      ? cabecalho.slice(7).trim()
      : cookies[NOME_COOKIE] || null

    const ctx = {
      req, res,
      params: encontrado.params,
      query: url.searchParams,
      corpo: req.method === 'GET' || req.method === 'DELETE' ? {} : await lerCorpo(req),
      token,
      usuario: usuarioDaSessao(token),
      ip: ipDe(req),
    }

    let resultado
    for (const manipulador of encontrado.rota.manipuladores) {
      resultado = await manipulador(ctx)
    }
    responder(res, 200, resultado ?? { ok: true })
  } catch (falha) {
    if (falha instanceof ErroHttp) {
      responder(res, falha.status, { erro: falha.codigo, mensagem: falha.message })
      return
    }
    // Conflitos do banco viram 409 legivel em vez de 500 opaco.
    if (String(falha?.message || '').includes('UNIQUE constraint failed')) {
      responder(res, 409, { erro: 'conflito', mensagem: 'Registro duplicado.' })
      return
    }
    console.error('[erro]', req.method, url.pathname, falha)
    responder(res, 500, { erro: 'erro_interno', mensagem: 'Falha inesperada no servidor.' })
  }
})

servidor.listen(config.porta, () => {
  console.log(`MyLog em http://localhost:${config.porta}  (${config.ambiente})`)
  console.log(`banco: ${config.bancoCaminho}`)
})

export { servidor }
