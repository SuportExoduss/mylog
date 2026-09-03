// Solicitacao de veiculo (roadmap 10).
// Reserva de carro com janela de horario — nao e' chamado de suporte.
import { api } from './api.js'
import {
  elemento, cabecalhoTela, tabela, selo, vazio, abrirModal, notificar, menuAcoes, dataHora,
  ROTULO_STATUS_SOLICITACAO, TOM_STATUS_SOLICITACAO,
} from './ui.js'

// Valor para <input type="datetime-local">, que trabalha em hora local.
function paraCampoLocal(data) {
  const d = new Date(data)
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function duracao(inicio, fim) {
  const horas = (new Date(fim) - new Date(inicio)) / 3600000
  if (horas < 1) return `${Math.round(horas * 60)} min`
  if (horas < 24) return `${Number(horas.toFixed(1))} h`
  return `${Math.round(horas / 24)} dia(s)`
}

// A tela de pedido lista so os veiculos livres NAQUELA janela — pedir um carro
// que ja esta reservado e' frustracao garantida no balcao.
async function novaSolicitacao(recarregar) {
  const area = document.getElementById('area-modal')

  const inicio = elemento('input', { type: 'datetime-local',
    value: paraCampoLocal(Date.now() + 25 * 3600000) })
  const fim = elemento('input', { type: 'datetime-local',
    value: paraCampoLocal(Date.now() + 30 * 3600000) })
  const seletor = elemento('select', {}, [elemento('option', { value: '', texto: 'Escolha a janela primeiro' })])
  const motivo = elemento('textarea', { rows: 3, placeholder: 'Ex.: reuniao com cliente em outra cidade' })
  const aviso = elemento('div', { classe: 'aviso aviso--erro oculto' })
  const dica = elemento('div', { classe: 'campo-dica' })

  async function buscarLivres() {
    seletor.replaceChildren(elemento('option', { value: '', texto: 'Procurando...' }))
    try {
      const { veiculos } = await api.veiculosLivres(
        new Date(inicio.value).toISOString(), new Date(fim.value).toISOString())
      seletor.replaceChildren(
        elemento('option', { value: '', texto: veiculos.length ? 'Selecione o veiculo' : 'Nenhum veiculo livre nessa janela' }),
        ...veiculos.map((v) => elemento('option', { value: v.id, texto: `${v.placa} — ${v.modelo}` })),
      )
      const horas = (new Date(inicio.value) - Date.now()) / 3600000
      dica.textContent = horas < 24
        ? `Faltam ${Math.max(0, horas).toFixed(1)}h para o inicio. O pedido deveria ter 24h de antecedencia — a frota pode nao conseguir atender.`
        : `${veiculos.length} veiculo(s) livre(s) nessa janela · duracao ${duracao(inicio.value, fim.value)}`
    } catch (falha) {
      seletor.replaceChildren(elemento('option', { value: '', texto: 'Janela invalida' }))
      dica.textContent = falha.message
    }
  }

  inicio.addEventListener('change', buscarLivres)
  fim.addEventListener('change', buscarLivres)

  const formulario = elemento('form', {
    classe: 'modal',
    aoSubmit: async (evento) => {
      evento.preventDefault()
      aviso.classList.add('oculto')
      try {
        const r = await api.criarSolicitacao({
          veiculo_id: seletor.value,
          janela_inicio: new Date(inicio.value).toISOString(),
          janela_fim: new Date(fim.value).toISOString(),
          motivo: motivo.value.trim(),
        })
        area.replaceChildren()
        notificar(r.aviso_antecedencia || `Solicitacao #${r.solicitacao.numero} enviada para a frota.`)
        await recarregar()
      } catch (falha) {
        aviso.textContent = falha.message
        aviso.classList.remove('oculto')
      }
    },
  }, [
    elemento('h3', { texto: 'Solicitar veiculo' }),
    elemento('p', { classe: 'modal-sub',
      texto: 'A frota aprova e o veiculo fica reservado na janela. A retirada exige checklist de saida.' }),
    aviso,
    elemento('div', { classe: 'linha-campos' }, [
      elemento('div', { classe: 'campo' }, [elemento('label', { texto: 'Inicio' }), inicio]),
      elemento('div', { classe: 'campo' }, [elemento('label', { texto: 'Fim' }), fim]),
    ]),
    elemento('div', { classe: 'campo' }, [
      elemento('label', { texto: 'Veiculo' }), seletor, dica,
    ]),
    elemento('div', { classe: 'campo' }, [
      elemento('label', { texto: 'Motivo' }), motivo,
      elemento('div', { classe: 'campo-dica', texto: 'A frota le isto para decidir. Seja especifico.' }),
    ]),
    elemento('div', { classe: 'modal-acoes' }, [
      elemento('button', { classe: 'botao botao--suave', type: 'button', texto: 'Cancelar',
        aoClick: () => area.replaceChildren() }),
      elemento('button', { classe: 'botao', type: 'submit', texto: 'Enviar pedido' }),
    ]),
  ])

  area.replaceChildren(elemento('div', { classe: 'fundo-modal' }, [formulario]))
  await buscarLivres()
}

function recusar(s, recarregar) {
  abrirModal({
    titulo: `Recusar solicitacao #${s.numero}`,
    subtitulo: `${s.solicitante_nome} — ${s.placa}`,
    campos: [{ nome: 'motivo', rotulo: 'Motivo da recusa', tipo: 'textarea', obrigatorio: true,
      dica: 'O solicitante ve este texto. Sem ele, ele nao sabe o que corrigir.' }],
    confirmar: 'Recusar',
    perigo: true,
    aoConfirmar: async (v) => {
      await api.recusarSolicitacao(s.id, v.motivo)
      notificar('Solicitacao recusada.')
      await recarregar()
    },
  })
}

export async function telaSolicitacoes(raiz, contexto) {
  const ehFrota = contexto.ehFrota
  const filtros = { status: contexto.parametros.status || '' }
  const areaLista = elemento('div', {})

  async function recarregar() {
    const { solicitacoes, vejo_todas } = await api.solicitacoes(filtros)
    areaLista.replaceChildren(desenhar(solicitacoes, vejo_todas))
  }

  function desenhar(lista, vejoTodas) {
    if (!lista.length) {
      return vazio(vejoTodas ? 'Nenhuma solicitacao com esses filtros.' : 'Voce ainda nao pediu nenhum veiculo.')
    }

    return tabela(['#', 'Veiculo', 'Solicitante', 'Janela', 'Motivo', 'Situacao', ''],
      lista.map((s) => {
        const acoes = []
        if (ehFrota && s.status === 'pendente') {
          acoes.push({ rotulo: 'Aprovar', aoClick: async () => {
            try {
              await api.aprovarSolicitacao(s.id)
              notificar(`Solicitacao #${s.numero} aprovada. O veiculo esta reservado.`)
              await recarregar()
            } catch (falha) { notificar(falha.message) }
          } })
          acoes.push({ rotulo: 'Recusar', perigo: true, aoClick: () => recusar(s, recarregar) })
        }
        // O comparativo so faz sentido depois da saida; e' o documento que
        // prova dano novo em vez de discutir.
        if (ehFrota && s.inspecao_saida) {
          acoes.push({
            rotulo: s.inspecao_retorno ? 'Comparativo saida x retorno' : 'Relatorio da saida',
            separar: true,
            aoClick: () => window.open(`/relatorio/solicitacao/${s.id}`, '_blank'),
          })
        }
        if (['pendente', 'aprovada'].includes(s.status)) {
          acoes.push({ rotulo: 'Cancelar', perigo: true, separar: true, aoClick: async () => {
            try {
              await api.cancelarSolicitacao(s.id)
              notificar('Solicitacao cancelada.')
              await recarregar()
            } catch (falha) { notificar(falha.message) }
          } })
        }

        return elemento('tr', {}, [
          elemento('td', {}, [elemento('span', { classe: 'celula-forte dado', texto: `#${s.numero}` })]),
          elemento('td', {}, [
            elemento('div', { classe: 'celula-forte dado', texto: s.placa }),
            elemento('div', { classe: 'celula-fraca', texto: s.modelo }),
          ]),
          elemento('td', { classe: 'celula-fraca', texto: s.solicitante_nome }),
          elemento('td', { classe: 'celula-fraca dado' }, [
            elemento('div', { texto: dataHora(s.janela_inicio) }),
            elemento('div', { texto: `ate ${dataHora(s.janela_fim)}` }),
            elemento('div', { classe: 'celula-fraca', texto: duracao(s.janela_inicio, s.janela_fim) }),
          ]),
          elemento('td', { classe: 'celula-fraca limite-texto' }, [
            elemento('div', { texto: s.motivo }),
            s.motivo_recusa ? elemento('div', { classe: 'esp-t-1', texto: `Recusa: ${s.motivo_recusa}` }) : null,
            s.motivo_atraso ? elemento('div', { classe: 'esp-t-1', texto: `Atraso: ${s.motivo_atraso}` }) : null,
          ]),
          elemento('td', {}, [
            elemento('div', { classe: 'card-detalhe' }, [
              selo(ROTULO_STATUS_SOLICITACAO[s.status], TOM_STATUS_SOLICITACAO[s.status]),
              s.atrasada ? selo('devolucao atrasada', 's-critico') : null,
            ].filter(Boolean)),
          ]),
          elemento('td', { classe: 'celula-acoes' }, [menuAcoes(acoes)]),
        ])
      }))
  }

  raiz.append(
    cabecalhoTela({
      titulo: 'Solicitacoes de veiculo',
      descricao: ehFrota
        ? 'Pedidos da equipe. Pendentes de aprovacao e devolucoes atrasadas aparecem primeiro.'
        : 'Seus pedidos de veiculo.',
      acoes: [elemento('button', { classe: 'botao', texto: '+ Solicitar veiculo',
        aoClick: () => novaSolicitacao(recarregar) })],
    }),
    elemento('div', { classe: 'filtros' }, [
      elemento('select', { aoChange: (e) => { filtros.status = e.target.value; recarregar() } }, [
        elemento('option', { value: '', texto: 'Todas' }),
        ...Object.entries(ROTULO_STATUS_SOLICITACAO).map(([valor, rotulo]) =>
          elemento('option', { value: valor, texto: rotulo, selected: valor === filtros.status })),
      ]),
    ]),
    areaLista,
  )

  await recarregar()
}
