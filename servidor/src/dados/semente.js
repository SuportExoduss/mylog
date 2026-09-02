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
criarUsuario('Rita Alves', 'rita@mylog.local', 'colaborador', 'pendente', 'mylog123')
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

console.log('Banco semeado em', config.bancoCaminho)
console.log('')
console.log('  ADM .......... adm@mylog.local        / mylog123')
console.log('  Supervisao ... supervisao@mylog.local / mylog123')
console.log('  Colaborador .. carlos@mylog.local     / mylog123')
console.log('  Pendente ..... rita@mylog.local       (nao entra: aguarda liberacao)')
console.log('  Bloqueado .... bruno@mylog.local      (nao entra: acesso revogado)')
fecharBanco()
