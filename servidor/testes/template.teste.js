// Motor de checklist (Roadmap v3.0, secao 11).
// Esta logica e' reexecutada offline pelo aplicativo, entao um erro aqui
// aparece no campo, sem rede e sem quem consertar.
import test from 'node:test'
import assert from 'node:assert/strict'

const {
  conferirEstrutura, avaliarResposta, avaliarInspecao,
  cargoLiberado, perguntaPorId, opcaoPorId,
  PRIORIDADES, MODOS_FOTO, MOMENTOS, TIPOS_VEICULO,
} = await import('../../compartilhado/template.js')

const ESTRUTURA = {
  perguntas: [
    {
      id: 'lateral_esquerda',
      titulo: 'Lateral esquerda',
      foto_ok: 'obrigatorio',
      max_fotos_ok: 4,
      opcoes_problema: [
        { id: 'risco', nome: 'Risco na pintura', foto: 'obrigatorio', max_fotos: 3, abrir_ocorrencia: true, prioridade: 'baixa' },
        { id: 'amassado', nome: 'Lataria amassada', foto: 'obrigatorio', max_fotos: 3, abrir_ocorrencia: true, prioridade: 'media' },
      ],
    },
    {
      id: 'pneus',
      titulo: 'Pneus e rodagem',
      foto_ok: 'opcional',
      max_fotos_ok: 2,
      opcoes_problema: [
        { id: 'liso', nome: 'Pneu liso', foto: 'obrigatorio', max_fotos: 4, abrir_ocorrencia: true, prioridade: 'critica' },
        { id: 'calibragem', nome: 'Precisa calibrar', foto: 'nao_capturar', max_fotos: 1, abrir_ocorrencia: false },
      ],
    },
    {
      id: 'freios',
      titulo: 'Freio de servico',
      foto_ok: 'nao_capturar',
      max_fotos_ok: 1,
      opcoes_problema: [
        { id: 'folga', nome: 'Folga no pedal', foto: 'opcional', max_fotos: 2, abrir_ocorrencia: true, prioridade: 'alta' },
      ],
    },
  ],
}

const secEstrutura = (perguntas) => ({ perguntas })

// ------------------------------------------------------------- validacao

test('estrutura valida passa e devolve o tamanho', () => {
  const r = conferirEstrutura(ESTRUTURA)
  assert.equal(r.valido, true)
  assert.deepEqual(r.resumo, { perguntas: 3, opcoes_que_abrem_ocorrencia: 4 })
})

test('checklist sem pergunta nao publica', () => {
  assert.equal(conferirEstrutura({ perguntas: [] }).valido, false)
  assert.equal(conferirEstrutura({}).valido, false)
  assert.equal(conferirEstrutura(null).valido, false)
})

test('pergunta sem opcao de problema nao publica', () => {
  // Sem opcoes, responder "ocorrencia" deixaria o colaborador sem nada para
  // escolher, e ele teria de escrever tudo na mao toda vez.
  const r = conferirEstrutura(secEstrutura([
    { id: 'lataria', titulo: 'Lataria', foto_ok: 'opcional', max_fotos_ok: 1, opcoes_problema: [] },
  ]))
  assert.equal(r.valido, false)
  assert.match(r.mensagem, /ao menos uma opcao de problema/)
})

test('id de pergunta repetido e recusado', () => {
  const r = conferirEstrutura(secEstrutura([
    { id: 'lataria', titulo: 'Uma', foto_ok: 'opcional', max_fotos_ok: 1,
      opcoes_problema: [{ id: 'x1', nome: 'Problema', foto: 'opcional', max_fotos: 1 }] },
    { id: 'lataria', titulo: 'Outra', foto_ok: 'opcional', max_fotos_ok: 1,
      opcoes_problema: [{ id: 'x1', nome: 'Problema', foto: 'opcional', max_fotos: 1 }] },
  ]))
  assert.equal(r.valido, false)
  assert.match(r.mensagem, /repetido/)
})

test('id de opcao repetido dentro da mesma pergunta e recusado', () => {
  const r = conferirEstrutura(secEstrutura([
    { id: 'lataria', titulo: 'Lataria', foto_ok: 'opcional', max_fotos_ok: 1,
      opcoes_problema: [
        { id: 'risco', nome: 'Risco', foto: 'opcional', max_fotos: 1 },
        { id: 'risco', nome: 'Risco de novo', foto: 'opcional', max_fotos: 1 },
      ] },
  ]))
  assert.equal(r.valido, false)
  assert.match(r.mensagem, /opcao "risco" repetido/)
})

test('opcao que abre ocorrencia precisa de prioridade', () => {
  const r = conferirEstrutura(secEstrutura([
    { id: 'lataria', titulo: 'Lataria', foto_ok: 'opcional', max_fotos_ok: 1,
      opcoes_problema: [{ id: 'risco', nome: 'Risco', foto: 'opcional', max_fotos: 1, abrir_ocorrencia: true }] },
  ]))
  assert.equal(r.valido, false)
  assert.match(r.mensagem, /prioridade/)
})

test('prioridade inventada e recusada', () => {
  const r = conferirEstrutura(secEstrutura([
    { id: 'lataria', titulo: 'Lataria', foto_ok: 'opcional', max_fotos_ok: 1,
      opcoes_problema: [{ id: 'risco', nome: 'Risco', foto: 'opcional', max_fotos: 1,
        abrir_ocorrencia: true, prioridade: 'urgentissima' }] },
  ]))
  assert.equal(r.valido, false)
})

test('modo de foto desconhecido e recusado', () => {
  const r = conferirEstrutura(secEstrutura([
    { id: 'lataria', titulo: 'Lataria', foto_ok: 'talvez', max_fotos_ok: 1,
      opcoes_problema: [{ id: 'risco', nome: 'Risco', foto: 'opcional', max_fotos: 1 }] },
  ]))
  assert.equal(r.valido, false)
})

test('limite de fotos fora da faixa e recusado', () => {
  const fora = (max) => conferirEstrutura(secEstrutura([
    { id: 'lataria', titulo: 'Lataria', foto_ok: 'opcional', max_fotos_ok: max,
      opcoes_problema: [{ id: 'risco', nome: 'Risco', foto: 'opcional', max_fotos: 1 }] },
  ]))
  assert.equal(fora(0).valido, false)
  assert.equal(fora(99).valido, false)
  assert.equal(fora(1.5).valido, false)
  assert.equal(fora(4).valido, true)
})

test('as enumeracoes sao as do roadmap v3.0', () => {
  assert.deepEqual(PRIORIDADES, ['baixa', 'media', 'alta', 'critica'])
  assert.deepEqual(MODOS_FOTO, ['obrigatorio', 'opcional', 'nao_capturar'])
  assert.deepEqual(MOMENTOS, ['saida', 'retorno'])
  assert.equal(TIPOS_VEICULO.length, 5)
})

// ---------------------------------------------------------------- consulta

test('cargo liberado: "*" libera todos; lista libera so quem esta nela', () => {
  assert.equal(cargoLiberado(['*'], 'cgo_1'), true)
  assert.equal(cargoLiberado(['cgo_1', 'cgo_2'], 'cgo_2'), true)
  assert.equal(cargoLiberado(['cgo_1'], 'cgo_9'), false)
  // Lista vazia nao libera ninguem — o checklist simplesmente nao aparece.
  assert.equal(cargoLiberado([], 'cgo_1'), false)
  assert.equal(cargoLiberado(null, 'cgo_1'), false)
  assert.equal(cargoLiberado(['cgo_1'], null), false)
})

test('busca de pergunta e de opcao', () => {
  assert.equal(perguntaPorId(ESTRUTURA, 'pneus').titulo, 'Pneus e rodagem')
  assert.equal(perguntaPorId(ESTRUTURA, 'inexistente'), null)
  assert.equal(opcaoPorId(perguntaPorId(ESTRUTURA, 'pneus'), 'liso').prioridade, 'critica')
  assert.equal(opcaoPorId(perguntaPorId(ESTRUTURA, 'pneus'), 'inventada'), null)
})

// ------------------------------------------------------------ conformidade

const pergunta = (id) => perguntaPorId(ESTRUTURA, id)

test('OK com foto obrigatoria exige ao menos uma foto', () => {
  assert.deepEqual(avaliarResposta(pergunta('lateral_esquerda'), { desfecho: 'ok', fotos: 1 }).problemas, [])
  assert.deepEqual(avaliarResposta(pergunta('lateral_esquerda'), { desfecho: 'ok', fotos: 0 }).problemas,
    ['foto_obrigatoria'])
})

test('OK acima do limite de fotos e apontado', () => {
  assert.deepEqual(avaliarResposta(pergunta('pneus'), { desfecho: 'ok', fotos: 5 }).problemas,
    ['fotos_acima_do_limite'])
})

test('OK em pergunta que nao captura foto passa sem foto', () => {
  const r = avaliarResposta(pergunta('freios'), { desfecho: 'ok' })
  assert.equal(r.conforme, true)
  assert.deepEqual(r.problemas, [])
})

test('ocorrencia com opcao carrega prioridade e descricao da opcao', () => {
  const r = avaliarResposta(pergunta('pneus'), { desfecho: 'ocorrencia', opcao_id: 'liso', fotos: 1 })
  assert.equal(r.conforme, false)
  assert.equal(r.abre_ocorrencia, true)
  assert.equal(r.prioridade, 'critica')
  assert.equal(r.descricao, 'Pneu liso')
})

test('opcao marcada para nao abrir ocorrencia so registra', () => {
  const r = avaliarResposta(pergunta('pneus'), { desfecho: 'ocorrencia', opcao_id: 'calibragem' })
  assert.equal(r.conforme, false)
  assert.equal(r.abre_ocorrencia, false)
  assert.equal(r.prioridade, null)
})

test('ocorrencia sem opcao e sem relatorio e apontada', () => {
  // Senao a ocorrencia chega ao painel dizendo apenas "algo errado".
  const r = avaliarResposta(pergunta('pneus'), { desfecho: 'ocorrencia' })
  assert.deepEqual(r.problemas, ['sem_opcao_nem_relatorio'])
})

test('ocorrencia com relatorio escrito dispensa a opcao', () => {
  const r = avaliarResposta(pergunta('pneus'),
    { desfecho: 'ocorrencia', relatorio: 'Parafuso da roda faltando, nao ha opcao para isso.' })
  assert.deepEqual(r.problemas, [])
  assert.equal(r.abre_ocorrencia, false)
  assert.match(r.descricao, /Parafuso/)
})

test('resposta ausente ou com desfecho invalido conta como nao respondida', () => {
  assert.equal(avaliarResposta(pergunta('freios'), undefined).respondida, false)
  assert.equal(avaliarResposta(pergunta('freios'), { desfecho: 'talvez' }).respondida, false)
})

// ---------------------------------------------------------------- inspecao

const TUDO_OK = {
  lateral_esquerda: { desfecho: 'ok', fotos: 1 },
  pneus: { desfecho: 'ok' },
  freios: { desfecho: 'ok' },
}

test('inspecao: tudo conforme aprova e mantem o veiculo disponivel', () => {
  const r = avaliarInspecao(ESTRUTURA, TUDO_OK, {})
  assert.equal(r.resultado, 'aprovado')
  assert.equal(r.estado_veiculo_previsto, 'disponivel')
  assert.equal(r.pode_finalizar, true)
  assert.equal(r.conformes, 3)
})

test('inspecao: pergunta nao respondida trava a finalizacao', () => {
  const r = avaliarInspecao(ESTRUTURA, { lateral_esquerda: { desfecho: 'ok', fotos: 1 } }, {})
  assert.equal(r.pode_finalizar, false)
  assert.deepEqual(r.pendencias.map((p) => p.pergunta_id), ['pneus', 'freios'])
})

test('inspecao: prioridade critica bloqueia o veiculo', () => {
  const r = avaliarInspecao(ESTRUTURA,
    { ...TUDO_OK, pneus: { desfecho: 'ocorrencia', opcao_id: 'liso', fotos: 1 } }, {})
  assert.equal(r.resultado, 'reprovado')
  assert.equal(r.estado_veiculo_previsto, 'bloqueado')
  assert.match(r.motivo, /politica/)
})

test('inspecao: a mesma falha critica nao bloqueia se a politica nao mandar', () => {
  // Roadmap 12.2: um "nao conforme" nao bloqueia sozinho; a consequencia
  // depende da politica, e o bloqueio precisa ser explicavel.
  const r = avaliarInspecao(ESTRUTURA,
    { ...TUDO_OK, pneus: { desfecho: 'ocorrencia', opcao_id: 'liso', fotos: 1 } },
    { politicas: { bloqueio_por_critica: false } })
  assert.equal(r.resultado, 'reprovado')
  assert.equal(r.estado_veiculo_previsto, 'com_pendencia')
})

test('inspecao: ocorrencia nao critica deixa com pendencia', () => {
  const r = avaliarInspecao(ESTRUTURA,
    { ...TUDO_OK, freios: { desfecho: 'ocorrencia', opcao_id: 'folga' } }, {})
  assert.equal(r.resultado, 'com_pendencia')
  assert.equal(r.estado_veiculo_previsto, 'com_pendencia')
  assert.equal(r.maior_prioridade, 'alta')
})

test('inspecao: foto obrigatoria pendente impede finalizar', () => {
  const r = avaliarInspecao(ESTRUTURA,
    { ...TUDO_OK, pneus: { desfecho: 'ocorrencia', opcao_id: 'liso', fotos: 0 } }, {})
  assert.equal(r.pode_finalizar, false)
  assert.ok(r.pendencias.some((p) => p.motivo === 'foto_obrigatoria'))
})

test('inspecao: assinatura exigida e ausente impede finalizar', () => {
  const sem = avaliarInspecao(ESTRUTURA, TUDO_OK, { exige_assinatura: true })
  assert.equal(sem.pode_finalizar, false)
  assert.ok(sem.pendencias.some((p) => p.motivo === 'assinatura_obrigatoria'))

  const com = avaliarInspecao(ESTRUTURA, TUDO_OK, { exige_assinatura: true, assinatura: 'x' })
  assert.equal(com.pode_finalizar, true)
})

test('inspecao: opcao que nao abre ocorrencia nao gera item na fila', () => {
  const r = avaliarInspecao(ESTRUTURA,
    { ...TUDO_OK, pneus: { desfecho: 'ocorrencia', opcao_id: 'calibragem' } }, {})
  assert.equal(r.ocorrencias.length, 0)
  assert.equal(r.resultado, 'aprovado')
  assert.equal(r.pode_finalizar, true)
})

test('inspecao: a maior prioridade manda no resumo', () => {
  const r = avaliarInspecao(ESTRUTURA, {
    lateral_esquerda: { desfecho: 'ocorrencia', opcao_id: 'risco', fotos: 1 },
    pneus: { desfecho: 'ocorrencia', opcao_id: 'liso', fotos: 1 },
    freios: { desfecho: 'ocorrencia', opcao_id: 'folga' },
  }, {})
  assert.equal(r.ocorrencias.length, 3)
  assert.equal(r.maior_prioridade, 'critica')
  assert.equal(r.estado_veiculo_previsto, 'bloqueado')
})

test('inspecao: o julgamento nao depende do relogio', () => {
  // Se dependesse, o mesmo checklist daria resultado diferente no patio as 6h
  // e no servidor as 14h.
  const a = avaliarInspecao(ESTRUTURA, TUDO_OK, {})
  const b = avaliarInspecao(ESTRUTURA, TUDO_OK, {})
  assert.deepEqual(a, b)
})
