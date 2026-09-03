// Vistorias preventivas (secoes 18 a 21). A tela existe para responder duas
// perguntas: o que esta vencido, e o que vence em breve.
import { api } from './api.js'
import {
  elemento, cabecalhoTela, tabela, selo, vazio, abrirModal, notificar, numero, dataCurta, menuAcoes,
  ROTULO_STATUS_PREVENTIVA, TOM_STATUS_PREVENTIVA,
} from './ui.js'

const MODOS = [
  { valor: 'km', rotulo: 'Por quilometragem' },
  { valor: 'data', rotulo: 'Por data' },
]

const hojeISO = () => new Date().toISOString().slice(0, 10)

function alvoDe(p) {
  if (p.modo === 'km') return `${numero(p.proximo_km)} km`
  return dataCurta(p.proxima_data)
}

// Campos do alvo, compartilhados por criar / reagendar / concluir.
function camposAlvo({ prefixo = '', modoInicial = 'km', km = '', data = '', alertaKm = 500, alertaDias = 7 }) {
  const n = (nome) => (prefixo ? `${prefixo}_${nome}` : nome)
  return [
    { nome: n('modo'), rotulo: prefixo ? 'Metodo da proxima preventiva' : 'Metodo', tipo: 'select',
      opcoes: MODOS, valor: modoInicial,
      dica: 'Veiculo novo costuma ir por KM; veiculo antigo, por data.' },
    { nome: n('km'), rotulo: 'KM-alvo', tipo: 'number', valor: km,
      visivelQuando: (v) => v[n('modo')] === 'km' },
    { nome: n('alerta_km'), rotulo: 'Avisar quantos KM antes', tipo: 'number', valor: alertaKm,
      visivelQuando: (v) => v[n('modo')] === 'km' },
    { nome: n('data'), rotulo: 'Data-alvo', tipo: 'date', valor: data,
      visivelQuando: (v) => v[n('modo')] === 'data' },
    { nome: n('alerta_dias'), rotulo: 'Avisar quantos dias antes', tipo: 'number', valor: alertaDias,
      visivelQuando: (v) => v[n('modo')] === 'data' },
  ]
}

function corpoAlvo(v, prefixo = '') {
  const n = (nome) => (prefixo ? `${prefixo}_${nome}` : nome)
  const modo = v[n('modo')]
  return {
    modo,
    proximo_km: modo === 'km' ? Number(v[n('km')]) : null,
    proxima_data: modo === 'data' ? v[n('data')] : null,
    alerta_antes_km: modo === 'km' ? Number(v[n('alerta_km')] || 500) : undefined,
    alerta_antes_dias: modo === 'data' ? Number(v[n('alerta_dias')] || 7) : undefined,
  }
}

async function novaPreventiva(recarregar) {
  const { veiculos } = await api.veiculos()
  const { preventivas } = await api.preventivas()
  const comPreventiva = new Set(preventivas.map((p) => p.veiculo_id))
  const disponiveis = veiculos.filter((v) => !comPreventiva.has(v.id))

  if (!disponiveis.length) {
    notificar('Todos os veiculos ja tem preventiva em aberto.')
    return
  }

  abrirModal({
    titulo: 'Nova preventiva',
    subtitulo: 'Define quando a proxima manutencao vence e quando o painel comeca a avisar.',
    campos: [
      { nome: 'veiculo_id', rotulo: 'Veiculo', tipo: 'select',
        opcoes: disponiveis.map((v) => ({
          valor: v.id, rotulo: `${v.placa} — ${v.modelo} (${numero(v.km_atual)} km)`,
        })) },
      ...camposAlvo({}),
      { nome: 'observacoes', rotulo: 'Observacoes', tipo: 'textarea' },
    ],
    confirmar: 'Cadastrar',
    aoConfirmar: async (v) => {
      await api.criarPreventiva({
        veiculo_id: v.veiculo_id, observacoes: v.observacoes, ...corpoAlvo(v),
      })
      notificar('Preventiva cadastrada.')
      await recarregar()
    },
  })
}

function reagendar(p, recarregar) {
  abrirModal({
    titulo: `Reagendar ${p.placa}`,
    subtitulo: 'Alteracao excepcional. Fica registrada na auditoria com o motivo.',
    campos: [
      ...camposAlvo({
        modoInicial: p.modo,
        km: p.proximo_km ?? '',
        data: p.proxima_data ?? '',
        alertaKm: p.alerta_antes_km ?? 500,
        alertaDias: p.alerta_antes_dias ?? 7,
      }),
      { nome: 'motivo', rotulo: 'Motivo do reagendamento', tipo: 'textarea', obrigatorio: true },
    ],
    aoConfirmar: async (v) => {
      await api.reagendarPreventiva(p.id, { motivo: v.motivo, ...corpoAlvo(v) })
      notificar('Preventiva reagendada.')
      await recarregar()
    },
  })
}

// Secao 19: concluir e definir o proximo ciclo sao o mesmo ato.
function concluir(p, recarregar) {
  const proximoKmSugerido = p.modo === 'km' && p.proximo_km
    ? Number(p.proximo_km) + (Number(p.proximo_km) - Number(p.ultimo_servico_km || 0) || 10000)
    : Number(p.km_atual) + 10000

  const proximaDataSugerida = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10)

  abrirModal({
    titulo: `Concluir preventiva — ${p.placa}`,
    subtitulo: 'Registre o que foi feito e ja defina quando vence a proxima.',
    campos: [
      { nome: 'servico', rotulo: 'Servico executado', tipo: 'textarea', obrigatorio: true,
        dica: 'Ex.: Troca de oleo e filtros, revisao de freios.' },
      { nome: 'km_realizado', rotulo: 'KM na execucao', tipo: 'number', valor: p.km_atual,
        dica: 'Atualiza tambem o hodometro do veiculo se for maior que o registrado.' },
      { nome: 'data_realizada', rotulo: 'Data da execucao', tipo: 'date', valor: hojeISO() },
      ...camposAlvo({
        prefixo: 'prox',
        modoInicial: p.modo,
        km: proximoKmSugerido,
        data: proximaDataSugerida,
        alertaKm: p.alerta_antes_km ?? 500,
        alertaDias: p.alerta_antes_dias ?? 7,
      }),
    ],
    confirmar: 'Concluir e agendar proxima',
    aoConfirmar: async (v) => {
      const proxima = corpoAlvo(v, 'prox')
      const { proxima: criada } = await api.concluirPreventiva(p.id, {
        servico: v.servico,
        km_realizado: v.km_realizado,
        data_realizada: v.data_realizada,
        proximo_modo: proxima.modo,
        proximo_km: proxima.proximo_km,
        proxima_data: proxima.proxima_data,
        alerta_antes_km: proxima.alerta_antes_km,
        alerta_antes_dias: proxima.alerta_antes_dias,
      })
      notificar(`Concluida. Proxima em ${alvoDe(criada)}.`)
      await recarregar()
    },
  })
}

export async function telaPreventivas(raiz, contexto) {
  const podeEscrever = contexto.ehFrota
  const filtros = { status: contexto.parametros.status || '', historico: '' }
  const areaLista = elemento('div', {})

  async function recarregar() {
    const { preventivas } = await api.preventivas(filtros)
    areaLista.replaceChildren(desenhar(preventivas))
  }

  function desenhar(preventivas) {
    if (!preventivas.length) return vazio('Nenhuma preventiva com esses filtros.')

    return tabela(['Veiculo', 'Metodo', 'Alvo', 'Situacao', 'Ultima execucao', ''],
      preventivas.map((p) => {
        const acoes = podeEscrever && p.status !== 'realizada' ? [
          { rotulo: 'Concluir e agendar proxima', aoClick: () => concluir(p, recarregar) },
          { rotulo: 'Reagendar', aoClick: () => reagendar(p, recarregar) },
        ] : []

        return elemento('tr', {}, [
          elemento('td', {}, [
            elemento('div', { classe: 'celula-forte dado', texto: p.placa }),
            elemento('div', { classe: 'celula-fraca', texto: p.modelo }),
          ]),
          elemento('td', { classe: 'celula-fraca',
            texto: p.modo === 'km' ? 'Quilometragem' : 'Data' }),
          elemento('td', {}, [
            elemento('div', { classe: 'dado', texto: alvoDe(p) }),
            elemento('div', { classe: 'celula-fraca',
              texto: p.modo === 'km' ? `atual: ${numero(p.km_atual)} km` : '' }),
          ]),
          elemento('td', {}, [
            selo(ROTULO_STATUS_PREVENTIVA[p.status], TOM_STATUS_PREVENTIVA[p.status]),
            elemento('div', { classe: 'celula-fraca esp-t-1', texto: p.folga }),
          ]),
          elemento('td', { classe: 'celula-fraca' }, [
            elemento('div', { texto: p.ultimo_servico_data ? dataCurta(p.ultimo_servico_data) : '—' }),
            p.concluida_por_nome ? elemento('div', { texto: p.concluida_por_nome }) : null,
          ]),
          elemento('td', { classe: 'celula-acoes' }, [menuAcoes(acoes)]),
        ])
      }))
  }

  const seletorStatus = elemento('select', {
    aoChange: (evento) => { filtros.status = evento.target.value; recarregar() },
  }, [
    elemento('option', { value: '', texto: 'Em aberto' }),
    ...Object.entries(ROTULO_STATUS_PREVENTIVA).map(([valor, rotulo]) =>
      elemento('option', { value: valor, texto: rotulo, selected: valor === filtros.status })),
  ])

  raiz.append(
    cabecalhoTela({
      titulo: 'Preventivas',
      descricao: 'Manutencao programada por quilometragem ou por data. Vencidas aparecem primeiro.',
      acoes: podeEscrever
        ? [elemento('button', { classe: 'botao', texto: '+ Nova preventiva',
            aoClick: () => novaPreventiva(recarregar) })]
        : [],
    }),
    elemento('div', { classe: 'filtros' }, [seletorStatus]),
    areaLista,
  )

  await recarregar()
}
