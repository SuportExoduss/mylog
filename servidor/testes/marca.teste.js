// White label (roadmap 7): o motor de marca e o de contraste.
//
// Sao os dois arquivos de `compartilhado/` que o servidor e o painel usam
// IGUAIS. O que este arquivo prova nao e' cor bonita — e que uma empresa nao
// consegue, personalizando, deixar o proprio painel ilegivel, nem mudar o que
// a tela SIGNIFICA, nem tirar o MyLog de perto da marca dela.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  AA_GRANDE, AA_TEXTO, arredondar, ehCorValida, normalizarCor, razaoDeContraste,
} from '../../compartilhado/contraste.js'
import {
  CHAVES, COR_DE_ESTADO, LIMITE_NOME, TEMAS, TOKENS,
  conferirMarca, conferirTema, limparNome, limparTokens, padraoDoTema, tokensEfetivos,
} from '../../compartilhado/marca.js'

// ------------------------------------------------------------------ contraste

test('contraste: a razao bate com os valores conhecidos da WCAG', () => {
  // Preto sobre branco e' o teto da escala: 21:1. Nao ha par melhor.
  assert.equal(arredondar(razaoDeContraste('#000000', '#ffffff')), 21)
  // Cor igual a si mesma e' o piso: 1:1.
  assert.equal(arredondar(razaoDeContraste('#35539f', '#35539f')), 1)
  // A ordem nao muda nada: contraste e' entre as duas, nao de uma sobre a outra.
  assert.equal(
    razaoDeContraste('#35539f', '#ffffff'),
    razaoDeContraste('#ffffff', '#35539f'))
})

test('contraste: a marca padrao do MyLog passa nos proprios pisos', () => {
  // Se o padrao nao passasse, a regra seria impossivel de cumprir — e a
  // primeira coisa que a tela faria era recusar a si mesma.
  const claro = padraoDoTema('claro')
  const escuro = padraoDoTema('escuro')
  assert.ok(razaoDeContraste(claro['marca-contraste'], claro.marca) >= AA_TEXTO,
    'texto sobre o botao principal, tema claro')
  assert.ok(razaoDeContraste(escuro['marca-contraste'], escuro.marca) >= AA_TEXTO,
    'texto sobre o botao principal, tema escuro')
  assert.equal(conferirTema({}, 'claro').ok, true)
  assert.equal(conferirTema({}, 'escuro').ok, true)
})

test('contraste: cor invalida nao vira numero inventado', () => {
  // Devolver 0 ou 1 aqui faria a conferencia "passar" ou "reprovar" por
  // acidente. `null` obriga quem chama a decidir.
  assert.equal(razaoDeContraste('nao e cor', '#fff'), null)
  assert.equal(razaoDeContraste('#fff', 'javascript:alert(1)'), null)
  assert.equal(razaoDeContraste('#gg0000', '#fff'), null)
})

test('contraste: arredonda para BAIXO — 4.49 nao pode virar "passa"', () => {
  assert.equal(arredondar(4.49), 4.4)
  assert.equal(arredondar(4.999), 4.9)
  assert.equal(arredondar(3.0), 3)
})

test('cor: aceita as formas do navegador e devolve uma so', () => {
  assert.equal(normalizarCor('#ABC'), '#aabbcc')
  assert.equal(normalizarCor('abc'), '#aabbcc')
  assert.equal(normalizarCor('#AABBCC'), '#aabbcc')
  assert.equal(normalizarCor('#aabbccdd'), '#aabbcc', 'o alfa e ignorado')
  assert.equal(normalizarCor(''), null)
  assert.equal(normalizarCor(null), null)
  assert.equal(normalizarCor('rgb(1,2,3)'), null, 'so hex entra')
  assert.equal(ehCorValida('#fff'), true)
  assert.equal(ehCorValida('#ffff'), true)
  assert.equal(ehCorValida('#ff'), false)
})

// --------------------------------------------------------------- so tokens

test('marca: chave fora da lista nao entra, e volta dizendo por que', () => {
  // Isto e' a barreira contra CSS livre. Sem ela, "personalizar a marca" viraria
  // "injetar estilo", e estilo vindo do tenant e' o comeco de script vindo do
  // tenant.
  const { tokens, recusadas } = limparTokens({
    marca: '#123456',
    'fundo-inventado': '#000000',
    'background-image': 'url(javascript:alert(1))',
  })
  assert.deepEqual(tokens, { marca: '#123456' })
  assert.equal(recusadas.length, 2)
  assert.ok(recusadas.every((r) => r.motivo), 'cada recusa diz o motivo')
})

test('marca: cor de estado NAO e personalizavel', () => {
  // Vermelho quer dizer "ocorrencia critica, veiculo bloqueado" em toda tela,
  // todo relatorio e todo dossie de sinistro. Uma empresa que pintasse
  // "critico" de verde nao estaria mudando a aparencia — estaria mudando o que
  // a tela AFIRMA, e quem le a tela decide se um caminhao sai ou nao.
  const entrada = Object.fromEntries(COR_DE_ESTADO.map((c) => [c, '#00ff00']))
  const { tokens, recusadas } = limparTokens(entrada)
  assert.deepEqual(tokens, {}, 'nenhuma cor de estado entrou')
  assert.equal(recusadas.length, COR_DE_ESTADO.length)
  for (const r of recusadas) {
    assert.match(r.motivo, /significa/i,
      'a recusa explica que e significado, e nao aparencia')
  }
  for (const c of COR_DE_ESTADO) {
    assert.equal(CHAVES.includes(c), false, `${c} nao pode estar na lista permitida`)
  }
})

test('marca: valor que nao e cor e recusado, e nao guardado cru', () => {
  const { tokens, recusadas } = limparTokens({
    marca: 'red; background: url(x)',
    'marca-forte': '#fff',
  })
  assert.deepEqual(tokens, { 'marca-forte': '#ffffff' })
  assert.equal(recusadas[0].chave, 'marca')
})

test('marca: o que a empresa nao definiu volta ao padrao MyLog', () => {
  const t = tokensEfetivos({ marca: '#112233' }, 'claro')
  assert.equal(t.marca, '#112233', 'o que ela definiu vale')
  assert.equal(t['marca-forte'], padraoDoTema('claro')['marca-forte'],
    'o resto vem do padrao')
  assert.deepEqual(Object.keys(t).sort(), [...CHAVES].sort(),
    'e o resultado tem sempre a lista completa — quem pinta nao precisa saber de padrao')
})

test('marca: cada tema volta ao padrao SOZINHO', () => {
  // O roadmap 7 promete isto com todas as letras. Um tema personalizado nao
  // pode arrastar o outro: quem so se importa com o claro deixa o escuro como
  // veio, e quem volta o claro ao padrao nao perde o escuro que ajustou.
  const claro = tokensEfetivos({ marca: '#112233' }, 'claro')
  const escuro = tokensEfetivos({}, 'escuro')
  assert.equal(claro.marca, '#112233')
  assert.equal(escuro.marca, padraoDoTema('escuro').marca)
  assert.notEqual(padraoDoTema('claro').marca, padraoDoTema('escuro').marca,
    'controle: os dois padroes sao mesmo diferentes')
})

test('marca: entrada que nao e objeto nao derruba nada', () => {
  for (const lixo of [null, undefined, 'texto', 42, []]) {
    assert.deepEqual(limparTokens(lixo).tokens, {})
    assert.deepEqual(tokensEfetivos(lixo, 'claro'), padraoDoTema('claro'))
  }
})

// -------------------------------------------------------------- contraste da marca

test('marca: marca ilegivel e reprovada, com o par nomeado', () => {
  // Amarelo claro com texto branco em cima: o botao mais usado do painel
  // ficaria invisivel.
  const r = conferirTema({ marca: '#ffee00', 'marca-contraste': '#ffffff' }, 'claro')
  assert.equal(r.ok, false)
  const ruim = r.pares.find((p) => !p.ok)
  assert.match(ruim.rotulo, /Texto sobre a marca/)
  assert.ok(ruim.razao < AA_TEXTO)
  assert.match(ruim.mensagem, /abaixo do minimo/)
})

test('marca: marca que some no fundo tambem e reprovada', () => {
  // Contraste bom DENTRO do botao nao basta: se a marca sumir no fundo da
  // tela, o proprio botao desaparece. Sao dois pares diferentes, e por isso a
  // conferencia tem os dois.
  const r = conferirTema({ marca: '#fdfdfd', 'marca-contraste': '#000000' }, 'claro')
  const dentro = r.pares.find((p) => /Texto sobre a marca/.test(p.rotulo))
  const fora = r.pares.find((p) => /fundo da tela/.test(p.rotulo))
  assert.equal(dentro.ok, true, 'preto sobre quase-branco passa dentro do botao')
  assert.equal(fora.ok, false, 'mas quase-branco sobre branco nao existe na tela')
  assert.equal(fora.minimo, AA_GRANDE, 'componente de interface usa o piso de 3:1')
  assert.equal(r.ok, false, 'um par ruim reprova o tema')
})

test('marca: a tinta e fundo de texto, e responde pelo piso de texto', () => {
  const r = conferirTema({ 'marca-tinta': '#3a3a3a' }, 'claro')
  const tinta = r.pares.find((p) => /tinta/.test(p.rotulo))
  assert.equal(tinta.minimo, AA_TEXTO)
  assert.equal(tinta.ok, false, 'texto escuro sobre tinta escura nao se le')
})

test('marca: os dois temas sao conferidos, e um ruim reprova o conjunto', () => {
  const r = conferirMarca({
    tokens_claro: {},
    tokens_escuro: { marca: '#ffffff', 'marca-contraste': '#fafafa' },
  })
  assert.equal(r.temas.claro.ok, true)
  assert.equal(r.temas.escuro.ok, false)
  assert.equal(r.ok, false)
  assert.deepEqual(Object.keys(r.temas).sort(), [...TEMAS].sort())
})

// -------------------------------------------------------------- nome ao lado

test('marca: o nome de exibicao e texto puro, aparado e limitado', () => {
  assert.equal(limparNome('  Transportes   Silva  '), 'Transportes Silva')
  assert.equal(limparNome(''), null)
  assert.equal(limparNome('   '), null)
  assert.equal(limparNome(null), null)
  assert.equal(limparNome('x'.repeat(200)).length, LIMITE_NOME,
    'o cabecalho tem 236px: nome sem limite empurra o MyLog para fora')
})

test('marca: nao existe caminho para tirar o MyLog do lado', () => {
  // Co-branding e' obrigatorio (arquitetura 7). A garantia nao e' uma
  // validacao que alguem pode afrouxar depois: e' a AUSENCIA do campo. Se um
  // dia alguem acrescentar `esconder_mylog`, este teste cai.
  const proibidas = ['esconder_mylog', 'ocultar_mylog', 'mylog', 'co_branding', 'somente_empresa']
  const { tokens } = limparTokens(Object.fromEntries(proibidas.map((p) => [p, '#000000'])))
  assert.deepEqual(tokens, {})
  for (const t of TOKENS) {
    assert.match(t.chave, /^marca(-|$)/,
      `todo token personalizavel e da familia da marca; "${t.chave}" nao e`)
  }
})

// ------------------------------------------------- o padrao E' o tema MyLog

test('marca: o padrao de cada token e a cor que o CSS realmente usa', () => {
  // A primeira versao destes padroes foi escrita de memoria, e errou dois:
  // `marca-contraste` no escuro (branco, quando o tema usa quase-preto) e
  // `marca-forte` no escuro (mais escura, quando o tema clareia). O primeiro
  // errado reprovava o proprio MyLog na conferencia de contraste.
  //
  // Uma lista copiada a mao apodrece. Esta le o CSS.
  const raiz = path.join(import.meta.dirname, '..', '..')
  const css = fs.readFileSync(path.join(raiz, 'web', 'css', 'estilo.css'), 'utf8')

  // Camada 1: as primitivas (--n-0, --marca-600...) com o hex delas.
  const primitiva = {}
  for (const m of css.matchAll(/^\s*(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8});/gm)) {
    primitiva[m[1]] = normalizarCor(m[2])
  }
  assert.ok(Object.keys(primitiva).length > 20,
    `varredura pobre das primitivas: ${Object.keys(primitiva).length}`)

  // Camada 2: os semanticos apontando para primitivas, dentro do bloco de
  // cada tema. O claro e' o `:root {` que abre a secao semantica; o escuro e'
  // o bloco da media query.
  function semanticosDe(trecho) {
    const saida = {}
    for (const m of trecho.matchAll(/^\s*--(marca[a-z-]*):\s*var\((--[a-z0-9-]+)\)/gm)) {
      saida[m[1]] = primitiva[m[2]]
    }
    return saida
  }

  const iSemantica = css.indexOf('2. SEMANTICA')
  assert.ok(iSemantica > 0, 'nao achei a secao semantica do CSS')
  const iEscuro = css.indexOf('prefers-color-scheme: dark', iSemantica)
  assert.ok(iEscuro > iSemantica, 'nao achei o bloco do tema escuro')

  const doClaro = semanticosDe(css.slice(iSemantica, iEscuro))
  const doEscuro = semanticosDe(css.slice(iEscuro, iEscuro + 2000))

  assert.ok(Object.keys(doClaro).length >= 4, `varredura pobre do claro: ${JSON.stringify(doClaro)}`)
  assert.ok(Object.keys(doEscuro).length >= 4, `varredura pobre do escuro: ${JSON.stringify(doEscuro)}`)

  for (const t of TOKENS) {
    assert.equal(normalizarCor(t.padraoClaro), doClaro[t.chave],
      `padrao claro de ${t.chave} nao e o que o CSS usa`)
    assert.equal(normalizarCor(t.padraoEscuro), doEscuro[t.chave],
      `padrao escuro de ${t.chave} nao e o que o CSS usa`)
  }
})
