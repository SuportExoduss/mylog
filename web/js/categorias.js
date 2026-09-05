// Categorias de uso (roadmap 10.3).
//
// E' o vocabulario com que o colaborador pede carro: "4 assentos comercial".
// Ele descreve o TRABALHO. O tipo do veiculo — compacto, pick-up, 4x4 — e'
// propriedade do carro e continua decidindo qual checklist aparece. Os dois
// nao se convertem um no outro, e esta tela existe para manter essa fronteira
// visivel: aqui se diz quais carros ATENDEM cada categoria, e nada mais.
import { api } from './api.js'
import {
  elemento, cabecalhoTela, tabela, selo, vazio, abrirModal, notificar, menuAcoes,
} from './ui.js'

const CARROCERIAS = [
  { valor: 'compacto', rotulo: 'Compacto' },
  { valor: 'comercial', rotulo: 'Comercial' },
  { valor: 'utilitario', rotulo: 'Utilitario' },
]

const ROTULO_CARROCERIA = Object.fromEntries(CARROCERIAS.map((c) => [c.valor, c.rotulo]))

function formulario(categoria, recarregar) {
  const nova = !categoria
  abrirModal({
    titulo: nova ? 'Nova categoria de uso' : `Editar ${categoria.nome}`,
    subtitulo: 'Descreve a necessidade de transporte, nao o carro.',
    campos: [
      { nome: 'nome', rotulo: 'Nome', obrigatorio: true, valor: categoria?.nome || '',
        dica: 'E o que o colaborador vai ler na hora de pedir. Ex.: 4 assentos — comercial.' },
      { nome: 'assentos', rotulo: 'Assentos', tipo: 'number', valor: categoria?.assentos ?? '' },
      { nome: 'carroceria', rotulo: 'Carroceria', tipo: 'select',
        opcoes: [{ valor: '', rotulo: 'Nao especificar' }, ...CARROCERIAS],
        valor: categoria?.carroceria || '' },
    ],
    confirmar: nova ? 'Criar categoria' : 'Salvar',
    aoConfirmar: async (v) => {
      const dados = { nome: v.nome, assentos: v.assentos, carroceria: v.carroceria }
      if (nova) await api.criarCategoria(dados)
      else await api.salvarCategoria(categoria.id, dados)
      notificar(nova ? 'Categoria criada.' : 'Categoria atualizada.')
      await recarregar()
    },
  })
}

// Marcar os carros de uma categoria e' uma decisao por lista, nao por item:
// a tela salva o conjunto inteiro de uma vez, como a pessoa pensa.
async function escolherVeiculos(categoria, recarregar) {
  const { veiculos } = await api.veiculosDaCategoria(categoria.id)
  const area = document.getElementById('area-modal')
  const marcados = new Set(veiculos.filter((v) => v.atende).map((v) => v.id))

  const linhas = veiculos.map((v) => {
    const caixa = elemento('input', { type: 'checkbox' })
    caixa.checked = marcados.has(v.id)
    caixa.addEventListener('change', () => {
      if (caixa.checked) marcados.add(v.id); else marcados.delete(v.id)
      contador.textContent = `${marcados.size} veiculo(s) nesta categoria`
    })
    return elemento('label', { classe: 'escolha' }, [
      caixa,
      elemento('span', { classe: 'dado celula-forte', texto: v.placa }),
      elemento('span', { classe: 'celula-fraca', texto: `${v.marca || ''} ${v.modelo}`.trim() }),
    ])
  })

  const contador = elemento('div', {
    classe: 'campo-dica', texto: `${marcados.size} veiculo(s) nesta categoria`,
  })

  const formulario = elemento('form', {
    classe: 'modal modal--alto',
    aoSubmit: async (evento) => {
      evento.preventDefault()
      await api.definirVeiculosDaCategoria(categoria.id, [...marcados])
      area.replaceChildren()
      notificar(`${marcados.size} veiculo(s) atendem "${categoria.nome}".`)
      await recarregar()
    },
  }, [
    elemento('h3', { texto: `Veiculos de "${categoria.nome}"` }),
    elemento('p', { classe: 'modal-sub',
      texto: 'A Frota so consegue liberar estes carros para quem pedir esta categoria — os outros exigem justificativa.' }),
    contador,
    linhas.length
      ? elemento('div', { classe: 'escolhas' }, linhas)
      : vazio('Nenhum veiculo cadastrado ainda.'),
    elemento('div', { classe: 'modal-acoes' }, [
      elemento('button', { classe: 'botao botao--suave', type: 'button', texto: 'Cancelar',
        aoClick: () => area.replaceChildren() }),
      elemento('button', { classe: 'botao', type: 'submit', texto: 'Salvar lista' }),
    ]),
  ])

  area.replaceChildren(elemento('div', { classe: 'fundo-modal' }, [formulario]))
}

export async function telaCategorias(raiz, contexto) {
  const areaLista = elemento('div', {})

  async function recarregar() {
    const { categorias } = await api.categorias({ todas: '1' })
    areaLista.replaceChildren(desenhar(categorias))
  }

  function desenhar(lista) {
    if (!lista.length) {
      return vazio('Nenhuma categoria ainda. Sem elas, ninguem consegue pedir carro.')
    }

    return tabela(['Categoria', 'Assentos', 'Carroceria', 'Veiculos', 'Situacao', ''],
      lista.map((c) => elemento('tr', {}, [
        elemento('td', {}, [elemento('span', { classe: 'celula-forte', texto: c.nome })]),
        elemento('td', { classe: 'celula-fraca dado', texto: c.assentos ?? '—' }),
        elemento('td', { classe: 'celula-fraca', texto: ROTULO_CARROCERIA[c.carroceria] || '—' }),
        elemento('td', {}, [
          c.veiculos > 0
            ? selo(`${c.veiculos} veiculo(s)`, 's-neutro')
            // Categoria sem carro nenhum e' pedido garantido que a Frota nao
            // consegue atender sem justificar. Melhor gritar aqui.
            : selo('nenhum veiculo', 's-atencao'),
        ]),
        elemento('td', {}, [
          selo(c.ativo ? 'ativa' : 'inativa', c.ativo ? 's-ok' : 's-neutro'),
        ]),
        elemento('td', { classe: 'celula-acoes' }, [menuAcoes([
          { rotulo: 'Editar', aoClick: () => formulario(c, recarregar) },
          { rotulo: 'Veiculos que atendem', aoClick: () => escolherVeiculos(c, recarregar) },
          { rotulo: c.ativo ? 'Desativar' : 'Reativar', separar: true, aoClick: async () => {
            await api.salvarCategoria(c.id, { ativo: !c.ativo })
            notificar(c.ativo
              ? 'Categoria desativada. Some do formulario de pedido; o historico fica.'
              : 'Categoria reativada.')
            await recarregar()
          } },
          { rotulo: 'Remover', perigo: true, aoClick: async () => {
            try {
              await api.removerCategoria(c.id)
              notificar('Categoria removida.')
              await recarregar()
            } catch (falha) { notificar(falha.message) }
          } },
        ])]),
      ])))
  }

  raiz.append(
    cabecalhoTela({
      titulo: 'Categorias de uso',
      descricao: 'O que o colaborador escolhe ao pedir carro. Ele descreve o trabalho; a Frota escolhe a placa.',
      acoes: [elemento('button', { classe: 'botao', texto: '+ Nova categoria',
        aoClick: () => formulario(null, recarregar) })],
    }),
    areaLista,
  )

  await recarregar()
}
