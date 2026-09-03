// Roteador minimo sobre node:http. Sem dependencias externas.
import { StringDecoder } from 'node:string_decoder'

export class ErroHttp extends Error {
  constructor(status, codigo, mensagem) {
    super(mensagem || codigo)
    this.status = status
    this.codigo = codigo
  }
}

export const erro = {
  requisicao: (m) => new ErroHttp(400, 'requisicao_invalida', m),
  autenticacao: (m) => new ErroHttp(401, 'nao_autenticado', m),
  permissao: (m) => new ErroHttp(403, 'sem_permissao', m),
  naoEncontrado: (m) => new ErroHttp(404, 'nao_encontrado', m),
  conflito: (m) => new ErroHttp(409, 'conflito', m),
}

// Uma foto comprimida do app fica em ~300 KB; em base64, ~400 KB. O teto
// generoso cobre aparelho sem OffscreenCanvas, que envia o original.
const LIMITE_CORPO = 6 * 1024 * 1024

export function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8')
    let bruto = ''
    let bytes = 0
    req.on('data', (pedaco) => {
      bytes += pedaco.length
      if (bytes > LIMITE_CORPO) { reject(erro.requisicao('Corpo grande demais.')); req.destroy(); return }
      bruto += decoder.write(pedaco)
    })
    req.on('end', () => {
      bruto += decoder.end()
      if (!bruto.trim()) return resolve({})
      try { resolve(JSON.parse(bruto)) }
      catch { reject(erro.requisicao('JSON invalido.')) }
    })
    req.on('error', reject)
  })
}

export function responder(res, status, dados) {
  const corpo = JSON.stringify(dados)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(corpo)
}

export function lerCookies(req) {
  const bruto = req.headers.cookie
  if (!bruto) return {}
  const saida = {}
  for (const parte of bruto.split(';')) {
    const i = parte.indexOf('=')
    if (i < 0) continue
    saida[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim())
  }
  return saida
}

export function ipDe(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || ''
}

// -------------------------------------------------------------- roteador

export function criarRoteador() {
  const rotas = []
  const registrar = (metodo) => (padrao, ...manipuladores) => {
    const nomes = []
    const regex = new RegExp('^' + padrao.replace(/:[a-zA-Z_]+/g, (m) => {
      nomes.push(m.slice(1))
      return '([^/]+)'
    }) + '$')
    rotas.push({ metodo, regex, nomes, manipuladores })
  }
  return {
    rotas,
    get: registrar('GET'),
    post: registrar('POST'),
    put: registrar('PUT'),
    patch: registrar('PATCH'),
    delete: registrar('DELETE'),
    resolver(metodo, caminho) {
      for (const rota of rotas) {
        if (rota.metodo !== metodo) continue
        const m = caminho.match(rota.regex)
        if (!m) continue
        const params = {}
        rota.nomes.forEach((nome, i) => { params[nome] = decodeURIComponent(m[i + 1]) })
        return { rota, params }
      }
      return null
    },
  }
}
