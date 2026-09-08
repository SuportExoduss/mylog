// Cadastro mestre da frota (roadmap 9).
// Nao existe condutor principal nem area de condutores: os carros trocam de
// mao o tempo todo e o controle de quem pega o carro e' fisico, pelo galpao.
import { api } from './api.js'
import {
  elemento, cabecalhoTela, tabela, selo, vazio, abrirModal, notificar, numero,
  menuAcoes, dataHora, dataCurta, descreverMudanca,
  ROTULO_STATUS_VEICULO, TOM_STATUS_VEICULO, ROTULO_TIPO_VEICULO,
} from './ui.js'

const TIPOS = Object.entries(ROTULO_TIPO_VEICULO).map(([valor, rotulo]) => ({ valor, rotulo }))
const OPCOES_STATUS = Object.entries(ROTULO_STATUS_VEICULO).map(([valor, rotulo]) => ({ valor, rotulo }))

function novoVeiculo(recarregar) {
  abrirModal({
    titulo: 'Novo veiculo',
    subtitulo: 'A placa identifica o ativo e nao podera ser alterada depois.',
    campos: [
      { nome: 'placa', rotulo: 'Placa', obrigatorio: true, dica: 'Formato ABC1D23 ou ABC1234.' },
      { nome: 'marca', rotulo: 'Marca' },
      { nome: 'modelo', rotulo: 'Modelo', obrigatorio: true },
      { nome: 'ano', rotulo: 'Ano', tipo: 'number' },
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: TIPOS, valor: 'compacto_leve',
        dica: 'Define quais checklists valem para este veiculo.' },
      { nome: 'km_atual', rotulo: 'Quilometragem atual', tipo: 'number', valor: '0' },
    ],
    confirmar: 'Cadastrar',
    aoConfirmar: async (v) => {
      await api.criarVeiculo(v)
      notificar('Veiculo cadastrado.')
      await recarregar()
    },
  })
}

// O KM entra aqui, digitavel, sem botao proprio nem tela separada (roadmap 9.2).
function editarVeiculo(veiculo, recarregar) {
  abrirModal({
    titulo: `Editar ${veiculo.placa}`,
    subtitulo: 'A placa nao muda: ela amarra todo o historico do ativo.',
    campos: [
      { nome: 'marca', rotulo: 'Marca', valor: veiculo.marca || '' },
      { nome: 'modelo', rotulo: 'Modelo', valor: veiculo.modelo, obrigatorio: true },
      { nome: 'ano', rotulo: 'Ano', tipo: 'number', valor: veiculo.ano ?? '' },
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: TIPOS, valor: veiculo.tipo },
      { nome: 'km_atual', rotulo: 'Quilometragem', tipo: 'number', valor: veiculo.km_atual,
        dica: 'A preventiva por KM depende deste numero.' },
      { nome: 'motivo_km', rotulo: 'Motivo da correcao de KM',
        dica: 'Exigido apenas se a quilometragem for menor que a registrada.',
        visivelQuando: (v) => Number(v.km_atual) < Number(veiculo.km_atual) },
    ],
    aoConfirmar: async (v) => {
      await api.atualizarVeiculo(veiculo.id, v)
      notificar('Cadastro atualizado.')
      await recarregar()
    },
  })
}

function mudarStatus(veiculo, recarregar) {
  abrirModal({
    titulo: `Status de ${veiculo.placa}`,
    subtitulo: veiculo.status === 'bloqueado'
      ? 'Este veiculo esta bloqueado. Liberar exige motivo — por exemplo, um diagnostico tecnico.'
      : 'O status controla se o veiculo pode ser reservado e operado.',
    campos: [
      { nome: 'status', rotulo: 'Novo status', tipo: 'select', opcoes: OPCOES_STATUS, valor: veiculo.status },
      { nome: 'motivo', rotulo: 'Motivo', tipo: 'textarea', valor: veiculo.motivo_status || '' },
    ],
    aoConfirmar: async (v) => {
      await api.statusVeiculo(veiculo.id, v.status, v.motivo)
      notificar('Status atualizado.')
      await recarregar()
    },
  })
}


async function verHistorico(veiculo, contexto) {
  // Duas perguntas na mesma tela, porque quem abre o historico de um carro
  // esta decidindo se libera ele: "o que ja aconteceu" e "o que ainda esta
  // em aberto". A segunda vem primeiro — e' ela que impede a liberacao.
  const [dados, ficha] = await Promise.all([
    api.historicoVeiculo(veiculo.id),
    api.veiculo(veiculo.id),
  ])
  const area = document.getElementById('area-modal')

  const irParaOcorrencias = () => {
    area.replaceChildren()
    contexto.irPara('ocorrencias', { veiculo: veiculo.id, placa: veiculo.placa })
  }

  const formulario = elemento('div', { classe: 'modal modal--largo' }, [
    elemento('h3', { texto: `Historico de ${veiculo.placa}` }),
    elemento('p', { classe: 'modal-sub', texto: `${veiculo.marca || ''} ${veiculo.modelo}`.trim() }),

    elemento('div', { classe: 'secao-titulo' }, [elemento('h2', { texto: 'Em aberto agora' })]),
    ficha.ocorrencias.length
      ? elemento('div', { classe: 'aviso aviso--erro' }, [
          elemento('div', {}, [
            elemento('strong', {
              texto: `${ficha.ocorrencias.length} ocorrencia(s) sem encerrar. `,
            }),
            'Enquanto isso, o carro carrega problema conhecido.',
          ]),
          elemento('div', { classe: 'card-detalhe esp-t-1' }, ficha.ocorrencias.map((o) =>
            selo(`${dataCurta(o.aberta_em)} · ${o.descricao}`,
              o.prioridade === 'critica' ? 's-critico'
                : o.prioridade === 'alta' ? 's-atencao' : 's-neutro'))),
          elemento('button', {
            classe: 'botao botao--suave botao--pequeno esp-t-1', type: 'button',
            texto: 'Abrir as ocorrencias deste veiculo',
            aoClick: irParaOcorrencias,
          }),
        ])
      : vazio('Nada em aberto para este veiculo.'),

    elemento('div', { classe: 'secao-titulo esp-t-4' }, [elemento('h2', { texto: 'Checklists' })]),
    dados.inspecoes.length
      ? tabela(['Quando', 'Momento', 'Quem', 'Resultado'], dados.inspecoes.map((i) =>
          elemento('tr', {}, [
            elemento('td', { classe: 'celula-fraca dado', texto: dataHora(i.finalizada_em) }),
            elemento('td', {}, [selo(i.momento === 'saida' ? 'Saida' : 'Retorno',
              i.momento === 'saida' ? 's-marca' : 's-neutro')]),
            elemento('td', { classe: 'celula-fraca', texto: i.usuario }),
            elemento('td', {}, [selo(i.resultado || '—',
              i.resultado === 'aprovado' ? 's-ok' : i.resultado === 'reprovado' ? 's-critico' : 's-atencao')]),
          ])))
      : vazio('Nenhum checklist ainda.'),
    elemento('div', { classe: 'secao-titulo esp-t-4' }, [elemento('h2', { texto: 'Alteracoes de cadastro' })]),
    dados.eventos.length
      ? tabela(['Quando', 'Quem', 'Acao', 'O que mudou'], dados.eventos.map((e) => elemento('tr', {}, [
          elemento('td', { classe: 'celula-fraca dado', texto: dataCurta(e.criado_em) }),
          elemento('td', { classe: 'celula-fraca', texto: e.ator_nome || 'sistema' }),
          elemento('td', {}, [elemento('span', { classe: 'celula-forte dado', texto: e.acao })]),
          elemento('td', { classe: 'celula-fraca', texto: descreverMudanca(e) }),
        ])))
      : vazio('Sem alteracoes.'),
    elemento('div', { classe: 'modal-acoes' }, [
      elemento('button', { classe: 'botao botao--suave', type: 'button', texto: 'Fechar',
        aoClick: () => area.replaceChildren() }),
    ]),
  ])
  area.replaceChildren(elemento('div', { classe: 'fundo-modal' }, [formulario]))
}

export async function telaVeiculos(raiz, contexto) {
  const podeEscrever = contexto.ehFrota
  const filtros = { status: contexto.parametros.status || '', tipo: '', busca: '' }
  const areaLista = elemento('div', {})

  async function recarregar() {
    const { veiculos } = await api.veiculos(filtros)
    areaLista.replaceChildren(desenhar(veiculos))
  }

  function desenhar(veiculos) {
    if (!veiculos.length) return vazio('Nenhum veiculo encontrado com esses filtros.')

    return tabela(['Placa', 'Veiculo', 'Tipo', 'KM', 'Status', ''], veiculos.map((v) => {
      const acoes = podeEscrever ? [
        { rotulo: 'Editar', aoClick: () => editarVeiculo(v, recarregar) },
        { rotulo: 'Alterar status', aoClick: () => mudarStatus(v, recarregar) },
        { rotulo: 'Historico', aoClick: () => verHistorico(v, contexto) },
      ] : []

      return elemento('tr', {}, [
        elemento('td', {}, [elemento('span', { classe: 'celula-forte dado', texto: v.placa })]),
        elemento('td', {}, [
          elemento('div', { texto: v.modelo }),
          elemento('div', { classe: 'celula-fraca',
            texto: [v.marca, v.ano].filter(Boolean).join(' · ') || '—' }),
        ]),
        elemento('td', { classe: 'celula-fraca', texto: ROTULO_TIPO_VEICULO[v.tipo] || v.tipo }),
        elemento('td', { classe: 'celula-fraca dado', texto: `${numero(v.km_atual)} km` }),
        elemento('td', {}, [
          selo(ROTULO_STATUS_VEICULO[v.status], TOM_STATUS_VEICULO[v.status]),
          v.motivo_status
            ? elemento('div', { classe: 'celula-fraca esp-t-1 limite-texto-curto', texto: v.motivo_status })
            : null,
        ]),
        elemento('td', { classe: 'celula-acoes' }, [menuAcoes(acoes)]),
      ])
    }))
  }

  raiz.append(
    cabecalhoTela({
      titulo: 'Frota',
      descricao: 'Cadastro mestre dos veiculos. Quem opera cada carro vem da solicitacao, nao daqui.',
      acoes: podeEscrever
        ? [elemento('button', { classe: 'botao', texto: '+ Novo veiculo', aoClick: () => novoVeiculo(recarregar) })]
        : [],
    }),
    elemento('div', { classe: 'filtros' }, [
      elemento('input', { type: 'search', placeholder: 'Buscar por placa, modelo ou marca',
        aoInput: (e) => { filtros.busca = e.target.value; recarregar() } }),
      elemento('select', { aoChange: (e) => { filtros.status = e.target.value; recarregar() } }, [
        elemento('option', { value: '', texto: 'Todos os status' }),
        ...OPCOES_STATUS.map((o) => elemento('option', { value: o.valor, texto: o.rotulo,
          selected: o.valor === filtros.status })),
      ]),
      elemento('select', { aoChange: (e) => { filtros.tipo = e.target.value; recarregar() } }, [
        elemento('option', { value: '', texto: 'Todos os tipos' }),
        ...TIPOS.map((t) => elemento('option', { value: t.valor, texto: t.rotulo })),
      ]),
    ]),
    areaLista,
  )

  await recarregar()
}
