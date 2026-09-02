// Cadastro mestre da frota e vinculo usuario-veiculo.
// Regra do roadmap (secao 16): o app nunca altera dado mestre do veiculo.
// Isso e' garantido pelo RBAC — "colaborador" so possui veiculos.ler.
import { consultar, consultarUm, executar, novoId, agora } from '../nucleo/banco.js'
import { erro } from '../nucleo/http.js'
import { registrarEvento } from '../nucleo/auditoria.js'
import { exigirAutenticado } from '../seguranca/sessao.js'
import { exigir } from '../seguranca/permissoes.js'

export const STATUS_VEICULO = ['disponivel', 'com_pendencia', 'restrito', 'bloqueado', 'manutencao']
export const TIPOS_VEICULO = ['carro', 'caminhao', 'van', 'moto', 'maquina']

export function normalizarPlaca(bruta) {
  return String(bruta || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// Aceita placa antiga (ABC1234) e Mercosul (ABC1D23).
export function placaValida(placa) {
  return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa)
}

function buscarNaEmpresa(empresaId, veiculoId) {
  const veiculo = consultarUm('SELECT * FROM veiculos WHERE id = ? AND empresa_id = ?', [veiculoId, empresaId])
  if (!veiculo) throw erro.naoEncontrado('Veiculo nao encontrado nesta empresa.')
  return veiculo
}

export function registrarRotasVeiculos(rotas) {
  // ------------------------------------------------------------------ lista
  rotas.get('/api/veiculos', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'veiculos.ler')
    const status = ctx.query.get('status')
    const busca = (ctx.query.get('busca') || '').trim().toLowerCase()

    let sql = `SELECT v.*, u.nome AS usuario_principal_nome
                 FROM veiculos v
                 LEFT JOIN usuarios u ON u.id = v.usuario_principal
                WHERE v.empresa_id = ?`
    const params = [eu.empresa_id]
    if (status && STATUS_VEICULO.includes(status)) { sql += ' AND v.status = ?'; params.push(status) }
    if (busca) {
      sql += ' AND (lower(v.placa) LIKE ? OR lower(v.modelo) LIKE ? OR lower(v.marca) LIKE ?)'
      params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`)
    }
    sql += ' ORDER BY v.placa'
    return { veiculos: consultar(sql, params) }
  })

  // Busca enxuta por modelo + placa, usada na abertura de ticket (secao 16).
  rotas.get('/api/veiculos/busca', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'veiculos.ler')
    const termo = (ctx.query.get('termo') || '').trim().toLowerCase()
    if (termo.length < 2) return { veiculos: [] }
    return {
      veiculos: consultar(
        `SELECT id, placa, marca, modelo, tipo, status FROM veiculos
          WHERE empresa_id = ? AND (lower(placa) LIKE ? OR lower(modelo) LIKE ?)
          ORDER BY placa LIMIT 20`,
        [eu.empresa_id, `%${termo}%`, `%${termo}%`],
      ),
    }
  })

  // ------------------------------------------------------------------ criar
  rotas.post('/api/veiculos', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'veiculos.escrever')

    const placa = normalizarPlaca(ctx.corpo.placa)
    const modelo = String(ctx.corpo.modelo || '').trim()
    const marca = String(ctx.corpo.marca || '').trim() || null
    const tipo = String(ctx.corpo.tipo || 'carro')
    const ano = ctx.corpo.ano == null || ctx.corpo.ano === '' ? null : Number(ctx.corpo.ano)
    const km = Number(ctx.corpo.km_atual || 0)

    if (!placaValida(placa)) throw erro.requisicao('Placa invalida. Use o formato ABC1D23 ou ABC1234.')
    if (modelo.length < 2) throw erro.requisicao('Informe o modelo.')
    if (!TIPOS_VEICULO.includes(tipo)) throw erro.requisicao('Tipo de veiculo invalido.')
    if (ano !== null && (!Number.isInteger(ano) || ano < 1950 || ano > new Date().getFullYear() + 1)) {
      throw erro.requisicao('Ano invalido.')
    }
    if (!Number.isFinite(km) || km < 0) throw erro.requisicao('Quilometragem invalida.')

    if (consultarUm('SELECT id FROM veiculos WHERE empresa_id = ? AND placa = ?', [eu.empresa_id, placa])) {
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
    exigir(eu, 'veiculos.ler')
    const veiculo = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    const condutores = consultar(
      `SELECT v.id AS vinculo_id, v.principal, v.valido_de, v.valido_ate,
              u.id AS usuario_id, u.nome, u.email, u.status
         FROM vinculos v JOIN usuarios u ON u.id = v.usuario_id
        WHERE v.veiculo_id = ? AND v.empresa_id = ? AND v.revogado_em IS NULL
        ORDER BY v.principal DESC, u.nome`,
      [veiculo.id, eu.empresa_id],
    )
    return { veiculo, condutores }
  })

  // -------------------------------------------------------------- atualizar
  rotas.patch('/api/veiculos/:id', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'veiculos.escrever')
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
    const depois = buscarNaEmpresa(eu.empresa_id, antes.id)
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'veiculo.atualizado',
      entidade: 'veiculo', entidadeId: antes.id, antes, depois, ip: ctx.ip,
    })
    return { veiculo: depois }
  })

  // ----------------------------------------------------------------- status
  rotas.post('/api/veiculos/:id/status', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'veiculos.escrever')
    const antes = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    const novo = String(ctx.corpo.status || '')
    const motivo = String(ctx.corpo.motivo || '').trim() || null

    if (!STATUS_VEICULO.includes(novo)) throw erro.requisicao('Status invalido.')
    // Tirar um veiculo de bloqueio e' decisao explicita e sempre precisa de motivo.
    if (antes.status === 'bloqueado' && novo !== 'bloqueado' && !motivo) {
      throw erro.requisicao('Informe o motivo para liberar um veiculo bloqueado.')
    }

    executar('UPDATE veiculos SET status = ?, motivo_status = ?, atualizado_em = ? WHERE id = ? AND empresa_id = ?',
      [novo, motivo, agora(), antes.id, eu.empresa_id])
    const depois = buscarNaEmpresa(eu.empresa_id, antes.id)
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: `veiculo.status.${novo}`,
      entidade: 'veiculo', entidadeId: antes.id,
      antes: { status: antes.status }, depois: { status: novo, motivo }, ip: ctx.ip,
    })
    return { veiculo: depois }
  })

  // --------------------------------------------------------------------- km
  rotas.post('/api/veiculos/:id/km', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'veiculos.escrever')
    const antes = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    const km = Number(ctx.corpo.km_atual)
    const motivo = String(ctx.corpo.motivo || '').trim() || null

    if (!Number.isFinite(km) || km < 0) throw erro.requisicao('Quilometragem invalida.')
    // Hodometro nao anda para tras. Corrigir e' possivel, mas exige justificativa
    // e fica registrado — a preventiva por KM depende deste numero.
    if (km < antes.km_atual && !motivo) {
      throw erro.requisicao(`A quilometragem informada e' menor que a atual (${antes.km_atual}). Informe o motivo da correcao.`)
    }

    executar('UPDATE veiculos SET km_atual = ?, atualizado_em = ? WHERE id = ? AND empresa_id = ?',
      [Math.trunc(km), agora(), antes.id, eu.empresa_id])
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'veiculo.km_atualizado',
      entidade: 'veiculo', entidadeId: antes.id,
      antes: { km_atual: antes.km_atual }, depois: { km_atual: Math.trunc(km), motivo }, ip: ctx.ip,
    })
    return { veiculo: buscarNaEmpresa(eu.empresa_id, antes.id) }
  })

  // ------------------------------------------------------------- vinculos
  rotas.post('/api/vinculos', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'vinculos.escrever')
    const usuarioId = String(ctx.corpo.usuario_id || '')
    const veiculoId = String(ctx.corpo.veiculo_id || '')
    const principal = ctx.corpo.principal ? 1 : 0
    const validoDe = ctx.corpo.valido_de || null
    const validoAte = ctx.corpo.valido_ate || null

    const usuario = consultarUm('SELECT id, nome FROM usuarios WHERE id = ? AND empresa_id = ?',
      [usuarioId, eu.empresa_id])
    if (!usuario) throw erro.naoEncontrado('Usuario nao encontrado nesta empresa.')
    const veiculo = buscarNaEmpresa(eu.empresa_id, veiculoId)

    if (validoDe && validoAte && validoAte < validoDe) {
      throw erro.requisicao('A data final da autorizacao e anterior a data inicial.')
    }
    const jaExiste = consultarUm(
      'SELECT id FROM vinculos WHERE usuario_id = ? AND veiculo_id = ? AND revogado_em IS NULL',
      [usuarioId, veiculoId],
    )
    if (jaExiste) throw erro.conflito('Este usuario ja esta vinculado a este veiculo.')

    const id = novoId('vinculo')
    executar(
      `INSERT INTO vinculos (id, empresa_id, usuario_id, veiculo_id, principal, valido_de, valido_ate, criado_em, criado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, eu.empresa_id, usuarioId, veiculoId, principal, validoDe, validoAte, agora(), eu.id],
    )
    // So um condutor principal por veiculo.
    if (principal) {
      executar('UPDATE vinculos SET principal = 0 WHERE veiculo_id = ? AND id <> ? AND revogado_em IS NULL',
        [veiculoId, id])
      executar('UPDATE veiculos SET usuario_principal = ?, atualizado_em = ? WHERE id = ?',
        [usuarioId, agora(), veiculoId])
    }

    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'vinculo.criado',
      entidade: 'vinculo', entidadeId: id,
      depois: { usuario: usuario.nome, veiculo: veiculo.placa, principal, validoDe, validoAte }, ip: ctx.ip,
    })
    return { vinculo_id: id }
  })

  rotas.delete('/api/vinculos/:id', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'vinculos.escrever')
    const vinculo = consultarUm('SELECT * FROM vinculos WHERE id = ? AND empresa_id = ?',
      [ctx.params.id, eu.empresa_id])
    if (!vinculo) throw erro.naoEncontrado('Vinculo nao encontrado.')
    if (vinculo.revogado_em) return { ok: true }

    executar('UPDATE vinculos SET revogado_em = ? WHERE id = ?', [agora(), vinculo.id])
    if (vinculo.principal) {
      executar('UPDATE veiculos SET usuario_principal = NULL, atualizado_em = ? WHERE id = ?',
        [agora(), vinculo.veiculo_id])
    }
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'vinculo.revogado',
      entidade: 'vinculo', entidadeId: vinculo.id,
      antes: { usuario_id: vinculo.usuario_id, veiculo_id: vinculo.veiculo_id }, ip: ctx.ip,
    })
    return { ok: true }
  })
}
