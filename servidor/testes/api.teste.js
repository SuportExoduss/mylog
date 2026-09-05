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

const catA = criarCategoria(empresaA, 'Comercial A', [veiculoA, veiculoA2, veiculoA4])
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
function diaLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

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
