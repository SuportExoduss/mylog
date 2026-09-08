# MyLog

Plataforma de checklist, tickets e manutencao preventiva de frota. Substitui o
uso operacional do PROLOG: a web e' o centro de supervisao e credenciais, o
Android e' o posto de execucao de checklist.

Os documentos, em ordem de autoridade — nao existe arquitetura paralela:

| | O que responde |
|---|---|
| [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) | Para onde o sistema vai, e em que ordem |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | O produto, as regras e em que ponto do caminho estamos |
| [`docs/DECISOES.md`](docs/DECISOES.md) | Por que cada escolha foi feita, e o que ela custou |
| [`docs/API.md`](docs/API.md) | O contrato com os clientes — e' o que o app Android consome |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Principios de interface |

`docs/historico/` guarda instantaneos com a data no nome. Sao leitura, nunca
fonte: quem procura o que vale hoje procura na tabela acima.

## Duas frentes

| | Endereco | Quem usa |
|---|---|---|
| Painel web | `http://localhost:4000` | ADM, supervisao, manutencao, auditoria |
| Aplicativo de campo | `http://localhost:4000/app/` | quem executa checklist |

O aplicativo **exige internet** (D58): nao ha fila, deposito local nem
service worker. No Android da para adicionar a tela inicial pelo menu do
navegador, mas ele nao abre sem rede — e nem tenta.

## Rodar

Precisa apenas de Node 22.5+ (a maquina tem a 24). Nao ha dependencias para instalar.

```bash
cd servidor
npm run semear   # cria o banco de desenvolvimento com dados de exemplo
npm start        # http://localhost:4000
```

Credenciais da semente — todas com a senha `mylog123`. Sao dados de
desenvolvimento: a semente nao roda fora de `MYLOG_AMBIENTE=desenvolvimento`.

| Nivel | Email | Cargo | Observacao |
|---|---|---|---|
| Frota | `adm@mylog.local` | Equipe de frota | acessa o painel |
| Frota | `marina@mylog.local` | Manutencao | acessa o painel |
| Colaborador | `carlos@mylog.local` | Motorista | usa carro todo dia: checklist avulso |
| Colaborador | `rita@mylog.local` | Vendas | pede carro: tem saida e retorno |
| Colaborador | `joao@mylog.local` | Tecnico | pendente: cai na troca de senha |
| Colaborador | `bruno@mylog.local` | Motorista | bloqueado: nao entra |

Sao dois niveis de acesso, nao cinco papeis: Frota (`acessa_painel`) e
Colaborador. **Cargo nao e' permissao** — ele decide quais modelos de checklist
aparecem, e nada mais.

Testes das regras de dominio:

```bash
cd servidor && npm run testar
```

## Estrutura

```
compartilhado/
  template.js     motor de checklist — roda no servidor E no aplicativo
  marca.js        white label: tokens permitidos e padroes do MyLog
  contraste.js    razao de contraste da WCAG, usada pelos dois lados
servidor/
  src/
    nucleo/       config, banco, roteador http, auditoria,
                  motor de preventivas, motor de checklist
    seguranca/    senha (scrypt), sessao revogavel, tabela de permissoes
    rotas/        autenticacao, painel, usuarios, veiculos, templates,
                  preventivas, solicitacoes, ocorrencias, auditoria, marca
    dados/        esquema.sql e semente de desenvolvimento
  testes/         regras que nao podem quebrar em silencio
web/
  index.html      shell (login + painel)
  css/            folha unica
  js/             api, ui, e uma tela por arquivo
app/              aplicativo de campo (Web, exige internet)
  index.html      shell
  js/             envio (rede), checklist (execucao), app (telas)
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
| F3 — Aplicativo de campo | **feita** — checklist com foto, saida e retorno; offline removido na v3.2 (D58) |
| F4 — Regras | **feita** — prioridade, bloqueio por critica, ocorrencias |
| F5 — Preventivas | **feita** — KM/data, ciclo de conclusao, alertas |
| F5.1 — White label | **feita** — nome, logo e cores da marca por empresa, com co-branding MyLog (D59) |
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
- Nova tentativa de envio nao duplica inspecao nem evidencia.
- Toda empresa so enxerga os proprios dados.

## Producao — pendente antes de qualquer piloto

- [ ] Subir a pilha de producao — Firebase Hosting, Authentication, Firestore,
      Cloud Functions e Cloudflare R2 (ver `docs/ARQUITETURA.md`)
- [ ] Definir `MYLOG_SEGREDO` e `MYLOG_AMBIENTE=producao` (o servidor recusa subir sem isso)
- [ ] Conferir `MYLOG_FUSO` — o fuso da operacao, nao o da maquina. Padrao
      `America/Sao_Paulo`; e' ele que decide onde termina o dia (D37)
- [ ] HTTPS na frente (o cookie so ganha `Secure` fora de desenvolvimento)
- [ ] Definir `MYLOG_PROXIES_CONFIAVEIS` com o numero de proxies na frente.
      Zero (o padrao) ignora `x-forwarded-for`; atras de proxy, o valor errado
      quebra o freio de login nos dois sentidos (D49)
- [ ] Rotina de backup testada **com restauracao**, nao so com copia
- [ ] Politica de retencao de fotos por empresa
