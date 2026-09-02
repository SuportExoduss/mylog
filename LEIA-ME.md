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
| F1 — Fundacao | **feita** — banco multi-tenant, auth, RBAC, auditoria, esqueleto web |
| F2 — Web ADM | **feita** — usuarios, credenciais, veiculos, vinculos, dashboard e editor de checklist versionado |
| F3 — Aplicativo de campo | **parcial** — PWA com login, checklist adaptativo, evidencias, assinatura, fila offline e sincronizacao idempotente. Falta upload das fotos ao servidor e teste em aparelho real |
| F4 — Regras | **feita** — inspecao gera nao conformidade, aplica criticidade e muda o estado do veiculo conforme a politica da empresa |
| F5 — Preventivas | **feita** — KM/data, ciclo de conclusao, reagendamento e alertas no painel |
| F6 — Relatorios | nao iniciada |

## Regras que o sistema ja garante

- Cadastro nasce **pendente**: existir no banco nao da acesso. Liberar e' ato
  explicito do ADM e fica na auditoria.
- Bloquear um usuario **derruba a sessao dele na hora**, web e Android.
- Trocar o papel de alguem tambem encerra as sessoes abertas.
- Um ADM nao consegue bloquear a si mesmo, nem deixar a empresa sem administrador.
- O papel `colaborador` nao alcanca dado mestre de veiculo nem o painel.
- Placa nao pode ser trocada; hodometro nao anda para tras sem justificativa.
- Liberar veiculo bloqueado exige motivo.
- Status de preventiva e' **calculado** a partir de KM/data, nunca digitado.
- Toda empresa so enxerga os proprios dados (coberto por teste).
- Versao publicada de checklist e imutavel; editar cria a versao seguinte.
- Concluir uma preventiva obriga a definir a proxima, por KM ou por data.
- Colaborador sem veiculo proprio abre ticket escolhendo o veiculo por
  modelo/placa, sem tocar no cadastro mestre.
- Ticket so vai a "resolvido" com a solucao descrita; "fechado" e terminal.
- Ocorrencia tem duas saidas distintas: "resolvida" e quem executou, "validada"
  e a supervisao conferindo — e quem executou nao valida a propria solucao.
- O aplicativo julga a inspecao offline com o MESMO motor do servidor, mas quem
  decide e o servidor: um envio que afirma "aprovado" respondendo falha critica
  volta reprovado e bloqueia o veiculo.
- Reenvio da fila offline nunca duplica inspecao (idempotente por cliente_uuid).
- Checklist so fecha com todos os itens aplicaveis respondidos e todas as fotos
  obrigatorias anexadas — conferido no aparelho e de novo no servidor.
- KM informado no checklist nunca faz o hodometro andar para tras.
- Encerrar a ultima ocorrencia critica nao desbloqueia o veiculo sozinho:
  liberar veiculo continua sendo decisao explicita, com motivo.

## Producao — pendente antes de qualquer piloto

- [ ] Trocar SQLite por PostgreSQL (ver D2 em `docs/DECISOES.md`)
- [ ] Definir `MYLOG_SEGREDO` e `MYLOG_AMBIENTE=producao` (o servidor recusa subir sem isso)
- [ ] HTTPS na frente (o cookie so ganha `Secure` fora de desenvolvimento)
- [ ] Rotina de backup testada **com restauracao**, nao so com copia
- [ ] Politica de retencao de fotos por empresa
