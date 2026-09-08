// White label (roadmap 7).
//
// Personalizacao por empresa com CO-BRANDING OBRIGATORIO: a marca MyLog
// permanece ao lado da marca do contratante. Nao ha campo para desligar isso,
// e por isso nao ha caminho — a ausencia do campo e' a garantia.
//
// Nada de CSS, HTML ou script vindo do tenant. O que entra e' cor `#rrggbb`
// numa lista fechada de tokens, declarada em compartilhado/marca.js e validada
// LA — o mesmo arquivo que o painel usa para avisar antes de publicar. Duas
// implementacoes divergiriam no dia seguinte.
import { consultarUm, executar, transacao, agora } from '../nucleo/banco.js'
import { erro } from '../nucleo/http.js'
import { registrarEvento } from '../nucleo/auditoria.js'
import { exigirAutenticado } from '../seguranca/sessao.js'
import { exigirFrota } from '../seguranca/nivel.js'
import {
  LIMITE_BYTES, apagar, caminhoDeLogo, gravar, ler, tipoRealDe,
} from '../nucleo/storage.js'
import {
  TEMAS, conferirMarca, limparNome, limparTokens, tokensEfetivos,
} from '../../../compartilhado/marca.js'

const VAZIA = {
  nome_exibicao: null, logo_caminho: null, logo_mime: null,
  tokens_claro: '{}', tokens_escuro: '{}',
}

function lerJson(texto) {
  try { return JSON.parse(texto || '{}') } catch { return {} }
}

function bruta(empresaId) {
  return consultarUm('SELECT * FROM marcas WHERE empresa_id = ?', [empresaId]) || VAZIA
}

// A marca como o cliente precisa dela: tokens JA MESCLADOS com o padrao MyLog,
// por tema. Quem consome pinta o que recebe, sem saber o que e' padrao e o que
// e' da empresa — e sem precisar de uma copia da tabela de padroes.
export function marcaDaEmpresa(empresaId) {
  const m = bruta(empresaId)
  return {
    nome_exibicao: m.nome_exibicao || null,
    // A URL e derivada do caminho, nunca guardada: o caminho no disco e' assunto
    // do servidor, e o cliente so precisa de um endereco que passe pela sessao.
    logo_url: m.logo_caminho ? `/imagens/marca/${empresaId}` : null,
    tokens: {
      claro: tokensEfetivos(lerJson(m.tokens_claro), 'claro'),
      escuro: tokensEfetivos(lerJson(m.tokens_escuro), 'escuro'),
    },
  }
}

// O que a tela de configuracao edita: o que a EMPRESA definiu, sem mesclar.
// Mesclar aqui apagaria a diferenca entre "escolhi branco" e "nao escolhi", e
// e' essa diferenca que faz o botao "voltar ao padrao MyLog" ter sentido.
function paraEdicao(empresaId) {
  const m = bruta(empresaId)
  return {
    nome_exibicao: m.nome_exibicao || null,
    logo_url: m.logo_caminho ? `/imagens/marca/${empresaId}` : null,
    definidos: {
      claro: lerJson(m.tokens_claro),
      escuro: lerJson(m.tokens_escuro),
    },
    efetivos: {
      claro: tokensEfetivos(lerJson(m.tokens_claro), 'claro'),
      escuro: tokensEfetivos(lerJson(m.tokens_escuro), 'escuro'),
    },
  }
}

// O retrato que vai para a auditoria. Guarda o que MUDOU, e nao que mudou
// (D53): sem isto o evento diria "marca.publicada" e nada mais, e a pergunta
// que alguem faz meses depois — "quem deixou o botao ilegivel?" — ficaria sem
// resposta.
function retrato(empresaId) {
  const m = bruta(empresaId)
  return {
    nome_exibicao: m.nome_exibicao || null,
    tem_logo: Boolean(m.logo_caminho),
    tokens_claro: lerJson(m.tokens_claro),
    tokens_escuro: lerJson(m.tokens_escuro),
  }
}

function garantirLinha(empresaId, ator) {
  const existe = consultarUm('SELECT empresa_id FROM marcas WHERE empresa_id = ?', [empresaId])
  if (existe) return
  executar(
    `INSERT INTO marcas (empresa_id, tokens_claro, tokens_escuro, atualizado_em, atualizado_por)
     VALUES (?, '{}', '{}', ?, ?)`,
    [empresaId, agora(), ator?.id || null])
}

export function registrarRotasMarca(rotas) {
  // ------------------------------------------------------------------ leitura
  rotas.get('/api/marca', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const edicao = paraEdicao(eu.empresa_id)
    return {
      marca: edicao,
      // A conferencia acompanha a leitura: quem abre a tela ja ve se a marca
      // que esta no ar hoje passa no contraste. Uma marca pode ter sido
      // publicada antes de uma regra apertar.
      contraste: conferirMarca({
        tokens_claro: edicao.definidos.claro,
        tokens_escuro: edicao.definidos.escuro,
      }),
    }
  })

  // ------------------------------------------------------------------ escrita
  rotas.put('/api/marca', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const corpo = ctx.corpo || {}

    // PUT parcial: o que nao vier fica como esta. Trocar so a cor do tema
    // escuro nao pode apagar o nome de exibicao.
    const antes = retrato(eu.empresa_id)

    const nome = 'nome_exibicao' in corpo ? limparNome(corpo.nome_exibicao) : antes.nome_exibicao

    const recusadas = []
    const tokens = {}
    for (const tema of TEMAS) {
      const campo = `tokens_${tema}`
      if (!(campo in corpo)) { tokens[tema] = antes[campo]; continue }
      // `null` e o pedido explicito de voltar ao padrao MyLog daquele tema —
      // e de UM tema so, que e' o que o roadmap 7 promete.
      if (corpo[campo] === null) { tokens[tema] = {}; continue }
      const limpo = limparTokens(corpo[campo])
      tokens[tema] = limpo.tokens
      recusadas.push(...limpo.recusadas.map((r) => ({ ...r, tema })))
    }

    // O contraste e' conferido AQUI, no servidor, e nao so na tela. A tela
    // avisa enquanto a pessoa escolhe; o servidor decide. Um cliente
    // desatualizado, ou um `curl`, nao pode deixar o painel ilegivel.
    const conferencia = conferirMarca({
      tokens_claro: tokens.claro, tokens_escuro: tokens.escuro,
    })
    if (!conferencia.ok) {
      const ruins = TEMAS.flatMap((t) => conferencia.temas[t].pares
        .filter((p) => !p.ok)
        .map((p) => `${t}: ${p.mensagem}`))
      throw erro.requisicao(
        `Contraste insuficiente — a marca ficaria ilegivel. ${ruins.join(' ')}`)
    }

    // Atomica: nome e os dois temas mudam juntos ou nao mudam. Publicar meia
    // marca deixaria o painel com a cor nova e o nome velho.
    transacao(() => {
      garantirLinha(eu.empresa_id, eu)
      executar(
        `UPDATE marcas SET nome_exibicao = ?, tokens_claro = ?, tokens_escuro = ?,
                atualizado_em = ?, atualizado_por = ?
          WHERE empresa_id = ?`,
        [nome, JSON.stringify(tokens.claro), JSON.stringify(tokens.escuro),
          agora(), eu.id, eu.empresa_id])
    })

    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'marca.publicada',
      entidade: 'marca', entidadeId: eu.empresa_id,
      antes, depois: retrato(eu.empresa_id), ip: ctx.ip,
    })

    return { marca: paraEdicao(eu.empresa_id), contraste: conferencia, recusadas }
  })

  // --------------------------------------------------------------------- logo
  rotas.post('/api/marca/logo', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))

    const base64 = String(ctx.corpo?.conteudo || '').replace(/^data:[^,]+,/, '')
    if (!base64) throw erro.requisicao('Imagem vazia.')
    const buffer = Buffer.from(base64, 'base64')
    if (!buffer.length) throw erro.requisicao('Imagem ilegivel.')
    if (buffer.length > LIMITE_BYTES) {
      throw erro.requisicao(`Imagem acima do limite de ${Math.round(LIMITE_BYTES / 1024 / 1024)} MB.`)
    }

    // O tipo sai dos bytes, nao do que o navegador declarou (D38). Um SVG
    // seria pior que inutil aqui: SVG carrega script, e a logo e' servida
    // dentro do painel.
    const mime = tipoRealDe(buffer)
    if (!mime) throw erro.requisicao('Envie uma imagem JPEG, PNG ou WebP.')

    const antes = retrato(eu.empresa_id)
    const anterior = bruta(eu.empresa_id).logo_caminho

    // ORDEM IMPORTA, e e' a regra da arquitetura: "upload que falha nao pode
    // deixar a empresa sem logo valida".
    //
    // Grava o arquivo NOVO (nome sorteado, nunca o mesmo do anterior), depois
    // aponta o banco para ele, e so entao apaga o antigo. Se a gravacao
    // falhar, o banco segue apontando para a logo que funciona. Se o banco
    // falhar, sobra um arquivo orfao — que e' o lado barato de errar.
    const caminho = caminhoDeLogo({ empresaId: eu.empresa_id, mime })
    gravar(caminho, buffer)

    transacao(() => {
      garantirLinha(eu.empresa_id, eu)
      executar(
        `UPDATE marcas SET logo_caminho = ?, logo_mime = ?, atualizado_em = ?, atualizado_por = ?
          WHERE empresa_id = ?`,
        [caminho, mime, agora(), eu.id, eu.empresa_id])
    })

    if (anterior && anterior !== caminho) apagar(anterior)

    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'marca.logo',
      entidade: 'marca', entidadeId: eu.empresa_id,
      antes, depois: { ...retrato(eu.empresa_id), bytes: buffer.length, tipo: mime },
      ip: ctx.ip,
    })

    return { marca: paraEdicao(eu.empresa_id) }
  })

  rotas.delete('/api/marca/logo', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const antes = retrato(eu.empresa_id)
    const atual = bruta(eu.empresa_id).logo_caminho
    if (!atual) throw erro.naoEncontrado('Esta empresa nao tem logo.')

    transacao(() => {
      executar(
        `UPDATE marcas SET logo_caminho = NULL, logo_mime = NULL,
                atualizado_em = ?, atualizado_por = ? WHERE empresa_id = ?`,
        [agora(), eu.id, eu.empresa_id])
    })
    apagar(atual)

    registrarEvento({
      empresaId: eu.empresa_id, ator: eu, acao: 'marca.logo_removida',
      entidade: 'marca', entidadeId: eu.empresa_id,
      antes, depois: retrato(eu.empresa_id), ip: ctx.ip,
    })

    // Sem logo o painel mostra so o MyLog — que continua ali de qualquer jeito.
    return { marca: paraEdicao(eu.empresa_id) }
  })

  // Servir a logo passa por sessao e por tenant, como qualquer dado desta casa.
  //
  // O `:empresa` da URL NAO escolhe o que sera servido: quem escolhe e' a
  // sessao. Ele existe para a URL mudar quando a empresa muda, e nada mais —
  // pedir a logo da empresa de outra pessoa devolve a sua propria... nao:
  // devolve 404, porque devolver a sua seria confirmar que a outra existe.
  rotas.get('/imagens/marca/:empresa', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    if (ctx.params.empresa !== eu.empresa_id) {
      throw erro.naoEncontrado('Logo nao encontrada.')
    }
    const m = bruta(eu.empresa_id)
    if (!m.logo_caminho) throw erro.naoEncontrado('Logo nao encontrada.')
    const conteudo = ler(m.logo_caminho)
    if (!conteudo) throw erro.naoEncontrado('Logo nao encontrada.')

    ctx.res.writeHead(200, {
      'content-type': m.logo_mime || 'application/octet-stream',
      'content-length': conteudo.length,
      // Curta, e ao contrario da imagem de modelo. La o nome do arquivo e'
      // sorteado e o modelo publicado e' imutavel, entao um dia de cache nao
      // serve a foto errada. Aqui o endereco e' FIXO por empresa: trocar a
      // logo nao muda a URL, e um cache longo deixaria a marca antiga na tela
      // de quem acabou de publicar a nova.
      'cache-control': 'private, max-age=60',
    })
    ctx.res.end(conteudo)
  })
}
