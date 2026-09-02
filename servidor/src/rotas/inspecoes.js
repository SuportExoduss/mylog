// Execucao de checklist e sincronizacao do aplicativo de campo (secoes 10, 28).
//
// DUAS REGRAS INEGOCIAVEIS AQUI:
//
// 1. O servidor RE-JULGA a inspecao. O aplicativo calcula o resumo offline para
//    mostrar ao motorista antes de finalizar, mas o veredito que vale e' o
//    calculado aqui, com o mesmo motor e a versao do template que foi
//    respondida. Um celular comprometido nao consegue aprovar um veiculo.
//
// 2. O vinculo usuario-veiculo e' verificado no servidor (secao 9). Nao basta
//    o app ter mostrado o veiculo na tela.
import { consultar, consultarUm, executar, novoId, agora, transacao } from '../nucleo/banco.js'
import { erro } from '../nucleo/http.js'
import { registrarEvento } from '../nucleo/auditoria.js'
import { exigirAutenticado } from '../seguranca/sessao.js'
import { exigir } from '../seguranca/permissoes.js'
import { resumirInspecao, avaliarResposta, itensAplicaveis } from '../../../compartilhado/template.js'

const HOJE = () => agora().slice(0, 10)

// Veiculos que este usuario pode inspecionar AGORA — vinculo ativo e dentro
// da validade, no caso de autorizacao temporaria.
function veiculosAutorizados(empresaId, usuarioId) {
  const hoje = HOJE()
  return consultar(
    `SELECT ve.id, ve.placa, ve.marca, ve.modelo, ve.tipo, ve.km_atual, ve.status,
            ve.motivo_status, v.principal
       FROM vinculos v
       JOIN veiculos ve ON ve.id = v.veiculo_id
      WHERE v.empresa_id = ? AND v.usuario_id = ? AND v.revogado_em IS NULL
        AND (v.valido_de IS NULL OR v.valido_de <= ?)
        AND (v.valido_ate IS NULL OR v.valido_ate >= ?)
      ORDER BY v.principal DESC, ve.placa`,
    [empresaId, usuarioId, hoje, hoje],
  )
}

function templatePublicado(empresaId, tipoVeiculo) {
  // Preferimos o template feito para o tipo do veiculo; se nao houver, cai no
  // generico (sem tipo). Nunca devolve rascunho nem versao arquivada.
  //
  // O desempate e' por DATA DE PUBLICACAO, nao por numero de versao: "versao"
  // so tem significado dentro de um mesmo codigo, entao comparar a v2 de um
  // checklist com a v1 de outro escolheria ao acaso qual checklist a frota
  // inteira responde.
  return consultarUm(
    `SELECT id, codigo, nome, versao, estrutura, tipo_veiculo FROM templates
      WHERE empresa_id = ? AND status = 'publicado'
        AND (tipo_veiculo = ? OR tipo_veiculo IS NULL)
      ORDER BY CASE WHEN tipo_veiculo = ? THEN 0 ELSE 1 END, publicado_em DESC
      LIMIT 1`,
    [empresaId, tipoVeiculo, tipoVeiculo],
  )
}

export function registrarRotasInspecoes(rotas) {
  // ------------------------------------------------------- contexto do app
  // Uma requisicao devolve tudo que o aplicativo precisa para funcionar o dia
  // inteiro offline: veiculos, checklist e politica. Menos idas a rede numa
  // conexao que pode nao existir depois.
  rotas.get('/api/app/inicio', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'inspecoes.executar')

    const veiculos = veiculosAutorizados(eu.empresa_id, eu.id)
    const empresa = consultarUm('SELECT politicas FROM empresas WHERE id = ?', [eu.empresa_id])
    const politicas = JSON.parse(empresa?.politicas || '{}')

    // Um template por veiculo autorizado — tipos diferentes pedem checklists
    // diferentes, e o app precisa dos dois antes de perder a rede.
    const templates = {}
    for (const veiculo of veiculos) {
      const t = templatePublicado(eu.empresa_id, veiculo.tipo)
      if (t) templates[veiculo.id] = { ...t, estrutura: JSON.parse(t.estrutura) }
    }

    const inspecoesHoje = consultar(
      `SELECT veiculo_id, finalizada_em, resultado FROM inspecoes
        WHERE empresa_id = ? AND usuario_id = ? AND substr(iniciada_em, 1, 10) = ?`,
      [eu.empresa_id, eu.id, HOJE()])

    const meusTickets = consultar(
      `SELECT t.id, t.numero, t.categoria, t.status, t.descricao, t.criado_em, v.placa
         FROM tickets t LEFT JOIN veiculos v ON v.id = t.veiculo_id
        WHERE t.empresa_id = ? AND t.solicitante_id = ?
          AND t.status NOT IN ('fechado')
        ORDER BY t.criado_em DESC LIMIT 20`,
      [eu.empresa_id, eu.id])

    return {
      usuario: { id: eu.id, nome: eu.nome, papel: eu.papel },
      veiculos,
      templates,
      politicas,
      inspecoes_hoje: inspecoesHoje,
      tickets: meusTickets,
      servidor_em: agora(),
    }
  })

  // ------------------------------------------------------------- sincronizar
  rotas.post('/api/inspecoes', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'inspecoes.executar')

    const clienteUuid = String(ctx.corpo.cliente_uuid || '').trim()
    if (!clienteUuid) throw erro.requisicao('Inspecao sem cliente_uuid: a fila offline exige um id proprio.')

    // Idempotencia: a fila offline reenvia o que nao teve confirmacao. Reenviar
    // a mesma inspecao devolve a que ja existe, sem duplicar nada.
    const jaExiste = consultarUm(
      'SELECT id, resultado, status FROM inspecoes WHERE empresa_id = ? AND cliente_uuid = ?',
      [eu.empresa_id, clienteUuid])
    if (jaExiste) return { inspecao_id: jaExiste.id, resultado: jaExiste.resultado, duplicada: true }

    const veiculoId = String(ctx.corpo.veiculo_id || '')
    const autorizados = veiculosAutorizados(eu.empresa_id, eu.id)
    const veiculo = autorizados.find((v) => v.id === veiculoId)
    // Vinculo conferido no servidor, nao no aplicativo (secao 9).
    if (!veiculo) {
      throw erro.permissao('Voce nao esta autorizado a inspecionar este veiculo.')
    }

    const template = consultarUm(
      'SELECT * FROM templates WHERE id = ? AND empresa_id = ?',
      [String(ctx.corpo.template_id || ''), eu.empresa_id])
    if (!template) throw erro.naoEncontrado('Template da inspecao nao encontrado.')

    const respostas = ctx.corpo.respostas || {}
    if (typeof respostas !== 'object') throw erro.requisicao('Respostas invalidas.')

    const estrutura = JSON.parse(template.estrutura)
    const empresa = consultarUm('SELECT politicas FROM empresas WHERE id = ?', [eu.empresa_id])
    const politicas = JSON.parse(empresa?.politicas || '{}')

    // AQUI o servidor decide. O resumo que o app mostrou nao entra na conta.
    const veredito = resumirInspecao(estrutura, respostas, politicas)
    if (!veredito.pode_finalizar) {
      throw erro.requisicao(
        `Inspecao incompleta: ${veredito.pendencias.length} item(ns) sem resposta e `
        + `${veredito.fotos_pendentes.length} foto(s) obrigatoria(s) faltando.`)
    }

    const iniciadaEm = ctx.corpo.iniciada_em || agora()
    const finalizadaEm = ctx.corpo.finalizada_em || agora()
    const kmInformado = ctx.corpo.km_informado == null ? null : Math.trunc(Number(ctx.corpo.km_informado))
    const id = novoId('inspecao')
    const ts = agora()

    const aplicaveis = itensAplicaveis(estrutura, respostas)
    const porId = new Map(aplicaveis.map((i) => [i.id, i]))

    transacao(() => {
      executar(
        `INSERT INTO inspecoes (id, empresa_id, veiculo_id, usuario_id, template_id, status,
                                km_informado, iniciada_em, finalizada_em, resultado, assinatura,
                                cliente_uuid, criado_em)
         VALUES (?, ?, ?, ?, ?, 'finalizada', ?, ?, ?, ?, ?, ?, ?)`,
        [id, eu.empresa_id, veiculo.id, eu.id, template.id, kmInformado,
         iniciadaEm, finalizadaEm, veredito.resultado,
         ctx.corpo.assinatura || null, clienteUuid, ts],
      )

      for (const [itemId, bruta] of Object.entries(respostas)) {
        const item = porId.get(itemId)
        if (!item) continue   // resposta de item escondido por condicao: descartada
        const valor = bruta && typeof bruta === 'object' ? bruta.valor : bruta
        const juizo = avaliarResposta(item, valor)
        executar(
          `INSERT INTO respostas (id, empresa_id, inspecao_id, item_id, tipo, valor,
                                  conforme, observacao, respondido_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [novoId('resposta'), eu.empresa_id, id, itemId, item.tipo,
           valor == null ? null : String(valor),
           juizo.conforme === null ? null : (juizo.conforme ? 1 : 0),
           (bruta && typeof bruta === 'object' ? bruta.observacao : null) || null, ts],
        )
      }

      // Cada nao conformidade vira ocorrencia rastreavel, com o item que a gerou.
      for (const nc of veredito.nao_conformidades) {
        executar(
          `INSERT INTO nao_conformidades (id, empresa_id, inspecao_id, veiculo_id, item_id,
                                          descricao, criticidade, status, aberta_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'aberta', ?)`,
          [novoId('nao_conformidade'), eu.empresa_id, id, veiculo.id, nc.item_id,
           `${nc.rotulo}: ${nc.valor}`, nc.criticidade, ts],
        )
      }

      // O estado do veiculo segue a politica da empresa, nao a vontade do app.
      if (veredito.estado_veiculo_previsto !== veiculo.status) {
        executar('UPDATE veiculos SET status = ?, motivo_status = ?, atualizado_em = ? WHERE id = ?',
          [veredito.estado_veiculo_previsto, veredito.motivo, ts, veiculo.id])
      }
      // KM informado no checklist tambem alimenta a preventiva — mas nunca
      // para tras, que seria erro de digitacao virando adiamento de manutencao.
      if (kmInformado != null && kmInformado > Number(veiculo.km_atual)) {
        executar('UPDATE veiculos SET km_atual = ?, atualizado_em = ? WHERE id = ?',
          [kmInformado, ts, veiculo.id])
      }
    })

    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'inspecao.finalizada',
      entidade: 'inspecao', entidadeId: id,
      depois: {
        placa: veiculo.placa, template: `${template.codigo} v${template.versao}`,
        resultado: veredito.resultado, nao_conformidades: veredito.nao_conformidades.length,
        estado_veiculo: veredito.estado_veiculo_previsto,
      },
      ip: ctx.ip,
    })

    return {
      inspecao_id: id,
      resultado: veredito.resultado,
      estado_veiculo: veredito.estado_veiculo_previsto,
      nao_conformidades: veredito.nao_conformidades.length,
      motivo: veredito.motivo,
      duplicada: false,
    }
  })

  // ----------------------------------------------------------------- listar
  rotas.get('/api/inspecoes', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'inspecoes.ler')

    const veiculoId = ctx.query.get('veiculo_id')
    let sql = `SELECT i.id, i.resultado, i.status, i.iniciada_em, i.finalizada_em, i.km_informado,
                      v.placa, v.modelo, u.nome AS usuario_nome,
                      t.codigo AS template_codigo, t.versao AS template_versao,
                      (SELECT COUNT(*) FROM nao_conformidades n WHERE n.inspecao_id = i.id) AS ncs
                 FROM inspecoes i
                 JOIN veiculos v ON v.id = i.veiculo_id
                 JOIN usuarios u ON u.id = i.usuario_id
                 JOIN templates t ON t.id = i.template_id
                WHERE i.empresa_id = ?`
    const params = [eu.empresa_id]
    if (veiculoId) { sql += ' AND i.veiculo_id = ?'; params.push(veiculoId) }
    sql += ' ORDER BY i.iniciada_em DESC LIMIT 100'

    return { inspecoes: consultar(sql, params) }
  })

  rotas.get('/api/inspecoes/:id', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    exigir(eu, 'inspecoes.ler')
    const inspecao = consultarUm(
      `SELECT i.*, v.placa, v.modelo, u.nome AS usuario_nome,
              t.codigo AS template_codigo, t.versao AS template_versao, t.estrutura
         FROM inspecoes i
         JOIN veiculos v ON v.id = i.veiculo_id
         JOIN usuarios u ON u.id = i.usuario_id
         JOIN templates t ON t.id = i.template_id
        WHERE i.id = ? AND i.empresa_id = ?`,
      [ctx.params.id, eu.empresa_id])
    if (!inspecao) throw erro.naoEncontrado('Inspecao nao encontrada nesta empresa.')

    return {
      inspecao: { ...inspecao, estrutura: JSON.parse(inspecao.estrutura) },
      respostas: consultar(
        'SELECT * FROM respostas WHERE inspecao_id = ? ORDER BY respondido_em', [inspecao.id]),
      nao_conformidades: consultar(
        'SELECT * FROM nao_conformidades WHERE inspecao_id = ? ORDER BY criticidade', [inspecao.id]),
    }
  })
}
