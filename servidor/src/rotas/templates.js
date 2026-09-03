// Modelos de checklist versionados (roadmap 11).
//
// Regra central: modelo publicado e' IMUTAVEL. Cada inspecao aponta para a
// versao que foi respondida, entao editar uma versao publicada reescreveria o
// significado de inspecoes ja feitas. Editar cria a versao seguinte.
import { consultar, consultarUm, executar, novoId, agora, transacao } from '../nucleo/banco.js'
import { erro } from '../nucleo/http.js'
import { registrarEvento } from '../nucleo/auditoria.js'
import { exigirAutenticado } from '../seguranca/sessao.js'
import { exigirFrota } from '../seguranca/nivel.js'
import { conferirEstrutura, TIPOS_VEICULO, cargoLiberado } from '../../../compartilhado/template.js'

const CODIGO = /^[a-z0-9_-]{2,40}$/

function desserializar(linha) {
  if (!linha) return null
  return {
    ...linha,
    estrutura: JSON.parse(linha.estrutura),
    cargos_liberados: JSON.parse(linha.cargos_liberados),
    exige_assinatura: Boolean(linha.exige_assinatura),
  }
}

function buscarNaEmpresa(empresaId, id) {
  const linha = consultarUm('SELECT * FROM templates WHERE id = ? AND empresa_id = ?', [id, empresaId])
  if (!linha) throw erro.naoEncontrado('Checklist nao encontrado nesta empresa.')
  return desserializar(linha)
}

function validarCargos(empresaId, lista) {
  if (!Array.isArray(lista) || lista.length === 0) {
    throw erro.requisicao('Escolha os cargos liberados, ou "todos".')
  }
  if (lista.includes('*')) return ['*']
  for (const id of lista) {
    if (!consultarUm('SELECT id FROM cargos WHERE id = ? AND empresa_id = ?', [id, empresaId])) {
      throw erro.naoEncontrado(`Cargo ${id} nao encontrado nesta empresa.`)
    }
  }
  return [...new Set(lista)]
}

export function registrarRotasTemplates(rotas) {
  // ------------------------------------------------------------------ lista
  rotas.get('/api/templates', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const status = ctx.query.get('status')

    let sql = `SELECT id, codigo, nome, tipo_veiculo, cargos_liberados, exige_assinatura,
                      versao, status, publicado_em, atualizado_em, estrutura
                 FROM templates WHERE empresa_id = ?`
    const params = [eu.empresa_id]
    if (status) { sql += ' AND status = ?'; params.push(status) }
    sql += ' ORDER BY codigo, versao DESC'

    // A lista nao precisa da estrutura inteira, so do tamanho dela.
    const templates = consultar(sql, params).map((linha) => {
      const estrutura = JSON.parse(linha.estrutura)
      const { estrutura: _, ...resto } = linha
      return {
        ...resto,
        cargos_liberados: JSON.parse(linha.cargos_liberados),
        exige_assinatura: Boolean(linha.exige_assinatura),
        total_perguntas: estrutura.perguntas?.length ?? 0,
      }
    })
    return { templates }
  })

  rotas.get('/api/templates/:id', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    return { template: buscarNaEmpresa(eu.empresa_id, ctx.params.id) }
  })

  // ------------------------------------------------------------------ criar
  rotas.post('/api/templates', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))

    const codigo = String(ctx.corpo.codigo || '').trim().toLowerCase()
    const nome = String(ctx.corpo.nome || '').trim()
    const tipoVeiculo = String(ctx.corpo.tipo_veiculo || '')
    const cargos = validarCargos(eu.empresa_id, ctx.corpo.cargos_liberados)
    const exigeAssinatura = ctx.corpo.exige_assinatura ? 1 : 0

    if (!CODIGO.test(codigo)) {
      throw erro.requisicao('Codigo invalido. Use letras minusculas, numeros, hifen e _.')
    }
    if (nome.length < 3) throw erro.requisicao('Informe o nome do checklist.')
    if (!TIPOS_VEICULO.includes(tipoVeiculo)) throw erro.requisicao('Tipo de veiculo invalido.')
    if (consultarUm('SELECT id FROM templates WHERE empresa_id = ? AND codigo = ?',
      [eu.empresa_id, codigo])) {
      throw erro.conflito('Ja existe um checklist com este codigo. Crie uma nova versao dele.')
    }

    const id = novoId('template')
    const ts = agora()
    executar(
      `INSERT INTO templates (id, empresa_id, codigo, nome, tipo_veiculo, cargos_liberados,
                              exige_assinatura, versao, status, estrutura, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'rascunho', ?, ?, ?)`,
      [id, eu.empresa_id, codigo, nome, tipoVeiculo, JSON.stringify(cargos), exigeAssinatura,
       JSON.stringify(ctx.corpo.estrutura || { perguntas: [] }), ts, ts],
    )
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'checklist.criado',
      entidade: 'template', entidadeId: id,
      depois: { codigo, nome, tipo_veiculo: tipoVeiculo, versao: 1 }, ip: ctx.ip,
    })
    return { template: buscarNaEmpresa(eu.empresa_id, id) }
  })

  // -------------------------------------------------------------- atualizar
  rotas.put('/api/templates/:id', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const antes = buscarNaEmpresa(eu.empresa_id, ctx.params.id)

    if (antes.status !== 'rascunho') {
      throw erro.conflito(
        'Esta versao ja foi publicada e nao pode ser alterada. Crie a versao seguinte para mudar o checklist.')
    }

    const nome = ctx.corpo.nome === undefined ? antes.nome : String(ctx.corpo.nome).trim()
    const tipoVeiculo = ctx.corpo.tipo_veiculo === undefined
      ? antes.tipo_veiculo : String(ctx.corpo.tipo_veiculo)
    const cargos = ctx.corpo.cargos_liberados === undefined
      ? antes.cargos_liberados : validarCargos(eu.empresa_id, ctx.corpo.cargos_liberados)
    const exigeAssinatura = ctx.corpo.exige_assinatura === undefined
      ? (antes.exige_assinatura ? 1 : 0) : (ctx.corpo.exige_assinatura ? 1 : 0)
    const estrutura = ctx.corpo.estrutura === undefined ? antes.estrutura : ctx.corpo.estrutura

    if (nome.length < 3) throw erro.requisicao('Informe o nome do checklist.')
    if (!TIPOS_VEICULO.includes(tipoVeiculo)) throw erro.requisicao('Tipo de veiculo invalido.')
    // Rascunho pode ficar incompleto enquanto e' montado; a validacao dura
    // acontece na publicacao. Aqui so barramos o que quebraria a leitura.
    if (!estrutura || !Array.isArray(estrutura.perguntas)) {
      throw erro.requisicao('Estrutura do checklist invalida.')
    }

    executar(
      `UPDATE templates SET nome = ?, tipo_veiculo = ?, cargos_liberados = ?,
              exige_assinatura = ?, estrutura = ?, atualizado_em = ?
        WHERE id = ? AND empresa_id = ?`,
      [nome, tipoVeiculo, JSON.stringify(cargos), exigeAssinatura,
       JSON.stringify(estrutura), agora(), antes.id, eu.empresa_id],
    )
    return { template: buscarNaEmpresa(eu.empresa_id, antes.id) }
  })

  // -------------------------------------------------------------- publicar
  rotas.post('/api/templates/:id/publicar', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const template = buscarNaEmpresa(eu.empresa_id, ctx.params.id)

    if (template.status === 'publicado') throw erro.conflito('Esta versao ja esta publicada.')
    if (template.status === 'arquivado') throw erro.conflito('Versao arquivada nao pode ser publicada.')

    // Publicar e' o portao: aqui a estrutura precisa estar inteira.
    const conferencia = conferirEstrutura(template.estrutura)
    if (!conferencia.valido) throw erro.requisicao(conferencia.mensagem)

    const ts = agora()
    transacao(() => {
      // Sai de cena a versao publicada anterior do mesmo codigo.
      executar(
        `UPDATE templates SET status = 'arquivado', atualizado_em = ?
          WHERE empresa_id = ? AND codigo = ? AND status = 'publicado'`,
        [ts, eu.empresa_id, template.codigo])
      executar(`UPDATE templates SET status = 'publicado', publicado_em = ?, atualizado_em = ? WHERE id = ?`,
        [ts, ts, template.id])
    })

    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'checklist.publicado',
      entidade: 'template', entidadeId: template.id,
      depois: { codigo: template.codigo, versao: template.versao, ...conferencia.resumo }, ip: ctx.ip,
    })
    return { template: buscarNaEmpresa(eu.empresa_id, template.id) }
  })

  // ---------------------------------------------------------- nova versao
  rotas.post('/api/templates/:id/versao', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const base = buscarNaEmpresa(eu.empresa_id, ctx.params.id)

    const jaRascunho = consultarUm(
      `SELECT id, versao FROM templates WHERE empresa_id = ? AND codigo = ? AND status = 'rascunho'`,
      [eu.empresa_id, base.codigo])
    if (jaRascunho) {
      throw erro.conflito(`Ja existe um rascunho da versao ${jaRascunho.versao}. Edite ou descarte esse rascunho.`)
    }

    const maior = consultarUm(
      'SELECT MAX(versao) AS maior FROM templates WHERE empresa_id = ? AND codigo = ?',
      [eu.empresa_id, base.codigo])?.maior ?? base.versao

    const id = novoId('template')
    const ts = agora()
    executar(
      `INSERT INTO templates (id, empresa_id, codigo, nome, tipo_veiculo, cargos_liberados,
                              exige_assinatura, versao, status, estrutura, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'rascunho', ?, ?, ?)`,
      [id, eu.empresa_id, base.codigo, base.nome, base.tipo_veiculo,
       JSON.stringify(base.cargos_liberados), base.exige_assinatura ? 1 : 0,
       maior + 1, JSON.stringify(base.estrutura), ts, ts],
    )
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'checklist.nova_versao',
      entidade: 'template', entidadeId: id,
      antes: { versao: base.versao }, depois: { versao: maior + 1 }, ip: ctx.ip,
    })
    return { template: buscarNaEmpresa(eu.empresa_id, id) }
  })

  rotas.delete('/api/templates/:id', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const template = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    if (template.status !== 'rascunho') {
      throw erro.conflito('So rascunho pode ser descartado. Versao publicada faz parte do historico.')
    }
    executar('DELETE FROM templates WHERE id = ? AND empresa_id = ?', [template.id, eu.empresa_id])
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'checklist.rascunho_descartado',
      entidade: 'template', entidadeId: template.id,
      antes: { codigo: template.codigo, versao: template.versao }, ip: ctx.ip,
    })
    return { ok: true }
  })

  // Usado pelo editor para validar antes de tentar publicar.
  rotas.post('/api/templates/conferir', async (ctx) => {
    exigirFrota(exigirAutenticado(ctx))
    return conferirEstrutura(ctx.corpo.estrutura)
  })
}

export { cargoLiberado }
