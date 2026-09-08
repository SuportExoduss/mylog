// Ponto de entrada do MyLog. Serve a API e o painel web no mesmo processo.
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { config, avisarSegredoFraco } from './nucleo/config.js'
import { abrirBanco } from './nucleo/banco.js'
import {
  criarRoteador, lerCorpo, responder, lerCookies, ipDe, aplicarSeguranca, ErroHttp, erro,
} from './nucleo/http.js'
import { usuarioDaSessao, NOME_COOKIE } from './seguranca/sessao.js'
import { registrarRotasAutenticacao } from './rotas/autenticacao.js'
import { registrarRotasUsuarios } from './rotas/usuarios.js'
import { registrarRotasVeiculos } from './rotas/veiculos.js'
import { registrarRotasPainel } from './rotas/painel.js'
import { registrarRotasTemplates } from './rotas/templates.js'
import { registrarRotasPreventivas } from './rotas/preventivas.js'
import { registrarRotasOcorrencias, registrarRotasAuditoria } from './rotas/ocorrencias.js'
import { registrarRotasCategorias } from './rotas/categorias.js'
import { registrarRotasMarca } from './rotas/marca.js'
import { registrarRotasNotificacoes } from './rotas/notificacoes.js'
import { registrarRotasSolicitacoes } from './rotas/solicitacoes.js'
import { registrarRotasInspecoes } from './rotas/inspecoes.js'
import { registrarRotasExecucoes } from './rotas/execucoes.js'
import { registrarRotasEvidencias } from './rotas/evidencias.js'
import { registrarRotasRelatorios } from './rotas/relatorios.js'

avisarSegredoFraco()
abrirBanco()

const rotas = criarRoteador()
registrarRotasAutenticacao(rotas)
registrarRotasPainel(rotas)
registrarRotasUsuarios(rotas)
registrarRotasVeiculos(rotas)
registrarRotasTemplates(rotas)
registrarRotasPreventivas(rotas)
registrarRotasCategorias(rotas)
registrarRotasMarca(rotas)
registrarRotasNotificacoes(rotas)
registrarRotasSolicitacoes(rotas)
registrarRotasOcorrencias(rotas)
registrarRotasAuditoria(rotas)
registrarRotasInspecoes(rotas)
registrarRotasExecucoes(rotas)
registrarRotasEvidencias(rotas)
registrarRotasRelatorios(rotas)

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
  // Tudo dentro do callback vai num `try`: erro aqui NAO pode virar conexao
  // pendurada.
  //
  // O `try/catch` que envolve o roteador nao alcanca callback de I/O — quando
  // ele roda, a pilha da requisicao ja acabou. Um erro aqui dentro nao virava
  // 500: a resposta simplesmente nunca era escrita, e o cliente ficava
  // esperando ate o proprio tempo limite.
  //
  // Descobri isto por acidente, escrevendo um `caminhoUrl` que nao existe neste
  // escopo. A suite nao acusou o erro — ela TRAVOU. Em producao seria pior: um
  // navegador esperando indefinidamente por um arquivo, sem mensagem nenhuma, e
  // no log do servidor nada, porque nada falhou de forma visivel.
  fs.readFile(destino, (falha, conteudo) => {
   try {
    if (falha) {
      // O index so cobre ROTA — caminho sem extensao, resolvido no cliente.
      // Arquivo que nao existe precisa dizer 404.
      //
      // Sem essa distincao, um import com erro de digitacao volta como HTML
      // com status 200, e o navegador tenta interpretar uma pagina como
      // modulo: o erro que aparece e' "unknown error fetching the script", que
      // nao diz nada sobre o arquivo que falta. O mesmo vale para uma imagem
      // ou um manifesto errado, que viram uma pagina inteira em cache.
      const extensao = path.extname(destino).toLowerCase()
      if (extensao && extensao !== '.html') {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
           .end('Arquivo nao encontrado')
        return
      }
      fs.readFile(path.join(raiz, 'index.html'), (falha2, indice) => {
        if (falha2) { res.writeHead(404).end('Nao encontrado'); return }
        res.writeHead(200, { 'content-type': TIPOS['.html'] }).end(indice)
      })
      return
    }
    const cabecalhos = {
      'content-type': TIPOS[path.extname(destino).toLowerCase()] || 'application/octet-stream',
      'cache-control': config.ambiente === 'desenvolvimento' ? 'no-store' : 'public, max-age=300',
    }

    res.writeHead(200, cabecalhos).end(conteudo)
   } catch (erroInterno) {
    console.error('falha ao servir arquivo estatico', destino, erroInterno)
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
         .end('Falha ao servir o arquivo.')
    } else {
      res.end()
    }
   }
  })
}

// ------------------------------------------------------------------ servidor

const PRODUCAO = config.ambiente !== 'desenvolvimento'

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

  // Antes de qualquer decisao sobre a rota: os cabecalhos valem para tudo que
  // sair daqui, inclusive o arquivo estatico e as rotas que escrevem o binario
  // elas mesmas. `setHeader` sobrevive ao `writeHead` que vem depois.
  aplicarSeguranca(res, {
    producao: PRODUCAO,
    // Atras de um proxy, quem sabe se a conversa comecou em HTTPS e' o proxy.
    https: req.socket.encrypted === true
      || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https',
  })

  // Um numero por requisicao. Aparece no log de erro e na resposta de falha
  // inesperada, para que "deu erro as 8h10" vire uma linha localizavel em vez
  // de uma busca no dia inteiro.
  const requisicaoId = randomUUID().slice(0, 8)
  res.setHeader('x-requisicao-id', requisicaoId)

  // /relatorio/* devolve HTML e /imagens/* devolve binario, mas os dois passam
  // pelo roteador: precisam de sessao e de consulta ao banco, e nao sao
  // arquivo estatico.
  //
  // /imagens/ fica FORA de /api/ de proposito: o service worker do aplicativo
  // ignora /api/ (dado de frota velho e' pior que dado ausente), mas guarda o
  // resto. Assim a foto de exemplo de cada pergunta fica no cache e o
  // checklist abre no patio sem sinal (roadmap 19).
  const ehRota = url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/relatorio/')
    || url.pathname.startsWith('/imagens/')

  if (!ehRota) {
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
      requisicaoId,
    }

    let resultado
    for (const manipulador of encontrado.rota.manipuladores) {
      resultado = await manipulador(ctx)
    }
    // Rotas que servem binario (imagem, PDF) escrevem a resposta elas mesmas.
    if (res.headersSent || res.writableEnded) return
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
    console.error(`[erro] ${requisicaoId}`, req.method, url.pathname, falha)
    responder(res, 500, {
      erro: 'erro_interno',
      // O numero vai junto de proposito: e' o que a pessoa consegue ditar por
      // radio, e o que liga a queixa dela a linha certa do log.
      mensagem: `Falha inesperada no servidor. Informe o codigo ${requisicaoId}.`,
      requisicao_id: requisicaoId,
    })
  }
})

servidor.listen(config.porta, () => {
  console.log(`MyLog em http://localhost:${config.porta}  (${config.ambiente})`)
  console.log(`banco: ${config.bancoCaminho}`)
})

export { servidor }
