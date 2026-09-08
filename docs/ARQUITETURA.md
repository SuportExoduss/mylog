# MyLog — Arquitetura

Documento de topo. Define **para onde** o sistema vai; o
[`ROADMAP.md`](ROADMAP.md) diz em que ponto do caminho ele está, o
[`DECISOES.md`](DECISOES.md) registra por que cada escolha foi feita, e o
[`API.md`](API.md) é o contrato com os clientes.

> Regra da hierarquia: **não existe arquitetura paralela.** Qualquer decisão
> nova que contrarie este documento precisa ser escrita aqui, com data e
> motivo, antes de virar código.

Base: revisão crítica de arquitetura de **06/09/2026** e seu Adendo V2.

---

## 1. As duas fases

A arquitetura tem duas metades, e a ordem entre elas não é preferência, é
dependência.

```
CONSTRUÇÃO (agora)                    PRODUÇÃO (depois)
notebook                              nuvem
Node puro + SQLite + disco            Firebase + Firestore + R2
sessão própria                        Firebase Authentication
```

**A construção não antecipa a produção.** Migrar infraestrutura enquanto a Web
ainda está sendo escrita produz as duas coisas pela metade. O critério de saída
do notebook está na seção 5.

---

## 2. Pilha de produção — decidida

| Camada | Escolha | Papel |
|---|---|---|
| Hospedagem | Firebase Hosting | Serve o painel e o cliente de campo. Sem dado sensível. |
| Identidade | Firebase Authentication | Diz **quem é a pessoa**. Não diz o que ela pode. |
| Banco | Cloud Firestore | Dados estruturados, sempre escopados à empresa. |
| Servidor | Cloud Functions | Autoridade. Autorização, regras, re-julgamento, jobs. |
| Arquivos | Cloudflare R2 | Fotos e branding. Privado, nunca URL pública permanente. |
| Cliente web | Painel administrativo | Supervisão, cadastro, configuração, relatórios. |
| Cliente de campo | Web **em regime de manutenção**, Android nativo em seguida | Mesmo contrato, mesmo domínio. Ver 4.1. |

**Regra de ouro.** A URL identifica o contexto. A autenticação identifica a
pessoa. O membership determina o vínculo. O `empresaId` determina o tenant. A
autorização determina a capacidade. O Firestore guarda dados. O R2 guarda
arquivos.

---

## 3. Multiempresa

O sistema é SaaS multiempresa. Isso não estará pronto porque existe uma coluna
`empresa_id` — estará pronto quando um usuário autenticado de uma empresa **não
conseguir ler, escrever, baixar nem inferir** dados de outra manipulando URL,
identificador, payload ou endpoint.

```
UID → membership → empresaId → a entidade é desta empresa? → tem a capacidade?
```

- O **slug** (`/transportadora-silva/`) é contexto de navegação. **Nunca**
  autoriza sozinho.
- O **`empresaId`** é a identidade interna, estável, independente do nome e do
  domínio. Trocar `mylog.web.app` por `mylog.com.br` não toca nele.
- O **membership** separa identidade global de vínculo organizacional, para que
  um mesmo UID possa pertencer a mais de uma empresa no futuro. A experiência
  inicial pode ser simples; a modelagem não pode impedir a evolução.

Dois pontos de entrada, uma só autorização: login global na raiz (escolhe a
empresa quando houver mais de uma) e login contextual em `/{slug}/` (o contexto
já foi escolhido pela URL, mas o vínculo ainda é verificado).

### O que já vale hoje

Vale a pena registrar o que **não** precisa ser construído: toda tabela de
domínio já tem `empresa_id`, o servidor **nunca** aceita a empresa vinda do
cliente — ela sai sempre da sessão — e o acesso cruzado responde **404, não
403**, porque 403 confirmaria que o identificador existe.

---

## 4. Domínio — o que a migração não pode tocar

O domínio é o patrimônio do projeto. A infraestrutura muda; ele não.

Dois níveis de acesso (Frota e Colaborador) · cargo **não é** permissão, decide
quais checklists aparecem · placa imutável · KM não retrocede sem justificativa
· modelo publicado é imutável, alteração gera versão nova · a inspeção aponta
para a versão **respondida**, e o relatório histórico nunca a reinterpreta com o
modelo de hoje · o servidor **re-julga** toda inspeção e ignora o resultado
enviado pelo cliente · `cliente_uuid` garante idempotência, e por isso nova
tentativa nunca duplica · ocorrência crítica bloqueia o veículo e só decisão humana
com motivo o libera · preventiva tem status derivado e ciclo novo a cada
realização · auditoria é append-only.

O motor `compartilhado/template.js` é o ativo central: determinístico, sem
banco, sem DOM, sem Node, **entrada explícita**, usado igual pelos dois lados.
Não existirá um segundo motor no Android.

### 4.1 O cliente Web está congelado

**Decisão de 06/09/2026.** O aplicativo de campo Android será escrito **do zero,
original**, em Android Studio. Nada do cliente Web vira código nele.

> **08/09/2026 ([D58](DECISOES.md#d58--o-offline-sai-inteiro-e-o-que-ele-protegia-fica)).**
> O offline saiu dos dois: nem a Web nem o Android terão fila, depósito local
> ou service worker. O MyLog exige internet para operar. O que a remoção **não**
> tirou é o que o nativo precisa herdar: falhar não perde o trabalho, evidência
> não some em silêncio, e nova tentativa não duplica.

Portanto o `app/` entra em **regime de manutenção**. Só se mexe nele em duas
situações:

1. quando algo ali quebrar o painel, o servidor ou o contrato da API;
2. quando o próprio cliente Web estiver impedindo a homologação em aparelho
   real — que é o que produz a evidência sobre o campo.

Todo o resto do esforço vai para o **painel, o servidor e o contrato**.

**Isso não é abandono, e o cliente Web não é desperdício.** Ele é o único
cliente de campo que existe até o APK sair: sem ele, ninguém executa checklist nenhum
durante a construção. E ele é a **implementação de referência** para quem
escrever o Android — não como código a copiar, mas como resposta funcionando às
perguntas que o nativo vai ter que responder: o que o servidor espera em cada
envio, como a dependência foto→inspeção é respeitada, o que a tela mostra quando
o servidor recusa.

**O que de fato se aproveita no Android é o contrato**, não o cliente. Por isso
[`API.md`](API.md) é trabalho de primeira classe desta fase, e não documentação
para depois.

---

## 5. Ordem de trabalho

| Etapa | Entrega | Porta de saída |
|---|---|---|
| 1 — Notebook | Web ADM/Supervisão completa e testada | seção 5.1 |
| 2 — Nuvem | Hosting, Auth, Firestore, Functions, R2, staging | tenant isolation provado |
| 3 — Web online | Login global e contextual, multiempresa, branding | homologação de segurança |
| 4 — Android | Cliente nativo sobre o mesmo contrato | testes em aparelho real |
| 5 — Piloto | Uso real em paralelo com o PROLOG | comparação operacional |

### 5.1 Critério para sair do notebook

Não é "a tela ficou pronta". É: login, os dois níveis, usuários e cargos,
veículos e estados, solicitações, checklists publicados e versionados,
execuções, evidências, ocorrências, preventivas, notificações, relatórios,
auditoria e fila de ação — **todos com teste de regressão passando e
documentação que corresponde ao comportamento real**.

---

## 6. Conflitos com decisões anteriores

Registrados aqui porque arquitetura dupla silenciosa é o pior risco do projeto.

**PostgreSQL → Firestore.** O `DECISOES.md` previa PostgreSQL em produção. O
destino agora é Firestore. A escolha de manter o SQLite portável (ids em texto,
sem `AUTOINCREMENT`, ISO-8601 em UTC) continua valendo: ela facilita qualquer
migração, não só a relacional.

**D1 — zero dependências npm — não sobrevive à etapa 2.** O SDK do Firebase é
uma árvore grande de pacotes. A decisão vale integralmente na construção e será
**aposentada explicitamente** quando a nuvem entrar, com data e motivo. Não pode
ser violada em silêncio.

**Sessão própria × Firebase Auth.** Hoje existe token opaco revogável, e o
bloqueio de usuário depende de **revogação imediata**. O Firebase Auth revoga no
refresh, não no instante. Isso precisa de decisão consciente **antes** da
migração de identidade, não durante: ou o bloqueio passa a ser verificado a cada
chamada na Cloud Function, ou a janela de revogação vira um número aceito e
documentado.

**Atomicidade acidental.** Resolvido na etapa 1 pela [D39](DECISOES.md):
aprovação de reserva, liberação de veículo e encerramento de ocorrência gravam
estado, efeito e auditoria dentro de uma transação, e `transacao()` usa `BEGIN
IMMEDIATE` para que a leitura que decide já segure a trava. Continua valendo a
ressalva: em Cloud Functions a serialização depende do banco, e o Firestore tem
o próprio modelo de transação — a garantia precisa ser reescrita nele, não
herdada.

**Fuso horário.** Resolvido na etapa 1 pela [D37](DECISOES.md): o dia é da
operação, vem de `MYLOG_FUSO`, e não do relógio do processo. Sem isso, subir
para uma nuvem em UTC deslocaria todo limite de dia em três horas sem gerar um
único erro.

---

## 7. White Label

> **Implementado em 08/09/2026** ([D59](DECISOES.md#d59--white-label-muda-a-marca-e-só-a-marca)).
> Tela **Configurações**, ao pé da lateral do painel. O motor é
> `compartilhado/marca.js` + `compartilhado/contraste.js`, usados iguais pelo
> servidor e pelo painel. Persistência na tabela `marcas`; a logo no storage.
> Falta migrar para Firestore/R2 junto com o resto (etapa 2).

Personalização por empresa com **co-branding obrigatório**: a marca MyLog
permanece ao lado da marca do contratante. Uma empresa nunca altera a aparência
de outra, e branding não toca em regra, permissão, dado nem histórico.

A personalização atua sobre **tokens semânticos**, nunca sobre CSS livre. Nada
de HTML, JavaScript ou folha de estilo vinda do tenant.

Tema claro e tema escuro são configuráveis **em separado** — cada um com seu
conjunto de tokens, cada um podendo voltar ao padrão MyLog sozinho. Contraste é
validado antes de salvar; há prévia antes de publicar; a publicação é atômica e
gera auditoria; upload que falha não pode deixar a empresa sem logo válida.

Configuração e tokens no Firestore, arquivos no R2, ambos escopados ao tenant. O
cliente de campo **nunca** troca silenciosamente para a marca de outra
empresa — o branding chega junto com o contexto, e o contexto tem dono.

> A camada que isso exige já existia no CSS: `web/css/estilo.css` separa paleta
> primitiva de tokens semânticos (`--fundo`, `--superficie`, `--texto`,
> `--marca`, `--ok`, `--critico`…), com claro e escuro declarados em blocos
> independentes. O mecanismo de sobreposição por empresa é uma folha de estilo
> montada em `web/js/marca.js`, que espelha essa mesma cascata.
>
> **Personalizável é a família da marca, e só ela.** As cores de estado ficam
> de fora por decisão registrada: elas dizem o que a tela *significa*, não como
> ela se parece. Ver [D59](DECISOES.md#d59--white-label-muda-a-marca-e-só-a-marca).

---

## 8. Endurecimento antes da produção

**Segurança.** Isolamento entre empresas provado por teste que chama a API com
payload manipulado — esconder o recurso na tela não conta. Autorização sempre no
servidor. Segredos fora do código. HTTPS obrigatório.

Três coisas já resolvidas na etapa 1, com uma ressalva cada:

- **Cabeçalhos** ([D41](DECISOES.md)) — CSP estrita, `frame-ancestors 'none'`,
  `referrer-policy`, e uma `permissions-policy` que preserva câmera e
  localização. **HSTS já está escrito mas só dispara em produção sobre HTTPS**,
  então a etapa 2 precisa confirmar que ele realmente aparece atrás do Firebase
  Hosting.

- **Content-Type real** ([D38](DECISOES.md)) — o tipo do arquivo sai dos bytes,
  não do que o cliente declarou. Vale desde já, e passa a valer *mais* quando a
  foto for servida por URL assinada do R2, sem `nosniff` na frente.
- **Freio de tentativas** ([D40](DECISOES.md)) — login, troca de senha e
  varredura por IP. **A contagem vive na memória do processo.** Em Cloud
  Functions, cada instância teria a própria, e o freio afrouxaria na proporção
  do número de instâncias: a contagem precisa mudar de lugar junto com o
  servidor, para Firestore ou equivalente. É item obrigatório da etapa 2.

**Concorrência.** Aprovação, liberação, fechamento de ocorrência, reenvio com o
mesmo `cliente_uuid` e upload duplicado precisam de operação atômica. A
idempotência já é reforçada por índice único no banco, e não só por lógica de
aplicação — isso deve sobreviver à migração.

**Envio.** Não há fila
([D58](DECISOES.md#d58--o-offline-sai-inteiro-e-o-que-ele-protegia-fica)): o
checklist sobe no ato. O que a fila garantia continua sendo obrigação de quem
envia — erro temporário oferece nova tentativa com o trabalho intacto na tela;
erro permanente para de insistir e **aparece para a pessoa**. Nada desaparece
em silêncio, e nada é descartado sem confirmação explícita.

**Observabilidade.** `requestId` atravessando log, auditoria, erro e job. Logs
estruturados com o tenant, sem vazar dado. Métricas de latência, falha de envio,
falha de upload e consumo.

**Recuperação.** Backup com **restore testado em ambiente separado**. RPO e RTO
definidos. Runbook. Backup sem restore comprovado não é estratégia.

---

## 9. Critérios de aceite da arquitetura final

| Pergunta | Resposta exigida |
|---|---|
| Acesso `/empresa-b` estando autorizado só na A? | **NÃO** |
| Altero `empresaId` no payload e entro em B? | **NÃO** |
| Baixo uma foto de B sabendo o `storageKey`? | **NÃO** |
| Uso a logo de B no tenant A? | **NÃO** |
| Colaborador executa operação administrativa? | **NÃO** |
| A Web funciona na raiz, sem slug? | **SIM** |
| Entro direto em `/empresa-a/` e faço login? | **SIM**, com membership em A |
| Um usuário pode ter várias empresas no futuro? | **SIM** |
| Android usa o mesmo domínio de checklist? | **SIM** |
| Empresa personaliza claro e escuro em separado? | **SIM** |
| Empresa remove a identidade MyLog? | **NÃO** — é co-branding |

Nenhuma etapa é declarada concluída por compilar. O critério é **código + testes
+ validação de comportamento + regressão**.
