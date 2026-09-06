// Checklists feitos (roadmap 11.9) e a exportacao em planilha (11.10).
//
// A tela abre mostrando HOJE. Essa e' a pergunta das 8h da manha — "o que ja
// foi feito e o que esta faltando" — e ela nao deveria custar dois cliques.
//
// A mesma consulta serve a tela e a exportacao. Se fossem duas, um dia a
// planilha diria uma coisa e a tela outra, e ninguem saberia qual acreditar.
import { consultar, consultarUm } from '../nucleo/banco.js'
import { erro } from '../nucleo/http.js'
import { exigirAutenticado } from '../seguranca/sessao.js'
import { exigirFrota, ehFrota } from '../seguranca/nivel.js'
import { classificarExecucao, MOMENTOS } from '../../../compartilhado/template.js'
import { bordaDoDia, diaLocal, minutosLocais, dataHoraLocal } from '../nucleo/relogio.js'
import { quemNaoFez, venceu } from '../nucleo/cobranca.js'

const LIMITE_PAGINA = 500

// A PLANILHA tem teto proprio, e muito maior.
//
// O teto da tela existe porque o navegador monta uma linha de DOM por
// registro; um arquivo nao paga esse preco. Com o mesmo teto dos 500, uma
// exportacao de tres dias uteis ja vinha cortada — o relatorio do PROLOG tem
// ~170 checklists por dia — e o arquivo nao dizia nada. Planilha e' o que se
// leva para reuniao: cortada em silencio, ela nao atrasa uma decisao, ela a
// enverga.
const LIMITE_PLANILHA = 50_000

// Datas chegam como AAAA-MM-DD (a tela usa <input type="date">). O dia inteiro
// vai da meia-noite ate 23:59:59.999 — comparar com "<= data" perderia tudo
// que foi feito depois da meia-noite do proprio dia.
//
// As bordas sao construidas em hora LOCAL e so entao convertidas para UTC. O
// banco guarda ISO-8601 em UTC, mas quem filtra pensa no dia dele: no Brasil
// (UTC-3), montar a borda como "AAAA-MM-DDT00:00:00Z" jogaria tudo que foi
// feito depois das 21h para o dia seguinte — tres horas de todo dia caindo no
// balde errado, justamente o fim de turno.
function faixaDoDia(de, ate) {
  const valida = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
  const inicio = valida(de) ? de : diaLocal()
  const fim = valida(ate) ? ate : inicio
  if (fim < inicio) throw erro.requisicao('A data final e anterior a inicial.')
  return {
    de: inicio, ate: fim,
    inicioIso: bordaDoDia(inicio),
    fimIso: bordaDoDia(fim, true),
  }
}

const CAMPOS = `i.id, i.numero, i.momento, i.resultado, i.km_informado,
  i.iniciada_em, i.finalizada_em, i.solicitacao_id,
  v.placa, v.marca, v.modelo AS veiculo_modelo, v.tipo AS veiculo_tipo,
  u.nome AS colaborador, u.cpf, c.nome AS cargo, u.cargo_id,
  t.nome AS checklist, t.codigo AS checklist_codigo, t.versao AS checklist_versao,
  t.horario_limite, t.periodicidade`

const DE = `FROM inspecoes i
  JOIN veiculos v ON v.id = i.veiculo_id
  JOIN usuarios u ON u.id = i.usuario_id
  LEFT JOIN cargos c ON c.id = u.cargo_id
  JOIN templates t ON t.id = i.template_id`

// Contagens que a planilha do PROLOG traz por linha. Feitas em uma consulta
// agregada por inspecao, e nao uma por linha: 917 execucoes no mes viram 917
// consultas extras se a conta for feita dentro do laco.
function contagens(empresaId, ids) {
  if (!ids.length) return new Map()
  const marcas = ids.map(() => '?').join(',')

  const respostas = consultar(
    `SELECT inspecao_id,
            COUNT(*) AS total,
            SUM(CASE WHEN desfecho = 'ocorrencia' THEN 1 ELSE 0 END) AS problemas
       FROM respostas WHERE empresa_id = ? AND inspecao_id IN (${marcas})
      GROUP BY inspecao_id`,
    [empresaId, ...ids])

  const fotos = consultar(
    `SELECT e.inspecao_id,
            COUNT(*) AS total,
            SUM(CASE WHEN r.desfecho = 'ocorrencia' THEN 1 ELSE 0 END) AS em_problema
       FROM evidencias e
       LEFT JOIN respostas r
              ON r.inspecao_id = e.inspecao_id AND r.pergunta_id = e.pergunta_id
      WHERE e.empresa_id = ? AND e.inspecao_id IN (${marcas})
      GROUP BY e.inspecao_id`,
    [empresaId, ...ids])

  const ocorrencias = consultar(
    `SELECT inspecao_id, prioridade, COUNT(*) AS total
       FROM ocorrencias WHERE empresa_id = ? AND inspecao_id IN (${marcas})
      GROUP BY inspecao_id, prioridade`,
    [empresaId, ...ids])

  const mapa = new Map()
  const linha = (id) => {
    if (!mapa.has(id)) {
      mapa.set(id, {
        perguntas: 0, problemas: 0, fotos: 0, fotos_problema: 0,
        baixa: 0, media: 0, alta: 0, critica: 0,
      })
    }
    return mapa.get(id)
  }

  for (const r of respostas) {
    const l = linha(r.inspecao_id)
    l.perguntas = Number(r.total || 0)
    l.problemas = Number(r.problemas || 0)
  }
  for (const f of fotos) {
    const l = linha(f.inspecao_id)
    l.fotos = Number(f.total || 0)
    l.fotos_problema = Number(f.em_problema || 0)
  }
  for (const o of ocorrencias) {
    const l = linha(o.inspecao_id)
    if (o.prioridade in l) l[o.prioridade] = Number(o.total || 0)
  }
  return mapa
}

// Uma linha pronta para tela e para planilha. Deriva o que nao esta gravado:
// duracao, estado de prazo, conformes.
function montarLinha(i, conta) {
  const c = conta || { perguntas: 0, problemas: 0, fotos: 0, fotos_problema: 0,
    baixa: 0, media: 0, alta: 0, critica: 0 }

  const inicio = new Date(i.iniciada_em)
  const fim = new Date(i.finalizada_em || i.iniciada_em)
  const segundos = Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())
    ? null : Math.max(0, Math.round((fim - inicio) / 1000))

  return {
    ...i,
    duracao_segundos: segundos,
    // "no prazo" ou "atrasado". "nao realizado" e' outra pergunta: fala de
    // execucao que NAO existe, e por isso nao pode sair de uma lista do que
    // foi feito.
    prazo: i.finalizada_em
      ? classificarExecucao(i, minutosLocais(new Date(i.finalizada_em)))
      : 'no_prazo',
    total_perguntas: c.perguntas,
    total_problemas: c.problemas,
    // O PROLOG chama de "itens nao se aplica", mas o numero e' sempre
    // total - problemas: e' a contagem de conformes com outro nome (11.10).
    total_conformes: Math.max(0, c.perguntas - c.problemas),
    total_fotos: c.fotos,
    total_fotos_problema: c.fotos_problema,
    prioridade_baixa: c.baixa,
    prioridade_media: c.media,
    prioridade_alta: c.alta,
    prioridade_critica: c.critica,
    avulso: !i.solicitacao_id,
  }
}

function consultarExecucoes(eu, query, limite = LIMITE_PAGINA) {
  const faixa = faixaDoDia(query.get('de'), query.get('ate'))
  const cargoId = query.get('cargo_id') || null
  const momento = query.get('momento')
  const veiculoId = query.get('veiculo_id') || null
  const templateId = query.get('template_id') || null

  let sql = `SELECT ${CAMPOS} ${DE}
              WHERE i.empresa_id = ? AND i.iniciada_em >= ? AND i.iniciada_em <= ?`
  const params = [eu.empresa_id, faixa.inicioIso, faixa.fimIso]

  // Colaborador ve os proprios checklists e mais nada.
  if (!ehFrota(eu)) { sql += ' AND i.usuario_id = ?'; params.push(eu.id) }
  if (cargoId) { sql += ' AND u.cargo_id = ?'; params.push(cargoId) }
  if (momento && MOMENTOS.includes(momento)) { sql += ' AND i.momento = ?'; params.push(momento) }
  if (veiculoId) { sql += ' AND i.veiculo_id = ?'; params.push(veiculoId) }
  if (templateId) { sql += ' AND t.id = ?'; params.push(templateId) }
  sql += ` ORDER BY i.iniciada_em DESC LIMIT ${limite}`

  const brutas = consultar(sql, params)
  const conta = contagens(eu.empresa_id, brutas.map((i) => i.id))
  return { faixa, execucoes: brutas.map((i) => montarLinha(i, conta.get(i.id))) }
}

// ------------------------------------------------------------------ CSV

// Ponto e virgula como separador e BOM no comeco: e' o que o Excel em
// portugues abre sem perguntar nada.
const COLUNAS = [
  'Unidade', 'Modelo checklist', 'Código checklist', 'Data realização', 'Data importado',
  'Colaborador', 'CPF', 'Equipe', 'Cargo', 'Placa', 'ID Frota', 'Tipo de veículo',
  'KM coletado', 'Tempo realização (segundos)', 'Tipo', 'Total de perguntas',
  'Total itens com problemas', 'Total imagens ou anexos', 'Total imagens alternativas',
  'Itens com Prioridade baixa', 'Itens com Prioridade alta', 'Itens com Prioridade crítica',
  'Itens não se aplica', 'Observação',
]

const ROTULO_TIPO = {
  compacto_leve: 'COMPACTO LEVE', pickup: 'PICK UP', quatro_x_quatro: '4x4',
  motocicleta: 'Motocicleta', caminhao: 'CAMINHAO',
}

// Um campo que contenha o separador, aspas ou quebra de linha precisa vir
// entre aspas, com as aspas internas dobradas. Sem isso um "Observação" com
// ponto e virgula empurra todas as colunas seguintes para o lado.
function campo(valor) {
  const texto = valor === null || valor === undefined ? '' : String(valor)
  return /[";\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

// A planilha e' conferida por quem esteve no patio: a hora tem que ser a que
// aparecia no relogio dele, nao a do processo que gerou o arquivo.
function dataBr(iso) {
  if (!iso) return ''
  const texto = dataHoraLocal(iso)
  return texto === '—' ? '' : texto
}

export function gerarCsv(empresaNome, execucoes, cortada = false) {
  const linhas = [COLUNAS.join(';')]
  for (const e of execucoes) {
    linhas.push([
      empresaNome,
      e.checklist,
      e.numero ?? '',
      dataBr(e.finalizada_em || e.iniciada_em),
      '',                                   // Data importado: nao existe no MyLog
      e.colaborador,
      e.cpf,
      '',                                   // Equipe: o MyLog classifica so por Cargo (11.10)
      e.cargo || '',
      e.placa,
      '',                                   // ID Frota: campo de lotacao que nao temos
      ROTULO_TIPO[e.veiculo_tipo] || e.veiculo_tipo,
      e.km_informado ?? '',
      e.duracao_segundos ?? '',
      e.momento === 'saida' ? 'Saída' : 'Retorno',
      e.total_perguntas,
      e.total_problemas,
      e.total_fotos,
      e.total_fotos_problema,
      e.prioridade_baixa,
      e.prioridade_alta,
      e.prioridade_critica,
      e.total_conformes,
      '',                                   // Observacao: campo livre, ainda sem tela
    ].map(campo).join(';'))
  }
  // \r\n porque e' o que o Excel espera, e ﻿ (BOM) para ele reconhecer
  // UTF-8. Escrito como escape de proposito: o BOM literal e' invisivel no
  // editor e some sem aviso em qualquer copia de arquivo desatenta.
  // Se cortou, o arquivo DIZ. Uma planilha que mente sobre o proprio tamanho
  // e' pior que uma que nao existe: ninguem confere o que parece completo.
  if (cortada) {
    linhas.push('')
    linhas.push(campo(
      `AVISO: exportacao interrompida em ${execucoes.length} linhas, que e o limite. `
      + 'Ha mais checklists no periodo escolhido. Estreite o periodo e exporte por partes.'))
  }
  return '\uFEFF' + linhas.join('\r\n') + '\r\n'
}

export function registrarRotasExecucoes(rotas) {
  rotas.get('/api/execucoes', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    const { faixa, execucoes } = consultarExecucoes(eu, ctx.query)
    return {
      periodo: { de: faixa.de, ate: faixa.ate },
      total: execucoes.length,
      limite: LIMITE_PAGINA,
      execucoes,
    }
  })

  // Quem devia ter feito e nao fez, no dia escolhido. Fica ao lado da lista
  // do que FOI feito, porque a pergunta das 8h da manha e' uma so: "o dia
  // fechou?" — e ela nao se responde olhando so metade.
  rotas.get('/api/execucoes/faltando', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const faixa = faixaDoDia(ctx.query.get('dia'), ctx.query.get('dia'))
    const r = quemNaoFez(eu.empresa_id, faixa.de)
    const agora = new Date()
    return {
      ...r,
      // "Vencido" so vale se o dia ja passou ou o prazo de hoje ja bateu.
      faltantes: r.faltantes.map((f) => ({
        ...f,
        vencido: faixa.de < diaLocal(agora) ? true : venceu(f, agora),
      })),
    }
  })

  // A exportacao aplica os MESMOS filtros da tela: exporta o que esta sendo
  // visto, nao a base inteira.
  rotas.get('/api/execucoes.csv', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const { faixa, execucoes } = consultarExecucoes(eu, ctx.query, LIMITE_PLANILHA)
    const empresa = consultarUm('SELECT nome FROM empresas WHERE id = ?', [eu.empresa_id])
    const csv = gerarCsv(empresa?.nome || '', execucoes, execucoes.length >= LIMITE_PLANILHA)

    const nome = `checklists_${faixa.de}_a_${faixa.ate}.csv`
    ctx.res.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${nome}"`,
      'cache-control': 'no-store',
    })
    ctx.res.end(csv)
  })
}
