// Dashboard de supervisao (secao 7). Uma requisicao devolve todos os cards:
// o painel precisa abrir mostrando o que exige acao, sem varias idas ao servidor.
import { consultar, consultarUm } from '../nucleo/banco.js'
import { exigirAutenticado } from '../seguranca/sessao.js'
import { exigir } from '../seguranca/permissoes.js'
import { avaliarPreventivas } from '../nucleo/preventivas.js'

function contarPorChave(linhas, chave = 'chave') {
  const saida = {}
  for (const linha of linhas) saida[linha[chave]] = linha.total
  return saida
}

export function registrarRotasPainel(rotas) {
  rotas.get('/api/painel', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'painel.ver')
    const empresa = eu.empresa_id

    // O status das preventivas e' derivado de KM/data; recalcula antes de exibir.
    avaliarPreventivas(empresa)

    const hoje = new Date().toISOString().slice(0, 10)

    const frota = contarPorChave(consultar(
      'SELECT status AS chave, COUNT(*) AS total FROM veiculos WHERE empresa_id = ? GROUP BY status', [empresa]))

    const usuarios = contarPorChave(consultar(
      'SELECT status AS chave, COUNT(*) AS total FROM usuarios WHERE empresa_id = ? GROUP BY status', [empresa]))

    const inspecoesHoje = consultarUm(
      `SELECT COUNT(*) AS total FROM inspecoes
        WHERE empresa_id = ? AND substr(iniciada_em, 1, 10) = ?`, [empresa, hoje])?.total ?? 0

    const inspecoesAbertas = consultarUm(
      `SELECT COUNT(*) AS total FROM inspecoes
        WHERE empresa_id = ? AND status <> 'finalizada'`, [empresa])?.total ?? 0

    const naoConformidades = contarPorChave(consultar(
      `SELECT criticidade AS chave, COUNT(*) AS total FROM nao_conformidades
        WHERE empresa_id = ? AND status IN ('aberta', 'em_tratamento')
        GROUP BY criticidade`, [empresa]))

    const tickets = contarPorChave(consultar(
      'SELECT status AS chave, COUNT(*) AS total FROM tickets WHERE empresa_id = ? GROUP BY status', [empresa]))

    const ticketsAtrasados = consultarUm(
      `SELECT COUNT(*) AS total FROM tickets
        WHERE empresa_id = ? AND prazo_em IS NOT NULL AND prazo_em < ?
          AND status NOT IN ('resolvido', 'fechado')`, [empresa, new Date().toISOString()])?.total ?? 0

    const preventivas = contarPorChave(consultar(
      'SELECT status AS chave, COUNT(*) AS total FROM preventivas WHERE empresa_id = ? GROUP BY status', [empresa]))

    // Fila de acao: o que o lider precisa resolver hoje, ja ordenado por urgencia.
    const alertas = []
    const vencidas = consultar(
      `SELECT p.id, p.modo, p.proximo_km, p.proxima_data, v.placa, v.modelo, v.km_atual
         FROM preventivas p JOIN veiculos v ON v.id = p.veiculo_id
        WHERE p.empresa_id = ? AND p.status = 'vencida' ORDER BY v.placa LIMIT 10`, [empresa])
    for (const p of vencidas) {
      alertas.push({
        nivel: 'critico', tipo: 'preventiva', destino: `/veiculos/${p.id}`,
        texto: p.modo === 'km'
          ? `Preventiva vencida: ${p.placa} (${p.modelo}) — ${p.km_atual} km, alvo era ${p.proximo_km} km.`
          : `Preventiva vencida: ${p.placa} (${p.modelo}) — venceu em ${p.proxima_data}.`,
      })
    }
    const criticas = consultar(
      `SELECT n.id, n.descricao, v.placa FROM nao_conformidades n
         JOIN veiculos v ON v.id = n.veiculo_id
        WHERE n.empresa_id = ? AND n.criticidade = 'critico' AND n.status IN ('aberta','em_tratamento')
        ORDER BY n.aberta_em DESC LIMIT 10`, [empresa])
    for (const n of criticas) {
      alertas.push({ nivel: 'critico', tipo: 'nao_conformidade', destino: `/ocorrencias/${n.id}`,
        texto: `Nao conformidade critica em ${n.placa}: ${n.descricao}` })
    }
    const pendentes = usuarios.pendente || 0
    if (pendentes > 0) {
      alertas.push({ nivel: 'atencao', tipo: 'usuario', destino: '/usuarios?status=pendente',
        texto: `${pendentes} usuario(s) aguardando liberacao de acesso.` })
    }
    const bloqueados = consultar(
      `SELECT placa, modelo, motivo_status FROM veiculos
        WHERE empresa_id = ? AND status = 'bloqueado' ORDER BY placa LIMIT 10`, [empresa])
    for (const v of bloqueados) {
      alertas.push({ nivel: 'critico', tipo: 'veiculo', destino: '/veiculos?status=bloqueado',
        texto: `Veiculo bloqueado: ${v.placa} (${v.modelo})${v.motivo_status ? ' — ' + v.motivo_status : ''}` })
    }

    return {
      gerado_em: new Date().toISOString(),
      frota: {
        total: Object.values(frota).reduce((a, b) => a + b, 0),
        por_status: frota,
      },
      checklists: { hoje: inspecoesHoje, em_aberto: inspecoesAbertas },
      nao_conformidades: {
        abertas: Object.values(naoConformidades).reduce((a, b) => a + b, 0),
        por_criticidade: naoConformidades,
      },
      tickets: {
        por_status: tickets,
        abertos: (tickets.aberto || 0) + (tickets.em_triagem || 0) + (tickets.atribuido || 0) + (tickets.em_andamento || 0),
        atrasados: ticketsAtrasados,
      },
      preventivas: { por_status: preventivas },
      usuarios: { por_status: usuarios, pendentes },
      alertas,
    }
  })
}
