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

const { abrirBanco, executar, consultarUm, novoId, agora, transacao, fecharBanco } =
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
// Carro exclusivo do teste de notificacao critica: os outros acumulam estado
// (ocorrencia, bloqueio, reserva) ao longo do arquivo, e um teste que depende
// de "disponivel" nao pode disputar veiculo com os vizinhos.
const veiculoNotificacao = criarVeiculo(empresaA, 'AAA5A55')
// Mesma razao, para os testes de significado do contrato: um deles BLOQUEIA o
// carro de proposito (e' o que prova que o julgamento e' do servidor), entao
// nao da para os dois dividirem a placa.
const veiculoContrato = criarVeiculo(empresaA, 'AAA6A66')
const veiculoContrato2 = criarVeiculo(empresaA, 'AAA7A77')

// Categoria de uso: e' o que o colaborador pede (roadmap 10.3). A placa so
// aparece na liberacao, escolhida pela Frota.
function criarCategoria(empresaId, nome, veiculos) {
  const id = novoId('categoria')
  executar(
    `INSERT INTO categorias_uso (id, empresa_id, nome, assentos, carroceria, criado_em, atualizado_em)
     VALUES (?, ?, ?, 4, 'utilitario', ?, ?)`, [id, empresaId, nome, ts, ts])
  for (const v of veiculos) {
    executar('INSERT INTO veiculo_categorias (empresa_id, veiculo_id, categoria_id) VALUES (?, ?, ?)',
      [empresaId, v, id])
  }
  return id
}

// Modelo de preventiva: liberado so para o cargo de manutencao, como o do
// mecanico no roadmap 11.2.3. Foto obrigatoria nos dois momentos.
const ESTRUTURA_PREVENTIVA = {
  perguntas: [
    { id: 'pinca', titulo: 'Pinca de freio', foto_ok: 'obrigatorio', max_fotos_ok: 3,
      opcoes_problema: [
        { id: 'pastilha', nome: 'Pastilha no limite', foto: 'obrigatorio', max_fotos: 2,
          abrir_ocorrencia: true, prioridade: 'alta' },
      ] },
    { id: 'correia', titulo: 'Correia dentada', foto_ok: 'obrigatorio', max_fotos_ok: 2,
      opcoes_problema: [
        { id: 'ressecada', nome: 'Correia ressecada', foto: 'obrigatorio', max_fotos: 2,
          abrir_ocorrencia: true, prioridade: 'critica' },
      ] },
  ],
}

function criarModeloPreventiva(empresaId, codigo, cargos) {
  const id = novoId('template')
  executar(
    `INSERT INTO templates (id, empresa_id, codigo, nome, tipo_veiculo, cargos_liberados,
                            exige_assinatura, finalidade, versao, status, estrutura,
                            publicado_em, criado_em, atualizado_em)
     VALUES (?, ?, ?, 'Preventiva de teste', 'compacto_leve', ?, 0, 'preventiva',
             1, 'publicado', ?, ?, ?, ?)`,
    [id, empresaId, codigo, JSON.stringify(cargos), JSON.stringify(ESTRUTURA_PREVENTIVA),
     ts, ts, ts])
  return id
}

function criarPreventivaComModelo(empresaId, veiculoId, templateId) {
  const id = novoId('preventiva')
  executar(
    `INSERT INTO preventivas (id, empresa_id, veiculo_id, modo, proximo_km,
                              alerta_antes_km, alerta_antes_dias, template_id,
                              status, criado_em, atualizado_em)
     VALUES (?, ?, ?, 'km', 11000, 500, 7, ?, 'vencida', ?, ?)`,
    [id, empresaId, veiculoId, templateId, ts, ts])
  return id
}

// Dois modelos DIARIOS que liberam o mesmo cargo, um por tipo de veiculo. E'
// a situacao real: o motorista pode pegar um compacto hoje e uma pick-up
// amanha. A cobranca precisa ser de UM checklist, nao de dois.
function criarDiario(empresaId, codigo, tipo) {
  const id = novoId('template')
  executar(
    `INSERT INTO templates (id, empresa_id, codigo, nome, tipo_veiculo, cargos_liberados,
                            exige_assinatura, finalidade, periodicidade, dias_semana,
                            horario_limite, versao, status, estrutura,
                            publicado_em, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, '["*"]', 0, 'padrao', 'diario', '[1,2,3,4,5]',
             '08:30', 1, 'publicado', ?, ?, ?, ?)`,
    [id, empresaId, codigo, `Diario ${codigo}`, tipo, JSON.stringify(ESTRUTURA), ts, ts, ts])
  return id
}
// Nao usa pick-up de proposito: 'so-motorista' e' o unico modelo de pick-up e
// existe para provar que cargo nao liberado esconde o checklist. Um segundo
// modelo de pick-up liberado para todos derrubaria aquele teste.
criarDiario(empresaA, 'cobranca-compacto', 'compacto_leve')
criarDiario(empresaA, 'cobranca-caminhao', 'caminhao')

const cgMecanicoA = criarCargo(empresaA, 'Mecanico')
// CPF proprio: 604.829.173-69 e' o que o teste de cadastro usa para criar um
// usuario novo, e ocupa-lo aqui faria aquele teste falhar por conflito.
const mecanicoA = criarUsuario(empresaA, 'Mecanico A', '11122233396', 'mecanico.a@teste.local',
  cgMecanicoA, true)
const modeloPreventivaA = criarModeloPreventiva(empresaA, 'preventiva-teste', [cgMecanicoA])

const catA = criarCategoria(empresaA, 'Comercial A',
  [veiculoA, veiculoA2, veiculoA4, veiculoContrato, veiculoContrato2])
const catVazia = criarCategoria(empresaA, 'Sem carro nenhum', [])
criarCategoria(empresaB, 'Comercial B', [veiculoB])

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

// AAAA-MM-DD no fuso de quem roda o teste — a mesma conta que o servidor faz.
// O mesmo "hoje" que o servidor usa. Se o teste calculasse o dia pelo fuso do
// processo e o servidor pelo fuso da operacao, os dois discordariam por tres
// horas todo dia — e o teste acusaria o servidor por um erro dele proprio.
const { diaLocal } = await import('../src/nucleo/relogio.js')

// Pedir carro passou a ser: escolher CATEGORIA. Liberar passou a ser: escolher
// a PLACA. Os testes falam a mesma lingua do fluxo (roadmap 10.4).
async function pedir(token, { categoria = catA, inicio, fim, motivo }) {
  return chamar('POST', '/api/solicitacoes', {
    token,
    corpo: {
      categoria_id: categoria, janela_inicio: inicio, janela_fim: fim,
      motivo: motivo || 'Pedido de teste com motivo suficientemente longo.',
    },
  })
}

async function liberar(tokenFrota, solicitacaoId, veiculoId, extras = {}) {
  return chamar('POST', `/api/solicitacoes/${solicitacaoId}/aprovar`, {
    token: tokenFrota, corpo: { veiculo_id: veiculoId, ...extras },
  })
}

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

test('solicitacao: pedido nasce com categoria e sem placa; a placa vem na liberacao', async () => {
  const colaborador = await entrar('vendas.a@teste.local')
  const frota = await entrar('frota.a@teste.local')

  const pedido = await pedir(colaborador, {
    inicio: daquiAHoras(48), fim: daquiAHoras(53),
    motivo: 'Reuniao com cliente em outra cidade.',
  })
  assert.equal(pedido.status, 200)
  assert.equal(pedido.dados.solicitacao.status, 'pendente')
  assert.equal(pedido.dados.solicitacao.veiculo_id, null,
    'quem pede escolhe categoria; a placa e decisao da Frota')
  assert.equal(pedido.dados.solicitacao.categoria_id, catA)

  const id = pedido.dados.solicitacao.id
  // Colaborador nao aprova o proprio pedido.
  assert.equal((await liberar(colaborador, id, veiculoA)).status, 403)

  // Liberar sem escolher a placa nao e' liberar: deixaria a pessoa no patio
  // sem saber o que pegar (roadmap 10.4).
  const semPlaca = await chamar('POST', `/api/solicitacoes/${id}/aprovar`, { token: frota })
  assert.equal(semPlaca.status, 400)
  assert.match(semPlaca.dados.mensagem, /Escolha o veiculo/)

  const liberada = await liberar(frota, id, veiculoA)
  assert.equal(liberada.status, 200)
  assert.equal(liberada.dados.solicitacao.status, 'aprovada')
  assert.equal(liberada.dados.solicitacao.veiculo_id, veiculoA)
  assert.equal(liberada.dados.solicitacao.placa, 'AAA1A11',
    'o solicitante precisa ver a placa que vai procurar no estacionamento')
})

test('solicitacao: colaborador nao escolhe a placa nem por injecao na requisicao', async () => {
  const colaborador = await entrar('vendas.a@teste.local')
  const r = await chamar('POST', '/api/solicitacoes', {
    token: colaborador,
    corpo: {
      categoria_id: catA, veiculo_id: veiculoA,
      janela_inicio: daquiAHoras(900), janela_fim: daquiAHoras(905),
      motivo: 'Tentando reservar um carro especifico pelas costas da frota.',
    },
  })
  assert.equal(r.status, 400)
  assert.match(r.dados.mensagem, /equipe da frota/)
})

test('solicitacao: liberar carro fora da categoria pedida exige explicacao', async () => {
  const colaborador = await entrar('vendas.a@teste.local')
  const frota = await entrar('frota.a@teste.local')

  const pedido = await pedir(colaborador, {
    categoria: catVazia, inicio: daquiAHoras(1000), fim: daquiAHoras(1005),
    motivo: 'Categoria que nao tem carro nenhum associado.',
  })
  const id = pedido.dados.solicitacao.id

  const semExplicar = await liberar(frota, id, veiculoA)
  assert.equal(semExplicar.status, 400)
  assert.match(semExplicar.dados.mensagem, /nao atende a categoria/)

  const explicando = await liberar(frota, id, veiculoA,
    { motivo_categoria: 'Sem utilitario livre; liberado compacto com aval do gestor.' })
  assert.equal(explicando.status, 200)
  assert.match(explicando.dados.solicitacao.motivo_categoria, /Sem utilitario livre/)
})

test('solicitacao: motivo curto e janela invertida sao recusados', async () => {
  const token = await entrar('vendas.a@teste.local')
  const base = { categoria_id: catA, janela_inicio: daquiAHoras(100), janela_fim: daquiAHoras(105) }

  assert.equal((await chamar('POST', '/api/solicitacoes',
    { token, corpo: { ...base, motivo: 'urgente' } })).status, 400)
  assert.equal((await chamar('POST', '/api/solicitacoes',
    { token, corpo: { ...base, janela_fim: daquiAHoras(99), motivo: 'Motivo suficientemente longo.' } })).status, 400)
  // Categoria inexistente nao vira pedido fantasma.
  assert.equal((await chamar('POST', '/api/solicitacoes',
    { token, corpo: { ...base, categoria_id: 'nao_existe', motivo: 'Motivo suficientemente longo.' } })).status, 404)
})

test('solicitacao: o mesmo carro nao e liberado duas vezes na mesma janela', async () => {
  // A disputa mudou de lugar. Antes dois pedidos brigavam pela placa na hora
  // de PEDIR; agora pedido nao tem placa, entao a briga acontece na hora de
  // LIBERAR — e quem ve o conflito e a Frota, na tela em que ela decide.
  const token = await entrar('vendas.a@teste.local')
  const frota = await entrar('frota.a@teste.local')

  const primeira = await pedir(token, {
    inicio: daquiAHoras(200), fim: daquiAHoras(210), motivo: 'Primeira reserva desta janela.',
  })
  const segunda = await pedir(token, {
    inicio: daquiAHoras(205), fim: daquiAHoras(215), motivo: 'Segunda reserva que invade a primeira.',
  })
  // Os dois pedidos entram: nenhum ocupa carro ainda.
  assert.equal(primeira.status, 200)
  assert.equal(segunda.status, 200)

  assert.equal((await liberar(frota, primeira.dados.solicitacao.id, veiculoA2)).status, 200)

  const choque = await liberar(frota, segunda.dados.solicitacao.id, veiculoA2)
  assert.equal(choque.status, 409)
  assert.match(choque.dados.mensagem, /ja foi liberado/)

  // Outro carro na mesma janela passa.
  assert.equal((await liberar(frota, segunda.dados.solicitacao.id, veiculoA4)).status, 200)
})

test('solicitacao: a lista de carros livres e da Frota, nao do solicitante', async () => {
  const colaborador = await entrar('vendas.a@teste.local')
  const frota = await entrar('frota.a@teste.local')
  const janela = `janela_inicio=${daquiAHoras(2000)}&janela_fim=${daquiAHoras(2005)}`

  assert.equal((await chamar('GET', `/api/solicitacoes/disponiveis?${janela}`,
    { token: colaborador })).status, 403)

  const r = await chamar('GET', `/api/solicitacoes/disponiveis?${janela}&categoria_id=${catA}`,
    { token: frota })
  assert.equal(r.status, 200)
  assert.ok(r.dados.veiculos.length > 0)
  // Os da categoria pedida vem primeiro: e o que a Frota precisa ver no topo.
  assert.equal(r.dados.veiculos[0].da_categoria, true)
})

test('solicitacao: recusar exige motivo', async () => {
  const colaborador = await entrar('vendas.a@teste.local')
  const frota = await entrar('frota.a@teste.local')
  const { dados } = await pedir(colaborador, {
    inicio: daquiAHoras(400), fim: daquiAHoras(404), motivo: 'Pedido que sera recusado no teste.',
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

  const pedido = await pedir(vendas, {
    inicio: daquiAHoras(500), fim: daquiAHoras(505),
    motivo: 'Pedido de pick-up por quem nao e motorista.',
  })
  await liberar(frota, pedido.dados.solicitacao.id, pickup.id,
    { motivo_categoria: 'Unico carro livre na janela.' })

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

  const pedido = await pedir(motorista, {
    inicio: daquiAHoras(600), fim: daquiAHoras(605),
    motivo: 'Pedido para testar checklist incompleto.',
  })
  await liberar(frota, pedido.dados.solicitacao.id, veiculoA2)

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
  const pedido = await pedir(tokenPessoa, {
    inicio: daquiAHoras(offsetHoras),
    fim: daquiAHoras(offsetHoras + 4),
    motivo: 'Pedido para exercitar o estado do veiculo.',
  })
  assert.equal(pedido.status, 200, JSON.stringify(pedido.dados))
  const r = await liberar(tokenFrota, pedido.dados.solicitacao.id, veiculoId,
    { motivo_categoria: 'Teste de estado do veiculo.' })
  assert.equal(r.status, 200, JSON.stringify(r.dados))
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

// ------------------------------------------- criterio: checklist avulso

test('avulso: quem usa carro todos os dias faz checklist sem pedir veiculo', async () => {
  // Roadmap 8.2: e' a maioria dos checklists reais. 863 saidas para 54
  // retornos no mes do PROLOG — o diario nao tem devolucao.
  const frota = await entrar('frota.a@teste.local')
  const diarista = await chamar('POST', '/api/usuarios', {
    token: frota,
    corpo: {
      nome: 'Tecnico Diarista', cpf: '935.411.347-80', email: 'diarista@teste.local',
      telefone: '(31) 90000-1111', cargo_id: cgMotoristaA,
      acessa_painel: false, usa_veiculo_diario: true,
    },
  })
  assert.equal(diarista.status, 200)
  assert.equal(diarista.dados.usuario.usa_veiculo_diario, 1)

  const token = (await chamar('POST', '/api/auth/login', {
    corpo: { email: 'diarista@teste.local', senha: diarista.dados.senha_inicial },
  })).dados.token
  await chamar('POST', '/api/auth/senha', {
    token, corpo: { senha_atual: diarista.dados.senha_inicial, senha_nova: 'diarista2026' },
  })
  const ativo = (await chamar('POST', '/api/auth/login',
    { corpo: { email: 'diarista@teste.local', senha: 'diarista2026' } })).dados.token

  const app = await chamar('GET', '/api/app/inicio', { token: ativo })
  assert.equal(app.dados.usuario.usa_veiculo_diario, true)
  assert.ok(app.dados.avulso.length > 0, 'sem condutor fixo, ele escolhe o carro no galpao')

  const escolhido = app.dados.avulso[0]
  const envio = await chamar('POST', '/api/inspecoes', {
    token: ativo,
    corpo: {
      cliente_uuid: 'uuid-avulso-0001',
      veiculo_id: escolhido.veiculo.id,
      template_id: escolhido.templates[0],
      momento: 'saida', km_informado: 55000,
      respostas: { lataria: { desfecho: 'ok', fotos: 1 }, pneus: { desfecho: 'ok', fotos: 1 } },
    },
  })
  assert.equal(envio.status, 200, JSON.stringify(envio.dados))
  assert.equal(envio.dados.inspecao.solicitacao_id, null, 'avulso nao tem solicitacao por tras')
  assert.ok(envio.dados.inspecao.numero > 0, 'numero sequencial serve para citar em voz alta')
})

test('avulso: quem nao usa carro todo dia precisa pedir antes', async () => {
  const vendas = await entrar('vendas.a@teste.local')
  const r = await chamar('POST', '/api/inspecoes', {
    token: vendas,
    corpo: {
      cliente_uuid: 'uuid-avulso-negado', veiculo_id: veiculoA, template_id: 'qualquer',
      momento: 'saida',
      respostas: { lataria: { desfecho: 'ok' }, pneus: { desfecho: 'ok' } },
    },
  })
  assert.equal(r.status, 403)
  assert.match(r.dados.mensagem, /Peca um veiculo primeiro/)
})

test('avulso: nao existe retorno sem alguem a quem devolver', async () => {
  const frota = await entrar('frota.a@teste.local')
  const r = await chamar('POST', '/api/inspecoes', {
    token: frota,
    corpo: {
      cliente_uuid: 'uuid-avulso-retorno', veiculo_id: veiculoA, template_id: 'qualquer',
      momento: 'retorno',
      respostas: { lataria: { desfecho: 'ok' }, pneus: { desfecho: 'ok' } },
    },
  })
  assert.equal(r.status, 400)
  assert.match(r.dados.mensagem, /nao tem retorno/)
})

// ------------------------------------------ criterio: checklists feitos

test('execucoes: a tela abre no dia de hoje sem ninguem pedir', async () => {
  const frota = await entrar('frota.a@teste.local')
  const r = await chamar('GET', '/api/execucoes', { token: frota })
  assert.equal(r.status, 200)
  // Dia LOCAL: e' o dia de quem olha a tela, nao o dia em UTC.
  assert.equal(r.dados.periodo.de, diaLocal())
  assert.equal(r.dados.periodo.ate, diaLocal())
  assert.ok(r.dados.execucoes.length > 0, 'os checklists dos testes foram feitos hoje')
})

test('execucoes: cada linha traz as contagens que a planilha usa', async () => {
  const frota = await entrar('frota.a@teste.local')
  const r = await chamar('GET', '/api/execucoes', { token: frota })
  const critica = r.dados.execucoes.find((e) => e.prioridade_critica > 0)
  assert.ok(critica, 'houve checklist com ocorrencia critica nos testes acima')
  // O PROLOG chama de "itens nao se aplica", mas o numero e' sempre
  // total - problemas. Conferido nas 917 linhas reais (roadmap 11.10).
  assert.equal(critica.total_conformes, critica.total_perguntas - critica.total_problemas)
  assert.ok(critica.duracao_segundos >= 0)
  assert.ok(['no_prazo', 'atrasado'].includes(critica.prazo))
})

test('execucoes: filtro de cargo e de periodo', async () => {
  const frota = await entrar('frota.a@teste.local')
  const doCargo = await chamar('GET', `/api/execucoes?cargo_id=${cgMotoristaA}`, { token: frota })
  assert.ok(doCargo.dados.execucoes.every((e) => e.cargo_id === cgMotoristaA))

  const ontem = diaLocal(new Date(Date.now() - 86400000))
  const vazio = await chamar('GET', `/api/execucoes?de=${ontem}&ate=${ontem}`, { token: frota })
  assert.equal(vazio.dados.execucoes.length, 0, 'nada foi feito ontem nestes testes')

  const invertido = await chamar('GET', `/api/execucoes?de=2026-09-10&ate=2026-09-01`, { token: frota })
  assert.equal(invertido.status, 400)
})

test('execucoes: colaborador ve so os proprios checklists', async () => {
  const vendas = await entrar('vendas.a@teste.local')
  const r = await chamar('GET', '/api/execucoes', { token: vendas })
  assert.equal(r.status, 200)
  const eu = (await chamar('GET', '/api/auth/eu', { token: vendas })).dados.usuario
  assert.ok(r.dados.execucoes.every((e) => e.colaborador === eu.nome))
})

test('planilha: sai no leiaute do PROLOG, com separador e BOM do Excel', async () => {
  const frota = await entrar('frota.a@teste.local')
  const resposta = await fetch(`${base}/api/execucoes.csv`, {
    headers: { authorization: `Bearer ${frota}` },
  })
  assert.equal(resposta.status, 200)
  assert.match(resposta.headers.get('content-type'), /text\/csv/)
  assert.match(resposta.headers.get('content-disposition'), /attachment; filename=/)

  // Os BYTES, e nao o texto: `Response.text()` decodifica em UTF-8 e a propria
  // especificacao manda descartar o BOM inicial. Conferir pelo texto diria
  // "sem BOM" mesmo quando ele esta la, e o que chega ao Excel sao os bytes.
  const bytes = new Uint8Array(await resposta.arrayBuffer())
  assert.deepEqual([bytes[0], bytes[1], bytes[2]], [0xEF, 0xBB, 0xBF],
    'sem BOM o Excel em portugues estraga os acentos')

  const csv = new TextDecoder('utf-8').decode(bytes)

  const linhas = csv.replace(/^\ufeff/, '').trim().split('\r\n')
  const colunas = linhas[0].split(';')
  assert.equal(colunas.length, 24)
  assert.equal(colunas[0], 'Unidade')
  assert.equal(colunas[7], 'Equipe')
  assert.equal(colunas[23], 'Observação')
  assert.ok(linhas.length > 1, 'deveria haver execucoes de hoje')

  // Equipe sai vazia: o MyLog classifica so por Cargo. Preenche-la com o cargo
  // seria inventar um dado que nao existe (roadmap 11.10).
  const primeira = linhas[1].split(';')
  assert.equal(primeira[7], '')
  assert.ok(['Saída', 'Retorno'].includes(primeira[14]))
})

test('planilha: colaborador nao exporta a base', async () => {
  const vendas = await entrar('vendas.a@teste.local')
  const r = await fetch(`${base}/api/execucoes.csv`, {
    headers: { authorization: `Bearer ${vendas}` },
  })
  assert.equal(r.status, 403)
})

// --------------------------------------------- criterio: categoria de uso

test('categoria: colaborador le a lista para pedir, mas nao cria', async () => {
  const vendas = await entrar('vendas.a@teste.local')
  const frota = await entrar('frota.a@teste.local')

  const lista = await chamar('GET', '/api/categorias', { token: vendas })
  assert.equal(lista.status, 200)
  assert.ok(lista.dados.categorias.some((c) => c.id === catA))

  assert.equal((await chamar('POST', '/api/categorias',
    { token: vendas, corpo: { nome: 'Categoria pirata' } })).status, 403)

  const criada = await chamar('POST', '/api/categorias', {
    token: frota, corpo: { nome: '6 assentos — van', assentos: 6, carroceria: 'utilitario' },
  })
  assert.equal(criada.status, 200)
  assert.equal(criada.dados.categoria.assentos, 6)

  assert.equal((await chamar('POST', '/api/categorias',
    { token: frota, corpo: { nome: '6 assentos — van' } })).status, 409)
  assert.equal((await chamar('POST', '/api/categorias',
    { token: frota, corpo: { nome: 'Carroceria inventada', carroceria: 'foguete' } })).status, 400)
})

test('categoria: multi-tenant — a de outra empresa nao aparece nem abre', async () => {
  const frotaA = await entrar('frota.a@teste.local')
  const frotaB = await entrar('frota.b@teste.local')

  const listaB = await chamar('GET', '/api/categorias', { token: frotaB })
  assert.ok(!listaB.dados.categorias.some((c) => c.id === catA))
  assert.equal((await chamar('PATCH', `/api/categorias/${catA}`,
    { token: frotaB, corpo: { nome: 'Sequestrada' } })).status, 404)

  // E nem serve para pedir carro de outra empresa.
  const daB = listaB.dados.categorias[0]
  const r = await chamar('POST', '/api/solicitacoes', {
    token: frotaA,
    corpo: {
      categoria_id: daB.id, janela_inicio: daquiAHoras(3000), janela_fim: daquiAHoras(3005),
      motivo: 'Tentando usar categoria de outra empresa.',
    },
  })
  assert.equal(r.status, 404)
})

test('categoria: usada por uma solicitacao nao pode ser apagada', async () => {
  const frota = await entrar('frota.a@teste.local')
  const r = await chamar('DELETE', `/api/categorias/${catA}`, { token: frota })
  assert.equal(r.status, 409)
  assert.match(r.dados.mensagem, /Desative em vez de remover/)
})

test('categoria: a lista de veiculos que atendem e substituida de uma vez', async () => {
  const frota = await entrar('frota.a@teste.local')
  const posta = await chamar('PUT', `/api/categorias/${catVazia}/veiculos`, {
    token: frota, corpo: { veiculos: [veiculoA, veiculoA2] },
  })
  assert.equal(posta.dados.veiculos, 2)

  const conferindo = await chamar('GET', `/api/categorias/${catVazia}/veiculos`, { token: frota })
  const atendem = conferindo.dados.veiculos.filter((v) => v.atende)
  assert.equal(atendem.length, 2)

  // Veiculo de outra empresa nao entra na lista.
  const invasor = await chamar('PUT', `/api/categorias/${catVazia}/veiculos`, {
    token: frota, corpo: { veiculos: [veiculoB] },
  })
  assert.equal(invasor.status, 404)
})

// ------------------------------------------------ criterio: ritmo na API

test('ritmo: o servidor recusa checklist diario sem dia da semana', async () => {
  const frota = await entrar('frota.a@teste.local')
  const r = await chamar('POST', '/api/templates', {
    token: frota,
    corpo: {
      codigo: 'ritmo-invalido', nome: 'Diario sem dia', tipo_veiculo: 'compacto_leve',
      cargos_liberados: ['*'], periodicidade: 'diario', dias_semana: [],
    },
  })
  assert.equal(r.status, 400)
  assert.match(r.dados.mensagem, /ao menos um dia da semana/)
})

test('ritmo: o modelo guarda periodicidade e horario limite', async () => {
  const frota = await entrar('frota.a@teste.local')
  const r = await chamar('POST', '/api/templates', {
    token: frota,
    corpo: {
      codigo: 'diario-com-prazo', nome: 'Diario com prazo', tipo_veiculo: 'compacto_leve',
      cargos_liberados: ['*'], periodicidade: 'diario',
      dias_semana: [1, 2, 3, 4, 5], horario_limite: '08:30',
      estrutura: ESTRUTURA,
    },
  })
  assert.equal(r.status, 200, JSON.stringify(r.dados))
  assert.equal(r.dados.template.periodicidade, 'diario')
  assert.deepEqual(r.dados.template.dias_semana, [1, 2, 3, 4, 5])
  assert.equal(r.dados.template.horario_limite, '08:30')

  // A nova versao herda o ritmo: nao se perde cobranca por criar versao.
  const publicado = await chamar('POST', `/api/templates/${r.dados.template.id}/publicar`,
    { token: frota })
  assert.equal(publicado.status, 200, JSON.stringify(publicado.dados))
  const nova = await chamar('POST', `/api/templates/${r.dados.template.id}/versao`, { token: frota })
  assert.equal(nova.status, 200, JSON.stringify(nova.dados))
  assert.equal(nova.dados.template.periodicidade, 'diario')
  assert.equal(nova.dados.template.horario_limite, '08:30')
})

test('execucoes: o dia do filtro e o dia de quem olha, nao o dia em UTC', async () => {
  // O banco guarda UTC; quem filtra pensa no dia dele. No Brasil (UTC-3),
  // montar a borda como "AAAA-MM-DDT00:00:00Z" jogaria tudo que foi feito
  // depois das 21h para o dia seguinte — tres horas de todo dia caindo no
  // balde errado, justamente no fim de turno.
  const frota = await entrar('frota.a@teste.local')

  // Uma inspecao gravada as 22h de HOJE, em hora local.
  const agora = new Date()
  const noiteLocal = new Date(
    agora.getFullYear(), agora.getMonth(), agora.getDate(), 22, 30, 0)
  const alvo = consultarUm(
    'SELECT id FROM inspecoes WHERE empresa_id = ? ORDER BY criado_em LIMIT 1', [empresaA])
  assert.ok(alvo, 'os testes acima ja produziram inspecoes')
  executar('UPDATE inspecoes SET iniciada_em = ?, finalizada_em = ? WHERE id = ?',
    [noiteLocal.toISOString(), noiteLocal.toISOString(), alvo.id])

  const r = await chamar('GET', '/api/execucoes', { token: frota })
  assert.equal(r.dados.periodo.de, diaLocal(agora), 'o padrao e o dia local, nao o dia em UTC')
  assert.ok(r.dados.execucoes.some((e) => e.id === alvo.id),
    'checklist das 22h precisa aparecer no dia em que foi feito')
})

// ---------------------------------- criterio: solicitacao ainda sem placa

test('historico: pedido pendente e pedido recusado nao somem do historico', async () => {
  // O historico existe para mostrar tudo que a pessoa fez ou deixou de fazer.
  // Pendente e recusado nunca ganham placa; com JOIN em veiculos, sumiam da
  // lista — justamente o registro de que ela PEDIU e nao recebeu.
  const colaborador = await entrar('vendas.a@teste.local')
  const frota = await entrar('frota.a@teste.local')

  const pendente = await pedir(colaborador, {
    inicio: daquiAHoras(5000), fim: daquiAHoras(5004),
    motivo: 'Pedido que fica pendente para conferir o historico.',
  })
  const recusado = await pedir(colaborador, {
    inicio: daquiAHoras(5100), fim: daquiAHoras(5104),
    motivo: 'Pedido que sera recusado para conferir o historico.',
  })
  await chamar('POST', `/api/solicitacoes/${recusado.dados.solicitacao.id}/recusar`,
    { token: frota, corpo: { motivo: 'Sem carro disponivel nessa data.' } })

  const eu = (await chamar('GET', '/api/auth/eu', { token: colaborador })).dados.usuario
  const h = await chamar('GET', `/api/usuarios/${eu.id}/historico`, { token: frota })

  const numeros = h.dados.solicitacoes.map((x) => x.numero)
  assert.ok(numeros.includes(pendente.dados.solicitacao.numero), 'pendente precisa aparecer')
  assert.ok(numeros.includes(recusado.dados.solicitacao.numero), 'recusado precisa aparecer')

  const semPlaca = h.dados.solicitacoes.find((x) => x.numero === pendente.dados.solicitacao.numero)
  assert.equal(semPlaca.placa, null)
  assert.ok(semPlaca.categoria_nome, 'sem placa, o historico mostra a categoria pedida')
})

test('relatorio: solicitacao sem placa abre e diz o que falta, em vez de 404', async () => {
  // Devolver "nao encontrada" para algo que existe manda a pessoa procurar a
  // coisa errada.
  const colaborador = await entrar('vendas.a@teste.local')
  const frota = await entrar('frota.a@teste.local')

  const pedido = await pedir(colaborador, {
    inicio: daquiAHoras(5200), fim: daquiAHoras(5204),
    motivo: 'Pedido sem placa para conferir o relatorio comparativo.',
  })

  const resposta = await fetch(`${base}/relatorio/solicitacao/${pedido.dados.solicitacao.id}`, {
    headers: { authorization: `Bearer ${frota}` },
  })
  assert.equal(resposta.status, 200)
  const html = await resposta.text()
  assert.match(html, /veiculo ainda nao escolhido/)
  assert.match(html, /Categoria pedida/)
  assert.match(html, /Nenhuma inspecao registrada/)
})

test('cargo: a trava vale para a frota tambem', async () => {
  // O caso que define a regra e' o checklist pos-manutencao do mecanico — e o
  // mecanico E DA FROTA. Abrir excecao para a frota esvaziaria a regra
  // exatamente no caso que a criou (roadmap 11.2.3).
  const frota = await entrar('frota.a@teste.local')

  const soMotorista = consultarUm(
    `SELECT id FROM templates WHERE empresa_id = ? AND codigo = 'so-motorista'`, [empresaA])
  assert.ok(soMotorista, 'a fixture tem um modelo liberado so para Motorista')

  const eu = (await chamar('GET', '/api/auth/eu', { token: frota })).dados.usuario
  assert.notEqual(eu.cargo_id, cgMotoristaA, 'quem e da frota aqui tem outro cargo')

  const r = await chamar('POST', '/api/inspecoes', {
    token: frota,
    corpo: {
      cliente_uuid: 'uuid-cargo-frota', veiculo_id: veiculoA4,
      template_id: soMotorista.id, momento: 'saida',
      respostas: { lataria: { desfecho: 'ok' }, pneus: { desfecho: 'ok' } },
    },
  })
  assert.equal(r.status, 403)
  assert.match(r.dados.mensagem, /cargo nao esta liberado/)
})

// -------------------------------------------- criterio: arquivos estaticos

test('estatico: arquivo que nao existe responde 404, nao a pagina do painel', async () => {
  // O index cobre ROTA — caminho sem extensao, resolvido no cliente. Arquivo
  // inexistente precisa dizer 404: devolvendo HTML com status 200, um import
  // com erro de digitacao chega ao navegador como pagina, e o erro vira
  // "unknown error fetching the script" — que nao diz qual arquivo falta.
  const pedir = (caminho) => fetch(`${base}${caminho}`, { redirect: 'manual' })

  for (const caminho of ['/js/inexistente.js', '/css/nada.css', '/app/manifesto.json']) {
    const r = await pedir(caminho)
    assert.equal(r.status, 404, `${caminho} deveria ser 404`)
    assert.doesNotMatch(r.headers.get('content-type') || '', /html/)
  }

  // Rota do cliente continua caindo no index.
  const rota = await pedir('/solicitacoes')
  assert.equal(rota.status, 200)
  assert.match(rota.headers.get('content-type'), /html/)

  // E arquivo de verdade continua sendo servido com o tipo certo.
  const real = await pedir('/js/api.js')
  assert.equal(real.status, 200)
  assert.match(real.headers.get('content-type'), /javascript/)
})

// ------------------------------------ criterio: checklist de preventiva

test('preventiva: so o cargo liberado ve a preventiva no aplicativo', async () => {
  const preventivaA = criarPreventivaComModelo(empresaA, veiculoA2, modeloPreventivaA)
  globalThis.__preventivaA = preventivaA

  const mecanico = await entrar('mecanico.a@teste.local')
  const frota = await entrar('frota.a@teste.local')

  const doMecanico = await chamar('GET', '/api/app/inicio', { token: mecanico })
  const minha = doMecanico.dados.preventivas.find((p) => p.preventiva_id === preventivaA)
  assert.ok(minha, 'o mecanico precisa ver a preventiva vencida do carro dele')
  assert.equal(minha.momento, 'saida', 'comeca pela saida')
  assert.equal(minha.veiculo.placa, 'AAA2A22')

  // A frota tem outro cargo: o modelo do mecanico nao aparece para ela.
  const daFrota = await chamar('GET', '/api/app/inicio', { token: frota })
  assert.ok(!daFrota.dados.preventivas.some((p) => p.preventiva_id === preventivaA),
    'cargo nao liberado nao ve o modelo, nem sendo da frota')
})

test('preventiva: a saida e um checklist normal e abre ocorrencia', async () => {
  // Roadmap 14.2: a saida registra o estado da peca ANTES do servico.
  const mecanico = await entrar('mecanico.a@teste.local')
  const preventivaA = globalThis.__preventivaA

  const r = await chamar('POST', '/api/inspecoes', {
    token: mecanico,
    corpo: {
      cliente_uuid: 'uuid-prev-saida', preventiva_id: preventivaA,
      template_id: modeloPreventivaA, momento: 'saida', km_informado: 10800,
      respostas: {
        pinca: { desfecho: 'ocorrencia', opcao_id: 'pastilha', fotos: 1,
          relatorio: 'Pastilha no limite, disco com sulco.' },
        correia: { desfecho: 'ok', fotos: 1 },
      },
    },
  })
  assert.equal(r.status, 200, JSON.stringify(r.dados))
  assert.equal(r.dados.resumo.ocorrencias.length, 1)
  assert.equal(r.dados.resumo.maior_prioridade, 'alta')

  // A preventiva registrou a saida, mas continua aberta.
  const frota = await entrar('frota.a@teste.local')
  const lista = await chamar('GET', '/api/preventivas', { token: frota })
  const p = lista.dados.preventivas.find((x) => x.id === preventivaA)
  assert.ok(p, 'a preventiva continua em aberto ate o retorno')
  assert.equal(p.inspecao_saida, r.dados.inspecao.id)
})

test('preventiva: o retorno recusa saida na ordem errada', async () => {
  const mecanico = await entrar('mecanico.a@teste.local')
  const r = await chamar('POST', '/api/inspecoes', {
    token: mecanico,
    corpo: {
      cliente_uuid: 'uuid-prev-saida-2', preventiva_id: globalThis.__preventivaA,
      template_id: modeloPreventivaA, momento: 'saida',
      respostas: { pinca: { desfecho: 'ok', fotos: 1 }, correia: { desfecho: 'ok', fotos: 1 } },
    },
  })
  assert.equal(r.status, 409)
  assert.match(r.dados.mensagem, /espera o checklist de retorno/)
})

test('preventiva: retorno sem dizer se houve manutencao nao passa', async () => {
  const mecanico = await entrar('mecanico.a@teste.local')
  const r = await chamar('POST', '/api/inspecoes', {
    token: mecanico,
    corpo: {
      cliente_uuid: 'uuid-prev-ret-vazio', preventiva_id: globalThis.__preventivaA,
      template_id: modeloPreventivaA, momento: 'retorno',
      respostas: { pinca: { fotos: 1 }, correia: { fotos: 1 } },
      proxima_preventiva: { modo: 'km', proximo_km: 21000 },
    },
  })
  assert.equal(r.status, 400)
  assert.match(r.dados.mensagem, /sem_resposta_manutencao/)
})

test('preventiva: mexeu na peca e nao descreveu nao passa', async () => {
  const mecanico = await entrar('mecanico.a@teste.local')
  const r = await chamar('POST', '/api/inspecoes', {
    token: mecanico,
    corpo: {
      cliente_uuid: 'uuid-prev-ret-sem-texto', preventiva_id: globalThis.__preventivaA,
      template_id: modeloPreventivaA, momento: 'retorno',
      respostas: {
        pinca: { manutencao_feita: true, fotos: 1 },
        correia: { manutencao_feita: false, fotos: 1 },
      },
      proxima_preventiva: { modo: 'km', proximo_km: 21000 },
    },
  })
  assert.equal(r.status, 400)
  assert.match(r.dados.mensagem, /relatorio_obrigatorio/)
})

test('preventiva: sem a proxima, o retorno nao encerra', async () => {
  // Concluir sem agendar deixaria a frota sem agenda de manutencao (14.1).
  const mecanico = await entrar('mecanico.a@teste.local')
  const r = await chamar('POST', '/api/inspecoes', {
    token: mecanico,
    corpo: {
      cliente_uuid: 'uuid-prev-ret-sem-proxima', preventiva_id: globalThis.__preventivaA,
      template_id: modeloPreventivaA, momento: 'retorno',
      respostas: {
        pinca: { manutencao_feita: true, fotos: 1, relatorio: 'Pastilha e disco trocados.' },
        correia: { manutencao_feita: false, fotos: 1 },
      },
    },
  })
  assert.equal(r.status, 400)
  assert.match(r.dados.mensagem, /proxima_preventiva_obrigatoria/)
})

test('preventiva: o retorno encerra o ciclo e agenda a proxima, num ato so', async () => {
  const mecanico = await entrar('mecanico.a@teste.local')
  const frota = await entrar('frota.a@teste.local')
  const preventivaA = globalThis.__preventivaA

  const r = await chamar('POST', '/api/inspecoes', {
    token: mecanico,
    corpo: {
      cliente_uuid: 'uuid-prev-retorno', preventiva_id: preventivaA,
      template_id: modeloPreventivaA, momento: 'retorno', km_informado: 10900,
      respostas: {
        pinca: { manutencao_feita: true, fotos: 1, relatorio: 'Pastilha e disco trocados.' },
        correia: { manutencao_feita: false, fotos: 1, relatorio: 'Sem folga, dentro do prazo.' },
      },
      proxima_preventiva: { modo: 'km', proximo_km: 21000 },
    },
  })
  assert.equal(r.status, 200, JSON.stringify(r.dados))
  assert.equal(r.dados.resumo.itens_com_manutencao, 1)
  // O retorno de preventiva nao abre ocorrencia nem mexe no estado do veiculo.
  assert.deepEqual(r.dados.resumo.ocorrencias, [])
  assert.equal(r.dados.resumo.estado_veiculo_previsto, 'disponivel')

  const todas = await chamar('GET', '/api/preventivas?historico=1', { token: frota })
  const concluida = todas.dados.preventivas.find((x) => x.id === preventivaA)
  assert.equal(concluida.status, 'realizada')
  assert.equal(concluida.inspecao_retorno, r.dados.inspecao.id)
  assert.match(concluida.observacoes, /Pinca de freio/, 'o servico descreve o que foi mexido')

  // E nasceu a proxima, com o alvo informado no aparelho.
  const proxima = todas.dados.preventivas.find(
    (x) => x.veiculo_id === concluida.veiculo_id && x.status !== 'realizada')
  assert.ok(proxima, 'concluir e agendar sao o mesmo ato')
  assert.equal(proxima.proximo_km, 21000)
  assert.equal(proxima.template_id, modeloPreventivaA,
    'o modelo acompanha o ciclo: ninguem reconfigura a cada volta')
})

test('preventiva: modelo de preventiva nao roda solto, e checklist padrao nao encerra preventiva', async () => {
  const mecanico = await entrar('mecanico.a@teste.local')

  // Modelo de preventiva sem preventiva por tras.
  const solto = await chamar('POST', '/api/inspecoes', {
    token: mecanico,
    corpo: {
      cliente_uuid: 'uuid-prev-solto', veiculo_id: veiculoA2,
      template_id: modeloPreventivaA, momento: 'saida',
      respostas: { pinca: { desfecho: 'ok', fotos: 1 }, correia: { desfecho: 'ok', fotos: 1 } },
    },
  })
  assert.equal(solto.status, 400)
  assert.match(solto.dados.mensagem, /Abra pela preventiva/)

  // Preventiva com modelo padrao.
  const outra = criarPreventivaComModelo(empresaA, veiculoA4, modeloPreventivaA)
  const padrao = consultarUm(
    `SELECT id FROM templates WHERE empresa_id = ? AND codigo = 'compacto'`, [empresaA])
  const trocado = await chamar('POST', '/api/inspecoes', {
    token: mecanico,
    corpo: {
      cliente_uuid: 'uuid-prev-trocado', preventiva_id: outra,
      template_id: padrao.id, momento: 'saida',
      respostas: { lataria: { desfecho: 'ok', fotos: 1 }, pneus: { desfecho: 'ok', fotos: 1 } },
    },
  })
  assert.equal(trocado.status, 400)
  assert.match(trocado.dados.mensagem, /exige um checklist de preventiva/)
})

test('preventiva: um checklist atende uma coisa so', async () => {
  const mecanico = await entrar('mecanico.a@teste.local')
  const r = await chamar('POST', '/api/inspecoes', {
    token: mecanico,
    corpo: {
      cliente_uuid: 'uuid-prev-dois-donos', preventiva_id: globalThis.__preventivaA,
      solicitacao_id: 'qualquer', template_id: modeloPreventivaA, momento: 'saida',
      respostas: {},
    },
  })
  assert.equal(r.status, 400)
  assert.match(r.dados.mensagem, /nunca as duas/)
})

test('preventiva: o cadastro so aceita modelo de preventiva publicado', async () => {
  const frota = await entrar('frota.a@teste.local')
  const padrao = consultarUm(
    `SELECT id FROM templates WHERE empresa_id = ? AND codigo = 'compacto'`, [empresaA])

  const comPadrao = await chamar('POST', '/api/preventivas', {
    token: frota,
    corpo: { veiculo_id: veiculoA, modo: 'km', proximo_km: 999999, template_id: padrao.id },
  })
  assert.equal(comPadrao.status, 400)
  assert.match(comPadrao.dados.mensagem, /checklist de preventiva/)

  const inexistente = await chamar('POST', '/api/preventivas', {
    token: frota,
    corpo: { veiculo_id: veiculoA, modo: 'km', proximo_km: 999999, template_id: 'nao_existe' },
  })
  assert.equal(inexistente.status, 404)
})

test('dossie de preventiva: antes e depois lado a lado, com CPF mascarado', async () => {
  // Roadmap 27.1. O documento circula — oficina, seguro, cliente — e por isso
  // o CPF sai mascarado, como no PDF que a operacao ja le hoje.
  const mecanico = await entrar('mecanico.a@teste.local')
  const frota = await entrar('frota.a@teste.local')

  const prev = criarPreventivaComModelo(empresaA, veiculoA, modeloPreventivaA)

  await chamar('POST', '/api/inspecoes', {
    token: mecanico,
    corpo: {
      cliente_uuid: 'uuid-dossie-saida', preventiva_id: prev,
      template_id: modeloPreventivaA, momento: 'saida', km_informado: 20100,
      respostas: {
        pinca: { desfecho: 'ocorrencia', opcao_id: 'pastilha', fotos: 1,
          relatorio: 'Pastilha no limite.' },
        correia: { desfecho: 'ok', fotos: 1 },
      },
    },
  })
  const retorno = await chamar('POST', '/api/inspecoes', {
    token: mecanico,
    corpo: {
      cliente_uuid: 'uuid-dossie-retorno', preventiva_id: prev,
      template_id: modeloPreventivaA, momento: 'retorno', km_informado: 20150,
      respostas: {
        pinca: { manutencao_feita: true, fotos: 1, relatorio: 'Pastilha e disco trocados.' },
        correia: { manutencao_feita: false, fotos: 1 },
      },
      proxima_preventiva: { modo: 'data', proxima_data: '2027-03-15' },
    },
  })
  assert.equal(retorno.status, 200, JSON.stringify(retorno.dados))

  const resposta = await fetch(`${base}/relatorio/preventiva/${prev}`, {
    headers: { authorization: `Bearer ${frota}` },
  })
  assert.equal(resposta.status, 200)
  const html = await resposta.text()

  assert.match(html, /Antes — saida/)
  assert.match(html, /Depois — retorno/)
  assert.match(html, /Manutencao: SIM/)
  assert.match(html, /Manutencao: NAO/)
  assert.match(html, /Pastilha e disco trocados/)
  assert.match(html, /Pastilha no limite/)
  assert.match(html, /Proxima preventiva/)
  assert.match(html, /15\/03\/2027/)

  // CPF mascarado: quatro digitos bastam para conferir quem e.
  assert.match(html, /\d{3}\.\*\*\*\.\*\*\*-\d{2}/)
  assert.doesNotMatch(html, /111\.222\.333-96|11122233396/, 'o CPF inteiro nao pode sair no papel')

  // Quem gerou fica no rodape, como no documento do PROLOG.
  assert.match(html, /Gerado por/)
})

test('dossie de preventiva: colaborador nao abre, e outra empresa nem enxerga', async () => {
  const vendas = await entrar('vendas.a@teste.local')
  const frotaB = await entrar('frota.b@teste.local')
  const prev = criarPreventivaComModelo(empresaA, veiculoA2, modeloPreventivaA)

  const doColaborador = await fetch(`${base}/relatorio/preventiva/${prev}`, {
    headers: { authorization: `Bearer ${vendas}` },
  })
  assert.equal(doColaborador.status, 403)

  const deOutraEmpresa = await fetch(`${base}/relatorio/preventiva/${prev}`, {
    headers: { authorization: `Bearer ${frotaB}` },
  })
  assert.equal(deOutraEmpresa.status, 404)
})

// ------------------------------------------- criterio: notificacoes

const naoLidas = async (token) =>
  (await chamar('GET', '/api/notificacoes', { token })).dados.nao_lidas

test('notificacao: pedido novo avisa a frota, e nao avisa quem pediu', async () => {
  const colaborador = await entrar('vendas.a@teste.local')
  const frota = await entrar('frota.a@teste.local')

  const antes = await naoLidas(frota)
  const pedido = await pedir(colaborador, {
    inicio: daquiAHoras(6000), fim: daquiAHoras(6004),
    motivo: 'Pedido para conferir a notificacao da frota.',
  })
  assert.equal(pedido.status, 200)

  const r = await chamar('GET', '/api/notificacoes', { token: frota })
  assert.equal(r.dados.nao_lidas, antes + 1)
  const nova = r.dados.notificacoes[0]
  assert.match(nova.texto, /pediu um veiculo/)
  assert.equal(nova.destino, 'solicitacoes')
  assert.equal(nova.entidade_id, pedido.dados.solicitacao.id)
  assert.equal(nova.lida_em, null)
})

test('notificacao: ninguem e avisado da propria acao', async () => {
  // Receber aviso do que voce mesmo fez e' ruido, e ruido ensina a ignorar o
  // sino — que e' o pior estrago que uma notificacao pode fazer.
  const frota = await entrar('frota.a@teste.local')
  const antes = await naoLidas(frota)

  // A propria frota pede um carro: ela nao deve receber o proprio aviso.
  await pedir(frota, {
    inicio: daquiAHoras(6100), fim: daquiAHoras(6104),
    motivo: 'A frota pedindo carro para si mesma.',
  })

  const eu = (await chamar('GET', '/api/auth/eu', { token: frota })).dados.usuario
  const r = await chamar('GET', '/api/notificacoes', { token: frota })
  const minhas = r.dados.notificacoes.filter((n) => /A frota pedindo|frota.a/.test(n.texto))
  assert.equal(minhas.length, 0)
  assert.ok(eu.acessa_painel, 'quem pediu aqui e da frota, e mesmo assim nao se auto-notifica')
  assert.equal(await naoLidas(frota), antes, 'a caixa dele nao mexeu')
})

test('notificacao: liberacao e recusa avisam quem pediu', async () => {
  const colaborador = await entrar('vendas.a@teste.local')
  const frota = await entrar('frota.a@teste.local')

  const aprovado = await pedir(colaborador, {
    inicio: daquiAHoras(6200), fim: daquiAHoras(6204), motivo: 'Pedido que sera liberado.',
  })
  await liberar(frota, aprovado.dados.solicitacao.id, veiculoA,
    { motivo_categoria: 'Unico livre na janela.' })

  const recusado = await pedir(colaborador, {
    inicio: daquiAHoras(6300), fim: daquiAHoras(6304), motivo: 'Pedido que sera recusado.',
  })
  await chamar('POST', `/api/solicitacoes/${recusado.dados.solicitacao.id}/recusar`,
    { token: frota, corpo: { motivo: 'Sem carro nessa data.' } })

  const r = await chamar('GET', '/api/notificacoes', { token: colaborador })
  const textos = r.dados.notificacoes.map((n) => n.texto).join(' | ')
  assert.match(textos, /foi liberado: AAA1A11/, 'quem pediu precisa saber QUAL carro')
  assert.match(textos, /foi recusado: Sem carro nessa data/,
    'recusa sem aviso deixa a pessoa esperando um carro que nao vem')
})

test('notificacao: ocorrencia critica no checklist avisa a frota na hora', async () => {
  const frota = await entrar('frota.a@teste.local')
  const motorista = await entrar('motorista.a@teste.local')
  const pedido = await pedir(motorista, {
    inicio: daquiAHoras(6400), fim: daquiAHoras(6404), motivo: 'Pedido que vai achar defeito grave.',
  })
  const liberada = await liberar(frota, pedido.dados.solicitacao.id, veiculoNotificacao,
    { motivo_categoria: 'Carro reservado para este teste.' })
  assert.equal(liberada.status, 200, JSON.stringify(liberada.dados))

  const app = await chamar('GET', '/api/app/inicio', { token: motorista })
  const tarefa = app.dados.tarefas.find((t) => t.solicitacao_id === pedido.dados.solicitacao.id)
  assert.ok(tarefa, 'a tarefa de saida precisa aparecer para quem pediu')

  // Medido AQUI: o proprio pedido ja gerou uma notificacao para a frota, e
  // contar desde antes dele mediria duas coisas de uma vez.
  const antes = await naoLidas(frota)

  await chamar('POST', '/api/inspecoes', {
    token: motorista,
    corpo: {
      cliente_uuid: 'uuid-notif-critica', solicitacao_id: tarefa.solicitacao_id,
      template_id: tarefa.template_id, momento: 'saida',
      respostas: {
        lataria: { desfecho: 'ok', fotos: 1 },
        pneus: { desfecho: 'ocorrencia', opcao_id: 'liso', fotos: 1 },
      },
    },
  })

  const r = await chamar('GET', '/api/notificacoes', { token: frota })
  assert.equal(r.dados.nao_lidas, antes + 1)
  const nova = r.dados.notificacoes[0]
  assert.equal(nova.nivel, 'critico')
  assert.match(nova.texto, /BLOQUEADO/, 'quem libera veiculo precisa saber que um parou')
  assert.equal(nova.destino, 'ocorrencias')
})

test('notificacao: marcar como lida apaga o ponto, uma ou todas', async () => {
  const frota = await entrar('frota.a@teste.local')
  const lista = await chamar('GET', '/api/notificacoes', { token: frota })
  assert.ok(lista.dados.nao_lidas > 1, 'os testes acima deixaram varias')

  const uma = await chamar('POST', '/api/notificacoes/lidas',
    { token: frota, corpo: { id: lista.dados.notificacoes[0].id } })
  assert.equal(uma.dados.nao_lidas, lista.dados.nao_lidas - 1)

  const todas = await chamar('POST', '/api/notificacoes/lidas', { token: frota, corpo: {} })
  assert.equal(todas.dados.nao_lidas, 0)

  // Lida nao some da lista: quem quer reler, rele.
  const depois = await chamar('GET', '/api/notificacoes', { token: frota })
  assert.ok(depois.dados.notificacoes.length > 0)
  assert.ok(depois.dados.notificacoes.every((n) => n.lida_em))
})

test('notificacao: a caixa de entrada e de uma pessoa so', async () => {
  const colaborador = await entrar('vendas.a@teste.local')
  const frota = await entrar('frota.a@teste.local')

  const doColaborador = await chamar('GET', '/api/notificacoes', { token: colaborador })
  const alheia = doColaborador.dados.notificacoes[0]
  assert.ok(alheia, 'o colaborador tem notificacoes proprias')

  // Nem a frota marca a notificacao do outro como lida.
  const r = await chamar('POST', '/api/notificacoes/lidas',
    { token: frota, corpo: { id: alheia.id } })
  assert.equal(r.status, 404)
})

test('notificacao: sem sessao, nao ha caixa de entrada', async () => {
  assert.equal((await chamar('GET', '/api/notificacoes')).status, 401)
})

// ----------------------------------- criterio: checklist nao realizado

test('cobranca: so e cobrado quem usa veiculo todos os dias', async () => {
  // Roadmap 11.2.2. Quem nao usa carro todo dia so faz checklist quando pede
  // um — cobrar dela seria inventar falta.
  const frota = await entrar('frota.a@teste.local')

  // Um dia util qualquer, sem execucao nenhuma: quinta-feira.
  const quinta = '2026-09-03'
  const r = await chamar('GET', `/api/execucoes/faltando?dia=${quinta}`, { token: frota })
  assert.equal(r.status, 200)
  assert.equal(r.dados.exigido, true, 'os modelos diarios da fixture valem de seg a sex')

  const nomes = r.dados.faltantes.map((f) => f.nome)
  assert.ok(!nomes.includes('Vendas A'), 'vendas nao usa carro todo dia')
  assert.ok(!nomes.includes('Bloqueado A'), 'quem nao esta ativo nao e cobrado')
})

test('cobranca: fim de semana nao cobra ninguem', async () => {
  // O relatorio real do PROLOG tem 62 execucoes no sabado e 13 no domingo,
  // contra ~170 nos dias uteis (roadmap 24.1). Cobrar fim de semana criaria
  // ~90 faltas falsas por mes.
  const frota = await entrar('frota.a@teste.local')
  for (const dia of ['2026-09-05', '2026-09-06']) {
    const r = await chamar('GET', `/api/execucoes/faltando?dia=${dia}`, { token: frota })
    assert.equal(r.dados.exigido, false, `${dia} nao deveria exigir checklist`)
    assert.deepEqual(r.dados.faltantes, [])
    assert.equal(r.dados.cobrados, 0)
  }
})

test('cobranca: quem fez sai da lista', async () => {
  const frota = await entrar('frota.a@teste.local')
  const diarista = await entrar('diarista@teste.local', 'diarista2026')

  const hoje = diaLocal()
  const antes = await chamar('GET', `/api/execucoes/faltando?dia=${hoje}`, { token: frota })
  // O teste do checklist avulso ja fez um checklist hoje com este usuario.
  const eu = (await chamar('GET', '/api/auth/eu', { token: diarista })).dados.usuario
  const faltando = antes.dados.faltantes.map((f) => f.usuario_id)
  assert.ok(!faltando.includes(eu.id),
    'quem ja mandou o checklist de hoje nao pode aparecer como faltante')
})

test('cobranca: um checklist por pessoa, nao um por modelo', async () => {
  // O cargo Motorista e' liberado em varios modelos (um por tipo de veiculo).
  // Isso nao vira quatro cobrancas: quem sai com carro faz o diario do carro
  // que pegou.
  const frota = await entrar('frota.a@teste.local')
  const r = await chamar('GET', '/api/execucoes/faltando?dia=2026-09-03', { token: frota })
  const porPessoa = new Map()
  for (const f of r.dados.faltantes) {
    porPessoa.set(f.usuario_id, (porPessoa.get(f.usuario_id) || 0) + 1)
  }
  assert.ok([...porPessoa.values()].every((n) => n === 1),
    'ninguem pode aparecer duas vezes na mesma lista')
  const comVarios = r.dados.faltantes.find((f) => f.modelos.length > 1)
  assert.ok(comVarios, 'a fixture tem cargo liberado em mais de um modelo')
})

test('cobranca: colaborador nao ve quem faltou', async () => {
  const vendas = await entrar('vendas.a@teste.local')
  const r = await chamar('GET', '/api/execucoes/faltando?dia=2026-09-03', { token: vendas })
  assert.equal(r.status, 403)
})

// ------------------------------- criterio: recorrencia da ocorrencia

test('ocorrencia: o detalhe mostra quantas vezes a peca ja deu problema', async () => {
  // E' o dado que muda a conversa: deixa de ser mais uma ocorrencia e vira um
  // problema que o conserto anterior nao resolveu.
  const frota = await entrar('frota.a@teste.local')

  const abrir = (dias) => {
    const id = novoId('ocorrencia')
    executar(
      `INSERT INTO ocorrencias (id, empresa_id, veiculo_id, pergunta_id, descricao,
                                prioridade, status, aberta_em)
       VALUES (?, ?, ?, 'freios', 'Folga no pedal', 'alta', 'encerrada', ?)`,
      [id, empresaA, veiculoA4, new Date(Date.now() - dias * 86400000).toISOString()])
    return id
  }
  abrir(90)
  abrir(45)
  const atual = abrir(1)

  const r = await chamar('GET', `/api/ocorrencias/${atual}`, { token: frota })
  assert.equal(r.status, 200)
  assert.equal(r.dados.recorrencia.length, 2, 'as duas anteriores da MESMA peca no MESMO carro')
  assert.ok(r.dados.recorrencia.every((o) => o.id !== atual), 'a atual nao conta a si mesma')

  // Peca diferente no mesmo carro nao entra na conta.
  const outraPeca = novoId('ocorrencia')
  executar(
    `INSERT INTO ocorrencias (id, empresa_id, veiculo_id, pergunta_id, descricao,
                              prioridade, status, aberta_em)
     VALUES (?, ?, ?, 'lataria', 'Risco', 'baixa', 'aberta', ?)`,
    [outraPeca, empresaA, veiculoA4, agora()])
  const depois = await chamar('GET', `/api/ocorrencias/${atual}`, { token: frota })
  assert.equal(depois.dados.recorrencia.length, 2, 'outra peca nao e recorrencia desta')
})

// ------------------------------ criterio: historico do proprio usuario

// O aplicativo Android precisa responder "o que eu ja mandei?" — sem isso a
// pessoa reenvia o checklist por duvida, e duvida sobre envio e' a origem de
// metade das duplicatas do PROLOG. As duas rotas existiam sem teste e sem
// documentacao; entram no contrato agora.

test('historico: o colaborador so enxerga os proprios checklists', async () => {
  const frota = await entrar('frota.a@teste.local')
  const motorista = await entrar('motorista.a@teste.local')

  const meu = await chamar('GET', '/api/inspecoes', { token: motorista })
  assert.equal(meu.status, 200)
  assert.ok(meu.dados.inspecoes.length, 'o motorista ja mandou checklist nos testes anteriores')

  const eu = (await chamar('GET', '/api/auth/eu', { token: motorista })).dados.usuario
  assert.ok(meu.dados.inspecoes.every((i) => i.usuario_id === eu.id),
    'checklist de outra pessoa nao pode aparecer no historico de ninguem')

  // A Frota ve os de todo mundo: e' ela que confere o dia.
  const daFrota = await chamar('GET', '/api/inspecoes', { token: frota })
  assert.ok(daFrota.dados.inspecoes.length > meu.dados.inspecoes.length,
    'a Frota enxerga alem dos proprios')
})

test('historico: filtra por veiculo e por momento', async () => {
  const frota = await entrar('frota.a@teste.local')

  const doCarro = await chamar('GET', `/api/inspecoes?veiculo_id=${veiculoA4}`, { token: frota })
  assert.ok(doCarro.dados.inspecoes.length)
  assert.ok(doCarro.dados.inspecoes.every((i) => i.veiculo_id === veiculoA4))

  const retornos = await chamar('GET', '/api/inspecoes?momento=retorno', { token: frota })
  assert.ok(retornos.dados.inspecoes.length)
  assert.ok(retornos.dados.inspecoes.every((i) => i.momento === 'retorno'))

  // Momento inventado nao filtra nada nem quebra: e' parametro de URL, e URL
  // vem do mundo.
  const invalido = await chamar('GET', '/api/inspecoes?momento=voando', { token: frota })
  assert.equal(invalido.status, 200)
  assert.equal(invalido.dados.inspecoes.length,
    (await chamar('GET', '/api/inspecoes', { token: frota })).dados.inspecoes.length)
})

test('historico: o detalhe traz a estrutura da versao usada, nao a de hoje', async () => {
  // O modelo muda; o checklist enviado nao. Sem isso, uma pergunta removida
  // hoje apagaria a resposta dada mes passado — e o app mostraria um checklist
  // que ninguem respondeu.
  //
  // A prova precisa de uma v2 publicada: e' so com ela no banco que a consulta
  // tem duas estruturas para escolher. Modelo proprio, sem carona em fixture,
  // porque publicar a v2 arquiva a v1.
  const frota = await entrar('frota.a@teste.local')
  const v1 = (await chamar('POST', '/api/templates', {
    token: frota,
    corpo: {
      codigo: 'hist-versao', nome: 'Historico versionado', tipo_veiculo: 'compacto_leve',
      cargos_liberados: ['*'], estrutura: ESTRUTURA,
    },
  })).dados.template
  await chamar('POST', `/api/templates/${v1.id}/publicar`, { token: frota })

  // A inspecao nasce apontando para a v1. Inserida direto: o que esta em
  // julgamento e' a leitura, nao o envio.
  const antiga = novoId('inspecao')
  const quandoFoi = new Date(Date.now() - 30 * 86400000).toISOString()
  executar(
    `INSERT INTO inspecoes (id, empresa_id, veiculo_id, usuario_id, template_id,
                            momento, status, resultado, iniciada_em, finalizada_em, criado_em)
     VALUES (?, ?, ?, ?, ?, 'saida', 'finalizada', 'aprovado', ?, ?, ?)`,
    [antiga, empresaA, veiculoA4, frotaA, v1.id, quandoFoi, quandoFoi, quandoFoi])

  // Hoje a v2 tira "pneus" do modelo.
  const v2 = (await chamar('POST', `/api/templates/${v1.id}/versao`, { token: frota })).dados.template
  await chamar('PATCH', `/api/templates/${v2.id}`, {
    token: frota,
    corpo: { estrutura: { perguntas: ESTRUTURA.perguntas.filter((p) => p.id !== 'pneus') } },
  })
  const publicada = await chamar('POST', `/api/templates/${v2.id}/publicar`, { token: frota })
  assert.equal(publicada.status, 200, JSON.stringify(publicada.dados))

  const velho = await chamar('GET', `/api/inspecoes/${antiga}`, { token: frota })
  assert.equal(velho.status, 200)
  assert.equal(velho.dados.inspecao.checklist_versao, 1, 'a inspecao continua sendo da v1')
  assert.ok(velho.dados.estrutura.perguntas.some((p) => p.id === 'pneus'),
    'pergunta removida na v2 nao pode sumir de quem respondeu na v1')

  const motorista = await entrar('motorista.a@teste.local')
  const lista = await chamar('GET', '/api/inspecoes', { token: motorista })
  const alvo = lista.dados.inspecoes[0]

  const r = await chamar('GET', `/api/inspecoes/${alvo.id}`, { token: motorista })
  assert.equal(r.status, 200)
  assert.equal(r.dados.inspecao.id, alvo.id)
  assert.ok(Array.isArray(r.dados.estrutura.perguntas), 'a estrutura vem desmontada')
  assert.equal(r.dados.inspecao.estrutura, undefined, 'estrutura nao volta duas vezes')
  assert.ok(Array.isArray(r.dados.respostas))
  assert.ok(Array.isArray(r.dados.ocorrencias))
})

test('historico: checklist de outra pessoa nega, de outra empresa some', async () => {
  const motorista = await entrar('motorista.a@teste.local')
  const frotaB = await entrar('frota.b@teste.local')

  const lista = await chamar('GET', '/api/inspecoes', { token: motorista })
  const alvo = lista.dados.inspecoes[0].id

  const outroColaborador = await entrar('vendas.a@teste.local')
  const negado = await chamar('GET', `/api/inspecoes/${alvo}`, { token: outroColaborador })
  assert.equal(negado.status, 403, 'mesma empresa: o colaborador sabe que existe, so nao pode ver')

  // Empresa diferente e' 404, nao 403: 403 confirmaria que o id existe.
  const outraEmpresa = await chamar('GET', `/api/inspecoes/${alvo}`, { token: frotaB })
  assert.equal(outraEmpresa.status, 404)
})

// ================================================ isolamento entre empresas
//
// O criterio da revisao de arquitetura: nao basta a tela esconder o recurso.
// O teste chama a API direto, com identificador de outra empresa, e exige que
// a autorizacao falhe.
//
// O atacante e' a Frota B — administradora plena da propria empresa. E' o pior
// caso: quem tem todas as capacidades no seu tenant e nenhuma no alheio.
//
// A resposta correta e' 404 e nao 403: 403 confirmaria que o identificador
// existe, e "esse veiculo existe em alguma empresa" ja e' informacao.

// Junta um alvo de cada tipo dentro da empresa A, direto no banco. Nao passa
// pela API de proposito: o que esta sendo testado e' a LEITURA, e criar pela
// API amarraria este teste as regras de criacao.
function alvosDaEmpresaA() {
  const ts = agora()

  const ocorrencia = novoId('ocorrencia')
  executar(
    `INSERT INTO ocorrencias (id, empresa_id, veiculo_id, pergunta_id, descricao,
                              prioridade, status, aberta_em)
     VALUES (?, ?, ?, 'lataria', 'Alvo de teste', 'baixa', 'aberta', ?)`,
    [ocorrencia, empresaA, veiculoA4, ts])

  const inspecao = novoId('inspecao')
  executar(
    `INSERT INTO inspecoes (id, empresa_id, veiculo_id, usuario_id, template_id,
                            momento, status, resultado, iniciada_em, finalizada_em, criado_em)
     VALUES (?, ?, ?, ?,
             (SELECT id FROM templates WHERE empresa_id = ? AND codigo = 'compacto' LIMIT 1),
             'saida', 'finalizada', 'aprovado', ?, ?, ?)`,
    [inspecao, empresaA, veiculoA4, frotaA, empresaA, ts, ts, ts])

  const evidencia = novoId('evidencia')
  executar(
    `INSERT INTO evidencias (id, empresa_id, veiculo_id, inspecao_id, pergunta_id,
                             usuario_id, tipo_mime, caminho, bytes, capturado_em, criado_em)
     VALUES (?, ?, ?, ?, 'lataria', ?, 'image/jpeg', 'a/b/c/d/e.jpg', 10, ?, ?)`,
    [evidencia, empresaA, veiculoA4, inspecao, frotaA, ts, ts])

  const notificacao = novoId('notificacao')
  executar(
    `INSERT INTO notificacoes (id, empresa_id, destinatario_id, tipo, nivel, texto, criado_em)
     VALUES (?, ?, ?, 'ocorrencia', 'critico', 'Aviso da empresa A', ?)`,
    [notificacao, empresaA, frotaA, ts])

  // O modelo da empresa A nao esta guardado numa constante: a fixture o cria
  // sem nomear. Busca pelo codigo, que e' estavel.
  const modelo = consultarUm(
    `SELECT id FROM templates WHERE empresa_id = ? AND codigo = 'compacto' LIMIT 1`,
    [empresaA]).id

  return { ocorrencia, inspecao, evidencia, notificacao, modelo }
}

test('isolamento: a Frota de outra empresa nao le nada da empresa A', async () => {
  const invasor = await entrar('frota.b@teste.local')
  const alvo = alvosDaEmpresaA()

  const leituras = [
    ['veiculo', `/api/veiculos/${veiculoA4}`],
    ['usuario', `/api/usuarios/${frotaA}`],
    ['ocorrencia', `/api/ocorrencias/${alvo.ocorrencia}`],
    ['inspecao', `/api/inspecoes/${alvo.inspecao}`],
    ['evidencia', `/api/evidencias/${alvo.evidencia}`],
    ['modelo', `/api/templates/${alvo.modelo}`],
    ['relatorio', `/relatorio/inspecao/${alvo.inspecao}`],
  ]
  for (const [nome, caminho] of leituras) {
    const r = await chamar('GET', caminho, { token: invasor })
    assert.equal(r.status, 404, `${nome}: ${caminho} devolveu ${r.status}, devia ser 404`)
  }
})

test('isolamento: nem escreve — tratar, atribuir, bloquear veiculo, publicar modelo', async () => {
  const invasor = await entrar('frota.b@teste.local')
  const alvo = alvosDaEmpresaA()

  const escritas = [
    ['bloquear veiculo', 'POST', `/api/veiculos/${veiculoA4}/status`,
      { status: 'bloqueado', motivo: 'invasao' }],
    ['editar veiculo', 'PATCH', `/api/veiculos/${veiculoA4}`, { modelo: 'Sequestrado' }],
    ['tratar ocorrencia', 'POST', `/api/ocorrencias/${alvo.ocorrencia}/status`,
      { status: 'encerrada', resolucao: 'fechada por fora' }],
    ['atribuir ocorrencia', 'POST', `/api/ocorrencias/${alvo.ocorrencia}/atribuir`,
      { responsavel_id: frotaA }],
    ['editar modelo', 'PATCH', `/api/templates/${alvo.modelo}`, { nome: 'Sequestrado' }],
    ['nova versao do modelo', 'POST', `/api/templates/${alvo.modelo}/versao`, {}],
    ['renomear usuario', 'PATCH', `/api/usuarios/${frotaA}`, { nome: 'Invadido' }],
    ['gerar senha de usuario', 'POST', `/api/usuarios/${frotaA}/senha`, {}],
  ]
  for (const [nome, metodo, caminho, corpo] of escritas) {
    const r = await chamar(metodo, caminho, { token: invasor, corpo })
    assert.equal(r.status, 404, `${nome}: devolveu ${r.status}, devia ser 404`)
  }

  // E o alvo continua intacto: nao basta a resposta ser 404 se o efeito passou.
  const veiculo = consultarUm('SELECT status, modelo FROM veiculos WHERE id = ?', [veiculoA4])
  assert.notEqual(veiculo.modelo, 'Sequestrado')
  const o = consultarUm('SELECT status FROM ocorrencias WHERE id = ?', [alvo.ocorrencia])
  assert.equal(o.status, 'aberta', 'a ocorrencia da empresa A nao pode ter sido encerrada')
  const u = consultarUm('SELECT nome FROM usuarios WHERE id = ?', [frotaA])
  assert.notEqual(u.nome, 'Invadido')
})

test('isolamento: as listas nunca vazam uma linha da outra empresa', async () => {
  const invasor = await entrar('frota.b@teste.local')
  alvosDaEmpresaA()

  const listas = [
    ['veiculos', '/api/veiculos', 'veiculos'],
    ['usuarios', '/api/usuarios', 'usuarios'],
    ['ocorrencias', '/api/ocorrencias', 'ocorrencias'],
    ['solicitacoes', '/api/solicitacoes', 'solicitacoes'],
    ['modelos', '/api/templates', 'templates'],
    ['inspecoes', '/api/inspecoes', 'inspecoes'],
    ['cargos', '/api/cargos', 'cargos'],
    ['categorias', '/api/categorias', 'categorias'],
    ['auditoria', '/api/auditoria', 'eventos'],
  ]
  for (const [nome, caminho, chave] of listas) {
    const r = await chamar('GET', caminho, { token: invasor })
    assert.equal(r.status, 200, `${nome} devia responder para a Frota B`)
    const linhas = r.dados[chave]
    assert.ok(Array.isArray(linhas), `${nome}: esperava um array em "${chave}"`)
    for (const linha of linhas) {
      assert.notEqual(linha.empresa_id, empresaA, `${nome} vazou uma linha da empresa A`)
      if (linha.placa) {
        assert.ok(!String(linha.placa).startsWith('AAA'),
          `${nome} vazou a placa ${linha.placa}`)
      }
    }
  }
})

test('isolamento: a exportacao em planilha tambem respeita o tenant', async () => {
  // A planilha e' o caminho mais facil de esquecer: ela nao passa pela tela.
  const invasor = await entrar('frota.b@teste.local')
  const r = await chamar('GET', '/api/execucoes.csv?de=2020-01-01&ate=2030-01-01',
    { token: invasor })
  assert.equal(r.status, 200)
  const texto = typeof r.dados === 'string' ? r.dados : JSON.stringify(r.dados)
  assert.ok(!texto.includes('AAA'), 'a planilha da empresa B trouxe placa da empresa A')
})

test('isolamento: notificacao de outra pessoa nao pode ser marcada como lida', async () => {
  const invasor = await entrar('frota.b@teste.local')
  const alvo = alvosDaEmpresaA()

  const r = await chamar('POST', '/api/notificacoes/lidas',
    { token: invasor, corpo: { id: alvo.notificacao } })
  assert.equal(r.status, 404)

  const n = consultarUm('SELECT lida_em FROM notificacoes WHERE id = ?', [alvo.notificacao])
  assert.equal(n.lida_em, null, 'o aviso da empresa A continua nao lido')

  // E "marcar todas" so alcanca as proprias.
  await chamar('POST', '/api/notificacoes/lidas', { token: invasor, corpo: {} })
  const depois = consultarUm('SELECT lida_em FROM notificacoes WHERE id = ?', [alvo.notificacao])
  assert.equal(depois.lida_em, null, '"marcar todas" atravessou a fronteira da empresa')
})

// ============================================== freio de tentativas repetidas

const { zerarFreio, LIMITES } = await import('../src/seguranca/freio.js')

test('freio: a troca de senha tem limite — sessao roubada nao adivinha a conta', async () => {
  // A rota pede a senha ATUAL e nao tinha freio nenhum. Quem pegasse uma sessao
  // aberta — celular esquecido destravado no patio — poderia chutar a senha
  // atual a vontade ate assumir a conta de vez.
  const frota = await entrar('frota.a@teste.local')
  const criado = await chamar('POST', '/api/usuarios', {
    token: frota,
    corpo: {
      nome: 'Alvo do Freio', cpf: '33344455508', email: 'freio.senha@teste.local',
      telefone: '(31) 90000-0099', cargo_id: cgMotoristaA, acessa_painel: false,
    },
  })
  assert.equal(criado.status, 200, JSON.stringify(criado.dados))
  const vitima = await entrar('freio.senha@teste.local', criado.dados.senha_inicial)

  try {
    const chutar = (senha_atual) => chamar('POST', '/api/auth/senha',
      { token: vitima, corpo: { senha_atual, senha_nova: 'SenhaNova#2026' } })

    for (let i = 0; i < LIMITES.senha; i += 1) {
      const r = await chutar(`chute-${i}`)
      assert.equal(r.status, 401, `tentativa ${i + 1} devia ser recusada por senha errada`)
    }

    const barrada = await chutar('mais-um-chute')
    assert.equal(barrada.status, 429, 'depois do limite, para de responder ao chute')
    assert.equal(barrada.dados.erro, 'muitas_tentativas')
    assert.match(barrada.dados.mensagem, /minuto/)

    // A senha certa tambem para. E' o preco de travar a conta, e ele so e' pago
    // por quem ja esta com uma sessao aberta na mao.
    const comASenhaCerta = await chutar(criado.dados.senha_inicial)
    assert.equal(comASenhaCerta.status, 429)

    // Passada a janela, volta ao normal — o freio segura, nao mata a conta.
    zerarFreio()
    const depois = await chutar(criado.dados.senha_inicial)
    assert.equal(depois.status, 200, JSON.stringify(depois.dados))
  } finally {
    zerarFreio()
  }
})

test('freio: a segunda-feira de manha do escritorio nao parece um ataque', async () => {
  // A frota inteira sai do mesmo IP. Algumas pessoas erram a propria senha
  // algumas vezes cada — quatro pessoas, cinco erros: vinte falhas, mais que o
  // limite por IP. Se ele contasse FALHAS, a operacao inteira travava as 7h.
  // Contando EMAILS DISTINTOS, sao quatro, e nada acontece.
  const atrapalhados = [
    'motorista.a@teste.local', 'vendas.a@teste.local',
    'mecanico.a@teste.local', 'pendente.a@teste.local',
  ]
  const ERROS_CADA = 5
  assert.ok(atrapalhados.length * ERROS_CADA > LIMITES.loginPorIp,
    'o cenario precisa passar do limite por IP em FALHAS, senao nao distingue as duas contagens')
  assert.ok(ERROS_CADA < LIMITES.login, 'e ficar abaixo do limite por conta')

  try {
    for (const email of atrapalhados) {
      for (let i = 0; i < ERROS_CADA; i += 1) {
        const r = await chamar('POST', '/api/auth/login', { corpo: { email, senha: `errada-${i}` } })
        assert.equal(r.status, 401, `${email} devia so falhar, ainda dentro do limite da conta`)
      }
    }

    // O colega seguinte, no mesmo IP, entra normalmente.
    const colega = await chamar('POST', '/api/auth/login',
      { corpo: { email: 'frota.a@teste.local', senha: SENHA } })
    assert.equal(colega.status, 200,
      'vinte erros de quatro pessoas nao podem trancar a quinta')

    // E quem errou tambem entra, assim que acertar.
    const acertou = await chamar('POST', '/api/auth/login',
      { corpo: { email: 'vendas.a@teste.local', senha: SENHA } })
    assert.equal(acertou.status, 200)
  } finally {
    zerarFreio()
  }
})

test('freio: varrer muitos emails do mesmo lugar e barrado', async () => {
  // A assinatura da credencial vazada e' o contrario da anterior: uma senha so,
  // espalhada por centenas de contas. Nunca repete email, entao o freio por
  // conta nunca dispara — quem tem que ver isso e' a contagem por IP, e ela
  // conta EMAILS DISTINTOS.
  try {
    for (let i = 0; i < LIMITES.loginPorIp; i += 1) {
      const r = await chamar('POST', '/api/auth/login',
        { corpo: { email: `varredura-${i}@teste.local`, senha: 'senha123' } })
      assert.equal(r.status, 401, `o email ${i} devia so falhar, ainda dentro do limite`)
    }

    // Email novo, primeira tentativa dele: barrado pelo IP, nao pela conta.
    const barrado = await chamar('POST', '/api/auth/login',
      { corpo: { email: 'varredura-nova@teste.local', senha: 'senha123' } })
    assert.equal(barrado.status, 429)

    // E o freio por IP nao deixa nem quem sabe a senha entrar daquele lugar
    // enquanto a varredura estiver em curso.
    const legitimo = await chamar('POST', '/api/auth/login',
      { corpo: { email: 'frota.a@teste.local', senha: SENHA } })
    assert.equal(legitimo.status, 429)
  } finally {
    zerarFreio()
  }
})

// ======================= o checklist vale a hora em que foi FEITO

test('offline: a hora do checklist e a do patio, nao a da sincronizacao', async () => {
  // O caso real: preencheu as 07h50 no galpao sem sinal, so pegou rede as 14h.
  // O servidor carimbava a hora do recebimento, entao o checklist virava
  // "atrasado" com prazo das 08h30 — e quem fez no fim da noite caia no dia
  // seguinte, sumindo do dia certo e virando falta no relatorio de quem nao fez.
  const frota = await entrar('frota.a@teste.local')
  const diarista = await entrar('diarista@teste.local', 'diarista2026')

  const app = await chamar('GET', '/api/app/inicio', { token: diarista })
  const escolhido = app.dados.avulso[0]
  assert.ok(escolhido, 'o diarista escolhe o carro no galpao: precisa haver um');

  // 07h50 de HOJE, na hora da operacao.
  const hoje = diaLocal()
  const inicio = new Date(`${hoje}T07:40:00`)
  const fim = new Date(`${hoje}T07:50:00`)

  const envio = await chamar('POST', '/api/inspecoes', {
    token: diarista,
    corpo: {
      cliente_uuid: 'uuid-hora-do-patio',
      template_id: escolhido.templates[0], veiculo_id: escolhido.veiculo.id, momento: 'saida',
      iniciada_em: inicio.toISOString(),
      finalizada_em: fim.toISOString(),
      respostas: { lataria: { desfecho: 'ok' }, pneus: { desfecho: 'ok' } },
    },
  })
  assert.equal(envio.status, 200, JSON.stringify(envio.dados))
  assert.equal(envio.dados.inspecao.finalizada_em, fim.toISOString(),
    'o servidor tem que guardar a hora em que a pessoa terminou, nao a do recebimento')
  assert.equal(envio.dados.inspecao.iniciada_em, inicio.toISOString())

  // E a consequencia que importa: com o prazo das 08h30, isso e' no prazo.
  const lista = await chamar('GET', `/api/execucoes?de=${hoje}&ate=${hoje}`, { token: frota })
  const linha = lista.dados.execucoes.find((e) => e.id === envio.dados.inspecao.id)
  assert.ok(linha, 'o checklist tem que cair no dia em que foi feito')
  assert.equal(linha.prazo, 'no_prazo',
    'feito as 07h50 com prazo ate 08h30 nao pode aparecer como atrasado')
})

test('offline: relogio do aparelho fora da janela cai para a hora do recebimento', async () => {
  // Relogio de celular atrasa, adianta e pode ser mexido. Aceitar o instante
  // nao pode virar aceitar qualquer coisa.
  const frota = await entrar('frota.a@teste.local')
  const diarista = await entrar('diarista@teste.local', 'diarista2026')
  const app = await chamar('GET', '/api/app/inicio', { token: diarista })
  const escolhido = app.dados.avulso[0]

  const daquiATresDias = new Date(Date.now() + 3 * 86400000).toISOString()
  const envio = await chamar('POST', '/api/inspecoes', {
    token: diarista,
    corpo: {
      cliente_uuid: 'uuid-relogio-no-futuro',
      template_id: escolhido.templates[0], veiculo_id: escolhido.veiculo.id, momento: 'saida',
      finalizada_em: daquiATresDias,
      respostas: { lataria: { desfecho: 'ok' }, pneus: { desfecho: 'ok' } },
    },
  })
  assert.equal(envio.status, 200, 'a inspecao aconteceu no mundo: nao se recusa por causa do relogio')
  assert.notEqual(envio.dados.inspecao.finalizada_em, daquiATresDias)
  assert.ok(new Date(envio.dados.inspecao.finalizada_em).getTime() <= Date.now() + 1000,
    'sem isto, um checklist no futuro nunca apareceria em nenhum filtro de periodo')

  // E fica o rastro de que a hora informada nao foi usada.
  const auditoria = await chamar('GET', '/api/auditoria?acao=inspecao.relogio_recusado',
    { token: frota })
  const evento = auditoria.dados.eventos.find((e) => e.entidade_id === envio.dados.inspecao.id)
  assert.ok(evento, 'recusar a hora informada sem registrar seria apagar a divergencia')
  assert.equal(evento.depois.finalizada.motivo, 'no_futuro')
})

test('offline: terminar antes de comecar nao passa', async () => {
  const diarista = await entrar('diarista@teste.local', 'diarista2026')
  const app = await chamar('GET', '/api/app/inicio', { token: diarista })
  const escolhido = app.dados.avulso[0]

  const inicio = new Date(Date.now() - 3600_000).toISOString()
  const fimImpossivel = new Date(Date.now() - 7200_000).toISOString()
  const envio = await chamar('POST', '/api/inspecoes', {
    token: diarista,
    corpo: {
      cliente_uuid: 'uuid-fim-antes-do-inicio',
      template_id: escolhido.templates[0], veiculo_id: escolhido.veiculo.id, momento: 'saida',
      iniciada_em: inicio, finalizada_em: fimImpossivel,
      respostas: { lataria: { desfecho: 'ok' }, pneus: { desfecho: 'ok' } },
    },
  })
  assert.equal(envio.status, 200)
  assert.equal(envio.dados.inspecao.finalizada_em, inicio,
    'duracao negativa quebraria o dossie e o calculo de tempo de checklist')
})

// ============== o contrato tem significado, e nao so forma (docs/API.md 5)

test('contrato: o resultado que o aplicativo manda nao entra na conta', async () => {
  // "O julgamento e' do servidor" e' a afirmacao mais repetida do projeto —
  // D17, roadmap 12, secao 5 da API. Nao havia um teste que MENTISSE e
  // provasse que a mentira nao passa.
  //
  // Um cliente adulterado, ou so velho demais, e' o caso realista: uma versao
  // antiga do app com regra desatualizada julga "aprovado" o que a regra de
  // hoje reprova.
  const frota = await entrar('frota.a@teste.local')
  const motorista = await entrar('motorista.a@teste.local')
  const solicitacao = await reservar(frota, motorista, veiculoContrato, 800)
  const app = await chamar('GET', '/api/app/inicio', { token: motorista })
  const tarefa = app.dados.tarefas.find((t) => t.solicitacao_id === solicitacao)

  const envio = await chamar('POST', '/api/inspecoes', {
    token: motorista,
    corpo: {
      cliente_uuid: 'uuid-mentira-do-cliente', solicitacao_id: solicitacao,
      template_id: tarefa.template_id, momento: 'saida',
      // Tudo o que um cliente mentiroso mandaria:
      resultado: 'aprovado',
      estado_veiculo_previsto: 'disponivel',
      resumo: { resultado: 'aprovado', ocorrencias: [], pode_finalizar: true },
      ocorrencias: [],
      respostas: {
        lataria: { desfecho: 'ok', fotos: 1 },
        // ...enquanto a resposta real diz pneu liso, que e' critico.
        pneus: { desfecho: 'ocorrencia', opcao_id: 'liso', fotos: 1 },
      },
    },
  })
  assert.equal(envio.status, 200, JSON.stringify(envio.dados))

  assert.notEqual(envio.dados.resumo.resultado, 'aprovado',
    'o servidor aceitou o julgamento do cliente')
  assert.equal(envio.dados.inspecao.resultado, envio.dados.resumo.resultado,
    'o que fica gravado e o que o servidor julgou')
  assert.equal(envio.dados.resumo.maior_prioridade, 'critica')
  assert.equal(envio.dados.resumo.ocorrencias.length, 1,
    'a ocorrencia nasce do julgamento do servidor, nao da lista que o cliente mandou')

  // E o efeito no mundo tambem e' do servidor: o carro fica bloqueado, mesmo
  // com o cliente afirmando "disponivel".
  const veiculo = await chamar('GET', `/api/veiculos/${veiculoContrato}`, { token: frota })
  assert.equal(veiculo.dados.veiculo.status, 'bloqueado')
})

test('contrato: momento so aceita saida e retorno', async () => {
  const motorista = await entrar('motorista.a@teste.local')
  const app = await chamar('GET', '/api/app/inicio', { token: motorista })
  const tarefa = app.dados.tarefas[0]
  assert.ok(tarefa, 'precisa de uma tarefa aberta para este teste')

  const r = await chamar('POST', '/api/inspecoes', {
    token: motorista,
    corpo: {
      cliente_uuid: 'uuid-momento-invalido', solicitacao_id: tarefa.solicitacao_id,
      template_id: tarefa.template_id, momento: 'meio_do_caminho',
      respostas: {},
    },
  })
  assert.equal(r.status, 400)
  assert.match(r.dados.mensagem, /saida ou retorno/,
    'a mensagem tem que dizer o que vale, nao so que o valor e invalido')
})

test('contrato: o resumo traz os campos que o aplicativo le', async () => {
  // O app decide o que mostrar na tela final a partir daqui. Campo que some do
  // resumo vira `undefined` na tela de quem esta no patio.
  const frota = await entrar('frota.a@teste.local')
  const motorista = await entrar('motorista.a@teste.local')
  const solicitacao = await reservar(frota, motorista, veiculoContrato2, 810)
  const app = await chamar('GET', '/api/app/inicio', { token: motorista })
  const tarefa = app.dados.tarefas.find((t) => t.solicitacao_id === solicitacao)

  const envio = await chamar('POST', '/api/inspecoes', {
    token: motorista,
    corpo: {
      cliente_uuid: 'uuid-forma-do-resumo', solicitacao_id: solicitacao,
      template_id: tarefa.template_id, momento: 'saida',
      respostas: { lataria: { desfecho: 'ok', fotos: 1 }, pneus: { desfecho: 'ok', fotos: 1 } },
    },
  })
  assert.equal(envio.status, 200, JSON.stringify(envio.dados))

  for (const campo of ['resultado', 'conformes', 'ocorrencias',
    'maior_prioridade', 'estado_veiculo_previsto', 'pode_finalizar']) {
    assert.ok(campo in envio.dados.resumo, `o resumo documentado tem ${campo}`)
  }
  assert.ok(Array.isArray(envio.dados.resumo.ocorrencias))
  assert.ok(Number.isInteger(envio.dados.inspecao.numero) && envio.dados.inspecao.numero > 0,
    'numero e sequencial por empresa, e e o que a operacao cita em voz alta')
})

test('contrato: /api/app/inicio nao cita nenhum modelo que ele mesmo nao mande', async () => {
  // A promessa da rota e' "tudo que o aplicativo precisa para funcionar offline
  // pelo resto do dia". A versao testavel disso e' um invariante: toda tarefa,
  // preventiva e carro avulso aponta para um `template_id`, e TODOS eles tem
  // que estar em `modelos`, com a estrutura junto.
  //
  // Faltar um nao da erro em lugar nenhum: da' um checklist que abre no patio,
  // sem sinal, sem pergunta nenhuma. E' a pior falha possivel da promessa
  // offline, porque acontece longe de qualquer tela que pudesse avisar.
  const vistos = { tarefas: 0, preventivas: 0, avulso: 0 }

  const conferir = async (email, senha) => {
    const token = await entrar(email, senha)
    const r = await chamar('GET', '/api/app/inicio', { token })
    assert.equal(r.status, 200, `${email}: ${JSON.stringify(r.dados)}`)
    const d = r.dados

    assert.ok(d.politicas, `${email}: politicas fazem parte do contexto offline`)
    assert.ok(d.gerado_em, `${email}: sem gerado_em o app nao sabe se a copia esta velha`)

    const disponiveis = new Set(d.modelos.map((m) => m.id))
    for (const m of d.modelos) {
      assert.ok(Array.isArray(m.estrutura?.perguntas),
        `${email}: modelo ${m.codigo} veio sem estrutura — abriria vazio no patio`)
    }

    const citados = [
      ...d.tarefas.map((t) => ['tarefa', t.template_id]),
      ...d.preventivas.map((t) => ['preventiva', t.template_id]),
      ...d.avulso.flatMap((a) => a.templates.map((id) => ['avulso', id])),
    ]
    vistos.tarefas += d.tarefas.length
    vistos.preventivas += d.preventivas.length
    vistos.avulso += d.avulso.length

    for (const [origem, id] of citados) {
      assert.ok(disponiveis.has(id),
        `${email}: ${origem} aponta para o modelo ${id}, que nao veio em "modelos"`)
    }
  }

  await conferir('motorista.a@teste.local', SENHA)
  await conferir('mecanico.a@teste.local', SENHA)
  await conferir('diarista@teste.local', 'diarista2026')

  // O teste nao pode passar por nao ter exercitado nada.
  assert.ok(vistos.tarefas > 0, 'nenhuma tarefa apareceu: o invariante nao foi exercitado')
  assert.ok(vistos.preventivas > 0, 'nenhuma preventiva apareceu')
  assert.ok(vistos.avulso > 0, 'nenhum avulso apareceu')
})

test('contrato: o contexto offline nao traz modelo de outra empresa', async () => {
  const token = await entrar('motorista.a@teste.local')
  const r = await chamar('GET', '/api/app/inicio', { token })
  for (const m of r.dados.modelos) {
    const dono = consultarUm('SELECT empresa_id FROM templates WHERE id = ?', [m.id])
    assert.equal(dono.empresa_id, empresaA, `o modelo ${m.codigo} e de outra empresa`)
  }
})

test('devolucao: a Frota registra quando o motorista nao pode', async () => {
  // A devolucao normal e' do motorista, no aplicativo, junto com o retorno.
  // Mas celular sem bateria, sem sinal, ou pessoa que saiu da empresa deixariam
  // o pedido em_uso para sempre: a placa segue ocupada na agenda e `cancelar`
  // nao alcanca esse estado. O servidor sempre permitiu a Frota; faltava a
  // porta no painel.
  const frota = await entrar('frota.a@teste.local')
  const motorista = await entrar('motorista.a@teste.local')
  const solicitacao = await reservar(frota, motorista, veiculoContrato2, 900)

  // Saida coloca o pedido em uso.
  const app = await chamar('GET', '/api/app/inicio', { token: motorista })
  const tarefa = app.dados.tarefas.find((t) => t.solicitacao_id === solicitacao)
  await chamar('POST', '/api/inspecoes', {
    token: motorista,
    corpo: {
      cliente_uuid: 'uuid-devolucao-frota', solicitacao_id: solicitacao,
      template_id: tarefa.template_id, momento: 'saida',
      respostas: { lataria: { desfecho: 'ok' }, pneus: { desfecho: 'ok' } },
    },
  })

  const conferencia = await chamar('GET', `/api/solicitacoes/${solicitacao}/devolucao`,
    { token: frota })
  assert.equal(conferencia.status, 200, 'a Frota consulta o prazo antes de registrar')
  assert.equal(conferencia.dados.atrasada, false, 'a janela deste pedido ainda nao venceu')

  // Antes: um colaborador que nao e o solicitante nao devolve o pedido alheio.
  // A permissao abre para a Frota, nao para qualquer um.
  const estranho = await entrar('vendas.a@teste.local')
  const negado = await chamar('POST', `/api/solicitacoes/${solicitacao}/devolver`,
    { token: estranho })
  assert.equal(negado.status, 403, 'pedido de outra pessoa nao se devolve')

  const r = await chamar('POST', `/api/solicitacoes/${solicitacao}/devolver`, { token: frota })
  assert.equal(r.status, 200, JSON.stringify(r.dados))

  const depois = await chamar('GET', `/api/solicitacoes/${solicitacao}`, { token: frota })
  assert.equal(depois.dados.solicitacao.status, 'devolvida')

  // E o carro volta para a agenda.
  const veiculo = await chamar('GET', `/api/veiculos/${veiculoContrato2}`, { token: frota })
  assert.equal(veiculo.dados.veiculo.status, 'disponivel')
})


test('limite: lista grande e cortada, e a resposta diz que cortou', async () => {
  // Uma frota de setenta carros passa de mil pedidos no primeiro ano. Sem teto,
  // a tela baixa o historico inteiro e monta uma tabela de milhares de linhas
  // para alguem que queria ver os de hoje — e pior, sem dizer que aquilo nao e'
  // tudo. Lista cortada em silencio faz quem olha concluir que viu o total.
  const frota = await entrar('frota.a@teste.local')

  for (const [nome, caminho, chave] of [
    ['solicitacoes', '/api/solicitacoes?status=todas', 'solicitacoes'],
    ['ocorrencias', '/api/ocorrencias?status=todas', 'ocorrencias'],
    ['preventivas', '/api/preventivas?historico=1', 'preventivas'],
  ]) {
    const r = await chamar('GET', caminho, { token: frota })
    assert.equal(r.status, 200, `${nome}: ${JSON.stringify(r.dados)}`)
    assert.ok(Number.isInteger(r.dados.limite) && r.dados.limite > 0,
      `${nome}: a resposta precisa dizer qual e o teto`)
    assert.equal(r.dados.total, r.dados[chave].length,
      `${nome}: total tem que ser o tamanho do que veio`)
    assert.ok(r.dados[chave].length <= r.dados.limite,
      `${nome}: veio mais linha que o teto declarado`)
  }
})

test('planilha: exportacao nao pode vir cortada em silencio', async () => {
  // A planilha e' o que se leva para reuniao. Com o mesmo teto da tela — 500 —
  // uma exportacao de tres dias uteis ja vinha cortada, porque o relatorio do
  // PROLOG tem ~170 checklists por dia util. E o arquivo nao dizia nada: quem
  // abrisse concluiria que aquilo era o periodo inteiro.
  const frota = await entrar('frota.a@teste.local')
  const r = await chamar('GET', '/api/execucoes.csv?de=2020-01-01&ate=2030-01-01',
    { token: frota })
  assert.equal(r.status, 200)
  const texto = String(r.dados)

  // O teto da planilha e' proprio, e muito maior que o da tela: um arquivo nao
  // paga o preco de montar DOM.
  const { gerarCsv } = await import('../src/rotas/execucoes.js')
  const cortado = gerarCsv('Empresa', [{ placa: 'AAA1A11' }], true)
  assert.match(cortado, /AVISO: exportacao interrompida/,
    'cortou e nao avisou: a planilha estaria mentindo sobre o proprio tamanho')
  assert.match(cortado, /Estreite o periodo/, 'avisar sem dizer o que fazer nao ajuda')

  const inteiro = gerarCsv('Empresa', [{ placa: 'AAA1A11' }], false)
  assert.ok(!/AVISO/.test(inteiro), 'sem corte, nenhum aviso — senao ele vira ruido')

  // E a exportacao normal, que cabe, nao traz aviso nenhum.
  assert.ok(!/AVISO: exportacao interrompida/.test(texto))
})

test('planilha: o teto dela e proprio, e nao o da tela', async () => {
  // Este e o teste que importa, e a primeira versao dele nao existia: eu havia
  // testado so o AVISO, isoladamente, e ele continuava verde com a rota presa
  // no teto de 500. Provar o mecanismo nao e' provar que ele foi usado.
  //
  // Um periodo de 2019 que nenhum outro teste toca: 600 execucoes ali dentro,
  // acima do teto da tela e abaixo do da planilha.
  const frota = await entrar('frota.a@teste.local')
  const modelo = consultarUm(
    `SELECT id FROM templates WHERE empresa_id = ? AND codigo = 'compacto' LIMIT 1`,
    [empresaA]).id

  transacao(() => {
    for (let i = 0; i < 600; i += 1) {
      const quando = `2019-03-${String((i % 28) + 1).padStart(2, '0')}T12:00:00.000Z`
      executar(
        `INSERT INTO inspecoes (id, empresa_id, veiculo_id, usuario_id, template_id,
                                momento, status, resultado, iniciada_em, finalizada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, 'saida', 'finalizada', 'aprovado', ?, ?, ?)`,
        [novoId('inspecao'), empresaA, veiculoA4, frotaA, modelo, quando, quando, quando])
    }
  })

  const periodo = 'de=2019-03-01&ate=2019-03-31'

  // A TELA corta em 500, e diz que cortou.
  const naTela = await chamar('GET', `/api/execucoes?${periodo}`, { token: frota })
  assert.equal(naTela.dados.execucoes.length, naTela.dados.limite,
    'a tela tinha que ter batido no proprio teto neste periodo')
  assert.ok(naTela.dados.limite < 600)

  // A PLANILHA leva as 600. Um arquivo nao paga o preco de montar DOM.
  // `chamar` faz JSON.parse e devolve {} num CSV: aqui e' preciso o texto.
  const csv = await (await fetch(`${base}/api/execucoes.csv?${periodo}`, {
    headers: { authorization: `Bearer ${frota}` },
  })).text()
  // Sem escape de nova linha no meio de um script gerado: monta a quebra
  // por codigo e evita que ela vire quebra de verdade no arquivo de teste.
  const FIM_DE_LINHA = String.fromCharCode(13, 10)
  const linhas = csv.split(FIM_DE_LINHA).filter((l) => l.includes('2019'))
  assert.equal(linhas.length, 600,
    `a planilha veio com ${linhas.length} de 600 — esta presa no teto da tela`)
  assert.ok(!/AVISO: exportacao interrompida/.test(csv),
    'cabe no teto da planilha: nao ha o que avisar')
})
