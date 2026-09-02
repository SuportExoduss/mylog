// Camada de dados. Todo acesso ao banco passa por aqui.
// A API publica (consultar/consultarUm/executar/transacao) e' propositalmente
// pequena para que a troca de SQLite por PostgreSQL toque so este arquivo.
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const CAMINHO_ESQUEMA = path.join(aqui, '..', 'dados', 'esquema.sql')

let db = null

export function abrirBanco() {
  if (db) return db
  fs.mkdirSync(path.dirname(config.bancoCaminho), { recursive: true })
  db = new DatabaseSync(config.bancoCaminho)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(fs.readFileSync(CAMINHO_ESQUEMA, 'utf8'))
  return db
}

export function fecharBanco() {
  if (db) { db.close(); db = null }
}

export function consultar(sql, params = []) {
  return abrirBanco().prepare(sql).all(...params)
}

export function consultarUm(sql, params = []) {
  const linha = abrirBanco().prepare(sql).get(...params)
  return linha === undefined ? null : linha
}

export function executar(sql, params = []) {
  return abrirBanco().prepare(sql).run(...params)
}

export function transacao(fn) {
  const banco = abrirBanco()
  banco.exec('BEGIN')
  try {
    const r = fn()
    banco.exec('COMMIT')
    return r
  } catch (erro) {
    banco.exec('ROLLBACK')
    throw erro
  }
}

// ------------------------------------------------------------------ apoio

export function agora() {
  return new Date().toISOString()
}

const PREFIXOS = {
  empresa: 'emp', usuario: 'usr', sessao: 'ses', veiculo: 'vei', vinculo: 'vin',
  template: 'tpl', inspecao: 'ins', resposta: 'res', evidencia: 'evi',
  nao_conformidade: 'ncf', ticket: 'tkt', preventiva: 'prv', evento: 'evt',
}

export function novoId(entidade) {
  const prefixo = PREFIXOS[entidade] || 'gen'
  return `${prefixo}_${crypto.randomBytes(8).toString('hex')}`
}
