// A marca da empresa (roadmap 7 — White Label).
//
// Como `template.js` e `contraste.js`, este arquivo e importado pelo SERVIDOR e
// servido ao NAVEGADOR. Quem valida de verdade e' o servidor; o painel usa o
// mesmo codigo para avisar enquanto a pessoa escolhe a cor, em vez de deixar
// ela descobrir no "Publicar".
//
// TRES REGRAS DA ARQUITETURA, e nenhuma delas e' negociavel aqui:
//
// 1. CO-BRANDING OBRIGATORIO. A marca MyLog permanece ao lado da marca do
//    contratante. Nao existe campo para desligar isso, e por isso nao existe
//    caminho para desliga-lo — a ausencia do campo E' a garantia.
//
// 2. TOKENS SEMANTICOS, NUNCA CSS LIVRE. Nada de HTML, JavaScript ou folha de
//    estilo vinda do tenant. O que entra e' uma cor `#rrggbb` por token de uma
//    lista fechada; qualquer outra chave e ignorada, e qualquer outro formato
//    e recusado.
//
// 3. BRANDING NAO TOCA EM REGRA, PERMISSAO, DADO NEM HISTORICO. Por isso as
//    cores de ESTADO ficam de fora da lista (ver COR_DE_ESTADO, abaixo).

import { AA_TEXTO, AA_GRANDE, conferirPar, normalizarCor } from './contraste.js'

// Os tokens que a empresa pode trocar. Lista fechada, e curta de proposito.
//
// Sao a familia da marca, e so ela: a cor que a empresa reconhece como sua, o
// tom escuro para pressionado/hover, a tinta clara de destaque e a cor do texto
// que fica EM CIMA da marca. Com esses quatro, o painel inteiro veste a
// empresa, porque tudo que e' "acao principal" no design system deriva deles.
export const TOKENS = [
  {
    chave: 'marca',
    rotulo: 'Cor da marca',
    dica: 'Botao principal, item ativo no menu, foco do teclado.',
    padraoClaro: '#35539f',   // --marca-600
    padraoEscuro: '#6f8fd6',  // --marca-400
  },
  {
    chave: 'marca-forte',
    rotulo: 'Marca pressionada',
    // No claro ela e' mais ESCURA que a marca; no escuro, mais CLARA. Nos dois
    // casos o movimento e' o mesmo — afastar-se do fundo — e por isso o padrao
    // dos dois temas nao e' o mesmo tom.
    dica: 'O tom que aparece ao apertar o botao.',
    padraoClaro: '#2a4180',   // --marca-700
    padraoEscuro: '#9db3e4',  // --marca-300
  },
  {
    chave: 'marca-tinta',
    rotulo: 'Tinta da marca',
    dica: 'Fundo suave de destaque: selo, linha selecionada, anel de foco.',
    padraoClaro: '#e9eef9',   // --marca-tinta-clara
    padraoEscuro: '#1a2545',  // --marca-tinta-escura
  },
  {
    chave: 'marca-contraste',
    rotulo: 'Texto sobre a marca',
    // No escuro NAO e' branco: a marca clara do tema escuro com texto branco
    // em cima da 3.1:1, abaixo do piso de 4.5:1. O tema MyLog usa quase-preto
    // ali, e o padrao aqui tem que ser o tema de verdade — senao a primeira
    // coisa que a conferencia faz e' reprovar o proprio MyLog.
    dica: 'A cor do texto dentro do botao principal. Branco no claro, quase-preto no escuro.',
    padraoClaro: '#ffffff',   // --n-0
    padraoEscuro: '#0e131a',  // --n-950
  },
]

export const CHAVES = TOKENS.map((t) => t.chave)

// O que NAO entra, e por que.
//
// As cores de estado — ok, atencao, alerta, critico — carregam SIGNIFICADO
// neste sistema, e nao identidade. Vermelho quer dizer "ocorrencia critica,
// veiculo bloqueado" em toda tela, todo relatorio impresso e todo dossie de
// sinistro. Uma empresa que pintasse "critico" de verde nao estaria mudando a
// aparencia: estaria mudando o que a tela AFIRMA, e quem le a tela e alguem
// decidindo se um caminhao sai ou nao.
//
// A arquitetura ja diz que branding nao toca em regra. Cor de estado e' regra
// vestida de cor.
export const COR_DE_ESTADO = ['ok', 'atencao', 'alerta', 'critico']

export const TEMAS = ['claro', 'escuro']

export function padraoDoTema(tema) {
  const campo = tema === 'escuro' ? 'padraoEscuro' : 'padraoClaro'
  return Object.fromEntries(TOKENS.map((t) => [t.chave, t[campo]]))
}

// Completa o que a empresa nao definiu com o padrao MyLog.
//
// Cada tema volta ao padrao SOZINHO (roadmap 7): uma empresa pode personalizar
// so o claro e deixar o escuro como veio. Por isso a mescla e' por tema, e um
// tema vazio nao arrasta o outro.
export function tokensEfetivos(guardado, tema) {
  const padrao = padraoDoTema(tema)
  const meus = guardado && typeof guardado === 'object' ? guardado : {}
  const saida = { ...padrao }
  for (const chave of CHAVES) {
    const cor = normalizarCor(meus[chave])
    if (cor) saida[chave] = cor
  }
  return saida
}

// Limpa o que veio do cliente: so as chaves da lista, so cores validas.
//
// Devolve `{ tokens, recusadas }` — as recusadas voltam com nome para a tela
// poder dizer o que ignorou. Descartar em silencio ensina a pessoa a achar que
// salvou o que nao salvou.
export function limparTokens(bruto) {
  const tokens = {}
  const recusadas = []
  const entrada = bruto && typeof bruto === 'object' ? bruto : {}

  for (const [chave, valor] of Object.entries(entrada)) {
    if (!CHAVES.includes(chave)) {
      recusadas.push({
        chave,
        motivo: COR_DE_ESTADO.includes(chave)
          ? 'Cor de estado nao e personalizavel: ela diz o que a tela significa, nao como ela se parece.'
          : 'Token fora da lista permitida.',
      })
      continue
    }
    const cor = normalizarCor(valor)
    if (!cor) {
      recusadas.push({ chave, motivo: 'Cor invalida. Use #rrggbb.' })
      continue
    }
    tokens[chave] = cor
  }
  return { tokens, recusadas }
}

// O fundo sobre o qual a marca e a tinta sao vistas. Nao e' personalizavel —
// entra so como referencia da conferencia de contraste.
const FUNDO = { claro: '#ffffff', escuro: '#171d26' }
const TEXTO = { claro: '#171d26', escuro: '#f6f7f9' }

// Confere o tema inteiro, e diz o que esta ruim em portugues.
//
// Sao tres pares, e cada um existe por um motivo diferente:
//
//   marca x marca-contraste  — o texto DENTRO do botao principal. Se falhar,
//     o botao mais usado do painel fica ilegivel. Piso de texto: 4.5:1.
//   marca x fundo            — a borda do botao, o item ativo do menu, o anel
//     de foco. Componente de interface, nao texto: piso 3:1.
//   texto x marca-tinta      — a tinta e' FUNDO de selo e de linha
//     selecionada, e o texto por cima dela e' o texto normal da tela.
export function conferirTema(tokens, tema) {
  const t = tokensEfetivos(tokens, tema)
  const fundo = FUNDO[tema] || FUNDO.claro
  const texto = TEXTO[tema] || TEXTO.claro

  const pares = [
    conferirPar({
      frente: t['marca-contraste'], fundo: t.marca, minimo: AA_TEXTO,
      rotulo: 'Texto sobre a marca',
    }),
    conferirPar({
      frente: t.marca, fundo, minimo: AA_GRANDE,
      rotulo: 'Marca sobre o fundo da tela',
    }),
    conferirPar({
      frente: texto, fundo: t['marca-tinta'], minimo: AA_TEXTO,
      rotulo: 'Texto sobre a tinta da marca',
    }),
  ]

  return { ok: pares.every((p) => p.ok), pares }
}

export function conferirMarca(marca) {
  const porTema = {}
  for (const tema of TEMAS) {
    porTema[tema] = conferirTema(marca?.[`tokens_${tema}`], tema)
  }
  return { ok: TEMAS.every((t) => porTema[t].ok), temas: porTema }
}

// Nome de exibicao: o nome do contratante que aparece AO LADO do MyLog.
//
// Nao substitui o MyLog e nao aceita marcacao — o que entra e texto puro, e o
// limite existe porque isto vai num cabecalho de 236px de largura.
export const LIMITE_NOME = 32

export function limparNome(bruto) {
  const texto = String(bruto ?? '').replace(/\s+/g, ' ').trim()
  if (!texto) return null
  return texto.slice(0, LIMITE_NOME)
}
