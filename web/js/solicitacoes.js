// Solicitacao de veiculo (roadmap 10).
//
// Quem pede escolhe uma CATEGORIA DE USO — quantos lugares, que carroceria —
// porque e' isso que ele sabe: o trabalho que vai fazer. Ele nao conhece a
// frota e nao deveria precisar conhecer.
//
// A placa entra depois, escolhida pela Frota na liberacao. Esse e' o momento
// em que o pedido vira um carro concreto, e por isso liberar e escolher o
// veiculo sao o mesmo ato: aprovar sem dizer qual carro deixaria a pessoa de
// pe no patio sem saber o que pegar.
import { api } from './api.js'
import {
  elemento, cabecalhoTela, tabela, selo, vazio, avisoDeCorte, abrirModal, notificar, menuAcoes, dataHora,
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

// -------------------------------------------------------------- pedir

async function novaSolicitacao(recarregar) {
  const area = document.getElementById('area-modal')
  const { categorias } = await api.categorias()

  if (!categorias.length) {
    return notificar('Nenhuma categoria de uso cadastrada. A frota precisa criar as categorias antes.')
  }

  const inicio = elemento('input', { type: 'datetime-local',
    value: paraCampoLocal(Date.now() + 25 * 3600000) })
  const fim = elemento('input', { type: 'datetime-local',
    value: paraCampoLocal(Date.now() + 30 * 3600000) })

  const seletor = elemento('select', {}, categorias.map((c) => elemento('option', {
    value: c.id,
    texto: c.assentos ? `${c.nome} · ${c.assentos} lugares` : c.nome,
  })))

  const motivo = elemento('textarea', { rows: 3, placeholder: 'Ex.: reuniao com cliente em outra cidade' })
  const aviso = elemento('div', { classe: 'aviso aviso--erro oculto' })
  const dica = elemento('div', { classe: 'campo-dica' })

  // O unico aviso util aqui e' sobre a antecedencia. Disponibilidade de carro
  // e' assunto da Frota: mostrar "3 carros livres" ao solicitante criaria uma
  // promessa que quem decide nao fez.
  function conferirAntecedencia() {
    const horas = (new Date(inicio.value) - Date.now()) / 3600000
    dica.textContent = Number.isNaN(horas) ? ''
      : horas < 24
        ? `Faltam ${Math.max(0, horas).toFixed(1)}h para o inicio. O pedido deveria ter 24h de antecedencia — a frota pode nao conseguir atender.`
        : `Duracao ${duracao(inicio.value, fim.value)}. A frota escolhe o veiculo ao liberar.`
  }
  inicio.addEventListener('change', conferirAntecedencia)
  fim.addEventListener('change', conferirAntecedencia)

  const formulario = elemento('form', {
    classe: 'modal',
    aoSubmit: async (evento) => {
      evento.preventDefault()
      aviso.classList.add('oculto')
      try {
        const r = await api.criarSolicitacao({
          categoria_id: seletor.value,
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
      texto: 'Diga que tipo de carro o trabalho pede. A frota escolhe a placa e libera; a retirada exige checklist de saida.' }),
    aviso,
    elemento('div', { classe: 'campo' }, [
      elemento('label', { texto: 'Que carro o trabalho pede' }), seletor,
      elemento('div', { classe: 'campo-dica',
        texto: 'Escolha pela necessidade: numero de lugares e tipo de carroceria.' }),
    ]),
    elemento('div', { classe: 'linha-campos' }, [
      elemento('div', { classe: 'campo' }, [elemento('label', { texto: 'Inicio' }), inicio]),
      elemento('div', { classe: 'campo' }, [elemento('label', { texto: 'Fim' }), fim]),
    ]),
    elemento('div', { classe: 'campo' }, [dica]),
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
  conferirAntecedencia()
}

// ------------------------------------------------------------- liberar

// Aprovar e escolher a placa sao um ato so. A tela mostra os carros livres
// NAQUELA janela, com os da categoria pedida no topo.
async function liberar(s, recarregar) {
  const area = document.getElementById('area-modal')
  const { veiculos } = await api.veiculosLivres(s.janela_inicio, s.janela_fim, s.categoria_id)

  const daCategoria = veiculos.filter((v) => v.da_categoria)
  const outros = veiculos.filter((v) => !v.da_categoria)

  const seletor = elemento('select', {}, [
    elemento('option', { value: '', texto: veiculos.length ? 'Escolha o veiculo' : 'Nenhum veiculo livre nesta janela' }),
    ...(daCategoria.length
      ? [elemento('optgroup', { label: `Atendem "${s.categoria_nome || 'a categoria'}"` },
          daCategoria.map((v) => elemento('option', {
            value: v.id, texto: `${v.placa} — ${v.marca || ''} ${v.modelo}`.replace(/\s+/g, ' '),
          })))]
      : []),
    ...(outros.length
      ? [elemento('optgroup', { label: 'Fora da categoria pedida — exige justificativa' },
          outros.map((v) => elemento('option', {
            value: v.id, texto: `${v.placa} — ${v.marca || ''} ${v.modelo}`.replace(/\s+/g, ' '),
          })))]
      : []),
  ])

  const campoMotivo = elemento('div', { classe: 'campo oculto' }, [
    elemento('label', { texto: 'Por que este carro, fora da categoria pedida?' }),
    elemento('textarea', { rows: 2, placeholder: 'Ex.: sem utilitario livre; liberado compacto com aval do gestor.' }),
  ])
  const motivoTexto = campoMotivo.querySelector('textarea')
  const aviso = elemento('div', { classe: 'aviso aviso--erro oculto' })

  const idsDaCategoria = new Set(daCategoria.map((v) => v.id))
  seletor.addEventListener('change', () => {
    const fora = seletor.value && !idsDaCategoria.has(seletor.value)
    campoMotivo.classList.toggle('oculto', !fora)
  })

  const formulario = elemento('form', {
    classe: 'modal',
    aoSubmit: async (evento) => {
      evento.preventDefault()
      aviso.classList.add('oculto')
      try {
        await api.aprovarSolicitacao(s.id, seletor.value, motivoTexto.value.trim() || undefined)
        area.replaceChildren()
        const placa = veiculos.find((v) => v.id === seletor.value)?.placa
        notificar(`Solicitacao #${s.numero} liberada com o veiculo ${placa}.`)
        await recarregar()
      } catch (falha) {
        aviso.textContent = falha.message
        aviso.classList.remove('oculto')
      }
    },
  }, [
    elemento('h3', { texto: `Liberar solicitacao #${s.numero}` }),
    elemento('p', { classe: 'modal-sub',
      texto: `${s.solicitante_nome} pediu "${s.categoria_nome || 'sem categoria'}" para ${dataHora(s.janela_inicio)}.` }),
    aviso,
    elemento('div', { classe: 'campo' }, [
      elemento('label', { texto: 'Motivo do pedido' }),
      elemento('div', { classe: 'leitura', texto: s.motivo }),
    ]),
    elemento('div', { classe: 'campo' }, [
      elemento('label', { texto: 'Veiculo que sera entregue' }), seletor,
      elemento('div', { classe: 'campo-dica',
        texto: 'Livres nesta janela. O solicitante ve a placa assim que voce liberar.' }),
    ]),
    campoMotivo,
    elemento('div', { classe: 'modal-acoes' }, [
      elemento('button', { classe: 'botao botao--suave', type: 'button', texto: 'Cancelar',
        aoClick: () => area.replaceChildren() }),
      elemento('button', { classe: 'botao', type: 'submit', texto: 'Liberar veiculo' }),
    ]),
  ])

  area.replaceChildren(elemento('div', { classe: 'fundo-modal' }, [formulario]))
}

function recusar(s, recarregar) {
  abrirModal({
    titulo: `Recusar solicitacao #${s.numero}`,
    subtitulo: `${s.solicitante_nome} — ${s.categoria_nome || 'sem categoria'}`,
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

// --------------------------------------------------------------- tela

// Registrar a devolucao pela Frota. O prazo quem confere e' o servidor: a
// mesma rota que o aplicativo consulta antes de perguntar o motivo.
async function devolver(solicitacao, recarregar) {
  let conferencia
  try {
    conferencia = await api.conferirDevolucao(solicitacao.id)
  } catch (falha) {
    notificar(falha.message)
    return
  }

  abrirModal({
    titulo: `Registrar devolucao do pedido #${solicitacao.numero}`,
    subtitulo: conferencia.atrasada
      ? `${conferencia.mensagem} Passou ${minutosEmTexto(conferencia.minutos_de_atraso)} do prazo.`
      : 'Dentro do prazo. O veiculo volta a ficar disponivel, a menos que um '
        + 'checklist o tenha deixado bloqueado ou com pendencia.',
    campos: conferencia.exige_motivo
      ? [{ nome: 'motivo_atraso', rotulo: 'Motivo do atraso', tipo: 'textarea',
           obrigatorio: true,
           dica: 'Fica no historico do pedido e no relatorio. Quem devolveu nao '
               + 'esta aqui para explicar depois.' }]
      : [],
    confirmar: 'Registrar devolucao',
    aoConfirmar: async (valores) => {
      await api.devolver(solicitacao.id, valores.motivo_atraso || undefined)
      notificar(conferencia.atrasada
        ? 'Devolucao registrada com atraso justificado.'
        : 'Devolucao registrada.')
      await recarregar()
    },
  })
}

// "1h20" diz mais que "80 minutos" para quem esta olhando um atraso.
function minutosEmTexto(minutos) {
  if (minutos < 60) return `${minutos} min`
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`
}

export async function telaSolicitacoes(raiz, contexto) {
  const ehFrota = contexto.ehFrota
  const filtros = { status: contexto.parametros.status || '' }
  const areaLista = elemento('div', {})

  async function recarregar() {
    const r = await api.solicitacoes(filtros)
    areaLista.replaceChildren(...[
      avisoDeCorte(r, 'solicitacoes', 'Filtre por situacao para ver o resto.'),
      desenhar(r.solicitacoes, r.vejo_todas),
    ].filter(Boolean))
  }

  // Enquanto o pedido nao foi liberado, a coluna do veiculo mostra o que foi
  // PEDIDO. Mostrar um traco ali faria parecer que falta dado, quando na
  // verdade a decisao ainda nao foi tomada.
  function celulaVeiculo(s) {
    if (s.placa) {
      return elemento('td', {}, [
        elemento('div', { classe: 'celula-forte dado', texto: s.placa }),
        elemento('div', { classe: 'celula-fraca', texto: s.modelo }),
        s.motivo_categoria
          ? elemento('div', { classe: 'celula-fraca esp-t-1',
              texto: `Fora da categoria: ${s.motivo_categoria}` })
          : null,
      ].filter(Boolean))
    }
    return elemento('td', {}, [
      elemento('div', { classe: 'celula-fraca', texto: s.categoria_nome || 'sem categoria' }),
      elemento('div', { classe: 'card-detalhe' }, [selo('aguardando placa', 's-atencao')]),
    ])
  }

  function desenhar(lista, vejoTodas) {
    if (!lista.length) {
      return vazio(vejoTodas ? 'Nenhuma solicitacao com esses filtros.' : 'Voce ainda nao pediu nenhum veiculo.')
    }

    return tabela(['#', 'Veiculo', 'Solicitante', 'Janela', 'Motivo', 'Situacao', ''],
      lista.map((s) => {
        const acoes = []
        if (ehFrota && s.status === 'pendente') {
          acoes.push({ rotulo: 'Liberar veiculo', aoClick: () => liberar(s, recarregar) })
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
        // A devolucao normal e' registrada pelo motorista, no aplicativo, junto
        // com o checklist de retorno. Mas o servidor sempre permitiu que a
        // Frota registrasse tambem — e o painel nao tinha o botao.
        //
        // Sem ele, um carro cujo motorista ficou sem bateria, sem sinal ou sem
        // vinculo com a empresa fica `em_uso` para sempre: a placa segue
        // ocupada na agenda e `cancelar` nao alcanca esse estado.
        if (ehFrota && s.status === 'em_uso') {
          acoes.push({ rotulo: 'Registrar devolucao', aoClick: () => devolver(s, recarregar) })
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
          celulaVeiculo(s),
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
          ].filter(Boolean)),
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

  const acoes = []
  if (ehFrota) {
    acoes.push(elemento('button', {
      classe: 'botao botao--suave', texto: 'Categorias de uso',
      aoClick: () => contexto.irPara('categorias'),
    }))
  }
  acoes.push(elemento('button', { classe: 'botao', texto: '+ Solicitar veiculo',
    aoClick: () => novaSolicitacao(recarregar) }))

  raiz.append(
    cabecalhoTela({
      titulo: 'Solicitacoes de veiculo',
      descricao: ehFrota
        ? 'Pedidos da equipe. Pendentes de liberacao e devolucoes atrasadas aparecem primeiro.'
        : 'Seus pedidos de veiculo.',
      acoes,
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
