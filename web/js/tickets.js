// Tickets e solicitacoes (secoes 16 e 17).
// A tela serve dois publicos: quem abre (colaborador, muitas vezes sem veiculo
// proprio) e quem trata (supervisao e manutencao).
import { api } from './api.js'
import {
  elemento, cabecalhoTela, tabela, selo, vazio, abrirModal, notificar, dataCurta,
} from './ui.js'

const CATEGORIAS = [
  { valor: 'problema', rotulo: 'Problema no veiculo' },
  { valor: 'dano', rotulo: 'Dano' },
  { valor: 'limpeza', rotulo: 'Limpeza' },
  { valor: 'documentacao', rotulo: 'Documentacao' },
  { valor: 'solicitacao', rotulo: 'Solicitacao de uso' },
  { valor: 'outro', rotulo: 'Outro' },
]

// Categorias que falam do ativo: o backend exige veiculo nelas.
const EXIGEM_VEICULO = new Set(['problema', 'dano', 'limpeza', 'documentacao'])

const ROTULO_STATUS = {
  aberto: 'Aberto', em_triagem: 'Em triagem', atribuido: 'Atribuido',
  em_andamento: 'Em andamento', resolvido: 'Resolvido', fechado: 'Fechado',
}
const TOM_STATUS = {
  aberto: 's-atencao', em_triagem: 's-atencao', atribuido: 's-alerta',
  em_andamento: 's-alerta', resolvido: 's-ok', fechado: 's-neutro',
}

const CRITICIDADES = [
  { valor: 'baixo', rotulo: 'Baixo' }, { valor: 'medio', rotulo: 'Medio' },
  { valor: 'alto', rotulo: 'Alto' }, { valor: 'critico', rotulo: 'Critico' },
]

const rotuloCategoria = (v) => CATEGORIAS.find((c) => c.valor === v)?.rotulo || v

async function abrirTicket(recarregar) {
  // O solicitante escolhe de uma lista da propria empresa. Ele nunca digita
  // placa nem modelo — dado mestre pertence ao cadastro (secao 16).
  const { veiculos } = await api.veiculos()

  abrirModal({
    titulo: 'Novo ticket',
    subtitulo: 'Descreva a necessidade. A supervisao recebe no painel.',
    campos: [
      { nome: 'categoria', rotulo: 'Categoria', tipo: 'select', opcoes: CATEGORIAS, valor: 'problema' },
      { nome: 'veiculo_id', rotulo: 'Veiculo', tipo: 'select',
        opcoes: [{ valor: '', rotulo: 'Nenhum veiculo especifico' },
          ...veiculos.map((v) => ({ valor: v.id, rotulo: `${v.placa} — ${v.modelo}` }))],
        dica: 'Procure pelo modelo ou pela placa.' },
      { nome: 'prioridade', rotulo: 'Prioridade', tipo: 'select',
        opcoes: [{ valor: 'normal', rotulo: 'Normal' }, { valor: 'alta', rotulo: 'Alta' }],
        valor: 'normal' },
      { nome: 'descricao', rotulo: 'Descricao', tipo: 'textarea', obrigatorio: true,
        dica: 'O que aconteceu ou o que voce precisa.' },
    ],
    confirmar: 'Abrir ticket',
    aoConfirmar: async (v) => {
      if (EXIGEM_VEICULO.has(v.categoria) && !v.veiculo_id) {
        throw new Error(`Para a categoria "${rotuloCategoria(v.categoria)}" escolha o veiculo.`)
      }
      const { ticket } = await api.criarTicket(v)
      notificar(`Ticket #${ticket.numero} aberto.`)
      await recarregar()
    },
  })
}

function tratar(ticket, recarregar) {
  abrirModal({
    titulo: `Ticket #${ticket.numero}`,
    subtitulo: `${rotuloCategoria(ticket.categoria)} · ${ticket.solicitante_nome}`
      + (ticket.placa ? ` · ${ticket.placa}` : ''),
    campos: [
      { nome: 'status', rotulo: 'Novo status', tipo: 'select',
        opcoes: Object.entries(ROTULO_STATUS).map(([valor, rotulo]) => ({ valor, rotulo })),
        valor: ticket.status },
      { nome: 'resolucao', rotulo: 'Solucao', tipo: 'textarea', valor: ticket.resolucao || '',
        dica: 'Obrigatoria para marcar como resolvido. O solicitante ve este texto.' },
    ],
    aoConfirmar: async (v) => {
      await api.statusTicket(ticket.id, v.status, v.resolucao)
      notificar('Ticket atualizado.')
      await recarregar()
    },
  })
}

async function atribuir(ticket, recarregar) {
  const { usuarios } = await api.usuarios({ status: 'ativo' })
  const tratadores = usuarios.filter((u) => ['adm', 'supervisor', 'manutencao'].includes(u.papel))

  abrirModal({
    titulo: `Atribuir ticket #${ticket.numero}`,
    subtitulo: 'So quem trata tickets pode ser responsavel.',
    campos: [{ nome: 'responsavel_id', rotulo: 'Responsavel', tipo: 'select',
      opcoes: tratadores.map((u) => ({ valor: u.id, rotulo: `${u.nome} (${u.papel})` })),
      valor: ticket.responsavel_id || '' }],
    confirmar: 'Atribuir',
    aoConfirmar: async (v) => {
      await api.atribuirTicket(ticket.id, v.responsavel_id)
      notificar('Responsavel definido.')
      await recarregar()
    },
  })
}

function virarOcorrencia(ticket, recarregar) {
  abrirModal({
    titulo: `Abrir ocorrencia do ticket #${ticket.numero}`,
    subtitulo: 'Nem todo ticket vira manutencao. Esta acao cria uma ocorrencia ligada ao veiculo.',
    campos: [{ nome: 'criticidade', rotulo: 'Criticidade', tipo: 'select',
      opcoes: CRITICIDADES, valor: 'medio' }],
    confirmar: 'Criar ocorrencia',
    aoConfirmar: async (v) => {
      await api.ticketVirarOcorrencia(ticket.id, v.criticidade)
      notificar('Ocorrencia aberta e ligada ao ticket.')
      await recarregar()
    },
  })
}

export async function telaTickets(raiz, contexto) {
  const podeTratar = contexto.pode('tickets.tratar')
  const podeOcorrencia = contexto.pode('nc.tratar')
  const filtros = { status: contexto.parametros.status || '', categoria: '' }
  const areaLista = elemento('div', {})

  async function recarregar() {
    const { tickets, vejo_todos } = await api.tickets(filtros)
    areaLista.replaceChildren(desenhar(tickets, vejo_todos))
  }

  function desenhar(tickets, vejoTodos) {
    if (!tickets.length) {
      return vazio(vejoTodos
        ? 'Nenhum ticket com esses filtros.'
        : 'Voce ainda nao abriu nenhum ticket.')
    }

    return tabela(['#', 'Assunto', 'Veiculo', 'Solicitante', 'Responsavel', 'Situacao', ''],
      tickets.map((t) => {
        const acoes = []
        if (podeTratar) {
          acoes.push(elemento('button', { classe: 'botao botao--mini', texto: 'Tratar',
            aoClick: () => tratar(t, recarregar) }))
          acoes.push(elemento('button', { classe: 'botao botao--suave botao--mini', texto: 'Atribuir',
            aoClick: () => atribuir(t, recarregar) }))
        }
        if (podeOcorrencia && t.veiculo_id && !['resolvido', 'fechado'].includes(t.status)) {
          acoes.push(elemento('button', { classe: 'botao botao--suave botao--mini', texto: 'Ocorrencia',
            aoClick: () => virarOcorrencia(t, recarregar) }))
        }

        return elemento('tr', {}, [
          elemento('td', {}, [elemento('span', { classe: 'celula-forte dado', texto: `#${t.numero}` })]),
          elemento('td', {}, [
            elemento('div', { classe: 'celula-forte', texto: rotuloCategoria(t.categoria) }),
            elemento('div', { classe: 'celula-fraca limite-texto',
              texto: t.descricao.length > 90 ? `${t.descricao.slice(0, 90)}...` : t.descricao }),
          ]),
          elemento('td', { classe: 'celula-fraca dado', texto: t.placa || '—' }),
          elemento('td', { classe: 'celula-fraca', texto: t.solicitante_nome }),
          elemento('td', { classe: 'celula-fraca', texto: t.responsavel_nome || 'sem responsavel' }),
          elemento('td', {}, [
            elemento('div', { classe: 'card-detalhe' }, [
              selo(ROTULO_STATUS[t.status], TOM_STATUS[t.status]),
              t.prioridade === 'alta' ? selo('alta', 's-alerta') : null,
              t.atrasado ? selo('atrasado', 's-critico') : null,
            ].filter(Boolean)),
            elemento('div', { classe: 'celula-fraca esp-t-1',
              texto: `aberto em ${dataCurta(t.criado_em)}` }),
          ]),
          elemento('td', {}, [elemento('div', { classe: 'linha linha--fim' }, acoes)]),
        ])
      }))
  }

  const seletorStatus = elemento('select', {
    aoChange: (evento) => { filtros.status = evento.target.value; recarregar() },
  }, [
    elemento('option', { value: '', texto: 'Todos os status' }),
    ...Object.entries(ROTULO_STATUS).map(([valor, rotulo]) =>
      elemento('option', { value: valor, texto: rotulo, selected: valor === filtros.status })),
  ])
  const seletorCategoria = elemento('select', {
    aoChange: (evento) => { filtros.categoria = evento.target.value; recarregar() },
  }, [
    elemento('option', { value: '', texto: 'Todas as categorias' }),
    ...CATEGORIAS.map((c) => elemento('option', { value: c.valor, texto: c.rotulo })),
  ])

  raiz.append(
    cabecalhoTela({
      titulo: 'Tickets',
      descricao: 'Solicitacoes da equipe. Atrasados e prioridade alta aparecem primeiro.',
      acoes: contexto.pode('tickets.abrir')
        ? [elemento('button', { classe: 'botao', texto: '+ Novo ticket',
            aoClick: () => abrirTicket(recarregar) })]
        : [],
    }),
    elemento('div', { classe: 'filtros' }, [seletorStatus, seletorCategoria]),
    areaLista,
  )

  await recarregar()
}
