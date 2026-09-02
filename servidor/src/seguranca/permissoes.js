// RBAC (secao 3 do roadmap). A autorizacao e' sempre server-side:
// o front esconde botoes, mas quem decide e' esta tabela.
import { erro } from '../nucleo/http.js'

export const PAPEIS = ['adm', 'supervisor', 'colaborador', 'manutencao', 'auditoria']

export const CAPACIDADES = {
  adm: [
    'painel.ver', 'usuarios.ler', 'usuarios.escrever', 'usuarios.ativar',
    'veiculos.ler', 'veiculos.escrever', 'vinculos.escrever',
    'templates.ler', 'templates.escrever',
    'inspecoes.ler', 'inspecoes.executar',
    'nc.ler', 'nc.tratar', 'tickets.ler', 'tickets.abrir', 'tickets.tratar',
    'preventivas.ler', 'preventivas.escrever', 'auditoria.ler',
  ],
  supervisor: [
    'painel.ver', 'usuarios.ler', 'veiculos.ler', 'vinculos.escrever',
    'templates.ler', 'inspecoes.ler', 'inspecoes.executar',
    'nc.ler', 'nc.tratar', 'tickets.ler', 'tickets.abrir', 'tickets.tratar',
    'preventivas.ler', 'preventivas.escrever', 'auditoria.ler',
  ],
  manutencao: [
    'painel.ver', 'veiculos.ler', 'inspecoes.ler',
    'nc.ler', 'nc.tratar', 'tickets.ler', 'tickets.tratar',
    'preventivas.ler', 'preventivas.escrever',
  ],
  colaborador: [
    'veiculos.ler', 'templates.ler', 'inspecoes.executar', 'tickets.abrir',
  ],
  auditoria: [
    'painel.ver', 'usuarios.ler', 'veiculos.ler', 'templates.ler',
    'inspecoes.ler', 'nc.ler', 'tickets.ler', 'preventivas.ler', 'auditoria.ler',
  ],
}

export function pode(usuario, capacidade) {
  if (!usuario) return false
  const lista = CAPACIDADES[usuario.papel]
  return Array.isArray(lista) && lista.includes(capacidade)
}

export function exigir(usuario, capacidade) {
  if (!pode(usuario, capacidade)) {
    throw erro.permissao(`O papel "${usuario?.papel}" nao tem permissao para ${capacidade}.`)
  }
}

export function capacidadesDe(usuario) {
  return CAPACIDADES[usuario?.papel] || []
}
