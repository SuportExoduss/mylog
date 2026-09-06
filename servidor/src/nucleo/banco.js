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

// BEGIN IMMEDIATE, nao BEGIN.
//
// O `BEGIN` simples do SQLite e' adiado: a trava de escrita so e' tomada na
// primeira gravacao. Numa transacao que LE, decide e entao grava — que e' a
// forma de toda decisao critica daqui (aprovar reserva, liberar veiculo,
// encerrar ocorrencia) — dois processos podem ler o mesmo estado, os dois
// concluirem que podem gravar, e o segundo so descobrir o problema na hora de
// subir a trava. `IMMEDIATE` toma a trava na abertura e serializa de verdade.
//
// Hoje isso nao muda nada: o Node e' de uma linha so e o SQLite aqui e'
// sincrono, entao nenhum outro pedido corre no meio. Muda no dia em que houver
// mais de um processo — cluster, ou as Cloud Functions do destino aprovado.
// A garantia existe hoje por acidente de arquitetura; aqui ela passa a estar
// escrita.
export function transacao(fn) {
  const banco = abrirBanco()
  banco.exec('BEGIN IMMEDIATE')
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
  empresa: 'emp', usuario: 'usr', cargo: 'cgo', sessao: 'ses', veiculo: 'vei',
  template: 'tpl', inspecao: 'ins', resposta: 'res', evidencia: 'evi',
  ocorrencia: 'oco', solicitacao: 'sol', preventiva: 'prv', evento: 'evt',
}

export function novoId(entidade) {
  const prefixo = PREFIXOS[entidade] || 'gen'
  return `${prefixo}_${crypto.randomBytes(8).toString('hex')}`
}
