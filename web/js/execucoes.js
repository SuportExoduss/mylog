// Checklists feitos (roadmap 11.9).
//
// Abre mostrando HOJE, sem ninguem clicar. Essa e' a pergunta das 8h da manha
// — "o que ja foi feito e o que esta faltando" — e ela nao deveria custar dois
// cliques a quem abre esta tela todo dia.
import { api } from './api.js'
import {
  elemento, cabecalhoTela, tabela, selo, vazio, notificar, numero,
  ROTULO_PRIORIDADE, TOM_PRIORIDADE,
} from './ui.js'

const DIA = 86400000

// Data LOCAL em AAAA-MM-DD. `toISOString()` daria a data em UTC: no Brasil
// (UTC-3), depois das 21h "hoje" viraria amanha e a tela abriria vazia
// justamente no fim do turno, quando alguem esta conferindo o dia.
const iso = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const hoje = () => iso(new Date())

function primeiroDoMes(base) {
  return new Date(base.getFullYear(), base.getMonth(), 1)
}
function ultimoDoMes(base) {
  return new Date(base.getFullYear(), base.getMonth() + 1, 0)
}

const MES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

// dd/mm às HH:MM. O ano fica de fora: a tela quase sempre mostra o mes
// corrente, e repetir 2026 em quarenta linhas nao informa nada.
function quando(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function duracao(segundos) {
  if (segundos === null || segundos === undefined) return '—'
  if (segundos < 60) return `${segundos}s`
  const min = Math.floor(segundos / 60)
  return min < 60 ? `${min}min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
}

export async function telaExecucoes(raiz, contexto) {
  const filtros = {
    de: contexto.parametros.de || hoje(),
    ate: contexto.parametros.ate || hoje(),
    cargo_id: contexto.parametros.cargo_id || '',
  }

  const areaLista = elemento('div', {})
  const areaFaltando = elemento('div', {})
  const resumo = elemento('div', { classe: 'campo-dica' })
  const campoDe = elemento('input', { type: 'date', value: filtros.de })
  const campoAte = elemento('input', { type: 'date', value: filtros.ate })
  const rotuloMes = elemento('span', { classe: 'periodo-mes' })

  const { cargos } = contexto.ehFrota ? await api.cargos() : { cargos: [] }

  async function recarregar() {
    campoDe.value = filtros.de
    campoAte.value = filtros.ate
    atualizarRotuloMes()
    areaLista.replaceChildren(elemento('div', { classe: 'campo-dica', texto: 'Carregando...' }))
    try {
      const r = await api.execucoes(filtros)
      resumo.textContent = r.total >= r.limite
        ? `${r.total} checklists (limite da tela). Estreite o periodo para ver o resto.`
        : `${r.total} checklist(s) no periodo.`
      areaLista.replaceChildren(desenhar(r.execucoes))
    } catch (falha) {
      resumo.textContent = ''
      areaLista.replaceChildren(vazio(falha.message))
    }
    await carregarFaltando()
  }

  // "O dia fechou?" nao se responde olhando so o que foi feito. Quem devia ter
  // feito e nao fez vem logo acima da lista, e so quando o intervalo e' de UM
  // dia — faltou e' pergunta de dia, nao de mes.
  async function carregarFaltando() {
    if (!contexto.ehFrota || filtros.de !== filtros.ate) {
      areaFaltando.replaceChildren()
      return
    }
    try {
      const r = await api.faltando(filtros.de)
      areaFaltando.replaceChildren(desenharFaltando(r))
    } catch {
      areaFaltando.replaceChildren()
    }
  }

  function desenharFaltando(r) {
    if (!r.exigido) {
      return elemento('div', { classe: 'aviso aviso--info' }, [
        elemento('strong', { texto: 'Nenhum checklist obrigatorio neste dia. ' }),
        'Os modelos diarios valem de segunda a sexta.',
      ])
    }

    const vencidos = r.faltantes.filter((f) => f.vencido)
    const aguardando = r.faltantes.filter((f) => !f.vencido)

    if (!r.faltantes.length) {
      return elemento('div', { classe: 'aviso aviso--ok' }, [
        elemento('strong', { texto: 'Dia fechado. ' }),
        `Todos os ${r.cobrados} colaboradores cobrados fizeram o checklist.`,
      ])
    }

    const nomes = (lista) => lista.map((f) => elemento('span', { classe: 'selo s-critico' },
      [`${f.nome}${f.horario_limite ? ` · ate ${f.horario_limite}` : ''}`]))

    return elemento('div', { classe: 'aviso aviso--erro' }, [
      elemento('div', {}, [
        elemento('strong', {
          texto: vencidos.length
            ? `${vencidos.length} de ${r.cobrados} nao fizeram o checklist. `
            : 'Ninguem passou do prazo ainda. ',
        }),
        aguardando.length
          ? `${aguardando.length} ainda dentro do prazo.`
          : '',
      ]),
      vencidos.length
        ? elemento('div', { classe: 'card-detalhe esp-t-1' }, nomes(vencidos))
        : null,
    ].filter(Boolean))
  }

  function atualizarRotuloMes() {
    const d = new Date(`${filtros.de}T12:00:00`)
    const mesmoMes = filtros.de === iso(primeiroDoMes(d)) && filtros.ate === iso(ultimoDoMes(d))
    rotuloMes.textContent = mesmoMes ? `${MES[d.getMonth()]} de ${d.getFullYear()}` : ''
  }

  function irParaMes(delta) {
    const base = new Date(`${filtros.de}T12:00:00`)
    const alvo = new Date(base.getFullYear(), base.getMonth() + delta, 1)
    filtros.de = iso(primeiroDoMes(alvo))
    filtros.ate = iso(ultimoDoMes(alvo))
    recarregar()
  }

  function atalho(rotulo, calcular) {
    return elemento('button', {
      classe: 'botao botao--suave botao--pequeno', type: 'button', texto: rotulo,
      aoClick: () => { Object.assign(filtros, calcular()); recarregar() },
    })
  }

  function desenhar(lista) {
    if (!lista.length) {
      return vazio(filtros.de === hoje() && filtros.ate === hoje()
        ? 'Nenhum checklist feito hoje ainda.'
        : 'Nenhum checklist no periodo escolhido.')
    }

    return tabela(
      ['Quando', 'Colaborador', 'Veiculo', 'Checklist', 'KM', 'Tempo', 'Achados', ''],
      lista.map((e) => elemento('tr', {}, [
        elemento('td', { classe: 'celula-fraca dado' }, [
          elemento('div', { classe: 'celula-forte', texto: quando(e.finalizada_em || e.iniciada_em) }),
          elemento('div', { texto: `#${e.numero ?? '—'}` }),
        ]),
        elemento('td', {}, [
          elemento('div', { classe: 'celula-forte', texto: e.colaborador }),
          elemento('div', { classe: 'celula-fraca', texto: e.cargo || 'sem cargo' }),
        ]),
        elemento('td', {}, [
          elemento('div', { classe: 'celula-forte dado', texto: e.placa }),
          elemento('div', { classe: 'celula-fraca', texto: e.veiculo_modelo }),
        ]),
        elemento('td', { classe: 'celula-fraca' }, [
          elemento('div', { texto: e.checklist }),
          elemento('div', { classe: 'card-detalhe' }, [
            selo(e.momento === 'saida' ? 'saida' : 'retorno',
              e.momento === 'saida' ? 's-marca' : 's-neutro'),
            // "Avulso" e' o checklist diario de quem usa carro todo dia: nao
            // teve solicitacao por tras (roadmap 8.2).
            e.avulso ? selo('avulso', 's-neutro') : null,
            e.prazo === 'atrasado' ? selo('atrasado', 's-atencao') : null,
          ].filter(Boolean)),
        ]),
        elemento('td', { classe: 'celula-fraca dado', texto: e.km_informado ? numero(e.km_informado) : '—' }),
        elemento('td', { classe: 'celula-fraca dado', texto: duracao(e.duracao_segundos) }),
        elemento('td', {}, [
          elemento('div', { classe: 'card-detalhe' },
            e.total_problemas === 0
              ? [selo(`${e.total_conformes} conformes`, 's-ok')]
              : ['critica', 'alta', 'media', 'baixa']
                  .filter((p) => e[`prioridade_${p}`] > 0)
                  .map((p) => selo(`${e[`prioridade_${p}`]} ${ROTULO_PRIORIDADE[p].toLowerCase()}`,
                    TOM_PRIORIDADE[p]))),
        ]),
        elemento('td', { classe: 'celula-acoes' }, [
          elemento('a', {
            classe: 'botao botao--suave botao--pequeno',
            href: `/relatorio/inspecao/${e.id}`, target: '_blank', texto: 'Abrir',
          }),
        ]),
      ])))
  }

  const acoes = []
  if (contexto.ehFrota) {
    acoes.push(elemento('button', {
      classe: 'botao botao--suave', texto: 'Exportar planilha',
      // Exporta o que esta na tela, com os mesmos filtros. Exportar a base
      // inteira daria um arquivo que ninguem consegue conferir.
      aoClick: () => {
        window.open(api.urlPlanilha(filtros), '_blank')
        notificar('Planilha gerada com os filtros da tela.')
      },
    }))
  }

  raiz.append(
    cabecalhoTela({
      titulo: 'Checklists feitos',
      descricao: 'O que foi executado no periodo. Abre no dia de hoje.',
      acoes,
    }),

    elemento('div', { classe: 'filtros filtros--periodo' }, [
      elemento('div', { classe: 'periodo' }, [
        elemento('button', {
          classe: 'botao botao--suave botao--icone', type: 'button',
          'aria-label': 'Mes anterior', texto: '‹', aoClick: () => irParaMes(-1),
        }),
        elemento('div', { classe: 'periodo-campos' }, [
          elemento('label', { texto: 'De' }),
          campoDe,
          elemento('label', { texto: 'ate' }),
          campoAte,
        ]),
        elemento('button', {
          classe: 'botao botao--suave botao--icone', type: 'button',
          'aria-label': 'Proximo mes', texto: '›', aoClick: () => irParaMes(1),
        }),
        rotuloMes,
      ]),

      elemento('div', { classe: 'atalhos' }, [
        atalho('Hoje', () => ({ de: hoje(), ate: hoje() })),
        atalho('Ontem', () => {
          const d = iso(new Date(Date.now() - DIA))
          return { de: d, ate: d }
        }),
        atalho('Esta semana', () => {
          const agora = new Date()
          // Semana comeca na segunda: e' assim que a operacao conta o turno.
          const desloca = (agora.getDay() + 6) % 7
          return { de: iso(new Date(Date.now() - desloca * DIA)), ate: hoje() }
        }),
        atalho('Este mes', () => {
          const agora = new Date()
          return { de: iso(primeiroDoMes(agora)), ate: iso(ultimoDoMes(agora)) }
        }),
      ]),

      contexto.ehFrota
        ? elemento('select', {
            aoChange: (e) => { filtros.cargo_id = e.target.value; recarregar() },
          }, [
            elemento('option', { value: '', texto: 'Todos os colaboradores' }),
            ...cargos.map((c) => elemento('option', {
              value: c.id, texto: c.nome, selected: c.id === filtros.cargo_id,
            })),
          ])
        : null,
    ].filter(Boolean)),

    areaFaltando,
    resumo,
    areaLista,
  )

  campoDe.addEventListener('change', () => {
    filtros.de = campoDe.value
    // Escolher um inicio depois do fim e' engano de digitacao, nao intencao:
    // arrastar o fim junto evita a tela vazia com mensagem de erro.
    if (filtros.ate < filtros.de) filtros.ate = filtros.de
    recarregar()
  })
  campoAte.addEventListener('change', () => {
    filtros.ate = campoAte.value
    if (filtros.ate < filtros.de) filtros.de = filtros.ate
    recarregar()
  })

  await recarregar()
}
