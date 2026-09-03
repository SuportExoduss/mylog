# MyLog

Plataforma de checklist, tickets e manutencao preventiva de frota. Substitui o
uso operacional do PROLOG: a web e' o centro de supervisao e credenciais, o
Android e' o posto de execucao de checklist.

Especificacao-mestra: `MyLog_Roadmap_Completo.docx`.
Decisoes tecnicas e o porque de cada uma: [`docs/DECISOES.md`](docs/DECISOES.md).

## Duas frentes

| | Endereco | Quem usa |
|---|---|---|
| Painel web | `http://localhost:4000` | ADM, supervisao, manutencao, auditoria |
| Aplicativo de campo | `http://localhost:4000/app/` | quem executa checklist |

O aplicativo e um PWA instalavel: no Android, "Adicionar a tela inicial".

## Rodar

Precisa apenas de Node 22.5+ (a maquina tem a 24). Nao ha dependencias para instalar.

```bash
cd servidor
npm run semear   # cria o banco de desenvolvimento com dados de exemplo
npm start        # http://localhost:4000
```

Credenciais da semente:

| Papel | Email | Senha | Observacao |
|---|---|---|---|
| Administrador | `adm@mylog.local` | `mylog123` | acesso total |
| Supervisor | `supervisao@mylog.local` | `mylog123` | nao libera credencial |
| Colaborador | `carlos@mylog.local` | `mylog123` | sem acesso ao painel |
| Pendente | `rita@mylog.local` | `mylog123` | nao entra ate ser liberada |
| Bloqueado | `bruno@mylog.local` | `mylog123` | acesso revogado |

Testes das regras de dominio:

```bash
cd servidor && npm test
```

## Estrutura

```
compartilhado/
  template.js     motor de checklist — roda no servidor E no aplicativo
servidor/
  src/
    nucleo/       config, banco, roteador http, auditoria,
                  motor de preventivas, motor de checklist
    seguranca/    senha (scrypt), sessao revogavel, tabela de permissoes
    rotas/        autenticacao, painel, usuarios, veiculos, templates,
                  preventivas, tickets, ocorrencias, auditoria
    dados/        esquema.sql e semente de desenvolvimento
  testes/         regras que nao podem quebrar em silencio
web/
  index.html      shell (login + painel)
  css/            folha unica
  js/             api, ui, e uma tela por arquivo
app/              aplicativo de campo (PWA instalavel)
  index.html      shell
  sw.js           service worker: guarda a casca, nunca resposta de API
  js/             armazem (IndexedDB), sincronia (fila), checklist, telas
docs/
  DECISOES.md     registro de decisoes tecnicas
  DESIGN.md       design system e identidade visual
```

## Estado por fase do roadmap

| Fase | Situacao |
|---|---|
| F0 — Descoberta do PROLOG | pendente — depende da empresa |
| F1 — Fundacao | **feita** — banco multi-tenant, auth, dois niveis, auditoria |
| F2 — Web ADM | **feita** — usuarios, cargos, frota, solicitacoes, ocorrencias, checklists, auditoria |
| F3 — Aplicativo de campo | **feita** — PWA offline com checklist de foto, saida e retorno |
| F4 — Regras | **feita** — prioridade, bloqueio por critica, ocorrencias |
| F5 — Preventivas | **feita** — KM/data, ciclo de conclusao, alertas |
| F6 — Relatorios | pendente |
| F7 — Piloto | pendente |

## Regras que o sistema ja garante

- Cadastro nasce **pendente** com senha gerada; vira **ativo** quando o proprio
  colaborador troca a senha. A Frota nao ativa ninguem.
- Enquanto a senha inicial nao for trocada, a sessao existe mas nao abre mais nada.
- Bloquear alguem derruba a sessao dele na requisicao seguinte.
- A empresa nao fica sem ninguem na equipe da frota.
- CPF passa por validacao de digito verificador; email e identidade global.
- Placa nao muda; hodometro nao anda para tras sem justificativa.
- Duas reservas do mesmo veiculo nao se sobrepoem — conferido no pedido **e** na
  aprovacao.
- Devolucao fora do prazo exige motivo escrito antes de encerrar.
- Checklist so publica com estrutura completa; versao publicada e imutavel.
- Cargo nao liberado no modelo faz o checklist nem aparecer no aplicativo.
- Ocorrencia de prioridade **critica** bloqueia o veiculo; so a Frota libera,
  com motivo.
- O servidor **re-julga** toda inspecao recebida: o resultado que o aplicativo
  mandou e ignorado.
- Reenvio da fila offline nao duplica inspecao.
- Toda empresa so enxerga os proprios dados.

## Producao — pendente antes de qualquer piloto

- [ ] Trocar SQLite por PostgreSQL (ver D2 em `docs/DECISOES.md`)
- [ ] Definir `MYLOG_SEGREDO` e `MYLOG_AMBIENTE=producao` (o servidor recusa subir sem isso)
- [ ] HTTPS na frente (o cookie so ganha `Secure` fora de desenvolvimento)
- [ ] Rotina de backup testada **com restauracao**, nao so com copia
- [ ] Politica de retencao de fotos por empresa
