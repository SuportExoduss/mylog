// Testes de ponta a ponta contra o servidor HTTP real.
// Cada teste fala a lingua de um criterio de aceite (Roadmap v3.0, secao 25).
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const bancoTemp = path.join(os.tmpdir(), `mylog-api-${Date.now()}.db`)
process.env.MYLOG_BANCO = bancoTemp
process.env.MYLOG_PORTA = '0'   // porta livre escolhida pelo sistema

const { abrirBanco, executar, consultarUm, novoId, agora, fecharBanco } =
  await import('../src/nucleo/banco.js')
const { gerarHashSenha } = await import('../src/seguranca/senha.js')

abrirBanco()

// ---------------------------------------------------------------- cenario

const ts = agora()
const SENHA = 'mylog123'
const empresaA = novoId('empresa')
const empresaB = novoId('empresa')

function criarEmpresa(id, nome, politicas = {}) {
  executar(`INSERT INTO empresas (id, nome, status, politicas, criado_em, atualizado_em)
            VALUES (?, ?, 'ativa', ?, ?, ?)`, [id, nome, JSON.stringify(politicas), ts, ts])
}

function criarCargo(empresaId, nome) {
  const id = novoId('cargo')
  executar('INSERT INTO cargos (id, empresa_id, nome, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)',
    [id, empresaId, nome, ts, ts])
  return id
}

function criarUsuario(empresaId, nome, cpf, email, cargoId, acessaPainel, status = 'ativo') {
  const id = novoId('usuario')
  const { hash, salt } = gerarHashSenha(SENHA)
  const pendente = status === 'pendente'
  executar(
    `INSERT INTO usuarios (id, empresa_id, nome, cpf, email, telefone, cargo_id, acessa_painel,
                           status, senha_hash, senha_salt, deve_trocar_senha, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, '(31) 90000-0000', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, empresaId, nome, cpf, email, cargoId, acessaPainel ? 1 : 0, status,
     hash, salt, pendente ? 1 : 0, ts, ts])
  return id
}

function criarVeiculo(empresaId, placa, tipo = 'compacto_leve', km = 10000) {
  const id = novoId('veiculo')
  executar(
    `INSERT INTO veiculos (id, empresa_id, placa, modelo, tipo, km_atual, status, criado_em, atualizado_em)
     VALUES (?, ?, ?, 'Modelo Teste', ?, ?, 'disponivel', ?, ?)`,
    [id, empresaId, placa, tipo, km, ts, ts])
  return id
}

const ESTRUTURA = {
  perguntas: [
    { id: 'lataria', titulo: 'Lataria', foto_ok: 'opcional', max_fotos_ok: 2,
      opcoes_problema: [
        { id: 'risco', nome: 'Risco', foto: 'opcional', max_fotos: 2, abrir_ocorrencia: true, prioridade: 'baixa' },
      ] },
    { id: 'pneus', titulo: 'Pneus', foto_ok: 'opcional', max_fotos_ok: 2,
      opcoes_problema: [
        { id: 'liso', nome: 'Pneu liso', foto: 'opcional', max_fotos: 2, abrir_ocorrencia: true, prioridade: 'critica' },
      ] },
  ],
}

function criarChecklist(empresaId, codigo, tipo, cargos) {
  const id = novoId('template')
  executar(
    `INSERT INTO templates (id, empresa_id, codigo, nome, tipo_veiculo, cargos_liberados,
                            exige_assinatura, versao, status, estrutura, publicado_em, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, 0, 1, 'publicado', ?, ?, ?, ?)`,
    [id, empresaId, codigo, `Checklist ${codigo}`, tipo, JSON.stringify(cargos),
     JSON.stringify(ESTRUTURA), ts, ts, ts])
  return id
}

criarEmpresa(empresaA, 'Empresa A')
criarEmpresa(empresaB, 'Empresa B')

const cgFrotaA = criarCargo(empresaA, 'Equipe de frota')
const cgMotoristaA = criarCargo(empresaA, 'Motorista')
const cgVendasA = criarCargo(empresaA, 'Vendas')
const cgFrotaB = criarCargo(empresaB, 'Equipe de frota')

const frotaA = criarUsuario(empresaA, 'Frota A', '52998224725', 'frota.a@teste.local', cgFrotaA, true)
criarUsuario(empresaA, 'Motorista A', '11144477735', 'motorista.a@teste.local', cgMotoristaA, false)
criarUsuario(empresaA, 'Vendas A', '15350946056', 'vendas.a@teste.local', cgVendasA, false)
criarUsuario(empresaA, 'Pendente A', '39145281769', 'pendente.a@teste.local', cgMotoristaA, false, 'pendente')
criarUsuario(empresaA, 'Bloqueado A', '71428793860', 'bloq.a@teste.local', cgMotoristaA, false, 'bloqueado')
criarUsuario(empresaB, 'Frota B', '87748248800', 'frota.b@teste.local', cgFrotaB, true)

const veiculoA = criarVeiculo(empresaA, 'AAA1A11')
const veiculoA2 = criarVeiculo(empresaA, 'AAA2A22')
const veiculoB = criarVeiculo(empresaB, 'BBB1B11')

const veiculoA4 = criarVeiculo(empresaA, 'AAA4A44')

criarChecklist(empresaA, 'compacto', 'compacto_leve', ['*'])
criarChecklist(empresaA, 'so-motorista', 'pickup', [cgMotoristaA])
criarVeiculo(empresaA, 'AAA3A33', 'pickup')

// ----------------------------------------------------------------- apoio

const { servidor } = await import('../src/servidor.js')
let base = ''

before(async () => {
  if (!servidor.listening) await new Promise((r) => servidor.once('listening', r))
  base = `http://127.0.0.1:${servidor.address().port}`
})

after(() => {
  servidor.close()
  fecharBanco()
  for (const sufixo of ['', '-wal', '-shm']) {
    try { fs.rmSync(bancoTemp + sufixo) } catch { /* ja removido */ }
  }
})

async function chamar(metodo, caminho, { corpo, token } = {}) {
  const resposta = await fetch(base + caminho, {
    method: metodo,
    headers: {
      ...(corpo ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  return { status: resposta.status, dados: await resposta.json().catch(() => ({})) }
}

async function entrar(email, senha = SENHA) {
  const r = await chamar('POST', '/api/auth/login', { corpo: { email, senha } })
  return r.dados.token
}

const daquiAHoras = (h) => new Date(Date.now() + h * 3600000).toISOString()

// ------------------------------------------------------- criterio: login

test('login: usuario nao autorizado nao consegue entrar', async () => {
  const bloqueado = await chamar('POST', '/api/auth/login',
    { corpo: { email: 'bloq.a@teste.local', senha: SENHA } })
  assert.equal(bloqueado.status, 403)
  assert.equal(bloqueado.dados.erro, 'credencial_bloqueado')

  const senhaErrada = await chamar('POST', '/api/auth/login',
    { corpo: { email: 'frota.a@teste.local', senha: 'chute' } })
  assert.equal(senhaErrada.status, 401)
  // A mensagem nao revela se o email existe.
  assert.match(senhaErrada.dados.mensagem, /Email ou senha invalidos/)
})

test('login: sem token nenhuma rota de dados responde', async () => {
  for (const rota of ['/api/painel', '/api/usuarios', '/api/veiculos',
    '/api/preventivas', '/api/templates', '/api/solicitacoes', '/api/app/inicio']) {
    assert.equal((await chamar('GET', rota)).status, 401, `${rota} deveria exigir sessao`)
  }
})

// --------------------------------------------- criterio: primeiro acesso

test('primeiro acesso: a troca de senha e obrigatoria e so depois o usuario fica ativo', async () => {
  const token = await entrar('pendente.a@teste.local')
  assert.ok(token, 'usuario pendente precisa conseguir entrar para trocar a senha')

  const eu = await chamar('GET', '/api/auth/eu', { token })
  assert.equal(eu.dados.usuario.deve_trocar_senha, true)
  assert.equal(eu.dados.usuario.status, 'pendente')

  // Enquanto nao trocar, nao alcanca mais nada.
  const app = await chamar('GET', '/api/app/inicio', { token })
  assert.equal(app.status, 403)
  assert.equal(app.dados.erro, 'troca_de_senha_obrigatoria')

  const troca = await chamar('POST', '/api/auth/senha',
    { token, corpo: { senha_atual: SENHA, senha_nova: 'novaSenha99' } })
  assert.equal(troca.status, 200)
  assert.equal(troca.dados.usuario.status, 'ativo')
  assert.equal(troca.dados.usuario.deve_trocar_senha, false)

  // O token antigo caiu junto; o novo funciona.
  assert.equal((await chamar('GET', '/api/app/inicio', { token: troca.dados.token })).status, 200)
})

test('primeiro acesso: a nova senha precisa ser diferente da inicial', async () => {
  const token = await entrar('frota.a@teste.local')
  const r = await chamar('POST', '/api/auth/senha',
    { token, corpo: { senha_atual: SENHA, senha_nova: SENHA } })
  assert.equal(r.status, 400)
})

// ------------------------------------------------- criterio: multi-tenant

test('multi-tenant: uma empresa jamais acessa dados de outra', async () => {
  const token = await entrar('frota.a@teste.local')

  const lista = await chamar('GET', '/api/veiculos', { token })
  assert.ok(lista.dados.veiculos.every((v) => v.placa.startsWith('AAA')))

  assert.equal((await chamar('GET', `/api/veiculos/${veiculoB}`, { token })).status, 404)
  assert.equal((await chamar('POST', `/api/veiculos/${veiculoB}/status`,
    { token, corpo: { status: 'bloqueado', motivo: 'invasao' } })).status, 404)
})

// -------------------------------------------------- criterio: dois niveis

test('nivel: colaborador nao alcanca painel, usuarios nem cadastro de veiculo', async () => {
  const token = await entrar('motorista.a@teste.local')
  assert.equal((await chamar('GET', '/api/painel', { token })).status, 403)
  assert.equal((await chamar('GET', '/api/usuarios', { token })).status, 403)
  assert.equal((await chamar('GET', '/api/ocorrencias', { token })).status, 403)
  assert.equal((await chamar('GET', '/api/auditoria', { token })).status, 403)
  assert.equal((await chamar('POST', '/api/veiculos',
    { token, corpo: { placa: 'ZZZ9Z99', modelo: 'Pirata' } })).status, 403)
  // Mas ve a frota, que e o que ele precisa para pedir um carro.
  assert.equal((await chamar('GET', '/api/veiculos', { token })).status, 200)
})

test('nivel: a empresa nao pode ficar sem ninguem na frota', async () => {
  const token = await entrar('frota.a@teste.local')
  const eu = await chamar('GET', '/api/auth/eu', { token })
  const r = await chamar('POST', `/api/usuarios/${eu.dados.usuario.id}/status`,
    { token, corpo: { status: 'bloqueado' } })
  assert.equal(r.status, 409)
})

// ------------------------------------------------------ criterio: cadastro

test('cadastro: usuario nasce pendente com senha gerada pelo sistema', async () => {
  const token = await entrar('frota.a@teste.local')
  const r = await chamar('POST', '/api/usuarios', {
    token,
    corpo: {
      nome: 'Novo Colaborador', cpf: '604.829.173-69', email: 'novo@teste.local',
      telefone: '(31) 91234-5678', cargo_id: cgMotoristaA, acessa_painel: false,
    },
  })
  assert.equal(r.status, 200)
  assert.equal(r.dados.usuario.status, 'pendente')
  assert.equal(r.dados.usuario.deve_trocar_senha, 1)
  assert.equal(r.dados.usuario.cpf, '60482917369', 'a mascara do CPF deve ser removida')
  // A senha volta uma unica vez, para a Frota repassar.
  assert.ok(r.dados.senha_inicial && r.dados.senha_inicial.length >= 8)

  // E funciona de verdade.
  const entrou = await chamar('POST', '/api/auth/login',
    { corpo: { email: 'novo@teste.local', senha: r.dados.senha_inicial } })
  assert.equal(entrou.status, 200)
})

test('cadastro: CPF invalido e email repetido sao recusados', async () => {
  const token = await entrar('frota.a@teste.local')
  const base = { nome: 'Fulano Teste', telefone: '(31) 90000-0000', cargo_id: cgMotoristaA }

  const cpfRuim = await chamar('POST', '/api/usuarios',
    { token, corpo: { ...base, cpf: '11111111111', email: 'x1@teste.local' } })
  assert.equal(cpfRuim.status, 400)
  assert.match(cpfRuim.dados.mensagem, /CPF invalido/)

  const emailRepetido = await chamar('POST', '/api/usuarios',
    { token, corpo: { ...base, cpf: '19385724673', email: 'frota.a@teste.local' } })
  assert.ok([400, 409].includes(emailRepetido.status))
})

test('cadastro: cargo e obrigatorio e precisa existir na empresa', async () => {
  const token = await entrar('frota.a@teste.local')
  const base = {
    nome: 'Sem Cargo', cpf: '528.741.963-55', email: 'semcargo@teste.local',
    telefone: '(31) 90000-0000',
  }
  assert.equal((await chamar('POST', '/api/usuarios', { token, corpo: base })).status, 400)
  // Cargo da OUTRA empresa nao serve.
  const alheio = await chamar('POST', '/api/usuarios',
    { token, corpo: { ...base, cargo_id: cgFrotaB } })
  assert.equal(alheio.status, 404)
})

test('cargos: criar, listar e nao remover cargo em uso', async () => {
  const token = await entrar('frota.a@teste.local')
  const criado = await chamar('POST', '/api/cargos', { token, corpo: { nome: 'Estagiario' } })
  assert.equal(criado.status, 200)

  const repetido = await chamar('POST', '/api/cargos', { token, corpo: { nome: 'Estagiario' } })
  assert.equal(repetido.status, 409)

  const emUso = await chamar('DELETE', `/api/cargos/${cgMotoristaA}`, { token })
  assert.equal(emUso.status, 409)
  assert.match(emUso.dados.mensagem, /usam este cargo/)

  assert.equal((await chamar('DELETE', `/api/cargos/${criado.dados.cargo.id}`, { token })).status, 200)
})

// ---------------------------------------------------- criterio: dado mestre

test('veiculo: a placa identifica o ativo e nao muda', async () => {
  const token = await entrar('frota.a@teste.local')
  const r = await chamar('PATCH', `/api/veiculos/${veiculoA}`, { token, corpo: { placa: 'ZZZ9Z99' } })
  assert.equal(r.status, 409)
})

test('veiculo: o KM entra pela edicao e nao anda para tras sem justificativa', async () => {
  const token = await entrar('frota.a@teste.local')

  const sobe = await chamar('PATCH', `/api/veiculos/${veiculoA}`, { token, corpo: { km_atual: 20000 } })
  assert.equal(sobe.status, 200)
  assert.equal(sobe.dados.veiculo.km_atual, 20000)

  const desce = await chamar('PATCH', `/api/veiculos/${veiculoA}`, { token, corpo: { km_atual: 5 } })
  assert.equal(desce.status, 400)
  assert.match(desce.dados.mensagem, /menor que a atual/)

  const corrige = await chamar('PATCH', `/api/veiculos/${veiculoA}`,
    { token, corpo: { km_atual: 5, motivo_km: 'Hodometro trocado na oficina.' } })
  assert.equal(corrige.status, 200)
  assert.equal(corrige.dados.veiculo.km_atual, 5)

  // Volta ao valor util para os testes seguintes.
  await chamar('PATCH', `/api/veiculos/${veiculoA}`, { token, corpo: { km_atual: 20000 } })
})

// -------------------------------------------------- criterio: solicitacao

test('solicitacao: colaborador pede carro com janela e motivo; a frota aprova', async () => {
  const colaborador = await entrar('vendas.a@teste.local')
  const frota = await entrar('frota.a@teste.local')

  const pedido = await chamar('POST', '/api/solicitacoes', {
    token: colaborador,
    corpo: {
      veiculo_id: veiculoA, janela_inicio: daquiAHoras(48), janela_fim: daquiAHoras(53),
      motivo: 'Reuniao com cliente em outra cidade.',
    },
  })
  assert.equal(pedido.status, 200)
  assert.equal(pedido.dados.solicitacao.status, 'pendente')

  const id = pedido.dados.solicitacao.id
  // Colaborador nao aprova o proprio pedido.
  assert.equal((await chamar('POST', `/api/solicitacoes/${id}/aprovar`, { token: colaborador })).status, 403)

  const aprovada = await chamar('POST', `/api/solicitacoes/${id}/aprovar`, { token: frota })
  assert.equal(aprovada.status, 200)
  assert.equal(aprovada.dados.solicitacao.status, 'aprovada')
})

test('solicitacao: motivo curto e janela invertida sao recusados', async () => {
  const token = await entrar('vendas.a@teste.local')
  const base = { veiculo_id: veiculoA2, janela_inicio: daquiAHoras(100), janela_fim: daquiAHoras(105) }

  assert.equal((await chamar('POST', '/api/solicitacoes',
    { token, corpo: { ...base, motivo: 'urgente' } })).status, 400)
  assert.equal((await chamar('POST', '/api/solicitacoes',
    { token, corpo: { ...base, janela_fim: daquiAHoras(99), motivo: 'Motivo suficientemente longo.' } })).status, 400)
})

test('solicitacao: duas reservas do mesmo carro nao podem se sobrepor', async () => {
  const token = await entrar('vendas.a@teste.local')
  const primeira = await chamar('POST', '/api/solicitacoes', {
    token,
    corpo: { veiculo_id: veiculoA2, janela_inicio: daquiAHoras(200), janela_fim: daquiAHoras(210),
      motivo: 'Primeira reserva desta janela.' },
  })
  assert.equal(primeira.status, 200)

  const sobrepoe = await chamar('POST', '/api/solicitacoes', {
    token,
    corpo: { veiculo_id: veiculoA2, janela_inicio: daquiAHoras(205), janela_fim: daquiAHoras(215),
      motivo: 'Segunda reserva que invade a primeira.' },
  })
  assert.equal(sobrepoe.status, 409)
  assert.match(sobrepoe.dados.mensagem, /ja esta reservado/)

  // Encostada, sem invadir, passa.
  const encostada = await chamar('POST', '/api/solicitacoes', {
    token,
    corpo: { veiculo_id: veiculoA2, janela_inicio: daquiAHoras(210), janela_fim: daquiAHoras(220),
      motivo: 'Comeca exatamente quando a outra termina.' },
  })
  assert.equal(encostada.status, 200)
})

test('solicitacao: recusar exige motivo', async () => {
  const colaborador = await entrar('vendas.a@teste.local')
  const frota = await entrar('frota.a@teste.local')
  const { dados } = await chamar('POST', '/api/solicitacoes', {
    token: colaborador,
    corpo: { veiculo_id: veiculoA2, janela_inicio: daquiAHoras(400), janela_fim: daquiAHoras(404),
      motivo: 'Pedido que sera recusado no teste.' },
  })
  const id = dados.solicitacao.id

  assert.equal((await chamar('POST', `/api/solicitacoes/${id}/recusar`, { token: frota })).status, 400)
  const ok = await chamar('POST', `/api/solicitacoes/${id}/recusar`,
    { token: frota, corpo: { motivo: 'Veiculo reservado para manutencao nesse dia.' } })
  assert.equal(ok.dados.solicitacao.status, 'recusada')
})

test('solicitacao: cada solicitante enxerga apenas as proprias', async () => {
  const colaborador = await entrar('vendas.a@teste.local')
  const frota = await entrar('frota.a@teste.local')

  const dele = await chamar('GET', '/api/solicitacoes', { token: colaborador })
  const daFrota = await chamar('GET', '/api/solicitacoes', { token: frota })
  assert.equal(dele.dados.vejo_todas, false)
  assert.equal(daFrota.dados.vejo_todas, true)
  for (const s of dele.dados.solicitacoes) assert.equal(s.solicitante_nome, 'Vendas A')
  assert.ok(daFrota.dados.solicitacoes.length >= dele.dados.solicitacoes.length)
})

// ----------------------------------------------------- criterio: checklist

test('checklist: cargo nao liberado nao ve o modelo', async () => {
  // O modelo "so-motorista" e de pick-up e so libera o cargo Motorista.
  const frota = await entrar('frota.a@teste.local')
  const vendas = await entrar('vendas.a@teste.local')

  const pickup = (await chamar('GET', '/api/veiculos?tipo=pickup', { token: frota }))
    .dados.veiculos[0]

  const pedido = await chamar('POST', '/api/solicitacoes', {
    token: vendas,
    corpo: { veiculo_id: pickup.id, janela_inicio: daquiAHoras(500), janela_fim: daquiAHoras(505),
      motivo: 'Pedido de pick-up por quem nao e motorista.' },
  })
  await chamar('POST', `/api/solicitacoes/${pedido.dados.solicitacao.id}/aprovar`, { token: frota })

  const app = await chamar('GET', '/api/app/inicio', { token: vendas })
  const tarefa = app.dados.tarefas.find((t) => t.veiculo.id === pickup.id)
  assert.equal(tarefa, undefined, 'sem cargo liberado, o checklist nem aparece')
})

test('checklist: saida com ocorrencia critica bloqueia o veiculo', async () => {
  const frota = await entrar('frota.a@teste.local')
  const vendas = await entrar('vendas.a@teste.local')

  const app = await chamar('GET', '/api/app/inicio', { token: vendas })
  const tarefa = app.dados.tarefas.find((t) => t.momento === 'saida')
  assert.ok(tarefa, 'deveria haver uma saida aprovada')

  const envio = await chamar('POST', '/api/inspecoes', {
    token: vendas,
    corpo: {
      cliente_uuid: 'uuid-critica-0001', solicitacao_id: tarefa.solicitacao_id,
      template_id: tarefa.template_id, momento: 'saida', km_informado: 20500,
      respostas: {
        lataria: { desfecho: 'ok', fotos: 1 },
        pneus: { desfecho: 'ocorrencia', opcao_id: 'liso', fotos: 1 },
      },
    },
  })
  assert.equal(envio.status, 200)
  assert.equal(envio.dados.resumo.resultado, 'reprovado')
  assert.equal(envio.dados.resumo.estado_veiculo_previsto, 'bloqueado')

  const veiculo = await chamar('GET', `/api/veiculos/${tarefa.veiculo.id}`, { token: frota })
  assert.equal(veiculo.dados.veiculo.status, 'bloqueado')

  // A ocorrencia caiu na fila da Frota com a prioridade do modelo.
  const ocorrencias = await chamar('GET', '/api/ocorrencias?prioridade=critica', { token: frota })
  assert.ok(ocorrencias.dados.ocorrencias.some((o) => o.veiculo_id === tarefa.veiculo.id))
})

test('checklist: reenvio da fila offline nao duplica', async () => {
  const vendas = await entrar('vendas.a@teste.local')
  const app = await chamar('GET', '/api/app/inicio', { token: vendas })
  const tarefa = app.dados.tarefas.find((t) => t.momento === 'retorno')
  assert.ok(tarefa, 'depois da saida a tarefa vira retorno')

  const corpo = {
    cliente_uuid: 'uuid-retorno-0001', solicitacao_id: tarefa.solicitacao_id,
    template_id: tarefa.template_id, momento: 'retorno',
    respostas: { lataria: { desfecho: 'ok' }, pneus: { desfecho: 'ok' } },
  }
  const primeiro = await chamar('POST', '/api/inspecoes', { token: vendas, corpo })
  assert.equal(primeiro.status, 200)
  assert.ok(!primeiro.dados.repetida)

  const segundo = await chamar('POST', '/api/inspecoes', { token: vendas, corpo })
  assert.equal(segundo.dados.repetida, true)
  assert.equal(segundo.dados.inspecao.id, primeiro.dados.inspecao.id)
})

test('checklist: o servidor recusa inspecao incompleta', async () => {
  const frota = await entrar('frota.a@teste.local')
  const motorista = await entrar('motorista.a@teste.local')

  const pedido = await chamar('POST', '/api/solicitacoes', {
    token: motorista,
    corpo: { veiculo_id: veiculoA2, janela_inicio: daquiAHoras(600), janela_fim: daquiAHoras(605),
      motivo: 'Pedido para testar checklist incompleto.' },
  })
  await chamar('POST', `/api/solicitacoes/${pedido.dados.solicitacao.id}/aprovar`, { token: frota })

  const app = await chamar('GET', '/api/app/inicio', { token: motorista })
  const tarefa = app.dados.tarefas.find((t) => t.veiculo.id === veiculoA2)

  const r = await chamar('POST', '/api/inspecoes', {
    token: motorista,
    corpo: {
      cliente_uuid: 'uuid-incompleto-0001', solicitacao_id: tarefa.solicitacao_id,
      template_id: tarefa.template_id, momento: 'saida',
      respostas: { lataria: { desfecho: 'ok' } },   // falta "pneus"
    },
  })
  assert.equal(r.status, 400)
  assert.match(r.dados.mensagem, /incompleto/)
})

test('checklist: o momento errado e recusado', async () => {
  const motorista = await entrar('motorista.a@teste.local')
  const app = await chamar('GET', '/api/app/inicio', { token: motorista })
  const tarefa = app.dados.tarefas[0]

  const r = await chamar('POST', '/api/inspecoes', {
    token: motorista,
    corpo: {
      cliente_uuid: 'uuid-momento-errado', solicitacao_id: tarefa.solicitacao_id,
      template_id: tarefa.template_id, momento: 'retorno',
      respostas: { lataria: { desfecho: 'ok' }, pneus: { desfecho: 'ok' } },
    },
  })
  assert.equal(r.status, 409)
  assert.match(r.dados.mensagem, /espera o checklist de saida/)
})

// ------------------------------------------------------ criterio: atraso

test('devolucao: fora do prazo exige motivo escrito antes de encerrar', async () => {
  const frota = await entrar('frota.a@teste.local')
  const motorista = await entrar('motorista.a@teste.local')

  // Janela que ja terminou: inserida direto, porque a API recusaria o pedido.
  const id = novoId('solicitacao')
  const numero = (consultarUm('SELECT MAX(numero) AS m FROM solicitacoes WHERE empresa_id = ?',
    [empresaA])?.m ?? 0) + 1
  const usuario = consultarUm('SELECT id FROM usuarios WHERE email = ?', ['motorista.a@teste.local'])
  executar(
    `INSERT INTO solicitacoes (id, empresa_id, numero, solicitante_id, veiculo_id,
                               janela_inicio, janela_fim, motivo, status, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Visita tecnica que passou do horario.', 'em_uso', ?, ?)`,
    [id, empresaA, numero, usuario.id, veiculoA,
     new Date(Date.now() - 8 * 3600000).toISOString(),
     new Date(Date.now() - 2 * 3600000).toISOString(), ts, ts])

  const aviso = await chamar('GET', `/api/solicitacoes/${id}/devolucao`, { token: motorista })
  assert.equal(aviso.dados.atrasada, true)
  assert.equal(aviso.dados.exige_motivo, true)
  assert.match(aviso.dados.mensagem, /passou do prazo de retorno/)

  const sem = await chamar('POST', `/api/solicitacoes/${id}/devolver`, { token: motorista, corpo: {} })
  assert.equal(sem.status, 400)

  const com = await chamar('POST', `/api/solicitacoes/${id}/devolver`, {
    token: motorista,
    corpo: { motivo_atraso: 'A base estava fechada e tive que levar o carro para casa.' },
  })
  assert.equal(com.dados.solicitacao.status, 'devolvida_com_atraso')
  assert.match(com.dados.solicitacao.motivo_atraso, /base estava fechada/)

  // E o atraso aparece no historico do colaborador.
  const historico = await chamar('GET', `/api/usuarios/${usuario.id}/historico`, { token: frota })
  assert.ok(historico.dados.solicitacoes.some((s) => s.status === 'devolvida_com_atraso'))
})

// -------------------------------------------------- criterio: historico

test('historico: mostra o que a pessoa fez e o que fizeram sobre ela', async () => {
  const frota = await entrar('frota.a@teste.local')
  const alvo = consultarUm('SELECT id FROM usuarios WHERE email = ?', ['vendas.a@teste.local'])

  await chamar('POST', `/api/usuarios/${alvo.id}/status`,
    { token: frota, corpo: { status: 'suspenso', motivo: 'Teste de historico.' } })

  const r = await chamar('GET', `/api/usuarios/${alvo.id}/historico`, { token: frota })
  assert.equal(r.status, 200)

  const acoes = r.dados.eventos.map((e) => e.acao)
  assert.ok(acoes.includes('credencial.suspenso'), 'falta o que a Frota fez sobre ele')
  assert.ok(acoes.includes('solicitacao.aberta'), 'falta o que ele mesmo fez')
  assert.ok(r.dados.inspecoes.length >= 1, 'faltam os checklists executados')

  const suspensao = r.dados.eventos.find((e) => e.acao === 'credencial.suspenso')
  assert.equal(suspensao.feito_por_ele, false)

  // Devolve ao estado anterior para nao contaminar outros testes.
  await chamar('POST', `/api/usuarios/${alvo.id}/status`, { token: frota, corpo: { status: 'ativo' } })
})

test('historico: o colaborador ve o proprio, mas nao o dos outros', async () => {
  const motorista = await entrar('motorista.a@teste.local')
  const eu = await chamar('GET', '/api/auth/eu', { token: motorista })
  const outro = consultarUm('SELECT id FROM usuarios WHERE email = ?', ['vendas.a@teste.local'])

  assert.equal((await chamar('GET', `/api/usuarios/${eu.dados.usuario.id}/historico`,
    { token: motorista })).status, 200)
  assert.equal((await chamar('GET', `/api/usuarios/${outro.id}/historico`,
    { token: motorista })).status, 403)
})

// -------------------------------------------------- criterio: auditoria

test('auditoria: alteracoes criticas deixam rastro de quem, quando e o que mudou', async () => {
  const { consultar } = await import('../src/nucleo/banco.js')
  const eventos = consultar(
    `SELECT acao, ator_id, ator_nome, alvo_id, criado_em FROM eventos_auditoria
      WHERE empresa_id = ? ORDER BY criado_em`, [empresaA])

  const acoes = new Set(eventos.map((e) => e.acao))
  for (const esperada of ['usuario.criado', 'cargo.criado', 'veiculo.km_atualizado',
    'solicitacao.aberta', 'solicitacao.aprovada', 'checklist.saida',
    'solicitacao.devolvida_com_atraso', 'primeiro_acesso']) {
    assert.ok(acoes.has(esperada), `faltou registrar "${esperada}"`)
  }

  const criacao = eventos.find((e) => e.acao === 'usuario.criado')
  assert.equal(criacao.ator_id, frotaA)
  assert.ok(criacao.alvo_id, 'evento sobre um usuario precisa dizer sobre quem foi')

  // Nenhum evento pode carregar segredo de senha.
  const bruto = JSON.stringify(eventos)
  assert.ok(!bruto.includes('senha_hash'))
  assert.ok(!bruto.includes('senha_salt'))
})

test('auditoria: a senha gerada nunca vai parar no historico', async () => {
  const { consultar } = await import('../src/nucleo/banco.js')
  const token = await entrar('frota.a@teste.local')
  const r = await chamar('POST', '/api/usuarios', {
    token,
    corpo: {
      nome: 'Auditoria Senha', cpf: '872.461.935-37', email: 'auditoria.senha@teste.local',
      telefone: '(31) 90000-0000', cargo_id: cgMotoristaA,
    },
  })
  assert.equal(r.status, 200)
  const senha = r.dados.senha_inicial

  const tudo = JSON.stringify(consultar(
    'SELECT antes, depois FROM eventos_auditoria WHERE empresa_id = ?', [empresaA]))
  assert.ok(!tudo.includes(senha), 'a senha inicial vazou para a auditoria')
})

// --------------------------------------- criterio: estado do veiculo

// Reserva, aprova e devolve as duas tarefas (saida e retorno) do veiculo.
async function reservar(tokenFrota, tokenPessoa, veiculoId, offsetHoras) {
  const pedido = await chamar('POST', '/api/solicitacoes', {
    token: tokenPessoa,
    corpo: {
      veiculo_id: veiculoId,
      janela_inicio: daquiAHoras(offsetHoras),
      janela_fim: daquiAHoras(offsetHoras + 4),
      motivo: 'Pedido para exercitar o estado do veiculo.',
    },
  })
  assert.equal(pedido.status, 200, JSON.stringify(pedido.dados))
  await chamar('POST', `/api/solicitacoes/${pedido.dados.solicitacao.id}/aprovar`, { token: tokenFrota })
  return pedido.dados.solicitacao.id
}

test('estado: um checklist aperta a restricao do veiculo, nunca afrouxa', async () => {
  const frota = await entrar('frota.a@teste.local')
  const motorista = await entrar('motorista.a@teste.local')
  const solicitacao = await reservar(frota, motorista, veiculoA4, 700)

  const app = await chamar('GET', '/api/app/inicio', { token: motorista })
  const tarefa = app.dados.tarefas.find((t) => t.solicitacao_id === solicitacao)

  // Saida com pneu liso: critica, bloqueia.
  const saida = await chamar('POST', '/api/inspecoes', {
    token: motorista,
    corpo: {
      cliente_uuid: 'uuid-aperta-saida', solicitacao_id: solicitacao,
      template_id: tarefa.template_id, momento: 'saida',
      respostas: {
        lataria: { desfecho: 'ok', fotos: 1 },
        pneus: { desfecho: 'ocorrencia', opcao_id: 'liso', fotos: 1 },
      },
    },
  })
  assert.equal(saida.dados.resumo.estado_veiculo_previsto, 'bloqueado')
  let veiculo = await chamar('GET', `/api/veiculos/${veiculoA4}`, { token: frota })
  assert.equal(veiculo.dados.veiculo.status, 'bloqueado')

  // Retorno com problema de prioridade baixa. O julgamento isolado diria
  // "disponivel", mas o carro esta bloqueado: o checklist nao pode libera-lo.
  const retorno = await chamar('POST', '/api/inspecoes', {
    token: motorista,
    corpo: {
      cliente_uuid: 'uuid-aperta-retorno', solicitacao_id: solicitacao,
      template_id: tarefa.template_id, momento: 'retorno',
      respostas: {
        lataria: { desfecho: 'ocorrencia', opcao_id: 'risco', fotos: 1 },
        pneus: { desfecho: 'ok', fotos: 1 },
      },
    },
  })
  assert.equal(retorno.status, 200, JSON.stringify(retorno.dados))

  veiculo = await chamar('GET', `/api/veiculos/${veiculoA4}`, { token: frota })
  assert.equal(veiculo.dados.veiculo.status, 'bloqueado',
    'so a Frota libera veiculo bloqueado, com motivo')
})

test('estado: liberar veiculo bloqueado exige motivo e vai para a auditoria', async () => {
  const frota = await entrar('frota.a@teste.local')

  const semMotivo = await chamar('POST', `/api/veiculos/${veiculoA4}/status`, {
    token: frota, corpo: { status: 'disponivel' },
  })
  assert.equal(semMotivo.status, 400)
  assert.match(semMotivo.dados.mensagem, /motivo/i)

  const comMotivo = await chamar('POST', `/api/veiculos/${veiculoA4}/status`, {
    token: frota,
    corpo: { status: 'disponivel', motivo: 'Pneus trocados; laudo do mecanico anexado.' },
  })
  assert.equal(comMotivo.status, 200)
  assert.equal(comMotivo.dados.veiculo.status, 'disponivel')

  const auditoria = await chamar('GET', '/api/auditoria?busca=Pneus trocados', { token: frota })
  assert.ok(auditoria.dados.eventos.some((e) => e.acao === 'veiculo.status.disponivel'))
})

test('estado: fechada a ultima ocorrencia, a pendencia sai sozinha', async () => {
  const frota = await entrar('frota.a@teste.local')
  const motorista = await entrar('motorista.a@teste.local')
  const solicitacao = await reservar(frota, motorista, veiculoA4, 800)

  const app = await chamar('GET', '/api/app/inicio', { token: motorista })
  const tarefa = app.dados.tarefas.find((t) => t.solicitacao_id === solicitacao)

  // Duas ocorrencias na mesma saida, nenhuma critica.
  await chamar('POST', '/api/inspecoes', {
    token: motorista,
    corpo: {
      cliente_uuid: 'uuid-pendencia-saida', solicitacao_id: solicitacao,
      template_id: tarefa.template_id, momento: 'saida',
      respostas: {
        lataria: { desfecho: 'ocorrencia', opcao_id: 'risco', fotos: 1 },
        pneus: { desfecho: 'ok', fotos: 1 },
      },
    },
  })

  // Prioridade baixa sozinha nao tira o carro de circulacao (roadmap 12.2).
  let veiculo = await chamar('GET', `/api/veiculos/${veiculoA4}`, { token: frota })
  assert.equal(veiculo.dados.veiculo.status, 'disponivel')

  // Agora uma de prioridade alta, que de fato deixa com pendencia.
  await chamar('POST', `/api/veiculos/${veiculoA4}/status`, {
    token: frota, corpo: { status: 'com_pendencia', motivo: 'Aguardando funilaria.' },
  })

  const fila = await chamar('GET', `/api/ocorrencias?veiculo_id=${veiculoA4}`, { token: frota })
  const abertas = fila.dados.ocorrencias
  assert.ok(abertas.length > 0)

  // A cadeia da secao 12.3 nao tem atalho: aberta -> em tratamento -> resolvida.
  async function resolver(ocorrencia, resolucao) {
    const emTratamento = await chamar('POST', `/api/ocorrencias/${ocorrencia.id}/status`, {
      token: frota, corpo: { status: 'em_tratamento' },
    })
    assert.equal(emTratamento.status, 200, JSON.stringify(emTratamento.dados))
    const resolvida = await chamar('POST', `/api/ocorrencias/${ocorrencia.id}/status`, {
      token: frota, corpo: { status: 'resolvida', resolucao },
    })
    assert.equal(resolvida.status, 200, JSON.stringify(resolvida.dados))
  }

  // Fecha todas menos a ultima: o carro segue com pendencia.
  for (const o of abertas.slice(0, -1)) await resolver(o, 'Polida.')
  veiculo = await chamar('GET', `/api/veiculos/${veiculoA4}`, { token: frota })
  assert.equal(veiculo.dados.veiculo.status, 'com_pendencia')

  await resolver(abertas[abertas.length - 1], 'Reparo concluido.')

  veiculo = await chamar('GET', `/api/veiculos/${veiculoA4}`, { token: frota })
  assert.equal(veiculo.dados.veiculo.status, 'disponivel',
    'sem ocorrencia aberta, a pendencia deixa de existir')
})
