// Ocorrencias (nao conformidades) e trilha de auditoria.
// Duas telas irmas: uma trata o que deu errado, a outra prova o que aconteceu.
import { api } from './api.js'
import {
  elemento, cabecalhoTela, tabela, selo, vazio, abrirModal, notificar, dataCurta,
} from './ui.js'

const ROTULO_STATUS = {
  aberta: 'Aberta', em_tratamento: 'Em tratamento', resolvida: 'Resolvida',
  validada: 'Validada', encerrada: 'Encerrada',
}
const TOM_STATUS = {
  aberta: 's-critico', em_tratamento: 's-alerta', resolvida: 's-atencao',
  validada: 's-ok', encerrada: 's-neutro',
}

const CRITICIDADES = [
  { valor: 'informativo', rotulo: 'Informativo' }, { valor: 'baixo', rotulo: 'Baixo' },
  { valor: 'medio', rotulo: 'Medio' }, { valor: 'alto', rotulo: 'Alto' },
  { valor: 'critico', rotulo: 'Critico' },
]
const TOM_CRITICIDADE = {
  informativo: 's-neutro', baixo: 's-neutro', medio: 's-atencao',
  alto: 's-alerta', critico: 's-critico',
}

function tratar(ocorrencia, recarregar) {
  abrirModal({
    titulo: `Ocorrencia — ${ocorrencia.placa}`,
    subtitulo: ocorrencia.descricao,
    campos: [
      { nome: 'status', rotulo: 'Novo status', tipo: 'select',
        opcoes: Object.entries(ROTULO_STATUS).map(([valor, rotulo]) => ({ valor, rotulo })),
        valor: ocorrencia.status,
        dica: '"Resolvida" e quem executou; "validada" e a supervisao conferindo.' },
      { nome: 'resolucao', rotulo: 'O que foi feito', tipo: 'textarea',
        valor: ocorrencia.resolucao || '' },
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
  const tratadores = usuarios.filter((u) => ['adm', 'supervisor', 'manutencao'].includes(u.papel))
  abrirModal({
    titulo: `Atribuir ocorrencia — ${ocorrencia.placa}`,
    campos: [{ nome: 'responsavel_id', rotulo: 'Responsavel', tipo: 'select',
      opcoes: tratadores.map((u) => ({ valor: u.id, rotulo: `${u.nome} (${u.papel})` })),
      valor: ocorrencia.responsavel_id || '' }],
    confirmar: 'Atribuir',
    aoConfirmar: async (v) => {
      await api.atribuirOcorrencia(ocorrencia.id, v.responsavel_id)
      notificar('Responsavel definido.')
      await recarregar()
    },
  })
}

export async function telaOcorrencias(raiz, contexto) {
  const podeTratar = contexto.pode('nc.tratar')
  const filtros = { status: contexto.parametros.status || '', criticidade: '' }
  const areaLista = elemento('div', {})

  async function recarregar() {
    const { ocorrencias } = await api.ocorrencias(filtros)
    areaLista.replaceChildren(desenhar(ocorrencias))
  }

  function desenhar(ocorrencias) {
    if (!ocorrencias.length) {
      return vazio('Nenhuma ocorrencia em aberto. A frota esta sem pendencia registrada.')
    }
    return tabela(['Veiculo', 'O que deu errado', 'Criticidade', 'Responsavel', 'Situacao', ''],
      ocorrencias.map((o) => {
        const acoes = podeTratar ? [
          elemento('button', { classe: 'botao botao--mini', texto: 'Tratar',
            aoClick: () => tratar(o, recarregar) }),
          elemento('button', { classe: 'botao botao--suave botao--mini', texto: 'Atribuir',
            aoClick: () => atribuir(o, recarregar) }),
        ] : []

        return elemento('tr', {}, [
          elemento('td', {}, [
            elemento('div', { classe: 'celula-forte dado', texto: o.placa }),
            elemento('div', { classe: 'celula-fraca', texto: o.modelo }),
          ]),
          elemento('td', {}, [
            elemento('div', { classe: 'limite-texto', texto: o.descricao }),
            o.item_id ? elemento('div', { classe: 'celula-fraca dado', texto: o.item_id }) : null,
          ]),
          elemento('td', {}, [selo(o.criticidade, TOM_CRITICIDADE[o.criticidade])]),
          elemento('td', { classe: 'celula-fraca', texto: o.responsavel_nome || 'sem responsavel' }),
          elemento('td', {}, [
            selo(ROTULO_STATUS[o.status], TOM_STATUS[o.status]),
            elemento('div', { classe: 'celula-fraca esp-t-1',
              texto: `desde ${dataCurta(o.aberta_em)}` }),
          ]),
          elemento('td', {}, [elemento('div', { classe: 'linha linha--fim' }, acoes)]),
        ])
      }))
  }

  const seletorStatus = elemento('select', {
    aoChange: (e) => { filtros.status = e.target.value; recarregar() },
  }, [
    elemento('option', { value: '', texto: 'Em aberto' }),
    ...Object.entries(ROTULO_STATUS).map(([valor, rotulo]) =>
      elemento('option', { value: valor, texto: rotulo, selected: valor === filtros.status })),
  ])
  const seletorCriticidade = elemento('select', {
    aoChange: (e) => { filtros.criticidade = e.target.value; recarregar() },
  }, [
    elemento('option', { value: '', texto: 'Todas as criticidades' }),
    ...CRITICIDADES.map((c) => elemento('option', { value: c.valor, texto: c.rotulo })),
  ])

  raiz.append(
    cabecalhoTela({
      titulo: 'Ocorrencias',
      descricao: 'Nao conformidades encontradas em checklist ou promovidas de tickets. Mais criticas primeiro.',
    }),
    elemento('div', { classe: 'filtros' }, [seletorStatus, seletorCriticidade]),
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
      ...['usuario', 'veiculo', 'vinculo', 'template', 'preventiva', 'ticket', 'nao_conformidade']
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
