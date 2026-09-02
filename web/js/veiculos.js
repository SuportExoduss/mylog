// Cadastro mestre da frota e vinculo usuario-veiculo (secoes 9 e 13).
import { api } from './api.js'
import {
  elemento, cabecalhoTela, tabela, selo, vazio, abrirModal, notificar, numero,
  ROTULO_STATUS_VEICULO, TOM_STATUS_VEICULO,
} from './ui.js'

const TIPOS = [
  { valor: 'carro', rotulo: 'Carro' },
  { valor: 'caminhao', rotulo: 'Caminhao' },
  { valor: 'van', rotulo: 'Van' },
  { valor: 'moto', rotulo: 'Moto' },
  { valor: 'maquina', rotulo: 'Maquina' },
]

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
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: TIPOS, valor: 'carro' },
      { nome: 'km_atual', rotulo: 'Quilometragem atual', tipo: 'number', valor: '0' },
    ],
    confirmar: 'Cadastrar',
    aoConfirmar: async (valores) => {
      await api.criarVeiculo(valores)
      notificar('Veiculo cadastrado.')
      await recarregar()
    },
  })
}

function editarVeiculo(veiculo, recarregar) {
  abrirModal({
    titulo: `Editar ${veiculo.placa}`,
    campos: [
      { nome: 'marca', rotulo: 'Marca', valor: veiculo.marca || '' },
      { nome: 'modelo', rotulo: 'Modelo', valor: veiculo.modelo, obrigatorio: true },
      { nome: 'ano', rotulo: 'Ano', tipo: 'number', valor: veiculo.ano ?? '' },
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: TIPOS, valor: veiculo.tipo },
    ],
    aoConfirmar: async (valores) => {
      await api.atualizarVeiculo(veiculo.id, valores)
      notificar('Cadastro atualizado.')
      await recarregar()
    },
  })
}

function mudarStatusVeiculo(veiculo, recarregar) {
  abrirModal({
    titulo: `Status de ${veiculo.placa}`,
    subtitulo: 'O status controla se o veiculo pode operar.',
    campos: [
      { nome: 'status', rotulo: 'Novo status', tipo: 'select', opcoes: OPCOES_STATUS, valor: veiculo.status },
      { nome: 'motivo', rotulo: 'Motivo', tipo: 'textarea', valor: veiculo.motivo_status || '',
        dica: 'Obrigatorio para liberar um veiculo que esta bloqueado.' },
    ],
    aoConfirmar: async (valores) => {
      await api.statusVeiculo(veiculo.id, valores.status, valores.motivo)
      notificar('Status atualizado.')
      await recarregar()
    },
  })
}

function atualizarKm(veiculo, recarregar) {
  abrirModal({
    titulo: `Quilometragem de ${veiculo.placa}`,
    subtitulo: `Registro atual: ${numero(veiculo.km_atual)} km. A preventiva por KM depende deste numero.`,
    campos: [
      { nome: 'km_atual', rotulo: 'Quilometragem', tipo: 'number', valor: veiculo.km_atual, obrigatorio: true },
      { nome: 'motivo', rotulo: 'Motivo da correcao', dica: 'Exigido apenas se o valor for menor que o atual.' },
    ],
    confirmar: 'Registrar',
    aoConfirmar: async (valores) => {
      await api.atualizarKm(veiculo.id, Number(valores.km_atual), valores.motivo)
      notificar('Quilometragem registrada.')
      await recarregar()
    },
  })
}

// O vinculo e' camada de autorizacao, nao detalhe de cadastro (secao 9).
async function gerenciarCondutores(veiculo, recarregar) {
  const [{ condutores }, { usuarios }] = await Promise.all([
    api.veiculo(veiculo.id),
    api.usuarios({ status: 'ativo' }),
  ])

  const area = document.getElementById('area-modal')
  const lista = elemento('div', {})

  function desenharLista(atuais) {
    lista.replaceChildren(
      atuais.length
        ? elemento('div', { classe: 'tabela-caixa' }, [
            elemento('table', {}, [elemento('tbody', {}, atuais.map((c) =>
              elemento('tr', {}, [
                elemento('td', {}, [
                  elemento('div', { classe: 'celula-forte', texto: c.nome }),
                  c.principal ? elemento('div', { classe: 'celula-fraca', texto: 'Condutor principal' }) : null,
                ]),
                elemento('td', {}, [elemento('div', { classe: 'linha linha--fim' }, [
                  elemento('button', {
                    classe: 'botao botao--suave botao--mini', type: 'button', texto: 'Remover',
                    aoClick: async (evento) => {
                      evento.preventDefault()
                      await api.removerVinculo(c.vinculo_id)
                      const atualizado = await api.veiculo(veiculo.id)
                      desenharLista(atualizado.condutores)
                      notificar('Autorizacao revogada.')
                      await recarregar()
                    },
                  }),
                ])]),
              ])))]),
          ])
        : vazio('Nenhum condutor autorizado. Sem vinculo, o app recusa a inspecao.'),
    )
  }
  desenharLista(condutores)

  const seletor = elemento('select', {}, [
    elemento('option', { value: '', texto: 'Selecione um usuario ativo' }),
    ...usuarios.map((u) => elemento('option', { value: u.id, texto: `${u.nome} (${u.email})` })),
  ])
  const marcaPrincipal = elemento('input', { type: 'checkbox', id: 'vinc-principal' })

  const formulario = elemento('form', { classe: 'modal' }, [
    elemento('h3', { texto: `Condutores de ${veiculo.placa}` }),
    elemento('p', { classe: 'modal-sub', texto: `${veiculo.marca || ''} ${veiculo.modelo}`.trim() }),
    lista,
    elemento('div', { classe: 'campo esp-t-4' }, [
      elemento('label', { texto: 'Autorizar novo condutor' }),
      seletor,
    ]),
    elemento('label', { classe: 'campo-linha' }, [
      marcaPrincipal, 'Definir como condutor principal',
    ]),
    elemento('div', { classe: 'modal-acoes' }, [
      elemento('button', {
        classe: 'botao botao--suave', type: 'button', texto: 'Fechar',
        aoClick: () => { area.replaceChildren(); recarregar() },
      }),
      elemento('button', {
        classe: 'botao', type: 'button', texto: 'Autorizar',
        aoClick: async () => {
          if (!seletor.value) return
          try {
            await api.criarVinculo({
              usuario_id: seletor.value, veiculo_id: veiculo.id, principal: marcaPrincipal.checked,
            })
            const atualizado = await api.veiculo(veiculo.id)
            desenharLista(atualizado.condutores)
            seletor.value = ''
            marcaPrincipal.checked = false
            notificar('Condutor autorizado.')
            await recarregar()
          } catch (falha) { notificar(falha.message) }
        },
      }),
    ]),
  ])

  const fundo = elemento('div', {
    classe: 'fundo-modal',
    aoClick: (evento) => { if (evento.target === fundo) { area.replaceChildren(); recarregar() } },
  }, [formulario])
  area.replaceChildren(fundo)
}

export async function telaVeiculos(raiz, contexto) {
  const podeEscrever = contexto.pode('veiculos.escrever')
  const podeVincular = contexto.pode('vinculos.escrever')

  const filtros = { status: contexto.parametros.status || '', busca: '' }
  const areaLista = elemento('div', {})

  async function recarregar() {
    const { veiculos } = await api.veiculos(filtros)
    areaLista.replaceChildren(desenhar(veiculos))
  }

  function desenhar(veiculos) {
    if (!veiculos.length) return vazio('Nenhum veiculo encontrado com esses filtros.')

    return tabela(['Placa', 'Veiculo', 'Condutor principal', 'KM', 'Status', ''], veiculos.map((veiculo) => {
      const acoes = []
      if (podeVincular) {
        acoes.push(elemento('button', {
          classe: 'botao botao--suave botao--mini', texto: 'Condutores',
          aoClick: () => gerenciarCondutores(veiculo, recarregar),
        }))
      }
      if (podeEscrever) {
        acoes.push(elemento('button', {
          classe: 'botao botao--suave botao--mini', texto: 'KM',
          aoClick: () => atualizarKm(veiculo, recarregar),
        }))
        acoes.push(elemento('button', {
          classe: 'botao botao--suave botao--mini', texto: 'Status',
          aoClick: () => mudarStatusVeiculo(veiculo, recarregar),
        }))
        acoes.push(elemento('button', {
          classe: 'botao botao--suave botao--mini', texto: 'Editar',
          aoClick: () => editarVeiculo(veiculo, recarregar),
        }))
      }

      return elemento('tr', {}, [
        elemento('td', {}, [elemento('span', { classe: 'celula-forte dado', texto: veiculo.placa })]),
        elemento('td', {}, [
          elemento('div', { texto: veiculo.modelo }),
          elemento('div', { classe: 'celula-fraca',
            texto: [veiculo.marca, veiculo.ano].filter(Boolean).join(' · ') || '—' }),
        ]),
        elemento('td', { classe: 'celula-fraca', texto: veiculo.usuario_principal_nome || 'sem condutor' }),
        elemento('td', { classe: 'celula-fraca dado', texto: `${numero(veiculo.km_atual)} km` }),
        elemento('td', {}, [
          selo(ROTULO_STATUS_VEICULO[veiculo.status], TOM_STATUS_VEICULO[veiculo.status]),
          veiculo.motivo_status
            ? elemento('div', { classe: 'celula-fraca esp-t-1 limite-texto-curto',
                texto: veiculo.motivo_status })
            : null,
        ]),
        elemento('td', {}, [elemento('div', { classe: 'linha linha--fim' }, acoes)]),
      ])
    }))
  }

  const campoBusca = elemento('input', {
    type: 'search', placeholder: 'Buscar por placa, modelo ou marca',
    aoInput: (evento) => { filtros.busca = evento.target.value; recarregar() },
  })
  const seletorStatus = elemento('select', {
    aoChange: (evento) => { filtros.status = evento.target.value; recarregar() },
  }, [
    elemento('option', { value: '', texto: 'Todos os status' }),
    ...OPCOES_STATUS.map((op) =>
      elemento('option', { value: op.valor, texto: op.rotulo, selected: op.valor === filtros.status })),
  ])

  raiz.append(
    cabecalhoTela({
      titulo: 'Frota',
      descricao: 'Cadastro mestre dos veiculos e quem esta autorizado a operar cada um.',
      acoes: podeEscrever
        ? [elemento('button', { classe: 'botao', texto: '+ Novo veiculo', aoClick: () => novoVeiculo(recarregar) })]
        : [],
    }),
    elemento('div', { classe: 'filtros' }, [campoBusca, seletorStatus]),
    areaLista,
  )

  await recarregar()
}
