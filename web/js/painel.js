// Painel de supervisao (roadmap 7). O lider abre e ve o que exige acao.
import { api } from './api.js'
import {
  elemento, cabecalhoTela, selo, numero, vazio,
  ROTULO_STATUS_VEICULO, TOM_STATUS_VEICULO,
  ROTULO_STATUS_PREVENTIVA, TOM_STATUS_PREVENTIVA,
  ROTULO_STATUS_USUARIO, TOM_STATUS_USUARIO,
  ROTULO_PRIORIDADE, TOM_PRIORIDADE,
} from './ui.js'

const DESTINO_ALERTA = {
  preventiva: 'preventivas', ocorrencia: 'ocorrencias', solicitacao: 'solicitacoes',
  usuario: 'usuarios', veiculo: 'veiculos',
}

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

// Esconde o que estiver zerado: o painel mostra problema, nao tabela cheia.
function selosDe(mapa, rotulos, tons, ordem) {
  return ordem
    .filter((chave) => (mapa[chave] || 0) > 0)
    .map((chave) => selo(`${mapa[chave]} ${rotulos[chave].toLowerCase()}`, tons[chave]))
}

export async function telaPainel(raiz, contexto) {
  const dados = await api.painel()
  const cards = []

  cards.push(card('Frota', dados.frota.total, selosDe(
    dados.frota.por_status, ROTULO_STATUS_VEICULO, TOM_STATUS_VEICULO,
    ['bloqueado', 'com_pendencia', 'manutencao', 'disponivel'],
  ), () => contexto.irPara('veiculos')))

  cards.push(card('Solicitacoes pendentes', dados.solicitacoes.pendentes, [
    dados.solicitacoes.em_uso > 0 ? selo(`${dados.solicitacoes.em_uso} em uso`, 's-alerta') : null,
    dados.solicitacoes.atrasadas > 0
      ? selo(`${dados.solicitacoes.atrasadas} devolucao atrasada`, 's-critico') : null,
  ].filter(Boolean), () => contexto.irPara('solicitacoes')))

  cards.push(card('Checklists hoje', dados.checklists.hoje, [
    dados.checklists.veiculos_em_uso > 0
      ? selo(`${dados.checklists.veiculos_em_uso} veiculo(s) na rua`, 's-marca')
      : selo('nenhum veiculo fora', 's-ok'),
  ]))

  cards.push(card('Ocorrencias abertas', dados.ocorrencias.abertas, selosDe(
    dados.ocorrencias.por_prioridade, ROTULO_PRIORIDADE, TOM_PRIORIDADE,
    ['critica', 'alta', 'media', 'baixa'],
  ), () => contexto.irPara('ocorrencias')))

  const prev = dados.preventivas.por_status
  cards.push(card('Preventivas vencidas', prev.vencida || 0, selosDe(
    prev, ROTULO_STATUS_PREVENTIVA, TOM_STATUS_PREVENTIVA,
    ['muito_proxima', 'proxima', 'em_dia'],
  ), () => contexto.irPara('preventivas')))

  cards.push(card('Usuarios', Object.values(dados.usuarios.por_status).reduce((a, b) => a + b, 0),
    selosDe(dados.usuarios.por_status, ROTULO_STATUS_USUARIO, TOM_STATUS_USUARIO,
      ['pendente', 'bloqueado', 'suspenso', 'ativo']),
    () => contexto.irPara('usuarios')))

  const alertas = dados.alertas.length
    ? elemento('div', { classe: 'fila' }, dados.alertas.map((alerta) =>
        elemento('div', {
          classe: `fila-item fila-item--${alerta.nivel} clicavel`,
          // Clicar no alerta leva a tela que resolve o alerta.
          aoClick: () => contexto.irPara(DESTINO_ALERTA[alerta.tipo] || 'painel'),
        }, [
          selo(alerta.tipo, alerta.nivel === 'critico' ? 's-critico' : 's-atencao'),
          elemento('div', { classe: 'fila-texto', texto: alerta.texto }),
        ])))
    : vazio('Nenhum alerta em aberto. A frota esta em dia.')

  raiz.append(
    cabecalhoTela({
      titulo: `Bom dia, ${contexto.usuario.nome.split(' ')[0]}`,
      descricao: 'Panorama da frota e o que exige acao agora.',
    }),
    elemento('div', { classe: 'grade' }, cards),
    elemento('section', { classe: 'secao' }, [
      elemento('div', { classe: 'secao-titulo' }, [elemento('h2', { texto: 'Fila de acao' })]),
      alertas,
    ]),
  )
}
