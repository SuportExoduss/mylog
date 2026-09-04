// Sessoes com token opaco revogavel. O banco guarda apenas o HMAC do token,
// entao um vazamento da tabela nao permite entrar em nenhuma conta.
import crypto from 'node:crypto'
import { config } from '../nucleo/config.js'
import { consultarUm, executar, novoId, agora } from '../nucleo/banco.js'
import { erro } from '../nucleo/http.js'

export const NOME_COOKIE = 'mylog_sessao'

function hashDoToken(token) {
  return crypto.createHmac('sha256', config.segredoSessao).update(token).digest('hex')
}

export function criarSessao(usuario, origem = 'web') {
  const token = crypto.randomBytes(32).toString('base64url')
  const horas = origem === 'android' ? config.sessaoAndroidHoras : config.sessaoHoras
  const expira = new Date(Date.now() + horas * 3600 * 1000).toISOString()
  executar(
    `INSERT INTO sessoes (id, empresa_id, usuario_id, token_hash, origem, criado_em, expira_em)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [novoId('sessao'), usuario.empresa_id, usuario.id, hashDoToken(token), origem, agora(), expira],
  )
  return { token, expira }
}

// Resolve o token em um usuario. Revalida o status da credencial a cada
// requisicao: bloquear um usuario derruba o acesso na hora, sem esperar expirar.
export function usuarioDaSessao(token) {
  if (!token) return null
  const linha = consultarUm(
    `SELECT s.id AS sessao_id, s.expira_em, s.revogado_em, s.origem,
            u.id, u.empresa_id, u.nome, u.email, u.cpf, u.telefone,
            u.cargo_id, u.acessa_painel, u.usa_veiculo_diario, u.status,
            u.deve_trocar_senha, c.nome AS cargo_nome
       FROM sessoes s
       JOIN usuarios u ON u.id = s.usuario_id
       LEFT JOIN cargos c ON c.id = u.cargo_id
      WHERE s.token_hash = ?`,
    [hashDoToken(token)],
  )
  if (!linha) return null
  if (linha.revogado_em) return null
  if (linha.expira_em <= agora()) return null
  // "pendente" ainda nao trocou a senha inicial: a sessao vale, mas so para a
  // troca de senha. Quem barra as demais rotas e' exigirSenhaTrocada().
  if (linha.status !== 'ativo' && linha.status !== 'pendente') return null
  return linha
}

export function revogarSessao(token) {
  if (!token) return
  executar('UPDATE sessoes SET revogado_em = ? WHERE token_hash = ? AND revogado_em IS NULL',
    [agora(), hashDoToken(token)])
}

export function revogarSessoesDoUsuario(usuarioId) {
  executar('UPDATE sessoes SET revogado_em = ? WHERE usuario_id = ? AND revogado_em IS NULL',
    [agora(), usuarioId])
}

export function exigirAutenticado(ctx) {
  if (!ctx.usuario) throw erro.autenticacao('Sessao ausente ou expirada.')
  // Enquanto a senha inicial nao for trocada, a unica coisa que o usuario
  // consegue fazer e' trocar a senha (roadmap 8.1).
  if (ctx.usuario.deve_trocar_senha) {
    const recusa = erro.permissao('Troque a senha inicial antes de continuar.')
    recusa.codigo = 'troca_de_senha_obrigatoria'
    throw recusa
  }
  return ctx.usuario
}

// Para as poucas rotas que o usuario pendente pode chamar.
export function exigirSessao(ctx) {
  if (!ctx.usuario) throw erro.autenticacao('Sessao ausente ou expirada.')
  return ctx.usuario
}

export function cabecalhoCookie(token, expira) {
  const partes = [
    `${NOME_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/', 'HttpOnly', 'SameSite=Strict',
    `Expires=${new Date(expira).toUTCString()}`,
  ]
  if (config.ambiente !== 'desenvolvimento') partes.push('Secure')
  return partes.join('; ')
}

export function cabecalhoCookieVazio() {
  return `${NOME_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`
}
