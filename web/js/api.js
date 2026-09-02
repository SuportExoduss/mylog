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

  usuarios: (filtros) => pedir('GET', comQuery('/api/usuarios', filtros)),
  usuario: (id) => pedir('GET', `/api/usuarios/${id}`),
  criarUsuario: (dados) => pedir('POST', '/api/usuarios', dados),
  atualizarUsuario: (id, dados) => pedir('PATCH', `/api/usuarios/${id}`, dados),
  statusUsuario: (id, status, motivo) => pedir('POST', `/api/usuarios/${id}/status`, { status, motivo }),
  redefinirSenha: (id, senha) => pedir('POST', `/api/usuarios/${id}/senha`, { senha }),
  revogarSessoes: (id) => pedir('POST', `/api/usuarios/${id}/sessoes/revogar`, {}),

  veiculos: (filtros) => pedir('GET', comQuery('/api/veiculos', filtros)),
  veiculo: (id) => pedir('GET', `/api/veiculos/${id}`),
  criarVeiculo: (dados) => pedir('POST', '/api/veiculos', dados),
  atualizarVeiculo: (id, dados) => pedir('PATCH', `/api/veiculos/${id}`, dados),
  statusVeiculo: (id, status, motivo) => pedir('POST', `/api/veiculos/${id}/status`, { status, motivo }),
  atualizarKm: (id, km_atual, motivo) => pedir('POST', `/api/veiculos/${id}/km`, { km_atual, motivo }),

  criarVinculo: (dados) => pedir('POST', '/api/vinculos', dados),
  removerVinculo: (id) => pedir('DELETE', `/api/vinculos/${id}`),
}
