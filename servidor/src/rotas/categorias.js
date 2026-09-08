// Categorias de uso (roadmap 10.3).
//
// E' o que o colaborador pede quando precisa de carro: "4 assentos utilitario".
// Ele sabe o que vai FAZER; nao sabe (nem precisa saber) qual placa esta livre.
//
// Categoria NAO e' tipo de veiculo e nao se converte nele. Categoria e'
// necessidade de uso, declarada por quem pede. Tipo e' propriedade do carro, e
// continua sendo o tipo — sozinho — que decide qual checklist aparece no
// aplicativo: o checklist confere o carro que esta na mao, nao o que foi
// pedido.
import { consultar, consultarUm, executar, transacao, novoId, agora } from '../nucleo/banco.js'
import { erro } from '../nucleo/http.js'
import { registrarEvento } from '../nucleo/auditoria.js'
import { exigirAutenticado } from '../seguranca/sessao.js'
import { exigirFrota } from '../seguranca/nivel.js'

// Duas carrocerias, cruzadas com o numero de assentos: e' assim que a
// operacao descreve a necessidade. Compacto leva gente; utilitario leva
// carga. A lista de CATEGORIAS e' cadastro; esta e' so o vocabulario.
export const CARROCERIAS = ['compacto', 'utilitario']

function buscarNaEmpresa(empresaId, id) {
  const linha = consultarUm('SELECT * FROM categorias_uso WHERE id = ? AND empresa_id = ?',
    [id, empresaId])
  if (!linha) throw erro.naoEncontrado('Categoria nao encontrada nesta empresa.')
  return linha
}

function validar(corpo) {
  const nome = String(corpo.nome || '').trim()
  if (nome.length < 3) throw erro.requisicao('Informe o nome da categoria.')

  const assentos = corpo.assentos === '' || corpo.assentos === null || corpo.assentos === undefined
    ? null
    : Math.trunc(Number(corpo.assentos))
  if (assentos !== null && (!Number.isFinite(assentos) || assentos < 1 || assentos > 60)) {
    throw erro.requisicao('Numero de assentos invalido.')
  }

  const carroceria = String(corpo.carroceria || '').trim() || null
  if (carroceria && !CARROCERIAS.includes(carroceria)) {
    throw erro.requisicao(`Carroceria invalida. Use: ${CARROCERIAS.join(', ')}.`)
  }
  return { nome, assentos, carroceria }
}

export function registrarRotasCategorias(rotas) {
  // O colaborador PRECISA ler esta lista: e' o formulario de pedido dele.
  // Escrever, so a Frota.
  rotas.get('/api/categorias', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    const todas = ctx.query.get('todas') === '1' && Boolean(eu.acessa_painel)
    return {
      categorias: consultar(
        `SELECT c.*,
                (SELECT COUNT(*) FROM veiculo_categorias vc WHERE vc.categoria_id = c.id) AS veiculos
           FROM categorias_uso c
          WHERE c.empresa_id = ?${todas ? '' : ' AND c.ativo = 1'}
          ORDER BY c.assentos, c.nome`,
        [eu.empresa_id]),
    }
  })

  rotas.post('/api/categorias', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const { nome, assentos, carroceria } = validar(ctx.corpo)
    if (consultarUm('SELECT id FROM categorias_uso WHERE empresa_id = ? AND nome = ? COLLATE NOCASE',
      [eu.empresa_id, nome])) {
      throw erro.conflito('Ja existe uma categoria com este nome.')
    }
    const id = novoId('categoria')
    const ts = agora()
    executar(
      `INSERT INTO categorias_uso (id, empresa_id, nome, assentos, carroceria, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, eu.empresa_id, nome, assentos, carroceria, ts, ts])
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'categoria.criada',
      entidade: 'categoria', entidadeId: id, depois: { nome, assentos, carroceria }, ip: ctx.ip,
    })
    return { categoria: buscarNaEmpresa(eu.empresa_id, id) }
  })

  rotas.patch('/api/categorias/:id', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const antes = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    const { nome, assentos, carroceria } = validar({ ...antes, ...ctx.corpo })
    const ativo = ctx.corpo.ativo === undefined ? antes.ativo : (ctx.corpo.ativo ? 1 : 0)

    const repetido = consultarUm(
      'SELECT id FROM categorias_uso WHERE empresa_id = ? AND nome = ? COLLATE NOCASE AND id <> ?',
      [eu.empresa_id, nome, antes.id])
    if (repetido) throw erro.conflito('Ja existe uma categoria com este nome.')

    executar(
      `UPDATE categorias_uso SET nome = ?, assentos = ?, carroceria = ?, ativo = ?, atualizado_em = ?
        WHERE id = ? AND empresa_id = ?`,
      [nome, assentos, carroceria, ativo, agora(), antes.id, eu.empresa_id])
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'categoria.atualizada',
      entidade: 'categoria', entidadeId: antes.id,
      antes: { nome: antes.nome, assentos: antes.assentos, ativo: antes.ativo },
      depois: { nome, assentos, carroceria, ativo }, ip: ctx.ip,
    })
    return { categoria: buscarNaEmpresa(eu.empresa_id, antes.id) }
  })

  // Categoria citada por uma solicitacao nao pode sumir: apagaria o motivo do
  // pedido no historico. Nesse caso a saida e' desativar.
  rotas.delete('/api/categorias/:id', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const categoria = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    const usos = consultarUm('SELECT COUNT(*) AS total FROM solicitacoes WHERE categoria_id = ?',
      [categoria.id])
    if (usos.total > 0) {
      throw erro.conflito(
        `${usos.total} solicitacao(oes) pediram esta categoria. Desative em vez de remover.`)
    }
    // Os dois DELETE sao um ato so. Se o primeiro passasse e o segundo nao, a
    // categoria continuaria de pe sem nenhum carro — visivel no formulario de
    // pedido, e impossivel de atender.
    transacao(() => {
      executar('DELETE FROM veiculo_categorias WHERE categoria_id = ?', [categoria.id])
      executar('DELETE FROM categorias_uso WHERE id = ? AND empresa_id = ?',
        [categoria.id, eu.empresa_id])
    })
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'categoria.removida',
      entidade: 'categoria', entidadeId: categoria.id, antes: { nome: categoria.nome }, ip: ctx.ip,
    })
    return { ok: true }
  })

  // --------------------------------------------- quais carros atendem a que

  rotas.get('/api/categorias/:id/veiculos', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const categoria = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    return {
      categoria,
      veiculos: consultar(
        `SELECT v.id, v.placa, v.marca, v.modelo, v.tipo, v.status,
                (SELECT COUNT(*) FROM veiculo_categorias vc
                  WHERE vc.veiculo_id = v.id AND vc.categoria_id = ?) AS atende
           FROM veiculos v WHERE v.empresa_id = ? ORDER BY v.placa`,
        [categoria.id, eu.empresa_id]),
    }
  })

  // Substitui a lista inteira de uma vez: e' como a tela pensa (caixas de
  // marcar salvas juntas), e evita o estado intermediario de um PUT parcial.
  rotas.put('/api/categorias/:id/veiculos', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const categoria = buscarNaEmpresa(eu.empresa_id, ctx.params.id)
    const pedidos = Array.isArray(ctx.corpo.veiculos) ? ctx.corpo.veiculos.map(String) : []

    const daEmpresa = new Set(
      consultar('SELECT id FROM veiculos WHERE empresa_id = ?', [eu.empresa_id]).map((v) => v.id))
    const forasteiro = pedidos.find((id) => !daEmpresa.has(id))
    if (forasteiro) throw erro.naoEncontrado('Veiculo nao encontrado nesta empresa.')

    // Apagar e reinserir e' UM ato, e por isso vai numa transacao.
    //
    // O comentario logo acima ja dizia que a rota "evita o estado intermediario
    // de um PUT parcial" — e era exatamente nesse estado que ela podia deixar o
    // banco: o DELETE passava, um dos INSERT falhava, e a categoria ficava com
    // a lista pela metade ou VAZIA. Categoria vazia nao e' um detalhe: e' o
    // formulario de pedido do colaborador, e na liberacao e' dela que sai a
    // lista de carros que atendem.
    transacao(() => {
      executar('DELETE FROM veiculo_categorias WHERE categoria_id = ?', [categoria.id])
      for (const veiculoId of new Set(pedidos)) {
        executar(
          'INSERT INTO veiculo_categorias (empresa_id, veiculo_id, categoria_id) VALUES (?, ?, ?)',
          [eu.empresa_id, veiculoId, categoria.id])
      }
    })
    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'categoria.veiculos',
      entidade: 'categoria', entidadeId: categoria.id,
      depois: { veiculos: pedidos.length }, ip: ctx.ip,
    })
    return { ok: true, veiculos: pedidos.length }
  })
}
