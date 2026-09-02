# MyLog

Plataforma de checklist, tickets e manutencao preventiva de frota. Substitui o
uso operacional do PROLOG: a web e' o centro de supervisao e credenciais, o
Android e' o posto de execucao de checklist.

Especificacao-mestra: `MyLog_Roadmap_Completo.docx`.
Decisoes tecnicas e o porque de cada uma: [`docs/DECISOES.md`](docs/DECISOES.md).

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
servidor/
  src/
    nucleo/       config, banco, roteador http, auditoria, motor de preventivas
    seguranca/    senha (scrypt), sessao revogavel, tabela de permissoes
    rotas/        autenticacao, usuarios, veiculos e vinculos, painel
    dados/        esquema.sql e semente de desenvolvimento
  testes/         regras que nao podem quebrar em silencio
web/
  index.html      shell (login + painel)
  css/            folha unica
  js/             api, ui, e uma tela por arquivo
docs/
  DECISOES.md     registro de decisoes tecnicas
```

## Estado por fase do roadmap

| Fase | Situacao |
|---|---|
| F1 — Fundacao | **feita** — banco multi-tenant, auth, RBAC, auditoria, esqueleto web |
| F2 — Web ADM | **parcial** — usuarios, credenciais, veiculos, vinculos e dashboard prontos; falta o editor de template de checklist |
| F3 — Android | nao iniciada |
| F4 — Regras | nao iniciada (tabelas ja modeladas) |
| F5 — Preventivas | motor de status pronto e testado; falta a tela e o ciclo de reagendamento |
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

## Producao — pendente antes de qualquer piloto

- [ ] Trocar SQLite por PostgreSQL (ver D2 em `docs/DECISOES.md`)
- [ ] Definir `MYLOG_SEGREDO` e `MYLOG_AMBIENTE=producao` (o servidor recusa subir sem isso)
- [ ] HTTPS na frente (o cookie so ganha `Secure` fora de desenvolvimento)
- [ ] Rotina de backup testada **com restauracao**, nao so com copia
- [ ] Politica de retencao de fotos por empresa
