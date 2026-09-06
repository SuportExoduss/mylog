// Usuarios e cargos (roadmap 8).
// A Frota cadastra; o colaborador ativa a si mesmo trocando a senha inicial.
import { api } from './api.js'
import {
  elemento, cabecalhoTela, tabela, selo, vazio, abrirModal, notificar, menuAcoes,
  dataCurta, dataHora, cpfFormatado,
  ROTULO_STATUS_USUARIO, TOM_STATUS_USUARIO, ROTULO_NIVEL,
  ROTULO_STATUS_SOLICITACAO, TOM_STATUS_SOLICITACAO,
} from './ui.js'

let cargosEmCache = null

async function carregarCargos({ recarregar = false } = {}) {
  if (!cargosEmCache || recarregar) cargosEmCache = (await api.cargos()).cargos
  return cargosEmCache
}

// A senha inicial volta uma unica vez, para a Frota repassar. Nao fica em log
// nem em auditoria — por isso a tela precisa deixar copiar antes de fechar.
function mostrarSenha({ titulo, nome, email, senha }) {
  const campo = elemento('input', { classe: 'dado', readonly: true, value: senha })
  const area = document.getElementById('area-modal')

  const formulario = elemento('form', { classe: 'modal' }, [
    elemento('h3', { texto: titulo }),
    elemento('p', { classe: 'modal-sub', texto: `${nome} — ${email}` }),
    elemento('div', { classe: 'aviso aviso--info',
      texto: 'Esta senha aparece uma vez so. Repasse agora: no primeiro acesso a troca e obrigatoria.' }),
    elemento('div', { classe: 'campo' }, [
      elemento('label', { texto: 'Senha inicial' }),
      campo,
    ]),
    elemento('div', { classe: 'modal-acoes' }, [
      elemento('button', {
        classe: 'botao botao--suave', type: 'button', texto: 'Copiar',
        aoClick: async () => {
          try { await navigator.clipboard.writeText(senha); notificar('Senha copiada.') }
          catch { campo.select(); notificar('Selecione e copie manualmente.') }
        },
      }),
      elemento('button', {
        classe: 'botao', type: 'button', texto: 'Ja repassei',
        aoClick: () => area.replaceChildren(),
      }),
    ]),
  ])
  area.replaceChildren(elemento('div', { classe: 'fundo-modal' }, [formulario]))
}

async function formularioNovoUsuario(recarregar) {
  const cargos = await carregarCargos()
  if (!cargos.length) {
    notificar('Cadastre um cargo antes de criar usuarios.')
    return
  }

  abrirModal({
    titulo: 'Novo usuario',
    subtitulo: 'O sistema gera a senha inicial. O cadastro fica pendente ate o primeiro acesso.',
    campos: [
      { nome: 'nome', rotulo: 'Nome completo', obrigatorio: true },
      { nome: 'cpf', rotulo: 'CPF', obrigatorio: true, dica: 'Com ou sem pontuacao.' },
      { nome: 'email', rotulo: 'Email', tipo: 'email', obrigatorio: true,
        dica: 'E por ele que a pessoa entra e recebe senha nova.' },
      { nome: 'telefone', rotulo: 'Telefone', obrigatorio: true },
      { nome: 'cargo_id', rotulo: 'Cargo', tipo: 'select',
        opcoes: cargos.map((c) => ({ valor: c.id, rotulo: c.nome })) },
      { nome: 'acessa_painel', rotulo: 'Acessa o painel?', tipo: 'select',
        opcoes: [{ valor: 'nao', rotulo: 'Nao — somente aplicativo' },
                 { valor: 'sim', rotulo: 'Sim — equipe da frota' }],
        valor: 'nao',
        dica: 'Quem acessa o painel cadastra, aprova solicitacao e trata ocorrencia.' },
      { nome: 'usa_veiculo_diario', rotulo: 'Usa veiculo todos os dias?', tipo: 'select',
        opcoes: [{ valor: 'nao', rotulo: 'Nao — pede carro quando precisa' },
                 { valor: 'sim', rotulo: 'Sim — sai com carro toda manha' }],
        valor: 'nao',
        dica: 'Quem usa todo dia faz checklist diario sem pedir veiculo, e nao devolve. Quem nao usa pede, e ai a devolucao exige checklist de retorno.' },
    ],
    confirmar: 'Criar cadastro',
    aoConfirmar: async (v) => {
      const { usuario, senha_inicial } = await api.criarUsuario({
        ...v,
        acessa_painel: v.acessa_painel === 'sim',
        usa_veiculo_diario: v.usa_veiculo_diario === 'sim',
      })
      await recarregar()
      mostrarSenha({
        titulo: 'Usuario criado', nome: usuario.nome, email: usuario.email, senha: senha_inicial,
      })
    },
  })
}

async function editarUsuario(usuario, recarregar) {
  const cargos = await carregarCargos()
  abrirModal({
    titulo: 'Editar usuario',
    subtitulo: `${usuario.email} · CPF ${cpfFormatado(usuario.cpf)}`,
    campos: [
      { nome: 'nome', rotulo: 'Nome completo', valor: usuario.nome, obrigatorio: true },
      { nome: 'telefone', rotulo: 'Telefone', valor: usuario.telefone || '' },
      { nome: 'cargo_id', rotulo: 'Cargo', tipo: 'select', valor: usuario.cargo_id,
        opcoes: cargos.map((c) => ({ valor: c.id, rotulo: c.nome })) },
      { nome: 'acessa_painel', rotulo: 'Acessa o painel?', tipo: 'select',
        valor: usuario.acessa_painel ? 'sim' : 'nao',
        opcoes: [{ valor: 'nao', rotulo: 'Nao — somente aplicativo' },
                 { valor: 'sim', rotulo: 'Sim — equipe da frota' }],
        dica: 'Trocar o nivel encerra as sessoes abertas desta pessoa.' },
      { nome: 'usa_veiculo_diario', rotulo: 'Usa veiculo todos os dias?', tipo: 'select',
        opcoes: [{ valor: 'nao', rotulo: 'Nao — pede carro quando precisa' },
                 { valor: 'sim', rotulo: 'Sim — sai com carro toda manha' }],
        valor: usuario.usa_veiculo_diario ? 'sim' : 'nao',
        dica: 'Quem usa todo dia faz checklist diario sem pedir veiculo, e nao devolve. Quem nao usa pede, e ai a devolucao exige checklist de retorno.' },
    ],
    aoConfirmar: async (v) => {
      await api.atualizarUsuario(usuario.id, {
        ...v,
        acessa_painel: v.acessa_painel === 'sim',
        usa_veiculo_diario: v.usa_veiculo_diario === 'sim',
      })
      notificar('Cadastro atualizado.')
      await recarregar()
    },
  })
}

// Espelho das transicoes de `servidor/src/rotas/usuarios.js`. Existe para a
// tela nao oferecer caminho que o servidor recusa — oferecer e' pior do que
// esconder: a pessoa clica, leva 409, e fica sem saber se errou ou se o
// sistema quebrou.
//
// Um teste cruza este objeto com o do servidor a cada execucao; espelho que
// ninguem confere vira mentira na primeira mudanca.
const TRANSICOES = {
  pendente: ['bloqueado', 'suspenso', 'desativado'],
  ativo: ['bloqueado', 'suspenso', 'desativado'],
  bloqueado: ['ativo', 'desativado'],
  suspenso: ['ativo', 'desativado'],
  desativado: [],
}

const podeIrPara = (usuario, destino) => (TRANSICOES[usuario.status] || []).includes(destino)

function mudarStatus(usuario, novo, recarregar) {
  const rotulo = ROTULO_STATUS_USUARIO[novo].toLowerCase()
  abrirModal({
    titulo: `Definir acesso como ${rotulo}`,
    subtitulo: `${usuario.nome} — ${usuario.email}`,
    campos: [{ nome: 'motivo', rotulo: 'Motivo', tipo: 'textarea',
      dica: 'Fica na auditoria junto de quem alterou e quando.' }],
    confirmar: 'Confirmar',
    perigo: novo !== 'ativo',
    aoConfirmar: async (v) => {
      await api.statusUsuario(usuario.id, novo, v.motivo)
      notificar(`Acesso de ${usuario.nome} agora esta ${rotulo}.`)
      await recarregar()
    },
  })
}

function novaSenha(usuario, recarregar) {
  abrirModal({
    titulo: 'Gerar nova senha',
    subtitulo: `${usuario.nome} volta a pendente e precisa trocar a senha no proximo acesso. As sessoes abertas caem.`,
    confirmar: 'Gerar',
    perigo: true,
    aoConfirmar: async () => {
      const r = await api.novaSenha(usuario.id)
      await recarregar()
      mostrarSenha({
        titulo: 'Nova senha gerada', nome: usuario.nome, email: r.email, senha: r.senha_inicial,
      })
    },
  })
}

// ---------------------------------------------------------------- cargos

async function gerenciarCargos(recarregar) {
  const area = document.getElementById('area-modal')
  const lista = elemento('div', {})

  async function desenhar() {
    const cargos = await carregarCargos({ recarregar: true })
    lista.replaceChildren(
      cargos.length
        ? elemento('div', { classe: 'tabela-caixa' }, [
            elemento('table', {}, [elemento('tbody', {}, cargos.map((c) =>
              elemento('tr', {}, [
                elemento('td', {}, [
                  elemento('div', { classe: 'celula-forte', texto: c.nome }),
                  elemento('div', { classe: 'celula-fraca',
                    texto: c.usuarios === 1 ? '1 usuario' : `${c.usuarios} usuarios` }),
                ]),
                elemento('td', { classe: 'celula-acoes' }, [menuAcoes([
                  { rotulo: 'Renomear', aoClick: () => abrirModal({
                    titulo: 'Renomear cargo',
                    campos: [{ nome: 'nome', rotulo: 'Nome', valor: c.nome, obrigatorio: true }],
                    aoConfirmar: async (v) => {
                      await api.renomearCargo(c.id, v.nome)
                      await desenhar(); await recarregar()
                    },
                  }) },
                  { rotulo: 'Remover', perigo: true, separar: true, aoClick: async () => {
                    try {
                      await api.removerCargo(c.id)
                      notificar('Cargo removido.')
                      await desenhar(); await recarregar()
                    } catch (falha) { notificar(falha.message) }
                  } },
                ])]),
              ])))]),
          ])
        : vazio('Nenhum cargo cadastrado ainda.'),
    )
  }

  const entrada = elemento('input', { placeholder: 'Ex.: Tecnico de campo' })

  const formulario = elemento('form', { classe: 'modal' }, [
    elemento('h3', { texto: 'Cargos' }),
    elemento('p', { classe: 'modal-sub',
      texto: 'Funcao da pessoa na empresa. Nao da permissao — decide quais checklists aparecem para ela.' }),
    lista,
    elemento('div', { classe: 'campo esp-t-4' }, [
      elemento('label', { texto: 'Novo cargo' }),
      entrada,
    ]),
    elemento('div', { classe: 'modal-acoes' }, [
      elemento('button', {
        classe: 'botao botao--suave', type: 'button', texto: 'Fechar',
        aoClick: () => area.replaceChildren(),
      }),
      elemento('button', {
        classe: 'botao', type: 'button', texto: 'Criar cargo',
        aoClick: async () => {
          if (!entrada.value.trim()) return
          try {
            await api.criarCargo(entrada.value.trim())
            entrada.value = ''
            notificar('Cargo criado.')
            await desenhar(); await recarregar()
          } catch (falha) { notificar(falha.message) }
        },
      }),
    ]),
  ])

  area.replaceChildren(elemento('div', { classe: 'fundo-modal' }, [formulario]))
  await desenhar()
}

// ------------------------------------------------------------- historico

async function telaHistorico(raiz, contexto, id) {
  const dados = await api.historicoUsuario(id)
  const u = dados.usuario

  const linhas = []
  for (const e of dados.eventos) {
    linhas.push({
      quando: e.criado_em,
      tipo: e.feito_por_ele ? 'fez' : 'sofreu',
      acao: e.acao,
      detalhe: resumir(e),
    })
  }

  function resumir(e) {
    const d = e.depois || {}
    if (d.motivo_atraso) return `Atraso: ${d.motivo_atraso}`
    if (d.motivo) return d.motivo
    if (e.antes?.status && d.status) return `${e.antes.status} → ${d.status}`
    const partes = Object.entries(d)
      .filter(([, v]) => v !== null && typeof v !== 'object')
      .slice(0, 3).map(([k, v]) => `${k}: ${v}`)
    return partes.join(' · ') || '—'
  }

  raiz.append(
    cabecalhoTela({
      titulo: `Historico de ${u.nome}`,
      descricao: `${u.cargo_nome || 'sem cargo'} · ${ROTULO_NIVEL[u.acessa_painel ? 'frota' : 'colaborador']} · CPF ${cpfFormatado(u.cpf)}`,
      acoes: [elemento('button', {
        classe: 'botao botao--suave', texto: '← Usuarios',
        aoClick: () => contexto.irPara('usuarios'),
      })],
    }),
    elemento('section', { classe: 'secao' }, [
      elemento('div', { classe: 'secao-titulo' }, [elemento('h2', { texto: 'Checklists executados' })]),
      dados.inspecoes.length
        ? tabela(['Quando', 'Veiculo', 'Momento', 'Checklist', 'Resultado'],
            dados.inspecoes.map((i) => elemento('tr', {}, [
              elemento('td', { classe: 'celula-fraca dado', texto: dataHora(i.finalizada_em) }),
              elemento('td', { classe: 'celula-forte dado', texto: i.placa }),
              elemento('td', {}, [selo(i.momento === 'saida' ? 'Saida' : 'Retorno',
                i.momento === 'saida' ? 's-marca' : 's-neutro')]),
              elemento('td', { classe: 'celula-fraca', texto: i.checklist }),
              elemento('td', {}, [selo(i.resultado || '—',
                i.resultado === 'aprovado' ? 's-ok' : i.resultado === 'reprovado' ? 's-critico' : 's-atencao')]),
            ])))
        : vazio('Nenhum checklist executado.'),
    ]),
    elemento('section', { classe: 'secao' }, [
      elemento('div', { classe: 'secao-titulo' }, [elemento('h2', { texto: 'Solicitacoes de veiculo' })]),
      dados.solicitacoes.length
        ? tabela(['#', 'Veiculo', 'Janela', 'Situacao', 'Motivo do atraso'],
            dados.solicitacoes.map((s) => elemento('tr', {}, [
              elemento('td', { classe: 'celula-forte dado', texto: `#${s.numero}` }),
              elemento('td', { classe: 'dado', texto: s.placa }),
              elemento('td', { classe: 'celula-fraca dado',
                texto: `${dataHora(s.janela_inicio)} → ${dataHora(s.janela_fim)}` }),
              elemento('td', {}, [selo(ROTULO_STATUS_SOLICITACAO[s.status], TOM_STATUS_SOLICITACAO[s.status])]),
              elemento('td', { classe: 'celula-fraca limite-texto', texto: s.motivo_atraso || '—' }),
            ])))
        : vazio('Nenhuma solicitacao.'),
    ]),
    elemento('section', { classe: 'secao' }, [
      elemento('div', { classe: 'secao-titulo' }, [elemento('h2', { texto: 'Ocorrencias abertas por ele' })]),
      dados.ocorrencias.length
        ? tabela(['Quando', 'Veiculo', 'O que foi', 'Prioridade'],
            dados.ocorrencias.map((o) => elemento('tr', {}, [
              elemento('td', { classe: 'celula-fraca dado', texto: dataCurta(o.aberta_em) }),
              elemento('td', { classe: 'dado', texto: o.placa }),
              elemento('td', { classe: 'limite-texto', texto: o.descricao }),
              elemento('td', {}, [selo(o.prioridade,
                o.prioridade === 'critica' ? 's-critico' : o.prioridade === 'alta' ? 's-alerta' : 's-neutro')]),
            ])))
        : vazio('Nenhuma ocorrencia.'),
    ]),
    elemento('section', { classe: 'secao' }, [
      elemento('div', { classe: 'secao-titulo' }, [elemento('h2', { texto: 'Trilha completa' })]),
      elemento('p', { classe: 'campo-dica',
        texto: 'Tudo que ele fez e tudo que a frota fez sobre ele, com data e hora.' }),
      linhas.length
        ? tabela(['Quando', '', 'Acao', 'Detalhe'], linhas.map((l) => elemento('tr', {}, [
            elemento('td', { classe: 'celula-fraca dado' }, [
              elemento('div', { texto: dataCurta(l.quando) }),
              elemento('div', { texto: l.quando.slice(11, 19) }),
            ]),
            elemento('td', {}, [selo(l.tipo === 'fez' ? 'fez' : 'sofreu',
              l.tipo === 'fez' ? 's-marca' : 's-atencao')]),
            elemento('td', {}, [elemento('span', { classe: 'celula-forte dado', texto: l.acao })]),
            elemento('td', { classe: 'celula-fraca limite-texto', texto: l.detalhe }),
          ])))
        : vazio('Sem eventos.'),
    ]),
  )
}

// ------------------------------------------------------------------ lista

export async function telaUsuarios(raiz, contexto) {
  if (contexto.parametros.id) return telaHistorico(raiz, contexto, contexto.parametros.id)

  const filtros = { status: contexto.parametros.status || '', busca: '' }
  const areaLista = elemento('div', {})

  async function recarregar() {
    const { usuarios } = await api.usuarios(filtros)
    areaLista.replaceChildren(desenhar(usuarios))
  }

  function desenhar(usuarios) {
    if (!usuarios.length) return vazio('Nenhum usuario encontrado com esses filtros.')

    return tabela(['Nome', 'CPF', 'Cargo', 'Nivel', 'Acesso', ''], usuarios.map((u) => {
      const eu_mesmo = u.id === contexto.usuario.id
      const acoes = [
        { rotulo: 'Editar', aoClick: () => editarUsuario(u, recarregar) },
        { rotulo: 'Mudar senha', aoClick: () => novaSenha(u, recarregar) },
        { rotulo: 'Historico completo', aoClick: () => contexto.irPara('usuarios', { id: u.id }) },
      ]
      // Cada acao aparece so quando o servidor aceitaria a transicao. Antes,
      // "Bloquear" era oferecido a quem estava suspenso e "Suspender" a quem
      // estava bloqueado — e o servidor recusa as duas com 409.
      if (!eu_mesmo) {
        if (podeIrPara(u, 'ativo')) {
          acoes.push({ rotulo: 'Reativar', separar: true, aoClick: () => mudarStatus(u, 'ativo', recarregar) })
        }
        if (podeIrPara(u, 'bloqueado')) {
          acoes.push({ rotulo: 'Bloquear', perigo: true, separar: true,
            aoClick: () => mudarStatus(u, 'bloqueado', recarregar) })
        }
        if (podeIrPara(u, 'suspenso')) {
          acoes.push({ rotulo: 'Suspender', perigo: true, aoClick: () => mudarStatus(u, 'suspenso', recarregar) })
        }
        if (podeIrPara(u, 'desativado')) {
          acoes.push({ rotulo: 'Desativar', perigo: true, aoClick: () => mudarStatus(u, 'desativado', recarregar) })
        }
      }

      return elemento('tr', {}, [
        elemento('td', {}, [
          elemento('div', { classe: 'celula-forte', texto: u.nome }),
          elemento('div', { classe: 'celula-fraca', texto: u.email }),
        ]),
        elemento('td', { classe: 'celula-fraca dado', texto: cpfFormatado(u.cpf) }),
        elemento('td', { classe: 'celula-fraca', texto: u.cargo_nome || '—' }),
        elemento('td', {}, [
          elemento('div', { classe: 'card-detalhe' }, [
            selo(u.acessa_painel ? 'Frota' : 'Colaborador',
              u.acessa_painel ? 's-marca' : 's-neutro'),
            // Quem usa carro todo dia entra na cobranca de checklist diario
            // (roadmap 8.2). Precisa ser legivel sem abrir o cadastro.
            u.usa_veiculo_diario ? selo('carro todo dia', 's-neutro') : null,
          ].filter(Boolean)),
        ]),
        elemento('td', {}, [
          selo(ROTULO_STATUS_USUARIO[u.status], TOM_STATUS_USUARIO[u.status]),
          u.status === 'pendente'
            ? elemento('div', { classe: 'celula-fraca esp-t-1', texto: 'aguarda primeiro acesso' })
            : null,
        ]),
        elemento('td', { classe: 'celula-acoes' }, [menuAcoes(acoes)]),
      ])
    }))
  }

  raiz.append(
    cabecalhoTela({
      titulo: 'Usuarios e cargos',
      descricao: 'Quem entra no sistema, com qual cargo e em qual nivel.',
      acoes: [
        elemento('button', { classe: 'botao botao--suave', texto: 'Cargos',
          aoClick: () => gerenciarCargos(recarregar) }),
        elemento('button', { classe: 'botao', texto: '+ Novo usuario',
          aoClick: () => formularioNovoUsuario(recarregar) }),
      ],
    }),
    elemento('div', { classe: 'filtros' }, [
      elemento('input', { type: 'search', placeholder: 'Buscar por nome, email ou CPF',
        aoInput: (e) => { filtros.busca = e.target.value; recarregar() } }),
      elemento('select', { aoChange: (e) => { filtros.status = e.target.value; recarregar() } }, [
        elemento('option', { value: '', texto: 'Em uso (esconde desativados)' }),
        ...Object.entries(ROTULO_STATUS_USUARIO).map(([valor, rotulo]) =>
          elemento('option', { value: valor, texto: rotulo, selected: valor === filtros.status })),
      ]),
    ]),
    areaLista,
  )

  await recarregar()
}
