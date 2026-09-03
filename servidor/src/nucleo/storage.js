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

const TIPOS_ACEITOS = new Set(['image/jpeg', 'image/png', 'image/webp'])
const EXTENSAO = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

// Abaixo do teto do corpo JSON: base64 cresce ~33%.
export const LIMITE_BYTES = 4 * 1024 * 1024

export function tipoAceito(mime) {
  return TIPOS_ACEITOS.has(String(mime || '').toLowerCase())
}

// O caminho e' derivado, nunca recebido do cliente: id vindo do aparelho nao
// pode escolher onde o arquivo vai parar.
export function caminhoDe({ empresaId, veiculoId, inspecaoId, perguntaId, mime }) {
  const seguro = (v) => String(v || 'sem').replace(/[^A-Za-z0-9_-]/g, '')
  const nome = `${crypto.randomBytes(8).toString('hex')}.${EXTENSAO[mime] || 'bin'}`
  return path.join(
    seguro(empresaId), seguro(veiculoId), seguro(inspecaoId), seguro(perguntaId), nome)
}

export function gravar(caminhoRelativo, buffer) {
  const destino = path.join(config.storageCaminho, caminhoRelativo)
  const raiz = path.resolve(config.storageCaminho)
  if (!path.resolve(destino).startsWith(raiz)) {
    throw new Error('Caminho de evidencia fora do storage.')
  }
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  fs.writeFileSync(destino, buffer)
  return { bytes: buffer.length, hash: crypto.createHash('sha256').update(buffer).digest('hex') }
}

export function ler(caminhoRelativo) {
  const origem = path.join(config.storageCaminho, caminhoRelativo)
  const raiz = path.resolve(config.storageCaminho)
  if (!path.resolve(origem).startsWith(raiz)) return null
  try { return fs.readFileSync(origem) } catch { return null }
}

export function apagar(caminhoRelativo) {
  const alvo = path.join(config.storageCaminho, caminhoRelativo)
  const raiz = path.resolve(config.storageCaminho)
  if (!path.resolve(alvo).startsWith(raiz)) return
  try { fs.rmSync(alvo) } catch { /* ja removido */ }
}
