-- MyLog — esquema multi-tenant (Roadmap v3.0)
-- Dialeto: SQLite (desenvolvimento). Escrito para portar a PostgreSQL:
-- sem tipos exoticos, sem AUTOINCREMENT, ids texto, timestamps ISO-8601 UTC.
-- Toda tabela de dominio carrega empresa_id. Nenhuma consulta pode omiti-lo.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- empresas
CREATE TABLE IF NOT EXISTS empresas (
  id            TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  documento     TEXT,
  status        TEXT NOT NULL DEFAULT 'ativa',   -- ativa | suspensa
  politicas     TEXT NOT NULL DEFAULT '{}',      -- JSON: bloqueio, retencao, alertas
  criado_em     TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

-- ------------------------------------------------------------------ marcas
-- White label (roadmap 7). Uma linha por empresa, criada na primeira gravacao.
--
-- Fica em tabela propria, e nao dentro de `empresas.politicas`, porque sao
-- coisas de natureza diferente: politica e' REGRA (bloqueio por critica,
-- retencao), marca e' APARENCIA. A arquitetura diz que branding nao toca em
-- regra; guardar os dois no mesmo JSON e' o primeiro passo para que toque.
--
-- Os tokens vao como JSON de uma lista FECHADA de chaves, validada em
-- compartilhado/marca.js. Nunca CSS, nunca HTML, nunca script.
--
-- Claro e escuro sao colunas separadas porque cada tema volta ao padrao MyLog
-- sozinho: `{}` num deles nao arrasta o outro.
CREATE TABLE IF NOT EXISTS marcas (
  empresa_id     TEXT PRIMARY KEY REFERENCES empresas(id),
  nome_exibicao  TEXT,                          -- ao LADO do MyLog, nunca no lugar
  logo_caminho   TEXT,                          -- no storage; NULL = so o MyLog
  logo_mime      TEXT,
  tokens_claro   TEXT NOT NULL DEFAULT '{}',    -- JSON, chaves de marca.js
  tokens_escuro  TEXT NOT NULL DEFAULT '{}',
  atualizado_em  TEXT NOT NULL,
  atualizado_por TEXT
);

-- ------------------------------------------------------------------ cargos
-- Funcao da pessoa na empresa (RH, Tecnico de campo, Motorista).
-- NAO concede permissao de sistema — serve para identificar quem e' a pessoa
-- e para decidir quais checklists aparecem para ela (roadmap 3).
CREATE TABLE IF NOT EXISTS cargos (
  id            TEXT PRIMARY KEY,
  empresa_id    TEXT NOT NULL REFERENCES empresas(id),
  nome          TEXT NOT NULL,
  ativo         INTEGER NOT NULL DEFAULT 1,
  criado_em     TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cargo_nome ON cargos(empresa_id, nome);

-- ---------------------------------------------------------------- usuarios
-- Dois niveis de acesso, e apenas dois (roadmap 3):
--   acessa_painel = 1  ->  Frota      (painel web + aplicativo)
--   acessa_painel = 0  ->  Colaborador (somente aplicativo)
CREATE TABLE IF NOT EXISTS usuarios (
  id              TEXT PRIMARY KEY,
  empresa_id      TEXT NOT NULL REFERENCES empresas(id),
  nome            TEXT NOT NULL,
  cpf             TEXT NOT NULL,
  email           TEXT NOT NULL,
  telefone        TEXT,
  cargo_id        TEXT REFERENCES cargos(id),
  acessa_painel   INTEGER NOT NULL DEFAULT 0,
  -- Usa veiculo todos os dias (roadmap 8.2). Separa dois fluxos:
  --   1 -> checklist diario avulso, sem solicitacao, e' cobrado por falta
  --   0 -> pega carro por solicitacao, e ai o retorno e' obrigatorio
  usa_veiculo_diario INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pendente',
  -- pendente|ativo|bloqueado|suspenso|desativado
  -- "pendente" = ainda nao fez o primeiro acesso nem trocou a senha inicial.
  senha_hash      TEXT,
  senha_salt      TEXT,
  deve_trocar_senha INTEGER NOT NULL DEFAULT 1,
  primeiro_acesso_em TEXT,
  criado_em       TEXT NOT NULL,
  atualizado_em   TEXT NOT NULL
);
-- Email e' identidade global: o login pede so email e senha (ver D3).
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_email ON usuarios(email);
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_cpf ON usuarios(empresa_id, cpf);
CREATE INDEX IF NOT EXISTS ix_usuarios_empresa ON usuarios(empresa_id, status);

-- ---------------------------------------------------------------- sessoes
CREATE TABLE IF NOT EXISTS sessoes (
  id          TEXT PRIMARY KEY,
  empresa_id  TEXT NOT NULL REFERENCES empresas(id),
  usuario_id  TEXT NOT NULL REFERENCES usuarios(id),
  token_hash  TEXT NOT NULL UNIQUE,
  origem      TEXT NOT NULL DEFAULT 'web',       -- web | app
  criado_em   TEXT NOT NULL,
  expira_em   TEXT NOT NULL,
  revogado_em TEXT
);
CREATE INDEX IF NOT EXISTS ix_sessoes_usuario ON sessoes(usuario_id);

-- ---------------------------------------------------------------- veiculos
CREATE TABLE IF NOT EXISTS veiculos (
  id                TEXT PRIMARY KEY,
  empresa_id        TEXT NOT NULL REFERENCES empresas(id),
  placa             TEXT NOT NULL,
  marca             TEXT,
  modelo            TEXT NOT NULL,
  ano               INTEGER,
  tipo              TEXT NOT NULL DEFAULT 'compacto_leve',
  -- compacto_leve|pickup|quatro_x_quatro|motocicleta|caminhao
  km_atual          INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'disponivel',
  -- disponivel|com_pendencia|bloqueado|manutencao
  motivo_status     TEXT,
  criado_em         TEXT NOT NULL,
  atualizado_em     TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_veiculos_placa ON veiculos(empresa_id, placa);
CREATE INDEX IF NOT EXISTS ix_veiculos_empresa ON veiculos(empresa_id, status);

-- --------------------------------------------------- categorias de uso
-- O que o colaborador pede (roadmap 10.3): "4 assentos comercial".
-- NAO se converte em tipo de veiculo: categoria e' necessidade de uso, tipo e'
-- propriedade do carro e continua decidindo qual checklist aparece.
CREATE TABLE IF NOT EXISTS categorias_uso (
  id            TEXT PRIMARY KEY,
  empresa_id    TEXT NOT NULL REFERENCES empresas(id),
  nome          TEXT NOT NULL,
  assentos      INTEGER,
  carroceria    TEXT,                            -- compacto|comercial|utilitario
  ativo         INTEGER NOT NULL DEFAULT 1,
  criado_em     TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_categoria_nome ON categorias_uso(empresa_id, nome);

-- Que veiculos atendem cada categoria. A Frota mantem; sem isto a aprovacao
-- nao teria como listar "os carros dessa categoria".
CREATE TABLE IF NOT EXISTS veiculo_categorias (
  empresa_id   TEXT NOT NULL REFERENCES empresas(id),
  veiculo_id   TEXT NOT NULL REFERENCES veiculos(id),
  categoria_id TEXT NOT NULL REFERENCES categorias_uso(id),
  PRIMARY KEY (veiculo_id, categoria_id)
);
CREATE INDEX IF NOT EXISTS ix_veic_cat ON veiculo_categorias(empresa_id, categoria_id);

-- --------------------------------------------------------------- templates
-- Modelo de checklist versionado. "estrutura" guarda as perguntas em JSON;
-- "cargos_liberados" guarda a lista de cargo_id, ou ["*"] para todos.
CREATE TABLE IF NOT EXISTS templates (
  id               TEXT PRIMARY KEY,
  empresa_id       TEXT NOT NULL REFERENCES empresas(id),
  codigo           TEXT NOT NULL,
  nome             TEXT NOT NULL,
  tipo_veiculo     TEXT NOT NULL,
  cargos_liberados TEXT NOT NULL DEFAULT '["*"]',
  exige_assinatura INTEGER NOT NULL DEFAULT 0,
  -- Para que serve o modelo (roadmap 14.2):
  --   padrao     -> checklist do dia a dia
  --   preventiva -> executa uma manutencao: saida e retorno OBRIGATORIOS,
  --                 relatorio por pergunta, e o retorno encerra a preventiva
  finalidade       TEXT NOT NULL DEFAULT 'padrao',
  -- Ritmo do modelo (roadmap 11.2.1). "avulso" nao cobra nada.
  periodicidade    TEXT NOT NULL DEFAULT 'avulso',
  -- avulso|diario|semanal|mensal
  -- Dias obrigatorios quando diario: JSON com 0=domingo .. 6=sabado.
  dias_semana      TEXT NOT NULL DEFAULT '[]',
  -- Dia de vencimento quando semanal (0..6).
  dia_semana       INTEGER,
  -- Horario limite "HH:MM", ou NULL quando o modelo nao tem prazo no dia.
  horario_limite   TEXT,
  versao           INTEGER NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'rascunho', -- rascunho|publicado|arquivado
  estrutura        TEXT NOT NULL DEFAULT '{"perguntas":[]}',
  publicado_em     TEXT,
  criado_em        TEXT NOT NULL,
  atualizado_em    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_template_versao ON templates(empresa_id, codigo, versao);
CREATE INDEX IF NOT EXISTS ix_templates_publicado ON templates(empresa_id, status, tipo_veiculo);

-- ----------------------------------------------------------- solicitacoes
-- Reserva de veiculo com janela de horario (roadmap 10).
-- NAO e' chamado de suporte: nao existe categoria "problema" ou "limpeza".
CREATE TABLE IF NOT EXISTS solicitacoes (
  id             TEXT PRIMARY KEY,
  empresa_id     TEXT NOT NULL REFERENCES empresas(id),
  numero         INTEGER NOT NULL,
  solicitante_id TEXT NOT NULL REFERENCES usuarios(id),
  -- O colaborador pede uma CATEGORIA (roadmap 10.3); a placa so aparece na
  -- aprovacao, escolhida pela Frota. Por isso veiculo_id nasce nulo.
  categoria_id   TEXT REFERENCES categorias_uso(id),
  veiculo_id     TEXT REFERENCES veiculos(id),
  janela_inicio  TEXT NOT NULL,
  janela_fim     TEXT NOT NULL,
  motivo         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pendente',
  -- pendente|aprovada|recusada|em_uso|devolvida|devolvida_com_atraso|cancelada
  aprovada_por   TEXT REFERENCES usuarios(id),
  aprovada_em    TEXT,
  motivo_recusa  TEXT,
  -- Preenchido quando a Frota entrega carro fora da categoria pedida.
  motivo_categoria TEXT,
  inspecao_saida   TEXT,
  inspecao_retorno TEXT,
  devolvido_em   TEXT,
  motivo_atraso  TEXT,
  criado_em      TEXT NOT NULL,
  atualizado_em  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_solicitacao_numero ON solicitacoes(empresa_id, numero);
CREATE INDEX IF NOT EXISTS ix_solicitacoes_status ON solicitacoes(empresa_id, status);
CREATE INDEX IF NOT EXISTS ix_solicitacoes_janela ON solicitacoes(veiculo_id, janela_inicio, janela_fim);

-- ---------------------------------------------------------------- inspecoes
CREATE TABLE IF NOT EXISTS inspecoes (
  id             TEXT PRIMARY KEY,
  empresa_id     TEXT NOT NULL REFERENCES empresas(id),
  veiculo_id     TEXT NOT NULL REFERENCES veiculos(id),
  usuario_id     TEXT NOT NULL REFERENCES usuarios(id),
  template_id    TEXT NOT NULL REFERENCES templates(id),
  solicitacao_id TEXT REFERENCES solicitacoes(id),
  momento        TEXT NOT NULL DEFAULT 'saida',   -- saida | retorno
  status         TEXT NOT NULL DEFAULT 'finalizada',
  km_informado   INTEGER,
  iniciada_em    TEXT NOT NULL,
  finalizada_em  TEXT,
  resultado      TEXT,                            -- aprovado|com_pendencia|reprovado
  assinatura     TEXT,
  -- Preventiva que esta inspecao executa (roadmap 14.2). Nula no checklist
  -- comum. E' por ela que o retorno sabe qual manutencao esta encerrando.
  preventiva_id  TEXT REFERENCES preventivas(id),
  cliente_uuid   TEXT,                            -- idempotencia da fila offline
  -- Numero sequencial por empresa. Identificador opaco nao serve para conversa
  -- de radio; o PROLOG usa "Codigo checklist" e a operacao cita esse numero.
  numero         INTEGER,
  criado_em      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_inspecao_numero ON inspecoes(empresa_id, numero);
CREATE UNIQUE INDEX IF NOT EXISTS ux_inspecao_cliente ON inspecoes(empresa_id, cliente_uuid);
CREATE INDEX IF NOT EXISTS ix_inspecoes_veiculo ON inspecoes(empresa_id, veiculo_id, iniciada_em);
CREATE INDEX IF NOT EXISTS ix_inspecoes_usuario ON inspecoes(empresa_id, usuario_id, iniciada_em);

-- Uma resposta por pergunta. "desfecho" e' ok ou ocorrencia — nao ha mais
-- tipo de resposta (roadmap 11.1).
CREATE TABLE IF NOT EXISTS respostas (
  id            TEXT PRIMARY KEY,
  empresa_id    TEXT NOT NULL REFERENCES empresas(id),
  inspecao_id   TEXT NOT NULL REFERENCES inspecoes(id),
  pergunta_id   TEXT NOT NULL,
  desfecho      TEXT NOT NULL,      -- ok | ocorrencia
  opcao_id      TEXT,               -- opcao de problema escolhida
  relatorio     TEXT,               -- texto livre: no padrao substitui a opcao;
                                    -- na preventiva descreve o que foi visto/feito
  -- So no retorno de preventiva: 1 = mexeu na peca, 0 = nao mexeu, NULL = nao
  -- se aplica. E' o campo que separa "conferi" de "consertei".
  manutencao_feita INTEGER,
  respondido_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_respostas_inspecao ON respostas(inspecao_id);

-- --------------------------------------------------------------- evidencias
CREATE TABLE IF NOT EXISTS evidencias (
  id            TEXT PRIMARY KEY,
  empresa_id    TEXT NOT NULL REFERENCES empresas(id),
  veiculo_id    TEXT REFERENCES veiculos(id),
  inspecao_id   TEXT REFERENCES inspecoes(id),
  ocorrencia_id TEXT,
  pergunta_id   TEXT,
  usuario_id    TEXT NOT NULL REFERENCES usuarios(id),
  tipo_mime     TEXT NOT NULL,
  caminho       TEXT NOT NULL,
  hash_arquivo  TEXT,
  bytes         INTEGER,
  gps_lat       REAL,
  gps_lon       REAL,
  -- id gerado no aparelho: reenvio da mesma foto nao duplica no storage.
  cliente_id    TEXT,
  capturado_em  TEXT NOT NULL,
  criado_em     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_evid_inspecao ON evidencias(inspecao_id, pergunta_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_evid_cliente ON evidencias(empresa_id, inspecao_id, cliente_id);

-- --------------------------------------------------------------- ocorrencias
CREATE TABLE IF NOT EXISTS ocorrencias (
  id             TEXT PRIMARY KEY,
  empresa_id     TEXT NOT NULL REFERENCES empresas(id),
  inspecao_id    TEXT REFERENCES inspecoes(id),
  veiculo_id     TEXT NOT NULL REFERENCES veiculos(id),
  pergunta_id    TEXT,
  descricao      TEXT NOT NULL,
  prioridade     TEXT NOT NULL DEFAULT 'baixa',  -- baixa|media|alta|critica
  status         TEXT NOT NULL DEFAULT 'aberta', -- aberta|em_tratamento|resolvida|encerrada
  responsavel_id TEXT REFERENCES usuarios(id),
  aberta_em      TEXT NOT NULL,
  resolvida_em   TEXT,
  resolucao      TEXT
);
CREATE INDEX IF NOT EXISTS ix_ocorrencias_empresa ON ocorrencias(empresa_id, status, prioridade);
CREATE INDEX IF NOT EXISTS ix_ocorrencias_veiculo ON ocorrencias(veiculo_id, pergunta_id);

-- -------------------------------------------------------------- preventivas
CREATE TABLE IF NOT EXISTS preventivas (
  id                  TEXT PRIMARY KEY,
  empresa_id          TEXT NOT NULL REFERENCES empresas(id),
  veiculo_id          TEXT NOT NULL REFERENCES veiculos(id),
  modo                TEXT NOT NULL,        -- km | data
  ultimo_servico_km   INTEGER,
  ultimo_servico_data TEXT,
  proximo_km          INTEGER,
  proxima_data        TEXT,
  alerta_antes_km     INTEGER DEFAULT 500,
  alerta_antes_dias   INTEGER DEFAULT 7,
  status              TEXT NOT NULL DEFAULT 'em_dia',
  -- em_dia|proxima|muito_proxima|vencida|realizada
  observacoes         TEXT,
  -- Modelo de checklist que executa esta preventiva, quando houver. Sem ele a
  -- preventiva ainda pode ser concluida pelo painel, como antes.
  template_id         TEXT REFERENCES templates(id),
  inspecao_saida      TEXT REFERENCES inspecoes(id),
  inspecao_retorno    TEXT REFERENCES inspecoes(id),
  concluida_por       TEXT REFERENCES usuarios(id),
  concluida_em        TEXT,
  criado_em           TEXT NOT NULL,
  atualizado_em       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_prev_empresa ON preventivas(empresa_id, status);

-- ------------------------------------------------------------ notificacoes
-- Aviso dirigido a UMA pessoa. Nasce no momento do fato, nunca por varredura:
-- quem sabe que um pedido chegou e' a rota que o criou.
--
-- Diferente de eventos_auditoria: aquilo e' historico de tudo que aconteceu,
-- imutavel e para todos. Isto e' caixa de entrada de alguem, e some da lista
-- quando a pessoa le.
CREATE TABLE IF NOT EXISTS notificacoes (
  id             TEXT PRIMARY KEY,
  empresa_id     TEXT NOT NULL REFERENCES empresas(id),
  destinatario_id TEXT NOT NULL REFERENCES usuarios(id),
  tipo           TEXT NOT NULL,
  -- solicitacao|ocorrencia|preventiva|checklist|veiculo|usuario
  nivel          TEXT NOT NULL DEFAULT 'informativo',  -- informativo|atencao|critico
  texto          TEXT NOT NULL,
  -- Para onde o clique leva: chave de tela do painel e id do registro.
  destino        TEXT,
  entidade_id    TEXT,
  lida_em        TEXT,
  criado_em      TEXT NOT NULL
);
-- A consulta que a tela faz o tempo todo e' "as minhas, nao lidas primeiro".
CREATE INDEX IF NOT EXISTS ix_notif_destinatario
  ON notificacoes(destinatario_id, lida_em, criado_em);

-- ------------------------------------------------------- eventos_auditoria
-- Historico imutavel: sem UPDATE e sem DELETE em nenhuma rota.
-- Tambem alimenta o historico completo do usuario (roadmap 8.5).
CREATE TABLE IF NOT EXISTS eventos_auditoria (
  id          TEXT PRIMARY KEY,
  empresa_id  TEXT NOT NULL,
  ator_id     TEXT,
  ator_nome   TEXT,
  alvo_id     TEXT,        -- usuario afetado, quando a acao recai sobre alguem
  acao        TEXT NOT NULL,
  entidade    TEXT NOT NULL,
  entidade_id TEXT,
  antes       TEXT,
  depois      TEXT,
  ip          TEXT,
  criado_em   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_empresa ON eventos_auditoria(empresa_id, criado_em);
CREATE INDEX IF NOT EXISTS ix_audit_entidade ON eventos_auditoria(entidade, entidade_id);
CREATE INDEX IF NOT EXISTS ix_audit_ator ON eventos_auditoria(ator_id, criado_em);
CREATE INDEX IF NOT EXISTS ix_audit_alvo ON eventos_auditoria(alvo_id, criado_em);
