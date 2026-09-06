// O dia da operacao.
//
// "Hoje", "ate as 08:30" e "o dia 03" sao perguntas do patio, nao do processo.
// Ate aqui elas eram respondidas pelo fuso do sistema operacional: `getDate()`,
// `getHours()`, `new Date(ano, mes, dia)`. Isso funciona por acidente enquanto o
// servidor roda na mesma cidade da frota — e desloca TODO limite de dia em tres
// horas no instante em que ele subir para uma nuvem que roda em UTC. O filtro
// de periodo, o "hoje" do painel, o horario limite, a obrigacao diaria e a
// cobranca de quem nao fez mudariam de resposta juntos, sem nenhum erro.
//
// O fuso e' da OPERACAO, nao da maquina. Uma frota em Manaus e outra em Sao
// Paulo nao fecham o dia na mesma hora, e o servidor pode estar em qualquer
// lugar. Por isso ele entra por configuracao e nunca e' lido do relogio local.
//
// Sem biblioteca: `Intl.DateTimeFormat` com `timeZone` ja vive dentro do Node e
// conhece horario de verao. E' o que tem que ser usado.
import { config } from './config.js'

// Falha na partida, e nao na primeira consulta do dia: um nome de fuso errado
// e' erro de implantacao, e erro de implantacao tem que aparecer antes de
// alguem depender da resposta.
function conferirFuso(fuso) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(new Date())
    return fuso
  } catch {
    throw new Error(
      `MYLOG_FUSO invalido: "${fuso}". Use um nome IANA, por exemplo America/Sao_Paulo.`)
  }
}

const FUSO = conferirFuso(config.fuso)

const FORMATO = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
})

function camposDoFuso(instante) {
  const p = {}
  for (const parte of FORMATO.formatToParts(instante)) {
    if (parte.type !== 'literal') p[parte.type] = Number(parte.value)
  }
  return p
}

// Quanto o relogio da operacao esta adiantado em relacao ao UTC neste instante.
// Positivo a leste de Greenwich. Muda no horario de verao — por isso e' medido
// por instante, e nunca guardado como constante.
function deslocamento(instante) {
  const c = camposDoFuso(instante)
  const comoSeFosseUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second)
  return comoSeFosseUtc - Math.floor(instante.getTime() / 1000) * 1000
}

// ------------------------------------------------------------- leitura

export const fusoDaOperacao = FUSO

export function partesLocais(instante = new Date()) {
  const c = camposDoFuso(instante)
  return {
    ano: c.year, mes: c.month, dia: c.day,
    hora: c.hour, minuto: c.minute, segundo: c.second,
    // O dia da semana e' propriedade da data do calendario, nao do fuso: com
    // ano/mes/dia ja resolvidos, `getUTCDay` responde sem depender de locale.
    diaSemana: new Date(Date.UTC(c.year, c.month - 1, c.day)).getUTCDay(),
  }
}

const pad = (n) => String(n).padStart(2, '0')

// AAAA-MM-DD do dia que esta acontecendo na operacao.
export function diaLocal(instante = new Date()) {
  const { ano, mes, dia } = partesLocais(instante)
  return `${ano}-${pad(mes)}-${pad(dia)}`
}

// Minutos desde a meia-noite da operacao. E' com isso que o horario limite
// compara — nunca com um `Date`, que carregaria o fuso de quem o criou.
export function minutosLocais(instante = new Date()) {
  const { hora, minuto } = partesLocais(instante)
  return hora * 60 + minuto
}

// Dia da semana de uma data escrita (AAAA-MM-DD). Nao passa por fuso nenhum:
// a segunda-feira do dia 07 e' segunda em qualquer lugar do mundo.
export function diaSemanaDe(diaIso) {
  const [ano, mes, dia] = String(diaIso).split('-').map(Number)
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()
}

// ------------------------------------------------------------- escrita

// O instante UTC em que comeca (ou termina) um dia da operacao. E' o que vai
// para o `WHERE ... BETWEEN`, porque o banco guarda UTC e a pergunta e' local.
//
// Duas passadas de proposito: a primeira estima o deslocamento pelo palpite, a
// segunda corrige o caso em que o palpite caiu do outro lado de uma virada de
// horario de verao.
export function bordaDoDia(diaIso, fim = false) {
  const [ano, mes, dia] = String(diaIso).split('-').map(Number)
  const alvo = fim
    ? Date.UTC(ano, mes - 1, dia, 23, 59, 59, 999)
    : Date.UTC(ano, mes - 1, dia, 0, 0, 0, 0)

  let utc = alvo - deslocamento(new Date(alvo))
  utc = alvo - deslocamento(new Date(utc))
  return new Date(utc).toISOString()
}

// DD/MM/AAAA HH:MM na hora da operacao. Relatorio impresso e' lido no patio.
export function dataHoraLocal(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const { ano, mes, dia, hora, minuto } = partesLocais(d)
  return `${pad(dia)}/${pad(mes)}/${ano} ${pad(hora)}:${pad(minuto)}`
}
