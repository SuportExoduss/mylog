// Motor de checklist configuravel (secoes 11, 12 e 13 do roadmap).
//
// Um template e' dado, nao codigo: a estrutura vive em JSON e este modulo
// sabe (a) validar essa estrutura, (b) decidir se um item deve aparecer dada
// as respostas ja dadas e (c) julgar se uma resposta e' conforme.
//
// Tudo aqui e' funcao pura. O Android vai executar a mesma logica offline,
// entao ela nao pode depender de banco, relogio ou rede.

export const TIPOS_ITEM = [
  'ok_nok', 'sim_nao', 'numero', 'selecao', 'texto', 'foto', 'assinatura', 'datahora',
]

// Tipos que produzem juizo de conformidade. Os demais so registram.
const TIPOS_AVALIAVEIS = new Set(['ok_nok', 'sim_nao', 'numero', 'selecao'])

export const CRITICIDADES = ['informativo', 'baixo', 'medio', 'alto', 'critico']

export const PESO_CRITICIDADE = {
  informativo: 0, baixo: 1, medio: 2, alto: 3, critico: 4,
}

export const OPERADORES = ['igual', 'diferente', 'nao_conforme', 'conforme', 'maior', 'menor', 'preenchido']

const IDENTIFICADOR = /^[a-z0-9_]{2,40}$/

// ------------------------------------------------------------- validacao

class ErroTemplate extends Error {}

function exigir(condicao, mensagem) {
  if (!condicao) throw new ErroTemplate(mensagem)
}

function validarItem(item, caminho, idsAnteriores) {
  exigir(item && typeof item === 'object', `${caminho}: item invalido.`)
  exigir(IDENTIFICADOR.test(item.id || ''),
    `${caminho}: id "${item.id}" invalido. Use letras minusculas, numeros e _.`)
  exigir(!idsAnteriores.has(item.id), `${caminho}: id "${item.id}" repetido no template.`)
  exigir(typeof item.rotulo === 'string' && item.rotulo.trim().length >= 2,
    `${caminho}: informe a pergunta do item.`)
  exigir(TIPOS_ITEM.includes(item.tipo), `${caminho}: tipo "${item.tipo}" desconhecido.`)

  if (item.criticidade !== undefined) {
    exigir(CRITICIDADES.includes(item.criticidade),
      `${caminho}: criticidade "${item.criticidade}" desconhecida.`)
  }

  if (item.tipo === 'numero') {
    const { minimo, maximo } = item
    exigir(minimo === undefined || minimo === null || Number.isFinite(Number(minimo)),
      `${caminho}: minimo precisa ser numero.`)
    exigir(maximo === undefined || maximo === null || Number.isFinite(Number(maximo)),
      `${caminho}: maximo precisa ser numero.`)
    if (minimo != null && maximo != null) {
      exigir(Number(minimo) <= Number(maximo), `${caminho}: minimo maior que o maximo.`)
    }
  }

  if (item.tipo === 'selecao') {
    exigir(Array.isArray(item.opcoes) && item.opcoes.length >= 2,
      `${caminho}: item de selecao precisa de ao menos duas opcoes.`)
    const vistos = new Set()
    for (const opcao of item.opcoes) {
      exigir(typeof opcao.valor === 'string' && opcao.valor.trim(),
        `${caminho}: opcao sem valor.`)
      exigir(!vistos.has(opcao.valor), `${caminho}: opcao "${opcao.valor}" repetida.`)
      vistos.add(opcao.valor)
      if (opcao.criticidade !== undefined) {
        exigir(CRITICIDADES.includes(opcao.criticidade),
          `${caminho}: criticidade da opcao "${opcao.valor}" desconhecida.`)
      }
    }
  }

  if (item.tipo === 'sim_nao') {
    exigir(item.valor_conforme === undefined || ['sim', 'nao'].includes(item.valor_conforme),
      `${caminho}: valor_conforme precisa ser "sim" ou "nao".`)
  }

  if (item.condicao) {
    const c = item.condicao
    exigir(typeof c.item_id === 'string', `${caminho}: condicao sem item_id.`)
    exigir(OPERADORES.includes(c.operador), `${caminho}: operador "${c.operador}" desconhecido.`)
    // A condicao so pode olhar para tras: evita dependencia circular e permite
    // avaliar a visibilidade na ordem em que o usuario responde.
    exigir(idsAnteriores.has(c.item_id),
      `${caminho}: a condicao aponta para "${c.item_id}", que nao aparece antes deste item.`)
  }

  idsAnteriores.add(item.id)
}

export function validarEstrutura(estrutura) {
  exigir(estrutura && typeof estrutura === 'object', 'Estrutura do template invalida.')
  exigir(Array.isArray(estrutura.secoes) && estrutura.secoes.length > 0,
    'O template precisa de ao menos uma secao.')

  const idsItens = new Set()
  const idsSecoes = new Set()
  let totalItens = 0

  estrutura.secoes.forEach((secao, i) => {
    const caminho = `Secao ${i + 1}`
    exigir(IDENTIFICADOR.test(secao.id || ''), `${caminho}: id "${secao.id}" invalido.`)
    exigir(!idsSecoes.has(secao.id), `${caminho}: id de secao repetido.`)
    idsSecoes.add(secao.id)
    exigir(typeof secao.titulo === 'string' && secao.titulo.trim().length >= 2,
      `${caminho}: informe o titulo da secao.`)
    exigir(Array.isArray(secao.itens) && secao.itens.length > 0,
      `${caminho} ("${secao.titulo}"): sem nenhum item.`)

    secao.itens.forEach((item, j) => {
      validarItem(item, `${caminho}, item ${j + 1}`, idsItens)
      totalItens += 1
    })
  })

  return { secoes: estrutura.secoes.length, itens: totalItens }
}

// Devolve a mensagem de erro em vez de lancar — util para a API e para a tela.
export function conferirEstrutura(estrutura) {
  try {
    return { valido: true, resumo: validarEstrutura(estrutura) }
  } catch (falha) {
    if (falha instanceof ErroTemplate) return { valido: false, mensagem: falha.message }
    throw falha
  }
}

// ------------------------------------------------------------ conformidade

// respostas: { [item_id]: { valor, conforme? } }
export function avaliarResposta(item, valorBruto) {
  if (!TIPOS_AVALIAVEIS.has(item.tipo)) {
    return { conforme: null, criticidade: null }
  }

  const criticidadePadrao = item.criticidade || 'baixo'

  if (item.tipo === 'ok_nok') {
    const conforme = valorBruto === 'ok'
    return { conforme, criticidade: conforme ? null : criticidadePadrao }
  }

  if (item.tipo === 'sim_nao') {
    const esperado = item.valor_conforme || 'sim'
    const conforme = valorBruto === esperado
    return { conforme, criticidade: conforme ? null : criticidadePadrao }
  }

  if (item.tipo === 'numero') {
    const numero = Number(valorBruto)
    if (!Number.isFinite(numero)) return { conforme: false, criticidade: criticidadePadrao }
    const abaixo = item.minimo != null && numero < Number(item.minimo)
    const acima = item.maximo != null && numero > Number(item.maximo)
    const conforme = !abaixo && !acima
    return { conforme, criticidade: conforme ? null : criticidadePadrao }
  }

  // selecao: a opcao escolhida carrega a propria conformidade e criticidade.
  const opcao = (item.opcoes || []).find((o) => o.valor === valorBruto)
  if (!opcao) return { conforme: false, criticidade: criticidadePadrao }
  const conforme = opcao.conforme !== false
  return { conforme, criticidade: conforme ? null : (opcao.criticidade || criticidadePadrao) }
}

// ------------------------------------------------------- checklist adaptativo

// Um item aparece quando nao tem condicao, ou quando a condicao bate contra
// uma resposta ja dada. Se o item de referencia ainda nao foi respondido, o
// item condicional fica escondido (secao 12).
export function itemVisivel(item, respostas) {
  if (!item.condicao) return true
  const { item_id, operador, valor } = item.condicao
  const resposta = respostas[item_id]
  if (resposta === undefined || resposta === null) return false

  const bruto = typeof resposta === 'object' ? resposta.valor : resposta
  const conforme = typeof resposta === 'object' ? resposta.conforme : undefined

  switch (operador) {
    case 'igual': return bruto === valor
    case 'diferente': return bruto !== valor
    case 'conforme': return conforme === true
    case 'nao_conforme': return conforme === false
    case 'maior': return Number(bruto) > Number(valor)
    case 'menor': return Number(bruto) < Number(valor)
    case 'preenchido': return bruto !== '' && bruto !== null && bruto !== undefined
    default: return true
  }
}

// Achata o template na lista de itens que valem para estas respostas.
export function itensAplicaveis(estrutura, respostas = {}) {
  const saida = []
  for (const secao of estrutura.secoes) {
    for (const item of secao.itens) {
      if (itemVisivel(item, respostas)) saida.push({ ...item, secao_id: secao.id, secao_titulo: secao.titulo })
    }
  }
  return saida
}

// --------------------------------------------------------- resumo da inspecao

// Percorre template + respostas e devolve o que a tela de resumo do Android
// precisa mostrar ANTES de finalizar (secao 27), sem gravar nada.
export function resumirInspecao(estrutura, respostas = {}, politicas = {}) {
  const aplicaveis = itensAplicaveis(estrutura, respostas)

  const pendencias = []
  const naoConformidades = []
  const fotosPendentes = []
  let conformes = 0

  for (const item of aplicaveis) {
    const resposta = respostas[item.id]
    const bruto = resposta && typeof resposta === 'object' ? resposta.valor : resposta
    const respondido = bruto !== undefined && bruto !== null && bruto !== ''

    if (!respondido) {
      if (item.obrigatorio !== false) pendencias.push({ item_id: item.id, rotulo: item.rotulo })
      continue
    }

    const juizo = avaliarResposta(item, bruto)
    if (juizo.conforme === true) conformes += 1
    if (juizo.conforme === false) {
      naoConformidades.push({
        item_id: item.id,
        rotulo: item.rotulo,
        secao: item.secao_titulo,
        criticidade: juizo.criticidade,
        valor: bruto,
      })
      // Item critico pode exigir evidencia na hora (secao 15).
      const temFoto = resposta && typeof resposta === 'object' && resposta.tem_evidencia
      if (item.foto_obrigatoria_se_nok && !temFoto) {
        fotosPendentes.push({ item_id: item.id, rotulo: item.rotulo })
      }
    }
  }

  const maiorCriticidade = naoConformidades.reduce((maior, nc) => (
    PESO_CRITICIDADE[nc.criticidade] > PESO_CRITICIDADE[maior] ? nc.criticidade : maior
  ), 'informativo')

  // A consequencia depende da politica da empresa, nunca de um "nao conforme"
  // solto (secao 13). Um bloqueio precisa ser explicavel.
  const bloqueiaPorCritico = politicas.bloqueio_por_critico !== false
  const temCritico = naoConformidades.some((nc) => nc.criticidade === 'critico')

  let resultado = 'aprovado'
  let estadoVeiculo = 'disponivel'
  let motivo = null

  if (naoConformidades.length > 0) {
    resultado = 'com_pendencia'
    estadoVeiculo = 'com_pendencia'
    motivo = `${naoConformidades.length} nao conformidade(s), maior criticidade: ${maiorCriticidade}.`
  }
  if (temCritico) {
    resultado = 'reprovado'
    if (bloqueiaPorCritico) {
      estadoVeiculo = 'bloqueado'
      motivo = 'Nao conformidade critica com bloqueio ativo na politica da empresa.'
    } else {
      estadoVeiculo = 'restrito'
      motivo = 'Nao conformidade critica; a politica da empresa nao bloqueia automaticamente.'
    }
  }

  return {
    total_aplicaveis: aplicaveis.length,
    conformes,
    pendencias,
    fotos_pendentes: fotosPendentes,
    nao_conformidades: naoConformidades,
    maior_criticidade: naoConformidades.length ? maiorCriticidade : null,
    pode_finalizar: pendencias.length === 0 && fotosPendentes.length === 0,
    resultado,
    estado_veiculo_previsto: estadoVeiculo,
    motivo,
  }
}
