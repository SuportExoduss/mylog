// O envio ao vivo (roadmap 19, reescrito na D58).
//
// A fila offline saiu: o checklist sobe no momento em que e' finalizado, ou
// nao e' finalizado. O que NAO saiu com ela e' a regra que a fila existia para
// garantir — falhar nao pode perder o trabalho, e evidencia nenhuma some em
// silencio. Este arquivo cobra as duas.
import test from 'node:test'
import assert from 'node:assert/strict'

const envio = await import('../../app/js/envio.js')

// `blobParaBase64` usa FileReader, que o Node nao tem. Sem este falso, toda
// foto cairia no `catch` e viraria "ficou para tras" — outro caminho.
globalThis.FileReader = class {
  readAsDataURL() { setTimeout(() => this.onload?.(), 0) }
  get result() { return 'data:image/jpeg;base64,AAAA' }
}

const foto = (id, perguntaId = 'lataria') => ({
  id, pergunta_id: perguntaId, capturado_em: '2026-09-08T09:00:00.000Z',
  blob: { type: 'image/jpeg', size: 1024 },
})

const INSPECAO = {
  cliente_uuid: 'uuid-1', solicitacao_id: 'sol_1', template_id: 'tpl_1',
  momento: 'saida', km_informado: 41850, respostas: [], assinatura: null,
  iniciada_em: '2026-09-08T09:00:00.000Z', finalizada_em: '2026-09-08T09:10:00.000Z',
  fotos: [],
}

// Troca o `fetch` por um roteiro e devolve o que foi pedido.
function comRede(roteiro) {
  const pedidos = []
  globalThis.fetch = async (url, opcoes = {}) => {
    const caminho = String(url)
    pedidos.push({ caminho, corpo: JSON.parse(opcoes.body || '{}') })
    const r = roteiro(caminho, pedidos.length)
    if (r instanceof Error) throw r
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.corpo ?? {},
    }
  }
  return pedidos
}

const OK = { corpo: { inspecao: { id: 'ins_1' } } }

// ------------------------------------------------------------------ contrato

test('envio: a inspecao leva os campos que a rota le, e nada mais', async () => {
  const pedidos = comRede(() => OK)
  await envio.enviarInspecao({ ...INSPECAO, resumo: { irrelevante: true } })

  const corpo = pedidos[0].corpo
  assert.equal(corpo.cliente_uuid, 'uuid-1', 'o identificador nasce no aparelho')
  assert.equal(corpo.km_informado, 41850)
  assert.equal('resumo' in corpo, false,
    'o julgamento do aparelho NAO viaja: quem julga de verdade e o servidor')
  assert.equal('fotos' in corpo, false,
    'as fotos vao no endereco delas, uma a uma, depois da inspecao')
})

// ---------------------------------------------------------- falhar sem perder

test('envio: sem rede nada e gravado, e o motivo volta em vez de estourar', async () => {
  // A tela de quem chamou fica com a inspecao inteira na mao para tentar de
  // novo. Se `enviarInspecao` estourasse, quem chamou teria que adivinhar o
  // que sobrou — e o checklist de quarenta perguntas estaria no meio disso.
  comRede(() => new TypeError('Failed to fetch'))
  const r = await envio.enviarInspecao(INSPECAO)
  assert.equal(r.ok, false)
  assert.match(r.motivo, /Sem conexao/)
  assert.equal(r.sessao, undefined, 'nao e sessao vencida: e rede')
})

test('envio: sessao vencida se identifica, porque a saida dela e outra', async () => {
  // "Tentar de novo" com a credencial morta tenta para sempre. Quem sabe que
  // a sessao venceu manda entrar de novo — e ai o checklist sobe.
  comRede(() => ({ status: 401, corpo: {} }))
  const r = await envio.enviarInspecao(INSPECAO)
  assert.equal(r.ok, false)
  assert.equal(r.sessao, true)
})

test('envio: recusa do servidor chega com as palavras do servidor', async () => {
  comRede(() => ({ status: 422, corpo: { mensagem: 'Hodometro menor que a ultima leitura.' } }))
  const r = await envio.enviarInspecao(INSPECAO)
  assert.equal(r.ok, false)
  assert.equal(r.motivo, 'Hodometro menor que a ultima leitura.',
    'a pessoa precisa saber o que corrigir, nao que "falhou"')
})

// --------------------------------------------------------------------- fotos

test('envio: foto que falha por erro passageiro volta para tentar de novo', async () => {
  // 500 e' "tente de novo", nao "essa foto nao serve". Apagar aqui perderia a
  // evidencia sem que ninguem soubesse.
  comRede((caminho) => (caminho.includes('evidencias') ? { status: 500 } : OK))
  const r = await envio.enviarInspecao({ ...INSPECAO, fotos: [foto('f1'), foto('f2')] })

  assert.equal(r.ok, true, 'a inspecao esta gravada: a foto nao derruba o checklist')
  assert.equal(r.restantes.length, 2, 'as duas voltam na mao de quem chamou')
  assert.equal(r.recusadas.length, 0, 'e nenhuma foi recusada — sao coisas diferentes')
})

test('envio: foto recusada em definitivo nao some sem deixar recado', async () => {
  // Imagem acima do limite, arquivo que nao e' imagem: insistir nao muda o
  // resultado, e a foto nao volta para `restantes`. Mas ela NAO pode
  // simplesmente deixar de existir — uma evidencia que nao entrou e'
  // exatamente o que alguem vai procurar meses depois, num sinistro.
  comRede((caminho) => (caminho.includes('evidencias')
    ? { status: 413, corpo: { mensagem: 'A foto passa do tamanho aceito.' } }
    : OK))
  const r = await envio.enviarInspecao({ ...INSPECAO, fotos: [foto('f1', 'freios')] })

  assert.equal(r.ok, true)
  assert.equal(r.restantes.length, 0, 'insistir nao adianta, entao nao volta para tentar')
  assert.equal(r.recusadas.length, 1, 'mas volta com recado')
  assert.equal(r.recusadas[0].pergunta_id, 'freios', 'dizendo de qual pergunta era')
  assert.match(r.recusadas[0].motivo, /passa do tamanho/, 'e por que nao entrou')
})

test('envio: foto que sobe nao volta em nenhuma das duas contas', async () => {
  comRede(() => OK)
  const r = await envio.enviarInspecao({ ...INSPECAO, fotos: [foto('f1'), foto('f2')] })
  assert.deepEqual([r.restantes.length, r.recusadas.length], [0, 0])
})

test('envio: a foto vai pelo endereco da inspecao que o servidor devolveu', async () => {
  const pedidos = comRede(() => OK)
  await envio.enviarInspecao({ ...INSPECAO, fotos: [foto('f1')] })
  assert.equal(pedidos[1].caminho, '/api/inspecoes/ins_1/evidencias')
  assert.equal(pedidos[1].corpo.cliente_id, 'f1',
    'com o id do aparelho: e por ele que o servidor reconhece a segunda tentativa')
})

// -------------------------------------------------- passageiro x definitivo

test('envio: a fronteira entre "tente de novo" e "nao adianta" esta declarada', async () => {
  // Uma lista escrita a mao apodrece. Esta e' a regra em uma linha, e o teste
  // cobra os dois lados dela.
  for (const status of [401, 408, 425, 429, 500, 502, 503, 504]) {
    assert.equal(envio.recusaDefinitiva(status), false, `${status} e passageiro`)
  }
  for (const status of [400, 403, 404, 413, 415, 422]) {
    assert.equal(envio.recusaDefinitiva(status), true, `${status} nao melhora tentando`)
  }
})

// ------------------------------------------------------------------ contexto

test('contexto: sessao vencida se distingue de servidor fora do ar', async () => {
  // Sao duas telas diferentes: uma manda entrar de novo, a outra manda
  // procurar sinal. Confundir as duas faz a pessoa procurar rede que esta boa.
  comRede(() => ({ status: 401, corpo: {} }))
  assert.deepEqual(await envio.baixarContexto(), { erro: 'sessao' })

  comRede(() => ({ status: 503, corpo: {} }))
  await assert.rejects(() => envio.baixarContexto(), /falha/)

  comRede(() => new TypeError('Failed to fetch'))
  await assert.rejects(() => envio.baixarContexto())
})
