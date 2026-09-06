// Modelos de checklist versionados (roadmap 11).
//
// Regra central: modelo publicado e' IMUTAVEL. Cada inspecao aponta para a
// versao que foi respondida, entao editar uma versao publicada reescreveria o
// significado de inspecoes ja feitas. Editar cria a versao seguinte.
import { consultar, consultarUm, executar, novoId, agora, transacao } from '../nucleo/banco.js'
import { erro } from '../nucleo/http.js'
import {
  caminhoDeImagemModelo, gravar, ler, tipoRealDe, LIMITE_BYTES,
} from '../nucleo/storage.js'
import { registrarEvento } from '../nucleo/auditoria.js'
import { exigirAutenticado } from '../seguranca/sessao.js'
import { exigirFrota } from '../seguranca/nivel.js'
import {
  conferirEstrutura, conferirPeriodicidade, TIPOS_VEICULO, cargoLiberado, FINALIDADES,
} from '../../../compartilhado/template.js'

const CODIGO = /^[a-z0-9_-]{2,40}$/

function desserializar(linha) {
  if (!linha) return null
  return {
    ...linha,
    estrutura: JSON.parse(linha.estrutura),
    cargos_liberados: JSON.parse(linha.cargos_liberados),
    dias_semana: JSON.parse(linha.dias_semana || '[]'),
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

    // A tela de Modelos e a de Preventivas leem a mesma rota, cada uma pedindo
    // a sua finalidade: sao dois cadastros com donos diferentes.
    const finalidade = ctx.query.get('finalidade')

    let sql = `SELECT id, codigo, nome, tipo_veiculo, cargos_liberados, exige_assinatura,
                      finalidade, periodicidade, dias_semana, dia_semana, horario_limite,
                      versao, status, publicado_em, atualizado_em, estrutura
                 FROM templates WHERE empresa_id = ?`
    const params = [eu.empresa_id]
    if (status) { sql += ' AND status = ?'; params.push(status) }
    if (finalidade) { sql += ' AND finalidade = ?'; params.push(finalidade) }
    sql += ' ORDER BY codigo, versao DESC'

    // A lista nao precisa da estrutura inteira, so do tamanho dela.
    const templates = consultar(sql, params).map((linha) => {
      const estrutura = JSON.parse(linha.estrutura)
      const { estrutura: _, ...resto } = linha
      return {
        ...resto,
        cargos_liberados: JSON.parse(linha.cargos_liberados),
        dias_semana: JSON.parse(linha.dias_semana || '[]'),
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
  // Ritmo do modelo (roadmap 11.2.1). Normaliza antes de validar: a tela manda
  // string, o banco guarda JSON, e a validacao pensa em numeros.
  function lerRitmo(corpo, antes = {}) {
    const periodicidade = corpo.periodicidade === undefined
      ? (antes.periodicidade || 'avulso') : String(corpo.periodicidade)

    const dias = corpo.dias_semana === undefined
      ? JSON.parse(antes.dias_semana || '[]')
      : (Array.isArray(corpo.dias_semana) ? corpo.dias_semana.map(Number) : [])

    const diaSemana = corpo.dia_semana === undefined
      ? (antes.dia_semana ?? null)
      : (corpo.dia_semana === null || corpo.dia_semana === '' ? null : Number(corpo.dia_semana))

    const horario = corpo.horario_limite === undefined
      ? (antes.horario_limite ?? null)
      : (String(corpo.horario_limite || '').trim() || null)

    const ritmo = {
      periodicidade,
      dias_semana: [...new Set(dias)].sort((x, y) => x - y),
      dia_semana: diaSemana,
      horario_limite: horario,
    }
    const juizo = conferirPeriodicidade(ritmo)
    if (!juizo.valido) throw erro.requisicao(juizo.mensagem)
    return ritmo
  }

  rotas.post('/api/templates', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))

    const codigo = String(ctx.corpo.codigo || '').trim().toLowerCase()
    const nome = String(ctx.corpo.nome || '').trim()
    const tipoVeiculo = String(ctx.corpo.tipo_veiculo || '')
    const cargos = validarCargos(eu.empresa_id, ctx.corpo.cargos_liberados)
    const exigeAssinatura = ctx.corpo.exige_assinatura ? 1 : 0
    const ritmo = lerRitmo(ctx.corpo)

    // Para que serve o modelo (roadmap 14.2). Preventiva executa manutencao:
    // saida e retorno obrigatorios, relatorio por pergunta e conclusao da
    // preventiva no fim.
    const finalidade = String(ctx.corpo.finalidade || 'padrao')
    if (!FINALIDADES.includes(finalidade)) throw erro.requisicao('Finalidade invalida.')

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
                              exige_assinatura, finalidade, periodicidade, dias_semana,
                              dia_semana, horario_limite, versao, status, estrutura,
                              criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'rascunho', ?, ?, ?)`,
      [id, eu.empresa_id, codigo, nome, tipoVeiculo, JSON.stringify(cargos), exigeAssinatura,
       finalidade, ritmo.periodicidade, JSON.stringify(ritmo.dias_semana), ritmo.dia_semana,
       ritmo.horario_limite,
       JSON.stringify(ctx.corpo.estrutura || { perguntas: [] }), ts, ts],
    )
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'checklist.criado',
      entidade: 'template', entidadeId: id,
      depois: {
        codigo, nome, tipo_veiculo: tipoVeiculo, versao: 1, finalidade,
        periodicidade: ritmo.periodicidade, horario_limite: ritmo.horario_limite,
      }, ip: ctx.ip,
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
    const ritmo = lerRitmo(ctx.corpo, antes)

    if (nome.length < 3) throw erro.requisicao('Informe o nome do checklist.')
    if (!TIPOS_VEICULO.includes(tipoVeiculo)) throw erro.requisicao('Tipo de veiculo invalido.')
    // Rascunho pode ficar incompleto enquanto e' montado; a validacao dura
    // acontece na publicacao. Aqui so barramos o que quebraria a leitura.
    if (!estrutura || !Array.isArray(estrutura.perguntas)) {
      throw erro.requisicao('Estrutura do checklist invalida.')
    }

    executar(
      `UPDATE templates SET nome = ?, tipo_veiculo = ?, cargos_liberados = ?,
              exige_assinatura = ?, periodicidade = ?, dias_semana = ?, dia_semana = ?,
              horario_limite = ?, estrutura = ?, atualizado_em = ?
        WHERE id = ? AND empresa_id = ?`,
      [nome, tipoVeiculo, JSON.stringify(cargos), exigeAssinatura,
       ritmo.periodicidade, JSON.stringify(ritmo.dias_semana), ritmo.dia_semana,
       ritmo.horario_limite,
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

  // --------------------------------------------- imagem de exemplo
  // A foto que o colaborador ve no meio da tela, mostrando COMO fotografar
  // aquela peca (roadmap 11.3). Vale para os dois tipos de modelo: o padrao e
  // o de preventiva usam o mesmo editor.
  rotas.post('/api/templates/:id/imagem', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const template = buscarNaEmpresa(eu.empresa_id, ctx.params.id)

    const base64 = String(ctx.corpo.conteudo || '').replace(/^data:[^,]+,/, '')
    if (!base64) throw erro.requisicao('Imagem vazia.')
    const buffer = Buffer.from(base64, 'base64')
    if (!buffer.length) throw erro.requisicao('Imagem ilegivel.')
    if (buffer.length > LIMITE_BYTES) {
      throw erro.requisicao(`Imagem acima do limite de ${Math.round(LIMITE_BYTES / 1024 / 1024)} MB.`)
    }

    // O tipo vem da assinatura do arquivo, nao do que o navegador declarou.
    const mime = tipoRealDe(buffer)
    if (!mime) throw erro.requisicao('Envie uma imagem JPEG, PNG ou WebP.')

    // O caminho e' derivado aqui, nunca recebido: nome de arquivo vindo do
    // cliente escolheria onde gravar.
    const caminho = caminhoDeImagemModelo({ empresaId: eu.empresa_id, templateId: template.id, mime })
    gravar(caminho, buffer)

    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'checklist.imagem',
      entidade: 'template', entidadeId: template.id,
      depois: { bytes: buffer.length, tipo: mime }, ip: ctx.ip,
    })
    // A URL vai para dentro da estrutura da pergunta, junto com o resto.
    return { url: `/imagens/modelo/${template.id}/${caminho.split(/[\\/]/).pop()}` }
  })

  // Servir a imagem passa por sessao e por tenant, como qualquer dado. Um link
  // vazado nao vira acesso.
  rotas.get('/imagens/modelo/:template/:arquivo', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    const template = consultarUm('SELECT id FROM templates WHERE id = ? AND empresa_id = ?',
      [ctx.params.template, eu.empresa_id])
    if (!template) throw erro.naoEncontrado('Imagem nao encontrada.')

    const arquivo = String(ctx.params.arquivo)
    if (!/^[a-f0-9]{16}\.(jpg|png|webp)$/.test(arquivo)) {
      throw erro.naoEncontrado('Imagem nao encontrada.')
    }
    const conteudo = ler(`${eu.empresa_id}/modelos/${template.id}/${arquivo}`)
    if (!conteudo) throw erro.naoEncontrado('Imagem nao encontrada.')

    const tipo = arquivo.endsWith('.png') ? 'image/png'
      : arquivo.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
    ctx.res.writeHead(200, {
      'content-type': tipo,
      'content-length': conteudo.length,
      // Modelo publicado e' imutavel e o nome do arquivo e' sorteado: pode
      // ficar em cache por muito tempo sem risco de servir a foto errada.
      'cache-control': 'private, max-age=86400',
    })
    ctx.res.end(conteudo)
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
                              exige_assinatura, finalidade, periodicidade, dias_semana,
                              dia_semana, horario_limite, versao, status, estrutura,
                              criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rascunho', ?, ?, ?)`,
      [id, eu.empresa_id, base.codigo, base.nome, base.tipo_veiculo,
       JSON.stringify(base.cargos_liberados), base.exige_assinatura ? 1 : 0,
       base.finalidade,
       // A nova versao herda o ritmo da anterior: mudar periodicidade sem
       // querer, so por criar uma versao, tiraria um checklist da cobranca.
       base.periodicidade, JSON.stringify(base.dias_semana ?? []), base.dia_semana ?? null,
       base.horario_limite ?? null,
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
