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
// Mesma razao, para o teste da saida: ele BLOQUEIA e depois LIBERA o carro de
// proposito, entao nao pode dividir placa com quem depende de estado estavel.
const veiculoSaida = criarVeiculo(empresaA, 'AAA8A88')

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
  [veiculoA, veiculoA2, veiculoA4, veiculoContrato, veiculoContrato2, veiculoSaida])
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

// O vocabulario inteiro da solicitacao, para a varredura de estados nao
// depender de uma lista escrita duas vezes.
const STATUS_SOLICITACAO_TESTE = [
  'pendente', 'aprovada', 'recusada', 'em_uso',
  'devolvida', 'devolvida_com_atraso', 'cancelada',
]
let veiculoSolicitacaoLivre = null

const STATUS_VEICULO_TESTE = ['disponivel', 'com_pendencia', 'manutencao', 'bloqueado']

const daquiAHoras = (h) => new Date(Date.now() + h * 3600000).toISOString()

// AAAA-MM-DD no fuso de quem roda o teste — a mesma conta que o servidor faz.
// O mesmo "hoje" que o servidor usa. Se o teste calculasse o dia pelo fuso do
// processo e o servidor pelo fuso da operacao, os dois discordariam por tres
// horas todo dia — e o teste acusaria o servidor por um erro dele proprio.
const { diaLocal, bordaDoDia } = await import('../src/nucleo/relogio.js')

// Um instante na hora da OPERACAO, e nao na da maquina.
//
// `new Date(ano, mes, dia, 22, 30)` monta 22h30 no fuso do processo. Quando o
// processo e a operacao estao no mesmo fuso — o caso do notebook hoje — os dois
// coincidem e ninguem percebe a diferenca. Quando nao estao, o teste passa a
// afirmar uma coisa e a montar outra: era assim que dois testes ficavam
// vermelhos com MYLOG_FUSO no Pacifico, sem nenhum defeito no servidor.
//
// E' o mesmo erro que a D37 tirou do servidor, sobrevivendo na camada de teste.
function naHoraDaOperacao(diaIso, hora, minuto = 0) {
  const meiaNoite = new Date(bordaDoDia(diaIso)).getTime()
  return new Date(meiaNoite + (hora * 60 + minuto) * 60_000)
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
  acharAlvosDaMatriz()
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

  // Nem a frota. A linha anterior aqui dizia "mas ve a frota, que e o que ele
  // precisa para pedir um carro" e liberava a lista inteira — placa, ano, km,
  // status e motivo do status. Nao e' o que ele precisa: pelo roadmap 10.3 quem
  // pede escolhe CATEGORIA, e `POST /api/solicitacoes` recusa `veiculo_id` com
  // todas as letras. O comentario sobreviveu a regra que o desfez.
  assert.equal((await chamar('GET', '/api/veiculos', { token })).status, 403)
  assert.equal((await chamar('GET', `/api/veiculos/${veiculoA}`, { token })).status, 403)

  // O formulario de pedido dele e' este, e continua aberto: categoria e quantos
  // carros atendem, sem placa nenhuma.
  const categorias = await chamar('GET', '/api/categorias', { token })
  assert.equal(categorias.status, 200)
  assert.ok(categorias.dados.categorias.length > 0)
  assert.ok(!JSON.stringify(categorias.dados).includes('AAA'),
    'a lista de categorias nao pode carregar placa')

  // E a ponte entre categoria e placa e' da Frota.
  assert.equal((await chamar('GET', `/api/categorias/${categorias.dados.categorias[0].id}/veiculos`,
    { token })).status, 403)
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

test('checklist: o atalho de reenvio nao entrega a inspecao de outra pessoa', async () => {
  // O atalho de idempotencia le a inspecao por (empresa, cliente_uuid) e a
  // devolve inteira. As DUAS rotas de leitura filtram por autor — colaborador
  // so ve as suas. Este terceiro caminho nao filtrava: quem apresentasse o uuid
  // de um colega recebia a inspecao dele, com KM, assinatura e desfechos.
  const vendas = await entrar('vendas.a@teste.local')
  const colega = await entrar('motorista.a@teste.local')

  const app = await chamar('GET', '/api/app/inicio', { token: vendas })
  const tarefa = app.dados.tarefas.find((t) => t.momento === 'saida') || app.dados.tarefas[0]
  assert.ok(tarefa, 'a vendedora precisa de alguma tarefa para gerar a inspecao')

  const UUID = 'uuid-atalho-de-outro-0001'
  const minha = await chamar('POST', '/api/inspecoes', {
    token: vendas,
    corpo: {
      cliente_uuid: UUID,
      solicitacao_id: tarefa.solicitacao_id,
      preventiva_id: tarefa.preventiva_id,
      veiculo_id: tarefa.veiculo?.id,
      template_id: tarefa.template_id,
      momento: tarefa.momento,
      respostas: { lataria: { desfecho: 'ok' }, pneus: { desfecho: 'ok' } },
    },
  })
  assert.equal(minha.status, 200, JSON.stringify(minha.dados))

  // O colega reenvia o MESMO uuid. Basta o uuid: o atalho responde antes de
  // qualquer outra validacao do corpo — era exatamente o que o tornava barato.
  const dele = await chamar('POST', '/api/inspecoes', {
    token: colega, corpo: { cliente_uuid: UUID },
  })
  assert.equal(dele.status, 409, 'uuid de outra pessoa e colisao de id, nao reenvio')
  assert.equal(dele.dados.inspecao, undefined, 'e a inspecao alheia nao pode vir junto')

  // Controle: para a dona do uuid, o reenvio continua sendo reenvio.
  const denovo = await chamar('POST', '/api/inspecoes', {
    token: vendas, corpo: { cliente_uuid: UUID },
  })
  assert.equal(denovo.dados.repetida, true)
  assert.equal(denovo.dados.inspecao.id, minha.dados.inspecao.id)
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

test('estado: reaberta a ocorrencia, a pendencia volta', async () => {
  // O contrario do teste acima, e a metade que faltava. "Com pendencia" e'
  // consequencia de ocorrencia aberta: resolver a ultima devolve o carro para
  // disponivel — e reabrir, porque a solucao nao pegou, tem que trazer a
  // pendencia de volta. Sem isso o carro fica com ocorrencia aberta e cara de
  // disponivel: some do filtro do painel e volta a ser oferecido na liberacao.
  //
  // A transicao existe e esta comentada no proprio codigo como "reabrir se a
  // solucao nao pegou" (resolvida -> em_tratamento). So o efeito sobre o
  // veiculo nao vinha junto.
  const frota = await entrar('frota.a@teste.local')
  const motorista = await entrar('motorista.a@teste.local')
  const veiculo = criarVeiculo(empresaA, 'AAA9P99')
  const solicitacao = await reservar(frota, motorista, veiculo, 900)

  const app = await chamar('GET', '/api/app/inicio', { token: motorista })
  const tarefa = app.dados.tarefas.find((t) => t.solicitacao_id === solicitacao)
  assert.ok(tarefa, 'a reserva precisa virar tarefa de saida')

  await chamar('POST', '/api/inspecoes', {
    token: motorista,
    corpo: {
      cliente_uuid: 'uuid-reabrir-0001', solicitacao_id: solicitacao,
      template_id: tarefa.template_id, momento: 'saida',
      respostas: {
        lataria: { desfecho: 'ocorrencia', opcao_id: 'risco', fotos: 1 },
        pneus: { desfecho: 'ok', fotos: 1 },
      },
    },
  })

  await chamar('POST', `/api/veiculos/${veiculo}/status`, {
    token: frota, corpo: { status: 'com_pendencia', motivo: 'Aguardando funilaria.' },
  })

  const fila = await chamar('GET', `/api/ocorrencias?veiculo_id=${veiculo}`, { token: frota })
  assert.equal(fila.dados.ocorrencias.length, 1, 'uma ocorrencia, para o teste ficar legivel')
  const ocorrencia = fila.dados.ocorrencias[0].id

  await chamar('POST', `/api/ocorrencias/${ocorrencia}/status`,
    { token: frota, corpo: { status: 'em_tratamento' } })
  await chamar('POST', `/api/ocorrencias/${ocorrencia}/status`,
    { token: frota, corpo: { status: 'resolvida', resolucao: 'Funilaria feita.' } })

  let atual = await chamar('GET', `/api/veiculos/${veiculo}`, { token: frota })
  assert.equal(atual.dados.veiculo.status, 'disponivel', 'controle: resolvida, o carro liberou')

  // A solucao nao pegou.
  const reaberta = await chamar('POST', `/api/ocorrencias/${ocorrencia}/status`,
    { token: frota, corpo: { status: 'em_tratamento' } })
  assert.equal(reaberta.status, 200, JSON.stringify(reaberta.dados))

  atual = await chamar('GET', `/api/veiculos/${veiculo}`, { token: frota })
  assert.equal(atual.dados.veiculo.status, 'com_pendencia',
    'ocorrencia aberta e carro disponivel nao podem coexistir')
  assert.match(atual.dados.veiculo.motivo_status || '', /ocorr/i,
    'e o motivo tem que dizer de onde veio')
})

test('estado: reabrir ocorrencia nao rebaixa carro bloqueado', async () => {
  // Pendencia e' o degrau mais baixo da escala de restricao. Bloqueio e
  // manutencao sao decisao explicita da Frota, com motivo (roadmap 9.3): se a
  // reabertura escrevesse "com_pendencia" por cima, uma ocorrencia reaberta
  // soltaria um carro bloqueado — exatamente a porta dos fundos que `agrava()`
  // existe para fechar.
  const frota = await entrar('frota.a@teste.local')
  const motorista = await entrar('motorista.a@teste.local')
  const veiculo = criarVeiculo(empresaA, 'AAA9B99')
  const solicitacao = await reservar(frota, motorista, veiculo, 910)

  const app = await chamar('GET', '/api/app/inicio', { token: motorista })
  const tarefa = app.dados.tarefas.find((t) => t.solicitacao_id === solicitacao)

  await chamar('POST', '/api/inspecoes', {
    token: motorista,
    corpo: {
      cliente_uuid: 'uuid-reabrir-0002', solicitacao_id: solicitacao,
      template_id: tarefa.template_id, momento: 'saida',
      respostas: {
        lataria: { desfecho: 'ocorrencia', opcao_id: 'risco', fotos: 1 },
        pneus: { desfecho: 'ok', fotos: 1 },
      },
    },
  })

  const fila = await chamar('GET', `/api/ocorrencias?veiculo_id=${veiculo}`, { token: frota })
  const ocorrencia = fila.dados.ocorrencias[0].id
  await chamar('POST', `/api/ocorrencias/${ocorrencia}/status`,
    { token: frota, corpo: { status: 'em_tratamento' } })
  await chamar('POST', `/api/ocorrencias/${ocorrencia}/status`,
    { token: frota, corpo: { status: 'resolvida', resolucao: 'Feito.' } })

  await chamar('POST', `/api/veiculos/${veiculo}/status`, {
    token: frota, corpo: { status: 'bloqueado', motivo: 'Perda total, aguardando seguradora.' },
  })

  await chamar('POST', `/api/ocorrencias/${ocorrencia}/status`,
    { token: frota, corpo: { status: 'em_tratamento' } })

  const atual = await chamar('GET', `/api/veiculos/${veiculo}`, { token: frota })
  assert.equal(atual.dados.veiculo.status, 'bloqueado', 'reabrir ocorrencia nao desbloqueia carro')
  assert.match(atual.dados.veiculo.motivo_status, /seguradora/,
    'e nao apaga o motivo que a Frota escreveu')
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

  // Uma inspecao gravada as 22h30 de HOJE, na hora da OPERACAO — que e' quem
  // decide onde o dia termina. Montar isso na hora da maquina fazia o teste
  // afirmar uma coisa e preparar outra assim que os dois fusos se afastavam.
  const agora = new Date()
  const noiteLocal = naHoraDaOperacao(diaLocal(agora), 22, 30)
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

test('preventiva: publicar uma versao nova do modelo nao apaga a preventiva vencida', async () => {
  // `/api/app/inicio` monta a lista de preventivas com
  //   JOIN templates t ON t.id = p.template_id ... AND t.status = 'publicado'
  // Publicar a versao 2 arquiva a versao 1 (templates.js). Como a preventiva
  // aponta para a LINHA da versao 1, o JOIN passa a nao casar e a preventiva
  // some da tela do mecanico — sem aviso, sem log, sem virar outra coisa. O
  // carro continua vencido; so ninguem mais e' chamado para leva-lo.
  //
  // Uma edicao de checklist e' rotina da Frota. Ela nao pode desmarcar
  // manutencao.
  const veiculo = criarVeiculo(empresaA, 'AAA9V99')
  const modelo = criarModeloPreventiva(empresaA, 'preventiva-versionada', [cgMecanicoA])
  const preventiva = criarPreventivaComModelo(empresaA, veiculo, modelo)

  const mecanico = await entrar('mecanico.a@teste.local')
  const frota = await entrar('frota.a@teste.local')

  const antes = await chamar('GET', '/api/app/inicio', { token: mecanico })
  assert.ok(antes.dados.preventivas.some((p) => p.preventiva_id === preventiva),
    'controle: antes da nova versao a preventiva aparece')

  // A Frota edita o checklist — rascunho da versao 2 e publicacao.
  const versao = await chamar('POST', `/api/templates/${modelo}/versao`, { token: frota })
  assert.equal(versao.status, 200, JSON.stringify(versao.dados))
  const publicada = await chamar('POST', `/api/templates/${versao.dados.template.id}/publicar`,
    { token: frota })
  assert.equal(publicada.status, 200, JSON.stringify(publicada.dados))

  const arquivada = await chamar('GET', `/api/templates/${modelo}`, { token: frota })
  assert.equal(arquivada.dados.template.status, 'arquivado', 'a versao 1 saiu de cena')

  const depois = await chamar('GET', '/api/app/inicio', { token: mecanico })
  const ainda = depois.dados.preventivas.find((p) => p.preventiva_id === preventiva)
  assert.ok(ainda, 'a preventiva vencida nao pode sumir porque o modelo ganhou versao')

  // E ela continua sendo executada na versao que foi agendada: a saida e o
  // retorno precisam ser o MESMO checklist, ou a comparacao antes/depois do
  // dossie compara perguntas diferentes.
  assert.equal(ainda.template_id, modelo,
    'a preventiva agendada roda a versao com que foi agendada')
})

test('checklist: rascunho nao vira inspecao, mas versao arquivada sim', async () => {
  // Os dois lados da mesma regra.
  //
  // O rascunho nunca passou por `conferirEstrutura` — isso so acontece na
  // publicacao. Pode estar pela metade, e julgar por cima de uma estrutura pela
  // metade e' pior do que recusar.
  //
  // A versao arquivada, ao contrario, passou: e' a versao 1 de um checklist que
  // ganhou a versao 2. Quem encheu o checklist de manha, sem sinal, tem que
  // conseguir subir a tarde — e a preventiva agendada roda ate o fim na versao
  // com que foi agendada.
  //
  // Modelo e carro proprios: publicar versao mexe no ciclo de vida do codigo
  // inteiro, e emprestar o modelo de outro teste bagunca o vizinho.
  const frota = await entrar('frota.a@teste.local')
  const veiculo = criarVeiculo(empresaA, 'AAA9R99')
  const modelo = criarDiario(empresaA, 'rascunho-vs-arquivada', 'compacto_leve')

  const rascunho = await chamar('POST', `/api/templates/${modelo}/versao`, { token: frota })
  assert.equal(rascunho.status, 200, JSON.stringify(rascunho.dados))
  assert.equal(rascunho.dados.template.status, 'rascunho')

  const corpoBase = {
    veiculo_id: veiculo, momento: 'saida', km_informado: 10100,
    respostas: { lataria: { desfecho: 'ok' }, pneus: { desfecho: 'ok' } },
  }

  const comRascunho = await chamar('POST', '/api/inspecoes', {
    token: frota,
    corpo: { ...corpoBase, cliente_uuid: 'uuid-rascunho-0001', template_id: rascunho.dados.template.id },
  })
  assert.equal(comRascunho.status, 409, JSON.stringify(comRascunho.dados))
  assert.match(comRascunho.dados.mensagem, /rascunho/i)

  // Publica a 2 — a 1 vira arquivada.
  const pub = await chamar('POST', `/api/templates/${rascunho.dados.template.id}/publicar`,
    { token: frota })
  assert.equal(pub.status, 200, JSON.stringify(pub.dados))
  const antiga = await chamar('GET', `/api/templates/${modelo}`, { token: frota })
  assert.equal(antiga.dados.template.status, 'arquivado', 'controle: a versao 1 saiu de cena')

  const comArquivada = await chamar('POST', '/api/inspecoes', {
    token: frota,
    corpo: { ...corpoBase, cliente_uuid: 'uuid-arquivada-0001', template_id: modelo },
  })
  assert.equal(comArquivada.status, 200,
    `a fila offline sobe na versao com que saiu: ${JSON.stringify(comArquivada.dados)}`)
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

test('empresa suspensa: ninguem entra, e quem ja estava dentro cai na hora', async () => {
  // `empresas.status` existe no esquema desde o primeiro dia, com o vocabulario
  // escrito ao lado: `ativa | suspensa`. Era gravado na criacao e nunca lido —
  // nenhuma linha do servidor perguntava o status da empresa. Suspender uma
  // empresa no banco nao fazia absolutamente nada.
  //
  // Isso nao e' campo sobrando: e' a unica alavanca que existe para cortar o
  // acesso de um cliente inteiro — contrato encerrado, inadimplencia, incidente.
  // E ela estava desligada do sistema.
  //
  // A regra segue a que ja vale para a pessoa (`usuarios.status`): revalidada a
  // cada requisicao, e nao so no login. Suspender derruba quem esta dentro.
  const empresaC = novoId('empresa')
  criarEmpresa(empresaC, 'Empresa Suspensa')
  const cargoC = criarCargo(empresaC, 'Frota C')
  criarUsuario(empresaC, 'Frota C', '39053344705', 'frota.c@teste.local', cargoC, true)

  const entrada = await chamar('POST', '/api/auth/login',
    { corpo: { email: 'frota.c@teste.local', senha: SENHA } })
  assert.equal(entrada.status, 200, 'controle: com a empresa ativa, entra')
  const token = entrada.dados.token
  assert.equal((await chamar('GET', '/api/painel', { token })).status, 200)

  executar("UPDATE empresas SET status = 'suspensa' WHERE id = ?", [empresaC])

  // A sessao que ja existia para de valer — como acontece ao bloquear a pessoa.
  const depois = await chamar('GET', '/api/painel', { token })
  assert.equal(depois.status, 401, 'sessao de empresa suspensa nao pode continuar valendo')

  // E nao da para entrar de novo.
  const denovo = await chamar('POST', '/api/auth/login',
    { corpo: { email: 'frota.c@teste.local', senha: SENHA } })
  assert.equal(denovo.status, 403, JSON.stringify(denovo.dados))
  assert.equal(denovo.dados.erro, 'empresa_suspensa')

  // A recusa nao vaza se a senha estava certa ou errada para quem chuta.
  const chute = await chamar('POST', '/api/auth/login',
    { corpo: { email: 'frota.c@teste.local', senha: 'errada' } })
  assert.equal(chute.status, 401, 'senha errada continua sendo 401, antes de qualquer outra coisa')

  // Reativada, tudo volta: a suspensao e' estado, nao punicao permanente.
  executar("UPDATE empresas SET status = 'ativa' WHERE id = ?", [empresaC])
  const volta = await chamar('POST', '/api/auth/login',
    { corpo: { email: 'frota.c@teste.local', senha: SENHA } })
  assert.equal(volta.status, 200, 'reativada, a empresa volta a funcionar')
})

test('ocorrencias: o cartao do painel e a lista contam a mesma coisa', async () => {
  // O cartao "Ocorrencias abertas" conta `aberta + em_tratamento`. A lista, sem
  // filtro, devolvia `<> encerrada` — que inclui as RESOLVIDAS, ja tratadas e
  // esperando so o encerramento. Clicar num numero e receber uma lista maior
  // ensina a pessoa a nao confiar no numero.
  const frota = await entrar('frota.a@teste.local')
  const veiculo = criarVeiculo(empresaA, 'AAA9F99')

  const ts = agora()
  const situacoes = ['aberta', 'em_tratamento', 'resolvida', 'encerrada']
  for (const [i, situacao] of situacoes.entries()) {
    executar(
      `INSERT INTO ocorrencias (id, empresa_id, veiculo_id, pergunta_id, descricao,
                                prioridade, status, aberta_em)
       VALUES (?, ?, ?, 'filtro', ?, 'media', ?, ?)`,
      [novoId('ocorrencia'), empresaA, veiculo, `Ocorrencia ${situacao}`, situacao,
       new Date(new Date(ts).getTime() - i * 1000).toISOString()])
  }

  const listar = async (query) => (await chamar(
    'GET', `/api/ocorrencias?veiculo_id=${veiculo}${query}`, { token: frota }))
    .dados.ocorrencias.map((o) => o.status).sort()

  const painel = await chamar('GET', '/api/painel', { token: frota })
  assert.ok(painel.dados.ocorrencias.abertas >= 2, 'controle: o painel esta contando')

  assert.deepEqual(await listar('&status=em_aberto'), ['aberta', 'em_tratamento'],
    'o filtro do cartao devolve exatamente o par que ele conta')

  assert.deepEqual(await listar(''), ['aberta', 'em_tratamento', 'resolvida'],
    'sem filtro, a lista mostra tudo que nao foi encerrado')

  // E o filtro que ninguem entende — marcador antigo, erro de digitacao — cai
  // no PADRAO. Escrito como tres condicoes independentes, um valor invalido
  // escapava das tres e a consulta saia sem clausula nenhuma, devolvendo MAIS
  // do que o padrao: a encerrada aparecia junto.
  assert.deepEqual(await listar('&status=lixo_que_nao_existe'),
    ['aberta', 'em_tratamento', 'resolvida'],
    'filtro invalido nunca pode devolver mais do que o padrao')
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

test('notificacao: preventiva concluida pelo painel avisa a frota, como a do aplicativo', async () => {
  // Duas portas fecham o ciclo de uma preventiva: o retorno do checklist, no
  // aplicativo, e o botao "concluir" do painel. O proprio comentario da rota
  // diz "duas portas, um ato so" — mas so a do aplicativo avisava. Pela do
  // painel, o resto da equipe da Frota nao ficava sabendo que o carro voltou da
  // oficina nem que ja existe um proximo alvo agendado. Numa equipe de duas
  // pessoas isso e' o suficiente para duas agendarem a mesma revisao.
  const frota = await entrar('frota.a@teste.local')
  const mecanico = await entrar('mecanico.a@teste.local')

  const veiculo = criarVeiculo(empresaA, 'AAA9N99', 'compacto_leve', 30000)
  const preventiva = criarPreventivaComModelo(empresaA, veiculo, modeloPreventivaA)

  const antesMecanico = await naoLidas(mecanico)
  const antesFrota = await naoLidas(frota)

  const r = await chamar('POST', `/api/preventivas/${preventiva}/concluir`, {
    token: frota,
    corpo: {
      km_realizado: 30100, servico: 'Troca de oleo e filtros.',
      proximo_modo: 'km', proximo_km: 40100,
    },
  })
  assert.equal(r.status, 200, JSON.stringify(r.dados))

  assert.equal(await naoLidas(mecanico), antesMecanico + 1,
    'o resto da frota tem que saber que a preventiva foi concluida')
  assert.equal(await naoLidas(frota), antesFrota,
    'quem concluiu nao recebe aviso da propria acao')

  const caixa = await chamar('GET', '/api/notificacoes', { token: mecanico })
  const aviso = caixa.dados.notificacoes[0]
  assert.match(aviso.texto, /AAA9N99/, 'o aviso tem que dizer de qual carro')
  assert.match(aviso.texto, /Frota A/, 'e quem concluiu')
  assert.equal(aviso.destino, 'preventivas')
  assert.equal(aviso.entidade_id, preventiva)
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

test('cobranca: quem fez sai da lista, e quem nao fez continua nela', async () => {
  // Duas coisas que faltavam.
  //
  // A primeira: o teste pedia a lista de HOJE. Sabado e domingo a rota devolve
  // `exigido: false` e `faltantes: []` — e a asercao "fulano nao esta na lista"
  // fica verdadeira sem exercitar nada. Dois dias em sete, ele nao provava.
  // Agora usa uma quinta-feira fixa, que os modelos diarios da fixture cobram.
  //
  // A segunda, que vale nos sete dias: nao havia CONTROLE POSITIVO. Sem alguem
  // que precise aparecer na lista, o teste passaria com a cobranca inteira
  // quebrada — bastaria `faltantes` vir sempre vazio.
  const frota = await entrar('frota.a@teste.local')
  const diarista = await entrar('diarista@teste.local', 'diarista2026')
  // Uma QUARTA que nenhum outro teste consulta. A primeira versao usava a
  // quinta-feira 03/09 e derrubou o vizinho: ao tirar o diarista dos faltantes
  // daquele dia, o teste "um checklist por pessoa" perdeu justamente a pessoa
  // com mais de um modelo. Fixture compartilhada exige dia proprio.
  const QUARTA = '2026-09-02'

  const eu = (await chamar('GET', '/api/auth/eu', { token: diarista })).dados.usuario

  // Antes: ninguem fez nada naquele dia, e o diarista TEM que estar cobrado.
  const antes = await chamar('GET', `/api/execucoes/faltando?dia=${QUARTA}`, { token: frota })
  assert.equal(antes.status, 200)
  assert.equal(antes.dados.exigido, true, 'quarta-feira cobra: os modelos diarios valem de seg a sex')
  assert.ok(antes.dados.faltantes.some((f) => f.usuario_id === eu.id),
    'controle positivo: quem nao fez PRECISA aparecer, senao o teste seguinte nao prova nada')

  // Um checklist de saida daquele dia, no nome dele.
  const quando = naHoraDaOperacao(QUARTA, 7, 30).toISOString()
  const modelo = consultarUm(
    `SELECT id FROM templates WHERE empresa_id = ? AND periodicidade = 'diario' LIMIT 1`,
    [empresaA]).id
  executar(
    `INSERT INTO inspecoes (id, empresa_id, veiculo_id, usuario_id, template_id,
                            momento, status, resultado, iniciada_em, finalizada_em, criado_em)
     VALUES (?, ?, ?, ?, ?, 'saida', 'finalizada', 'aprovado', ?, ?, ?)`,
    [novoId('inspecao'), empresaA, veiculoA4, eu.id, modelo, quando, quando, quando])

  // Depois: ele sai da lista, e a lista NAO fica vazia — os outros continuam.
  const depois = await chamar('GET', `/api/execucoes/faltando?dia=${QUARTA}`, { token: frota })
  assert.ok(!depois.dados.faltantes.some((f) => f.usuario_id === eu.id),
    'quem mandou o checklist do dia nao pode aparecer como faltante')
  assert.equal(depois.dados.cobrados, antes.dados.cobrados,
    'fazer o checklist tira da lista de faltantes, nao da lista de cobrados')
  assert.equal(depois.dados.faltantes.length, antes.dados.faltantes.length - 1,
    'so ele saiu: se a lista esvaziou, o filtro esta pegando gente demais')
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

// Um caminho concreto para uma rota com parametro.
//
// O que interessa a matriz e' a GUARDA, que roda antes de qualquer busca — e
// por isso um id existente e um inventado dao a mesma resposta para quem nao
// tem credencial. Ainda assim vale usar ids REAIS: com id inventado, uma rota
// sem guarda nenhuma responderia 404 e passaria por bem-guardada.
//
// `null` quer dizer "nao sei montar", e nao "pode pular": quem chama poe numa
// lista que o teste exige vazia.
function preencher(molde) {
  if (!molde.includes(':')) return molde

  const alvos = [
    [/^\/api\/veiculos\/:id/,        () => veiculoA4],
    [/^\/api\/usuarios\/:id/,        () => frotaA],
    [/^\/api\/templates\/:id/,       () => modeloPreventivaA],
    [/^\/api\/categorias\/:id/,      () => catA],
    [/^\/api\/cargos\/:id/,          () => cgMotoristaA],
    [/^\/api\/inspecoes\/:id/,       () => globalThis.__algumaInspecao],
    [/^\/api\/solicitacoes\/:id/,    () => globalThis.__algumaSolicitacao],
    [/^\/api\/ocorrencias\/:id/,     () => globalThis.__algumaOcorrencia],
    [/^\/api\/preventivas\/:id/,     () => globalThis.__preventivaA],
    [/^\/api\/evidencias\/:id/,      () => globalThis.__algumaEvidencia],
    [/^\/api\/evidencia\/:id/,       () => globalThis.__algumaEvidencia],
    [/^\/relatorio\/inspecao\/:id/,  () => globalThis.__algumaInspecao],
    [/^\/relatorio\/solicitacao\/:id/, () => globalThis.__algumaSolicitacao],
    [/^\/relatorio\/preventiva\/:id/,  () => globalThis.__preventivaA],
    [/^\/imagens\/modelo\/:template\/:arquivo/,
      () => [modeloPreventivaA, 'nao-existe.jpg']],
  ]

  for (const [padrao, achar] of alvos) {
    if (!padrao.test(molde)) continue
    const valor = achar()
    const pecas = Array.isArray(valor) ? valor : [valor]
    if (pecas.some((x) => !x)) return null
    let i = 0
    return molde.replace(/:[a-zA-Z]+/g, () => pecas[i++])
  }
  return null
}

// Alvos que so existem depois que os testes anteriores rodaram. A matriz corre
// no fim do arquivo de proposito: se ela rodasse antes, metade dos caminhos
// viria vazia e a varredura mediria muito menos do que anuncia.
function acharAlvosDaMatriz() {
  const um = (sql, params = [empresaA]) => consultarUm(sql, params)?.id || null
  globalThis.__algumaInspecao = globalThis.__algumaInspecao
    || um('SELECT id FROM inspecoes WHERE empresa_id = ? LIMIT 1')
  globalThis.__algumaSolicitacao = globalThis.__algumaSolicitacao
    || um('SELECT id FROM solicitacoes WHERE empresa_id = ? LIMIT 1')
  globalThis.__algumaOcorrencia = globalThis.__algumaOcorrencia
    || um('SELECT id FROM ocorrencias WHERE empresa_id = ? LIMIT 1')
  globalThis.__algumaEvidencia = globalThis.__algumaEvidencia
    || um('SELECT id FROM evidencias WHERE empresa_id = ? LIMIT 1')
  globalThis.__preventivaA = globalThis.__preventivaA
    || um('SELECT id FROM preventivas WHERE empresa_id = ? LIMIT 1')

  // A evidencia da empresa A nasce aqui se ainda nao existir: as fotos sao
  // testadas em relatorios.teste.js, e sem uma linha na tabela a matriz nao
  // conseguiria montar `/api/evidencias/:id` — e uma rota que a matriz nao
  // monta e' uma rota que ela nao guarda.
  if (!globalThis.__algumaEvidencia && globalThis.__algumaInspecao) {
    const insp = consultarUm('SELECT * FROM inspecoes WHERE id = ?', [globalThis.__algumaInspecao])
    const id = novoId('evidencia')
    const ts = agora()
    executar(
      `INSERT INTO evidencias (id, empresa_id, veiculo_id, inspecao_id, pergunta_id,
                               usuario_id, tipo_mime, caminho, bytes, capturado_em, criado_em)
       VALUES (?, ?, ?, ?, 'lataria', ?, 'image/png', 'nao-existe/foto.png', 1, ?, ?)`,
      [id, empresaA, insp.veiculo_id, insp.id, insp.usuario_id, ts, ts])
    globalThis.__algumaEvidencia = id
  }
}

// ===================== a matriz de acesso, lida do proprio codigo =========
//
// As duas provas de isolamento logo abaixo sao escritas a mao: sete leituras e
// oito escritas. Estavam certas e continuam valendo — mas sao quinze linhas de
// uma lista que hoje tem mais de setenta rotas, e ninguem lembra de acrescentar
// a decima sexta ao criar a decima sexta rota.
//
// Este bloco varre `servidor/src/rotas/` e monta a matriz sozinho. Rota nova
// entra na conta no dia em que nasce, sem ninguem editar teste nenhum. E rota
// cujo parametro este arquivo nao sabe preencher NAO e' pulada em silencio: ela
// cai numa lista que o teste exige vazia, entao criar uma rota com forma de
// caminho nova obriga a decidir o que fazer com ela.
//
// O que a matriz consegue exercer com seguranca sao os niveis SEM privilegio —
// e' exatamente onde os buracos moram. A guarda roda antes de qualquer efeito,
// entao chamar um POST de Frota com credencial de colaborador recusa sem
// gravar nada.

function rotasDoCodigo() {
  const raiz = path.join(import.meta.dirname, '..', 'src', 'rotas')
  const achadas = []
  for (const arquivo of fs.readdirSync(raiz).filter((f) => f.endsWith('.js'))) {
    const linhas = fs.readFileSync(path.join(raiz, arquivo), 'utf8').split('\n')
    const inicios = []
    linhas.forEach((linha, i) => {
      const m = linha.match(/rotas\.(get|post|put|patch|delete)\(\s*'([^']+)'/)
      if (m) inicios.push({ i, metodo: m[1].toUpperCase(), caminho: m[2] })
    })
    inicios.forEach((r, k) => {
      // O corpo vai ate a PROXIMA rota, e nao ate uma quantidade fixa de
      // linhas. Com uma janela fixa, o `exigirFrota` da rota seguinte era lido
      // como se fosse desta: `GET /api/cargos`, que so exige sessao, aparecia
      // como rota de Frota. Guarda lida errado esconde buraco nos dois
      // sentidos — este acusou um que nao existia, e o simetrico deixaria
      // passar um que existe.
      const fim = k + 1 < inicios.length ? inicios[k + 1].i : linhas.length
      const corpo = linhas.slice(r.i, fim).join('\n')
      const guarda = corpo.includes('exigirFrota') ? 'frota'
        : corpo.includes('exigirAutenticado') ? 'sessao'
          : corpo.includes('exigirSessao') ? 'sessao_crua' : 'sem_guarda'
      achadas.push({
        metodo: r.metodo, caminho: r.caminho, guarda,
        onde: `${arquivo}:${r.i + 1}`,
      })
    })
  }
  return achadas
}

// As unicas rotas que respondem sem sessao nenhuma, e o motivo de cada uma.
// Qualquer outra que apareca aqui e' um buraco, nao uma escolha.
const SEM_SESSAO = new Map([
  ['POST /api/auth/login', 'e a porta: exigir sessao para entrar seria um circulo'],
  ['POST /api/auth/sair',  'sair sem sessao e um nao-evento, e responder 401 a quem ja saiu confunde'],
])

// `exigirSessao` (e nao `exigirAutenticado`) e' o que o usuario PENDENTE
// alcanca: a sessao dele vale, mas so para trocar a senha inicial.
const PENDENTE_ALCANCA = new Set([
  'GET /api/auth/eu',
  'POST /api/auth/senha',
  'POST /api/auth/sair',
  'POST /api/auth/login',
])

test('matriz: nenhuma rota responde sem sessao, fora as duas que devem', async () => {
  acharAlvosDaMatriz()
  const rotas = rotasDoCodigo()
  assert.ok(rotas.length > 60, `varredura pobre demais: ${rotas.length} rotas`)

  const abertas = []
  const naoCobertas = []

  for (const r of rotas) {
    const chave = `${r.metodo} ${r.caminho}`
    const caminho = preencher(r.caminho)
    if (caminho === null) { naoCobertas.push(`${chave} (${r.onde})`); continue }

    const opcoes = r.metodo === 'GET' ? {} : { corpo: {} }
    const resposta = await chamar(r.metodo, caminho, opcoes)
    const deveriaAbrir = SEM_SESSAO.has(chave)

    if (deveriaAbrir) {
      assert.notEqual(resposta.status, 401,
        `${chave} devia responder sem sessao (${SEM_SESSAO.get(chave)}) e devolveu 401`)
    } else if (resposta.status !== 401) {
      abertas.push(`${chave} → ${resposta.status} (${r.onde}, guarda lida: ${r.guarda})`)
    }
  }

  assert.deepEqual(abertas, [],
    `rota respondendo sem sessao nenhuma:\n${abertas.join('\n')}`)
  assert.deepEqual(naoCobertas, [],
    `a matriz nao soube montar o caminho destas — decida o que fazer com elas:\n${naoCobertas.join('\n')}`)
})

// O NIVEL DE CADA ROTA, declarado — e nao lido da propria guarda.
//
// A primeira versao deste teste lia `exigirFrota` do codigo e conferia se as
// rotas assim marcadas recusavam colaborador. Isso e' tautologia: trocando
// `exigirFrota` por `exigirAutenticado` numa rota, ela saia da lista e o teste
// continuava verde. Verifiquei injetando exatamente isso em
// `GET /api/preventivas` — passou.
//
// Entao a lista abaixo e' a ESPECIFICACAO, escrita a mao, e o codigo e' conferido
// contra ela. Lista escrita a mao apodrece — por isso o teste tambem exige que
// ela cubra exatamente as rotas que existem: rota nova sem decisao de nivel
// derruba a suite no dia em que nasce.
//
//   aberta      — responde sem sessao nenhuma
//   pendente    — a sessao de quem ainda nao trocou a senha inicial alcanca
//   colaborador — qualquer sessao ativa
//   frota       — so quem tem acessa_painel
const NIVEL = new Map([
  ['POST /api/auth/login', 'aberta'],
  ['POST /api/auth/sair', 'aberta'],
  ['GET /api/auth/eu', 'pendente'],
  ['POST /api/auth/senha', 'pendente'],

  // O formulario de pedido do colaborador: categoria e quantos carros atendem,
  // sem placa nenhuma (roadmap 10.3).
  ['GET /api/categorias', 'colaborador'],
  ['POST /api/categorias', 'frota'],
  ['PATCH /api/categorias/:id', 'frota'],
  ['DELETE /api/categorias/:id', 'frota'],
  // Esta mostra placa. Por isso e' da Frota, ao contrario da de cima.
  ['GET /api/categorias/:id/veiculos', 'frota'],
  ['PUT /api/categorias/:id/veiculos', 'frota'],

  // O aplicativo de campo inteiro. Cada uma filtra por autor por dentro.
  ['GET /api/app/inicio', 'colaborador'],
  ['POST /api/inspecoes', 'colaborador'],
  ['GET /api/inspecoes', 'colaborador'],
  ['GET /api/inspecoes/:id', 'colaborador'],
  ['POST /api/inspecoes/:id/evidencias', 'colaborador'],
  ['GET /api/inspecoes/:id/evidencias', 'colaborador'],
  ['GET /api/evidencias/:id', 'colaborador'],
  ['GET /api/execucoes', 'colaborador'],
  ['GET /api/notificacoes', 'colaborador'],
  ['POST /api/notificacoes/lidas', 'colaborador'],
  ['GET /api/usuarios/:id/historico', 'colaborador'],
  // A foto de exemplo da pergunta: o app precisa mostrar COMO fotografar.
  ['GET /imagens/modelo/:template/:arquivo', 'colaborador'],

  // O pedido e' dele; a liberacao e' da Frota.
  ['GET /api/solicitacoes', 'colaborador'],
  ['GET /api/solicitacoes/:id', 'colaborador'],
  ['POST /api/solicitacoes', 'colaborador'],
  ['POST /api/solicitacoes/:id/cancelar', 'colaborador'],
  ['GET /api/solicitacoes/:id/devolucao', 'colaborador'],
  ['POST /api/solicitacoes/:id/devolver', 'colaborador'],
  ['GET /api/solicitacoes/disponiveis', 'frota'],
  ['POST /api/solicitacoes/:id/aprovar', 'frota'],
  ['POST /api/solicitacoes/:id/recusar', 'frota'],

  // Cobranca: quem faltou e' assunto de supervisao.
  ['GET /api/execucoes/faltando', 'frota'],
  ['GET /api/execucoes.csv', 'frota'],

  ['GET /api/ocorrencias', 'frota'],
  ['GET /api/ocorrencias/:id', 'frota'],
  ['POST /api/ocorrencias/:id/status', 'frota'],
  ['POST /api/ocorrencias/:id/atribuir', 'frota'],
  ['GET /api/auditoria', 'frota'],
  ['GET /api/painel', 'frota'],

  ['GET /api/preventivas', 'frota'],
  ['GET /api/preventivas/:id', 'frota'],
  ['POST /api/preventivas', 'frota'],
  ['PATCH /api/preventivas/:id', 'frota'],
  ['POST /api/preventivas/:id/concluir', 'frota'],

  ['GET /relatorio/inspecao/:id', 'frota'],
  ['GET /relatorio/solicitacao/:id', 'frota'],
  ['GET /relatorio/preventiva/:id', 'frota'],
  ['GET /relatorio/frota', 'frota'],

  ['GET /api/templates', 'frota'],
  ['GET /api/templates/:id', 'frota'],
  ['POST /api/templates', 'frota'],
  ['PUT /api/templates/:id', 'frota'],
  ['POST /api/templates/:id/publicar', 'frota'],
  ['POST /api/templates/:id/imagem', 'frota'],
  ['POST /api/templates/:id/versao', 'frota'],
  ['DELETE /api/templates/:id', 'frota'],
  ['POST /api/templates/conferir', 'frota'],

  // Organograma da empresa. O cargo DA PESSOA vem em /api/auth/eu.
  ['GET /api/cargos', 'frota'],
  ['POST /api/cargos', 'frota'],
  ['PATCH /api/cargos/:id', 'frota'],
  ['DELETE /api/cargos/:id', 'frota'],

  ['GET /api/usuarios', 'frota'],
  ['POST /api/usuarios', 'frota'],
  ['GET /api/usuarios/:id', 'frota'],
  ['PATCH /api/usuarios/:id', 'frota'],
  ['POST /api/usuarios/:id/status', 'frota'],
  ['POST /api/usuarios/:id/senha', 'frota'],

  // Placa, ano, km, status e o MOTIVO do status. Nada disso e' do colaborador.
  ['GET /api/veiculos', 'frota'],
  ['POST /api/veiculos', 'frota'],
  ['GET /api/veiculos/:id', 'frota'],
  ['PATCH /api/veiculos/:id', 'frota'],
  ['POST /api/veiculos/:id/status', 'frota'],
  ['GET /api/veiculos/:id/historico', 'frota'],
])

test('matriz: a especificacao de nivel cobre exatamente as rotas que existem', () => {
  const noCodigo = new Set(rotasDoCodigo().map((r) => `${r.metodo} ${r.caminho}`))
  const declaradas = new Set(NIVEL.keys())

  const semDecisao = [...noCodigo].filter((c) => !declaradas.has(c))
  const fantasmas = [...declaradas].filter((c) => !noCodigo.has(c))

  assert.deepEqual(semDecisao, [],
    `rota nova sem nivel declarado — decida antes de seguir:\n${semDecisao.join('\n')}`)
  assert.deepEqual(fantasmas, [],
    `a especificacao cita rota que nao existe mais:\n${fantasmas.join('\n')}`)
})

test('matriz: nenhuma rota de Frota responde a colaborador', async () => {
  acharAlvosDaMatriz()
  const token = await entrar('motorista.a@teste.local')
  const vazadas = []
  let conferidas = 0

  for (const r of rotasDoCodigo()) {
    const chave = `${r.metodo} ${r.caminho}`
    if (NIVEL.get(chave) !== 'frota') continue
    const caminho = preencher(r.caminho)
    if (caminho === null) continue   // a cobertura e' cobrada em outro teste

    conferidas += 1
    const resposta = await chamar(r.metodo, caminho,
      r.metodo === 'GET' ? { token } : { token, corpo: {} })
    // 403 e' o certo. 404 serve quando o id do caminho nao existe para este
    // tenant — o que importa e' nunca ter FEITO o que foi pedido.
    if (resposta.status !== 403 && resposta.status !== 404) {
      vazadas.push(`${chave} → ${resposta.status} (${r.onde}, guarda no codigo: ${r.guarda})`)
    }
  }

  assert.ok(conferidas >= 40, `poucas rotas de Frota exercidas: ${conferidas}`)
  assert.deepEqual(vazadas, [],
    `rota que a especificacao diz ser de Frota, alcancada por colaborador:\n${vazadas.join('\n')}`)
})

test('matriz: e nenhuma rota do colaborador foi fechada por engano', async () => {
  // A direcao contraria, que quase todo teste de permissao esquece: apertar
  // demais tambem quebra. Se `GET /api/categorias` virasse rota de Frota, o
  // formulario de pedido do aplicativo pararia — e um teste que so procura
  // vazamento acharia isso otimo.
  //
  // So as rotas SEM `:id` no caminho: nelas um 403 so pode significar recusa de
  // NIVEL. Onde ha um id, o 403 pode ser "este registro e de outra pessoa",
  // que e' outra regra, com testes proprios.
  acharAlvosDaMatriz()
  const token = await entrar('motorista.a@teste.local')
  const fechadas = []
  let conferidas = 0

  for (const r of rotasDoCodigo()) {
    const chave = `${r.metodo} ${r.caminho}`
    if (NIVEL.get(chave) !== 'colaborador' || r.caminho.includes(':')) continue

    conferidas += 1
    const resposta = await chamar(r.metodo, r.caminho,
      r.metodo === 'GET' ? { token } : { token, corpo: {} })
    if (resposta.status === 403) {
      fechadas.push(`${chave} → 403 "${resposta.dados?.mensagem || ''}" (${r.onde})`)
    }
  }

  assert.ok(conferidas >= 6, `poucas rotas de colaborador exercidas: ${conferidas}`)
  assert.deepEqual(fechadas, [],
    `rota que o aplicativo precisa, recusada por nivel:\n${fechadas.join('\n')}`)
})

test('matriz: quem nao trocou a senha inicial nao alcanca mais nada', async () => {
  // A sessao do pendente vale, mas so para trocar a senha. O comentario do
  // `usuarioDaSessao` chamava esse portao de `exigirSenhaTrocada()` — funcao
  // que nao existe em lugar nenhum do repositorio. Ela nao precisa existir: o
  // portao esta dentro do proprio `exigirAutenticado`. Mas nenhum teste cobria
  // isso rota a rota, e comentario que aponta para o vazio e' como se lia.
  // Conta propria: `pendente.a@teste.local` ja TROCOU a senha num teste
  // anterior, e com ela a matriz media um usuario ativo achando que media um
  // pendente — passaria verde sem nunca exercer o portao que diz cobrir.
  criarUsuario(empresaA, 'Pendente da matriz', '30281709032',
    'pendente.matriz@teste.local', cgMotoristaA, false, 'pendente')
  const token = await entrar('pendente.matriz@teste.local')
  assert.ok(token, 'controle: o pendente PRECISA conseguir entrar, ou nunca troca a senha')

  const eu = await chamar('GET', '/api/auth/eu', { token })
  assert.equal(eu.status, 200, 'ele precisa ler o proprio perfil para a tela saber o que mostrar')
  assert.equal(eu.dados.usuario.deve_trocar_senha, true)

  const passaram = []
  for (const r of rotasDoCodigo()) {
    const chave = `${r.metodo} ${r.caminho}`
    if (PENDENTE_ALCANCA.has(chave)) continue
    // So GET: um POST de rota `sessao` seria executado de verdade.
    if (r.metodo !== 'GET' && r.guarda !== 'frota') continue
    const caminho = preencher(r.caminho)
    if (caminho === null) continue

    const resposta = await chamar(r.metodo, caminho,
      r.metodo === 'GET' ? { token } : { token, corpo: {} })
    if (resposta.status !== 403 && resposta.status !== 404) {
      passaram.push(`${chave} → ${resposta.status} (${r.onde})`)
    } else if (resposta.status === 403 && resposta.dados?.erro
      && resposta.dados.erro !== 'troca_de_senha_obrigatoria'
      && resposta.dados.erro !== 'sem_permissao') {
      passaram.push(`${chave} → 403 com erro "${resposta.dados.erro}"`)
    }
  }

  assert.deepEqual(passaram, [],
    `o pendente alcancou o que nao devia:\n${passaram.join('\n')}`)
})

// Toda rota com `:id`, atravessada pela Frota da outra empresa.
//
// As duas provas escritas a mao logo abaixo continuam valendo e sao mais
// severas onde importa — elas conferem que o ALVO ficou intacto, e nao so que a
// resposta foi 404. Mas cobrem quinze rotas. Esta cobre todas as que tem `:id`,
// e cresce sozinha.
//
// 404 e nao 403, sempre: responder "sem permissao" a um id de outra empresa
// confirmaria que o id existe. Para quem esta fora, o registro nao existe.
function fotoDosAlvos() {
  return {
    veiculo: consultarUm('SELECT status, modelo, km_atual FROM veiculos WHERE id = ?', [veiculoA4]),
    usuario: consultarUm('SELECT nome, status FROM usuarios WHERE id = ?', [frotaA]),
    modelo: consultarUm('SELECT nome, status, versao FROM templates WHERE id = ?',
      [modeloPreventivaA]),
    categoria: consultarUm('SELECT nome, ativo FROM categorias_uso WHERE id = ?', [catA]),
    cargo: consultarUm('SELECT nome, ativo FROM cargos WHERE id = ?', [cgMotoristaA]),
    // As entidades de fluxo tambem: a travessia dispara PATCH, POST /status,
    // /concluir, /aprovar, /cancelar e /devolver de verdade. Fotografar so os
    // cadastros deixaria a metade mais perigosa sem conferencia.
    ocorrencia: consultarUm('SELECT status, resolucao, responsavel_id FROM ocorrencias WHERE id = ?',
      [globalThis.__algumaOcorrencia]),
    preventiva: consultarUm('SELECT status, proximo_km, proxima_data FROM preventivas WHERE id = ?',
      [globalThis.__preventivaA]),
    solicitacao: consultarUm('SELECT status, veiculo_id, devolvido_em FROM solicitacoes WHERE id = ?',
      [globalThis.__algumaSolicitacao]),
    inspecao: consultarUm('SELECT status, resultado, km_informado FROM inspecoes WHERE id = ?',
      [globalThis.__algumaInspecao]),
  }
}

test('isolamento: toda rota com id atravessada pela outra empresa responde 404', async () => {
  acharAlvosDaMatriz()
  const invasor = await entrar('frota.b@teste.local')
  const antes = fotoDosAlvos()

  const erradas = []
  const naoMontadas = []
  let atravessadas = 0

  for (const r of rotasDoCodigo()) {
    if (!r.caminho.includes(':')) continue
    const caminho = preencher(r.caminho)
    if (caminho === null) { naoMontadas.push(`${r.metodo} ${r.caminho} (${r.onde})`); continue }

    atravessadas += 1
    const resposta = await chamar(r.metodo, caminho,
      r.metodo === 'GET' ? { token: invasor } : { token: invasor, corpo: {} })
    if (resposta.status !== 404) {
      erradas.push(`${r.metodo} ${r.caminho} → ${resposta.status} (${r.onde})`)
    }
  }

  assert.ok(atravessadas >= 25, `poucas rotas com id atravessadas: ${atravessadas}`)
  assert.deepEqual(naoMontadas, [],
    `caminho que a travessia nao soube montar — decida o que fazer:\n${naoMontadas.join('\n')}`)
  assert.deepEqual(erradas, [],
    `rota que nao respondeu 404 a um id de outra empresa:\n${erradas.join('\n')}`)

  // Nao basta a resposta ser 404 se o efeito passou. As escritas acima foram
  // disparadas de verdade; os alvos tem que estar como estavam.
  assert.deepEqual(fotoDosAlvos(), antes,
    'um registro da empresa A mudou durante a travessia da empresa B')
})

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

  // 07h50 de ONTEM, na hora da operacao — e nao de hoje.
  //
  // A primeira versao usava HOJE, e por isso so passava depois das 07h55: antes
  // disso "hoje as 07h50" ainda esta no FUTURO, a janela do servidor recusa, e o
  // teste acusava a correcao que ele mesmo guarda. Passou a noite inteira verde
  // e amanheceu vermelho, sem ninguem ter tocado no codigo.
  //
  // Ontem serve igual: a classificacao no prazo x atrasado compara HORA DO DIA
  // com o horario limite, e nao a data. E ontem esta sempre no passado.
  const ontem = diaLocal(new Date(Date.now() - 86400000))
  const inicio = naHoraDaOperacao(ontem, 7, 40)
  const fim = naHoraDaOperacao(ontem, 7, 50)

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
  const lista = await chamar('GET', `/api/execucoes?de=${ontem}&ate=${ontem}`, { token: frota })
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

test('entrada malformada nunca vira 500', async () => {
  // 500 e' defeito por definicao: o cliente nao recebe nada acionavel e o log
  // leva um rastro de excecao. Toda falha esperada tem que ter codigo e frase.
  //
  // Isto e' uma varredura, nao um caso: o valor esta em cobrir muitas rotas com
  // muitas formas de lixo de uma vez, porque o defeito que ela procura aparece
  // em QUALQUER campo que alguem leia sem conferir o tipo.
  const frota = await entrar('frota.a@teste.local')

  const LIXO = [
    {}, { respostas: 'texto' }, { respostas: [] }, { respostas: { a: null } },
    { estrutura: 'nao e objeto' }, { estrutura: { perguntas: 'x' } },
    { cargos_liberados: 'todos' }, { dias_semana: 'segunda' },
    { km_informado: 'muito' }, { proxima_preventiva: 'sim' },
    { janela_inicio: 'ontem', janela_fim: 'amanha' },
    { veiculos: 'todos' }, { status: 12345 },
    { nome: null, cpf: [], email: {} },
    // Numeros e objetos onde o servidor espera texto: sao estes que
    // revelam quem chama metodo de String sem conferir.
    { tipo: 7 }, { tipo: {} }, { modelo: [] }, { placa: 99 }, { motivo: 0 },
  ]
  const ROTAS = [
    '/api/inspecoes', '/api/solicitacoes', '/api/veiculos', '/api/usuarios',
    '/api/templates', '/api/cargos', '/api/categorias', '/api/preventivas',
    '/api/notificacoes/lidas',
  ]
  const CONSULTAS = [
    '/api/execucoes?de=xx&ate=yy', '/api/execucoes?de=2026-13-45',
    '/api/execucoes/faltando?dia=abacaxi', '/api/execucoes.csv?de=&ate=',
    '/api/solicitacoes?status=inventado', '/api/ocorrencias?prioridade=urgentissima',
    '/api/preventivas?historico=talvez', '/api/inspecoes?momento=voando',
    '/api/templates?finalidade=outra',
    '/api/solicitacoes/disponiveis?janela_inicio=x&janela_fim=y',
  ]

  const quebrados = []
  for (const caminho of ROTAS) {
    for (const corpo of LIXO) {
      const r = await chamar('POST', caminho, { token: frota, corpo })
      if (r.status >= 500) quebrados.push(`POST ${caminho} <- ${JSON.stringify(corpo)}`)
    }
  }
  for (const caminho of CONSULTAS) {
    const r = await chamar('GET', caminho, { token: frota })
    if (r.status >= 500) quebrados.push(`GET ${caminho}`)
  }

  // As rotas PATCH tambem, e elas importam MAIS: leem varios campos opcionais,
  // que e' exatamente onde a confusao de tipo mora. A primeira versao desta
  // varredura so cobria POST, e por isso deixou passar um `ctx.corpo.tipo
  // .toLowerCase()` injetado de proposito para conferi-la.
  const modeloA = consultarUm(
    `SELECT id FROM templates WHERE empresa_id = ? AND status = 'rascunho' LIMIT 1`,
    [empresaA])?.id
  const REMENDOS = [
    `/api/veiculos/${veiculoA4}`,
    `/api/usuarios/${frotaA}`,
    ...(modeloA ? [`/api/templates/${modeloA}`] : []),
  ]
  for (const caminho of REMENDOS) {
    for (const corpo of LIXO) {
      const r = await chamar('PATCH', caminho, { token: frota, corpo })
      if (r.status >= 500) quebrados.push(`PATCH ${caminho} <- ${JSON.stringify(corpo)}`)
    }
  }

  // E corpo que nem e' JSON.
  for (const caminho of ROTAS.slice(0, 4)) {
    const resposta = await fetch(base + caminho, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${frota}` },
      body: '{isto nao e json',
    })
    if (resposta.status >= 500) quebrados.push(`POST ${caminho} <- JSON quebrado`)
  }

  assert.deepEqual(quebrados, [], `respostas 500:\n  ${quebrados.join('\n  ')}`)
})

// Filtro que o servidor nao reconhece NUNCA pode alargar a lista.
//
// Este teste nasceu de um defeito achado por acaso, sondando outra coisa. Em
// `/api/ocorrencias` as tres condicoes de status eram independentes:
//
//   if (status === 'em_aberto') { ... }
//   else if (status && STATUS.includes(status)) { ... }
//   else if (!status) { ... o padrao, `<> encerrada` ... }
//
// Um valor invalido escapava das TRES — nao era `em_aberto`, nao estava na
// lista, e `!status` era falso — e a consulta saia sem clausula nenhuma,
// devolvendo MAIS do que o padrao, com as encerradas junto. Um marcador antigo
// no navegador bastava para ver o que a tela nao mostra.
//
// O invariante e' simples e vale para toda lista: com um filtro que ninguem
// entende, o servidor pode ignorar (e devolver o padrao) ou recusar (e devolver
// menos). O que ele nao pode e' devolver mais.
//
// Os nomes dos filtros sao lidos do proprio codigo. Filtro novo entra na
// varredura no dia em que nasce.
function filtrosDaRota(caminhoProcurado, metodoProcurado = 'GET') {
  const raiz = path.join(import.meta.dirname, '..', 'src', 'rotas')
  for (const arquivo of fs.readdirSync(raiz).filter((f) => f.endsWith('.js'))) {
    const linhas = fs.readFileSync(path.join(raiz, arquivo), 'utf8').split('\n')
    const inicios = []
    linhas.forEach((linha, i) => {
      const m = linha.match(/rotas\.(get|post|put|patch|delete)\(\s*'([^']+)'/)
      if (m) inicios.push({ i, metodo: m[1].toUpperCase(), caminho: m[2] })
    })
    for (let k = 0; k < inicios.length; k += 1) {
      // Casa por METODO tambem: `/api/inspecoes` existe como POST e como GET, e
      // o POST vem primeiro no arquivo. Casando so pelo caminho, a varredura
      // lia o corpo do POST, nao achava filtro nenhum e teria pulado a lista.
      if (inicios[k].caminho !== caminhoProcurado
        || inicios[k].metodo !== metodoProcurado) continue
      const fim = k + 1 < inicios.length ? inicios[k + 1].i : linhas.length
      const corpo = linhas.slice(inicios[k].i, fim).join('\n')
      return [...new Set([...corpo.matchAll(/query\.get\('([^']+)'\)/g)].map((m) => m[1]))]
    }
  }
  return null
}

test('filtro invalido nunca devolve mais do que o padrao', async () => {
  const token = await entrar('frota.a@teste.local')

  const LISTAS = [
    '/api/veiculos', '/api/ocorrencias', '/api/solicitacoes', '/api/preventivas',
    '/api/templates', '/api/usuarios', '/api/inspecoes', '/api/categorias',
    '/api/auditoria',
    // `/api/notificacoes` fica de fora: nao le nenhum parametro de consulta.
    // Se um dia ler, entra aqui — e ate la nao ha o que varrer.
  ]

  const quantos = (dados) => {
    if (!dados || typeof dados !== 'object') return null
    for (const v of Object.values(dados)) if (Array.isArray(v)) return v.length
    return null
  }

  const LIXOS = ['lixo_que_nao_existe', '1 OR 1=1', '', '../..', '%00']
  const alargaram = []
  const quebraram = []
  let combinacoes = 0

  for (const rota of LISTAS) {
    const filtros = filtrosDaRota(rota)
    assert.ok(filtros && filtros.length,
      `${rota}: nao achei nenhum query.get() — a rota mudou de forma?`)

    const limpo = await chamar('GET', rota, { token })
    assert.equal(limpo.status, 200, `${rota} nao respondeu limpo`)
    const base = quantos(limpo.dados)
    assert.notEqual(base, null, `${rota}: nao achei a lista na resposta`)

    for (const filtro of filtros) {
      for (const lixo of LIXOS) {
        combinacoes += 1
        const r = await chamar('GET', `${rota}?${filtro}=${encodeURIComponent(lixo)}`, { token })
        if (r.status >= 500) { quebraram.push(`${rota}?${filtro}=${lixo} → ${r.status}`); continue }
        const n = quantos(r.dados)
        if (n !== null && n > base) {
          alargaram.push(`${rota}?${filtro}=${lixo} → ${n} linhas, contra ${base} do padrao`)
        }
      }
    }
  }

  assert.ok(combinacoes >= 60, `varredura pobre demais: ${combinacoes} combinacoes`)
  assert.deepEqual(quebraram, [], `filtro invalido derrubou a rota:\n${quebraram.join('\n')}`)
  assert.deepEqual(alargaram, [],
    `filtro que ninguem entende alargou a lista:\n${alargaram.join('\n')}`)
})

// TODA combinacao (de, para) de cada maquina de estado, pela API.
//
// Ja havia um teste conferindo que a tela e o servidor concordam sobre quais
// transicoes EXISTEM. Ele le os dois objetos `TRANSICOES` e compara — util, e
// insuficiente: dois objetos iguais nao provam que a rota obedece a nenhum dos
// dois. A rota podia aceitar `encerrada -> aberta` e os dois objetos
// continuariam identicos.
//
// Esta varredura dirige o estado do registro para CADA situacao de origem e
// tenta CADA destino, inclusive os que a tabela nao declara. As duas metades
// importam: a declarada precisa passar, e a nao declarada precisa ser recusada
// SEM MEXER no registro — recusar com 409 e gravar assim mesmo seria o pior dos
// dois mundos.
function tabelaDeTransicoes(arquivo) {
  const texto = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'src', 'rotas', arquivo), 'utf8')
  const m = texto.match(/const TRANSICOES = \{([\s\S]*?)\n\}/)
  assert.ok(m, `${arquivo}: nao achei o objeto TRANSICOES`)
  const mapa = {}
  for (const linha of m[1].split('\n')) {
    const l = linha.match(/^\s*(\w+):\s*\[([^\]]*)\]/)
    if (l) mapa[l[1]] = [...l[2].matchAll(/'([^']+)'/g)].map((x) => x[1])
  }
  assert.ok(Object.keys(mapa).length >= 4, `${arquivo}: tabela lida pela metade`)
  return mapa
}

async function varrerMaquina({ tabela, situacaoAtual, porNaSituacao, tentar }) {
  const aceitouDemais = []
  const recusouDeMais = []
  const mexeuMesmoRecusando = []

  const situacoes = Object.keys(tabela)
  for (const de of situacoes) {
    for (const para of situacoes) {
      if (de === para) continue        // "ja esta neste status" tem regra propria
      porNaSituacao(de)
      const permitida = tabela[de].includes(para)
      const r = await tentar(para)
      const ficou = situacaoAtual()

      if (permitida && r.status !== 200) {
        recusouDeMais.push(`${de} -> ${para}: ${r.status} ${r.dados?.mensagem || ''}`)
      }
      if (permitida && r.status === 200 && ficou !== para) {
        recusouDeMais.push(`${de} -> ${para}: respondeu 200 e o registro ficou em "${ficou}"`)
      }
      if (!permitida && r.status === 200) {
        aceitouDemais.push(`${de} -> ${para}: aceita, e a tabela nao declara`)
      }
      if (!permitida && ficou !== de) {
        mexeuMesmoRecusando.push(`${de} -> ${para}: recusou com ${r.status} e mudou para "${ficou}"`)
      }
    }
  }
  return { aceitouDemais, recusouDeMais, mexeuMesmoRecusando, pares: situacoes.length ** 2 - situacoes.length }
}

test('estados: a ocorrencia so anda pelas transicoes que a tabela declara', async () => {
  const frota = await entrar('frota.a@teste.local')
  const tabela = tabelaDeTransicoes('ocorrencias.js')

  // Registro descartavel: a varredura empurra o estado dele dezenas de vezes.
  const veiculo = criarVeiculo(empresaA, 'AAA9T99')
  const id = novoId('ocorrencia')
  executar(
    `INSERT INTO ocorrencias (id, empresa_id, veiculo_id, pergunta_id, descricao,
                              prioridade, status, aberta_em)
     VALUES (?, ?, ?, 'varredura', 'Ocorrencia da varredura', 'baixa', 'aberta', ?)`,
    [id, empresaA, veiculo, agora()])

  const r = await varrerMaquina({
    tabela,
    porNaSituacao: (situacao) => executar(
      'UPDATE ocorrencias SET status = ?, resolucao = NULL WHERE id = ?', [situacao, id]),
    situacaoAtual: () => consultarUm('SELECT status FROM ocorrencias WHERE id = ?', [id]).status,
    tentar: (para) => chamar('POST', `/api/ocorrencias/${id}/status`, {
      token: frota, corpo: { status: para, resolucao: 'texto da varredura' },
    }),
  })

  assert.ok(r.pares >= 12, `poucos pares exercidos: ${r.pares}`)
  assert.deepEqual(r.aceitouDemais, [],
    `a rota aceita transicao que a tabela nao declara:\n${r.aceitouDemais.join('\n')}`)
  assert.deepEqual(r.recusouDeMais, [],
    `a rota recusa transicao que a tabela declara:\n${r.recusouDeMais.join('\n')}`)
  assert.deepEqual(r.mexeuMesmoRecusando, [],
    `recusou e gravou assim mesmo:\n${r.mexeuMesmoRecusando.join('\n')}`)
})

test('estados: o usuario so anda pelas transicoes que a tabela declara', async () => {
  const frota = await entrar('frota.a@teste.local')
  const tabela = tabelaDeTransicoes('usuarios.js')

  // Colaborador descartavel, e nao alguem da Frota: desativar o ultimo da
  // equipe tem regra propria, e a varredura tropecaria nela achando que achou
  // um defeito.
  const id = criarUsuario(empresaA, 'Cobaia de estados', '12345678909',
    'estados@teste.local', cgMotoristaA, false)

  const r = await varrerMaquina({
    tabela,
    porNaSituacao: (situacao) => executar(
      'UPDATE usuarios SET status = ? WHERE id = ?', [situacao, id]),
    situacaoAtual: () => consultarUm('SELECT status FROM usuarios WHERE id = ?', [id]).status,
    tentar: (para) => chamar('POST', `/api/usuarios/${id}/status`, {
      token: frota, corpo: { status: para, motivo: 'varredura de estados' },
    }),
  })

  assert.ok(r.pares >= 20, `poucos pares exercidos: ${r.pares}`)
  assert.deepEqual(r.aceitouDemais, [],
    `a rota aceita transicao que a tabela nao declara:\n${r.aceitouDemais.join('\n')}`)
  assert.deepEqual(r.recusouDeMais, [],
    `a rota recusa transicao que a tabela declara:\n${r.recusouDeMais.join('\n')}`)
  assert.deepEqual(r.mexeuMesmoRecusando, [],
    `recusou e gravou assim mesmo:\n${r.mexeuMesmoRecusando.join('\n')}`)

  // E o estado terminal e' terminal de verdade: desativado nao sai de la.
  executar("UPDATE usuarios SET status = 'desativado' WHERE id = ?", [id])
  for (const para of ['ativo', 'pendente', 'bloqueado', 'suspenso']) {
    const resposta = await chamar('POST', `/api/usuarios/${id}/status`, {
      token: frota, corpo: { status: para, motivo: 'ressuscitar' },
    })
    assert.notEqual(resposta.status, 200, `desativado -> ${para} nao pode passar`)
  }
  assert.equal(consultarUm('SELECT status FROM usuarios WHERE id = ?', [id]).status, 'desativado')
})

// A solicitacao nao tem tabela de transicoes: ela anda por ACOES nomeadas —
// aprovar, recusar, cancelar, devolver — e cada uma guarda por dentro o estado
// que aceita. Sem tabela, a unica forma de ver a maquina inteira e' escrever o
// que se espera e conferir a rota contra isso.
//
// A coluna da esquerda e' a ESPECIFICACAO. A varredura tenta cada acao a partir
// de cada um dos sete estados — 28 tentativas — e cobra as duas direcoes.
const ACOES_DA_SOLICITACAO = [
  { acao: 'aprovar',  aceita: ['pendente'],
    corpo: () => ({ veiculo_id: veiculoSolicitacaoLivre }) },
  { acao: 'recusar',  aceita: ['pendente'],
    corpo: () => ({ motivo: 'motivo da varredura de estados' }) },
  // Cancelar vale ate a retirada: depois que o carro saiu, quem encerra e' a
  // devolucao.
  { acao: 'cancelar', aceita: ['pendente', 'aprovada'], corpo: () => ({}) },
  { acao: 'devolver', aceita: ['em_uso'],
    corpo: () => ({ motivo_atraso: 'motivo da varredura de estados' }) },
]

test('estados: cada acao da solicitacao so vale nos estados que a aceitam', async () => {
  const frota = await entrar('frota.a@teste.local')

  // Pedido e carro proprios: a varredura empurra o estado 28 vezes, e aprovar
  // de verdade amarra um veiculo a uma janela.
  const veiculo = criarVeiculo(empresaA, 'AAA9S99')
  // Ele precisa ATENDER a categoria do pedido: liberar carro de fora da
  // categoria e' permitido, mas exige justificativa escrita — outra regra, com
  // teste proprio. A varredura aqui e' sobre ESTADO, e nao sobre categoria.
  executar('INSERT INTO veiculo_categorias (empresa_id, veiculo_id, categoria_id) VALUES (?, ?, ?)',
    [empresaA, veiculo, catA])
  veiculoSolicitacaoLivre = veiculo

  const id = novoId('solicitacao')
  const ts = agora()
  executar(
    `INSERT INTO solicitacoes (id, empresa_id, numero, solicitante_id, categoria_id,
                               janela_inicio, janela_fim, motivo, status, criado_em, atualizado_em)
     VALUES (?, ?, 9001, ?, ?, ?, ?, 'Pedido da varredura de estados', 'pendente', ?, ?)`,
    [id, empresaA, frotaA, catA, daquiAHoras(4000), daquiAHoras(4004), ts, ts])

  const situacao = () => consultarUm('SELECT status FROM solicitacoes WHERE id = ?', [id]).status
  const por = (estado) => executar(
    'UPDATE solicitacoes SET status = ?, veiculo_id = NULL, devolvido_em = NULL WHERE id = ?',
    [estado, id])

  const aceitouDemais = []
  const recusouDeMais = []
  const mexeuRecusando = []
  let tentativas = 0

  for (const { acao, aceita, corpo } of ACOES_DA_SOLICITACAO) {
    for (const estado of STATUS_SOLICITACAO_TESTE) {
      por(estado)
      // `devolver` precisa de um carro amarrado para ter o que devolver.
      if (estado === 'em_uso') {
        executar('UPDATE solicitacoes SET veiculo_id = ? WHERE id = ?', [veiculo, id])
      }
      tentativas += 1

      const r = await chamar('POST', `/api/solicitacoes/${id}/${acao}`,
        { token: frota, corpo: corpo() })
      const permitida = aceita.includes(estado)
      const ficou = situacao()

      if (permitida && r.status !== 200) {
        recusouDeMais.push(`${acao} em "${estado}": ${r.status} ${r.dados?.mensagem || ''}`)
      }
      if (!permitida && r.status === 200) {
        aceitouDemais.push(`${acao} em "${estado}": aceita, e nao devia`)
      }
      if (!permitida && ficou !== estado) {
        mexeuRecusando.push(`${acao} em "${estado}": recusou com ${r.status} e virou "${ficou}"`)
      }
    }
  }

  assert.ok(tentativas >= 24, `poucas tentativas: ${tentativas}`)
  assert.deepEqual(aceitouDemais, [],
    `acao aceita num estado que nao devia aceitar:\n${aceitouDemais.join('\n')}`)
  assert.deepEqual(recusouDeMais, [],
    `acao recusada num estado em que devia valer:\n${recusouDeMais.join('\n')}`)
  assert.deepEqual(mexeuRecusando, [],
    `recusou e gravou assim mesmo:\n${mexeuRecusando.join('\n')}`)
})

// O veiculo tem a maquina mais aberta das tres: a Frota pode pos-lo em qualquer
// dos quatro estados, porque isso e' decisao dela. A regra unica e' de SAIDA —
// tirar um carro de BLOQUEADO sempre exige motivo escrito, inclusive quando o
// bloqueio veio de uma ocorrencia critica e um diagnostico concluiu que o carro
// pode rodar (roadmap 9.3).
//
// Regra de uma linha so, e por isso mesmo facil de perder numa refatoracao: as
// dezesseis combinacoes sao exercidas com e sem motivo.
test('estados: soltar veiculo bloqueado exige motivo, e so isso', async () => {
  const frota = await entrar('frota.a@teste.local')
  const veiculo = criarVeiculo(empresaA, 'AAA9E99')

  const situacao = () => consultarUm('SELECT status, motivo_status FROM veiculos WHERE id = ?',
    [veiculo])
  const por = (estado) => executar(
    'UPDATE veiculos SET status = ?, motivo_status = ? WHERE id = ?',
    [estado, estado === 'bloqueado' ? 'motivo original do bloqueio' : null, veiculo])

  const semMotivoPassou = []
  const comMotivoFalhou = []
  const mexeuRecusando = []
  let pares = 0

  for (const de of STATUS_VEICULO_TESTE) {
    for (const para of STATUS_VEICULO_TESTE) {
      if (de === para) continue
      pares += 1

      // Sem motivo.
      por(de)
      const seco = await chamar('POST', `/api/veiculos/${veiculo}/status`,
        { token: frota, corpo: { status: para } })
      const precisaMotivo = de === 'bloqueado'
      const depoisSeco = situacao()

      if (precisaMotivo && seco.status === 200) {
        semMotivoPassou.push(`${de} -> ${para}: soltou sem motivo`)
      }
      if (precisaMotivo && depoisSeco.status !== de) {
        mexeuRecusando.push(`${de} -> ${para}: recusou e mudou para "${depoisSeco.status}"`)
      }
      if (!precisaMotivo && seco.status !== 200) {
        comMotivoFalhou.push(`${de} -> ${para} sem motivo: ${seco.status} ${seco.dados?.mensagem || ''}`)
      }

      // Com motivo, tem que passar sempre.
      por(de)
      const comMotivo = await chamar('POST', `/api/veiculos/${veiculo}/status`,
        { token: frota, corpo: { status: para, motivo: 'decisao da varredura' } })
      if (comMotivo.status !== 200) {
        comMotivoFalhou.push(`${de} -> ${para} COM motivo: ${comMotivo.status} ${comMotivo.dados?.mensagem || ''}`)
      } else if (situacao().status !== para) {
        comMotivoFalhou.push(`${de} -> ${para}: respondeu 200 e ficou em "${situacao().status}"`)
      }
    }
  }

  assert.ok(pares >= 12, `poucos pares exercidos: ${pares}`)
  assert.deepEqual(semMotivoPassou, [],
    `carro bloqueado solto sem motivo escrito:\n${semMotivoPassou.join('\n')}`)
  assert.deepEqual(comMotivoFalhou, [],
    `transicao que devia passar e nao passou:\n${comMotivoFalhou.join('\n')}`)
  assert.deepEqual(mexeuRecusando, [],
    `recusou e gravou assim mesmo:\n${mexeuRecusando.join('\n')}`)

  // Bloqueado para bloqueado nao e' saida de bloqueio: trocar o motivo do
  // proprio bloqueio nao precisa passar pela mesma exigencia.
  por('bloqueado')
  const mesmo = await chamar('POST', `/api/veiculos/${veiculo}/status`,
    { token: frota, corpo: { status: 'bloqueado' } })
  assert.equal(mesmo.status, 200, 'reafirmar o bloqueio nao e solta-lo')
})

// O ciclo de vida do modelo de checklist: rascunho -> publicado -> arquivado.
//
// A regra que sustenta tudo e' a D50: versao publicada e' IMUTAVEL, porque cada
// inspecao aponta para a linha dela. Editar uma versao publicada reescreveria o
// significado de checklists ja respondidos — uma pergunta removida hoje faria
// uma inspecao do mes passado parecer incompleta.
//
// Cinco acoes contra tres estados. `versao` aceitar ARQUIVADO e' de proposito:
// "voltar para a versao antiga e partir dela" e' operacao legitima, e o rascunho
// que nasce recebe o proximo numero livre, sem sobrescrever nada.
const ACOES_DO_MODELO = [
  { acao: 'editar',    aceita: ['rascunho'] },
  { acao: 'publicar',  aceita: ['rascunho'] },
  { acao: 'descartar', aceita: ['rascunho'] },
  { acao: 'imagem',    aceita: ['rascunho'] },
  { acao: 'versao',    aceita: ['publicado', 'arquivado'] },
]

// PNG de um pixel — o menor arquivo que passa pela conferencia de assinatura.
const PNG_MINIMO = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

test('modelo: o PUT aceita corpo parcial e nao apaga o que nao veio', async () => {
  // Todo campo do PUT e' `corpo.X === undefined ? antes.X : ...` — a rota foi
  // feita para receber so o que mudou. Esse caminho nunca tinha sido exercido:
  // todo chamador de hoje manda o corpo inteiro, o painel incluido.
  //
  // E ele estava QUEBRADO. `lerRitmo` fazia `JSON.parse(antes.dias_semana)`,
  // mas `antes` vem de `buscarNaEmpresa`, que ja desserializou o campo em
  // array. `JSON.parse(String([1,2,3,4,5]))` e' `JSON.parse('1,2,3,4,5')`, que
  // levanta SyntaxError — 500 na cara de quem so queria corrigir o nome.
  const frota = await entrar('frota.a@teste.local')

  const criado = await chamar('POST', '/api/templates', {
    token: frota,
    corpo: {
      codigo: 'put-parcial', nome: 'Antes do PUT parcial', tipo_veiculo: 'pickup',
      cargos_liberados: [cgMotoristaA], exige_assinatura: true, finalidade: 'padrao',
      periodicidade: 'diario', dias_semana: [1, 3, 5], horario_limite: '09:45',
      estrutura: ESTRUTURA,
    },
  })
  assert.equal(criado.status, 200, JSON.stringify(criado.dados))

  const antes = criado.dados.template
  const r = await chamar('PUT', `/api/templates/${antes.id}`, {
    token: frota, corpo: { nome: 'Depois do PUT parcial' },
  })
  assert.equal(r.status, 200, `corpo parcial derrubou a rota: ${JSON.stringify(r.dados)}`)

  const depois = r.dados.template
  assert.equal(depois.nome, 'Depois do PUT parcial', 'o que veio no corpo muda')

  // E nada mais muda. Um a um, porque "nao apaga o que nao veio" so vale se
  // valer para todos.
  assert.equal(depois.tipo_veiculo, 'pickup')
  assert.deepEqual(depois.cargos_liberados, [cgMotoristaA])
  assert.equal(depois.exige_assinatura, true)
  assert.equal(depois.periodicidade, 'diario')
  assert.deepEqual(depois.dias_semana, [1, 3, 5], 'o ritmo era exatamente o campo que explodia')
  assert.equal(depois.horario_limite, '09:45')
  assert.equal(depois.finalidade, 'padrao')
  assert.equal(depois.estrutura.perguntas.length, ESTRUTURA.perguntas.length)

  // E com dias_semana vazio tambem — o outro formato que o `JSON.parse` nao
  // aguentava (`String([])` e' texto vazio, e `JSON.parse('')` tambem levanta).
  const avulso = await chamar('POST', '/api/templates', {
    token: frota,
    corpo: {
      codigo: 'put-parcial-avulso', nome: 'Avulso', tipo_veiculo: 'compacto_leve',
      cargos_liberados: ['*'], finalidade: 'padrao', periodicidade: 'avulso',
      estrutura: ESTRUTURA,
    },
  })
  const semDias = await chamar('PUT', `/api/templates/${avulso.dados.template.id}`, {
    token: frota, corpo: { nome: 'Avulso renomeado' },
  })
  assert.equal(semDias.status, 200, JSON.stringify(semDias.dados))
  assert.deepEqual(semDias.dados.template.dias_semana, [])
})

test('estados: cada acao do modelo so vale onde a imutabilidade permite', async () => {
  const frota = await entrar('frota.a@teste.local')

  // Codigo proprio: publicar arquiva a versao anterior do MESMO codigo, e
  // emprestar o codigo de outro teste bagunca o vizinho.
  const id = criarDiario(empresaA, 'ciclo-de-vida', 'compacto_leve')

  const situacao = () => consultarUm('SELECT status FROM templates WHERE id = ?', [id])?.status
  const por = (estado) => {
    // O registro pode ter sido descartado por uma tentativa anterior.
    if (!situacao()) {
      executar(
        `INSERT INTO templates (id, empresa_id, codigo, nome, tipo_veiculo, cargos_liberados,
                                exige_assinatura, finalidade, periodicidade, dias_semana,
                                horario_limite, versao, status, estrutura,
                                publicado_em, criado_em, atualizado_em)
         VALUES (?, ?, 'ciclo-de-vida', 'Ciclo de vida', 'compacto_leve', '["*"]', 0, 'padrao',
                 'diario', '[1,2,3,4,5]', '08:30', 1, ?, ?, ?, ?, ?)`,
        [id, empresaA, estado, JSON.stringify(ESTRUTURA), ts, ts, ts])
      return
    }
    executar('UPDATE templates SET status = ? WHERE id = ?', [estado, id])
    // Um rascunho irmao sobrando faz `versao` recusar por outro motivo.
    executar(`DELETE FROM templates WHERE empresa_id = ? AND codigo = 'ciclo-de-vida' AND id <> ?`,
      [empresaA, id])
  }

  const disparar = (acao) => {
    if (acao === 'editar') {
      return chamar('PUT', `/api/templates/${id}`, { token: frota, corpo: { nome: 'Renomeado' } })
    }
    if (acao === 'descartar') return chamar('DELETE', `/api/templates/${id}`, { token: frota })
    if (acao === 'imagem') {
      return chamar('POST', `/api/templates/${id}/imagem`,
        { token: frota, corpo: { conteudo: PNG_MINIMO, tipo_mime: 'image/png' } })
    }
    return chamar('POST', `/api/templates/${id}/${acao}`, { token: frota, corpo: {} })
  }

  const aceitouDemais = []
  const recusouDeMais = []
  let tentativas = 0

  for (const { acao, aceita } of ACOES_DO_MODELO) {
    for (const estado of ['rascunho', 'publicado', 'arquivado']) {
      por(estado)
      tentativas += 1
      const r = await disparar(acao)
      const permitida = aceita.includes(estado)

      if (permitida && r.status !== 200) {
        recusouDeMais.push(`${acao} em "${estado}": ${r.status} ${r.dados?.mensagem || ''}`)
      }
      if (!permitida && r.status === 200) {
        aceitouDemais.push(`${acao} em "${estado}": aceita, e versao publicada e imutavel`)
      }
    }
  }

  assert.ok(tentativas >= 15, `poucas tentativas: ${tentativas}`)
  assert.deepEqual(aceitouDemais, [],
    `acao aceita num estado que a imutabilidade nao permite:\n${aceitouDemais.join('\n')}`)
  assert.deepEqual(recusouDeMais, [],
    `acao recusada num estado em que devia valer:\n${recusouDeMais.join('\n')}`)
})

test('limite da consulta: numero que nao da para ler vira o padrao', async () => {
  // `Math.min(Number(bruto || 100), 500)` parecia bastar e nao bastava:
  // `Number('lixo')` da NaN, `Math.min(NaN, 500)` da NaN, e `LIMIT NaN` derruba
  // a consulta. Abrir a auditoria com um marcador antigo na barra devolvia 500.
  //
  // Negativo e zero sao piores que o NaN de um jeito proprio: `LIMIT -5` e' erro
  // de SQL, e `LIMIT 0` devolve lista vazia EM SILENCIO — parece que nao ha nada
  // para ver.
  const frota = await entrar('frota.a@teste.local')

  const padrao = await chamar('GET', '/api/auditoria', { token: frota })
  assert.equal(padrao.status, 200)
  assert.equal(padrao.dados.limite, 100, 'o padrao da auditoria e 100')
  assert.ok(padrao.dados.eventos.length > 0, 'controle: a auditoria tem eventos para contar')

  const naoLegiveis = ['lixo', '', 'NaN', 'Infinity', '1e999', '0', '-5', '-1', 'null', '{}']
  for (const bruto of naoLegiveis) {
    const r = await chamar('GET', `/api/auditoria?limite=${encodeURIComponent(bruto)}`,
      { token: frota })
    assert.equal(r.status, 200, `limite=${JSON.stringify(bruto)} devolveu ${r.status}`)
    assert.equal(r.dados.limite, 100,
      `limite=${JSON.stringify(bruto)} virou ${r.dados.limite}, e devia cair no padrao`)
  }

  // O que DA para ler continua valendo, e o teto continua sendo teto.
  assert.equal((await chamar('GET', '/api/auditoria?limite=7', { token: frota })).dados.limite, 7)
  assert.equal((await chamar('GET', '/api/auditoria?limite=7.9', { token: frota })).dados.limite, 7,
    'fracao trunca, e nao vira NaN nem erro')
  assert.equal((await chamar('GET', '/api/auditoria?limite=99999', { token: frota })).dados.limite, 500,
    'o teto de 500 protege a memoria do servidor')

  const sete = await chamar('GET', '/api/auditoria?limite=7', { token: frota })
  assert.ok(sete.dados.eventos.length <= 7, 'e o limite tem que valer de verdade na consulta')

  // A mesma regra vale no historico do usuario, que usava o mesmo idioma.
  const hist = await chamar('GET', `/api/usuarios/${frotaA}/historico?limite=lixo`,
    { token: frota })
  assert.equal(hist.status, 200, 'o historico caia pelo mesmo motivo')
})

test('entrada quase valida com um campo envenenado nunca vira 500', async () => {
  // A varredura de lixo puro acima tem um limite que so aparece quando se
  // tenta conferi-la: um corpo vazio ou absurdo e' barrado pela PRIMEIRA
  // validacao da rota e nunca alcanca o codigo mais fundo.
  //
  // Foi o que aconteceu ao injetar `ctx.corpo.tipo.toLowerCase()` em veiculos
  // para testar a varredura: `{ tipo: 7 }` sem placa morria antes, no "informe
  // a placa", e a injecao passava despercebida.
  //
  // Esta versao parte de um corpo VALIDO e envenena um campo por vez. E' assim
  // que se alcanca a linha que le um numero como se fosse texto.
  const frota = await entrar('frota.a@teste.local')

  const VENENOS = [7, {}, [], null, true, -1, '', ' '.repeat(300), { toString: null }]

  // Alvo DESCARTAVEL para os PATCH: a primeira versao envenenava o proprio
  // frotaA da fixture, e `acessa_painel: null` vira 0 — o varredor demitia o
  // administrador e os testes seguintes levavam 403. Varredura precisa de
  // cobaia, nao de quem os vizinhos dependem.
  const cobaia = (await chamar('POST', '/api/usuarios', {
    token: frota,
    corpo: {
      nome: 'Cobaia da Varredura', cpf: '55566677568', email: 'cobaia@teste.local',
      telefone: '(31) 90000-7777', cargo_id: cgMotoristaA, acessa_painel: false,
    },
  })).dados.usuario.id

  const bases = [
    ['POST', '/api/veiculos', {
      placa: 'ZZZ7Z77', modelo: 'Teste', tipo: 'compacto_leve', ano: 2020, km_atual: 100,
    }],
    ['PATCH', `/api/veiculos/${veiculoA4}`, {
      modelo: 'Teste', marca: 'Marca', tipo: 'compacto_leve', ano: 2020,
    }],
    ['POST', '/api/cargos', { nome: 'Cargo de teste' }],
    ['POST', '/api/categorias', { nome: 'Categoria de teste', assentos: 4, carroceria: 'compacto' }],
    ['PATCH', `/api/usuarios/${cobaia}`, {
      nome: 'Nome', telefone: '(31) 90000-0000', cargo_id: cgMotoristaA,
      acessa_painel: false, usa_veiculo_diario: false,
    }],
    ['POST', '/api/templates', {
      codigo: 'fuzz-teste', nome: 'Modelo de teste', tipo_veiculo: 'compacto_leve',
      cargos_liberados: ['*'], periodicidade: 'avulso', exige_assinatura: false,
    }],
  ]

  const quebrados = []
  for (const [metodo, caminho, base] of bases) {
    for (const campo of Object.keys(base)) {
      for (const veneno of VENENOS) {
        // Placa unica a cada tentativa: senao a segunda cai em conflito antes
        // de chegar onde interessa.
        const corpo = { ...base, [campo]: veneno }
        if (corpo.placa && campo !== 'placa') {
          corpo.placa = `ZZ${Math.random().toString(36).slice(2, 5).toUpperCase()}9Z9`
        }
        if (corpo.codigo && campo !== 'codigo') {
          corpo.codigo = `fuzz-${Math.random().toString(36).slice(2, 8)}`
        }
        if (corpo.nome && campo !== 'nome' && caminho.includes('cargos')) {
          corpo.nome = `Cargo ${Math.random().toString(36).slice(2, 8)}`
        }
        const r = await chamar(metodo, caminho, { token: frota, corpo })
        if (r.status >= 500) {
          quebrados.push(`${metodo} ${caminho} <- ${campo}=${JSON.stringify(veneno)}`)
        }
      }
    }
  }

  assert.deepEqual(quebrados, [], `respostas 500:\n  ${quebrados.join('\n  ')}`)
})

test('corpo: campo que quebra a coercao e recusado na porta', async () => {
  // `String({ toString: null })` levanta TypeError, e o servidor coage texto em
  // umas sessenta linhas. Um JSON com esse campo virava 500 — sem codigo, sem
  // frase, e com rastro de excecao no log.
  //
  // A recusa mora em `lerCorpo`, e nao nas sessenta linhas: uma porta e' mais
  // facil de manter fechada que sessenta janelas.
  const frota = await entrar('frota.a@teste.local')

  for (const chave of ['toString', 'valueOf', '__proto__']) {
    const r = await chamar('POST', '/api/cargos',
      { token: frota, corpo: { nome: 'Cargo', [chave]: null } })
    assert.equal(r.status, 400, `${chave} devia ser recusado`)
    assert.match(r.dados.mensagem, new RegExp(chave.replace('__', '__')),
      'a mensagem tem que dizer qual campo')
  }

  // Aninhado tambem: o corpo do checklist leva um mapa de respostas.
  const fundo = await chamar('POST', '/api/inspecoes', {
    token: frota,
    corpo: { cliente_uuid: 'x', respostas: { pneus: { toString: null } } },
  })
  assert.equal(fundo.status, 400)

  // E o campo com nome parecido continua passando: a recusa e' exata.
  const ok = await chamar('POST', '/api/cargos',
    { token: frota, corpo: { nome: `Cargo ${Date.now()}`, tostring: 'minusculo' } })
  assert.notEqual(ok.status, 400, 'so os tres nomes exatos sao recusados')
})

test('usuarios: cargo vazio no PATCH e recusado, nao gravado', async () => {
  // `String('')` e `String([])` sao ambos '', que e falsy: a conferencia do
  // cargo era pulada e o UPDATE gravava chave estrangeira invalida. O banco
  // recusava, e o resultado chegava como 500.
  const frota = await entrar('frota.a@teste.local')
  const alvo = consultarUm('SELECT id, cargo_id FROM usuarios WHERE email = ?',
    ['vendas.a@teste.local'])

  for (const vazio of ['', [], null]) {
    const r = await chamar('PATCH', `/api/usuarios/${alvo.id}`,
      { token: frota, corpo: { cargo_id: vazio } })
    assert.equal(r.status, 400,
      `cargo_id=${JSON.stringify(vazio)} devia ser 400; veio ${r.status} ${JSON.stringify(r.dados)}`)
    assert.match(r.dados.mensagem, /cargo/i)
  }

  // E o cargo que estava la continua la.
  const depois = consultarUm('SELECT cargo_id FROM usuarios WHERE id = ?', [alvo.id])
  assert.equal(depois.cargo_id, alvo.cargo_id)

  // Nao mandar o campo continua mantendo o cargo, como sempre.
  const semCampo = await chamar('PATCH', `/api/usuarios/${alvo.id}`,
    { token: frota, corpo: { nome: 'Vendas A' } })
  assert.equal(semCampo.status, 200)
  assert.equal(semCampo.dados.usuario.cargo_id, alvo.cargo_id)
})

test('painel: o card de hoje conta o dia da operacao, nao o dia em UTC', async () => {
  // `new Date().toISOString().slice(0, 10)` e' o dia em UTC. No Brasil, entre
  // 21h e meia-noite ele ja e' amanha: o card "checklists de hoje" contava os de
  // amanha — zero — durante tres horas toda noite, no fim de turno.
  //
  // A D37 passou por painel.js e corrigiu o `hoje` da cobranca; este, duas
  // linhas acima, ficou.
  //
  // A asercao precisa ISOLAR a linha alvo, e a rota so devolve contagem: entao
  // o teste move a MESMA inspecao entre dois instantes e compara. A primeira
  // versao so exigia `hoje > 0`, e passava com o defeito reintroduzido porque as
  // outras inspecoes da suite ja bastavam para o contador.
  const frota = await entrar('frota.a@teste.local')
  const hoje = diaLocal()
  const noite = naHoraDaOperacao(hoje, 22, 30)

  // Com a operacao em UTC nao ha deslocamento, e 22h30 da operacao E' o mesmo
  // dia em UTC: o cenario deixa de DISCRIMINAR o defeito, embora a regra que ele
  // afirma continue valendo. Entao a guarda e' condicional e a asercao de
  // comportamento, nao — o teste continua util em todo fuso, e forte onde pode.
  const separaOsDias = noite.toISOString().slice(0, 10) !== hoje

  const alvo = consultarUm(
    'SELECT id FROM inspecoes WHERE empresa_id = ? ORDER BY criado_em LIMIT 1', [empresaA])
  const contar = async () =>
    (await chamar('GET', '/api/painel', { token: frota })).dados.checklists.hoje

  // Longe de hoje: a inspecao nao conta.
  executar('UPDATE inspecoes SET iniciada_em = ? WHERE id = ?',
    [naHoraDaOperacao(diaLocal(new Date(Date.now() - 10 * 86400000)), 12, 0).toISOString(), alvo.id])
  const fora = await contar()

  // As 22h30 de hoje na operacao: passa a contar, mesmo sendo outro dia em UTC.
  executar('UPDATE inspecoes SET iniciada_em = ? WHERE id = ?', [noite.toISOString(), alvo.id])
  const dentro = await contar()

  assert.equal(dentro, fora + 1,
    'o checklist das 22h30 de hoje tem que entrar no card de hoje, e so ele mudou')

  // E, quando o fuso da operacao separa os dois dias, isto foi de fato uma prova
  // contra o defeito — e nao uma coincidencia de calendario.
  if (separaOsDias) {
    assert.notEqual(noite.toISOString().slice(0, 10), hoje)
  }
})

test('saida: reserva aprovada nao tira do patio um carro bloqueado depois', async () => {
  // A conferencia da placa acontece na APROVACAO. O bloqueio quase sempre nasce
  // DEPOIS dela: vem de outro checklist, pelo `agrava()`, ou da propria Frota,
  // de madrugada. Nada revalidava na saida.
  //
  // O estrago: reserva aprovada ontem, carro bloqueado as 3h por pneu liso
  // critico, e a pessoa faz a saida hoje de manha, o pedido vira `em_uso` e ela
  // dirige o veiculo que a frota tinha tirado de circulacao. Sem erro, sem
  // aviso, sem nada na tela do aparelho.
  const frota = await entrar('frota.a@teste.local')
  const motorista = await entrar('motorista.a@teste.local')
  const solicitacao = await reservar(frota, motorista, veiculoSaida, 1200)
  const app = await chamar('GET', '/api/app/inicio', { token: motorista })
  const tarefa = app.dados.tarefas.find((t) => t.solicitacao_id === solicitacao)
  assert.ok(tarefa, 'a reserva precisa aparecer como tarefa')

  // A Frota bloqueia DEPOIS da aprovacao.
  const bloqueio = await chamar('POST', `/api/veiculos/${veiculoSaida}/status`, {
    token: frota, corpo: { status: 'bloqueado', motivo: 'Pneu liso critico no retorno da noite.' },
  })
  assert.equal(bloqueio.status, 200)

  const saida = await chamar('POST', '/api/inspecoes', {
    token: motorista,
    corpo: {
      cliente_uuid: 'uuid-saida-carro-bloqueado', solicitacao_id: solicitacao,
      template_id: tarefa.template_id, momento: 'saida',
      respostas: { lataria: { desfecho: 'ok' }, pneus: { desfecho: 'ok' } },
    },
  })
  assert.equal(saida.status, 409, JSON.stringify(saida.dados))
  assert.match(saida.dados.mensagem, /bloqueado/i)
  assert.match(saida.dados.mensagem, /pneu liso/i, 'o motivo do bloqueio tem que vir junto')

  // E o pedido continua aprovado — nao virou `em_uso`.
  const depois = await chamar('GET', `/api/solicitacoes/${solicitacao}`, { token: frota })
  assert.equal(depois.dados.solicitacao.status, 'aprovada')

  // Liberado com motivo, a saida volta a passar: a guarda e' sobre o estado do
  // carro, nao sobre a reserva.
  await chamar('POST', `/api/veiculos/${veiculoSaida}/status`, {
    token: frota, corpo: { status: 'disponivel', motivo: 'Pneu trocado; laudo anexado.' },
  })
  const segunda = await chamar('POST', '/api/inspecoes', {
    token: motorista,
    corpo: {
      cliente_uuid: 'uuid-saida-depois-de-liberar', solicitacao_id: solicitacao,
      template_id: tarefa.template_id, momento: 'saida',
      respostas: { lataria: { desfecho: 'ok' }, pneus: { desfecho: 'ok' } },
    },
  })
  assert.equal(segunda.status, 200, JSON.stringify(segunda.dados))
})

test('saida: a preventiva LEVA o carro bloqueado para a oficina', async () => {
  // A guarda acima nao pode valer para preventiva: carro bloqueado indo para a
  // oficina e' o caso normal dela. Barrar isso deixaria o veiculo preso —
  // bloqueado por uma ocorrencia, e sem poder executar a manutencao que a
  // resolve.
  const frota = await entrar('frota.a@teste.local')
  const mecanico = await entrar('mecanico.a@teste.local')

  await chamar('POST', `/api/veiculos/${veiculoA4}/status`, {
    token: frota, corpo: { status: 'bloqueado', motivo: 'Freio com folga; vai para a oficina.' },
  })

  const app = await chamar('GET', '/api/app/inicio', { token: mecanico })
  const prev = app.dados.preventivas.find((p) => p.veiculo.id === veiculoA4)
  if (!prev) return   // sem preventiva agendada neste carro agora: nada a provar

  const r = await chamar('POST', '/api/inspecoes', {
    token: mecanico,
    corpo: {
      cliente_uuid: 'uuid-preventiva-carro-bloqueado', preventiva_id: prev.preventiva_id,
      template_id: prev.template_id, momento: 'saida',
      respostas: { pinca: { desfecho: 'ok', fotos: 1 } },
    },
  })
  assert.notEqual(r.status, 409,
    'preventiva em carro bloqueado tem que passar: e para isso que ela existe')
})

test('freio: cabecalho forjado nao cria balde novo a cada tentativa', async () => {
  // `x-forwarded-for` e' escrito pelo cliente. Como ele era a chave do freio —
  // `login|email|ip` e `ip|ip` — bastava incrementar um IP a cada tentativa para
  // que nenhuma caisse no mesmo balde: as tres frentes do freio caiam juntas com
  // um cabecalho de uma linha, e a conta da Frota podia ser martelada a noite
  // inteira sem nunca ver um 429.
  //
  // Sem proxy declarado, o cabecalho e' ignorado por inteiro.
  zerarFreio()
  try {
    const chutar = (n) => fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.9.${n}` },
      body: JSON.stringify({ email: 'frota.a@teste.local', senha: `chute-${n}` }),
    })

    for (let i = 0; i < LIMITES.login; i += 1) {
      const r = await chutar(i)
      assert.equal(r.status, 401, `tentativa ${i + 1} devia ser so senha errada`)
    }

    const barrada = await chutar(999)
    assert.equal(barrada.status, 429,
      'IP forjado diferente a cada tentativa nao pode escapar do freio')

    // E a senha certa tambem para: o freio e' da conta, e ele pegou.
    const comSenhaCerta = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.9.1234' },
      body: JSON.stringify({ email: 'frota.a@teste.local', senha: SENHA }),
    })
    assert.equal(comSenhaCerta.status, 429)
  } finally {
    zerarFreio()
  }
})

test('freio: atras de proxy declarado, o endereco vem da direita', async () => {
  // Com proxy na frente, o proxy ACRESCENTA ao fim da lista o endereco que ele
  // mesmo enxergou. O que o cliente forjou fica a esquerda e nao alcanca a
  // posicao que conta.
  const { ipDe } = await import('../src/nucleo/http.js')
  const { config } = await import('../src/nucleo/config.js')

  const req = (xff) => ({ headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress: '127.0.0.1' } })
  const original = config.proxiesConfiaveis
  try {
    config.proxiesConfiaveis = 0
    assert.equal(ipDe(req('1.2.3.4')), '127.0.0.1', 'sem proxy, o cabecalho e ignorado')

    config.proxiesConfiaveis = 1
    // O cliente forjou "1.2.3.4"; o proxy acrescentou o endereco real dele.
    assert.equal(ipDe(req('1.2.3.4, 200.1.1.1')), '200.1.1.1')
    // Uma entrada so, com um proxy na frente, e' o caso NORMAL: o cliente nao
    // mandou cabecalho nenhum e o proxy acrescentou o que enxergou. Essa entrada
    // e' observacao do proxy, nao invencao do cliente.
    assert.equal(ipDe(req('200.1.1.1')), '200.1.1.1')

    // Sem cabecalho nenhum, o socket e' a resposta honesta.
    assert.equal(ipDe(req('')), '127.0.0.1')

    // Com DOIS proxies, a cadeia legitima tem duas entradas: o primeiro proxy
    // acrescenta o endereco do cliente, o segundo acrescenta o do primeiro. O
    // socket e' o segundo proxy, e nao entra no cabecalho.
    config.proxiesConfiaveis = 2
    assert.equal(ipDe(req('200.1.1.1, 10.0.0.1')), '200.1.1.1', 'cadeia legitima')

    // Se o cliente forjar uma entrada, a cadeia fica com TRES — e a posicao que
    // conta continua sendo a mesma distancia do fim. O forjado fica de fora.
    assert.equal(ipDe(req('9.9.9.9, 200.1.1.1, 10.0.0.1')), '200.1.1.1',
      'o que o cliente inventou nao alcanca a posicao que conta')
  } finally {
    config.proxiesConfiaveis = original
  }
})
