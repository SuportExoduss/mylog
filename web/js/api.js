// Cliente HTTP do painel. A sessao viaja em cookie HttpOnly: nao guardamos
// token em localStorage, entao um XSS nao consegue le-lo.

export class ErroApi extends Error {
  constructor(status, codigo, mensagem) {
    super(mensagem)
    this.status = status
    this.codigo = codigo
  }
}

async function pedir(metodo, caminho, corpo) {
  let resposta
  try {
    resposta = await fetch(caminho, {
      method: metodo,
      headers: corpo ? { 'content-type': 'application/json' } : {},
      body: corpo ? JSON.stringify(corpo) : undefined,
      credentials: 'same-origin',
    })
  } catch {
    throw new ErroApi(0, 'sem_conexao', 'Sem conexao com o servidor.')
  }

  const dados = await resposta.json().catch(() => ({}))
  if (!resposta.ok) {
    throw new ErroApi(resposta.status, dados.erro || 'erro', dados.mensagem || 'Falha na requisicao.')
  }
  return dados
}

function comQuery(caminho, params) {
  const limpos = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
  if (!limpos.length) return caminho
  return `${caminho}?${new URLSearchParams(limpos)}`
}

export const api = {
  login: (email, senha) => pedir('POST', '/api/auth/login', { email, senha }),
  sair: () => pedir('POST', '/api/auth/sair', {}),
  eu: () => pedir('GET', '/api/auth/eu'),
  trocarSenha: (senha_atual, senha_nova) => pedir('POST', '/api/auth/senha', { senha_atual, senha_nova }),

  painel: () => pedir('GET', '/api/painel'),

  // ------------------------------------------------------------- usuarios
  usuarios: (filtros) => pedir('GET', comQuery('/api/usuarios', filtros)),
  criarUsuario: (dados) => pedir('POST', '/api/usuarios', dados),
  atualizarUsuario: (id, dados) => pedir('PATCH', `/api/usuarios/${id}`, dados),
  statusUsuario: (id, status, motivo) => pedir('POST', `/api/usuarios/${id}/status`, { status, motivo }),
  novaSenha: (id) => pedir('POST', `/api/usuarios/${id}/senha`, {}),
  historicoUsuario: (id) => pedir('GET', `/api/usuarios/${id}/historico`),

  // ---------------------------------------------------------------- cargos
  cargos: () => pedir('GET', '/api/cargos'),
  criarCargo: (nome) => pedir('POST', '/api/cargos', { nome }),
  renomearCargo: (id, nome) => pedir('PATCH', `/api/cargos/${id}`, { nome }),
  removerCargo: (id) => pedir('DELETE', `/api/cargos/${id}`),

  // -------------------------------------------------------------- veiculos
  veiculos: (filtros) => pedir('GET', comQuery('/api/veiculos', filtros)),
  veiculo: (id) => pedir('GET', `/api/veiculos/${id}`),
  criarVeiculo: (dados) => pedir('POST', '/api/veiculos', dados),
  atualizarVeiculo: (id, dados) => pedir('PATCH', `/api/veiculos/${id}`, dados),
  statusVeiculo: (id, status, motivo) => pedir('POST', `/api/veiculos/${id}/status`, { status, motivo }),
  historicoVeiculo: (id) => pedir('GET', `/api/veiculos/${id}/historico`),

  // ---------------------------------------------------------- solicitacoes
  solicitacoes: (filtros) => pedir('GET', comQuery('/api/solicitacoes', filtros)),
  // Lista de placas livres numa janela. So a Frota chama: e' na liberacao que
  // o pedido ganha carro (roadmap 10.4).
  veiculosLivres: (janela_inicio, janela_fim, categoria_id) =>
    pedir('GET', comQuery('/api/solicitacoes/disponiveis',
      { janela_inicio, janela_fim, categoria_id })),
  criarSolicitacao: (dados) => pedir('POST', '/api/solicitacoes', dados),
  // Aprovar E escolher a placa sao o mesmo ato.
  aprovarSolicitacao: (id, veiculo_id, motivo_categoria) =>
    pedir('POST', `/api/solicitacoes/${id}/aprovar`, { veiculo_id, motivo_categoria }),
  recusarSolicitacao: (id, motivo) => pedir('POST', `/api/solicitacoes/${id}/recusar`, { motivo }),
  cancelarSolicitacao: (id) => pedir('POST', `/api/solicitacoes/${id}/cancelar`, {}),

  // ------------------------------------------------------------ checklists
  templates: (filtros) => pedir('GET', comQuery('/api/templates', filtros)),
  template: (id) => pedir('GET', `/api/templates/${id}`),
  criarTemplate: (dados) => pedir('POST', '/api/templates', dados),
  salvarTemplate: (id, dados) => pedir('PUT', `/api/templates/${id}`, dados),
  publicarTemplate: (id) => pedir('POST', `/api/templates/${id}/publicar`, {}),
  novaVersaoTemplate: (id) => pedir('POST', `/api/templates/${id}/versao`, {}),
  descartarTemplate: (id) => pedir('DELETE', `/api/templates/${id}`),
  conferirTemplate: (estrutura) => pedir('POST', '/api/templates/conferir', { estrutura }),
  // A imagem sobe assim que a pessoa escolhe o arquivo, e o que fica na
  // estrutura da pergunta e' so a URL.
  enviarImagemModelo: (id, conteudo, tipo_mime) =>
    pedir('POST', `/api/templates/${id}/imagem`, { conteudo, tipo_mime }),

  // ----------------------------------------------------------- ocorrencias
  ocorrencias: (filtros) => pedir('GET', comQuery('/api/ocorrencias', filtros)),
  ocorrencia: (id) => pedir('GET', `/api/ocorrencias/${id}`),
  statusOcorrencia: (id, status, resolucao) =>
    pedir('POST', `/api/ocorrencias/${id}/status`, { status, resolucao }),
  atribuirOcorrencia: (id, responsavel_id) =>
    pedir('POST', `/api/ocorrencias/${id}/atribuir`, { responsavel_id }),

  // ----------------------------------------------------------- preventivas
  preventivas: (filtros) => pedir('GET', comQuery('/api/preventivas', filtros)),
  criarPreventiva: (dados) => pedir('POST', '/api/preventivas', dados),
  reagendarPreventiva: (id, dados) => pedir('PATCH', `/api/preventivas/${id}`, dados),
  concluirPreventiva: (id, dados) => pedir('POST', `/api/preventivas/${id}/concluir`, dados),

  // Nao ha `inspecao(id)` aqui: o detalhe de um checklist e' o relatorio de
  // impressao, aberto por URL, e a tela "meus checklists" e' do aplicativo,
  // que fala HTTP direto (docs/API.md 9).

  auditoria: (filtros) => pedir('GET', comQuery('/api/auditoria', filtros)),

  // ---------------------------------------------------------- notificacoes
  notificacoes: () => pedir('GET', '/api/notificacoes'),
  // Sem id, marca todas: e' o "limpar" do sino.
  marcarLida: (id) => pedir('POST', '/api/notificacoes/lidas', id ? { id } : {}),

  // ------------------------------------------------------ categorias de uso
  categorias: (filtros) => pedir('GET', comQuery('/api/categorias', filtros)),
  criarCategoria: (dados) => pedir('POST', '/api/categorias', dados),
  salvarCategoria: (id, dados) => pedir('PATCH', `/api/categorias/${id}`, dados),
  removerCategoria: (id) => pedir('DELETE', `/api/categorias/${id}`),
  veiculosDaCategoria: (id) => pedir('GET', `/api/categorias/${id}/veiculos`),
  definirVeiculosDaCategoria: (id, veiculos) =>
    pedir('PUT', `/api/categorias/${id}/veiculos`, { veiculos }),

  // ------------------------------------------------------ checklists feitos
  execucoes: (filtros) => pedir('GET', comQuery('/api/execucoes', filtros)),
  // Quem devia ter feito e nao fez. So faz sentido para UM dia: "faltou" e'
  // pergunta de dia, nao de intervalo.
  faltando: (dia) => pedir('GET', comQuery('/api/execucoes/faltando', { dia })),
  // A exportacao nao passa por `pedir`: e' um download, nao JSON. Devolve a
  // URL para a tela abrir, levando os MESMOS filtros que estao na tela.
  urlPlanilha: (filtros) => comQuery('/api/execucoes.csv', filtros),
}
