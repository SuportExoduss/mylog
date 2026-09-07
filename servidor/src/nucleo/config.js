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

  // Quantos proxies reversos ficam NA FRENTE do servidor.
  //
  // Zero por padrao, e o padrao importa: com zero, `x-forwarded-for` e' ignorado
  // por inteiro e o IP vem do socket. Confiar nesse cabecalho sem proxy na
  // frente e' confiar num campo que o proprio cliente escreve — ver D49.
  //
  // Atras de um proxy (Firebase Hosting, nginx, Cloudflare), coloque 1: o
  // endereco real passa a ser o penultimo da lista, que foi o proxy quem
  // acrescentou e o cliente nao alcanca.
  proxiesConfiaveis: Math.max(0, Number(process.env.MYLOG_PROXIES_CONFIAVEIS || 0)),

  // Fuso da OPERACAO, nao da maquina. E' ele que decide onde termina o dia,
  // e o servidor pode acabar rodando em outro continente (ver nucleo/relogio.js).
  fuso: process.env.MYLOG_FUSO || 'America/Sao_Paulo',

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
    // Recusar subir sem dizer como resolver deixa quem esta implantando
    // procurando na documentacao com o servidor fora do ar. O valor sugerido
    // e' gerado na hora e serve: e' 32 bytes de `crypto.randomBytes`.
    throw new Error(
      'MYLOG_SEGREDO precisa ser definido fora de desenvolvimento. '
      + `Sugestao: MYLOG_SEGREDO=${segredoAleatorio()}`)
  }
}

export function segredoAleatorio(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url')
}
