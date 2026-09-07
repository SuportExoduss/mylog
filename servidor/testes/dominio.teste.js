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
