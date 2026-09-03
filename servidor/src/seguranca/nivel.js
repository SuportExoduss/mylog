// Nivel de acesso (roadmap 3). Substitui a tabela de cinco papeis da v2.0.
//
// O MyLog tem dois niveis, e apenas dois:
//   Frota       — painel web e aplicativo; faz tudo
//   Colaborador — somente aplicativo; solicita veiculo e executa checklist
//
// No cadastro isso e' uma marcacao unica: acessa_painel sim/nao.
//
// CARGO NAO E' PERMISSAO. Cargo e' a funcao da pessoa na empresa e serve para
// decidir quais checklists aparecem para ela — nunca para liberar uma rota.
import { erro } from '../nucleo/http.js'

export const FROTA = 'frota'
export const COLABORADOR = 'colaborador'

export function nivelDe(usuario) {
  return usuario && usuario.acessa_painel ? FROTA : COLABORADOR
}

export function ehFrota(usuario) {
  return nivelDe(usuario) === FROTA
}

// Porta de entrada de tudo que administra: cadastro, publicacao, aprovacao,
// tratamento de ocorrencia, liberacao de veiculo.
export function exigirFrota(usuario) {
  if (!ehFrota(usuario)) {
    throw erro.permissao('Esta operacao e da equipe da frota.')
  }
  return usuario
}

// O que o cliente precisa saber para esconder o que nao serve.
// O servidor nunca confia nisso — e' so para a tela nao mostrar botao morto.
export function perfilPublico(usuario) {
  return {
    id: usuario.id,
    empresa_id: usuario.empresa_id,
    nome: usuario.nome,
    email: usuario.email,
    cargo_id: usuario.cargo_id,
    cargo_nome: usuario.cargo_nome ?? null,
    nivel: nivelDe(usuario),
    acessa_painel: Boolean(usuario.acessa_painel),
    deve_trocar_senha: Boolean(usuario.deve_trocar_senha),
    status: usuario.status,
  }
}
