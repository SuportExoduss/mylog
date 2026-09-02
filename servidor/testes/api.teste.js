// Testes de ponta a ponta contra o servidor HTTP real.
// Cobrem os criterios de aceite da secao 34 do roadmap — os que ja tem
// implementacao. Cada teste fala a lingua do criterio, nao a do codigo.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const bancoTemp = path.join(os.tmpdir(), `mylog-api-${Date.now()}.db`)
process.env.MYLOG_BANCO = bancoTemp
process.env.MYLOG_PORTA = '0'   // porta livre escolhida pelo sistema

const { abrirBanco, executar, novoId, agora, fecharBanco } = await import('../src/nucleo/banco.js')
const { gerarHashSenha } = await import('../src/seguranca/senha.js')

abrirBanco()

// ---------------------------------------------------------------- cenario

const ts = agora()
const empresaA = novoId('empresa')
const empresaB = novoId('empresa')

function criarEmpresa(id, nome, politicas = {}) {
  executar(
    `INSERT INTO empresas (id, nome, status, politicas, criado_em, atualizado_em)
     VALUES (?, ?, 'ativa', ?, ?, ?)`,
    [id, nome, JSON.stringify(politicas), ts, ts])
}

function criarUsuario(empresaId, nome, email, papel, status) {
  const id = novoId('usuario')
  const { hash, salt } = gerarHashSenha('mylog123')
  executar(
    `INSERT INTO usuarios (id, empresa_id, nome, email, papel, status, senha_hash, senha_salt,
                           senha_definida, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [id, empresaId, nome, email, papel, status, hash, salt, ts, ts])
  return id
}

function criarVeiculo(empresaId, placa, modelo, km = 10000) {
  const id = novoId('veiculo')
  executar(
    `INSERT INTO veiculos (id, empresa_id, placa, modelo, tipo, km_atual, status, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, 'carro', ?, 'disponivel', ?, ?)`,
    [id, empresaId, placa, modelo, km, ts, ts])
  return id
}

criarEmpresa(empresaA, 'Empresa A')
criarEmpresa(empresaB, 'Empresa B')

const admA = criarUsuario(empresaA, 'Adm A', 'adm.a@teste.local', 'adm', 'ativo')
criarUsuario(empresaA, 'Colaborador A', 'colab.a@teste.local', 'colaborador', 'ativo')
criarUsuario(empresaA, 'Pendente A', 'pendente.a@teste.local', 'colaborador', 'pendente')
criarUsuario(empresaA, 'Bloqueado A', 'bloq.a@teste.local', 'colaborador', 'bloqueado')
criarUsuario(empresaB, 'Adm B', 'adm.b@teste.local', 'adm', 'ativo')

const veiculoA = criarVeiculo(empresaA, 'AAA1A11', 'Carro da A')
const veiculoB = criarVeiculo(empresaB, 'BBB1B11', 'Carro da B')

// ----------------------------------------------------------------- apoio

const { servidor } = await import('../src/servidor.js')
let base = ''

before(async () => {
  if (!servidor.listening) {
    await new Promise((resolve) => servidor.once('listening', resolve))
  }
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

async function entrar(email) {
  const r = await chamar('POST', '/api/auth/login', { corpo: { email, senha: 'mylog123' } })
  return r.dados.token
}

// ------------------------------------------------- criterio: login (sec. 34)

test('login: usuario nao autorizado nao consegue entrar', async () => {
  const pendente = await chamar('POST', '/api/auth/login',
    { corpo: { email: 'pendente.a@teste.local', senha: 'mylog123' } })
  assert.equal(pendente.status, 403)
  assert.equal(pendente.dados.erro, 'credencial_pendente')

  const bloqueado = await chamar('POST', '/api/auth/login',
    { corpo: { email: 'bloq.a@teste.local', senha: 'mylog123' } })
  assert.equal(bloqueado.status, 403)
  assert.equal(bloqueado.dados.erro, 'credencial_bloqueado')

  const senhaErrada = await chamar('POST', '/api/auth/login',
    { corpo: { email: 'adm.a@teste.local', senha: 'chute' } })
  assert.equal(senhaErrada.status, 401)
  // A mensagem nao revela se o email existe.
  assert.match(senhaErrada.dados.mensagem, /Email ou senha invalidos/)
})

test('login: sem token nenhuma rota de dados responde', async () => {
  for (const rota of ['/api/painel', '/api/usuarios', '/api/veiculos', '/api/preventivas', '/api/templates']) {
    const r = await chamar('GET', rota)
    assert.equal(r.status, 401, `${rota} deveria exigir sessao`)
  }
})

test('login: token inventado nao vale', async () => {
  const r = await chamar('GET', '/api/painel', { token: 'token-falso-qualquer' })
  assert.equal(r.status, 401)
})

// ------------------------------------------ criterio: multi-tenant (sec. 34)

test('multi-tenant: uma empresa jamais acessa dados de outra', async () => {
  const tokenA = await entrar('adm.a@teste.local')

  const lista = await chamar('GET', '/api/veiculos', { token: tokenA })
  assert.deepEqual(lista.dados.veiculos.map((v) => v.placa), ['AAA1A11'])

  // Mesmo sabendo o id exato do veiculo da outra empresa.
  const alheio = await chamar('GET', `/api/veiculos/${veiculoB}`, { token: tokenA })
  assert.equal(alheio.status, 404)

  const escrita = await chamar('POST', `/api/veiculos/${veiculoB}/status`,
    { token: tokenA, corpo: { status: 'bloqueado', motivo: 'invasao' } })
  assert.equal(escrita.status, 404)
})

test('multi-tenant: o painel de cada empresa conta so a propria frota', async () => {
  const tokenA = await entrar('adm.a@teste.local')
  const tokenB = await entrar('adm.b@teste.local')
  const painelA = await chamar('GET', '/api/painel', { token: tokenA })
  const painelB = await chamar('GET', '/api/painel', { token: tokenB })
  assert.equal(painelA.dados.frota.total, 1)
  assert.equal(painelB.dados.frota.total, 1)
})

// ------------------------------------------------------ criterio: permissoes

test('permissoes: o colaborador nao alcanca cadastro mestre nem painel', async () => {
  const token = await entrar('colab.a@teste.local')
  assert.equal((await chamar('GET', '/api/painel', { token })).status, 403)
  assert.equal((await chamar('GET', '/api/usuarios', { token })).status, 403)
  assert.equal((await chamar('POST', '/api/veiculos',
    { token, corpo: { placa: 'ZZZ9Z99', modelo: 'Pirata' } })).status, 403)
  // Mas consegue procurar veiculo por placa/modelo, que e' o que o ticket exige.
  const busca = await chamar('GET', '/api/veiculos/busca?termo=aaa', { token })
  assert.equal(busca.status, 200)
  assert.equal(busca.dados.veiculos.length, 1)
})

// -------------------------------------------- criterio: credencial e sessao

test('credencial: bloquear derruba a sessao aberta na hora', async () => {
  const tokenAdm = await entrar('adm.a@teste.local')
  const criado = await chamar('POST', '/api/usuarios', {
    token: tokenAdm,
    corpo: { nome: 'Teste Sessao', email: 'sessao@teste.local', papel: 'supervisor', senha: 'mylog123' },
  })
  assert.equal(criado.status, 200)
  const alvo = criado.dados.usuario.id
  assert.equal(criado.dados.usuario.status, 'pendente', 'cadastro deve nascer pendente')

  // Ainda pendente: nao entra.
  assert.equal((await chamar('POST', '/api/auth/login',
    { corpo: { email: 'sessao@teste.local', senha: 'mylog123' } })).status, 403)

  await chamar('POST', `/api/usuarios/${alvo}/status`, { token: tokenAdm, corpo: { status: 'ativo' } })
  const tokenAlvo = await entrar('sessao@teste.local')
  assert.equal((await chamar('GET', '/api/auth/eu', { token: tokenAlvo })).status, 200)

  await chamar('POST', `/api/usuarios/${alvo}/status`,
    { token: tokenAdm, corpo: { status: 'bloqueado', motivo: 'teste' } })
  assert.equal((await chamar('GET', '/api/auth/eu', { token: tokenAlvo })).status, 401,
    'a sessao precisa cair sem esperar expirar')
})

test('credencial: a empresa nao pode ficar sem administrador ativo', async () => {
  const token = await entrar('adm.a@teste.local')
  const eu = await chamar('GET', '/api/auth/eu', { token })
  const r = await chamar('POST', `/api/usuarios/${eu.dados.usuario.id}/status`,
    { token, corpo: { status: 'bloqueado' } })
  assert.equal(r.status, 409)
})

// ----------------------------------------------- criterio: dado mestre

test('veiculo: a placa identifica o ativo e nao muda', async () => {
  const token = await entrar('adm.a@teste.local')
  const r = await chamar('PATCH', `/api/veiculos/${veiculoA}`, { token, corpo: { placa: 'ZZZ9Z99' } })
  assert.equal(r.status, 409)
})

test('veiculo: hodometro so anda para tras com justificativa', async () => {
  const token = await entrar('adm.a@teste.local')
  const semMotivo = await chamar('POST', `/api/veiculos/${veiculoA}/km`, { token, corpo: { km_atual: 5 } })
  assert.equal(semMotivo.status, 400)

  const comMotivo = await chamar('POST', `/api/veiculos/${veiculoA}/km`,
    { token, corpo: { km_atual: 5, motivo: 'Hodometro trocado na oficina.' } })
  assert.equal(comMotivo.status, 200)
  assert.equal(comMotivo.dados.veiculo.km_atual, 5)
})

// ---------------------------------------- criterio: preventiva (sec. 19 e 34)

test('preventiva: concluir exige definir a proxima, e ela pode mudar de metodo', async () => {
  const token = await entrar('adm.a@teste.local')
  await chamar('POST', `/api/veiculos/${veiculoA}/km`,
    { token, corpo: { km_atual: 40000, motivo: 'leitura correta' } })

  const criada = await chamar('POST', '/api/preventivas', {
    token, corpo: { veiculo_id: veiculoA, modo: 'km', proximo_km: 50000, alerta_antes_km: 1000 },
  })
  assert.equal(criada.status, 200)
  assert.equal(criada.dados.preventiva.status, 'em_dia')

  const concluida = await chamar('POST', `/api/preventivas/${criada.dados.preventiva.id}/concluir`, {
    token,
    corpo: {
      servico: 'Revisao dos 50 mil', km_realizado: 50100,
      proximo_modo: 'data', proxima_data: '2027-01-10', alerta_antes_dias: 10,
    },
  })
  assert.equal(concluida.status, 200)
  assert.equal(concluida.dados.concluida.status, 'realizada')
  assert.equal(concluida.dados.proxima.modo, 'data')
  assert.equal(concluida.dados.proxima.proxima_data, '2027-01-10')

  // A execucao tambem e' leitura de hodometro.
  const veiculo = await chamar('GET', `/api/veiculos/${veiculoA}`, { token })
  assert.equal(veiculo.dados.veiculo.km_atual, 50100)
})

test('preventiva: KM-alvo anterior ao hodometro atual e recusado', async () => {
  const token = await entrar('adm.b@teste.local')
  const r = await chamar('POST', '/api/preventivas', {
    token, corpo: { veiculo_id: veiculoB, modo: 'km', proximo_km: 1 },
  })
  assert.equal(r.status, 400)
  assert.match(r.dados.mensagem, /maior que a quilometragem atual/)
})

// -------------------------------------------------- criterio: template

test('template: versao publicada e imutavel; editar cria a versao seguinte', async () => {
  const token = await entrar('adm.a@teste.local')
  const estrutura = { secoes: [{ id: 'geral', titulo: 'Geral', itens: [
    { id: 'farois', rotulo: 'Farois funcionando', tipo: 'ok_nok', criticidade: 'alto' },
  ] }] }

  const criado = await chamar('POST', '/api/templates',
    { token, corpo: { codigo: 'diario', nome: 'Checklist diario', estrutura } })
  assert.equal(criado.status, 200)
  const id = criado.dados.template.id

  const publicado = await chamar('POST', `/api/templates/${id}/publicar`, { token })
  assert.equal(publicado.status, 200)
  assert.equal(publicado.dados.template.status, 'publicado')

  const tentativa = await chamar('PUT', `/api/templates/${id}`, { token, corpo: { nome: 'Outro nome' } })
  assert.equal(tentativa.status, 409)

  const v2 = await chamar('POST', `/api/templates/${id}/versao`, { token })
  assert.equal(v2.dados.template.versao, 2)
  assert.equal(v2.dados.template.status, 'rascunho')

  // Publicar a v2 arquiva a v1: so uma versao vale por vez.
  await chamar('POST', `/api/templates/${v2.dados.template.id}/publicar`, { token })
  const antiga = await chamar('GET', `/api/templates/${id}`, { token })
  assert.equal(antiga.dados.template.status, 'arquivado')
})

test('template: estrutura incompleta nao publica', async () => {
  const token = await entrar('adm.a@teste.local')
  const criado = await chamar('POST', '/api/templates', {
    token,
    corpo: { codigo: 'vazio', nome: 'Template vazio', estrutura: { secoes: [{ id: 'so', titulo: 'So titulo', itens: [] }] } },
  })
  const r = await chamar('POST', `/api/templates/${criado.dados.template.id}/publicar`, { token })
  assert.equal(r.status, 400)
  assert.match(r.dados.mensagem, /sem nenhum item/)
})

// --------------------------------------------- criterio: ticket (sec. 16 e 34)

test('ticket: colaborador sem veiculo proprio consegue abrir uma solicitacao', async () => {
  const token = await entrar('colab.a@teste.local')
  const r = await chamar('POST', '/api/tickets', {
    token,
    corpo: { categoria: 'solicitacao', prioridade: 'normal',
             descricao: 'Preciso de um veiculo para a entrega de quinta.' },
  })
  assert.equal(r.status, 200)
  assert.equal(r.dados.ticket.status, 'aberto')
  assert.equal(r.dados.ticket.veiculo_id, null)
  assert.ok(r.dados.ticket.numero >= 1)
})

test('ticket: categoria sobre o ativo exige dizer qual veiculo', async () => {
  const token = await entrar('colab.a@teste.local')
  const semVeiculo = await chamar('POST', '/api/tickets', {
    token, corpo: { categoria: 'dano', descricao: 'Arranhao novo na lateral direita.' },
  })
  assert.equal(semVeiculo.status, 400)

  const comVeiculo = await chamar('POST', '/api/tickets', {
    token, corpo: { categoria: 'dano', veiculo_id: veiculoA, descricao: 'Arranhao novo na lateral direita.' },
  })
  assert.equal(comVeiculo.status, 200)
  assert.equal(comVeiculo.dados.ticket.placa, 'AAA1A11')
})

test('ticket: o solicitante escolhe o veiculo mas nao altera dado mestre', async () => {
  const token = await entrar('colab.a@teste.local')
  // Vinculo do ticket com o ativo: permitido.
  const abertura = await chamar('POST', '/api/tickets', {
    token, corpo: { categoria: 'limpeza', veiculo_id: veiculoA, descricao: 'Veiculo entregue sujo hoje.' },
  })
  assert.equal(abertura.status, 200)
  // Tocar no cadastro do mesmo veiculo: recusado (secao 16).
  const escrita = await chamar('PATCH', `/api/veiculos/${veiculoA}`, { token, corpo: { modelo: 'Outro' } })
  assert.equal(escrita.status, 403)
})

test('ticket: cada solicitante enxerga apenas os proprios', async () => {
  const tokenColab = await entrar('colab.a@teste.local')
  const tokenAdm = await entrar('adm.a@teste.local')

  const doColab = await chamar('GET', '/api/tickets', { token: tokenColab })
  const doAdm = await chamar('GET', '/api/tickets', { token: tokenAdm })
  assert.equal(doColab.dados.vejo_todos, false)
  assert.equal(doAdm.dados.vejo_todos, true)
  assert.ok(doAdm.dados.tickets.length >= doColab.dados.tickets.length)
  for (const t of doColab.dados.tickets) assert.equal(t.solicitante_nome, 'Colaborador A')
})

test('ticket: nao se marca como resolvido sem dizer o que foi feito', async () => {
  const tokenColab = await entrar('colab.a@teste.local')
  const tokenAdm = await entrar('adm.a@teste.local')
  const { dados } = await chamar('POST', '/api/tickets', {
    token: tokenColab,
    corpo: { categoria: 'problema', veiculo_id: veiculoA, descricao: 'Ar-condicionado nao gela.' },
  })
  const id = dados.ticket.id

  const semSolucao = await chamar('POST', `/api/tickets/${id}/status`,
    { token: tokenAdm, corpo: { status: 'resolvido' } })
  assert.equal(semSolucao.status, 400)

  const comSolucao = await chamar('POST', `/api/tickets/${id}/status`,
    { token: tokenAdm, corpo: { status: 'resolvido', resolucao: 'Recarga de gas e troca do filtro.' } })
  assert.equal(comSolucao.status, 200)

  // "fechado" e terminal: nao volta.
  await chamar('POST', `/api/tickets/${id}/status`, { token: tokenAdm, corpo: { status: 'fechado' } })
  const reabrir = await chamar('POST', `/api/tickets/${id}/status`,
    { token: tokenAdm, corpo: { status: 'em_andamento' } })
  assert.equal(reabrir.status, 409)
})

test('ticket: responsavel precisa ser alguem que trata tickets', async () => {
  const tokenAdm = await entrar('adm.a@teste.local')
  const lista = await chamar('GET', '/api/tickets', { token: tokenAdm })
  const alvo = lista.dados.tickets.find((t) => t.status === 'aberto')

  const usuarios = await chamar('GET', '/api/usuarios', { token: tokenAdm })
  const colaborador = usuarios.dados.usuarios.find((u) => u.papel === 'colaborador' && u.status === 'ativo')

  const recusa = await chamar('POST', `/api/tickets/${alvo.id}/atribuir`,
    { token: tokenAdm, corpo: { responsavel_id: colaborador.id } })
  assert.equal(recusa.status, 400)
  assert.match(recusa.dados.mensagem, /nao trata tickets/)

  const eu = await chamar('GET', '/api/auth/eu', { token: tokenAdm })
  const aceita = await chamar('POST', `/api/tickets/${alvo.id}/atribuir`,
    { token: tokenAdm, corpo: { responsavel_id: eu.dados.usuario.id } })
  assert.equal(aceita.status, 200)
  assert.equal(aceita.dados.ticket.status, 'atribuido')
})

// -------------------------------------------------- criterio: auditoria

test('auditoria: alteracoes criticas deixam rastro de quem, quando e o que mudou', async () => {
  const { consultar } = await import('../src/nucleo/banco.js')
  const eventos = consultar(
    `SELECT acao, ator_id, ator_nome, criado_em, depois FROM eventos_auditoria
      WHERE empresa_id = ? ORDER BY criado_em`, [empresaA])

  const acoes = eventos.map((e) => e.acao)
  for (const esperada of ['usuario.criado', 'credencial.ativo', 'credencial.bloqueado',
                          'veiculo.km_atualizado', 'preventiva.concluida', 'template.publicado']) {
    assert.ok(acoes.includes(esperada), `faltou registrar "${esperada}"`)
  }

  const ativacao = eventos.find((e) => e.acao === 'credencial.ativo')
  assert.equal(ativacao.ator_id, admA)
  assert.equal(ativacao.ator_nome, 'Adm A')
  assert.ok(ativacao.criado_em)

  // Nenhum evento pode carregar segredo de senha.
  const bruto = JSON.stringify(eventos)
  assert.ok(!bruto.includes('senha_hash'))
  assert.ok(!bruto.includes('senha_salt'))
})

test('auditoria: tentativa de login errada tambem fica registrada', async () => {
  const { consultar } = await import('../src/nucleo/banco.js')
  await chamar('POST', '/api/auth/login', { corpo: { email: 'adm.a@teste.local', senha: 'errada' } })
  const falhas = consultar(
    `SELECT COUNT(*) AS total FROM eventos_auditoria WHERE empresa_id = ? AND acao = 'login.falha'`,
    [empresaA])
  assert.ok(falhas[0].total >= 1)
})
