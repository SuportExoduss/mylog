// Trilha de auditoria (secao 29). Insercao apenas: nenhuma rota atualiza ou
// apaga esta tabela. Se um dia isso for necessario, sera migracao, nao feature.
import { executar, novoId, agora } from './banco.js'

export function registrarEvento({ empresaId, ator, alvoId, acao, entidade, entidadeId, antes, depois, ip }) {
  executar(
    `INSERT INTO eventos_auditoria
       (id, empresa_id, ator_id, ator_nome, alvo_id, acao, entidade, entidade_id,
        antes, depois, ip, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      novoId('evento'), empresaId,
      ator?.id || null, ator?.nome || null,
      // alvo_id e' quem SOFREU a acao. Sem ele, o historico de um colaborador
      // perderia tudo que a Frota fez sobre ele (roadmap 8.5).
      alvoId || null,
      acao, entidade, entidadeId || null,
      antes ? JSON.stringify(antes) : null,
      depois ? JSON.stringify(depois) : null,
      ip || null, agora(),
    ],
  )
}

// Campos que nunca entram na auditoria nem em resposta de API.
const SEGREDOS = new Set(['senha', 'senha_hash', 'senha_salt', 'token', 'token_hash'])

export function semSegredos(objeto) {
  if (!objeto || typeof objeto !== 'object') return objeto
  const saida = {}
  for (const [chave, valor] of Object.entries(objeto)) {
    if (SEGREDOS.has(chave)) continue
    saida[chave] = valor
  }
  return saida
}
