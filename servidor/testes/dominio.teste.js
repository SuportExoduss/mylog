// Testes das regras que nao podem quebrar em silencio.
// Rodar com: npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Banco proprio por execucao: o teste nunca toca no banco de desenvolvimento.
const bancoTemp = path.join(os.tmpdir(), `mylog-teste-${Date.now()}.db`)
process.env.MYLOG_BANCO = bancoTemp

const { abrirBanco, executar, consultar, consultarUm, novoId, agora, fecharBanco } =
  await import('../src/nucleo/banco.js')
const { avaliarPreventiva, avaliarPreventivas, diasEntre } =
  await import('../src/nucleo/preventivas.js')
const { gerarHashSenha, conferirSenha, validarForcaSenha } =
  await import('../src/seguranca/senha.js')
const { pode } = await import('../src/seguranca/permissoes.js')
const { normalizarPlaca, placaValida } = await import('../src/rotas/veiculos.js')

abrirBanco()

process.on('exit', () => {
  fecharBanco()
  for (const sufixo of ['', '-wal', '-shm']) {
    try { fs.rmSync(bancoTemp + sufixo) } catch { /* ja removido */ }
  }
})

// ------------------------------------------------------------------ senha

test('senha: hash nao guarda o texto e confere corretamente', () => {
  const { hash, salt } = gerarHashSenha('mylog123')
  assert.ok(!hash.includes('mylog123'))
  assert.equal(conferirSenha('mylog123', hash, salt), true)
  assert.equal(conferirSenha('mylog124', hash, salt), false)
  assert.equal(conferirSenha('mylog123', hash, 'salt-errado'), false)
})

test('senha: o mesmo texto gera hashes diferentes (salt por usuario)', () => {
  const a = gerarHashSenha('mylog123')
  const b = gerarHashSenha('mylog123')
  assert.notEqual(a.hash, b.hash)
})

test('senha: forca minima exigida', () => {
  assert.ok(validarForcaSenha('curta1'))
  assert.ok(validarForcaSenha('somenteletras'))
  assert.equal(validarForcaSenha('mylog123'), null)
})

// ------------------------------------------------------------------ placa

test('placa: normaliza e valida os dois formatos brasileiros', () => {
  assert.equal(normalizarPlaca(' abc-1d23 '), 'ABC1D23')
  assert.equal(placaValida('ABC1D23'), true)   // Mercosul
  assert.equal(placaValida('ABC1234'), true)   // antiga
  assert.equal(placaValida('AB1234'), false)
  assert.equal(placaValida('ABCD123'), false)
})

// ------------------------------------------------------------- permissoes

test('permissoes: colaborador nao mexe em dado mestre nem ve o painel', () => {
  const colaborador = { papel: 'colaborador' }
  assert.equal(pode(colaborador, 'veiculos.escrever'), false)
  assert.equal(pode(colaborador, 'usuarios.ler'), false)
  assert.equal(pode(colaborador, 'painel.ver'), false)
  assert.equal(pode(colaborador, 'inspecoes.executar'), true)
  assert.equal(pode(colaborador, 'tickets.abrir'), true)
})

test('permissoes: supervisor trata ocorrencia mas nao libera credencial', () => {
  const supervisor = { papel: 'supervisor' }
  assert.equal(pode(supervisor, 'nc.tratar'), true)
  assert.equal(pode(supervisor, 'usuarios.ativar'), false)
  assert.equal(pode(supervisor, 'usuarios.escrever'), false)
})

test('permissoes: auditoria enxerga tudo e nao altera nada', () => {
  const auditor = { papel: 'auditoria' }
  assert.equal(pode(auditor, 'inspecoes.ler'), true)
  assert.equal(pode(auditor, 'auditoria.ler'), true)
  assert.equal(pode(auditor, 'veiculos.escrever'), false)
  assert.equal(pode(auditor, 'nc.tratar'), false)
})

test('permissoes: papel desconhecido nao recebe nada', () => {
  assert.equal(pode({ papel: 'inventado' }, 'painel.ver'), false)
  assert.equal(pode(null, 'painel.ver'), false)
})

// ------------------------------------------------------------ preventivas

const emDias = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

test('preventiva por KM: em dia, proxima, muito proxima e vencida', () => {
  const base = { modo: 'km', proximo_km: 50000, alerta_antes_km: 1000 }
  assert.equal(avaliarPreventiva(base, 40000).status, 'em_dia')
  assert.equal(avaliarPreventiva(base, 47500).status, 'proxima')       // dentro de 3x a janela
  assert.equal(avaliarPreventiva(base, 49500).status, 'muito_proxima') // dentro da janela
  assert.equal(avaliarPreventiva(base, 50000).status, 'vencida')       // atingir o alvo ja vence
  assert.equal(avaliarPreventiva(base, 52000).status, 'vencida')
})

test('preventiva por KM: informa quanto falta e quanto passou', () => {
  const base = { modo: 'km', proximo_km: 50000, alerta_antes_km: 1000 }
  assert.equal(avaliarPreventiva(base, 49200).restante, 800)
  assert.equal(avaliarPreventiva(base, 52000).restante, -2000)
})

test('preventiva por data: respeita a janela de alerta configurada', () => {
  const base = { modo: 'data', alerta_antes_dias: 7 }
  assert.equal(avaliarPreventiva({ ...base, proxima_data: emDias(60) }).status, 'em_dia')
  assert.equal(avaliarPreventiva({ ...base, proxima_data: emDias(15) }).status, 'proxima')
  assert.equal(avaliarPreventiva({ ...base, proxima_data: emDias(3) }).status, 'muito_proxima')
  assert.equal(avaliarPreventiva({ ...base, proxima_data: emDias(-1) }).status, 'vencida')
})

test('preventiva sem alvo definido nao inventa alerta', () => {
  assert.equal(avaliarPreventiva({ modo: 'km', proximo_km: null }, 10000).status, 'em_dia')
  assert.equal(avaliarPreventiva({ modo: 'data', proxima_data: null }).status, 'em_dia')
})

test('diasEntre nao escorrega por causa de fuso', () => {
  assert.equal(diasEntre(emDias(0)), 0)
  assert.equal(diasEntre(emDias(10)), 10)
  assert.equal(diasEntre(emDias(-10)), -10)
})

// ------------------------------------------------------- isolamento tenant

function criarEmpresaComVeiculo(nome, placa, km) {
  const ts = agora()
  const empresaId = novoId('empresa')
  executar('INSERT INTO empresas (id, nome, status, politicas, criado_em, atualizado_em) VALUES (?, ?, \'ativa\', \'{}\', ?, ?)',
    [empresaId, nome, ts, ts])
  const veiculoId = novoId('veiculo')
  executar(
    `INSERT INTO veiculos (id, empresa_id, placa, modelo, tipo, km_atual, status, criado_em, atualizado_em)
     VALUES (?, ?, ?, 'Modelo', 'carro', ?, 'disponivel', ?, ?)`,
    [veiculoId, empresaId, placa, km, ts, ts])
  return { empresaId, veiculoId }
}

function criarPreventivaKm(empresaId, veiculoId, alvo) {
  const ts = agora()
  const id = novoId('preventiva')
  executar(
    `INSERT INTO preventivas (id, empresa_id, veiculo_id, modo, proximo_km, alerta_antes_km,
                              status, criado_em, atualizado_em)
     VALUES (?, ?, ?, 'km', ?, 500, 'em_dia', ?, ?)`,
    [id, empresaId, veiculoId, alvo, ts, ts])
  return id
}

test('multi-tenant: recalcular a empresa A nao toca nos dados da empresa B', () => {
  const a = criarEmpresaComVeiculo('Empresa A', 'AAA1A11', 60000)
  const b = criarEmpresaComVeiculo('Empresa B', 'BBB1B11', 60000)
  const prevA = criarPreventivaKm(a.empresaId, a.veiculoId, 50000) // ja vencida
  const prevB = criarPreventivaKm(b.empresaId, b.veiculoId, 50000) // tambem vencida

  avaliarPreventivas(a.empresaId)

  assert.equal(consultarUm('SELECT status FROM preventivas WHERE id = ?', [prevA]).status, 'vencida')
  assert.equal(consultarUm('SELECT status FROM preventivas WHERE id = ?', [prevB]).status, 'em_dia')
})

test('multi-tenant: a busca de veiculo so alcanca a propria empresa', () => {
  const a = criarEmpresaComVeiculo('Empresa C', 'CCC1C11', 100)
  criarEmpresaComVeiculo('Empresa D', 'DDD1D11', 100)
  const achados = consultar(
    'SELECT placa FROM veiculos WHERE empresa_id = ? AND placa LIKE ?',
    [a.empresaId, '%1%'])
  assert.deepEqual(achados.map((v) => v.placa), ['CCC1C11'])
})

test('multi-tenant: mesma placa pode existir em empresas diferentes', () => {
  const a = criarEmpresaComVeiculo('Empresa E', 'EEE1E11', 0)
  const ts = agora()
  const outraEmpresa = novoId('empresa')
  executar('INSERT INTO empresas (id, nome, status, politicas, criado_em, atualizado_em) VALUES (?, ?, \'ativa\', \'{}\', ?, ?)',
    [outraEmpresa, 'Empresa F', ts, ts])
  assert.doesNotThrow(() => {
    executar(
      `INSERT INTO veiculos (id, empresa_id, placa, modelo, tipo, km_atual, status, criado_em, atualizado_em)
       VALUES (?, ?, 'EEE1E11', 'Modelo', 'carro', 0, 'disponivel', ?, ?)`,
      [novoId('veiculo'), outraEmpresa, ts, ts])
  })
  // ... mas nao duas vezes na mesma empresa.
  assert.throws(() => {
    executar(
      `INSERT INTO veiculos (id, empresa_id, placa, modelo, tipo, km_atual, status, criado_em, atualizado_em)
       VALUES (?, ?, 'EEE1E11', 'Modelo', 'carro', 0, 'disponivel', ?, ?)`,
      [novoId('veiculo'), a.empresaId, ts, ts])
  }, /UNIQUE/)
})

// -------------------------------------------------------------- auditoria

test('auditoria: o registro nao expoe segredo de senha', async () => {
  const { semSegredos } = await import('../src/nucleo/auditoria.js')
  const limpo = semSegredos({ id: 'usr_1', nome: 'Teste', senha_hash: 'abc', senha_salt: 'def', token: 'xyz' })
  assert.deepEqual(limpo, { id: 'usr_1', nome: 'Teste' })
})
