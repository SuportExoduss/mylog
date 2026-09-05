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

const LIMITE_PAGINA = 500

// Datas chegam como AAAA-MM-DD (a tela usa <input type="date">). O dia inteiro
// vai da meia-noite ate 23:59:59.999 — comparar com "<= data" perderia tudo
// que foi feito depois da meia-noite do proprio dia.
//
// As bordas sao construidas em hora LOCAL e so entao convertidas para UTC. O
// banco guarda ISO-8601 em UTC, mas quem filtra pensa no dia dele: no Brasil
// (UTC-3), montar a borda como "AAAA-MM-DDT00:00:00Z" jogaria tudo que foi
// feito depois das 21h para o dia seguinte — tres horas de todo dia caindo no
// balde errado, justamente o fim de turno.
function bordaLocal(data, fimDoDia) {
  const [ano, mes, dia] = data.split('-').map(Number)
  return fimDoDia
    ? new Date(ano, mes - 1, dia, 23, 59, 59, 999).toISOString()
    : new Date(ano, mes - 1, dia, 0, 0, 0, 0).toISOString()
}

function hojeLocal() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function faixaDoDia(de, ate) {
  const valida = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
  const inicio = valida(de) ? de : hojeLocal()
  const fim = valida(ate) ? ate : inicio
  if (fim < inicio) throw erro.requisicao('A data final e anterior a inicial.')
  return {
    de: inicio, ate: fim,
    inicioIso: bordaLocal(inicio, false),
    fimIso: bordaLocal(fim, true),
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
    prazo: i.finalizada_em ? classificarExecucao(i, i.finalizada_em) : 'no_prazo',
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

function consultarExecucoes(eu, query) {
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
  sql += ` ORDER BY i.iniciada_em DESC LIMIT ${LIMITE_PAGINA}`

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

function dataBr(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function gerarCsv(empresaNome, execucoes) {
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

  // A exportacao aplica os MESMOS filtros da tela: exporta o que esta sendo
  // visto, nao a base inteira.
  rotas.get('/api/execucoes.csv', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const { faixa, execucoes } = consultarExecucoes(eu, ctx.query)
    const empresa = consultarUm('SELECT nome FROM empresas WHERE id = ?', [eu.empresa_id])
    const csv = gerarCsv(empresa?.nome || '', execucoes)

    const nome = `checklists_${faixa.de}_a_${faixa.ate}.csv`
    ctx.res.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${nome}"`,
      'cache-control': 'no-store',
    })
    ctx.res.end(csv)
  })
}
