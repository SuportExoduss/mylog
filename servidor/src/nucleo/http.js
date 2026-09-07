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
  // 429 e nao 400: o pedido esta correto, o que sobra e' a frequencia. O
  // cliente precisa distinguir "voce errou a senha" de "pare de tentar".
  excedeu: (m) => new ErroHttp(429, 'muitas_tentativas', m),
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
      let dados
      try { dados = JSON.parse(bruto) }
      catch { return reject(erro.requisicao('JSON invalido.')) }
      try { conferirChaves(dados) } catch (falha) { return reject(falha) }
      resolve(dados)
    })
    req.on('error', reject)
  })
}

// Politica de conteudo. Estrita de proposito: o painel e o aplicativo carregam
// so os proprios arquivos.
//
//   script-src 'self'  — nenhum script inline roda. Por isso o trecho que
//     aplica o tema antes da primeira pintura virou /js/tema-inicial.js: a
//     alternativa era declarar o hash dele aqui, e ai qualquer edicao naquele
//     arquivo apagaria o tema em silencio.
//   style-src inclui 'unsafe-inline' porque a interface usa atributo `style` em
//     elementos montados em JS, e os relatorios de impressao levam a folha
//     inteira embutida — sao um documento so, salvo e enviado por email.
//     Injecao de estilo e' um risco muito menor que injecao de script, e nao
//     ha caminho aqui em que o texto do usuario vire CSS.
//   img-src aceita blob: e data: por causa da previa da foto no aparelho, que
//     e' criada com URL.createObjectURL antes de qualquer envio.
//   frame-ancestors 'none' — nada de embutir o painel em pagina de terceiro.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

// Aplicados uma vez por requisicao, antes de qualquer despacho, para valerem
// tambem no arquivo estatico e nas rotas que escrevem binario elas mesmas.
export function aplicarSeguranca(res, { producao, https }) {
  res.setHeader('content-security-policy', CSP)
  res.setHeader('x-content-type-options', 'nosniff')
  // frame-ancestors ja cobre; o cabecalho antigo fica para navegador velho.
  res.setHeader('x-frame-options', 'DENY')
  // O caminho do relatorio carrega placa e nome; nao vaza nem para o proprio
  // site em outra origem.
  res.setHeader('referrer-policy', 'same-origin')
  res.setHeader('cross-origin-opener-policy', 'same-origin')
  // A camera e a localizacao SAO usadas — pelo aplicativo de campo, na propria
  // origem. Tudo o mais fica desligado.
  res.setHeader('permissions-policy',
    'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()')

  // HSTS so faz sentido quando ja se chegou por HTTPS: mandado em texto claro,
  // ele nao protege nada e ainda trava o desenvolvimento em localhost.
  if (producao && https) {
    res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains')
  }
}

// Tres nomes de campo que nao podem entrar pelo corpo.
//
// `toString` e `valueOf` quebram a COERCAO: `String({ toString: null })` levanta
// TypeError, e o servidor coage texto em uns sessenta lugares. Um JSON com esse
// campo virava 500 — resposta sem codigo, sem frase, e um rastro de excecao no
// log. Achado por varredura de campo envenenado.
//
// `__proto__` e' outra coisa: nao quebra nada sozinho, mas e' o vetor classico
// de poluicao de prototipo quando o corpo e' espalhado ou mesclado adiante.
//
// Recusar e' melhor que limpar: nenhum campo legitimo desta API tem esses
// nomes, e uma requisicao que os traz esta enganada ou tentando alguma coisa.
// Os ids de pergunta, que sao livres, nascem minusculos do gerador de slug —
// nao colidem com `toString` nem `valueOf`.
const CHAVES_PROIBIDAS = new Set(['__proto__', 'toString', 'valueOf'])
const PROFUNDIDADE_MAXIMA = 12

function conferirChaves(valor, profundidade = 0) {
  if (!valor || typeof valor !== 'object') return
  if (profundidade > PROFUNDIDADE_MAXIMA) {
    throw erro.requisicao('Corpo aninhado demais.')
  }
  if (Array.isArray(valor)) {
    for (const item of valor) conferirChaves(item, profundidade + 1)
    return
  }
  for (const chave of Object.keys(valor)) {
    if (CHAVES_PROIBIDAS.has(chave)) {
      throw erro.requisicao(`Campo "${chave}" nao e aceito.`)
    }
    conferirChaves(valor[chave], profundidade + 1)
  }
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
    // Escapa os metacaracteres do proprio caminho ANTES de trocar os :params.
    // Sem isso o ponto de "/api/execucoes.csv" casaria com qualquer caractere,
    // e "/api/execucoesXcsv" cairia na mesma rota.
    const corpo = padrao
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/:[a-zA-Z_]+/g, (m) => {
        nomes.push(m.slice(1))
        return '([^/]+)'
      })
    rotas.push({ metodo, regex: new RegExp(`^${corpo}$`), nomes, manipuladores })
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
