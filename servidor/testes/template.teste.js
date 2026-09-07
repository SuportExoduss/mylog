// Motor de checklist (Roadmap v3.0, secao 11).
// Esta logica e' reexecutada offline pelo aplicativo, entao um erro aqui
// aparece no campo, sem rede e sem quem consertar.
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'

const {
  conferirEstrutura, avaliarResposta, avaliarInspecao,
  cargoLiberado, perguntaPorId, opcaoPorId, descreverPendencia,
  conferirPeriodicidade, obrigatorioNoDia, classificarExecucao, PERIODICIDADES,
  avaliarManutencao, conferirProximaPreventiva, FINALIDADES,
  PRIORIDADES, MODOS_FOTO, MOMENTOS, TIPOS_VEICULO, MOTIVOS_PENDENCIA, DIAS_SEMANA,
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

test('inspecao: prioridade baixa entra na fila mas nao para o veiculo', () => {
  // Roadmap 12.2: baixa entra na fila e o veiculo segue disponivel. Se um
  // risco de pintura tirasse o carro de circulacao, em um mes a frota inteira
  // estaria "com pendencia" e ninguem olharia mais para o status.
  const r = avaliarInspecao(ESTRUTURA,
    { ...TUDO_OK, lateral_esquerda: { desfecho: 'ocorrencia', opcao_id: 'risco', fotos: 1 } }, {})
  assert.equal(r.ocorrencias.length, 1)
  assert.equal(r.maior_prioridade, 'baixa')
  assert.equal(r.resultado, 'com_pendencia')
  assert.equal(r.estado_veiculo_previsto, 'disponivel')
})

test('inspecao: baixa junto de media segue a mais grave', () => {
  const r = avaliarInspecao(ESTRUTURA, {
    ...TUDO_OK,
    lateral_esquerda: { desfecho: 'ocorrencia', opcao_id: 'amassado', fotos: 1 },
  }, {})
  assert.equal(r.maior_prioridade, 'media')
  assert.equal(r.estado_veiculo_previsto, 'com_pendencia')
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
  // Se dependesse, o mesmo checklist daria resultado diferente no patio as 6h e
  // no servidor as 14h — e o motor e' a UNICA fonte do julgamento, importada
  // pelo servidor e servida ao navegador.
  //
  // A versao anterior deste teste chamava a mesma funcao pura duas vezes
  // seguidas e comparava. Isso nao prova nada: as duas chamadas caem no mesmo
  // milissegundo, entao ela passaria intacta mesmo se o motor lesse o relogio.
  //
  // Agora o relogio ANDA entre as duas chamadas — oito horas, uma virada de dia
  // e uma de ano.
  mock.timers.enable({ apis: ['Date'] })
  try {
    mock.timers.setTime(Date.UTC(2026, 8, 3, 6, 0, 0))
    const deManha = avaliarInspecao(ESTRUTURA, TUDO_OK, {})

    mock.timers.setTime(Date.UTC(2026, 8, 3, 14, 0, 0))
    const aTarde = avaliarInspecao(ESTRUTURA, TUDO_OK, {})

    mock.timers.setTime(Date.UTC(2027, 0, 1, 23, 59, 59))
    const noAnoSeguinte = avaliarInspecao(ESTRUTURA, TUDO_OK, {})

    assert.deepEqual(aTarde, deManha, 'oito horas depois, o mesmo checklist')
    assert.deepEqual(noAnoSeguinte, deManha, 'no ano seguinte, o mesmo checklist')
  } finally {
    mock.timers.reset()
  }
})

// -------------------------------------------------- frases de pendencia

test('todo motivo de pendencia tem frase propria', () => {
  // Se alguem acrescentar um motivo no motor e esquecer a frase, o motorista
  // ve "Pendencia em: X" e nao sabe o que fazer. Este teste fica vermelho antes.
  for (const motivo of MOTIVOS_PENDENCIA) {
    const frase = descreverPendencia({ motivo, titulo: 'Lataria' })
    assert.ok(frase, `motivo sem frase: ${motivo}`)
    assert.ok(!frase.startsWith('Pendencia em:'), `motivo caiu no generico: ${motivo}`)
  }
})

test('a frase diz o que falta, nao apenas que falta', () => {
  assert.equal(descreverPendencia({ motivo: 'foto_obrigatoria', titulo: 'Pneus' }),
    'Falta a foto: Pneus')
  assert.equal(descreverPendencia({ motivo: 'assinatura_obrigatoria', titulo: 'Assinatura' }),
    'Falta assinar')
  assert.equal(descreverPendencia(null), null)
})

test('motivo desconhecido nao quebra a tela', () => {
  assert.equal(descreverPendencia({ motivo: 'inventado', titulo: 'Freios' }),
    'Pendencia em: Freios')
})

test('todo motivo que o motor produz esta declarado em MOTIVOS_PENDENCIA', () => {
  // Percorre casos reais e confere que nenhum motivo escapa da lista.
  const casos = [
    avaliarInspecao(ESTRUTURA, {}, {}),
    avaliarInspecao(ESTRUTURA, TUDO_OK, { exige_assinatura: true }),
    avaliarInspecao(ESTRUTURA,
      { ...TUDO_OK, pneus: { desfecho: 'ocorrencia', opcao_id: 'liso', fotos: 0 } }, {}),
    avaliarInspecao(ESTRUTURA,
      { ...TUDO_OK, pneus: { desfecho: 'ocorrencia', fotos: 1 } }, {}),
    avaliarInspecao(ESTRUTURA,
      { ...TUDO_OK, pneus: { desfecho: 'ocorrencia', opcao_id: 'liso', fotos: 9 } }, {}),
  ]
  const vistos = new Set(casos.flatMap((c) => c.pendencias.map((p) => p.motivo)))
  assert.ok(vistos.size >= 4, `poucos motivos exercitados: ${[...vistos]}`)
  for (const motivo of vistos) {
    assert.ok(MOTIVOS_PENDENCIA.includes(motivo), `motivo fora da lista: ${motivo}`)
  }
})

// ------------------------------------------------------ ritmo do modelo

test('ritmo: as periodicidades sao as quatro do roadmap', () => {
  assert.deepEqual(PERIODICIDADES, ['avulso', 'diario', 'semanal', 'mensal'])
})

test('ritmo: diario precisa de ao menos um dia da semana', () => {
  // Um diario que nao vale em dia nenhum nunca seria cobrado. Ou e' avulso,
  // ou alguem esqueceu de marcar os dias — e o silencio esconderia isso.
  assert.equal(conferirPeriodicidade({ periodicidade: 'diario', dias_semana: [] }).valido, false)
  assert.equal(conferirPeriodicidade({ periodicidade: 'diario', dias_semana: [1, 5] }).valido, true)
})

test('ritmo: dias da semana so valem para diario', () => {
  const r = conferirPeriodicidade({ periodicidade: 'mensal', dias_semana: [1] })
  assert.equal(r.valido, false)
  assert.match(r.mensagem, /so valem para periodicidade diaria/)
})

test('ritmo: semanal precisa dizer em que dia vence', () => {
  assert.equal(conferirPeriodicidade({ periodicidade: 'semanal' }).valido, false)
  assert.equal(conferirPeriodicidade({ periodicidade: 'semanal', dia_semana: 3 }).valido, true)
  assert.equal(conferirPeriodicidade({ periodicidade: 'semanal', dia_semana: 9 }).valido, false)
})

test('ritmo: horario limite precisa ser HH:MM de 24 horas', () => {
  const com = (h) => conferirPeriodicidade({
    periodicidade: 'diario', dias_semana: [1], horario_limite: h,
  })
  assert.equal(com('08:30').valido, true)
  assert.equal(com('00:00').valido, true)
  assert.equal(com('23:59').valido, true)
  assert.equal(com('24:00').valido, false)
  assert.equal(com('8:30').valido, false)
  assert.equal(com('meio-dia').valido, false)
})

test('ritmo: checklist avulso nao pode ter prazo', () => {
  // Prazo so faz sentido para quem e' cobrado. Avulso ninguem cobra.
  const r = conferirPeriodicidade({ periodicidade: 'avulso', horario_limite: '08:00' })
  assert.equal(r.valido, false)
  assert.match(r.mensagem, /nao tem prazo/)
})

test('ritmo: dia util obrigatorio nao alcanca o fim de semana', () => {
  // O relatorio real do PROLOG (roadmap 24.1) tem 62 execucoes no sabado e 13
  // no domingo, contra ~170 nos dias uteis. Cobrar fim de semana criaria ~90
  // faltas falsas por mes.
  //
  // O motor recebe o NUMERO do dia. Recebia um `Date` antes, e `getDay()` lia o
  // fuso do processo: o mesmo instante era sexta em Sao Paulo e sabado em UTC.
  const diaUtil = { periodicidade: 'diario', dias_semana: [1, 2, 3, 4, 5] }
  const SEXTA = 5, SABADO = 6, DOMINGO = 0
  assert.equal(obrigatorioNoDia(diaUtil, SEXTA), true)
  assert.equal(obrigatorioNoDia(diaUtil, SABADO), false)
  assert.equal(obrigatorioNoDia(diaUtil, DOMINGO), false)
})

test('ritmo: semanal vence no dia configurado, e mensal nao entra na cobranca diaria', () => {
  // Este teste afirmava o contrario ate agora: que semanal e mensal valiam
  // "o periodo todo", devolvendo true em qualquer dia. Ele codificava o defeito.
  //
  // Quem chama `obrigatorioNoDia` e' a cobranca, e ela pergunta POR DIA. Com
  // true todo dia, quem so e cobrado as quartas aparecia como faltante nos
  // outros seis dias — toda semana, para sempre.
  const DOM = 0, QUA = 3, QUI = 4

  assert.equal(obrigatorioNoDia({ periodicidade: 'avulso' }, DOM), false)

  // O dia de vencimento e' campo OBRIGATORIO do semanal (conferirPeriodicidade),
  // estava preenchido e validado, e o motor nao lia.
  const semanal = { periodicidade: 'semanal', dia_semana: QUA }
  assert.equal(obrigatorioNoDia(semanal, QUA), true, 'na quarta, cobra')
  assert.equal(obrigatorioNoDia(semanal, QUI), false, 'na quinta, nao cobra')
  assert.equal(obrigatorioNoDia(semanal, DOM), false, 'no domingo, nao cobra')

  // Mensal nao tem onde vencer: o esquema so tem `dia_semana`, e
  // `conferirPeriodicidade` o recusa fora do semanal. Sem ancora, todo dia
  // seria "o dia" — vinte e nove faltas falsas por mes. Nao cobrar e' errado;
  // cobrar todo dia e' pior. Roadmap 39 registra a decisao em aberto.
  for (const dia of [DOM, QUA, QUI]) {
    assert.equal(obrigatorioNoDia({ periodicidade: 'mensal' }, dia), false)
  }
})

test('ritmo: o horario limite classifica, nao impede', () => {
  const modelo = { horario_limite: '08:30' }
  // Minutos desde a meia-noite da operacao — nao um `Date`, que traria junto o
  // fuso de quem o construiu.
  const hm = (h, m) => h * 60 + m
  assert.equal(classificarExecucao(modelo, hm(7, 12)), 'no_prazo')
  assert.equal(classificarExecucao(modelo, hm(8, 30)), 'no_prazo')
  assert.equal(classificarExecucao(modelo, hm(8, 31)), 'atrasado')
  assert.equal(classificarExecucao(modelo, hm(17, 0)), 'atrasado')
})

test('ritmo: sem horario limite, nada e atrasado', () => {
  assert.equal(classificarExecucao({}, 23 * 60 + 59), 'no_prazo')
  assert.equal(classificarExecucao({ horario_limite: null }, 600), 'no_prazo')
  // Data ilegivel nao pode virar "atrasado" por acidente.
  assert.equal(classificarExecucao({ horario_limite: '08:00' }, 'nao e numero'), 'no_prazo')
  assert.equal(classificarExecucao({ horario_limite: '08:00' }, NaN), 'no_prazo')
})

// -------------------------------------------- checklist de preventiva

const PREVENTIVA = { finalidade: 'preventiva', momento: 'retorno' }
const PROXIMA_OK = { modo: 'km', proximo_km: 120000 }

test('preventiva: as finalidades sao duas — padrao e preventiva', () => {
  assert.deepEqual(FINALIDADES, ['padrao', 'preventiva'])
})

test('preventiva: o retorno pergunta se houve manutencao, nao se esta OK', () => {
  // Roadmap 14.2.2: no retorno nao ha OK nem Ocorrencia. A pergunta e' outra —
  // "o que foi feito nesta peca?" — e por isso o julgamento e' outro.
  const semResposta = avaliarManutencao(ESTRUTURA.perguntas[0], { desfecho: 'ok', fotos: 1 })
  assert.equal(semResposta.respondida, false)
  assert.deepEqual(semResposta.problemas, ['sem_resposta_manutencao'])

  const naoMexeu = avaliarManutencao(ESTRUTURA.perguntas[0], { manutencao_feita: false, fotos: 1 })
  assert.equal(naoMexeu.respondida, true)
  assert.equal(naoMexeu.manutencao, false)
  assert.deepEqual(naoMexeu.problemas, [])
})

test('preventiva: mexeu na peca e nao descreveu nao passa', () => {
  // Mexer numa peca sem dizer o que foi feito produz registro que nao serve
  // nem para a proxima manutencao nem para uma discussao de garantia.
  const semTexto = avaliarManutencao(ESTRUTURA.perguntas[0], { manutencao_feita: true, fotos: 1 })
  assert.ok(semTexto.problemas.includes('relatorio_obrigatorio'))

  const curto = avaliarManutencao(ESTRUTURA.perguntas[0],
    { manutencao_feita: true, fotos: 1, relatorio: 'ok' })
  assert.ok(curto.problemas.includes('relatorio_obrigatorio'),
    '"ok" nao descreve servico nenhum')

  const bom = avaliarManutencao(ESTRUTURA.perguntas[0],
    { manutencao_feita: true, fotos: 1, relatorio: 'Pastilha e disco trocados.' })
  assert.deepEqual(bom.problemas, [])
  assert.equal(bom.relatorio, 'Pastilha e disco trocados.')
})

test('preventiva: nao mexeu, o relatorio segue opcional', () => {
  // Ninguem deveria ser obrigado a escrever "nada a fazer" treze vezes.
  const r = avaliarManutencao(ESTRUTURA.perguntas[0], { manutencao_feita: false, fotos: 1 })
  assert.deepEqual(r.problemas, [])
  assert.equal(r.relatorio, null)
})

test('preventiva: a foto obrigatoria continua obrigatoria no retorno', () => {
  const r = avaliarManutencao(ESTRUTURA.perguntas[0],
    { manutencao_feita: false, fotos: 0 })
  assert.ok(r.problemas.includes('foto_obrigatoria'),
    'lateral_esquerda tem foto_ok obrigatorio')
})

test('preventiva: o retorno nao abre ocorrencia nem mexe no estado do veiculo', () => {
  // O carro acabou de sair da manutencao. Quem decide se ele volta a rodar e'
  // a Frota, com o dossie na mao — nao o proprio checklist (D31).
  const r = avaliarInspecao(ESTRUTURA, {
    lateral_esquerda: { manutencao_feita: true, fotos: 1, relatorio: 'Lataria martelada.' },
    pneus: { manutencao_feita: true, fotos: 1, relatorio: 'Dois pneus trocados.' },
    freios: { manutencao_feita: false },
  }, { ...PREVENTIVA, proxima_preventiva: PROXIMA_OK })

  assert.equal(r.pode_finalizar, true)
  assert.deepEqual(r.ocorrencias, [])
  assert.equal(r.estado_veiculo_previsto, 'disponivel')
  assert.equal(r.itens_com_manutencao, 2)
  assert.equal(r.servicos.length, 2)
  assert.match(r.motivo, /2 item\(ns\) com manutencao/)
})

test('preventiva: sem dizer quando vence a proxima, nao encerra', () => {
  // Concluir sem agendar deixaria a frota sem agenda justamente depois de
  // fazer a manutencao (roadmap 14.1).
  const respostas = {
    lateral_esquerda: { manutencao_feita: false, fotos: 1 },
    pneus: { manutencao_feita: false, fotos: 1 },
    freios: { manutencao_feita: false },
  }
  const sem = avaliarInspecao(ESTRUTURA, respostas, PREVENTIVA)
  assert.equal(sem.pode_finalizar, false)
  assert.ok(sem.pendencias.some((p) => p.motivo === 'proxima_preventiva_obrigatoria'))

  const com = avaliarInspecao(ESTRUTURA, respostas,
    { ...PREVENTIVA, proxima_preventiva: PROXIMA_OK })
  assert.equal(com.pode_finalizar, true)
})

test('preventiva: a proxima aceita KM ou data, e recusa o resto', () => {
  assert.equal(conferirProximaPreventiva({ modo: 'km', proximo_km: 90000 }).valido, true)
  assert.equal(conferirProximaPreventiva({ modo: 'data', proxima_data: '2027-03-15' }).valido, true)

  assert.equal(conferirProximaPreventiva(null).valido, false)
  assert.equal(conferirProximaPreventiva({ modo: 'km' }).valido, false)
  assert.equal(conferirProximaPreventiva({ modo: 'km', proximo_km: 0 }).valido, false)
  assert.equal(conferirProximaPreventiva({ modo: 'data', proxima_data: '15/03/2027' }).valido, false)
  assert.equal(conferirProximaPreventiva({ modo: 'chute' }).valido, false)
})

test('preventiva: a SAIDA continua sendo o checklist convencional', () => {
  // Roadmap 14.2: a saida registra o estado da peca ANTES do servico, e para
  // isso serve o julgamento de sempre — inclusive abrir ocorrencia.
  const r = avaliarInspecao(ESTRUTURA, {
    ...TUDO_OK,
    freios: { desfecho: 'ocorrencia', opcao_id: 'folga' },
  }, { finalidade: 'preventiva', momento: 'saida' })

  assert.equal(r.ocorrencias.length, 1)
  assert.equal(r.maior_prioridade, 'alta')
  assert.equal(r.estado_veiculo_previsto, 'com_pendencia')
})

test('preventiva: todo motivo novo de pendencia tem frase propria', () => {
  for (const motivo of ['sem_resposta_manutencao', 'relatorio_obrigatorio',
    'proxima_preventiva_obrigatoria']) {
    const frase = descreverPendencia({ motivo, titulo: 'Pinca de freio' })
    assert.ok(frase && !frase.startsWith('Pendencia em:'), `motivo sem frase: ${motivo}`)
  }
})

test('ritmo: DIAS_SEMANA e indexado pelo numero do dia, e a tela depende disso', () => {
  // A tela de modelos escrevia esta lista a mao. Passou a ler daqui — entao a
  // ORDEM virou contrato: trocar um nome de lugar faria o checklist aparecer
  // no dia errado, na tela e no servidor, sem erro nenhum.
  assert.deepEqual(DIAS_SEMANA, ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'])
  assert.equal(DIAS_SEMANA.length, 7)

  // Mesma base do getDay() do JavaScript: 0 e' domingo.
  const domingo = new Date(Date.UTC(2026, 8, 6))   // 06/09/2026
  assert.equal(DIAS_SEMANA[domingo.getUTCDay()], 'dom')
  const quinta = new Date(Date.UTC(2026, 8, 3))
  assert.equal(DIAS_SEMANA[quinta.getUTCDay()], 'qui')
})
