// Configuracao central. Tudo vem de variavel de ambiente com padrao de desenvolvimento.
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import crypto from 'node:crypto'

const aqui = path.dirname(fileURLToPath(import.meta.url))
export const RAIZ_SERVIDOR = path.resolve(aqui, '..', '..')
export const RAIZ_PROJETO = path.resolve(RAIZ_SERVIDOR, '..')

export const config = {
  porta: Number(process.env.MYLOG_PORTA || 4000),
  ambiente: process.env.MYLOG_AMBIENTE || 'desenvolvimento',

  // Banco de desenvolvimento. Em producao troca por PostgreSQL (ver docs/DECISOES.md).
  bancoCaminho: process.env.MYLOG_BANCO || path.join(RAIZ_SERVIDOR, 'dados', 'mylog.db'),

  // Storage local de evidencias no piloto; S3/R2 depois. Nunca dentro do banco.
  storageCaminho: process.env.MYLOG_STORAGE || path.join(RAIZ_SERVIDOR, 'dados', 'evidencias'),

  webCaminho: path.join(RAIZ_PROJETO, 'web'),
  appCaminho: path.join(RAIZ_PROJETO, 'app'),
  compartilhadoCaminho: path.join(RAIZ_PROJETO, 'compartilhado'),

  // Segredo usado para derivar o hash do token de sessao guardado no banco.
  segredoSessao: process.env.MYLOG_SEGREDO || 'desenvolvimento-trocar-em-producao',

  sessaoHoras: Number(process.env.MYLOG_SESSAO_HORAS || 12),
  sessaoAndroidHoras: Number(process.env.MYLOG_SESSAO_ANDROID_HORAS || 24 * 30),
}

export function avisarSegredoFraco() {
  if (config.ambiente !== 'desenvolvimento' && config.segredoSessao.startsWith('desenvolvimento')) {
    throw new Error('MYLOG_SEGREDO precisa ser definido fora de desenvolvimento.')
  }
}

export function segredoAleatorio(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url')
}
