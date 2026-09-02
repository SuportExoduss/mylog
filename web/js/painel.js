// Dashboard (secao 7): o lider abre e ve o que exige acao, sem entrar em menu.
import { api } from './api.js'
import {
  elemento, cabecalhoTela, selo, numero, vazio,
  ROTULO_STATUS_VEICULO, TOM_STATUS_VEICULO,
  ROTULO_STATUS_PREVENTIVA, TOM_STATUS_PREVENTIVA,
  ROTULO_STATUS_USUARIO, TOM_STATUS_USUARIO,
} from './ui.js'

function card(titulo, valor, detalhes = [], aoClick) {
  return elemento('div', {
    classe: 'card',
    style: aoClick ? 'cursor:pointer' : null,
    aoClick,
  }, [
    elemento('div', { classe: 'card-titulo', texto: titulo }),
    elemento('div', { classe: 'card-numero', texto: numero(valor) }),
    detalhes.length ? elemento('div', { classe: 'card-detalhe' }, detalhes) : null,
  ])
}

// Monta os selos de um card a partir de um mapa {chave: contagem},
// escondendo o que estiver zerado — o painel mostra problema, nao tabela cheia.
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
    ['bloqueado', 'restrito', 'com_pendencia', 'manutencao', 'disponivel'],
  ), () => contexto.irPara('veiculos')))

  cards.push(card('Checklists hoje', dados.checklists.hoje, [
    dados.checklists.em_aberto > 0
      ? selo(`${dados.checklists.em_aberto} em aberto`, 's-atencao')
      : selo('nenhum pendente', 's-ok'),
  ]))

  cards.push(card('Nao conformidades', dados.nao_conformidades.abertas, selosDe(
    dados.nao_conformidades.por_criticidade,
    { critico: 'Criticas', alto: 'Altas', medio: 'Medias', baixo: 'Baixas', informativo: 'Informativas' },
    { critico: 's-critico', alto: 's-alerta', medio: 's-atencao', baixo: 's-neutro', informativo: 's-neutro' },
    ['critico', 'alto', 'medio', 'baixo', 'informativo'],
  )))

  cards.push(card('Tickets abertos', dados.tickets.abertos, [
    dados.tickets.atrasados > 0 ? selo(`${dados.tickets.atrasados} atrasados`, 's-critico') : null,
  ].filter(Boolean)))

  const prev = dados.preventivas.por_status
  cards.push(card('Preventivas vencidas', prev.vencida || 0, selosDe(
    prev, ROTULO_STATUS_PREVENTIVA, TOM_STATUS_PREVENTIVA,
    ['muito_proxima', 'proxima', 'em_dia'],
  )))

  cards.push(card('Usuarios', Object.values(dados.usuarios.por_status).reduce((a, b) => a + b, 0), selosDe(
    dados.usuarios.por_status, ROTULO_STATUS_USUARIO, TOM_STATUS_USUARIO,
    ['pendente', 'bloqueado', 'suspenso', 'ativo'],
  ), () => contexto.irPara('usuarios')))

  const alertas = dados.alertas.length
    ? elemento('div', { classe: 'fila-alertas' }, dados.alertas.map((alerta) =>
        elemento('div', { classe: `alerta-linha nivel-${alerta.nivel}` }, [
          selo(alerta.tipo.replace('_', ' '), alerta.nivel === 'critico' ? 's-critico' : 's-atencao'),
          elemento('div', { classe: 'alerta-texto', texto: alerta.texto }),
        ])))
    : vazio('Nenhum alerta em aberto. A frota esta em dia.')

  raiz.append(
    cabecalhoTela({
      titulo: `Bom dia, ${contexto.usuario.nome.split(' ')[0]}`,
      descricao: 'Panorama da frota e o que exige acao agora.',
    }),
    elemento('div', { classe: 'grade' }, cards),
    elemento('section', { classe: 'painel-secao' }, [
      elemento('h2', { texto: 'Fila de acao' }),
      alertas,
    ]),
  )
}
