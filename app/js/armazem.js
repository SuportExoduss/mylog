// Armazenamento local do aplicativo de campo (secao 28).
//
// IndexedDB, nao localStorage: as fotos sao Blob, e localStorage so guarda
// texto — converter para base64 inflaria ~33% e estouraria a cota rapido.
//
// Tres depositos:
//   contexto  o que veio do servidor (veiculos, checklists, politicas)
//   fila      inspecoes finalizadas ainda nao confirmadas pelo servidor
//   fotos     evidencias, separadas da inspecao para o envio ser retomavel

const NOME_BANCO = 'mylog-campo'
const VERSAO = 1

let promessaBanco = null

function abrir() {
  if (promessaBanco) return promessaBanco
  promessaBanco = new Promise((resolve, reject) => {
    const pedido = indexedDB.open(NOME_BANCO, VERSAO)
    pedido.onupgradeneeded = () => {
      const db = pedido.result
      if (!db.objectStoreNames.contains('contexto')) db.createObjectStore('contexto')
      if (!db.objectStoreNames.contains('fila')) {
        const fila = db.createObjectStore('fila', { keyPath: 'cliente_uuid' })
        fila.createIndex('estado', 'estado')
      }
      if (!db.objectStoreNames.contains('fotos')) {
        const fotos = db.createObjectStore('fotos', { keyPath: 'id' })
        fotos.createIndex('cliente_uuid', 'cliente_uuid')
      }
    }
    pedido.onsuccess = () => resolve(pedido.result)
    pedido.onerror = () => reject(pedido.error)
  })
  return promessaBanco
}

function transacao(deposito, modo, fn) {
  return abrir().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(deposito, modo)
    const pedido = fn(tx.objectStore(deposito))
    tx.oncomplete = () => resolve(pedido?.result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  }))
}

// ------------------------------------------------------------- contexto

export const contexto = {
  guardar: (dados) => transacao('contexto', 'readwrite', (d) => d.put(dados, 'atual')),
  ler: () => transacao('contexto', 'readonly', (d) => d.get('atual')),
  limpar: () => transacao('contexto', 'readwrite', (d) => d.clear()),
}

// ----------------------------------------------------------------- fila

// Uma inspecao entra na fila no momento em que o motorista confirma, com ou
// sem rede. "estado" diz onde ela esta: pendente -> enviando -> enviada.
export const fila = {
  enfileirar: (inspecao) => transacao('fila', 'readwrite', (d) =>
    d.put({ ...inspecao, estado: 'pendente', tentativas: 0, criado_em: new Date().toISOString() })),

  todas: () => transacao('fila', 'readonly', (d) => d.getAll()),

  pendentes: async () => (await fila.todas()).filter((i) => i.estado !== 'enviada'),

  marcar: async (clienteUuid, mudancas) => {
    const db = await abrir()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('fila', 'readwrite')
      const deposito = tx.objectStore('fila')
      const leitura = deposito.get(clienteUuid)
      leitura.onsuccess = () => {
        if (!leitura.result) return
        deposito.put({ ...leitura.result, ...mudancas })
      }
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
  },

  remover: (clienteUuid) => transacao('fila', 'readwrite', (d) => d.delete(clienteUuid)),

  // Enviadas ficam alguns dias como comprovante para o motorista, depois somem.
  limparEnviadasAntigas: async (dias = 7) => {
    const limite = Date.now() - dias * 86400000
    for (const item of await fila.todas()) {
      if (item.estado === 'enviada' && new Date(item.criado_em).getTime() < limite) {
        await fila.remover(item.cliente_uuid)
      }
    }
  },
}

// ----------------------------------------------------------------- fotos

export const fotos = {
  guardar: (foto) => transacao('fotos', 'readwrite', (d) => d.put(foto)),
  ler: (id) => transacao('fotos', 'readonly', (d) => d.get(id)),
  daInspecao: (clienteUuid) => abrir().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('fotos', 'readonly')
    const pedido = tx.objectStore('fotos').index('cliente_uuid').getAll(clienteUuid)
    pedido.onsuccess = () => resolve(pedido.result)
    pedido.onerror = () => reject(pedido.error)
  })),
  remover: (id) => transacao('fotos', 'readwrite', (d) => d.delete(id)),
}

// ----------------------------------------------------------------- cota

// Fila de fotos e' o risco real do offline: se o navegador despejar o storage,
// a evidencia some. Pedimos persistencia e informamos quanto resta.
export async function garantirPersistencia() {
  const saida = { persistente: false, usadoMb: null, cotaMb: null }
  try {
    if (navigator.storage?.persist) saida.persistente = await navigator.storage.persist()
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate()
      saida.usadoMb = Math.round((e.usage || 0) / 1048576)
      saida.cotaMb = Math.round((e.quota || 0) / 1048576)
    }
  } catch { /* navegador sem a API: seguimos sem a garantia */ }
  return saida
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID()
  return 'ins-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}
