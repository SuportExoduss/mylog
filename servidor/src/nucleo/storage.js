// Armazenamento de evidencias (roadmap 13).
//
// A imagem NUNCA entra em tabela do banco. O banco guarda o vinculo e os
// metadados; o arquivo vive fora, num caminho que ja carrega a hierarquia do
// dominio — o que torna a migracao para S3/R2 uma troca de implementacao
// destas quatro funcoes, e nada mais.
//
//   empresa/veiculo/inspecao/pergunta/arquivo.jpg
//
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from './config.js'

const EXTENSAO = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

// Quem decide o tipo do arquivo sao os BYTES, nao o cliente.
//
// O `tipo_mime` chegava do aparelho e virava verdade: ia para o nome no disco,
// para a coluna do banco e para o `content-type` da resposta. Evidencia de
// checklist e' prova em acidente e em processo trabalhista — um arquivo que nao
// e' imagem nenhuma nao pode entrar no acervo so porque o remetente disse que
// era. O PWA ate ajuda a errar sem ma fe: quando o blob sai sem tipo, ele manda
// 'image/jpeg' por padrao.
//
// Doze bytes bastam para os tres formatos aceitos.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const ASSINATURAS = [
  { mime: 'image/jpeg', casa: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', casa: (b) => b.subarray(0, 8).equals(PNG) },
  { mime: 'image/webp',
    casa: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF'
              && b.subarray(8, 12).toString('latin1') === 'WEBP' },
]

// O tipo que o conteudo realmente e', ou null se nao for imagem aceita.
//
// O byte vence a declaracao em vez de contradize-la em erro: uma foto de
// verdade rotulada errado e' defeito de cliente, nao ataque, e recusa-la
// perderia a evidencia que o motorista ja tirou. O que nao passa e' o que nao
// e' imagem.
export function tipoRealDe(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null
  return ASSINATURAS.find((a) => a.casa(buffer))?.mime ?? null
}

// Abaixo do teto do corpo JSON: base64 cresce ~33%.
export const LIMITE_BYTES = 4 * 1024 * 1024



// O caminho e' derivado, nunca recebido do cliente: id vindo do aparelho nao
// pode escolher onde o arquivo vai parar.
export function caminhoDe({ empresaId, veiculoId, inspecaoId, perguntaId, mime }) {
  const seguro = (v) => String(v || 'sem').replace(/[^A-Za-z0-9_-]/g, '')
  const nome = `${crypto.randomBytes(8).toString('hex')}.${EXTENSAO[mime] || 'bin'}`
  return path.join(
    seguro(empresaId), seguro(veiculoId), seguro(inspecaoId), seguro(perguntaId), nome)
}

// Imagem de exemplo de uma pergunta de checklist (roadmap 11.3). Vive no mesmo
// storage, em ramo proprio: nao pertence a veiculo nem a inspecao nenhuma —
// pertence ao MODELO, e sobrevive a todas as execucoes dele.
//
//   empresa/modelos/template/arquivo.jpg
//
export function caminhoDeImagemModelo({ empresaId, templateId, mime }) {
  const seguro = (v) => String(v || 'sem').replace(/[^A-Za-z0-9_-]/g, '')
  const nome = `${crypto.randomBytes(8).toString('hex')}.${EXTENSAO[mime] || 'bin'}`
  return path.join(seguro(empresaId), 'modelos', seguro(templateId), nome)
}

// Logo da empresa (roadmap 7). Ramo proprio, fora de veiculo e de modelo:
// pertence a EMPRESA e sobrevive a tudo que ela cadastrar.
//
//   empresa/marca/arquivo.png
//
// Nome sorteado, e nao fixo: trocar a logo grava um arquivo NOVO e so depois
// aponta o banco para ele. Um nome fixo obrigaria a sobrescrever — e um
// upload que falha no meio deixaria a empresa sem logo valida, que e'
// exatamente o que a arquitetura proibe.
export function caminhoDeLogo({ empresaId, mime }) {
  const seguro = (v) => String(v || 'sem').replace(/[^A-Za-z0-9_-]/g, '')
  const nome = `${crypto.randomBytes(8).toString('hex')}.${EXTENSAO[mime] || 'bin'}`
  return path.join(seguro(empresaId), 'marca', nome)
}

// Dentro do storage — e "dentro" com a barra, nao so com o prefixo.
//
// A conferencia era `resolve(alvo).startsWith(raiz)`. Com a raiz em
// `/dados/storage`, um caminho em `/dados/storage-antigo` PASSA: o texto comeca
// igual e a barra nunca e' cobrada. Hoje nada chega aqui capaz de explorar isso
// — todo segmento de caminho e' higienizado em `caminhoDe` e o nome do arquivo
// da imagem de modelo passa por uma expressao regular. Mas esta funcao e' a
// ULTIMA camada, e a razao de existir de uma ultima camada e' segurar quando a
// de cima falhar. Uma guarda que so funciona por acidente nao e' guarda.
function dentroDoStorage(caminhoRelativo) {
  const raiz = path.resolve(config.storageCaminho)
  const alvo = path.resolve(path.join(config.storageCaminho, caminhoRelativo))
  return alvo === raiz || alvo.startsWith(raiz + path.sep)
}

export function gravar(caminhoRelativo, buffer) {
  if (!dentroDoStorage(caminhoRelativo)) {
    throw new Error('Caminho de evidencia fora do storage.')
  }
  const destino = path.join(config.storageCaminho, caminhoRelativo)
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  fs.writeFileSync(destino, buffer)
  return { bytes: buffer.length, hash: crypto.createHash('sha256').update(buffer).digest('hex') }
}

export function ler(caminhoRelativo) {
  if (!dentroDoStorage(caminhoRelativo)) return null
  try { return fs.readFileSync(path.join(config.storageCaminho, caminhoRelativo)) } catch { return null }
}

export function apagar(caminhoRelativo) {
  if (!dentroDoStorage(caminhoRelativo)) return
  try { fs.rmSync(path.join(config.storageCaminho, caminhoRelativo)) } catch { /* ja removido */ }
}

// Apaga um RAMO inteiro do acervo. Existe por um caso so, e um caso real:
// descartar um rascunho de checklist apagava a linha do banco e deixava as
// fotos de exemplo no disco para sempre. Ninguem nunca as apagaria — elas nao
// aparecem em lista nenhuma, e o modelo que as citava deixou de existir.
//
// So para o que NAO e' evidencia. Foto de checklist nao se apaga: e' prova em
// acidente e em processo trabalhista, e some junto com a empresa, nao antes.
export function apagarRamo(caminhoRelativo) {
  if (!dentroDoStorage(caminhoRelativo)) return
  const raiz = path.resolve(config.storageCaminho)
  const alvo = path.resolve(path.join(config.storageCaminho, caminhoRelativo))
  if (alvo === raiz) return          // nunca a raiz inteira
  try { fs.rmSync(alvo, { recursive: true, force: true }) } catch { /* ja removido */ }
}
