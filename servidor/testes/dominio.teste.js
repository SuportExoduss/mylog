// Regras de dominio que nao podem quebrar em silencio (Roadmap v3.0).
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
const { nivelDe, ehFrota, perfilPublico } = await import('../src/seguranca/nivel.js')
const { normalizarPlaca, placaValida, STATUS_VEICULO, TIPOS_VEICULO } =
  await import('../src/rotas/veiculos.js')
const { gerarSenhaInicial, limparCpf, cpfValido } = await import('../src/rotas/usuarios.js')

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
  assert.notEqual(gerarHashSenha('mylog123').hash, gerarHashSenha('mylog123').hash)
})

test('senha: forca minima exigida', () => {
  assert.ok(validarForcaSenha('curta1'))
  assert.ok(validarForcaSenha('somenteletras'))
  assert.equal(validarForcaSenha('mylog123'), null)
})

test('senha inicial gerada passa na propria validacao de forca', () => {
  // Se a senha sorteada nao passasse, o usuario travaria no primeiro acesso.
  for (let i = 0; i < 200; i += 1) {
    const senha = gerarSenhaInicial()
    assert.ok(senha.length >= 8, `senha curta: ${senha}`)
    assert.equal(validarForcaSenha(senha), null, `reprovada: ${senha}`)
  }
})

test('senha inicial evita caracteres que se confundem lidos em voz alta', () => {
  // Quem repassa a senha e' uma pessoa falando com outra.
  for (let i = 0; i < 200; i += 1) {
    assert.ok(!/[O0Il1]/.test(gerarSenhaInicial()))
  }
})

test('senha inicial nao se repete', () => {
  const vistas = new Set()
  for (let i = 0; i < 500; i += 1) vistas.add(gerarSenhaInicial())
  assert.equal(vistas.size, 500)
})

// -------------------------------------------------------------------- cpf

test('cpf: limpa mascara e valida digito verificador', () => {
  assert.equal(limparCpf('529.982.247-25'), '52998224725')
  assert.equal(cpfValido('52998224725'), true)
  assert.equal(cpfValido('11144477735'), true)
})

test('cpf: recusa invalido, repetido e tamanho errado', () => {
  // Digito verificador errado — o caso que so apareceria no dia em que o
  // registro precisa valer.
  assert.equal(cpfValido('52998224724'), false)
  assert.equal(cpfValido('11111111111'), false)
  assert.equal(cpfValido('00000000000'), false)
  assert.equal(cpfValido('123456789'), false)
  assert.equal(cpfValido(''), false)
})

// ------------------------------------------------------------------ placa

test('placa: normaliza e valida os dois formatos brasileiros', () => {
  assert.equal(normalizarPlaca(' abc-1d23 '), 'ABC1D23')
  assert.equal(placaValida('ABC1D23'), true)   // Mercosul
  assert.equal(placaValida('ABC1234'), true)   // antiga
  assert.equal(placaValida('AB1234'), false)
  assert.equal(placaValida('ABCD123'), false)
})

// ------------------------------------------------------------------ nivel

test('nivel: dois niveis e apenas dois', () => {
  const frota = { acessa_painel: 1 }
  const colaborador = { acessa_painel: 0 }
  assert.equal(nivelDe(frota), 'frota')
  assert.equal(nivelDe(colaborador), 'colaborador')
  assert.equal(ehFrota(frota), true)
  assert.equal(ehFrota(colaborador), false)
  assert.equal(ehFrota(null), false)
  assert.equal(ehFrota(undefined), false)
})

test('nivel: cargo nao concede acesso ao painel', () => {
  // Cargo e' funcao na empresa, nao permissao (roadmap 3).
  const tecnico = { acessa_painel: 0, cargo_id: 'cgo_frota', cargo_nome: 'Equipe de frota' }
  assert.equal(ehFrota(tecnico), false)
})

test('perfil publico nao vaza hash nem salt', () => {
  const bruto = {
    id: 'usr_1', empresa_id: 'emp_1', nome: 'Teste', email: 'a@b.c',
    acessa_painel: 1, status: 'ativo', deve_trocar_senha: 0,
    senha_hash: 'SEGREDO', senha_salt: 'SEGREDO', cpf: '52998224725',
  }
  const publico = perfilPublico(bruto)
  const texto = JSON.stringify(publico)
  assert.ok(!texto.includes('SEGREDO'))
  assert.ok(!('senha_hash' in publico))
  assert.ok(!('senha_salt' in publico))
  assert.equal(publico.nivel, 'frota')
})

// ------------------------------------------------------------- enumeracoes

test('veiculo: status e tipos sao os do roadmap v3.0', () => {
  // "restrito" saiu; os tipos passaram a nomear a frota real.
  assert.deepEqual(STATUS_VEICULO, ['disponivel', 'com_pendencia', 'bloqueado', 'manutencao'])
  assert.ok(!STATUS_VEICULO.includes('restrito'))
  assert.deepEqual(TIPOS_VEICULO,
    ['compacto_leve', 'pickup', 'quatro_x_quatro', 'motocicleta', 'caminhao'])
})

// ------------------------------------------------------------ preventivas

const emDias = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

test('preventiva por KM: em dia, proxima, muito proxima e vencida', () => {
  const base = { modo: 'km', proximo_km: 50000, alerta_antes_km: 1000 }
  assert.equal(avaliarPreventiva(base, 40000).status, 'em_dia')
  assert.equal(avaliarPreventiva(base, 47500).status, 'proxima')
  assert.equal(avaliarPreventiva(base, 49500).status, 'muito_proxima')
  assert.equal(avaliarPreventiva(base, 50000).status, 'vencida')
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
  // Number(null) daria 0, e 0 seria lido como "alvo ja atingido".
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
  executar(`INSERT INTO empresas (id, nome, status, politicas, criado_em, atualizado_em)
            VALUES (?, ?, 'ativa', '{}', ?, ?)`, [empresaId, nome, ts, ts])
  const veiculoId = novoId('veiculo')
  executar(
    `INSERT INTO veiculos (id, empresa_id, placa, modelo, tipo, km_atual, status, criado_em, atualizado_em)
     VALUES (?, ?, ?, 'Modelo', 'compacto_leve', ?, 'disponivel', ?, ?)`,
    [veiculoId, empresaId, placa, km, ts, ts])
  return { empresaId, veiculoId }
}

function criarPreventivaKm(empresaId, veiculoId, alvo) {
  const ts = agora()
  const id = novoId('preventiva')
  executar(
    `INSERT INTO preventivas (id, empresa_id, veiculo_id, modo, proximo_km, alerta_antes_km,
                              status, criado_em, atualizado_em)
     VALUES (?, ?, ?, 'km', ?, 500, 'em_dia', ?, ?)`, [id, empresaId, veiculoId, alvo, ts, ts])
  return id
}

test('multi-tenant: recalcular a empresa A nao toca nos dados da empresa B', () => {
  const a = criarEmpresaComVeiculo('Empresa A', 'AAA1A11', 60000)
  const b = criarEmpresaComVeiculo('Empresa B', 'BBB1B11', 60000)
  const prevA = criarPreventivaKm(a.empresaId, a.veiculoId, 50000)
  const prevB = criarPreventivaKm(b.empresaId, b.veiculoId, 50000)

  avaliarPreventivas(a.empresaId)

  assert.equal(consultarUm('SELECT status FROM preventivas WHERE id = ?', [prevA]).status, 'vencida')
  assert.equal(consultarUm('SELECT status FROM preventivas WHERE id = ?', [prevB]).status, 'em_dia')
})

test('multi-tenant: mesma placa pode existir em empresas diferentes', () => {
  const a = criarEmpresaComVeiculo('Empresa E', 'EEE1E11', 0)
  const ts = agora()
  const outra = novoId('empresa')
  executar(`INSERT INTO empresas (id, nome, status, politicas, criado_em, atualizado_em)
            VALUES (?, 'Empresa F', 'ativa', '{}', ?, ?)`, [outra, ts, ts])
  assert.doesNotThrow(() => {
    executar(
      `INSERT INTO veiculos (id, empresa_id, placa, modelo, tipo, km_atual, status, criado_em, atualizado_em)
       VALUES (?, ?, 'EEE1E11', 'Modelo', 'compacto_leve', 0, 'disponivel', ?, ?)`,
      [novoId('veiculo'), outra, ts, ts])
  })
  // ... mas nao duas vezes na mesma empresa.
  assert.throws(() => {
    executar(
      `INSERT INTO veiculos (id, empresa_id, placa, modelo, tipo, km_atual, status, criado_em, atualizado_em)
       VALUES (?, ?, 'EEE1E11', 'Modelo', 'compacto_leve', 0, 'disponivel', ?, ?)`,
      [novoId('veiculo'), a.empresaId, ts, ts])
  }, /UNIQUE/)
})

test('multi-tenant: cargo com o mesmo nome pode existir em empresas diferentes', () => {
  const ts = agora()
  const criar = (nome) => {
    const id = novoId('empresa')
    executar(`INSERT INTO empresas (id, nome, status, politicas, criado_em, atualizado_em)
              VALUES (?, ?, 'ativa', '{}', ?, ?)`, [id, nome, ts, ts])
    return id
  }
  const e1 = criar('Empresa G')
  const e2 = criar('Empresa H')
  const cargo = (empresaId) => executar(
    'INSERT INTO cargos (id, empresa_id, nome, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)',
    [novoId('cargo'), empresaId, 'Motorista', ts, ts])

  assert.doesNotThrow(() => { cargo(e1); cargo(e2) })
  assert.throws(() => cargo(e1), /UNIQUE/)
})

// -------------------------------------------------------------- auditoria

test('auditoria: o registro nao expoe segredo de senha', async () => {
  const { semSegredos } = await import('../src/nucleo/auditoria.js')
  const limpo = semSegredos({ id: 'usr_1', nome: 'Teste', senha_hash: 'abc', senha_salt: 'def', token: 'xyz' })
  assert.deepEqual(limpo, { id: 'usr_1', nome: 'Teste' })
})

test('auditoria: guarda quem fez e sobre quem foi feito', async () => {
  const { registrarEvento } = await import('../src/nucleo/auditoria.js')
  const empresaId = novoId('empresa')
  const ts = agora()
  executar(`INSERT INTO empresas (id, nome, status, politicas, criado_em, atualizado_em)
            VALUES (?, 'Empresa I', 'ativa', '{}', ?, ?)`, [empresaId, ts, ts])

  registrarEvento({
    empresaId, ator: { id: 'usr_frota', nome: 'Marina' }, alvoId: 'usr_colab',
    acao: 'credencial.bloqueado', entidade: 'usuario', entidadeId: 'usr_colab',
  })
  const e = consultarUm(
    `SELECT ator_id, ator_nome, alvo_id FROM eventos_auditoria WHERE empresa_id = ?`, [empresaId])
  // Sem alvo_id, o historico do colaborador perderia o que fizeram sobre ele.
  assert.equal(e.ator_id, 'usr_frota')
  assert.equal(e.alvo_id, 'usr_colab')
})

// ----------------------------------- contrato entre o servidor e o painel

// O `destino` de uma notificacao e' a chave de uma tela do painel. Se o
// servidor gravar uma chave que o painel nao conhece, `navegar` cai na tela
// padrao **em silencio**: o clique no sino leva a pessoa para outro lugar e
// nada acusa. E' o tipo de defeito que so aparece em producao, num aviso
// especifico, semanas depois.
test('sino: todo destino gravado pelo servidor e uma tela que existe no painel', () => {
  const raiz = path.join(import.meta.dirname, '..', '..')

  const fontes = ['servidor/src/rotas', 'servidor/src/nucleo']
    .flatMap((dir) => fs.readdirSync(path.join(raiz, dir))
      .filter((f) => f.endsWith('.js'))
      .map((f) => fs.readFileSync(path.join(raiz, dir, f), 'utf8')))
    .join(' ')

  const destinos = new Set([...fontes.matchAll(/destino:\s*'([^']+)'/g)].map((m) => m[1]))
  assert.ok(destinos.size >= 4, 'a varredura precisa achar destinos; achou ' + destinos.size)

  const app = fs.readFileSync(path.join(raiz, 'web/js/app.js'), 'utf8')
  const telas = new Set([...app.matchAll(/\{\s*chave:\s*'([^']+)'/g)].map((m) => m[1]))
  assert.ok(telas.has('painel'), 'a varredura precisa achar as telas')

  const orfaos = [...destinos].filter((d) => !telas.has(d))
  assert.deepEqual(orfaos, [], `destino sem tela correspondente: ${orfaos.join(', ')}`)
})
