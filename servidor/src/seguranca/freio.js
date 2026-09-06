// Freio de tentativas repetidas.
//
// Existia dentro da rota de login, contando por email+ip. Cobria o ataque mais
// obvio — martelar a senha de UMA pessoa — e deixava passar tres outros:
//
//   1. Espalhar uma senha por muitos emails a partir do mesmo lugar. Oito
//      tentativas por email vezes mil emails sao oito mil tentativas, e nenhuma
//      delas cruza o limite. E' a forma do ataque de credencial vazada.
//   2. A troca de senha, que pede a senha ATUAL e nao tinha freio nenhum. Quem
//      pega uma sessao aberta adivinha a senha atual a vontade e assume a conta.
//   3. O proprio mapa: uma chave por email tentado, sem nunca limpar, e' um
//      vazamento de memoria a disposicao de quem quiser gastar a maquina.
//
// Memoria do processo, de proposito: aqui o servidor e' um so. Quando virar
// Cloud Functions, cada instancia teria a propria contagem e o freio afrouxaria
// na proporcao do numero de instancias — a contagem precisa mudar de lugar
// junto com o servidor. Esta anotado em docs/ARQUITETURA.md.
import { erro } from '../nucleo/http.js'

export const JANELA_MS = 15 * 60 * 1000

// Quanto cada frente aguenta na janela.
export const LIMITES = {
  // Uma pessoa erra a propria senha algumas vezes; oito e' folgado para quem
  // digita de luva, no patio, e apertado para quem esta chutando.
  login: 8,
  // EMAILS DISTINTOS que falharam a partir do mesmo lugar — nao o total de
  // falhas. A diferenca e' o que separa uma frota inteira atras de um NAT, onde
  // quarenta pessoas erram a propria senha na segunda de manha, de uma varredura
  // de credenciais vazadas, que e' sempre muitos emails e uma senha so.
  loginPorIp: 15,
  // Trocar a propria senha exige acertar a atual. Cinco erros e' engano; o
  // sexto, em quinze minutos, e' outra coisa.
  senha: 5,
}

const TETO_CHAVES = 20_000

const marcas = new Map()

function expirada(registro, agora) {
  return agora - registro.desde > JANELA_MS
}

// Varre o que ja venceu. Chamada so quando o mapa cresce, para nao pagar a
// varredura em toda tentativa.
function podar(agora) {
  for (const [chave, registro] of marcas) {
    if (expirada(registro, agora)) marcas.delete(chave)
  }
  // Se ainda assim estourou, e' ataque em andamento: os mais antigos saem, e o
  // freio continua valendo para quem esta batendo agora.
  if (marcas.size > TETO_CHAVES) {
    const sobrando = [...marcas.entries()]
      .sort((a, b) => a[1].desde - b[1].desde)
      .slice(0, marcas.size - TETO_CHAVES)
    for (const [chave] of sobrando) marcas.delete(chave)
  }
}

// Levanta 429 quando a chave estourou o limite. A mensagem diz quanto falta:
// "tente de novo mais tarde" faz a pessoa tentar de novo agora.
export function conferirFreio(chave, limite) {
  const registro = marcas.get(chave)
  if (!registro) return
  const agora = Date.now()
  if (expirada(registro, agora)) { marcas.delete(chave); return }
  if (registro.contagem < limite) return

  const faltamMs = JANELA_MS - (agora - registro.desde)
  const minutos = Math.max(1, Math.ceil(faltamMs / 60000))
  throw erro.excedeu(
    `Muitas tentativas. Tente de novo em ${minutos} minuto${minutos > 1 ? 's' : ''}.`)
}

export function contarFalha(chave) {
  const agora = Date.now()
  const registro = marcas.get(chave)
  if (!registro || expirada(registro, agora)) {
    marcas.set(chave, { contagem: 1, desde: agora })
  } else {
    registro.contagem += 1
  }
  if (marcas.size > TETO_CHAVES) podar(agora)
}

// Conta ALVOS distintos, nao tentativas. A mesma pessoa errando a propria senha
// dez vezes conta um; dez pessoas diferentes contam dez.
export function contarAlvo(chave, alvo) {
  const agora = Date.now()
  let registro = marcas.get(chave)
  if (!registro || expirada(registro, agora)) {
    registro = { contagem: 0, desde: agora, alvos: new Set() }
    marcas.set(chave, registro)
  }
  if (!registro.alvos) registro.alvos = new Set()
  registro.alvos.add(alvo)
  registro.contagem = registro.alvos.size
  if (marcas.size > TETO_CHAVES) podar(agora)
}

// Acertou: a contagem daquela pessoa zera. Sem isto, quem errou sete vezes e
// acertou na oitava continuaria a um erro do bloqueio pelos quinze minutos
// seguintes.
export function limparFreio(chave) {
  marcas.delete(chave)
}

// So para teste: cada arquivo de teste comeca com o freio solto.
export function zerarFreio() {
  marcas.clear()
}
