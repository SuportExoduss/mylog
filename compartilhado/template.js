// Motor de checklist do MyLog (roadmap 11).
//
// ESTE ARQUIVO E' UM SO, importado pelo servidor E servido ao navegador.
// Nao existe copia. Duas implementacoes divergiriam, e a divergencia apareceria
// da pior forma possivel: "aprovado no patio, reprovado no painel horas depois".
//
// Por isso, aqui dentro NAO PODE haver:
//   - import de node:*        (o navegador nao tem)
//   - acesso a banco ou rede  (o app roda offline)
//   - leitura de relogio      (o mesmo julgamento tem de dar o mesmo resultado
//                              no aparelho as 6h e no servidor as 14h)
//
// O modelo e' deliberadamente estreito: toda pergunta e' uma verificacao visual
// com dois desfechos, OK ou Ocorrencia. Nao ha tipo de resposta, nao ha item
// condicional. O que a v2.0 tinha de flexibilidade virou complexidade sem uso.

export const DESFECHOS = ['ok', 'ocorrencia']

export const MODOS_FOTO = ['obrigatorio', 'opcional', 'nao_capturar']

export const PRIORIDADES = ['baixa', 'media', 'alta', 'critica']

export const PESO_PRIORIDADE = { baixa: 1, media: 2, alta: 3, critica: 4 }

export const TIPOS_VEICULO = [
  'compacto_leve', 'pickup', 'quatro_x_quatro', 'motocicleta', 'caminhao',
]

export const MOMENTOS = ['saida', 'retorno']

// Para que serve o modelo (roadmap 14.2). O padrao julga conformidade — "esta
// OK?". A preventiva documenta servico — "o que foi feito aqui?". Sao duas
// perguntas diferentes, e por isso duas telas e dois julgamentos.
export const FINALIDADES = ['padrao', 'preventiva']

// Tamanho minimo do relatorio escrito. Cinco caracteres barram o "ok" e o
// "sim" que nao descrevem nada, sem exigir redacao de quem esta de pe na
// oficina.
export const MINIMO_RELATORIO = 5

export const PERIODICIDADES = ['avulso', 'diario', 'semanal', 'mensal']

// 0 = domingo, como getDay() do JavaScript. Manter a mesma base evita a
// conversao silenciosa que troca segunda por domingo em uma das pontas.
export const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']

// -------------------------------------------------------- periodicidade

// "HH:MM" em 24 horas. Aceita 00:00 e recusa 24:00.
const HORARIO = /^([01]\d|2[0-3]):([0-5]\d)$/

export function conferirPeriodicidade(modelo = {}) {
  const p = modelo.periodicidade || 'avulso'
  if (!PERIODICIDADES.includes(p)) {
    return { valido: false, mensagem: `Periodicidade desconhecida: ${p}.` }
  }

  const dias = modelo.dias_semana || []
  if (!Array.isArray(dias) || dias.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return { valido: false, mensagem: 'Dias da semana precisam ser numeros de 0 (domingo) a 6.' }
  }
  // Um checklist diario que nao vale em dia nenhum nunca seria cobrado: ou e'
  // avulso, ou alguem esqueceu de marcar os dias.
  if (p === 'diario' && dias.length === 0) {
    return { valido: false, mensagem: 'Marque ao menos um dia da semana, ou use periodicidade avulsa.' }
  }
  if (p !== 'diario' && dias.length > 0) {
    return { valido: false, mensagem: 'Dias da semana so valem para periodicidade diaria.' }
  }

  const diaSemana = modelo.dia_semana
  if (p === 'semanal') {
    if (!Number.isInteger(diaSemana) || diaSemana < 0 || diaSemana > 6) {
      return { valido: false, mensagem: 'Escolha em que dia da semana o checklist semanal vence.' }
    }
  } else if (diaSemana !== null && diaSemana !== undefined) {
    return { valido: false, mensagem: 'Dia de vencimento so vale para periodicidade semanal.' }
  }

  const limite = modelo.horario_limite
  if (limite !== null && limite !== undefined && limite !== '') {
    if (!HORARIO.test(String(limite))) {
      return { valido: false, mensagem: 'Horario limite precisa estar no formato HH:MM.' }
    }
    if (p === 'avulso') {
      return { valido: false, mensagem: 'Checklist avulso nao tem prazo: ninguem e cobrado por ele.' }
    }
  }

  return { valido: true }
}

// O modelo e' obrigatorio neste dia da semana? Recebe o NUMERO do dia (0 =
// domingo), ja resolvido por quem sabe qual e' o fuso da operacao.
//
// Recebia um `Date` antes. Parecia inofensivo, mas `data.getDay()` le o fuso do
// processo: o mesmo instante era sexta no servidor em Sao Paulo e sabado no
// servidor em UTC — e sabado nao cobra ninguem. O motor nao pode ter opiniao
// sobre onde ele esta rodando.
export function obrigatorioNoDia(modelo = {}, diaSemana) {
  const p = modelo.periodicidade || 'avulso'
  if (p === 'avulso') return false
  if (p === 'mensal' || p === 'semanal') return true   // a janela e' maior que o dia
  return (modelo.dias_semana || []).includes(diaSemana)
}

// Classifica uma execucao que ACONTECEU. A falta de execucao e' outro assunto:
// quem sabe que era esperado e nao veio e' quem tem a lista de quem devia
// fazer, e isso vive no servidor.
// Recebe MINUTOS desde a meia-noite da operacao, nao um `Date`: `getHours()`
// respondia conforme o fuso do processo, e um checklist das 07h50 em Sao Paulo
// virava 10h50 — atrasado — num servidor em UTC.
export function classificarExecucao(modelo = {}, minutosDoDia) {
  const limite = modelo.horario_limite
  if (!limite || !HORARIO.test(String(limite))) return 'no_prazo'
  if (!Number.isFinite(minutosDoDia)) return 'no_prazo'
  const [h, m] = String(limite).split(':').map(Number)
  return minutosDoDia <= h * 60 + m ? 'no_prazo' : 'atrasado'
}

export const ESTADOS_EXECUCAO = ['no_prazo', 'atrasado', 'nao_realizado']

// Tudo que pode impedir a finalizacao de um checklist. A lista vive aqui, ao
// lado de quem cria as pendencias, para que acrescentar um motivo novo sem
// dar-lhe uma frase seja um teste vermelho e nao uma tela muda no patio.
export const MOTIVOS_PENDENCIA = [
  'sem_resposta', 'foto_obrigatoria', 'fotos_acima_do_limite',
  'sem_opcao_nem_relatorio', 'assinatura_obrigatoria',
  'sem_resposta_manutencao', 'relatorio_obrigatorio', 'proxima_preventiva_obrigatoria',
]

const FRASE_PENDENCIA = {
  sem_resposta: (titulo) => `Falta responder: ${titulo}`,
  foto_obrigatoria: (titulo) => `Falta a foto: ${titulo}`,
  fotos_acima_do_limite: (titulo) => `Fotos demais em: ${titulo}`,
  sem_opcao_nem_relatorio: (titulo) => `Falta dizer o que houve: ${titulo}`,
  assinatura_obrigatoria: () => 'Falta assinar',
  sem_resposta_manutencao: (titulo) => `Falta dizer se houve manutencao: ${titulo}`,
  relatorio_obrigatorio: (titulo) => `Falta descrever o servico: ${titulo}`,
  proxima_preventiva_obrigatoria: () => 'Falta dizer quando vence a proxima',
}

// O que dizer ao motorista quando o botao de finalizar esta travado. Dizer
// sempre "falta responder" o manda procurar pergunta em branco quando o que
// falta e' uma foto ou a assinatura — e ele fica girando na tela.
export function descreverPendencia(pendencia) {
  if (!pendencia) return null
  const frase = FRASE_PENDENCIA[pendencia.motivo]
  return frase ? frase(pendencia.titulo) : `Pendencia em: ${pendencia.titulo}`
}

const IDENTIFICADOR = /^[a-z0-9_]{2,40}$/
const MAX_FOTOS_ABSOLUTO = 12

// ---------------------------------------------------------------- validacao

class ErroTemplate extends Error {}

function exigir(condicao, mensagem) {
  if (!condicao) throw new ErroTemplate(mensagem)
}

function validarOpcao(opcao, caminho, idsVistos) {
  exigir(opcao && typeof opcao === 'object', `${caminho}: opcao invalida.`)
  exigir(IDENTIFICADOR.test(opcao.id || ''),
    `${caminho}: id "${opcao.id}" invalido. Use letras minusculas, numeros e _.`)
  exigir(!idsVistos.has(opcao.id), `${caminho}: id de opcao "${opcao.id}" repetido na pergunta.`)
  idsVistos.add(opcao.id)

  exigir(typeof opcao.nome === 'string' && opcao.nome.trim().length >= 2,
    `${caminho}: informe o nome da opcao.`)
  exigir(MODOS_FOTO.includes(opcao.foto || 'opcional'),
    `${caminho}: modo de foto "${opcao.foto}" desconhecido.`)

  const max = opcao.max_fotos ?? 1
  exigir(Number.isInteger(max) && max >= 1 && max <= MAX_FOTOS_ABSOLUTO,
    `${caminho}: quantidade maxima de fotos deve ficar entre 1 e ${MAX_FOTOS_ABSOLUTO}.`)

  if (opcao.abrir_ocorrencia) {
    exigir(PRIORIDADES.includes(opcao.prioridade),
      `${caminho}: opcao abre ocorrencia e precisa de prioridade (${PRIORIDADES.join(', ')}).`)
  }
}

function validarPergunta(pergunta, caminho, idsVistos) {
  exigir(pergunta && typeof pergunta === 'object', `${caminho}: pergunta invalida.`)
  exigir(IDENTIFICADOR.test(pergunta.id || ''),
    `${caminho}: id "${pergunta.id}" invalido. Use letras minusculas, numeros e _.`)
  exigir(!idsVistos.has(pergunta.id), `${caminho}: id "${pergunta.id}" repetido no checklist.`)
  idsVistos.add(pergunta.id)

  exigir(typeof pergunta.titulo === 'string' && pergunta.titulo.trim().length >= 2,
    `${caminho}: informe o titulo da pergunta.`)
  exigir(MODOS_FOTO.includes(pergunta.foto_ok || 'opcional'),
    `${caminho}: modo de foto no OK "${pergunta.foto_ok}" desconhecido.`)

  const max = pergunta.max_fotos_ok ?? 1
  exigir(Number.isInteger(max) && max >= 1 && max <= MAX_FOTOS_ABSOLUTO,
    `${caminho}: quantidade maxima de fotos deve ficar entre 1 e ${MAX_FOTOS_ABSOLUTO}.`)

  // Sem opcoes de problema, responder "ocorrencia" deixaria o colaborador sem
  // nada para escolher — e ele teria de escrever tudo na mao toda vez.
  exigir(Array.isArray(pergunta.opcoes_problema) && pergunta.opcoes_problema.length >= 1,
    `${caminho} ("${pergunta.titulo}"): precisa de ao menos uma opcao de problema.`)

  const idsOpcoes = new Set()
  pergunta.opcoes_problema.forEach((o, i) => {
    validarOpcao(o, `${caminho}, opcao ${i + 1}`, idsOpcoes)
  })
}

export function validarEstrutura(estrutura) {
  exigir(estrutura && typeof estrutura === 'object', 'Estrutura do checklist invalida.')
  exigir(Array.isArray(estrutura.perguntas) && estrutura.perguntas.length > 0,
    'O checklist precisa de ao menos uma pergunta.')

  const ids = new Set()
  estrutura.perguntas.forEach((p, i) => validarPergunta(p, `Pergunta ${i + 1}`, ids))

  const comOcorrencia = estrutura.perguntas.reduce(
    (soma, p) => soma + p.opcoes_problema.filter((o) => o.abrir_ocorrencia).length, 0)

  return { perguntas: estrutura.perguntas.length, opcoes_que_abrem_ocorrencia: comOcorrencia }
}

// Devolve a mensagem em vez de lancar — util para a API e para o editor.
export function conferirEstrutura(estrutura) {
  try {
    return { valido: true, resumo: validarEstrutura(estrutura) }
  } catch (falha) {
    if (falha instanceof ErroTemplate) return { valido: false, mensagem: falha.message }
    throw falha
  }
}

// --------------------------------------------------------------- consultas

export function perguntaPorId(estrutura, perguntaId) {
  return estrutura.perguntas.find((p) => p.id === perguntaId) || null
}

export function opcaoPorId(pergunta, opcaoId) {
  return (pergunta?.opcoes_problema || []).find((o) => o.id === opcaoId) || null
}

// Um checklist so aparece para quem tem cargo liberado (roadmap 3).
// ["*"] libera para todos.
export function cargoLiberado(cargosLiberados, cargoId) {
  if (!Array.isArray(cargosLiberados) || cargosLiberados.length === 0) return false
  if (cargosLiberados.includes('*')) return true
  return cargosLiberados.includes(cargoId)
}

// ------------------------------------------------------- julgamento

// respostas: { [pergunta_id]: { desfecho, opcao_id?, relatorio?, fotos? } }
// "fotos" e' a QUANTIDADE de evidencias anexadas aquela resposta.
export function avaliarResposta(pergunta, resposta) {
  const problemas = []

  if (!resposta || !DESFECHOS.includes(resposta.desfecho)) {
    return { respondida: false, conforme: null, prioridade: null, problemas: ['sem_resposta'] }
  }

  const fotos = Number(resposta.fotos || 0)

  if (resposta.desfecho === 'ok') {
    const modo = pergunta.foto_ok || 'opcional'
    if (modo === 'obrigatorio' && fotos < 1) problemas.push('foto_obrigatoria')
    if (fotos > (pergunta.max_fotos_ok ?? 1)) problemas.push('fotos_acima_do_limite')
    return { respondida: true, conforme: true, prioridade: null, problemas }
  }

  // desfecho = ocorrencia
  const opcao = opcaoPorId(pergunta, resposta.opcao_id)
  const relatorio = String(resposta.relatorio || '').trim()

  // Ou escolheu uma opcao padrao, ou escreveu o relatorio. Sem um dos dois,
  // a ocorrencia chega ao painel dizendo apenas "algo errado".
  if (!opcao && relatorio.length < 5) {
    problemas.push('sem_opcao_nem_relatorio')
    return { respondida: true, conforme: false, prioridade: 'baixa', problemas }
  }

  if (opcao) {
    const modo = opcao.foto || 'opcional'
    if (modo === 'obrigatorio' && fotos < 1) problemas.push('foto_obrigatoria')
    if (fotos > (opcao.max_fotos ?? 1)) problemas.push('fotos_acima_do_limite')
  }

  return {
    respondida: true,
    conforme: false,
    abre_ocorrencia: Boolean(opcao?.abrir_ocorrencia),
    prioridade: opcao?.abrir_ocorrencia ? opcao.prioridade : null,
    descricao: opcao ? opcao.nome : relatorio,
    problemas,
  }
}

// Retorno de preventiva (roadmap 14.2.2). Aqui nao se julga conformidade: a
// pergunta e' "o que foi feito nesta peca?". Por isso nao ha OK nem
// Ocorrencia, e nenhuma resposta abre ocorrencia — o que sobrou de problema
// esta escrito no relatorio, e quem le e' a Frota.
export function avaliarManutencao(pergunta, resposta) {
  const problemas = []

  const feita = resposta?.manutencao_feita
  if (feita !== true && feita !== false) {
    return { respondida: false, manutencao: null, problemas: ['sem_resposta_manutencao'] }
  }

  const fotos = Number(resposta.fotos || 0)
  const modo = pergunta.foto_ok || 'opcional'
  if (modo === 'obrigatorio' && fotos < 1) problemas.push('foto_obrigatoria')
  if (fotos > (pergunta.max_fotos_ok ?? 1)) problemas.push('fotos_acima_do_limite')

  // Mexeu na peca e nao descreveu: o registro nao serve nem para a proxima
  // manutencao nem para uma discussao de garantia. Quando nao mexeu, o campo
  // continua disponivel, mas ninguem e' obrigado a escrever "nada a fazer".
  const relatorio = String(resposta.relatorio || '').trim()
  if (feita && relatorio.length < MINIMO_RELATORIO) problemas.push('relatorio_obrigatorio')

  return {
    respondida: true,
    manutencao: feita,
    relatorio: relatorio || null,
    problemas,
  }
}

// Alvo da proxima preventiva, perguntado na tela extra antes da assinatura
// (roadmap 14.2.3). Mesmas duas opcoes do cadastro: KM ou data.
export function conferirProximaPreventiva(proxima) {
  if (!proxima || !proxima.modo) return { valido: false, motivo: 'proxima_preventiva_obrigatoria' }

  if (proxima.modo === 'km') {
    const alvo = Math.trunc(Number(proxima.proximo_km))
    if (!Number.isFinite(alvo) || alvo <= 0) {
      return { valido: false, motivo: 'proxima_preventiva_obrigatoria' }
    }
    return { valido: true, modo: 'km', proximo_km: alvo, proxima_data: null }
  }

  if (proxima.modo === 'data') {
    const data = String(proxima.proxima_data || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      return { valido: false, motivo: 'proxima_preventiva_obrigatoria' }
    }
    return { valido: true, modo: 'data', proximo_km: null, proxima_data: data }
  }

  return { valido: false, motivo: 'proxima_preventiva_obrigatoria' }
}

// Retorno de preventiva: uma passagem inteira sobre o mesmo modelo, perguntando
// de cada peca o que foi feito nela. Nao abre ocorrencia e nao mexe no estado
// do veiculo — o carro acabou de sair da manutencao, e quem decide se ele volta
// a rodar e' a Frota, com o dossie na mao.
function avaliarRetornoPreventiva(estrutura, respostas, opcoes) {
  const pendencias = []
  const servicos = []
  let mexidas = 0

  for (const pergunta of estrutura.perguntas) {
    const juizo = avaliarManutencao(pergunta, respostas[pergunta.id])
    for (const problema of juizo.problemas) {
      pendencias.push({ pergunta_id: pergunta.id, titulo: pergunta.titulo, motivo: problema })
    }
    if (!juizo.respondida) continue
    if (juizo.manutencao) {
      mexidas += 1
      servicos.push({
        pergunta_id: pergunta.id, titulo: pergunta.titulo, relatorio: juizo.relatorio,
      })
    }
  }

  if (Boolean(opcoes.exige_assinatura) && !opcoes.assinatura) {
    pendencias.push({ pergunta_id: null, titulo: 'Assinatura', motivo: 'assinatura_obrigatoria' })
  }

  // Sem a proxima preventiva nao da para encerrar: a frota ficaria sem agenda
  // justamente depois de fazer a manutencao (roadmap 14.1).
  const proxima = conferirProximaPreventiva(opcoes.proxima_preventiva)
  if (!proxima.valido) {
    pendencias.push({ pergunta_id: null, titulo: 'Proxima preventiva', motivo: proxima.motivo })
  }

  return {
    finalidade: 'preventiva',
    momento: 'retorno',
    total_perguntas: estrutura.perguntas.length,
    conformes: estrutura.perguntas.length - pendencias.length,
    pendencias,
    ocorrencias: [],
    servicos,
    itens_com_manutencao: mexidas,
    maior_prioridade: null,
    pode_finalizar: pendencias.length === 0,
    resultado: 'aprovado',
    // A preventiva nao aperta nem afrouxa o estado do veiculo por conta
    // propria: liberar carro continua sendo decisao da Frota (D31).
    estado_veiculo_previsto: 'disponivel',
    motivo: mexidas
      ? `${mexidas} item(ns) com manutencao executada.`
      : 'Nenhum item exigiu manutencao.',
    proxima_preventiva: proxima.valido ? proxima : null,
  }
}

// Percorre o checklist inteiro e devolve o que a tela de encerramento precisa
// mostrar ANTES de finalizar (roadmap 11.7), sem gravar nada.
export function avaliarInspecao(estrutura, respostas = {}, opcoes = {}) {
  const politicas = opcoes.politicas || {}
  const exigeAssinatura = Boolean(opcoes.exige_assinatura)
  const temAssinatura = Boolean(opcoes.assinatura)

  // O retorno de uma preventiva nao julga conformidade: documenta servico
  // (roadmap 14.2.2). E' outro julgamento inteiro, com outras pendencias.
  if (opcoes.finalidade === 'preventiva' && opcoes.momento === 'retorno') {
    return avaliarRetornoPreventiva(estrutura, respostas, opcoes)
  }

  const pendencias = []
  const ocorrencias = []
  let conformes = 0

  for (const pergunta of estrutura.perguntas) {
    const juizo = avaliarResposta(pergunta, respostas[pergunta.id])

    if (!juizo.respondida) {
      pendencias.push({ pergunta_id: pergunta.id, titulo: pergunta.titulo, motivo: 'sem_resposta' })
      continue
    }
    for (const problema of juizo.problemas) {
      pendencias.push({ pergunta_id: pergunta.id, titulo: pergunta.titulo, motivo: problema })
    }
    if (juizo.conforme) { conformes += 1; continue }
    if (juizo.abre_ocorrencia) {
      ocorrencias.push({
        pergunta_id: pergunta.id,
        titulo: pergunta.titulo,
        descricao: juizo.descricao,
        prioridade: juizo.prioridade,
      })
    }
  }

  if (exigeAssinatura && !temAssinatura) {
    pendencias.push({ pergunta_id: null, titulo: 'Assinatura', motivo: 'assinatura_obrigatoria' })
  }

  const maiorPrioridade = ocorrencias.reduce(
    (maior, o) => (PESO_PRIORIDADE[o.prioridade] > PESO_PRIORIDADE[maior] ? o.prioridade : maior),
    'baixa')

  const temCritica = ocorrencias.some((o) => o.prioridade === 'critica')

  // A consequencia depende da politica da empresa, nunca de um "nao conforme"
  // solto. Um bloqueio precisa ser explicavel (roadmap 12.2).
  const bloqueiaPorCritica = politicas.bloqueio_por_critica !== false

  let resultado = 'aprovado'
  let estadoVeiculo = 'disponivel'
  let motivo = null

  if (ocorrencias.length > 0) {
    resultado = 'com_pendencia'
    // Prioridade baixa entra na fila mas nao tira o carro de circulacao
    // (roadmap 12.2). Se todo risco de pintura parasse um veiculo, a frota
    // inteira ficaria "com pendencia" e o status deixaria de significar algo.
    estadoVeiculo = maiorPrioridade === 'baixa' ? 'disponivel' : 'com_pendencia'
    motivo = `${ocorrencias.length} ocorrencia(s), maior prioridade: ${maiorPrioridade}.`
  }
  if (temCritica) {
    resultado = 'reprovado'
    if (bloqueiaPorCritica) {
      estadoVeiculo = 'bloqueado'
      motivo = 'Ocorrencia critica com bloqueio ativo na politica da empresa.'
    } else {
      estadoVeiculo = 'com_pendencia'
      motivo = 'Ocorrencia critica; a politica da empresa nao bloqueia automaticamente.'
    }
  }

  return {
    total_perguntas: estrutura.perguntas.length,
    conformes,
    pendencias,
    ocorrencias,
    maior_prioridade: ocorrencias.length ? maiorPrioridade : null,
    pode_finalizar: pendencias.length === 0,
    resultado,
    estado_veiculo_previsto: estadoVeiculo,
    motivo,
  }
}
