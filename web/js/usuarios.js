// Gestao de credenciais (secao 8). Liberar acesso e' um ato explicito do ADM,
// entao "Liberar" e' um botao proprio, nao um campo escondido num formulario.
import { api } from './api.js'
import {
  elemento, cabecalhoTela, tabela, selo, vazio, abrirModal, notificar, dataCurta,
  ROTULO_STATUS_USUARIO, TOM_STATUS_USUARIO, ROTULO_PAPEL,
} from './ui.js'

const OPCOES_PAPEL = Object.entries(ROTULO_PAPEL).map(([valor, rotulo]) => ({ valor, rotulo }))

function formularioNovoUsuario(recarregar) {
  abrirModal({
    titulo: 'Novo usuario',
    subtitulo: 'O cadastro nasce pendente. O acesso so vale depois de liberado.',
    campos: [
      { nome: 'nome', rotulo: 'Nome completo', obrigatorio: true },
      { nome: 'email', rotulo: 'Email', tipo: 'email', obrigatorio: true },
      { nome: 'matricula', rotulo: 'Matricula (opcional)' },
      { nome: 'papel', rotulo: 'Papel', tipo: 'select', opcoes: OPCOES_PAPEL, valor: 'colaborador' },
      { nome: 'senha', rotulo: 'Senha inicial', tipo: 'password', obrigatorio: true,
        dica: 'Minimo de 8 caracteres, com letras e numeros.' },
    ],
    confirmar: 'Criar cadastro',
    aoConfirmar: async (valores) => {
      await api.criarUsuario(valores)
      notificar('Usuario criado. Libere o acesso quando quiser autorizar a entrada.')
      await recarregar()
    },
  })
}

function mudarStatus(usuario, novoStatus, recarregar) {
  const rotulo = ROTULO_STATUS_USUARIO[novoStatus].toLowerCase()
  abrirModal({
    titulo: `Definir acesso como ${rotulo}`,
    subtitulo: `${usuario.nome} — ${usuario.email}`,
    campos: [{
      nome: 'motivo', rotulo: 'Motivo', tipo: 'textarea',
      dica: 'Fica registrado na auditoria junto de quem alterou e quando.',
    }],
    confirmar: novoStatus === 'ativo' ? 'Liberar acesso' : 'Confirmar',
    perigo: novoStatus !== 'ativo',
    aoConfirmar: async (valores) => {
      await api.statusUsuario(usuario.id, novoStatus, valores.motivo)
      notificar(novoStatus === 'ativo'
        ? `${usuario.nome} ja pode entrar no aplicativo.`
        : `Acesso de ${usuario.nome} agora esta ${rotulo}.`)
      await recarregar()
    },
  })
}

function redefinirSenha(usuario, recarregar) {
  abrirModal({
    titulo: 'Redefinir senha',
    subtitulo: `${usuario.nome} — todas as sessoes abertas serao encerradas.`,
    campos: [{ nome: 'senha', rotulo: 'Nova senha', tipo: 'password', obrigatorio: true,
      dica: 'Minimo de 8 caracteres, com letras e numeros.' }],
    confirmar: 'Redefinir',
    aoConfirmar: async (valores) => {
      await api.redefinirSenha(usuario.id, valores.senha)
      notificar('Senha redefinida e sessoes encerradas.')
      await recarregar()
    },
  })
}

function editarUsuario(usuario, recarregar) {
  abrirModal({
    titulo: 'Editar usuario',
    subtitulo: usuario.email,
    campos: [
      { nome: 'nome', rotulo: 'Nome completo', valor: usuario.nome, obrigatorio: true },
      { nome: 'matricula', rotulo: 'Matricula', valor: usuario.matricula || '' },
      { nome: 'papel', rotulo: 'Papel', tipo: 'select', opcoes: OPCOES_PAPEL, valor: usuario.papel,
        dica: 'Trocar o papel encerra as sessoes abertas deste usuario.' },
    ],
    aoConfirmar: async (valores) => {
      await api.atualizarUsuario(usuario.id, valores)
      notificar('Cadastro atualizado.')
      await recarregar()
    },
  })
}

export async function telaUsuarios(raiz, contexto) {
  const podeEscrever = contexto.pode('usuarios.escrever')
  const podeAtivar = contexto.pode('usuarios.ativar')

  const filtros = { status: contexto.parametros.status || '', busca: '' }
  const areaLista = elemento('div', {})

  async function recarregar() {
    const { usuarios } = await api.usuarios(filtros)
    areaLista.replaceChildren(desenhar(usuarios))
  }

  function desenhar(usuarios) {
    if (!usuarios.length) return vazio('Nenhum usuario encontrado com esses filtros.')

    return tabela(['Nome', 'Papel', 'Acesso', 'Liberado em', ''], usuarios.map((usuario) => {
      const acoes = []
      if (podeAtivar && (usuario.status === 'pendente' || usuario.status === 'bloqueado' || usuario.status === 'suspenso')) {
        acoes.push(elemento('button', {
          classe: 'botao botao--mini', texto: 'Liberar',
          aoClick: () => mudarStatus(usuario, 'ativo', recarregar),
        }))
      }
      if (podeAtivar && usuario.status === 'ativo' && usuario.id !== contexto.usuario.id) {
        acoes.push(elemento('button', {
          classe: 'botao botao--suave botao--mini', texto: 'Bloquear',
          aoClick: () => mudarStatus(usuario, 'bloqueado', recarregar),
        }))
      }
      if (podeEscrever) {
        acoes.push(elemento('button', {
          classe: 'botao botao--suave botao--mini', texto: 'Editar',
          aoClick: () => editarUsuario(usuario, recarregar),
        }))
        acoes.push(elemento('button', {
          classe: 'botao botao--suave botao--mini', texto: 'Senha',
          aoClick: () => redefinirSenha(usuario, recarregar),
        }))
      }

      return elemento('tr', {}, [
        elemento('td', {}, [
          elemento('div', { classe: 'celula-forte', texto: usuario.nome }),
          elemento('div', { classe: 'celula-fraca', texto: usuario.email }),
        ]),
        elemento('td', { classe: 'celula-fraca', texto: ROTULO_PAPEL[usuario.papel] || usuario.papel }),
        elemento('td', {}, [selo(ROTULO_STATUS_USUARIO[usuario.status], TOM_STATUS_USUARIO[usuario.status])]),
        elemento('td', { classe: 'celula-fraca', texto: usuario.ativado_em ? dataCurta(usuario.ativado_em) : '—' }),
        elemento('td', {}, [elemento('div', { classe: 'linha linha--fim' }, acoes)]),
      ])
    }))
  }

  const campoBusca = elemento('input', {
    type: 'search', placeholder: 'Buscar por nome ou email',
    aoInput: (evento) => { filtros.busca = evento.target.value; recarregar() },
  })
  const seletorStatus = elemento('select', {
    aoChange: (evento) => { filtros.status = evento.target.value; recarregar() },
  }, [
    elemento('option', { value: '', texto: 'Todos os acessos' }),
    ...Object.entries(ROTULO_STATUS_USUARIO).map(([valor, rotulo]) =>
      elemento('option', { value: valor, texto: rotulo, selected: valor === filtros.status })),
  ])

  raiz.append(
    cabecalhoTela({
      titulo: 'Usuarios e credenciais',
      descricao: 'Quem pode entrar no aplicativo e com qual papel.',
      acoes: podeEscrever
        ? [elemento('button', { classe: 'botao', texto: '+ Novo usuario',
            aoClick: () => formularioNovoUsuario(recarregar) })]
        : [],
    }),
    elemento('div', { classe: 'filtros' }, [campoBusca, seletorStatus]),
    areaLista,
  )

  await recarregar()
}
