// Cadastro mestre da frota (roadmap 9).
//
// Nao existe condutor principal nem vinculo usuario-veiculo. Os carros trocam
// de mao o tempo todo, e o controle de quem pega o carro e' fisico, pelo
// galpao. Duplicar isso em software so produziria cadastro mentiroso.
import { consultar, consultarUm, executar, novoId, agora, transacao } from '../nucleo/banco.js'
import { erro } from '../nucleo/http.js'
import { registrarEvento } from '../nucleo/auditoria.js'
import { exigirAutenticado } from '../seguranca/sessao.js'
import { exigirFrota } from '../seguranca/nivel.js'

export const STATUS_VEICULO = ['disponivel', 'com_pendencia', 'bloqueado', 'manutencao']

// Quanto cada estado restringe o uso do carro. Existe para uma regra so:
// um checklist pode APERTAR a restricao de um veiculo, nunca afrouxar.
// Sem isso, um retorno com problema medio rebaixaria para "com pendencia" um
// carro bloqueado por falha critica — liberando pela porta dos fundos aquilo
// que so a Frota libera, com motivo e auditoria (roadmap 9.3 e 12.2).
const RESTRICAO = { disponivel: 0, com_pendencia: 1, manutencao: 2, bloqueado: 3 }

export function agrava(atual, proposto) {
  return (RESTRICAO[proposto] ?? 0) > (RESTRICAO[atual] ?? 0)
}

export const TIPOS_VEICULO = [
  'compacto_leve', 'pickup', 'quatro_x_quatro', 'motocicleta', 'caminhao',
]

export function normalizarPlaca(bruta) {
  return String(bruta || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// Aceita placa antiga (ABC1234) e Mercosul (ABC1D23).
export function placaValida(placa) {
  return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa)
}

function buscarNaEmpresa(empresaId, veiculoId) {
  const veiculo = consultarUm('SELECT * FROM veiculos WHERE id = ? AND empresa_id = ?',
    [veiculoId, empresaId])
  if (!veiculo) throw erro.naoEncontrado('Veiculo nao encontrado nesta empresa.')
  return veiculo
}

// Aplicada tanto pela edicao quanto pela leitura de hodometro do checklist.
export function registrarKm(veiculo, kmNovo, { motivo, ator, ip }) {
  const km = Math.trunc(Number(kmNovo))
  if (!Number.isFinite(km) || km < 0) throw erro.requisicao('Quilometragem invalida.')
  if (km === Number(veiculo.km_atual)) return veiculo

  // O hodometro nao anda para tras. Corrigir e' possivel, mas exige
  // justificativa: a preventiva por KM depende inteiramente deste numero.
  if (km < Number(veiculo.km_atual) && !motivo) {
    throw erro.requisicao(
      `A quilometragem informada (${km}) e menor que a atual (${veiculo.km_atual}). Informe o motivo da correcao.`)
  }

  executar('UPDATE veiculos SET km_atual = ?, atualizado_em = ? WHERE id = ?',
    [km, agora(), veiculo.id])
  registrarEvento({
    empresaId: veiculo.empresa_id, ator, acao: 'veiculo.km_atualizado',
    entidade: 'veiculo', entidadeId: veiculo.id,
    antes: { km_atual: veiculo.km_atual }, depois: { km_atual: km, motivo }, ip,
  })
  return { ...veiculo, km_atual: km }
}

// "Com pendencia" e' consequencia de ocorrencia aberta, nao carimbo vitalicio.
// Fechada a ultima ocorrencia, o carro volta sozinho para disponivel. Sem isto
// a frota inteira migra para "com pendencia" com o passar dos meses e o filtro
// do painel para de separar o que precisa de acao do que ja foi resolvido.
//
// Bloqueio e manutencao NAO saem por aqui: continuam sendo decisao explicita
// da Frota, com motivo (roadmap 9.3).
export function reavaliarPendencia(empresaId, veiculoId, { ator, ip } = {}) {
  const veiculo = consultarUm('SELECT * FROM veiculos WHERE id = ? AND empresa_id = ?',
    [veiculoId, empresaId])
  if (!veiculo || veiculo.status !== 'com_pendencia') return veiculo

  const abertas = consultarUm(
    `SELECT COUNT(*) AS n FROM ocorrencias
      WHERE empresa_id = ? AND veiculo_id = ? AND status IN ('aberta', 'em_tratamento')`,
    [empresaId, veiculoId])
  if (Number(abertas?.n || 0) > 0) return veiculo

  executar(`UPDATE veiculos SET status = 'disponivel', motivo_status = NULL, atualizado_em = ?
             WHERE id = ? AND empresa_id = ?`, [agora(), veiculoId, empresaId])
  registrarEvento({
    empresaId, ator, acao: 'veiculo.status.disponivel',
    entidade: 'veiculo', entidadeId: veiculoId,
    antes: { status: 'com_pendencia' },
    depois: { status: 'disponivel', motivo: 'Ultima ocorrencia do veiculo foi encerrada.' },
    ip,
  })
  return consultarUm('SELECT * FROM veiculos WHERE id = ?', [veiculoId])
}

export function registrarRotasVeiculos(rotas) {
  // ------------------------------------------------------------------ lista
  rotas.get('/api/veiculos', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    const status = ctx.query.get('status')
    const tipo = ctx.query.get('tipo')
    const busca = (ctx.query.get('busca') || '').trim().toLowerCase()

    let sql = 'SELECT * FROM veiculos WHERE empresa_id = ?'
    const params = [eu.empresa_id]
    if (status && STATUS_VEICULO.includes(status)) { sql += ' AND status = ?'; params.push(status) }
    if (tipo && TIPOS_VEICULO.includes(tipo)) { sql += ' AND tipo = ?'; params.push(tipo) }
    if (busca) {
      sql += ' AND (lower(placa) LIKE ? OR lower(modelo) LIKE ? OR lower(marca) LIKE ?)'
      params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`)
    }
    sql += ' ORDER BY placa'
    return { veiculos: consultar(sql, params) }
  })

  // ------------------------------------------------------------------ criar
  rotas.post('/api/veiculos', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))

    const placa = normalizarPlaca(ctx.corpo.placa)
    const modelo = String(ctx.corpo.modelo || '').trim()
    const marca = String(ctx.corpo.marca || '').trim() || null
    const tipo = String(ctx.corpo.tipo || 'compacto_leve')
    const ano = ctx.corpo.ano == null || ctx.corpo.ano === '' ? null : Number(ctx.corpo.ano)
    const km = Number(ctx.corpo.km_atual || 0)

    if (!placaValida(placa)) throw erro.requisicao('Placa invalida. Use o formato ABC1D23 ou ABC1234.')
    if (modelo.length < 2) throw erro.requisicao('Informe o modelo.')
    if (!TIPOS_VEICULO.includes(tipo)) throw erro.requisicao('Tipo de veiculo invalido.')
    if (ano !== null && (!Number.isInteger(ano) || ano < 1950 || ano > new Date().getFullYear() + 1)) {
      throw erro.requisicao('Ano invalido.')
    }
    if (!Number.isFinite(km) || km < 0) throw erro.requisicao('Quilometragem invalida.')

    if (consultarUm('SELECT id FROM veiculos WHERE empresa_id = ? AND placa = ?',
      [eu.empresa_id, placa])) {
      throw erro.conflito('Ja existe um veiculo com esta placa.')
    }

    const id = novoId('veiculo')
    const ts = agora()
    executar(
      `INSERT INTO veiculos (id, empresa_id, placa, marca, modelo, ano, tipo, km_atual,
                             status, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'disponivel', ?, ?)`,
      [id, eu.empresa_id, placa, marca, modelo, ano, tipo, Math.trunc(km), ts, ts],
    )
    const criado = buscarNaEmpresa(eu.empresa_id, id)
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'veiculo.criado',
      entidade: 'veiculo', entidadeId: id, depois: criado, ip: ctx.ip,
    })
    return { veiculo: criado }
  })

  // --------------------------------------------------------------- detalhe
  rotas.get('/api/veiculos/:id', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    const veiculo = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    const ocorrencias = consultar(
      `SELECT id, descricao, prioridade, status, aberta_em FROM ocorrencias
        WHERE veiculo_id = ? AND status IN ('aberta','em_tratamento')
        ORDER BY aberta_em DESC LIMIT 10`, [veiculo.id])
    return { veiculo, ocorrencias }
  })

  // -------------------------------------------------------------- atualizar
  // O KM entra aqui, digitavel, sem botao proprio nem tela separada
  // (roadmap 9.2).
  rotas.patch('/api/veiculos/:id', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const antes = buscarNaEmpresa(eu.empresa_id, ctx.params.id)

    const modelo = ctx.corpo.modelo === undefined ? antes.modelo : String(ctx.corpo.modelo).trim()
    const marca = ctx.corpo.marca === undefined ? antes.marca : (String(ctx.corpo.marca).trim() || null)
    const tipo = ctx.corpo.tipo === undefined ? antes.tipo : String(ctx.corpo.tipo)
    const ano = ctx.corpo.ano === undefined ? antes.ano
      : (ctx.corpo.ano === '' || ctx.corpo.ano === null ? null : Number(ctx.corpo.ano))

    if (ctx.corpo.placa !== undefined && normalizarPlaca(ctx.corpo.placa) !== antes.placa) {
      throw erro.conflito('A placa identifica o ativo e nao pode ser trocada. Cadastre outro veiculo.')
    }
    if (modelo.length < 2) throw erro.requisicao('Informe o modelo.')
    if (!TIPOS_VEICULO.includes(tipo)) throw erro.requisicao('Tipo de veiculo invalido.')

    executar(
      'UPDATE veiculos SET modelo = ?, marca = ?, tipo = ?, ano = ?, atualizado_em = ? WHERE id = ? AND empresa_id = ?',
      [modelo, marca, tipo, ano, agora(), antes.id, eu.empresa_id],
    )

    if (ctx.corpo.km_atual !== undefined && ctx.corpo.km_atual !== '') {
      registrarKm(antes, ctx.corpo.km_atual, {
        motivo: String(ctx.corpo.motivo_km || '').trim() || null, ator: eu, ip: ctx.ip,
      })
    }

    const depois = buscarNaEmpresa(eu.empresa_id, antes.id)
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'veiculo.atualizado',
      entidade: 'veiculo', entidadeId: antes.id, antes, depois, ip: ctx.ip,
    })
    return { veiculo: depois }
  })

  // ----------------------------------------------------------------- status
  rotas.post('/api/veiculos/:id/status', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const antes = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    const novo = String(ctx.corpo.status || '')
    const motivo = String(ctx.corpo.motivo || '').trim() || null

    if (!STATUS_VEICULO.includes(novo)) throw erro.requisicao('Status invalido.')

    // Tirar um veiculo de bloqueio e' decisao explicita e sempre precisa de
    // motivo — inclusive quando o bloqueio veio de uma ocorrencia critica e um
    // diagnostico tecnico concluiu que o carro pode rodar (roadmap 9.3).
    if (antes.status === 'bloqueado' && novo !== 'bloqueado' && !motivo) {
      throw erro.requisicao('Informe o motivo para liberar um veiculo bloqueado.')
    }

    // Liberar um carro bloqueado e registrar quem liberou, com que motivo, sao
    // um ato so. Um carro que volta a rodar sem essa linha na auditoria e' o
    // pior estado possivel do sistema.
    transacao(() => {
      executar('UPDATE veiculos SET status = ?, motivo_status = ?, atualizado_em = ? WHERE id = ? AND empresa_id = ?',
        [novo, motivo, agora(), antes.id, eu.empresa_id])
      registrarEvento({
        empresaId: eu.empresa_id, ator: eu, acao: `veiculo.status.${novo}`,
        entidade: 'veiculo', entidadeId: antes.id,
        antes: { status: antes.status }, depois: { status: novo, motivo }, ip: ctx.ip,
      })
    })
    return { veiculo: buscarNaEmpresa(eu.empresa_id, antes.id) }
  })

  // -------------------------------------------------------------- historico
  rotas.get('/api/veiculos/:id/historico', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const veiculo = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    return {
      veiculo,
      inspecoes: consultar(
        `SELECT i.id, i.momento, i.resultado, i.km_informado, i.finalizada_em,
                u.nome AS usuario, t.nome AS checklist
           FROM inspecoes i
           JOIN usuarios u ON u.id = i.usuario_id
           JOIN templates t ON t.id = i.template_id
          WHERE i.veiculo_id = ? ORDER BY i.iniciada_em DESC LIMIT 50`, [veiculo.id]),
      eventos: consultar(
        `SELECT acao, ator_nome, antes, depois, criado_em FROM eventos_auditoria
          WHERE entidade = 'veiculo' AND entidade_id = ?
          ORDER BY criado_em DESC LIMIT 50`, [veiculo.id]),
    }
  })
}
