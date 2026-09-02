// Hash de senha com scrypt (node:crypto). Nunca guardar senha em texto puro.
import crypto from 'node:crypto'

const CUSTO = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const TAMANHO = 64

export function gerarHashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(senha, salt, TAMANHO, CUSTO).toString('hex')
  return { hash, salt }
}

export function conferirSenha(senha, hashGuardado, salt) {
  if (!hashGuardado || !salt) return false
  const calculado = crypto.scryptSync(senha, salt, TAMANHO, CUSTO)
  const guardado = Buffer.from(hashGuardado, 'hex')
  if (guardado.length !== calculado.length) return false
  return crypto.timingSafeEqual(calculado, guardado)
}

export function validarForcaSenha(senha) {
  if (typeof senha !== 'string' || senha.length < 8) {
    return 'A senha precisa ter ao menos 8 caracteres.'
  }
  if (!/[a-zA-Z]/.test(senha) || !/[0-9]/.test(senha)) {
    return 'A senha precisa conter letras e numeros.'
  }
  return null
}
