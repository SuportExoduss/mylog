// Motor de checklist: validacao, conformidade, itens condicionais e resumo.
// Esta logica sera reexecutada offline pelo aplicativo, entao um erro aqui
// aparece no campo, sem rede e sem quem consertar.
import test from 'node:test'
import assert from 'node:assert/strict'

const {
  conferirEstrutura, avaliarResposta, itemVisivel, itensAplicaveis, resumirInspecao,
} = await import('../../compartilhado/template.js')

const estruturaBoa = {
  secoes: [{
    id: 'seguranca',
    titulo: 'Seguranca',
    itens: [
      { id: 'extintor', rotulo: 'Extintor presente?', tipo: 'sim_nao', valor_conforme: 'sim',
        criticidade: 'critico', foto_obrigatoria_se_nok: true },
      { id: 'validade', rotulo: 'Validade do extintor', tipo: 'datahora',
        condicao: { item_id: 'extintor', operador: 'igual', valor: 'sim' } },
      { id: 'pressao', rotulo: 'Pressao do pneu', tipo: 'numero', minimo: 28, maximo: 36,
        criticidade: 'medio' },
      { id: 'pneu', rotulo: 'Condicao do pneu', tipo: 'selecao', opcoes: [
        { valor: 'normal', conforme: true },
        { valor: 'desgaste', conforme: false, criticidade: 'medio' },
        { valor: 'liso', conforme: false, criticidade: 'critico' },
      ] },
    ],
  }],
}

// ------------------------------------------------------------- validacao

test('estrutura valida passa e devolve o tamanho', () => {
  const r = conferirEstrutura(estruturaBoa)
  assert.equal(r.valido, true)
  assert.deepEqual(r.resumo, { secoes: 1, itens: 4 })
})

test('template sem secao nao publica', () => {
  assert.equal(conferirEstrutura({ secoes: [] }).valido, false)
})

test('secao sem item nao publica', () => {
  const r = conferirEstrutura({ secoes: [{ id: 'vazia', titulo: 'Vazia', itens: [] }] })
  assert.equal(r.valido, false)
  assert.match(r.mensagem, /sem nenhum item/)
})

test('id de item repetido e recusado', () => {
  const r = conferirEstrutura({ secoes: [{ id: 'sec', titulo: 'Secao', itens: [
    { id: 'item_x', rotulo: 'Um', tipo: 'ok_nok' },
    { id: 'item_x', rotulo: 'Dois', tipo: 'ok_nok' },
  ] }] })
  assert.equal(r.valido, false)
  assert.match(r.mensagem, /repetido/)
})

test('tipo desconhecido e recusado', () => {
  const r = conferirEstrutura({ secoes: [{ id: 'sec', titulo: 'Secao', itens: [
    { id: 'item_x', rotulo: 'Um', tipo: 'radiografia' },
  ] }] })
  assert.equal(r.valido, false)
})

test('condicao que aponta para item posterior e recusada', () => {
  // Sem isso o app teria de adivinhar uma resposta que ainda nao existe.
  const r = conferirEstrutura({ secoes: [{ id: 'sec', titulo: 'Secao', itens: [
    { id: 'item_a', rotulo: 'Item A', tipo: 'ok_nok', condicao: { item_id: 'item_b', operador: 'igual', valor: 'x' } },
    { id: 'item_b', rotulo: 'Item B', tipo: 'ok_nok' },
  ] }] })
  assert.equal(r.valido, false)
  assert.match(r.mensagem, /nao aparece antes/)
})

test('minimo maior que maximo e recusado', () => {
  const r = conferirEstrutura({ secoes: [{ id: 'sec', titulo: 'Secao', itens: [
    { id: 'item_p', rotulo: 'Item P', tipo: 'numero', minimo: 40, maximo: 10 },
  ] }] })
  assert.equal(r.valido, false)
})

test('selecao com menos de duas opcoes e recusada', () => {
  const r = conferirEstrutura({ secoes: [{ id: 'sec', titulo: 'Secao', itens: [
    { id: 'item_p', rotulo: 'Item P', tipo: 'selecao', opcoes: [{ valor: 'unico' }] },
  ] }] })
  assert.equal(r.valido, false)
})

// ---------------------------------------------------------- conformidade

const item = (id) => estruturaBoa.secoes[0].itens.find((i) => i.id === id)

test('sim_nao respeita qual resposta e a conforme', () => {
  assert.equal(avaliarResposta(item('extintor'), 'sim').conforme, true)
  assert.equal(avaliarResposta(item('extintor'), 'nao').conforme, false)
  // "Ha vazamento?" e o caso inverso: conforme e responder "nao".
  const vazamento = { tipo: 'sim_nao', valor_conforme: 'nao', criticidade: 'alto' }
  assert.equal(avaliarResposta(vazamento, 'nao').conforme, true)
  assert.equal(avaliarResposta(vazamento, 'sim').criticidade, 'alto')
})

test('numero avalia contra os limites, incluindo as bordas', () => {
  assert.equal(avaliarResposta(item('pressao'), 32).conforme, true)
  assert.equal(avaliarResposta(item('pressao'), 28).conforme, true)
  assert.equal(avaliarResposta(item('pressao'), 36).conforme, true)
  assert.equal(avaliarResposta(item('pressao'), 27).conforme, false)
  assert.equal(avaliarResposta(item('pressao'), 37).conforme, false)
})

test('numero nao numerico conta como nao conforme, nao como vazio', () => {
  assert.equal(avaliarResposta(item('pressao'), 'cheio').conforme, false)
})

test('selecao usa a criticidade da opcao escolhida', () => {
  assert.equal(avaliarResposta(item('pneu'), 'normal').conforme, true)
  assert.equal(avaliarResposta(item('pneu'), 'desgaste').criticidade, 'medio')
  assert.equal(avaliarResposta(item('pneu'), 'liso').criticidade, 'critico')
})

test('opcao inexistente nao passa como conforme', () => {
  assert.equal(avaliarResposta(item('pneu'), 'inventada').conforme, false)
})

test('tipos que so registram nao produzem juizo', () => {
  assert.equal(avaliarResposta({ tipo: 'texto' }, 'qualquer coisa').conforme, null)
  assert.equal(avaliarResposta({ tipo: 'foto' }, 'arq.jpg').conforme, null)
  assert.equal(avaliarResposta({ tipo: 'assinatura' }, 'x').conforme, null)
})

// ------------------------------------------------------ checklist adaptativo

test('item condicional so aparece quando a condicao bate', () => {
  const validade = item('validade')
  assert.equal(itemVisivel(validade, {}), false)                      // nada respondido
  assert.equal(itemVisivel(validade, { extintor: 'nao' }), false)
  assert.equal(itemVisivel(validade, { extintor: 'sim' }), true)
})

test('condicao por nao conformidade funciona com resposta CRUA', () => {
  // Regressao: a versao anterior so funcionava se quem chamasse ja tivesse
  // calculado o campo `conforme`. Nem o aplicativo nem o servidor calculam —
  // ambos passam o que o motorista respondeu. O item condicional nunca
  // aparecia, e portanto nunca era cobrado como pendencia.
  const estrutura = { secoes: [{ id: 'motor', titulo: 'Motor', itens: [
    { id: 'oleo_nivel', rotulo: 'Nivel de oleo', tipo: 'ok_nok', criticidade: 'alto' },
    { id: 'oleo_obs', rotulo: 'O que foi observado?', tipo: 'texto',
      condicao: { item_id: 'oleo_nivel', operador: 'nao_conforme' } },
  ] }] }

  const comOk = itensAplicaveis(estrutura, { oleo_nivel: 'ok' }).map((i) => i.id)
  assert.deepEqual(comOk, ['oleo_nivel'], 'com oleo conforme o detalhe fica escondido')

  const comNok = itensAplicaveis(estrutura, { oleo_nivel: 'nok' }).map((i) => i.id)
  assert.deepEqual(comNok, ['oleo_nivel', 'oleo_obs'], 'com oleo nao conforme o detalhe aparece')

  // E a mesma resposta vinda do app como objeto tem de dar no mesmo.
  const comObjeto = itensAplicaveis(estrutura, { oleo_nivel: { valor: 'nok' } }).map((i) => i.id)
  assert.deepEqual(comObjeto, ['oleo_nivel', 'oleo_obs'])

  // Sem responder nada, o condicional continua escondido.
  assert.deepEqual(itensAplicaveis(estrutura, {}).map((i) => i.id), ['oleo_nivel'])
})

test('detalhe exigido por nao conformidade vira pendencia de verdade', () => {
  // Consequencia do bug: se o item nunca aparece, ele nunca e' cobrado e a
  // inspecao fecha sem a explicacao que a regra exigia.
  const estrutura = { secoes: [{ id: 'motor', titulo: 'Motor', itens: [
    { id: 'oleo_nivel', rotulo: 'Nivel de oleo', tipo: 'ok_nok', criticidade: 'alto' },
    { id: 'oleo_obs', rotulo: 'O que foi observado?', tipo: 'texto',
      condicao: { item_id: 'oleo_nivel', operador: 'nao_conforme' } },
  ] }] }

  const semDetalhe = resumirInspecao(estrutura, { oleo_nivel: 'nok' }, {})
  assert.equal(semDetalhe.pode_finalizar, false)
  assert.deepEqual(semDetalhe.pendencias.map((p) => p.item_id), ['oleo_obs'])

  const comDetalhe = resumirInspecao(estrutura,
    { oleo_nivel: 'nok', oleo_obs: 'Nivel abaixo da marca minima.' }, {})
  assert.equal(comDetalhe.pode_finalizar, true)
})

test('condicao numerica compara como numero, nao como texto', () => {
  const alerta = { condicao: { item_id: 'km', operador: 'maior', valor: '100000' } }
  assert.equal(itemVisivel(alerta, { km: '90000' }), false)
  assert.equal(itemVisivel(alerta, { km: '120000' }), true)
})

test('itensAplicaveis some com o que a condicao esconde', () => {
  assert.equal(itensAplicaveis(estruturaBoa, {}).length, 3)
  assert.equal(itensAplicaveis(estruturaBoa, { extintor: 'sim' }).length, 4)
})

// -------------------------------------------------------- resumo da inspecao

const politicaBloqueia = { bloqueio_por_critico: true }
const politicaNaoBloqueia = { bloqueio_por_critico: false }

test('resumo: tudo conforme aprova e mantem o veiculo disponivel', () => {
  const r = resumirInspecao(estruturaBoa, {
    extintor: 'sim', validade: '2027-01-01', pressao: 32, pneu: 'normal',
  }, politicaBloqueia)
  assert.equal(r.resultado, 'aprovado')
  assert.equal(r.estado_veiculo_previsto, 'disponivel')
  assert.equal(r.pode_finalizar, true)
  assert.equal(r.conformes, 3)
})

test('resumo: item nao respondido vira pendencia e trava a finalizacao', () => {
  const r = resumirInspecao(estruturaBoa, { extintor: 'sim' }, politicaBloqueia)
  assert.equal(r.pode_finalizar, false)
  assert.deepEqual(r.pendencias.map((p) => p.item_id), ['validade', 'pressao', 'pneu'])
})

test('resumo: nao conformidade sem critico gera pendencia, nao bloqueio', () => {
  const r = resumirInspecao(estruturaBoa, {
    extintor: 'sim', validade: '2027-01-01', pressao: 20, pneu: 'normal',
  }, politicaBloqueia)
  assert.equal(r.resultado, 'com_pendencia')
  assert.equal(r.estado_veiculo_previsto, 'com_pendencia')
  assert.equal(r.maior_criticidade, 'medio')
})

test('resumo: critico bloqueia quando a politica da empresa manda bloquear', () => {
  const r = resumirInspecao(estruturaBoa, {
    extintor: 'sim', validade: '2027-01-01', pressao: 32, pneu: 'liso',
  }, politicaBloqueia)
  assert.equal(r.resultado, 'reprovado')
  assert.equal(r.estado_veiculo_previsto, 'bloqueado')
  assert.match(r.motivo, /politica/)
})

test('resumo: a mesma falha critica nao bloqueia se a politica nao mandar', () => {
  // Secao 13: "um nao conforme nao deve automaticamente bloquear tudo".
  const r = resumirInspecao(estruturaBoa, {
    extintor: 'sim', validade: '2027-01-01', pressao: 32, pneu: 'liso',
  }, politicaNaoBloqueia)
  assert.equal(r.resultado, 'reprovado')
  assert.equal(r.estado_veiculo_previsto, 'restrito')
})

test('resumo: foto obrigatoria pendente impede finalizar', () => {
  const semFoto = resumirInspecao(estruturaBoa, {
    extintor: { valor: 'nao' }, pressao: 32, pneu: 'normal',
  }, politicaBloqueia)
  assert.equal(semFoto.pode_finalizar, false)
  assert.deepEqual(semFoto.fotos_pendentes.map((f) => f.item_id), ['extintor'])

  const comFoto = resumirInspecao(estruturaBoa, {
    extintor: { valor: 'nao', tem_evidencia: true }, pressao: 32, pneu: 'normal',
  }, politicaBloqueia)
  assert.equal(comFoto.fotos_pendentes.length, 0)
  assert.equal(comFoto.pode_finalizar, true)
})

test('resumo: item escondido por condicao nao vira pendencia', () => {
  // Responder "nao" ao extintor esconde a validade; ela nao pode ser cobrada.
  const r = resumirInspecao(estruturaBoa, {
    extintor: { valor: 'nao', tem_evidencia: true }, pressao: 32, pneu: 'normal',
  }, politicaBloqueia)
  assert.equal(r.pendencias.length, 0)
  assert.equal(r.total_aplicaveis, 3)
})

test('resumo: item marcado como nao obrigatorio nao trava', () => {
  const estrutura = { secoes: [{ id: 'sec', titulo: 'Secao', itens: [
    { id: 'obs', rotulo: 'Observacoes', tipo: 'texto', obrigatorio: false },
    { id: 'farois_ok', rotulo: 'Farois', tipo: 'ok_nok', criticidade: 'medio' },
  ] }] }
  const r = resumirInspecao(estrutura, { farois_ok: 'ok' }, politicaBloqueia)
  assert.equal(r.pode_finalizar, true)
  assert.equal(r.resultado, 'aprovado')
})
