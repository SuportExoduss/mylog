// Painel de supervisao (roadmap 7). O lider abre e ve o que exige acao.
import { api } from './api.js'
import {
  elemento, cabecalhoTela, selo, numero, vazio,
  ROTULO_STATUS_VEICULO, TOM_STATUS_VEICULO,
  ROTULO_STATUS_PREVENTIVA, TOM_STATUS_PREVENTIVA,
  ROTULO_STATUS_USUARIO, TOM_STATUS_USUARIO,
  ROTULO_PRIORIDADE, TOM_PRIORIDADE,
  ORDEM_STATUS_VEICULO, ORDEM_PRIORIDADE, ORDEM_STATUS_PREVENTIVA, ORDEM_STATUS_USUARIO,
} from './ui.js'

function card(titulo, valor, detalhes = [], aoClick) {
  return elemento('div', {
    classe: aoClick ? 'card clicavel' : 'card',
    aoClick,
  }, [
    elemento('div', { classe: 'card-titulo', texto: titulo }),
    elemento('div', { classe: 'card-numero', texto: numero(valor) }),
    detalhes.length ? elemento('div', { classe: 'card-detalhe' }, detalhes) : null,
  ])
}

// Um selo solto que leva a algum lugar. `selosDe` monta os que vem de um mapa
// de contagens; este e' para os avulsos, que tambem precisam levar.
function seloQueLeva(texto, tom, titulo, ir) {
  const etiqueta = selo(texto, tom)
  etiqueta.classList.add('clicavel')
  etiqueta.setAttribute('role', 'button')
  etiqueta.setAttribute('tabindex', '0')
  etiqueta.setAttribute('title', titulo)
  const abrir = (evento) => { evento.stopPropagation(); ir() }
  etiqueta.addEventListener('click', abrir)
  etiqueta.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); abrir(evento) }
  })
  return etiqueta
}

// Esconde o que estiver zerado: o painel mostra problema, nao tabela cheia.
//
// Cada selo leva a lista JA FILTRADA por aquele status. As telas de destino
// sempre souberam ler o filtro de `contexto.parametros.status`; era o painel
// que nunca mandava, entao "3 bloqueados" abria a frota inteira e a pessoa
// tinha que procurar os tres de novo.
function selosDe(mapa, rotulos, tons, ordem, ir) {
  return ordem
    .filter((chave) => (mapa[chave] || 0) > 0)
    .map((chave) => {
      const etiqueta = selo(`${mapa[chave]} ${rotulos[chave].toLowerCase()}`, tons[chave])
      if (!ir) return etiqueta
      etiqueta.classList.add('clicavel')
      etiqueta.setAttribute('role', 'button')
      etiqueta.setAttribute('tabindex', '0')
      etiqueta.setAttribute('title', `Ver so: ${rotulos[chave].toLowerCase()}`)
      // O clique no selo nao pode disparar tambem o do card, que abriria a
      // lista inteira por cima da filtrada.
      const abrir = (evento) => { evento.stopPropagation(); ir(chave) }
      etiqueta.addEventListener('click', abrir)
      // `role=button` sem teclado e' pior que nenhum: o leitor de tela anuncia
      // um botao que nao responde ao Enter.
      etiqueta.addEventListener('keydown', (evento) => {
        if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); abrir(evento) }
      })
      return etiqueta
    })
}

export async function telaPainel(raiz, contexto) {
  const dados = await api.painel()
  const cards = []

  cards.push(card('Frota', dados.frota.total, selosDe(
    dados.frota.por_status, ROTULO_STATUS_VEICULO, TOM_STATUS_VEICULO,
    ORDEM_STATUS_VEICULO,
    (status) => contexto.irPara('veiculos', { status }),
  ), () => contexto.irPara('veiculos')))

  // O clique leva ao que o NUMERO conta. O cartao diz "pendentes" e mostra a
  // contagem de pendentes; abrir a lista inteira obrigava a procurar de novo os
  // mesmos registros que o cartao acabou de contar.
  cards.push(card('Solicitacoes pendentes', dados.solicitacoes.pendentes, [
    dados.solicitacoes.em_uso > 0
      ? seloQueLeva(`${dados.solicitacoes.em_uso} em uso`, 's-alerta',
        'Ver so: em uso', () => contexto.irPara('solicitacoes', { status: 'em_uso' }))
      : null,
    // Atraso nao e' status proprio — e' um `em_uso` com a janela vencida. O selo
    // leva para os em uso, que e' onde a linha atrasada esta, marcada.
    dados.solicitacoes.atrasadas > 0
      ? seloQueLeva(`${dados.solicitacoes.atrasadas} devolucao atrasada`, 's-critico',
        'Ver os veiculos na rua', () => contexto.irPara('solicitacoes', { status: 'em_uso' }))
      : null,
  ].filter(Boolean), () => contexto.irPara('solicitacoes', { status: 'pendente' })))

  // Este era o unico cartao sem destino: mostrava o numero do dia e nao abria
  // nada. A tela de Checklists feitos ja nasce com o periodo em hoje, entao o
  // destino e' ela, sem parametro.
  cards.push(card('Checklists hoje', dados.checklists.hoje, [
    dados.checklists.veiculos_em_uso > 0
      ? seloQueLeva(`${dados.checklists.veiculos_em_uso} veiculo(s) na rua`, 's-marca',
        'Ver os veiculos na rua', () => contexto.irPara('solicitacoes', { status: 'em_uso' }))
      : selo('nenhum veiculo fora', 's-ok'),
  ], () => contexto.irPara('execucoes')))

  cards.push(card('Ocorrencias abertas', dados.ocorrencias.abertas, selosDe(
    dados.ocorrencias.por_prioridade, ROTULO_PRIORIDADE, TOM_PRIORIDADE,
    ORDEM_PRIORIDADE,
    // Prioridade, nao status: e' o filtro que a tela de ocorrencias tem para
    // esta contagem.
    (prioridade) => contexto.irPara('ocorrencias', { prioridade }),
  ), () => contexto.irPara('ocorrencias', { status: 'em_aberto' })))

  const prev = dados.preventivas.por_status
  cards.push(card('Preventivas vencidas', prev.vencida || 0, selosDe(
    prev, ROTULO_STATUS_PREVENTIVA, TOM_STATUS_PREVENTIVA,
    ORDEM_STATUS_PREVENTIVA,
    (status) => contexto.irPara('preventivas', { status }),
  ), () => contexto.irPara('preventivas', { status: 'vencida' })))

  cards.push(card('Usuarios', Object.values(dados.usuarios.por_status).reduce((a, b) => a + b, 0),
    selosDe(dados.usuarios.por_status, ROTULO_STATUS_USUARIO, TOM_STATUS_USUARIO,
      ORDEM_STATUS_USUARIO,
      (status) => contexto.irPara('usuarios', { status })),
    () => contexto.irPara('usuarios')))

  const alertas = dados.alertas.length
    ? elemento('div', { classe: 'fila' }, dados.alertas.map((alerta) =>
        elemento('div', {
          classe: `fila-item fila-item--${alerta.nivel} clicavel`,
          // Clicar no alerta leva a tela que resolve o alerta.
          // O destino vem do servidor, que e' quem monta o alerta. Havia um
          // mapa aqui, por `tipo`, e ele nao tinha 'checklist': o aviso de
          // quem nao fez o checklist do dia caia no `|| 'painel'` e o clique
          // recarregava a mesma tela. Duas fontes de verdade para a mesma
          // pergunta, e a que o usuario via era a errada.
          aoClick: () => contexto.irPara(alerta.destino || 'painel'),
        }, [
          selo(alerta.tipo, alerta.nivel === 'critico' ? 's-critico' : 's-atencao'),
          elemento('div', { classe: 'fila-texto', texto: alerta.texto }),
        ])))
    : vazio('Nenhum alerta em aberto. A frota esta em dia.')

  raiz.append(
    cabecalhoTela({
      titulo: `Bom dia, ${contexto.usuario.nome.split(' ')[0]}`,
      descricao: 'Panorama da frota e o que exige acao agora.',
      acoes: [elemento('a', {
        classe: 'botao botao--suave', href: '/relatorio/frota', target: '_blank',
        texto: 'Relatorio da frota',
      })],
    }),
    elemento('div', { classe: 'grade' }, cards),
    elemento('section', { classe: 'secao' }, [
      elemento('div', { classe: 'secao-titulo' }, [elemento('h2', { texto: 'Fila de acao' })]),
      alertas,
    ]),
  )
}
