// Contraste de cor, pela regra da WCAG 2.1.
//
// Mora em `compartilhado/` pelo mesmo motivo que `template.js`: o SERVIDOR
// precisa validar e o PAINEL precisa avisar enquanto a pessoa escolhe a cor.
// Duas implementacoes divergiriam no dia seguinte — a tela diria "contraste
// bom" e o servidor recusaria, ou pior, o contrario.
//
// O que isto existe para impedir: uma empresa personalizar a marca (roadmap 7)
// e deixar o proprio painel ilegivel — botao primario com texto que ninguem
// enxerga, aviso que some no fundo. Branding nao pode quebrar a operacao, e
// quem descobre que quebrou e' alguem no patio, no meio do turno.
//
// Sem dependencia, como todo o resto.

// AA para texto normal. E' o piso que a operacao usa em tudo.
export const AA_TEXTO = 4.5
// AA para texto grande (>=18.66px negrito ou >=24px) e para componentes de
// interface — a borda de um botao, o preenchimento de uma barra.
export const AA_GRANDE = 3

// Aceita '#abc', '#aabbcc' e '#aabbccdd' (o alfa e ignorado: contraste se mede
// sobre a cor final, e cor de marca com transparencia nao entra aqui).
export function lerHex(valor) {
  const texto = String(valor ?? '').trim()
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(texto)
  if (!m) return null
  let d = m[1]
  if (d.length === 3 || d.length === 4) d = [...d].map((c) => c + c).join('')
  return {
    r: parseInt(d.slice(0, 2), 16),
    g: parseInt(d.slice(2, 4), 16),
    b: parseInt(d.slice(4, 6), 16),
  }
}

export function ehCorValida(valor) {
  return lerHex(valor) !== null
}

// Normaliza para `#rrggbb` minusculo. E' esta forma que vai para o banco:
// guardar o que a pessoa digitou faria `#ABC` e `#aabbcc` virarem cores
// diferentes na comparacao da auditoria, sendo a mesma cor.
export function normalizarCor(valor) {
  const c = lerHex(valor)
  if (!c) return null
  const par = (n) => n.toString(16).padStart(2, '0')
  return `#${par(c.r)}${par(c.g)}${par(c.b)}`
}

// Luminancia relativa (WCAG 2.1, 1.4.3). A curva nao e' linear: o olho enxerga
// diferenca no escuro muito melhor que no claro, e a formula reflete isso.
function luminancia({ r, g, b }) {
  const canal = (v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)
}

// Razao de contraste entre duas cores, de 1 (iguais) a 21 (preto e branco).
// Devolve `null` quando alguma das duas nao e' cor — quem chama decide o que
// fazer com isso, e nunca recebe um numero inventado.
export function razaoDeContraste(corA, corB) {
  const a = lerHex(corA)
  const b = lerHex(corB)
  if (!a || !b) return null
  const la = luminancia(a)
  const lb = luminancia(b)
  const claro = Math.max(la, lb)
  const escuro = Math.min(la, lb)
  return (claro + 0.05) / (escuro + 0.05)
}

// Arredonda para baixo em uma casa: 4.49 nao pode virar "4.5 — passa".
export function arredondar(razao) {
  return Math.floor(razao * 10) / 10
}

// Um par de cores conferido, com o veredito pronto para virar mensagem.
//
// `minimo` e' AA_TEXTO ou AA_GRANDE conforme o que aquele par pinta. Quem
// chama diz qual, porque so quem chama sabe se aquilo e' texto ou moldura.
export function conferirPar({ frente, fundo, minimo = AA_TEXTO, rotulo }) {
  const razao = razaoDeContraste(frente, fundo)
  if (razao === null) {
    return { ok: false, rotulo, razao: null, minimo, mensagem: `${rotulo}: cor invalida.` }
  }
  const medido = arredondar(razao)
  return {
    ok: medido >= minimo,
    rotulo,
    razao: medido,
    minimo,
    mensagem: medido >= minimo
      ? `${rotulo}: ${medido}:1 — passa (minimo ${minimo}:1).`
      : `${rotulo}: ${medido}:1 — abaixo do minimo de ${minimo}:1.`,
  }
}
