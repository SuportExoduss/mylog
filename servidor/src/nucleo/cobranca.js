// Quem devia ter feito checklist e nao fez (roadmap 11.2.2).
//
// Estado derivado, calculado na hora: nao existe tabela de "faltas". Guardar
// falta seria guardar uma acusacao que o proprio sistema pode ter que retirar
// — bastaria a pessoa mandar o checklist da fila offline dez minutos depois.
//
// A conta e' de UM checklist por pessoa por dia, nao um por modelo. Quem sai
// com carro toda manha faz o diario do carro que pegou; se o cargo dela libera
// quatro modelos (um por tipo de veiculo), continua sendo um checklist — nao
// quatro.
import { consultar } from './banco.js'
import { cargoLiberado, obrigatorioNoDia, classificarExecucao } from '../../../compartilhado/template.js'

// Bordas do dia em hora LOCAL, convertidas para UTC. O banco guarda UTC, mas
// "o dia de ontem" e' o dia de quem pergunta (mesma razao do filtro em 11.9).
function bordasDoDia(data) {
  const [ano, mes, dia] = data.split('-').map(Number)
  return {
    inicio: new Date(ano, mes - 1, dia, 0, 0, 0, 0).toISOString(),
    fim: new Date(ano, mes - 1, dia, 23, 59, 59, 999).toISOString(),
    objeto: new Date(ano, mes - 1, dia, 12, 0, 0),
  }
}

// Modelos publicados que obrigam alguem NESTE dia.
function modelosDoDia(empresaId, data) {
  return consultar(
    `SELECT id, nome, cargos_liberados, periodicidade, dias_semana, horario_limite
       FROM templates
      WHERE empresa_id = ? AND status = 'publicado' AND finalidade = 'padrao'
        AND periodicidade <> 'avulso'`,
    [empresaId])
    .map((t) => ({
      ...t,
      cargos: JSON.parse(t.cargos_liberados),
      dias_semana: JSON.parse(t.dias_semana || '[]'),
    }))
    .filter((t) => obrigatorioNoDia(t, data.objeto))
}

// Quem e' cobrado: ativo, usa veiculo todos os dias, e tem cargo liberado em
// ao menos um dos modelos obrigatorios de hoje. Quem nao usa carro todo dia
// nao entra — ela so faz checklist quando pede um (roadmap 8.2).
export function quemNaoFez(empresaId, dataIso) {
  const data = bordasDoDia(dataIso)
  const modelos = modelosDoDia(empresaId, data)
  if (!modelos.length) return { dia: dataIso, exigido: false, faltantes: [], cobrados: 0 }

  const candidatos = consultar(
    `SELECT u.id, u.nome, u.cargo_id, c.nome AS cargo_nome
       FROM usuarios u
       LEFT JOIN cargos c ON c.id = u.cargo_id
      WHERE u.empresa_id = ? AND u.status = 'ativo' AND u.usa_veiculo_diario = 1
      ORDER BY u.nome`,
    [empresaId])

  const feitos = new Map(consultar(
    `SELECT i.usuario_id, MIN(i.finalizada_em) AS primeiro, t.horario_limite
       FROM inspecoes i
       JOIN templates t ON t.id = i.template_id
      WHERE i.empresa_id = ? AND i.momento = 'saida'
        AND i.iniciada_em >= ? AND i.iniciada_em <= ?
      GROUP BY i.usuario_id`,
    [empresaId, data.inicio, data.fim]).map((r) => [r.usuario_id, r]))

  const faltantes = []
  let cobrados = 0

  for (const pessoa of candidatos) {
    const meus = modelos.filter((m) => cargoLiberado(m.cargos, pessoa.cargo_id))
    if (!meus.length) continue      // nenhum modelo de hoje libera o cargo dela
    cobrados += 1

    const fez = feitos.get(pessoa.id)
    if (fez) continue

    // O horario limite mais cedo entre os modelos que a cobram: e' o momento a
    // partir do qual a falta e' falta, e nao "ainda vai fazer".
    const limites = meus.map((m) => m.horario_limite).filter(Boolean).sort()
    faltantes.push({
      usuario_id: pessoa.id,
      nome: pessoa.nome,
      cargo_id: pessoa.cargo_id,
      cargo_nome: pessoa.cargo_nome,
      horario_limite: limites[0] || null,
      modelos: meus.map((m) => m.nome),
    })
  }

  return { dia: dataIso, exigido: true, cobrados, faltantes }
}

// "Nao realizado" vale quando o prazo ja passou. Antes disso a pessoa nao esta
// devendo nada — esta trabalhando. Cobrar as 7h05 quem tem ate as 8h30 e' o
// tipo de alarme falso que faz a operacao parar de olhar o painel.
export function venceu(faltante, agora = new Date()) {
  if (!faltante.horario_limite) return false
  return classificarExecucao({ horario_limite: faltante.horario_limite }, agora) === 'atrasado'
}
