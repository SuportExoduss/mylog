// Ocorrencias (nao conformidades) e trilha de auditoria.
// Duas telas irmas: uma trata o que deu errado, a outra prova o que aconteceu.
import { api } from './api.js'
import {
  elemento, cabecalhoTela, tabela, selo, vazio, abrirModal, notificar, dataCurta, menuAcoes,
  ROTULO_STATUS_OCORRENCIA, TOM_STATUS_OCORRENCIA, ROTULO_PRIORIDADE, TOM_PRIORIDADE,
} from './ui.js'

// Filtros da v3.0: sai "Validada" da situacao e "Informativo" da prioridade.
const ROTULO_STATUS = ROTULO_STATUS_OCORRENCIA
const TOM_STATUS = TOM_STATUS_OCORRENCIA
const PRIORIDADES = Object.entries(ROTULO_PRIORIDADE).map(([valor, rotulo]) => ({ valor, rotulo }))

// A mesma cadeia que o servidor aplica (roadmap 12.3). Oferecer no seletor um
// destino que o servidor recusa so produz erro depois de o usuario decidir.
const TRANSICOES = {
  aberta: ['em_tratamento', 'encerrada'],
  em_tratamento: ['resolvida', 'aberta', 'encerrada'],
  resolvida: ['encerrada', 'em_tratamento'],
  encerrada: [],
}

function tratar(ocorrencia, recarregar) {
  const destinos = TRANSICOES[ocorrencia.status] || []
  if (!destinos.length) {
    return notificar('Ocorrencia encerrada. Nao ha proximo estado.')
  }
  abrirModal({
    titulo: `Ocorrencia — ${ocorrencia.placa}`,
    subtitulo: ocorrencia.descricao,
    campos: [
      { nome: 'status', rotulo: 'Novo status', tipo: 'select',
        opcoes: destinos.map((valor) => ({ valor, rotulo: ROTULO_STATUS[valor] })),
        valor: destinos[0],
        dica: 'Fechada a ultima ocorrencia do veiculo, a pendencia sai sozinha. '
            + 'Veiculo bloqueado continua exigindo liberacao a parte, com motivo.' },
      { nome: 'resolucao', rotulo: 'O que foi feito', tipo: 'textarea',
        valor: ocorrencia.resolucao || '',
        dica: 'Obrigatorio para marcar como resolvida.' },
    ],
    aoConfirmar: async (v) => {
      await api.statusOcorrencia(ocorrencia.id, v.status, v.resolucao)
      notificar('Ocorrencia atualizada.')
      await recarregar()
    },
  })
}

async function atribuir(ocorrencia, recarregar) {
  const { usuarios } = await api.usuarios({ status: 'ativo' })
  // So a equipe da frota trata ocorrencia. Cargo nao decide isso (roadmap 3):
  // o que decide e' o acesso ao painel.
  const tratadores = usuarios.filter((u) => u.acessa_painel)
  if (!tratadores.length) {
    return notificar('Nenhum usuario da frota ativo para receber a ocorrencia.')
  }
  abrirModal({
    titulo: `Atribuir ocorrencia — ${ocorrencia.placa}`,
    campos: [{ nome: 'responsavel_id', rotulo: 'Responsavel', tipo: 'select',
      opcoes: tratadores.map((u) => ({
        valor: u.id, rotulo: u.cargo_nome ? `${u.nome} — ${u.cargo_nome}` : u.nome,
      })),
      valor: ocorrencia.responsavel_id || tratadores[0].id }],
    confirmar: 'Atribuir',
    aoConfirmar: async (v) => {
      await api.atribuirOcorrencia(ocorrencia.id, v.responsavel_id)
      notificar('Responsavel definido.')
      await recarregar()
    },
  })
}

// As acoes chegam da auditoria como "ocorrencia.em_tratamento". Na linha do
// tempo isso vira frase.
const ROTULO_ACAO = {
  'ocorrencia.aberta': 'Aberta pelo checklist',
  'ocorrencia.em_tratamento': 'Entrou em tratamento',
  'ocorrencia.resolvida': 'Resolvida',
  'ocorrencia.encerrada': 'Encerrada',
  'ocorrencia.atribuida': 'Responsavel definido',
}
const rotuloAcao = (acao) => ROTULO_ACAO[acao] || acao

// `depois` vem como JSON de texto da auditoria. Le uma vez e nao explode se
// alguem tiver editado a linha na mao.
function resolucaoDe(evento) {
  if (!evento?.depois) return null
  try { return JSON.parse(evento.depois).resolucao || null } catch { return null }
}

// Detalhe de uma ocorrencia: o que ja se fez com ela, e quantas vezes essa
// mesma peca ja deu problema NESTE carro.
//
// A recorrencia e' o dado que a rota devolvia e ninguem lia. "Terceira vez que
// a pinca de freio deste caminhao aparece" muda a conversa: deixa de ser mais
// uma ocorrencia e vira um problema que o conserto anterior nao resolveu.
async function verDetalhe(id, recarregar) {
  const { ocorrencia, historico, recorrencia } = await api.ocorrencia(id)
  const area = document.getElementById('area-modal')

  const linhaHistorico = (e) => elemento('div', { classe: 'linha-tempo-item' }, [
    elemento('div', { classe: 'linha-tempo-quando dado', texto: dataCurta(e.criado_em) }),
    elemento('div', {}, [
      elemento('div', { classe: 'celula-forte', texto: rotuloAcao(e.acao) }),
      elemento('div', { classe: 'celula-fraca', texto: e.ator_nome || 'sistema' }),
      resolucaoDe(e)
        ? elemento('div', { classe: 'celula-fraca esp-t-1', texto: `"${resolucaoDe(e)}"` })
        : null,
    ].filter(Boolean)),
  ])

  const formulario = elemento('div', { classe: 'modal modal--alto' }, [
    elemento('h3', { texto: `Ocorrencia — ${ocorrencia.placa}` }),
    elemento('p', { classe: 'modal-sub', texto: ocorrencia.descricao }),

    elemento('div', { classe: 'card-detalhe' }, [
      selo(ROTULO_PRIORIDADE[ocorrencia.prioridade], TOM_PRIORIDADE[ocorrencia.prioridade]),
      selo(ROTULO_STATUS[ocorrencia.status], TOM_STATUS[ocorrencia.status]),
      ocorrencia.responsavel_nome
        ? selo(ocorrencia.responsavel_nome, 's-neutro')
        : selo('sem responsavel', 's-atencao'),
    ]),

    // O bloco que justifica a tela existir.
    recorrencia.length
      ? elemento('div', { classe: 'aviso aviso--erro esp-t-4' }, [
          elemento('strong', {
            texto: `Esta peca ja deu problema ${recorrencia.length + 1} vezes neste veiculo. `,
          }),
          'O conserto anterior pode nao ter resolvido.',
          elemento('div', { classe: 'card-detalhe esp-t-1' },
            recorrencia.map((r) => selo(
              `${dataCurta(r.aberta_em)} · ${ROTULO_PRIORIDADE[r.prioridade].toLowerCase()}`,
              TOM_PRIORIDADE[r.prioridade]))),
        ])
      : elemento('div', { classe: 'campo-dica esp-t-4',
          texto: 'Primeira vez que esta peca aparece neste veiculo.' }),

    elemento('h4', { classe: 'esp-t-4', texto: 'O que ja se fez' }),
    historico.length
      ? elemento('div', { classe: 'linha-tempo' }, historico.map(linhaHistorico))
      : vazio('Nenhum tratamento registrado ainda.'),

    ocorrencia.resolucao
      ? elemento('div', { classe: 'leitura esp-t-2', texto: ocorrencia.resolucao })
      : null,

    elemento('div', { classe: 'modal-acoes' }, [
      elemento('button', { classe: 'botao botao--suave', type: 'button', texto: 'Fechar',
        aoClick: () => area.replaceChildren() }),
      elemento('button', {
        classe: 'botao botao--suave', type: 'button', texto: 'Ver o checklist',
        disabled: !ocorrencia.inspecao_id,
        aoClick: () => window.open(`/relatorio/inspecao/${ocorrencia.inspecao_id}`, '_blank'),
      }),
      ocorrencia.status !== 'encerrada'
        ? elemento('button', { classe: 'botao', type: 'button', texto: 'Tratar',
            aoClick: () => tratar(ocorrencia, recarregar) })
        : null,
    ].filter(Boolean)),
  ].filter(Boolean))

  area.replaceChildren(elemento('div', { classe: 'fundo-modal' }, [formulario]))
}

export async function telaOcorrencias(raiz, contexto) {
  const podeTratar = contexto.ehFrota
  // `veiculo` chega de quem veio do historico de um carro. E' o unico filtro
  // que nao tem seletor: quem quer ver por veiculo chega pelo veiculo, e sai
  // dele por uma etiqueta com "limpar".
  const filtros = {
    status: contexto.parametros.status || '',
    prioridade: '',
    veiculo_id: contexto.parametros.veiculo || '',
  }
  const placaFiltrada = contexto.parametros.placa || ''
  const areaLista = elemento('div', {})

  async function recarregar() {
    const { ocorrencias } = await api.ocorrencias(filtros)
    areaLista.replaceChildren(desenhar(ocorrencias))
  }

  function desenhar(ocorrencias) {
    if (!ocorrencias.length) {
      return vazio(filtros.veiculo_id
        ? `Nenhuma ocorrencia registrada para ${placaFiltrada || 'este veiculo'}.`
        : 'Nenhuma ocorrencia em aberto. A frota esta sem pendencia registrada.')
    }
    return tabela(['Veiculo', 'O que deu errado', 'Prioridade', 'Responsavel', 'Situacao', ''],
      ocorrencias.map((o) => {
        // "Abrir" vem primeiro e vale para todos, inclusive nas encerradas:
        // e' onde esta a recorrencia, que e' o que muda a conversa.
        const acoes = [
          { rotulo: 'Abrir', aoClick: () => verDetalhe(o.id, recarregar) },
        ]
        if (podeTratar) {
          acoes.push({ rotulo: 'Tratar', aoClick: () => tratar(o, recarregar) })
          acoes.push({ rotulo: 'Atribuir responsavel', aoClick: () => atribuir(o, recarregar) })
        }

        return elemento('tr', {}, [
          elemento('td', {}, [
            elemento('div', { classe: 'celula-forte dado', texto: o.placa }),
            elemento('div', { classe: 'celula-fraca', texto: o.modelo }),
          ]),
          elemento('td', {}, [
            elemento('div', { classe: 'limite-texto', texto: o.descricao }),
            o.pergunta_id ? elemento('div', { classe: 'celula-fraca dado', texto: o.pergunta_id }) : null,
          ]),
          elemento('td', {}, [selo(ROTULO_PRIORIDADE[o.prioridade], TOM_PRIORIDADE[o.prioridade])]),
          elemento('td', { classe: 'celula-fraca', texto: o.responsavel_nome || 'sem responsavel' }),
          elemento('td', {}, [
            selo(ROTULO_STATUS[o.status], TOM_STATUS[o.status]),
            elemento('div', { classe: 'celula-fraca esp-t-1',
              texto: `desde ${dataCurta(o.aberta_em)}` }),
          ]),
          elemento('td', { classe: 'celula-acoes' }, [menuAcoes(acoes)]),
        ])
      }))
  }

  const seletorStatus = elemento('select', {
    aoChange: (e) => { filtros.status = e.target.value; recarregar() },
  }, [
    elemento('option', { value: '', texto: 'Nao encerradas' }),
    ...Object.entries(ROTULO_STATUS).map(([valor, rotulo]) =>
      elemento('option', { value: valor, texto: rotulo, selected: valor === filtros.status })),
  ])
  const seletorPrioridade = elemento('select', {
    aoChange: (e) => { filtros.prioridade = e.target.value; recarregar() },
  }, [
    elemento('option', { value: '', texto: 'Todas as prioridades' }),
    ...PRIORIDADES.map((c) => elemento('option', { value: c.valor, texto: c.rotulo })),
  ])

  raiz.append(
    cabecalhoTela({
      titulo: 'Ocorrencias',
      descricao: 'O que os checklists encontraram de errado na frota. Mais graves primeiro.',
    }),
    elemento('div', { classe: 'filtros' }, [
      seletorStatus,
      seletorPrioridade,
      filtros.veiculo_id
        ? elemento('button', {
            classe: 'botao botao--suave botao--pequeno', type: 'button',
            texto: `so ${placaFiltrada || 'este veiculo'} · limpar`,
            aoClick: () => contexto.irPara('ocorrencias'),
          })
        : null,
    ].filter(Boolean)),
    areaLista,
  )
  await recarregar()
}

// ------------------------------------------------------------- auditoria

// Resume o par antes/depois numa frase, para a tela nao virar despejo de JSON.
function resumirMudanca(evento) {
  const { antes, depois } = evento
  if (antes?.status && depois?.status) return `${antes.status} → ${depois.status}`
  if (depois?.motivo) return depois.motivo
  const partes = []
  for (const [chave, valor] of Object.entries(depois || {})) {
    if (valor === null || valor === undefined || typeof valor === 'object') continue
    partes.push(`${chave}: ${valor}`)
    if (partes.length === 3) break
  }
  return partes.join(' · ') || '—'
}

export async function telaAuditoria(raiz, contexto) {
  const filtros = { busca: '', entidade: '' }
  const areaLista = elemento('div', {})
  const areaFiltros = elemento('div', { classe: 'filtros' })

  async function recarregar() {
    const { eventos, limite } = await api.auditoria(filtros)
    areaLista.replaceChildren(desenhar(eventos, limite))
  }

  function desenhar(eventos, limite) {
    if (!eventos.length) return vazio('Nenhum evento com esses filtros.')

    const tabelaEventos = tabela(['Quando', 'Quem', 'Acao', 'Sobre', 'Mudanca'],
      eventos.map((e) => elemento('tr', {}, [
        elemento('td', { classe: 'celula-fraca dado' }, [
          elemento('div', { texto: dataCurta(e.criado_em) }),
          elemento('div', { texto: e.criado_em.slice(11, 19) }),
        ]),
        elemento('td', { classe: 'celula-fraca', texto: e.ator_nome || 'sistema' }),
        elemento('td', {}, [elemento('span', { classe: 'celula-forte dado', texto: e.acao })]),
        elemento('td', { classe: 'celula-fraca dado', texto: e.entidade }),
        elemento('td', { classe: 'celula-fraca limite-texto', texto: resumirMudanca(e) }),
      ])))

    return elemento('div', {}, [
      tabelaEventos,
      eventos.length >= limite
        ? elemento('div', { classe: 'campo-dica esp-t-3',
            texto: `Mostrando os ${limite} eventos mais recentes. Use a busca para estreitar.` })
        : null,
    ])
  }

  const { acoes } = await api.auditoria({ limite: 1 })
  areaFiltros.append(
    elemento('input', { type: 'search', placeholder: 'Buscar por pessoa, acao ou valor',
      aoInput: (e) => { filtros.busca = e.target.value; recarregar() } }),
    elemento('select', { aoChange: (e) => { filtros.entidade = e.target.value; recarregar() } }, [
      elemento('option', { value: '', texto: 'Todas as entidades' }),
      ...['usuario', 'cargo', 'veiculo', 'template', 'preventiva', 'solicitacao', 'ocorrencia', 'inspecao']
        .map((v) => elemento('option', { value: v, texto: v })),
    ]),
    elemento('select', { aoChange: (e) => { filtros.acao = e.target.value; recarregar() } }, [
      elemento('option', { value: '', texto: 'Todas as acoes' }),
      ...acoes.map((a) => elemento('option', { value: a.acao, texto: `${a.acao} (${a.total})` })),
    ]),
  )

  raiz.append(
    cabecalhoTela({
      titulo: 'Auditoria',
      descricao: 'Historico imutavel de quem alterou o que, e quando. Nenhuma tela apaga esta lista.',
    }),
    areaFiltros,
    areaLista,
  )
  await recarregar()
}
