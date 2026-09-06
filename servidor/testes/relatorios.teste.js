// Evidencias fotograficas e relatorios (Roadmap v3.0, secoes 13 e 27).
//
// Sao os dois lados do mesmo criterio de aceite: "cada foto abre no relatorio
// associada a pergunta, ao veiculo e a inspecao".
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const raizTemp = path.join(os.tmpdir(), `mylog-rel-${Date.now()}`)
process.env.MYLOG_BANCO = path.join(raizTemp, 'mylog.db')
process.env.MYLOG_STORAGE = path.join(raizTemp, 'evidencias')
process.env.MYLOG_PORTA = '0'

const { abrirBanco, executar, novoId, agora, fecharBanco } = await import('../src/nucleo/banco.js')
const { gerarHashSenha } = await import('../src/seguranca/senha.js')

abrirBanco()

// ---------------------------------------------------------------- cenario

const ts = agora()
const SENHA = 'mylog123'
const empresaA = novoId('empresa')
const empresaB = novoId('empresa')

const criarEmpresa = (id, nome) => executar(
  `INSERT INTO empresas (id, nome, status, politicas, criado_em, atualizado_em)
   VALUES (?, ?, 'ativa', '{}', ?, ?)`, [id, nome, ts, ts])

function criarCargo(empresaId, nome) {
  const id = novoId('cargo')
  executar('INSERT INTO cargos (id, empresa_id, nome, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)',
    [id, empresaId, nome, ts, ts])
  return id
}

function criarUsuario(empresaId, nome, cpf, email, cargoId, acessaPainel) {
  const id = novoId('usuario')
  const { hash, salt } = gerarHashSenha(SENHA)
  executar(
    `INSERT INTO usuarios (id, empresa_id, nome, cpf, email, telefone, cargo_id, acessa_painel,
                           status, senha_hash, senha_salt, deve_trocar_senha, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, '(31) 90000-0000', ?, ?, 'ativo', ?, ?, 0, ?, ?)`,
    [id, empresaId, nome, cpf, email, cargoId, acessaPainel ? 1 : 0, hash, salt, ts, ts])
  return id
}

function criarVeiculo(empresaId, placa) {
  const id = novoId('veiculo')
  executar(
    `INSERT INTO veiculos (id, empresa_id, placa, marca, modelo, tipo, km_atual, status, criado_em, atualizado_em)
     VALUES (?, ?, ?, 'Fiat', 'Strada', 'compacto_leve', 10000, 'disponivel', ?, ?)`,
    [id, empresaId, placa, ts, ts])
  return id
}

const ESTRUTURA = {
  perguntas: [
    { id: 'lataria', titulo: 'Lataria', foto_ok: 'opcional', max_fotos_ok: 2,
      opcoes_problema: [{ id: 'risco', nome: 'Risco na pintura', foto: 'opcional',
        max_fotos: 2, abrir_ocorrencia: true, prioridade: 'media' }] },
    { id: 'pneus', titulo: 'Pneus', foto_ok: 'opcional', max_fotos_ok: 2,
      opcoes_problema: [{ id: 'liso', nome: 'Pneu liso', foto: 'opcional',
        max_fotos: 2, abrir_ocorrencia: true, prioridade: 'critica' }] },
  ],
}

function criarChecklist(empresaId) {
  const id = novoId('template')
  executar(
    `INSERT INTO templates (id, empresa_id, codigo, nome, tipo_veiculo, cargos_liberados,
                            exige_assinatura, versao, status, estrutura, publicado_em, criado_em, atualizado_em)
     VALUES (?, ?, 'diario', 'Checklist diario', 'compacto_leve', '["*"]', 0, 1, 'publicado', ?, ?, ?, ?)`,
    [id, empresaId, JSON.stringify(ESTRUTURA), ts, ts, ts])
  return id
}

criarEmpresa(empresaA, 'Empresa A')
criarEmpresa(empresaB, 'Empresa B')

const cgFrota = criarCargo(empresaA, 'Equipe de frota')
const cgMotorista = criarCargo(empresaA, 'Motorista')
const cgFrotaB = criarCargo(empresaB, 'Equipe de frota')

criarUsuario(empresaA, 'Frota A', '52998224725', 'frota.a@rel.local', cgFrota, true)
criarUsuario(empresaA, 'Motorista A', '11144477735', 'motorista.a@rel.local', cgMotorista, false)
criarUsuario(empresaA, 'Outro A', '15350946056', 'outro.a@rel.local', cgMotorista, false)
criarUsuario(empresaB, 'Frota B', '87748248800', 'frota.b@rel.local', cgFrotaB, true)

const veiculo1 = criarVeiculo(empresaA, 'AAA1A11')
const veiculo2 = criarVeiculo(empresaA, 'AAA2A22')

// Pedido nasce com categoria; a placa entra na liberacao (roadmap 10.4).
const categoriaA = novoId('categoria')
executar(
  `INSERT INTO categorias_uso (id, empresa_id, nome, assentos, carroceria, criado_em, atualizado_em)
   VALUES (?, ?, 'Utilitario', 4, 'utilitario', ?, ?)`, [categoriaA, empresaA, ts, ts])
for (const v of [veiculo1, veiculo2]) {
  executar('INSERT INTO veiculo_categorias (empresa_id, veiculo_id, categoria_id) VALUES (?, ?, ?)',
    [empresaA, v, categoriaA])
}
criarChecklist(empresaA)

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
  try { fs.rmSync(raizTemp, { recursive: true, force: true }) } catch { /* ja removido */ }
})

async function chamar(metodo, caminho, { corpo, token } = {}) {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: {
      ...(corpo ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  return { status: r.status, dados: await r.json().catch(() => ({})) }
}

async function bruto(caminho, token) {
  return fetch(base + caminho, token ? { headers: { authorization: `Bearer ${token}` } } : undefined)
}

async function entrar(email) {
  return (await chamar('POST', '/api/auth/login', { corpo: { email, senha: SENHA } })).dados.token
}

const daquiAHoras = (h) => new Date(Date.now() + h * 3600000).toISOString()
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let contador = 0

// Monta uma solicitacao aprovada e devolve a tarefa pronta para o checklist.
async function prepararTarefa(veiculoId, horas) {
  const frota = await entrar('frota.a@rel.local')
  const motorista = await entrar('motorista.a@rel.local')
  const pedido = await chamar('POST', '/api/solicitacoes', {
    token: motorista,
    corpo: {
      categoria_id: categoriaA,
      janela_inicio: daquiAHoras(horas), janela_fim: daquiAHoras(horas + 4),
      motivo: 'Pedido montado para os testes de relatorio.',
    },
  })
  const solicitacao = pedido.dados.solicitacao.id
  await chamar('POST', `/api/solicitacoes/${solicitacao}/aprovar`,
    { token: frota, corpo: { veiculo_id: veiculoId } })
  const app = await chamar('GET', '/api/app/inicio', { token: motorista })
  const tarefa = app.dados.tarefas.find((t) => t.solicitacao_id === solicitacao)
  return { frota, motorista, solicitacao, tarefa }
}

async function enviarInspecao(motorista, tarefa, momento, respostas) {
  contador += 1
  const r = await chamar('POST', '/api/inspecoes', {
    token: motorista,
    corpo: {
      cliente_uuid: `uuid-rel-${contador}`, solicitacao_id: tarefa.solicitacao_id,
      template_id: tarefa.template_id, momento, km_informado: 10500, respostas,
    },
  })
  return r.dados.inspecao?.id
}

// -------------------------------------------------------------- evidencias

test('evidencia: a foto sobe e o reenvio da mesma foto nao duplica', async () => {
  const { motorista, tarefa } = await prepararTarefa(veiculo1, 900)
  const inspecao = await enviarInspecao(motorista, tarefa, 'saida',
    { lataria: { desfecho: 'ok' }, pneus: { desfecho: 'ok' } })

  const corpo = { cliente_id: 'foto-1', pergunta_id: 'lataria', tipo_mime: 'image/png', conteudo: PNG }

  const primeira = await chamar('POST', `/api/inspecoes/${inspecao}/evidencias`, { token: motorista, corpo })
  assert.equal(primeira.status, 200)
  assert.ok(primeira.dados.evidencia.hash_arquivo, 'precisa guardar o hash do arquivo')
  assert.ok(primeira.dados.evidencia.bytes > 0)

  const repetida = await chamar('POST', `/api/inspecoes/${inspecao}/evidencias`, { token: motorista, corpo })
  assert.equal(repetida.dados.repetida, true)
  assert.equal(repetida.dados.evidencia.id, primeira.dados.evidencia.id)

  const lista = await chamar('GET', `/api/inspecoes/${inspecao}/evidencias`, { token: motorista })
  assert.equal(lista.dados.evidencias.length, 1, 'reenvio nao pode criar segunda evidencia')
})

// Um PDF e uma pagina com script, os dois se dizendo PNG. Antes eram aceitos:
// a conferencia olhava so o rotulo que o cliente mandou.
const PDF = 'JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZz4+ZW5kb2JqCnRyYWlsZXI8PC9Sb290IDEgMCBSPj4='
const PAGINA_COM_SCRIPT = 'PCFkb2N0eXBlIGh0bWw+PHNjcmlwdD5hbGVydChkb2N1bWVudC5jb29raWUpPC9zY3JpcHQ+eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eA=='

test('evidencia: o que decide o tipo sao os bytes, nao o que o cliente declarou', async () => {
  // Evidencia de checklist e' prova em acidente e em processo trabalhista. Um
  // arquivo que nao e' imagem nenhuma nao pode entrar no acervo so porque o
  // remetente disse que era.
  const { motorista, tarefa } = await prepararTarefa(veiculo2, 910)
  const inspecao = await enviarInspecao(motorista, tarefa, 'saida',
    { lataria: { desfecho: 'ok' }, pneus: { desfecho: 'ok' } })

  const enviar = async (corpo) =>
    chamar('POST', `/api/inspecoes/${inspecao}/evidencias`, { token: motorista, corpo })

  // Nao e' imagem: barrado, mesmo jurando que e' PNG.
  const comPdf = await enviar(
    { cliente_id: 'pdf', pergunta_id: 'lataria', tipo_mime: 'image/png', conteudo: PDF })
  assert.equal(comPdf.status, 400)
  assert.match(comPdf.dados.mensagem, /nao e' uma imagem/i)

  const comScript = await enviar(
    { cliente_id: 'script', pergunta_id: 'lataria', tipo_mime: 'image/jpeg', conteudo: PAGINA_COM_SCRIPT })
  assert.equal(comScript.status, 400)

  // Imagem de verdade com rotulo errado passa, e o rotulo e' corrigido. Uma
  // foto mal rotulada e' defeito de cliente, nao ataque — e recusa-la perderia
  // a evidencia que o motorista ja tirou. O PWA manda 'image/jpeg' por padrao
  // quando o blob sai sem tipo, entao isso acontece de verdade.
  const rotuloErrado = await enviar(
    { cliente_id: 'rotulo', pergunta_id: 'lataria', tipo_mime: 'application/pdf', conteudo: PNG })
  assert.equal(rotuloErrado.status, 200, JSON.stringify(rotuloErrado.dados))
  assert.equal(rotuloErrado.dados.evidencia.tipo_mime, 'image/png',
    'o banco tem que guardar o que o arquivo E, nao o que disseram que ele era')

  // E o `content-type` servido tambem sai dos bytes: e' o mesmo cabecalho que
  // um dia vai sair de uma URL assinada, sem `nosniff` na frente.
  const baixada = await bruto(`/api/evidencias/${rotuloErrado.dados.evidencia.id}`, motorista)
  assert.equal(baixada.headers.get('content-type'), 'image/png')

  // As recusas que ja existiam continuam de pe.
  assert.equal((await enviar(
    { cliente_id: 'vazio', pergunta_id: 'lataria', tipo_mime: 'image/png', conteudo: '' })).status, 400)
  assert.equal((await enviar(
    { cliente_id: 'sem_pergunta', tipo_mime: 'image/png', conteudo: PNG })).status, 400)
})

test('evidencia: a imagem nao e publica — passa por sessao e por tenant', async () => {
  const { motorista, tarefa } = await prepararTarefa(veiculo1, 920)
  const inspecao = await enviarInspecao(motorista, tarefa, 'saida',
    { lataria: { desfecho: 'ok' }, pneus: { desfecho: 'ok' } })

  const r = await chamar('POST', `/api/inspecoes/${inspecao}/evidencias`, {
    token: motorista,
    corpo: { cliente_id: 'privada', pergunta_id: 'pneus', tipo_mime: 'image/png', conteudo: PNG },
  })
  const id = r.dados.evidencia.id

  assert.equal((await bruto(`/api/evidencias/${id}`)).status, 401, 'sem sessao nao ve')

  const tokenB = await entrar('frota.b@rel.local')
  assert.equal((await bruto(`/api/evidencias/${id}`, tokenB)).status, 404, 'outra empresa nao ve')

  const certa = await bruto(`/api/evidencias/${id}`, motorista)
  assert.equal(certa.status, 200)
  assert.equal(certa.headers.get('content-type'), 'image/png')
  assert.ok((await certa.arrayBuffer()).byteLength > 0, 'precisa devolver o arquivo de verdade')
})

test('evidencia: nao se anexa foto a inspecao de outra pessoa', async () => {
  const { motorista, tarefa } = await prepararTarefa(veiculo2, 930)
  const inspecao = await enviarInspecao(motorista, tarefa, 'saida',
    { lataria: { desfecho: 'ok' }, pneus: { desfecho: 'ok' } })

  const outro = await entrar('outro.a@rel.local')
  const r = await chamar('POST', `/api/inspecoes/${inspecao}/evidencias`, {
    token: outro,
    corpo: { cliente_id: 'invasao', pergunta_id: 'lataria', tipo_mime: 'image/png', conteudo: PNG },
  })
  assert.equal(r.status, 403)
})

// -------------------------------------------------------------- relatorios

test('relatorio: o checklist sai com a evidencia, e so a frota abre', async () => {
  const { frota, motorista, tarefa } = await prepararTarefa(veiculo1, 940)
  const inspecao = await enviarInspecao(motorista, tarefa, 'saida',
    { lataria: { desfecho: 'ok' }, pneus: { desfecho: 'ok' } })

  await chamar('POST', `/api/inspecoes/${inspecao}/evidencias`, {
    token: motorista,
    corpo: { cliente_id: 'foto-rel', pergunta_id: 'lataria', tipo_mime: 'image/png', conteudo: PNG },
  })

  assert.equal((await bruto(`/relatorio/inspecao/${inspecao}`, motorista)).status, 403,
    'relatorio e da equipe da frota')

  const resposta = await bruto(`/relatorio/inspecao/${inspecao}`, frota)
  assert.equal(resposta.status, 200)
  assert.match(resposta.headers.get('content-type'), /text\/html/)

  const html = await resposta.text()
  assert.match(html, /AAA1A11/, 'a placa precisa aparecer')
  assert.match(html, /Lataria/, 'as perguntas precisam aparecer')
  assert.match(html, /api\/evidencias\//, 'a foto precisa estar referenciada')
  assert.match(html, /Motorista A/, 'quem executou precisa aparecer')
})

test('relatorio: texto vindo do banco e escapado', async () => {
  // A descricao e escrita por motorista. Um "<" solto quebraria a pagina, e um
  // <script> viraria execucao no navegador de quem imprime.
  const frota = await entrar('frota.a@rel.local')
  const motorista = await entrar('motorista.a@rel.local')

  const pedido = await chamar('POST', '/api/solicitacoes', {
    token: motorista,
    corpo: {
      categoria_id: categoriaA,
      janela_inicio: daquiAHoras(950), janela_fim: daquiAHoras(954),
      motivo: 'Teste de escape <script>alert(1)</script> no relatorio.',
    },
  })
  const sol = pedido.dados.solicitacao.id
  await chamar('POST', `/api/solicitacoes/${sol}/aprovar`,
    { token: frota, corpo: { veiculo_id: veiculo2 } })

  const resposta = await bruto(`/relatorio/solicitacao/${sol}`, frota)
  assert.equal(resposta.status, 200)
  const html = await resposta.text()
  assert.ok(!html.includes('<script>alert(1)</script>'), 'HTML do banco nao pode sair cru')
  assert.match(html, /&lt;script&gt;/)
})

test('relatorio: o comparativo aponta o que estava OK na saida e virou ocorrencia', async () => {
  const { frota, motorista, solicitacao, tarefa } = await prepararTarefa(veiculo1, 960)

  await enviarInspecao(motorista, tarefa, 'saida',
    { lataria: { desfecho: 'ok' }, pneus: { desfecho: 'ok' } })

  const app = await chamar('GET', '/api/app/inicio', { token: motorista })
  const retorno = app.dados.tarefas.find((t) => t.solicitacao_id === solicitacao)
  assert.equal(retorno.momento, 'retorno', 'depois da saida a tarefa vira retorno')

  await enviarInspecao(motorista, retorno, 'retorno',
    { lataria: { desfecho: 'ocorrencia', opcao_id: 'risco' }, pneus: { desfecho: 'ok' } })

  const html = await (await bruto(`/relatorio/solicitacao/${solicitacao}`, frota)).text()
  assert.match(html, /possivel dano novo/,
    'o comparativo precisa marcar o item que estava conforme e deixou de estar')
  assert.match(html, /Saida/)
  assert.match(html, /Retorno/)
})

test('relatorio de frota: recalcula a preventiva antes de imprimir', async () => {
  // Status de preventiva e derivado de KM/data. Um relatorio impresso com
  // status velho e pior que nenhum: alguem assina embaixo dele.
  const frota = await entrar('frota.a@rel.local')
  executar(
    `INSERT INTO preventivas (id, empresa_id, veiculo_id, modo, proximo_km, alerta_antes_km,
                              status, criado_em, atualizado_em)
     VALUES (?, ?, ?, 'km', 500, 500, 'em_dia', ?, ?)`,
    [novoId('preventiva'), empresaA, veiculo1, ts, ts])

  const html = await (await bruto('/relatorio/frota', frota)).text()
  assert.match(html, /Situacao da frota/)
  assert.match(html, /AAA1A11/)
  // O veiculo tem 10.000 km e o alvo era 500: precisa sair como vencida.
  // O relatorio e' impresso: confere o rotulo que sai no papel, nao o valor
  // cru do banco.
  assert.match(html, /Vencida/, 'a preventiva estourada precisa aparecer recalculada')
  assert.doesNotMatch(html, /com_pendencia|em_tratamento/,
    'nenhum identificador de banco pode vazar para o documento impresso')
})

test('relatorio: inspecao de outra empresa nao abre', async () => {
  const { motorista, tarefa } = await prepararTarefa(veiculo2, 970)
  const inspecao = await enviarInspecao(motorista, tarefa, 'saida',
    { lataria: { desfecho: 'ok' }, pneus: { desfecho: 'ok' } })

  const tokenB = await entrar('frota.b@rel.local')
  assert.equal((await bruto(`/relatorio/inspecao/${inspecao}`, tokenB)).status, 404)
})
