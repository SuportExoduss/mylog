// Dados de desenvolvimento (Roadmap v3.0).
// Uso: npm run semear  — apaga e recria o banco de desenvolvimento.
import fs from 'node:fs'
import { config } from '../nucleo/config.js'
import { abrirBanco, executar, novoId, agora, fecharBanco } from '../nucleo/banco.js'
import { gerarHashSenha } from '../seguranca/senha.js'

if (config.ambiente !== 'desenvolvimento') {
  console.error('A semente so roda em ambiente de desenvolvimento.')
  process.exit(1)
}

for (const sufixo of ['', '-wal', '-shm']) {
  const alvo = config.bancoCaminho + sufixo
  if (fs.existsSync(alvo)) fs.rmSync(alvo)
}

abrirBanco()
const ts = agora()
const SENHA = 'mylog123'

const empresaId = novoId('empresa')
executar(
  `INSERT INTO empresas (id, nome, documento, status, politicas, criado_em, atualizado_em)
   VALUES (?, ?, ?, 'ativa', ?, ?, ?)`,
  [empresaId, 'Transportadora Exemplo Ltda', '00.000.000/0001-00',
   JSON.stringify({
     bloqueio_por_critica: true,
     retencao_fotos_dias: 730,
     antecedencia_horas: 24,
     antecedencia_rigida: false,
   }), ts, ts],
)

// ------------------------------------------------------------------ cargos
function criarCargo(nome) {
  const id = novoId('cargo')
  executar('INSERT INTO cargos (id, empresa_id, nome, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)',
    [id, empresaId, nome, ts, ts])
  return id
}

// Cargo e' funcao, nao permissao (roadmap 3). Quem trabalha na frota tem um
// cargo como qualquer outro; o que da acesso ao painel e' o nivel.
const cgFrota = criarCargo('Supervisor de frota')
const cgManutencao = criarCargo('Analista de manutencao')
const cgMotorista = criarCargo('Motorista')
const cgTecnico = criarCargo('Tecnico de campo')
const cgVendas = criarCargo('Consultor de vendas')
criarCargo('Recursos humanos')

// ---------------------------------------------------------------- usuarios
// A senha da semente e' fixa e ja trocada, para nao travar o desenvolvimento
// na tela de primeiro acesso a cada "npm run semear". Em producao a senha e'
// gerada e a troca e' obrigatoria (roadmap 8.1).
function criarUsuario(nome, cpf, email, telefone, cargoId, acessaPainel, status = 'ativo', usaVeiculoDiario = false) {
  const id = novoId('usuario')
  const { hash, salt } = gerarHashSenha(SENHA)
  const pendente = status === 'pendente'
  executar(
    `INSERT INTO usuarios (id, empresa_id, nome, cpf, email, telefone, cargo_id, acessa_painel,
                           usa_veiculo_diario, status, senha_hash, senha_salt, deve_trocar_senha,
                           primeiro_acesso_em, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, empresaId, nome, cpf, email, telefone, cargoId, acessaPainel ? 1 : 0,
     usaVeiculoDiario ? 1 : 0,
     status, hash, salt, pendente ? 1 : 0, pendente ? null : ts, ts, ts],
  )
  return id
}

// CPFs validos gerados para desenvolvimento — passam no digito verificador.
const admId = criarUsuario('Andre Roberth', '52998224725', 'adm@mylog.local', '(31) 90000-0001', cgFrota, true)
const marinaId = criarUsuario('Marina Lopes', '11144477735', 'marina@mylog.local', '(31) 90000-0002', cgManutencao, true)
// Carlos sai com carro toda manha: faz checklist diario avulso, sem pedir.
const carlosId = criarUsuario('Carlos Nunes', '15350946056', 'carlos@mylog.local', '(31) 90000-0003', cgMotorista, false, 'ativo', true)
const ritaId = criarUsuario('Rita Alves', '39145281769', 'rita@mylog.local', '(31) 90000-0004', cgVendas, false)
criarUsuario('Joao Pires', '71428793860', 'joao@mylog.local', '(31) 90000-0005', cgTecnico, false, 'pendente')
criarUsuario('Bruno Dias', '87748248800', 'bruno@mylog.local', '(31) 90000-0006', cgMotorista, false, 'bloqueado')

// ---------------------------------------------------------------- veiculos
function criarVeiculo(placa, marca, modelo, ano, tipo, km, status = 'disponivel', motivo = null) {
  const id = novoId('veiculo')
  executar(
    `INSERT INTO veiculos (id, empresa_id, placa, marca, modelo, ano, tipo, km_atual,
                           status, motivo_status, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, empresaId, placa, marca, modelo, ano, tipo, km, status, motivo, ts, ts],
  )
  return id
}

const v1 = criarVeiculo('ABC1D23', 'Fiat', 'Strada', 2023, 'pickup', 41200)
const v2 = criarVeiculo('DEF2G45', 'Volkswagen', 'Constellation 24.280', 2019, 'caminhao', 318400)
const v3 = criarVeiculo('GHI3J67', 'Renault', 'Kwid', 2021, 'compacto_leve', 96700)
const v4 = criarVeiculo('JKL4M89', 'Mercedes-Benz', 'Accelo 1016', 2016, 'caminhao', 452300,
  'bloqueado', 'Freio de servico com folga reprovado no checklist de 30/08.')
const v5 = criarVeiculo('MNO5P12', 'Toyota', 'Hilux', 2022, 'quatro_x_quatro', 78900)

// -------------------------------------------------------------- checklist
// Modelo de partida. Nao pretende ser o definitivo da empresa — isso so sai da
// F0, mapeando o PROLOG real. Serve para exercitar o motor: tem foto
// obrigatoria, opcao que abre ocorrencia critica e opcao que so registra.
const ESTRUTURA = {
  perguntas: [
    {
      id: 'lateral_esquerda',
      titulo: 'Lateral esquerda',
      foto_exibicao: null,
      foto_ok: 'obrigatorio',
      max_fotos_ok: 4,
      opcoes_problema: [
        { id: 'risco', nome: 'Risco na pintura', foto: 'obrigatorio', max_fotos: 3, abrir_ocorrencia: true, prioridade: 'baixa' },
        { id: 'amassado', nome: 'Lataria amassada', foto: 'obrigatorio', max_fotos: 3, abrir_ocorrencia: true, prioridade: 'media' },
        { id: 'furo', nome: 'Furo ou perfuracao', foto: 'obrigatorio', max_fotos: 3, abrir_ocorrencia: true, prioridade: 'alta' },
        { id: 'macaneta', nome: 'Macaneta quebrada', foto: 'obrigatorio', max_fotos: 2, abrir_ocorrencia: true, prioridade: 'media' },
      ],
    },
    {
      id: 'lateral_direita',
      titulo: 'Lateral direita',
      foto_exibicao: null,
      foto_ok: 'obrigatorio',
      max_fotos_ok: 4,
      opcoes_problema: [
        { id: 'risco', nome: 'Risco na pintura', foto: 'obrigatorio', max_fotos: 3, abrir_ocorrencia: true, prioridade: 'baixa' },
        { id: 'amassado', nome: 'Lataria amassada', foto: 'obrigatorio', max_fotos: 3, abrir_ocorrencia: true, prioridade: 'media' },
      ],
    },
    {
      id: 'pneus',
      titulo: 'Pneus e rodagem',
      foto_exibicao: null,
      foto_ok: 'obrigatorio',
      max_fotos_ok: 4,
      opcoes_problema: [
        { id: 'desgaste', nome: 'Desgaste visivel na banda', foto: 'obrigatorio', max_fotos: 4, abrir_ocorrencia: true, prioridade: 'media' },
        { id: 'liso', nome: 'Pneu liso', foto: 'obrigatorio', max_fotos: 4, abrir_ocorrencia: true, prioridade: 'critica' },
        { id: 'calibragem', nome: 'Precisa calibrar', foto: 'opcional', max_fotos: 1, abrir_ocorrencia: false },
      ],
    },
    {
      id: 'freios',
      titulo: 'Freio de servico',
      foto_exibicao: null,
      foto_ok: 'nao_capturar',
      max_fotos_ok: 1,
      opcoes_problema: [
        { id: 'folga', nome: 'Folga excessiva no pedal', foto: 'opcional', max_fotos: 2, abrir_ocorrencia: true, prioridade: 'critica' },
        { id: 'ruido', nome: 'Ruido ao frear', foto: 'nao_capturar', max_fotos: 1, abrir_ocorrencia: true, prioridade: 'alta' },
      ],
    },
    {
      id: 'iluminacao',
      titulo: 'Farois, lanternas e setas',
      foto_exibicao: null,
      foto_ok: 'opcional',
      max_fotos_ok: 2,
      opcoes_problema: [
        { id: 'farol_queimado', nome: 'Farol queimado', foto: 'obrigatorio', max_fotos: 2, abrir_ocorrencia: true, prioridade: 'alta' },
        { id: 'seta', nome: 'Seta com defeito', foto: 'obrigatorio', max_fotos: 2, abrir_ocorrencia: true, prioridade: 'media' },
      ],
    },
    {
      id: 'interior',
      titulo: 'Interior e limpeza',
      foto_exibicao: null,
      foto_ok: 'opcional',
      max_fotos_ok: 3,
      opcoes_problema: [
        { id: 'sujeira', nome: 'Veiculo sujo', foto: 'obrigatorio', max_fotos: 3, abrir_ocorrencia: true, prioridade: 'baixa' },
        { id: 'estofado', nome: 'Estofado danificado', foto: 'obrigatorio', max_fotos: 3, abrir_ocorrencia: true, prioridade: 'media' },
      ],
    },
  ],
}

function criarChecklist(codigo, nome, tipo, cargos, exigeAssinatura, ritmo = {}) {
  const id = novoId('template')
  executar(
    `INSERT INTO templates (id, empresa_id, codigo, nome, tipo_veiculo, cargos_liberados,
                            exige_assinatura, periodicidade, dias_semana, dia_semana,
                            horario_limite, versao, status, estrutura,
                            publicado_em, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'publicado', ?, ?, ?, ?)`,
    [id, empresaId, codigo, nome, tipo, JSON.stringify(cargos), exigeAssinatura ? 1 : 0,
     ritmo.periodicidade || 'avulso', JSON.stringify(ritmo.dias_semana || []),
     ritmo.dia_semana ?? null, ritmo.horario_limite ?? null,
     JSON.stringify(ESTRUTURA), ts, ts, ts],
  )
  return id
}

// Ritmo tirado do relatorio real do PROLOG (roadmap 24.1): segunda a sexta,
// com 74% das saidas ate as 08h. O limite de 08:30 separa a rotina da excecao.
const DIA_UTIL = { periodicidade: 'diario', dias_semana: [1, 2, 3, 4, 5], horario_limite: '08:30' }

criarChecklist('diario-pickup', 'Checklist diario — pick-up', 'pickup', ['*'], true, DIA_UTIL)
criarChecklist('diario-compacto', 'Checklist diario — compacto leve', 'compacto_leve', ['*'], false, DIA_UTIL)
criarChecklist('diario-caminhao', 'Checklist diario — caminhao', 'caminhao',
  [cgFrota, cgMotorista], true, DIA_UTIL)
criarChecklist('diario-4x4', 'Checklist diario — 4x4', 'quatro_x_quatro', ['*'], false, DIA_UTIL)

// Checklist de mecanico: so aparece para quem tem o cargo (roadmap 11.2.3).
criarChecklist('pos-manutencao', 'Checklist pos-manutencao', 'compacto_leve',
  [cgManutencao], true, { periodicidade: 'avulso' })

// ------------------------------------------------------- categorias de uso
// O que o colaborador pede (roadmap 10.3). Descreve o trabalho, nao o carro.
function criarCategoria(nome, assentos, carroceria, veiculos) {
  const id = novoId('categoria')
  executar(
    `INSERT INTO categorias_uso (id, empresa_id, nome, assentos, carroceria, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, empresaId, nome, assentos, carroceria, ts, ts],
  )
  for (const veiculoId of veiculos) {
    executar(
      'INSERT INTO veiculo_categorias (empresa_id, veiculo_id, categoria_id) VALUES (?, ?, ?)',
      [empresaId, veiculoId, id],
    )
  }
  return id
}

const catCompacto = criarCategoria('4 assentos — compacto', 4, 'compacto', [v3])
const catComercial = criarCategoria('4 assentos — comercial', 4, 'comercial', [v1, v5])
criarCategoria('2 assentos — utilitario', 2, 'utilitario', [v2, v4])

// ------------------------------------------------------------ preventivas
function criarPreventiva(veiculoId, modo, dados) {
  executar(
    `INSERT INTO preventivas (id, empresa_id, veiculo_id, modo, ultimo_servico_km, ultimo_servico_data,
                              proximo_km, proxima_data, alerta_antes_km, alerta_antes_dias,
                              status, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'em_dia', ?, ?)`,
    [novoId('preventiva'), empresaId, veiculoId, modo,
     dados.ultimoKm ?? null, dados.ultimaData ?? null,
     dados.proximoKm ?? null, dados.proximaData ?? null,
     dados.alertaKm ?? 500, dados.alertaDias ?? 7, ts, ts],
  )
}

const emDias = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

criarPreventiva(v1, 'km', { ultimoKm: 31000, proximoKm: 51000, alertaKm: 1000 })
criarPreventiva(v2, 'km', { ultimoKm: 300000, proximoKm: 315000, alertaKm: 2000 })  // vencida
criarPreventiva(v3, 'data', { ultimaData: emDias(-170), proximaData: emDias(5), alertaDias: 7 })
criarPreventiva(v4, 'data', { ultimaData: emDias(-400), proximaData: emDias(-35), alertaDias: 10 }) // vencida
criarPreventiva(v5, 'km', { ultimoKm: 68000, proximoKm: 88000, alertaKm: 1000 })

// ---------------------------------------------------------- solicitacoes
// Pedido nasce com CATEGORIA e sem placa; a placa entra na liberacao
// (roadmap 10.4). Por isso "veiculo" e' null enquanto o status e' pendente.
function criarSolicitacao(numero, solicitante, categoria, veiculo, inicioHoras, duracaoHoras, motivo, status) {
  const inicio = new Date(Date.now() + inicioHoras * 3600000).toISOString()
  const fim = new Date(Date.now() + (inicioHoras + duracaoHoras) * 3600000).toISOString()
  executar(
    `INSERT INTO solicitacoes (id, empresa_id, numero, solicitante_id, categoria_id, veiculo_id,
                               janela_inicio, janela_fim, motivo, status,
                               aprovada_por, aprovada_em, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [novoId('solicitacao'), empresaId, numero, solicitante, categoria, veiculo, inicio, fim,
     motivo, status,
     status === 'pendente' ? null : admId, status === 'pendente' ? null : ts, ts, ts],
  )
}

// Aguardando a Frota: pediu categoria, ainda NAO tem placa.
criarSolicitacao(1, ritaId, catCompacto, null, 30, 5,
  'Reuniao com cliente em Betim na sexta a tarde.', 'pendente')
// Liberada com placa: o app mostra o veiculo e o checklist de SAIDA.
criarSolicitacao(2, ritaId, catComercial, v1, 2, 6,
  'Entrega de material na obra do Barreiro.', 'aprovada')
// Em uso e ja passou do prazo: o app vai pedir o motivo do atraso.
criarSolicitacao(3, ritaId, catComercial, v5, -8, 4,
  'Visita tecnica em Sete Lagoas.', 'em_uso')

// ------------------------------------------------------------ ocorrencias
// A frota bloqueada precisa ter um porque visivel na fila. Sem isto o painel
// mostra "1 bloqueado" e "0 ocorrencias abertas" ao mesmo tempo, que e' o tipo
// de contradicao que faz o supervisor parar de confiar no numero.
function criarOcorrencia(veiculo, perguntaId, descricao, prioridade, status, diasAtras, extras = {}) {
  const abertaEm = new Date(Date.now() - diasAtras * 86400000).toISOString()
  executar(
    `INSERT INTO ocorrencias (id, empresa_id, veiculo_id, pergunta_id, descricao,
                              prioridade, status, responsavel_id, resolucao,
                              resolvida_em, aberta_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [novoId('ocorrencia'), empresaId, veiculo, perguntaId, descricao, prioridade, status,
     extras.responsavel ?? null, extras.resolucao ?? null, extras.resolvidaEm ?? null, abertaEm],
  )
}

criarOcorrencia(v4, 'freios',
  'Folga excessiva no pedal: pedal vai quase ao fundo antes de responder.',
  'critica', 'aberta', 5)
criarOcorrencia(v4, 'pneus',
  'Desgaste visivel na banda: dianteiro esquerdo abaixo do sulco minimo.',
  'media', 'em_tratamento', 5, { responsavel: marinaId })
criarOcorrencia(v2, 'iluminacao',
  'Farol queimado: baixo direito nao acende.',
  'alta', 'aberta', 2)
criarOcorrencia(v3, 'lataria',
  'Risco na pintura: porta traseira direita, sem deformacao.',
  'baixa', 'aberta', 9)
criarOcorrencia(v1, 'interior',
  'Veiculo sujo: cabine com residuo de obra.',
  'baixa', 'resolvida', 20,
  { responsavel: marinaId, resolucao: 'Higienizacao completa feita no patio.',
    resolvidaEm: new Date(Date.now() - 18 * 86400000).toISOString() })

console.log('Banco semeado em', config.bancoCaminho)
console.log('')
console.log('  FROTA (painel web + app)')
console.log('    adm@mylog.local        / mylog123   Andre Roberth')
console.log('    marina@mylog.local     / mylog123   Marina Lopes')
console.log('')
console.log('  COLABORADOR (somente app)')
console.log('    carlos@mylog.local     / mylog123   USA CARRO TODO DIA: checklist avulso')
console.log('    rita@mylog.local       / mylog123   Vendas: pede carro, tem saida e retorno')
console.log('    joao@mylog.local       / mylog123   PENDENTE: cai na troca de senha')
console.log('    bruno@mylog.local      / mylog123   BLOQUEADO: nao entra')
fecharBanco()
