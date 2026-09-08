// Regras de dominio que nao podem quebrar em silencio (Roadmap v3.0).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

// Banco proprio por execucao: o teste nunca toca no banco de desenvolvimento.
const bancoTemp = path.join(os.tmpdir(), `mylog-teste-${Date.now()}.db`)
process.env.MYLOG_BANCO = bancoTemp

const { abrirBanco, executar, consultar, consultarUm, novoId, agora, transacao, fecharBanco } =
  await import('../src/nucleo/banco.js')
const { avaliarPreventiva, avaliarPreventivas, diasEntre } =
  await import('../src/nucleo/preventivas.js')
const { gerarHashSenha, conferirSenha, validarForcaSenha } =
  await import('../src/seguranca/senha.js')
const { nivelDe, ehFrota, perfilPublico } = await import('../src/seguranca/nivel.js')
const { normalizarPlaca, placaValida, STATUS_VEICULO, TIPOS_VEICULO } =
  await import('../src/rotas/veiculos.js')
const { gerarSenhaInicial, limparCpf, cpfValido } = await import('../src/rotas/usuarios.js')
const { bordaDoDia, diaLocal } = await import('../src/nucleo/relogio.js')

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

// Uma data a n dias de hoje, contando dias da OPERACAO.
//
// Era `new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)`: o dia em
// UTC. Enquanto `diasEntre` tambem lia o hoje em UTC, os dois erravam juntos e o
// teste logo abaixo — que se chama "nao escorrega por causa de fuso" — passava
// com a conta torta. Arrumado o servidor, foi este lado que ficou errado, e a
// varredura com MYLOG_FUSO no Pacifico apontou na hora.
//
// Ancora ao meio-dia UTC de proposito: somar n dias a partir dai nunca cai em
// cima da virada, entao a conta nao escorrega por hora de verao.
const emDias = (n) => new Date(new Date(`${diaLocal()}T12:00:00Z`).getTime() + n * 86400000)
  .toISOString().slice(0, 10)

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

test('preventiva por data: o dia e o da operacao, nao o do UTC', () => {
  // `emDias` acima monta a data em UTC, e `diasEntre` lia o "hoje" tambem em
  // UTC — os dois erravam juntos, entao o teste ao lado passava com a conta
  // torta. E' o mesmo furo que a D37 tirou do resto do servidor.
  //
  // No Brasil, das 21h a meia-noite o dia UTC ja e' o de amanha. A preventiva
  // que vence AMANHA passava a ser lida como vencendo hoje: virava "vencida"
  // tres horas antes, toda noite, e voltava sozinha para "muito proxima" a
  // meia-noite. Alerta de manutencao que pisca nao e' alerta.
  //
  // O instante e' montado a partir da borda do dia da operacao, e nao com um
  // deslocamento fixo: assim o teste vale em qualquer MYLOG_FUSO.
  const DIA = '2026-09-02'
  const AMANHA = '2026-09-03'
  const quaseMeiaNoite = new Date(new Date(bordaDoDia(DIA)).getTime() + 23.5 * 3600 * 1000)

  assert.equal(diaLocal(quaseMeiaNoite), DIA,
    'controle: o instante escolhido ainda e hoje na operacao')

  assert.equal(diasEntre(AMANHA, quaseMeiaNoite), 1, 'amanha ainda falta um dia')
  assert.equal(diasEntre(DIA, quaseMeiaNoite), 0)
  assert.equal(
    avaliarPreventiva({ modo: 'data', alerta_antes_dias: 7, proxima_data: AMANHA }, 0, quaseMeiaNoite).status,
    'muito_proxima',
    'as 23h30 a preventiva de amanha nao pode estar vencida')
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

// ------------------------------------------- o dia e' da operacao, nao da maquina

// O criterio: rodar a MESMA pergunta em processos com fusos diferentes e obter
// a MESMA resposta. Nada disso pode ser verificado dentro de um unico processo
// — o fuso e' escolhido antes do Node subir —, entao o teste abre filhos.
//
// Antes deste modulo, "hoje", o horario limite, a obrigacao diaria, o filtro de
// periodo e a cobranca de quem nao fez liam o fuso do sistema operacional.
// Funciona por acidente enquanto o servidor roda na mesma cidade da frota, e
// desloca tudo em tres horas no dia em que ele subir para uma nuvem em UTC.
const URL_RELOGIO = pathToFileURL(
  path.join(import.meta.dirname, '..', 'src', 'nucleo', 'relogio.js')).href

const SONDA = `
  const r = await import(${JSON.stringify(URL_RELOGIO)})
  const instante = new Date('2026-09-04T02:30:00.000Z')
  console.log(JSON.stringify({
    borda:   r.bordaDoDia('2026-09-03'),
    fim:     r.bordaDoDia('2026-09-03', true),
    dia:     r.diaLocal(instante),
    minutos: r.minutosLocais(instante),
    semana:  r.diaSemanaDe('2026-09-03'),
    texto:   r.dataHoraLocal(instante.toISOString()),
    // Referencia: o jeito antigo, que dependia do fuso do processo.
    ingenuo: new Date(2026, 8, 3).toISOString(),
  }))
`

function sondar(fuso) {
  const saida = execFileSync(process.execPath, ['--input-type=module', '-e', SONDA], {
    env: { ...process.env, TZ: fuso, MYLOG_FUSO: 'America/Sao_Paulo' },
    encoding: 'utf8',
  })
  return JSON.parse(saida)
}

test('relogio: o dia da operacao nao muda com o fuso do servidor', () => {
  const saoPaulo = sondar('America/Sao_Paulo')
  const utc = sondar('UTC')
  const toquio = sondar('Asia/Tokyo')

  // A prova de que o teste nao e' vazio: pelo caminho antigo, as tres maquinas
  // respondiam coisas diferentes. Se esta linha ficar verde com todos iguais,
  // o experimento nao esta medindo nada.
  assert.notEqual(saoPaulo.ingenuo, utc.ingenuo,
    'o jeito antigo TEM que divergir, senao este teste nao prova nada')
  assert.notEqual(utc.ingenuo, toquio.ingenuo)

  for (const chave of ['borda', 'fim', 'dia', 'minutos', 'semana', 'texto']) {
    assert.equal(utc[chave], saoPaulo[chave], `${chave} mudou num servidor em UTC`)
    assert.equal(toquio[chave], saoPaulo[chave], `${chave} mudou num servidor em Toquio`)
  }
})

test('relogio: as bordas do dia sao meia-noite e 23:59 no patio', () => {
  const r = sondar('UTC')
  // 03/09/2026 em Sao Paulo (UTC-3) comeca as 03:00Z e termina as 02:59:59Z do dia 04.
  assert.equal(r.borda, '2026-09-03T03:00:00.000Z')
  assert.equal(r.fim, '2026-09-04T02:59:59.999Z')
  // 02:30Z do dia 04 ainda e' 23:30 do dia 03 no patio — o fim de turno nao
  // pode cair no balde do dia seguinte.
  assert.equal(r.dia, '2026-09-03')
  assert.equal(r.minutos, 23 * 60 + 30)
  assert.equal(r.texto, '03/09/2026 23:30')
  assert.equal(r.semana, 4, '03/09/2026 e quinta')
})

test('relogio: fuso invalido derruba a partida, nao a primeira consulta', () => {
  // `assert.throws(..., /./)` aceitava QUALQUER erro: um erro de digitacao na
  // sonda, um modulo que sumiu, qualquer coisa que fizesse o filho morrer
  // deixava o teste verde. Ele precisa exigir o erro CERTO, e a mensagem certa
  // — nome de fuso errado e' erro de implantacao, e a frase e' o que diz a quem
  // subiu o servidor o que fazer.
  let saida = ''
  assert.throws(
    () => {
      execFileSync(process.execPath, ['--input-type=module', '-e', SONDA], {
        env: { ...process.env, MYLOG_FUSO: 'Marte/Olympus' },
        encoding: 'utf8', stdio: 'pipe',
      })
    },
    (falha) => {
      saida = `${falha.stderr || ''}${falha.stdout || ''}${falha.message || ''}`
      assert.match(saida, /MYLOG_FUSO invalido/,
        `o filho morreu por outro motivo:\n${saida.slice(0, 400)}`)
      assert.match(saida, /Marte\/Olympus/, 'a mensagem tem que citar o valor recusado')
      assert.match(saida, /America\/Sao_Paulo/, 'e dar um exemplo do que se espera')
      return true
    },
  )

  // E o controle: com um fuso VALIDO a mesma sonda sobe. Sem isto, o teste
  // passaria mesmo se a sonda estivesse quebrada por completo.
  const boa = execFileSync(process.execPath, ['--input-type=module', '-e', SONDA], {
    env: { ...process.env, MYLOG_FUSO: 'America/Sao_Paulo' }, encoding: 'utf8',
  })
  assert.match(boa, /"dia":/, 'a sonda tem que funcionar com fuso valido')
})

// ---------------------------------------------- transacao das decisoes criticas

// Aprovar uma reserva, liberar um veiculo bloqueado e encerrar uma ocorrencia
// tem a mesma forma: LE o estado, decide, e entao GRAVA — a mudanca e o registro
// dela na auditoria. Se as duas gravacoes nao forem um ato so, existe um estado
// em que o carro foi entregue e nao ha linha nenhuma dizendo por quem.

test('transacao: ou grava tudo, ou nao grava nada', () => {
  const idA = novoId('empresa')
  const idB = novoId('empresa')
  assert.throws(() => transacao(() => {
    executar('INSERT INTO empresas (id, nome, criado_em, atualizado_em) VALUES (?, ?, ?, ?)',
      [idA, 'Meia', agora(), agora()])
    executar('INSERT INTO empresas (id, nome, criado_em, atualizado_em) VALUES (?, ?, ?, ?)',
      [idB, 'Gravada', agora(), agora()])
    throw new Error('falha depois de gravar')
  }))
  assert.ok(!consultarUm('SELECT id FROM empresas WHERE id = ?', [idA]),
    'a primeira gravacao tinha que ter voltado atras')
  assert.ok(!consultarUm('SELECT id FROM empresas WHERE id = ?', [idB]))
})

test('transacao: com outro escritor na frente, falha ANTES de decidir qualquer coisa', () => {
  // E' o que separa BEGIN de BEGIN IMMEDIATE. Com o BEGIN adiado, a trava so e'
  // tomada na primeira gravacao: dois processos leem o mesmo estado, os dois
  // concluem que podem aprovar, e o segundo so descobre o problema no fim —
  // ja tendo decidido sobre dados velhos. Com IMMEDIATE ele nem comeca.
  //
  // Hoje isso nao acontece: o Node e' de uma linha so. Comeca a acontecer no
  // dia em que houver mais de um processo — cluster, ou Cloud Functions.
  const rival = new DatabaseSync(bancoTemp)
  rival.exec('PRAGMA journal_mode = WAL')
  rival.exec('BEGIN IMMEDIATE')
  rival.prepare('INSERT INTO empresas (id, nome, criado_em, atualizado_em) VALUES (?, ?, ?, ?)')
    .run(novoId('empresa'), 'Rival', agora(), agora())

  let decidiu = false
  try {
    assert.throws(() => transacao(() => {
      decidiu = true
      executar('INSERT INTO empresas (id, nome, criado_em, atualizado_em) VALUES (?, ?, ?, ?)',
        [novoId('empresa'), 'Tardia', agora(), agora()])
    }), /./)
    assert.equal(decidiu, false,
      'com BEGIN adiado o corpo rodaria e so falharia no commit, ja tendo decidido')
  } finally {
    rival.exec('ROLLBACK')
    rival.close()
  }
})

// ------------------------------- a casca do service worker cobre o app inteiro

// `cache.addAll` e' atomico: UM arquivo faltando derruba a instalacao inteira,
// e o app deixa de abrir sem sinal. O erro nao aparece em desenvolvimento, onde
// sempre ha rede — aparece no patio, no dia em que nao ha.
//
// Acrescentar um `import` no aplicativo e esquecer a casca e' o jeito mais
// facil de causar isso, e nenhum teste veria. Este ve.
test('offline: todo arquivo que o app carrega esta na casca do service worker', () => {
  const raiz = path.join(import.meta.dirname, '..', '..')
  const ler = (p) => fs.readFileSync(path.join(raiz, p), 'utf8')

  const sw = ler('app/sw.js')
  const listaCasca = sw.split('const CASCA = [')[1].split(']')[0]
  const casca = new Set([...listaCasca.matchAll(/'(\/[^']+)'/g)].map((m) => m[1]))
  assert.ok(casca.size >= 8, `a varredura precisa achar a casca; achou ${casca.size}`)

  // O que o HTML puxa direto.
  const html = ler('app/index.html')
  const precisa = new Set([...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]))

  // E a cadeia de imports a partir do modulo de entrada.
  const vistos = new Set()
  const pilha = ['app/js/app.js']
  while (pilha.length) {
    const arquivo = pilha.pop()
    if (vistos.has(arquivo)) continue
    vistos.add(arquivo)
    for (const m of ler(arquivo).matchAll(/from '([^']+)'/g)) {
      const alvo = path.posix.normalize(
        path.posix.join(path.posix.dirname(arquivo), m[1]))
      if (fs.existsSync(path.join(raiz, alvo))) pilha.push(alvo)
    }
  }
  for (const v of vistos) precisa.add(`/${v}`)

  assert.ok(precisa.has('/compartilhado/template.js'),
    'a varredura precisa alcancar o motor compartilhado pela cadeia de imports')

  const faltando = [...precisa].filter((p) => !casca.has(p)).sort()
  assert.deepEqual(faltando, [],
    `fora da casca do service worker: ${faltando.join(', ')}`)
})

test('implantacao: recusar subir sem segredo diz COMO resolver', () => {
  // Recusar sem dizer o que fazer deixa quem esta implantando procurando na
  // documentacao com o servidor fora do ar.
  const saida = execFileSync(process.execPath, ['--input-type=module', '-e', `
    process.env.MYLOG_AMBIENTE = 'producao'
    const c = await import(${JSON.stringify(pathToFileURL(
      path.join(import.meta.dirname, '..', 'src', 'nucleo', 'config.js')).href)})
    try { c.avisarSegredoFraco(); console.log('NAO RECUSOU') }
    catch (e) { console.log(e.message) }
  `], { encoding: 'utf8', env: { ...process.env, MYLOG_SEGREDO: '' } })

  assert.match(saida, /MYLOG_SEGREDO precisa ser definido/)
  assert.match(saida, /Sugestao: MYLOG_SEGREDO=\S{20,}/,
    'a mensagem tem que trazer um valor pronto para colar')
})

// ================================== o contrato da API contra o servidor real

// docs/API.md e' o unico artefato desta fase que o aplicativo Android vai
// consumir literalmente: ele e' escrito do zero, e nada do PWA vira codigo la
// dentro (ARQUITETURA 4.1). Documento errado ali nao e' documentacao
// desatualizada — e' cliente construido contra uma coisa que nao existe.
//
// Ja aconteceu: o exemplo do envio de checklist mostrava `iniciada_em` e nao
// `finalizada_em`. Quem seguisse o documento nao mandaria a hora do termino, e
// todo checklist offline voltaria a ser gravado com a hora da sincronizacao.

const API_MD = fs.readFileSync(
  path.join(import.meta.dirname, '..', '..', 'docs', 'API.md'), 'utf8')

const FONTE_ROTAS = ['servidor/src/rotas']
  .flatMap((dir) => fs.readdirSync(path.join(import.meta.dirname, '..', '..', dir))
    .filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(
      path.join(import.meta.dirname, '..', '..', dir, f), 'utf8')))
  .join(' ')

test('contrato: toda rota citada na API.md existe no servidor', () => {
  const citadas = new Set(
    [...API_MD.matchAll(/\b(GET|POST|PATCH|DELETE)\s+(\/[A-Za-z0-9_\-/:.]+)/g)]
      .map(([, metodo, caminho]) => `${metodo} ${caminho.replace(/[.,;]$/, '')}`))
  assert.ok(citadas.size >= 8, `a varredura precisa achar rotas; achou ${citadas.size}`)

  const registradas = new Set(
    [...FONTE_ROTAS.matchAll(/rotas\.(get|post|patch|delete)\(\s*'([^']+)'/g)]
      .map(([, m, c]) => `${m.toUpperCase()} ${c}`))

  const inexistentes = [...citadas].filter((r) => !registradas.has(r)).sort()
  assert.deepEqual(inexistentes, [],
    `documentadas e inexistentes: ${inexistentes.join(' | ')}`)
})

test('contrato: os dois corpos que o aplicativo envia sao lidos por inteiro', () => {
  // Campo documentado que o servidor ignora e' dado perdido em silencio: o
  // aplicativo manda, acha que mandou, e nada acontece. Foi o que houve com
  // `finalizada_em`, que sumiu do exemplo e levou junto a hora do checklist
  // feito offline.
  //
  // Sao estes dois os corpos que importam: o envio do checklist e o da foto.
  // Recortados por secao, e ate onde comeca a RESPOSTA — bloco de resposta tem
  // chaves que sao do servidor, nao do corpo, e cobra-las aqui seria ruido.
  const recortar = (de, ate) => {
    const inicio = API_MD.indexOf(de)
    assert.ok(inicio > 0, `secao nao encontrada: ${de}`)
    const fim = API_MD.indexOf(ate, inicio)
    assert.ok(fim > inicio, `fim de secao nao encontrado: ${ate}`)
    return API_MD.slice(inicio, fim)
  }

  const trechos = [
    ['envio do checklist', recortar('## 5. Enviar um checklist', '### Resposta')],
    ['envio da foto', recortar('## 6. Fotos', 'Antes de reenviar')],
  ]

  const lidos = new Set([...FONTE_ROTAS.matchAll(/corpo\.(\w+)/g)].map((m) => m[1]))

  for (const [nome, trecho] of trechos) {
    const chaves = new Set()
    for (const linha of trecho.split('\n')) {
      // So o primeiro nivel: `respostas` e' um mapa cujas chaves sao ids de
      // pergunta, inventados pelo modelo de cada empresa.
      const m = linha.replace(/\r$/, '').match(/^ {2}"([a-z_]+)"\s*:/)
      if (m) chaves.add(m[1])
    }
    assert.ok(chaves.size >= 4, `${nome}: a varredura achou so ${chaves.size} campos`)

    const ignorados = [...chaves].filter((c) => !lidos.has(c)).sort()
    assert.deepEqual(ignorados, [],
      `${nome}: documentados e ignorados pelo servidor: ${ignorados.join(', ')}`)
  }

  // E o que nao pode faltar, porque a falta e' silenciosa e cara.
  const checklist = trechos[0][1]
  for (const obrigatorio of ['cliente_uuid', 'iniciada_em', 'finalizada_em']) {
    assert.ok(checklist.includes(`"${obrigatorio}"`),
      `o corpo documentado precisa trazer ${obrigatorio}`)
  }
})

test('contrato: todo codigo de erro da tabela existe no servidor', () => {
  const tabela = API_MD.slice(API_MD.indexOf('## 10. Erros'))
  const codigos = new Set(
    [...tabela.matchAll(/\|\s*\d{3}\s*\|\s*`([a-z_]+)`/g)].map((m) => m[1]))
  assert.ok(codigos.size >= 5, `esperava a tabela de erros; achei ${codigos.size}`)

  // `seguranca/` tambem emite codigo proprio: a troca de senha obrigatoria
  // nasce na sessao, nao numa rota.
  const raiz = path.join(import.meta.dirname, '..', 'src')
  const extras = ['nucleo/http.js', 'seguranca/sessao.js', 'seguranca/nivel.js']
    .map((f) => fs.readFileSync(path.join(raiz, f), 'utf8')).join(' ')
  const universo = extras + FONTE_ROTAS

  const inventados = [...codigos].filter((c) => !universo.includes(`'${c}'`)).sort()
  assert.deepEqual(inventados, [],
    `codigos documentados que o servidor nunca emite: ${inventados.join(', ')}`)
})

// ------------------- a regra do nivel de acesso, escrita em tres lugares

// O nivel e' escolhido no cadastro: total, ou somente aplicativo. Isso esta em
// `nivel.js`, na tabela do modelo de acesso do roadmap, e na tabela de camadas.
// O shell do painel, porem, marcava tres telas como `quem: 'todos'` e mandava
// quem nao tem painel para Solicitacoes — a regra valia pela metade, e nada
// acusava.
test('acesso: nenhuma tela do painel e oferecida a quem nao tem painel', () => {
  const raiz = path.join(import.meta.dirname, '..', '..')
  const ler = (p) => fs.readFileSync(path.join(raiz, p), 'utf8')

  // A regra, lida do documento — nao repetida aqui de cabeca.
  const roadmap = ler('docs/ROADMAP.md')
  assert.match(roadmap, /\*\*Colaborador\*\*\s*\|\s*Somente aplicativo/,
    'o roadmap precisa continuar dizendo que Colaborador e somente aplicativo')

  const app = ler('web/js/app.js')
  const telas = [...app.matchAll(/\{\s*chave:\s*'([^']+)'[^}]*?quem:\s*'([^']+)'/g)]
    .map(([, chave, quem]) => ({ chave, quem }))
  assert.ok(telas.length >= 8, `a varredura precisa achar as telas; achou ${telas.length}`)

  const abertas = telas.filter((t) => t.quem !== 'frota').map((t) => t.chave)
  assert.deepEqual(abertas, [],
    `telas oferecidas fora da Frota, contra a regra do cadastro: ${abertas.join(', ')}`)

  // E a porta: o shell tem que recusar quem nao tem painel, em vez de montar.
  assert.match(app, /if \(!usuario\.acessa_painel\)/,
    'o shell precisa recusar quem foi cadastrado como somente aplicativo')
})

// -------------- os espelhos de transicao da tela contra os do servidor

// A tela precisa saber quais transicoes existem para nao oferecer caminho que
// o servidor recusa — oferecer e' pior que esconder: a pessoa clica, leva 409,
// e fica sem saber se errou ou se o sistema quebrou.
//
// Mas espelho que ninguem confere vira mentira na primeira mudanca. Este teste
// le os dois objetos, dos dois arquivos, e exige que sejam iguais.
test('transicoes: o que a tela oferece e exatamente o que o servidor aceita', () => {
  const raiz = path.join(import.meta.dirname, '..', '..')
  const ler = (p) => fs.readFileSync(path.join(raiz, p), 'utf8')

  const extrair = (texto, arquivo) => {
    const m = texto.match(/const TRANSICOES = \{([\s\S]*?)\n\}/)
    assert.ok(m, `${arquivo}: nao achei o objeto TRANSICOES`)
    const mapa = {}
    for (const linha of m[1].split('\n')) {
      const l = linha.match(/^\s*(\w+):\s*\[([^\]]*)\]/)
      if (l) mapa[l[1]] = [...l[2].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort()
    }
    return mapa
  }

  const pares = [
    ['usuario', 'servidor/src/rotas/usuarios.js', 'web/js/usuarios.js'],
    ['ocorrencia', 'servidor/src/rotas/ocorrencias.js', 'web/js/ocorrencias.js'],
  ]

  for (const [nome, noServidor, naTela] of pares) {
    const doServidor = extrair(ler(noServidor), noServidor)
    const daTela = extrair(ler(naTela), naTela)
    assert.ok(Object.keys(doServidor).length >= 4, `${nome}: varredura do servidor vazia`)
    assert.deepEqual(daTela, doServidor,
      `${nome}: a tela e o servidor discordam sobre quais transicoes existem`)
  }
})

// Todo campo que a EDICAO de checklist aceita, a tela do painel sabe mandar.
//
// `PUT /api/templates/:id` sempre aceitou nome, tipo de veiculo, cargos
// liberados, assinatura e o ritmo inteiro (periodicidade, dias da semana, dia
// da semana, horario limite). A tela mandava `{ estrutura }` e mais nada: o
// formulario com todos esses campos existia SO na criacao.
//
// Na pratica, criado um checklist, a Frota nao conseguia mais trocar o cargo
// que enxerga o modelo, nem o horario limite que decide quem esta atrasado, nem
// corrigir um nome digitado errado. Rotina de frota, com a rota pronta do outro
// lado e nenhuma porta na tela. Uma capacidade inteira do servidor, orfa.
//
// A varredura le so os dois trechos que tratam dos DADOS do modelo — o corpo do
// PUT e o `lerRitmo` que ele chama. A rota da imagem de exemplo tem contrato
// proprio e nao entra.
test('checklist: todo campo que a edicao aceita, a tela do painel sabe mandar', () => {
  const raiz = path.join(import.meta.dirname, '..', '..')
  const rota = fs.readFileSync(path.join(raiz, 'servidor/src/rotas/templates.js'), 'utf8')
  const tela = fs.readFileSync(path.join(raiz, 'web/js/templates.js'), 'utf8')

  // O fim do bloco e' a primeira linha que fecha na MESMA indentacao em que ele
  // abriu. Recortar por "o proximo `})`" engolia da funcao ate a rota seguinte,
  // e a varredura passava a ler campos que a edicao nao aceita — teste verde
  // por rede larga demais, que e' o mesmo que teste nenhum.
  const trecho = (inicio, fecha) => {
    const i = rota.indexOf(inicio)
    assert.ok(i > 0, `nao achei "${inicio}" em templates.js`)
    const fim = rota.indexOf(`\n${fecha}`, i)
    assert.ok(fim > i, `nao achei o fim de "${inicio}"`)
    return rota.slice(i, fim)
  }

  // Sem os comentarios. Um comentario explicando a rota costuma CITAR os campos
  // dela, e foi o que aconteceu: escrevi `corpo.X === undefined ? antes.X : ...`
  // dentro de uma explicacao, e a varredura passou a exigir da tela um campo
  // chamado "X". Comentario e' prosa, nao contrato.
  const semComentarios = (texto) => texto
    .replace(new RegExp('/\\*[\\s\\S]*?\\*/', 'g'), '')
    .split('\n')
    .filter((linha) => !linha.trim().startsWith('//'))
    .join('\n')

  const corpoDaEdicao = semComentarios(trecho("rotas.put('/api/templates/:id'", '  })'))
    + semComentarios(trecho('function lerRitmo', '  }'))

  // A rede tem que ser do tamanho certo: nem menos que o ritmo inteiro, nem a
  // ponto de alcancar o que so a criacao aceita.
  assert.ok(!/corpo\.finalidade/.test(corpoDaEdicao),
    'o recorte passou do fim: `finalidade` so existe na criacao')
  assert.ok(!/corpo\.codigo/.test(corpoDaEdicao),
    'o recorte passou do fim: `codigo` so existe na criacao')

  const aceitos = new Set([...corpoDaEdicao.matchAll(/corpo\.(\w+)/g)].map((m) => m[1]))
  assert.ok(aceitos.size >= 8,
    `varredura da rota veio pobre demais: ${[...aceitos].join(', ')}`)

  const mudos = [...aceitos].filter((campo) => !new RegExp(`\\b${campo}\\s*:`).test(tela))
  assert.deepEqual(mudos, [],
    `a edicao de checklist aceita campo que a tela nao sabe mandar: ${mudos.join(', ')}`)

  // E o formulario tem que servir os dois usos. Se ele voltar a existir so para
  // criar, a lista acima continua passando — os campos estariam la, no
  // formulario de criacao — e a Frota estaria de novo sem editar nada.
  assert.match(tela, /formularioModelo\(contexto, \{ modelo/,
    'o formulario de dados do modelo precisa abrir em modo de edicao')
  assert.match(tela, /api\.salvarTemplate\(modelo\.id, dados\)/,
    'a edicao precisa mandar os dados, e nao so a estrutura')

  // A versao publicada e' imutavel por contrato — uma inspecao aponta para a
  // linha dela. Entao a tela nao pode oferecer edicao direta: tem que oferecer
  // a versao seguinte, e dizer isso no proprio rotulo.
  assert.match(tela, /Editar — abre a versao/,
    'a tela precisa dizer que editar publicado abre a versao seguinte')
})

// Toda rota que ESCREVE deixa rastro.
//
// A auditoria e' o unico artefato do sistema cuja falta e' invisivel ate o dia
// em que alguem precisa provar o que aconteceu — e nesse dia nao ha conserto.
// Uma rota de escrita nova que nasca sem `registrarEvento` nao seria notada por
// nenhum outro teste: tudo funcionaria.
//
// As excecoes sao nomeadas uma a uma, com o motivo. Excecao sem motivo escrito
// vira porta aberta.
test('auditoria: nenhuma rota de escrita grava sem deixar rastro', () => {
  const raiz = path.join(import.meta.dirname, '..', 'src', 'rotas')

  const SEM_RASTRO = new Map([
    ['POST /api/notificacoes/lidas',
      'estado de leitura do sino: e por usuario, nao muda dado de ninguem'],
    ['POST /api/templates/conferir',
      'so valida a estrutura e devolve o parecer; nao escreve nada'],
    ['PUT /api/templates/:id',
      'edita RASCUNHO, que ainda nao vale para ninguem — e um checklist e salvo '
      + 'dezenas de vezes enquanto e montado. O rastro que importa esta na '
      + 'PUBLICACAO, que guarda o antes e o depois de tudo que muda a operacao: '
      + 'cargos liberados, horario limite, ritmo, assinatura'],
    ['POST /api/inspecoes/:id/evidencias',
      'o caso normal sao 4 a 8 fotos por checklist, e o mural afogaria a tela; '
      + 'a rota registra o caso que importa, a foto anexada por quem nao executou'],
  ])

  const semRegistro = []
  let comRegistro = 0

  for (const arquivo of fs.readdirSync(raiz).filter((f) => f.endsWith('.js'))) {
    const linhas = fs.readFileSync(path.join(raiz, arquivo), 'utf8').split('\n')
    const inicios = []
    linhas.forEach((linha, i) => {
      const m = linha.match(/rotas\.(get|post|put|patch|delete)\(\s*'([^']+)'/)
      if (m) inicios.push({ i, metodo: m[1].toUpperCase(), caminho: m[2] })
    })
    inicios.forEach((r, k) => {
      if (r.metodo === 'GET') return
      const fim = k + 1 < inicios.length ? inicios[k + 1].i : linhas.length
      const corpo = linhas.slice(r.i, fim).join('\n')
      const chave = `${r.metodo} ${r.caminho}`
      if (corpo.includes('registrarEvento')) { comRegistro += 1; return }
      if (SEM_RASTRO.has(chave)) return
      semRegistro.push(`${chave} (${arquivo}:${r.i + 1})`)
    })
  }

  assert.ok(comRegistro >= 30, `varredura pobre demais: ${comRegistro} rotas com registro`)
  assert.deepEqual(semRegistro, [],
    `rota de escrita sem rastro na auditoria — registre, ou nomeie a excecao com o motivo:\n${semRegistro.join('\n')}`)

  // E a lista de excecoes nao pode citar rota que nao existe mais: excecao
  // orfa e' permissao guardada para uma porta que ninguem lembra onde fica.
  const todas = new Set()
  for (const arquivo of fs.readdirSync(raiz).filter((f) => f.endsWith('.js'))) {
    const texto = fs.readFileSync(path.join(raiz, arquivo), 'utf8')
    for (const m of texto.matchAll(/rotas\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
      todas.add(`${m[1].toUpperCase()} ${m[2]}`)
    }
  }
  const orfas = [...SEM_RASTRO.keys()].filter((c) => !todas.has(c))
  assert.deepEqual(orfas, [], `excecao de auditoria para rota que nao existe:\n${orfas.join('\n')}`)
})

// Duas coisas que toda notificacao precisa acertar, e que so quebram em
// producao: nao avisar quem fez, e levar a algum lugar.
//
// Receber aviso do que voce mesmo acabou de fazer e' ruido, e ruido ensina a
// ignorar o sino — depois disso o aviso que importa tambem passa batido. E
// notificacao cujo `destino` nao e' uma tela existente vira um clique que nao
// abre nada, no exato momento em que a pessoa foi atras do problema.
test('notificacao: ninguem e avisado da propria acao, e todo aviso leva a uma tela', () => {
  const raiz = path.join(import.meta.dirname, '..', '..')
  const pasta = path.join(raiz, 'servidor', 'src', 'rotas')

  // As telas que o painel conhece, lidas do proprio roteador.
  const app = fs.readFileSync(path.join(raiz, 'web', 'js', 'app.js'), 'utf8')
  const telas = new Set([...app.matchAll(/chave:\s*'([a-z]+)'/g)].map((m) => m[1]))
  assert.ok(telas.size >= 8, `poucas telas lidas do app.js: ${[...telas]}`)

  const semExceto = []
  const destinoInvalido = []
  let chamadas = 0

  for (const arquivo of fs.readdirSync(pasta).filter((f) => f.endsWith('.js'))) {
    const texto = fs.readFileSync(path.join(pasta, arquivo), 'utf8')
    const linhas = texto.split('\n')
    linhas.forEach((linha, i) => {
      if (!/\bnotificar(Frota)?\(\{/.test(linha)) return
      chamadas += 1
      // O corpo da chamada vai ate a linha que fecha `})`.
      let bloco = ''
      for (let j = i; j < Math.min(i + 12, linhas.length); j += 1) {
        bloco += `${linhas[j]}\n`
        if (/^\s*\}\)/.test(linhas[j])) break
      }
      const onde = `${arquivo}:${i + 1}`
      if (!/\bexceto:/.test(bloco)) semExceto.push(onde)
      const destino = bloco.match(/destino:\s*'([a-z]+)'/)
      if (!destino) destinoInvalido.push(`${onde} — sem destino`)
      else if (!telas.has(destino[1])) {
        destinoInvalido.push(`${onde} — destino '${destino[1]}' nao e uma tela do painel`)
      }
    })
  }

  assert.ok(chamadas >= 6, `poucas chamadas de notificacao achadas: ${chamadas}`)
  assert.deepEqual(semExceto, [],
    `notificacao que avisa quem fez a acao:\n${semExceto.join('\n')}`)
  assert.deepEqual(destinoInvalido, [],
    `notificacao que nao leva a lugar nenhum:\n${destinoInvalido.join('\n')}`)
})

// Rota que escreve DUAS vezes escreve dentro de uma transacao.
//
// Meia escrita e' o pior estado do banco: pior que nao escrever, porque ninguem
// fica sabendo. A resposta volta com erro, a tela mostra a recusa, e metade do
// pedido esta gravada — quem le a tela nao tem como saber.
//
// A varredura conta `executar(` e as chamadas a funcoes que escrevem por baixo.
// Excecoes sao nomeadas com o motivo; excecao sem motivo escrito vira porta
// aberta.
test('atomicidade: rota com duas escritas usa transacao', () => {
  const raiz = path.join(import.meta.dirname, '..', 'src', 'rotas')

  const QUE_ESCREVEM = /\b(registrarKm|encerrarCiclo|reavaliarPendencia|reaplicarPendencia)\(/g

  const SOLTAS = new Map([
    ['POST /api/notificacoes/lidas',
      'marca aviso como lido, por usuario. Meia marcacao deixa um aviso nao lido '
      + 'a mais no sino — e nada alem disso'],
  ])

  const semTransacao = []
  let comTransacao = 0

  for (const arquivo of fs.readdirSync(raiz).filter((f) => f.endsWith('.js'))) {
    const linhas = fs.readFileSync(path.join(raiz, arquivo), 'utf8').split('\n')
    const inicios = []
    linhas.forEach((linha, i) => {
      const m = linha.match(/rotas\.(get|post|put|patch|delete)\(\s*'([^']+)'/)
      if (m) inicios.push({ i, metodo: m[1].toUpperCase(), caminho: m[2] })
    })
    inicios.forEach((r, k) => {
      if (r.metodo === 'GET') return
      const fim = k + 1 < inicios.length ? inicios[k + 1].i : linhas.length
      const corpo = linhas.slice(r.i, fim).join('\n')
      const escritas = (corpo.match(/\bexecutar\(/g) || []).length
        + (corpo.match(QUE_ESCREVEM) || []).length
      if (escritas < 2) return
      if (corpo.includes('transacao(')) { comTransacao += 1; return }
      const chave = `${r.metodo} ${r.caminho}`
      if (SOLTAS.has(chave)) return
      semTransacao.push(`${chave} — ${escritas} escritas (${arquivo}:${r.i + 1})`)
    })
  }

  // Piso de sanidade, nao contagem exata: se a varredura parar de achar rotas
  // (regex quebrada, arquivo movido), ela precisa acusar em vez de passar verde
  // por nao ter olhado nada. Hoje sao 7.
  assert.ok(comTransacao >= 6, `varredura pobre demais: ${comTransacao} rotas com transacao`)
  assert.deepEqual(semTransacao, [],
    `rota com duas escritas e sem transacao — envolva, ou nomeie a excecao com o motivo:\n${semTransacao.join('\n')}`)
})

// O que o aplicativo MANDA e o que a rota LE sao a mesma lista.
//
// Um campo com nome errado no envio nao quebra nada: o `JSON.stringify` aceita
// qualquer chave, a rota le `undefined` e segue. `km_informado` virando
// `kmInformado` faria o hodometro parar de chegar — sem erro, sem 500, sem
// nenhum sinal, ate alguem reparar meses depois que as leituras sumiram.
//
// E' o mesmo raciocinio do teste que confere o exemplo da API.md contra a
// resposta, do outro lado da conversa: ali a RESPOSTA, aqui o PEDIDO.
test('contrato: o aplicativo manda exatamente os campos que a rota de checklist le', () => {
  const raiz = path.join(import.meta.dirname, '..', '..')
  const app = fs.readFileSync(path.join(raiz, 'app', 'js', 'sincronia.js'), 'utf8')
  const rota = fs.readFileSync(path.join(raiz, 'servidor', 'src', 'rotas', 'inspecoes.js'), 'utf8')

  // O corpo do POST no aplicativo.
  const iApp = app.indexOf("await fetch('/api/inspecoes'")
  assert.ok(iApp > 0, 'nao achei o envio de checklist no aplicativo')
  const abre = app.indexOf('body: JSON.stringify({', iApp)
  const fecha = app.indexOf('}),', abre)
  assert.ok(abre > 0 && fecha > abre, 'nao achei o corpo do envio')
  const manda = new Set(
    app.slice(abre, fecha).split('\n')
      .map((l) => l.match(/^\s{6}([a-z_]+):/)?.[1])
      .filter(Boolean),
  )

  // O que a rota le do corpo.
  const iRota = rota.indexOf("rotas.post('/api/inspecoes'")
  const fimRota = rota.indexOf("rotas.get('/api/inspecoes'", iRota)
  assert.ok(iRota > 0 && fimRota > iRota, 'nao achei a rota de envio')
  const le = new Set(
    [...rota.slice(iRota, fimRota).matchAll(/ctx\.corpo\.([a-z_]+)/g)].map((m) => m[1]),
  )

  assert.ok(manda.size >= 10, `varredura pobre do lado do app: ${[...manda].join(', ')}`)
  assert.ok(le.size >= 10, `varredura pobre do lado da rota: ${[...le].join(', ')}`)

  const ignorados = [...manda].filter((c) => !le.has(c))
  assert.deepEqual(ignorados, [],
    `o aplicativo manda campo que a rota nao le — chega e some:\n${ignorados.join('\n')}`)

  const naoEnviados = [...le].filter((c) => !manda.has(c))
  assert.deepEqual(naoEnviados, [],
    `a rota le campo que o aplicativo nunca manda:\n${naoEnviados.join('\n')}`)
})

// Apagar foto passa por UM lugar so.
//
// Apagar do IndexedDB e' metade do trabalho: o endereco de blob criado para
// mostrar a foto na tela continua vivo enquanto ninguem o revoga, e com ele os
// bytes da imagem ficam presos na memoria ate a pagina fechar.
//
// O helper que faz as duas coisas existia — e se chamava `fotos_remover`, num
// arquivo inteiro em camelCase. Dos tres lugares que apagam foto, so um o
// usava; os outros dois chamavam `fotos.remover` direto e vazavam. E eram
// justamente os dois que a pessoa repete: "tirar novamente" e o corte de fotos
// acima do limite.
//
// Este teste nao mede memoria — mede o que da para medir de forma estavel: que
// ninguem chama o deposito cru pelas costas do helper.
test('aplicativo: apagar foto passa sempre pelo mesmo lugar', () => {
  const raiz = path.join(import.meta.dirname, '..', '..')
  const checklist = fs.readFileSync(path.join(raiz, 'app', 'js', 'checklist.js'), 'utf8')

  // Fora dos comentarios: um comentario pode citar o nome cru para explicar.
  const codigo = checklist
    .split('\n')
    .filter((linha) => !linha.trim().startsWith('//'))
    .join('\n')

  const cruas = [...codigo.matchAll(/\bfotos\.remover\(/g)]
  assert.equal(cruas.length, 1,
    `so o proprio helper pode chamar o deposito cru; achei ${cruas.length} chamadas`)

  // E a chamada que sobra tem que estar DENTRO do helper.
  const iHelper = codigo.indexOf('async function descartarFoto(')
  assert.ok(iHelper > 0, 'o helper de descarte sumiu ou mudou de nome')
  const fimHelper = codigo.indexOf('\n  }', iHelper)
  const corpoHelper = codigo.slice(iHelper, fimHelper)
  assert.match(corpoHelper, /fotos\.remover\(/,
    'a unica chamada crua precisa ser a de dentro do helper')
  assert.match(corpoHelper, /revokeObjectURL/,
    'e o helper existe justamente para revogar o endereco junto')

  // Todo lugar que descarta usa o helper. Tres hoje: "tirar novamente" do
  // checklist padrao, o corte acima do limite, e "tirar novamente" da
  // preventiva.
  const pelosHelper = [...codigo.matchAll(/\bdescartarFoto\(/g)]
  assert.ok(pelosHelper.length >= 4,
    `poucos usos do helper (${pelosHelper.length}): a definicao mais os tres pontos de descarte`)
})

// Trocar a resposta de uma pergunta leva as fotos da anterior junto.
//
// A tela promete isso com todas as letras — "Ja respondida como OK. Responder
// de novo SUBSTITUI" — e a promessa nao valia para as fotos. A resposta nova
// nascia com `fotos_ids: []`, mas as antigas continuavam no armazem amarradas
// a inspecao, e o envio manda TODAS as fotos dela (`fotos.daInspecao`), nao so
// as citadas nas respostas.
//
// Duas coisas erradas de uma vez: o relatorio mostraria fotos de um julgamento
// que a pessoa desfez, e a contagem que o motor usa para "foto obrigatoria
// pendente" nao bateria com o acervo — o julgamento contando uma, o disco
// guardando tres.
//
// O QUE ESTE TESTE PROVA, e o que nao prova. Ele le o codigo: que os dois
// desfechos passam por `trocarResposta`, e que `trocarResposta` descarta as
// fotos anteriores. Nao exercita a captura — no arranjo de teste a camera nunca
// responde, entao nao ha foto de verdade para descartar. A cobertura de
// comportamento aqui depende de aparelho real, e esta anotada como tal.
test('aplicativo: trocar a resposta descarta as fotos da resposta anterior', () => {
  const raiz = path.join(import.meta.dirname, '..', '..')
  const codigo = fs.readFileSync(path.join(raiz, 'app', 'js', 'checklist.js'), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

  // Os dois desfechos escrevem a resposta pelo mesmo caminho.
  for (const desfecho of ['marcarOk', 'marcarOcorrencia']) {
    const i = codigo.indexOf(`function ${desfecho}(`)
    assert.ok(i > 0, `${desfecho} sumiu ou mudou de nome`)
    const corpo = codigo.slice(i, codigo.indexOf('\n  }', i))
    assert.match(corpo, /trocarResposta\(/,
      `${desfecho} precisa trocar a resposta pelo caminho unico`)
    assert.ok(!/respostas\[\s*pergunta\.id\s*\]\s*=/.test(corpo),
      `${desfecho} nao pode escrever em respostas[] direto — e assim que as fotos ficam para tras`)
  }

  // E o caminho unico descarta o que ficou.
  const iTroca = codigo.indexOf('function trocarResposta(')
  assert.ok(iTroca > 0, 'o caminho unico de troca de resposta sumiu')
  const troca = codigo.slice(iTroca, codigo.indexOf('\n  }', iTroca))
  assert.match(troca, /fotos_ids/, 'precisa olhar as fotos da resposta anterior')
  assert.match(troca, /descartarFoto\(/, 'e descarta-las')

  // Sincrona: tocar em OK muda a tela AGORA. A primeira versao era `async`, os
  // dois desfechos viraram `async` com ela, e quatro testes de navegacao
  // acusaram o atraso do redesenho.
  assert.ok(!/async function trocarResposta\(/.test(codigo),
    'trocar resposta nao pode adiar o redesenho da tela')
})

// ------------------------- a hierarquia documental existe e nao mente

// A regra e' "nao existe arquitetura paralela": cinco documentos, cada um com
// uma pergunta. O LEIA-ME e' a porta do repositorio — ele ja apontou uma
// "especificacao-mestra" que era uma copia .docx feita a mao, estagnada tres
// dias atras enquanto o Markdown mudava todo dia.
test('documentos: o LEIA-ME aponta os cinco, e nenhum deles falta', () => {
  const raiz = path.join(import.meta.dirname, '..', '..')
  const leiaMe = fs.readFileSync(path.join(raiz, 'LEIA-ME.md'), 'utf8')

  for (const doc of ['ARQUITETURA', 'ROADMAP', 'DECISOES', 'API', 'DESIGN']) {
    assert.ok(fs.existsSync(path.join(raiz, 'docs', `${doc}.md`)), `docs/${doc}.md nao existe`)
    assert.ok(leiaMe.includes(`docs/${doc}.md`), `o LEIA-ME nao aponta docs/${doc}.md`)
  }

  // Instantaneo com nome de fonte e' pior que instantaneo nenhum: quem abrir
  // nao tem como saber que esta lendo o passado.
  const soltos = fs.readdirSync(path.join(raiz, 'docs'))
    .filter((f) => f.endsWith('.docx'))
  assert.deepEqual(soltos, [],
    `copia .docx solta em docs/, competindo com o Markdown: ${soltos.join(', ')}`)
})

// Nenhum documento cita arquivo que nao existe.
//
// A D6 descrevia `src/seguranca/permissoes.js` e uma chamada `exigir(usuario,
// 'veiculos.escrever')`. Nunca existiram: a autorizacao virou dois niveis, em
// `seguranca/nivel.js`. A D13 e a D14 falavam de uma tabela `tickets` que o
// ROADMAP substituiu por Solicitacao de veiculo. Tres decisoes descrevendo um
// sistema que ninguem podia mais ler no codigo — e nada apontava isso.
//
// A EXCECAO e' deliberada: um bloco que comeca com "Nao vale mais" ou "Revista
// pela" existe justamente para nomear o que foi embora. Cobrar existencia ali
// seria proibir o registro de ter memoria.
test('documentos: nenhum documento cita arquivo que nao existe', () => {
  const raiz = path.join(import.meta.dirname, '..', '..')

  const nomes = new Set()
  const varrer = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.name === '.git' || item.name === 'node_modules' || item.name === 'dados') continue
      if (item.isDirectory()) varrer(path.join(dir, item.name))
      else nomes.add(item.name)
    }
  }
  varrer(raiz)

  const citados = []
  for (const doc of ['ARQUITETURA', 'ROADMAP', 'DECISOES', 'API', 'DESIGN']) {
    const texto = fs.readFileSync(path.join(raiz, 'docs', `${doc}.md`), 'utf8')
    // Uma decisao revogada descreve um mundo que nao existe mais: e' o que a
    // nota no topo dela avisa.
    const blocos = texto.split(/^## /m)
      .filter((b) => !/^[^\n]*\n+>[^]{0,400}?(Não vale mais|Revista pela)/.test(b))
    for (const bloco of blocos) {
      for (const m of bloco.matchAll(/`([A-Za-z0-9_./-]+\.(?:js|sql|css|html|md))`/g)) {
        citados.push([doc, m[1]])
      }
    }
  }
  assert.ok(citados.length > 30, `poucas citacoes lidas: ${citados.length}`)

  const ausentes = citados
    .filter(([, c]) => !nomes.has(c.split('/').pop()))
    .map(([doc, c]) => `${doc}.md cita ${c}`)
  assert.deepEqual([...new Set(ausentes)], [],
    `documento descrevendo arquivo que nao existe:\n${[...new Set(ausentes)].join('\n')}`)
})

// A secao 27 do ROADMAP listava onze relatorios sob a frase "todos os
// relatorios acima sao HTML pronto para imprimir". Quatro existiam. Os outros
// eram tela de painel, ou nada — e nada distinguia um do outro na tabela.
//
// Documento de escopo mente por acumulo: cada linha nasce como plano, e com o
// tempo o leitor deixa de saber quais ja viraram codigo. Agora a secao tem duas
// tabelas, "o que ja sai hoje" com a ROTA de cada uma, e "o que ainda nao
// existe". Este teste guarda a primeira.
test('documentos: toda rota que o ROADMAP 27 promete existe no servidor', () => {
  const raiz = path.join(import.meta.dirname, '..', '..')
  const roadmap = fs.readFileSync(path.join(raiz, 'docs', 'ROADMAP.md'), 'utf8')

  const inicio = roadmap.indexOf('### O que já sai hoje')
  const fim = roadmap.indexOf('### O que ainda não existe')
  assert.ok(inicio > 0 && fim > inicio, 'a secao 27 perdeu a divisao entre o que sai e o que nao sai')

  const prometidas = [...roadmap.slice(inicio, fim).matchAll(/`(\/[a-z0-9/.:_-]+)`/g)].map((m) => m[1])
  assert.ok(prometidas.length >= 5, `poucas rotas lidas da tabela: ${prometidas.join(', ')}`)

  const rotas = fs.readdirSync(path.join(raiz, 'servidor', 'src', 'rotas'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(raiz, 'servidor', 'src', 'rotas', f), 'utf8'))
    .join('\n')

  const faltando = prometidas.filter((r) => !rotas.includes(`'${r}'`))
  assert.deepEqual(faltando, [],
    `o ROADMAP 27 promete rota que o servidor nao registra: ${faltando.join(', ')}`)
})

// Toda referencia a codigo dentro do DESIGN.md existe de verdade. Documento de
// interface envelhece calado: a classe e renomeada, e o texto continua
// descrevendo um nome que ninguem mais usa.
test('documentos: o DESIGN.md nao cita classe, token nem funcao que nao existe', () => {
  const raiz = path.join(import.meta.dirname, '..', '..')
  const design = fs.readFileSync(path.join(raiz, 'docs', 'DESIGN.md'), 'utf8')
  const codigo = ['web/css/estilo.css', 'web/js/ui.js', 'web/index.html']
    .map((f) => fs.readFileSync(path.join(raiz, f), 'utf8')).join('\n')

  const ausentes = []
  for (const m of design.matchAll(/`([^`]+)`/g)) {
    const t = m[1]
    if (/^(--[a-z0-9-]+|\.[a-z][a-z0-9-]*)$/.test(t)) {
      if (!codigo.includes(t.replace(/^\./, ''))) ausentes.push(t)
    } else if (/^[a-zA-Z]+\(\)$/.test(t)) {
      if (!codigo.includes(`${t.slice(0, -2)}(`)) ausentes.push(t)
    }
  }
  assert.deepEqual(ausentes, [], `o DESIGN.md cita o que nao existe: ${ausentes.join(', ')}`)
})

// A regra 1 do DESIGN.md — "nenhum style inline no JS" — vinha com um placar:
// "Hoje: zero inline". Nao era verdade: o modal de historico do veiculo
// carregava `style: 'max-width:620px'`. Um numero escrito a mao dentro de um
// documento so fica certo ate a proxima tela, e nao havia nada que o
// conferisse.
//
// Isto nao e' zelo tipografico. Medida em `style` nao aparece no `estilo.css`,
// entao nao entra na conta de nenhum ajuste de layout, nao responde a tema e
// nao aparece para quem procura por que uma caixa ficou daquele tamanho —
// justamente o problema que a regra existe para evitar.
test('painel: nenhuma tela carrega estilo embutido, como o DESIGN.md afirma', () => {
  const raiz = path.join(import.meta.dirname, '..', '..')
  const pasta = path.join(raiz, 'web', 'js')
  const achados = []
  for (const arquivo of fs.readdirSync(pasta).filter((f) => f.endsWith('.js'))) {
    const texto = fs.readFileSync(path.join(pasta, arquivo), 'utf8')
    texto.split(/\r?\n/).forEach((linha, i) => {
      // As duas portas: a propriedade `style:` do `elemento()` e a escrita
      // direta em `.style.` de um no ja montado.
      if (/(^|[^a-zA-Z])style\s*:/.test(linha) || /\.style\.[a-zA-Z]/.test(linha)) {
        achados.push(`web/js/${arquivo}:${i + 1}  ${linha.trim().slice(0, 80)}`)
      }
    })
  }
  assert.deepEqual(achados, [],
    `o DESIGN.md diz "hoje: zero inline" e estas linhas dizem outra coisa:\n${achados.join('\n')}`)
})
