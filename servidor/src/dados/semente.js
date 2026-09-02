// Dados de desenvolvimento. Recria um cenario minimo para ver o painel com vida.
// Uso: npm run semear   (apaga e recria o banco de desenvolvimento)
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

const empresaId = novoId('empresa')
executar(
  `INSERT INTO empresas (id, nome, documento, status, politicas, criado_em, atualizado_em)
   VALUES (?, ?, ?, 'ativa', ?, ?, ?)`,
  [empresaId, 'Transportadora Exemplo Ltda', '00.000.000/0001-00',
   JSON.stringify({ bloqueio_por_critico: true, retencao_fotos_dias: 730 }), ts, ts],
)

function criarUsuario(nome, email, papel, status, senha) {
  const id = novoId('usuario')
  const { hash, salt } = gerarHashSenha(senha)
  executar(
    `INSERT INTO usuarios (id, empresa_id, nome, email, papel, status, senha_hash, senha_salt,
                           senha_definida, ativado_em, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [id, empresaId, nome, email, papel, status, hash, salt,
     status === 'ativo' ? ts : null, ts, ts],
  )
  return id
}

const admId = criarUsuario('Andre Roberth', 'adm@mylog.local', 'adm', 'ativo', 'mylog123')
const supId = criarUsuario('Marina Lopes', 'supervisao@mylog.local', 'supervisor', 'ativo', 'mylog123')
const colaId = criarUsuario('Carlos Nunes', 'carlos@mylog.local', 'colaborador', 'ativo', 'mylog123')
const ritaId = criarUsuario('Rita Alves', 'rita@mylog.local', 'colaborador', 'pendente', 'mylog123')
criarUsuario('Joao Pires', 'joao@mylog.local', 'manutencao', 'ativo', 'mylog123')
criarUsuario('Bruno Dias', 'bruno@mylog.local', 'colaborador', 'bloqueado', 'mylog123')

function criarVeiculo(placa, marca, modelo, ano, tipo, km, status, motivo) {
  const id = novoId('veiculo')
  executar(
    `INSERT INTO veiculos (id, empresa_id, placa, marca, modelo, ano, tipo, km_atual,
                           status, motivo_status, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, empresaId, placa, marca, modelo, ano, tipo, km, status, motivo || null, ts, ts],
  )
  return id
}

const v1 = criarVeiculo('ABC1D23', 'Fiat', 'Strada', 2023, 'carro', 41200, 'disponivel')
const v2 = criarVeiculo('DEF2G45', 'Volkswagen', 'Constellation 24.280', 2019, 'caminhao', 318400, 'disponivel')
const v3 = criarVeiculo('GHI3J67', 'Renault', 'Master', 2021, 'van', 96700, 'com_pendencia')
const v4 = criarVeiculo('JKL4M89', 'Mercedes-Benz', 'Accelo 1016', 2016, 'caminhao', 452300, 'bloqueado',
  'Freio de servico com folga reprovado no checklist de 30/08.')

function vincular(usuarioId, veiculoId, principal) {
  executar(
    `INSERT INTO vinculos (id, empresa_id, usuario_id, veiculo_id, principal, criado_em, criado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [novoId('vinculo'), empresaId, usuarioId, veiculoId, principal ? 1 : 0, ts, admId],
  )
  if (principal) executar('UPDATE veiculos SET usuario_principal = ? WHERE id = ?', [usuarioId, veiculoId])
}

vincular(colaId, v1, true)
vincular(colaId, v3, false)
vincular(supId, v2, true)

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

// Veiculo novo: periodicidade por KM. Ainda longe do alvo.
criarPreventiva(v1, 'km', { ultimoKm: 31000, proximoKm: 51000, alertaKm: 1000 })
// Caminhao rodando muito: alvo ja ultrapassado -> deve aparecer VENCIDA no painel.
criarPreventiva(v2, 'km', { ultimoKm: 300000, proximoKm: 315000, alertaKm: 2000 })
// Veiculo mais antigo: periodicidade por data, dentro da janela de alerta.
criarPreventiva(v3, 'data', { ultimaData: emDias(-170), proximaData: emDias(5), alertaDias: 7 })
// Veiculo antigo com preventiva atrasada.
criarPreventiva(v4, 'data', { ultimaData: emDias(-400), proximaData: emDias(-35), alertaDias: 10 })

// ------------------------------------------------------------- template
// Checklist de partida. Nao pretende ser o modelo definitivo da empresa — isso
// so sai da F0, mapeando o PROLOG real. Serve para exercitar o motor: tem item
// condicional, limite numerico, foto obrigatoria em item critico e selecao com
// criticidade por opcao.
const ESTRUTURA_DIARIO = {
  secoes: [
    {
      id: 'documentacao',
      titulo: 'Documentacao e identificacao',
      itens: [
        { id: 'crlv_presente', rotulo: 'CRLV do veiculo esta no porta-luvas?',
          tipo: 'sim_nao', valor_conforme: 'sim', criticidade: 'alto' },
        { id: 'km_partida', rotulo: 'Quilometragem do hodometro', tipo: 'numero', unidade: 'km' },
      ],
    },
    {
      id: 'seguranca',
      titulo: 'Itens de seguranca',
      itens: [
        { id: 'extintor_presente', rotulo: 'Extintor presente e no prazo?',
          tipo: 'sim_nao', valor_conforme: 'sim', criticidade: 'critico',
          foto_obrigatoria_se_nok: true },
        { id: 'extintor_validade', rotulo: 'Data de validade do extintor', tipo: 'datahora',
          condicao: { item_id: 'extintor_presente', operador: 'igual', valor: 'sim' } },
        { id: 'triangulo_macaco', rotulo: 'Triangulo, macaco e chave de roda',
          tipo: 'ok_nok', criticidade: 'medio' },
        { id: 'cintos', rotulo: 'Cintos de seguranca', tipo: 'ok_nok', criticidade: 'critico',
          foto_obrigatoria_se_nok: true },
      ],
    },
    {
      id: 'pneus',
      titulo: 'Pneus e rodagem',
      itens: [
        { id: 'pneu_de_condicao', rotulo: 'Condicao do pneu dianteiro esquerdo', tipo: 'selecao',
          opcoes: [
            { valor: 'normal', rotulo: 'Normal', conforme: true },
            { valor: 'atencao', rotulo: 'Desgaste visivel', conforme: false, criticidade: 'medio' },
            { valor: 'critico', rotulo: 'Liso ou danificado', conforme: false, criticidade: 'critico' },
          ],
          foto_obrigatoria_se_nok: true },
        { id: 'pneu_de_pressao', rotulo: 'Pressao do pneu dianteiro esquerdo (PSI)',
          tipo: 'numero', minimo: 28, maximo: 36, unidade: 'PSI', criticidade: 'medio' },
        { id: 'estepe', rotulo: 'Estepe em condicao de uso', tipo: 'ok_nok', criticidade: 'baixo' },
      ],
    },
    {
      id: 'motor',
      titulo: 'Motor e fluidos',
      itens: [
        { id: 'oleo_nivel', rotulo: 'Nivel de oleo do motor', tipo: 'ok_nok', criticidade: 'alto' },
        { id: 'oleo_obs', rotulo: 'O que foi observado no oleo?', tipo: 'texto',
          condicao: { item_id: 'oleo_nivel', operador: 'nao_conforme' } },
        { id: 'agua_radiador', rotulo: 'Nivel da agua do radiador', tipo: 'ok_nok', criticidade: 'alto' },
        { id: 'vazamentos', rotulo: 'Ha vazamento visivel sob o veiculo?',
          tipo: 'sim_nao', valor_conforme: 'nao', criticidade: 'alto', foto_obrigatoria_se_nok: true },
      ],
    },
    {
      id: 'freios_luzes',
      titulo: 'Freios e iluminacao',
      itens: [
        { id: 'freio_servico', rotulo: 'Freio de servico', tipo: 'ok_nok', criticidade: 'critico',
          foto_obrigatoria_se_nok: true },
        { id: 'freio_estacionamento', rotulo: 'Freio de estacionamento', tipo: 'ok_nok', criticidade: 'alto' },
        { id: 'farois', rotulo: 'Farois alto e baixo', tipo: 'ok_nok', criticidade: 'alto' },
        { id: 'lanternas_setas', rotulo: 'Lanternas e setas', tipo: 'ok_nok', criticidade: 'medio' },
      ],
    },
    {
      id: 'encerramento',
      titulo: 'Encerramento',
      itens: [
        { id: 'observacoes', rotulo: 'Observacoes gerais', tipo: 'texto', obrigatorio: false },
        { id: 'assinatura_condutor', rotulo: 'Assinatura do condutor', tipo: 'assinatura' },
      ],
    },
  ],
}

const templateId = novoId('template')
executar(
  `INSERT INTO templates (id, empresa_id, codigo, nome, tipo_veiculo, versao, status, estrutura,
                          publicado_em, criado_em, atualizado_em)
   VALUES (?, ?, 'diario-leve', 'Checklist diario — veiculo leve', 'carro', 1, 'publicado', ?, ?, ?, ?)`,
  [templateId, empresaId, JSON.stringify(ESTRUTURA_DIARIO), ts, ts, ts],
)

// ---------------------------------------------------------------- tickets
// Inclui o caso central da secao 16: colaborador sem veiculo proprio pedindo
// para usar um carro identificado por modelo + placa.
function criarTicket(numero, solicitante, veiculo, categoria, prioridade, descricao, status, horasAtras) {
  const criado = new Date(Date.now() - horasAtras * 3600000).toISOString()
  const prazo = new Date(new Date(criado).getTime() + (prioridade === 'alta' ? 8 : 72) * 3600000).toISOString()
  executar(
    `INSERT INTO tickets (id, empresa_id, numero, solicitante_id, veiculo_id, categoria,
                          prioridade, descricao, status, prazo_em, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [novoId('ticket'), empresaId, numero, solicitante, veiculo, categoria,
     prioridade, descricao, status, prazo, criado],
  )
}

criarTicket(1, ritaId, null, 'solicitacao', 'normal',
  'Preciso de um veiculo para a entrega em Betim na quinta-feira de manha.', 'aberto', 6)
criarTicket(2, colaId, v3, 'problema', 'alta',
  'Ar-condicionado do Master parou de gelar. Cabine fica insuportavel a tarde.', 'em_andamento', 30)
criarTicket(3, colaId, v1, 'dano', 'normal',
  'Arranhao novo na lateral direita da Strada, notado ao retirar o veiculo hoje.', 'aberto', 2)

console.log('Banco semeado em', config.bancoCaminho)
console.log('')
console.log('  ADM .......... adm@mylog.local        / mylog123')
console.log('  Supervisao ... supervisao@mylog.local / mylog123')
console.log('  Colaborador .. carlos@mylog.local     / mylog123')
console.log('  Pendente ..... rita@mylog.local       (nao entra: aguarda liberacao)')
console.log('  Bloqueado .... bruno@mylog.local      (nao entra: acesso revogado)')
fecharBanco()
