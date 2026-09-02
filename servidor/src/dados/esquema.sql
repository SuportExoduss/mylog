-- MyLog — esquema multi-tenant
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

-- ---------------------------------------------------------------- usuarios
CREATE TABLE IF NOT EXISTS usuarios (
  id             TEXT PRIMARY KEY,
  empresa_id     TEXT NOT NULL REFERENCES empresas(id),
  nome           TEXT NOT NULL,
  email          TEXT NOT NULL,
  matricula      TEXT,
  papel          TEXT NOT NULL,                    -- adm|supervisor|colaborador|manutencao|auditoria
  status         TEXT NOT NULL DEFAULT 'pendente', -- pendente|ativo|bloqueado|suspenso|desativado
  senha_hash     TEXT,
  senha_salt     TEXT,
  senha_definida INTEGER NOT NULL DEFAULT 0,
  ativado_em     TEXT,
  ativado_por    TEXT,
  criado_em      TEXT NOT NULL,
  atualizado_em  TEXT NOT NULL
);
-- Email e' identidade GLOBAL, nao por empresa: o login pede so email e senha,
-- entao o mesmo email nao pode existir em duas empresas (ver docs/DECISOES.md).
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_email ON usuarios(email);
CREATE INDEX IF NOT EXISTS ix_usuarios_empresa ON usuarios(empresa_id, status);

-- ---------------------------------------------------------------- sessoes
-- Token guardado como hash. Revogacao explicita (secao 8 do roadmap).
CREATE TABLE IF NOT EXISTS sessoes (
  id          TEXT PRIMARY KEY,
  empresa_id  TEXT NOT NULL REFERENCES empresas(id),
  usuario_id  TEXT NOT NULL REFERENCES usuarios(id),
  token_hash  TEXT NOT NULL UNIQUE,
  origem      TEXT NOT NULL DEFAULT 'web',       -- web | android
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
  tipo              TEXT NOT NULL DEFAULT 'carro', -- carro|caminhao|van|moto|maquina
  km_atual          INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'disponivel',
  -- disponivel|com_pendencia|restrito|bloqueado|manutencao
  motivo_status     TEXT,
  usuario_principal TEXT REFERENCES usuarios(id),
  criado_em         TEXT NOT NULL,
  atualizado_em     TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_veiculos_placa ON veiculos(empresa_id, placa);
CREATE INDEX IF NOT EXISTS ix_veiculos_empresa ON veiculos(empresa_id, status);

-- -------------------------------------------------- vinculo usuario-veiculo
-- Camada de autorizacao (secao 9): o backend valida antes de aceitar inspecao.
CREATE TABLE IF NOT EXISTS vinculos (
  id           TEXT PRIMARY KEY,
  empresa_id   TEXT NOT NULL REFERENCES empresas(id),
  usuario_id   TEXT NOT NULL REFERENCES usuarios(id),
  veiculo_id   TEXT NOT NULL REFERENCES veiculos(id),
  principal    INTEGER NOT NULL DEFAULT 0,
  valido_de    TEXT,
  valido_ate   TEXT,
  criado_em    TEXT NOT NULL,
  criado_por   TEXT,
  revogado_em  TEXT
);
CREATE INDEX IF NOT EXISTS ix_vinculos_usuario ON vinculos(usuario_id);
CREATE INDEX IF NOT EXISTS ix_vinculos_veiculo ON vinculos(veiculo_id);

-- ---------------------------------------------------------------- templates
CREATE TABLE IF NOT EXISTS templates (
  id            TEXT PRIMARY KEY,
  empresa_id    TEXT NOT NULL REFERENCES empresas(id),
  codigo        TEXT NOT NULL,
  nome          TEXT NOT NULL,
  tipo_veiculo  TEXT,
  versao        INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'rascunho', -- rascunho|publicado|arquivado
  estrutura     TEXT NOT NULL DEFAULT '{"secoes":[]}', -- JSON: secoes/itens/regras
  publicado_em  TEXT,
  criado_em     TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_template_versao ON templates(empresa_id, codigo, versao);

-- ---------------------------------------------------------------- inspecoes
CREATE TABLE IF NOT EXISTS inspecoes (
  id            TEXT PRIMARY KEY,
  empresa_id    TEXT NOT NULL REFERENCES empresas(id),
  veiculo_id    TEXT NOT NULL REFERENCES veiculos(id),
  usuario_id    TEXT NOT NULL REFERENCES usuarios(id),
  template_id   TEXT NOT NULL REFERENCES templates(id),
  status        TEXT NOT NULL DEFAULT 'em_execucao', -- rascunho|em_execucao|sincronizando|finalizada
  km_informado  INTEGER,
  iniciada_em   TEXT NOT NULL,
  finalizada_em TEXT,
  resultado     TEXT,                                -- aprovado|com_pendencia|reprovado
  assinatura    TEXT,
  cliente_uuid  TEXT,                                -- idempotencia da fila offline
  criado_em     TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_inspecao_cliente ON inspecoes(empresa_id, cliente_uuid);
CREATE INDEX IF NOT EXISTS ix_inspecoes_veiculo ON inspecoes(empresa_id, veiculo_id, iniciada_em);

CREATE TABLE IF NOT EXISTS respostas (
  id            TEXT PRIMARY KEY,
  empresa_id    TEXT NOT NULL REFERENCES empresas(id),
  inspecao_id   TEXT NOT NULL REFERENCES inspecoes(id),
  item_id       TEXT NOT NULL,
  tipo          TEXT NOT NULL,   -- ok_nok|sim_nao|numero|selecao|texto|foto|assinatura|datahora
  valor         TEXT,
  conforme      INTEGER,
  observacao    TEXT,
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
  ticket_id     TEXT,
  item_id       TEXT,
  usuario_id    TEXT NOT NULL REFERENCES usuarios(id),
  tipo_mime     TEXT NOT NULL,
  caminho       TEXT NOT NULL,
  hash_arquivo  TEXT,
  bytes         INTEGER,
  gps_lat       REAL,
  gps_lon       REAL,
  capturado_em  TEXT NOT NULL,
  criado_em     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_evid_inspecao ON evidencias(inspecao_id);

-- --------------------------------------------------------- nao conformidades
CREATE TABLE IF NOT EXISTS nao_conformidades (
  id             TEXT PRIMARY KEY,
  empresa_id     TEXT NOT NULL REFERENCES empresas(id),
  inspecao_id    TEXT REFERENCES inspecoes(id),
  veiculo_id     TEXT NOT NULL REFERENCES veiculos(id),
  item_id        TEXT,
  descricao      TEXT NOT NULL,
  criticidade    TEXT NOT NULL DEFAULT 'baixo',  -- informativo|baixo|medio|alto|critico
  status         TEXT NOT NULL DEFAULT 'aberta', -- aberta|em_tratamento|resolvida|validada|encerrada
  responsavel_id TEXT REFERENCES usuarios(id),
  aberta_em      TEXT NOT NULL,
  resolvida_em   TEXT,
  resolucao      TEXT
);
CREATE INDEX IF NOT EXISTS ix_nc_empresa ON nao_conformidades(empresa_id, status, criticidade);

-- ----------------------------------------------------------------- tickets
CREATE TABLE IF NOT EXISTS tickets (
  id             TEXT PRIMARY KEY,
  empresa_id     TEXT NOT NULL REFERENCES empresas(id),
  numero         INTEGER NOT NULL,
  solicitante_id TEXT NOT NULL REFERENCES usuarios(id),
  veiculo_id     TEXT REFERENCES veiculos(id),
  categoria      TEXT NOT NULL,  -- problema|dano|limpeza|documentacao|solicitacao|outro
  prioridade     TEXT NOT NULL DEFAULT 'normal', -- normal|alta
  descricao      TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'aberto',
  -- aberto|em_triagem|atribuido|em_andamento|resolvido|fechado
  responsavel_id TEXT REFERENCES usuarios(id),
  prazo_em       TEXT,
  resolucao      TEXT,
  criado_em      TEXT NOT NULL,
  fechado_em     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ticket_numero ON tickets(empresa_id, numero);
CREATE INDEX IF NOT EXISTS ix_tickets_status ON tickets(empresa_id, status);

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
  concluida_por       TEXT REFERENCES usuarios(id),
  concluida_em        TEXT,
  criado_em           TEXT NOT NULL,
  atualizado_em       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_prev_empresa ON preventivas(empresa_id, status);

-- ------------------------------------------------------- eventos_auditoria
-- Historico imutavel: sem UPDATE e sem DELETE em nenhuma rota.
CREATE TABLE IF NOT EXISTS eventos_auditoria (
  id          TEXT PRIMARY KEY,
  empresa_id  TEXT NOT NULL,
  ator_id     TEXT,
  ator_nome   TEXT,
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
