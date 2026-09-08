# API do MyLog — contrato para o aplicativo Android

Este documento existe por um motivo: o aplicativo Android será escrito do zero,
em Android Studio, por alguém que não vai ler o código do servidor. **A API é o
contrato entre os dois**, e um contrato que só existe na cabeça de quem
escreveu o servidor não é contrato.

Tudo aqui foi conferido contra as rotas reais em `servidor/src/rotas/`.

---

## 1. O essencial em cinco minutos

| | |
|---|---|
| Base | `https://<servidor>` — tudo sob `/api/` |
| Formato | JSON, UTF-8. `content-type: application/json` |
| Autenticação | `Authorization: Bearer <token>` |
| Erro | `{ "erro": "<codigo>", "mensagem": "<texto em portugues>" }` |
| Limite de corpo | 6 MB (uma foto em base64 cabe) |

O aplicativo precisa de **apenas quatro rotas** para o ciclo completo de
checklist:

1. `POST /api/auth/login` — entrar
2. `GET /api/app/inicio` — baixar tudo que o dia exige, de uma vez
3. `POST /api/inspecoes` — enviar o checklist executado
4. `POST /api/inspecoes/:id/evidencias` — enviar cada foto

O resto da API é do painel web. Um app de campo que implemente essas quatro
faz o ciclo inteiro. A quinta, `GET /api/inspecoes` (§9), não fecha ciclo
nenhum — só responde *"já mandei?"*, e é o que evita o reenvio por dúvida.

---

## 2. Autenticação

### Entrar

```
POST /api/auth/login
{ "email": "carlos@empresa.com", "senha": "..." }
```

```json
{
  "usuario": {
    "id": "usr_...", "nome": "Carlos Nunes", "email": "...",
    "cargo_id": "cgo_...", "cargo_nome": "Motorista",
    "nivel": "colaborador",
    "acessa_painel": false,
    "usa_veiculo_diario": true,
    "deve_trocar_senha": false,
    "status": "ativo"
  },
  "token": "ZR2d4lxvuFnNVPej-HWH8VZF5KCnfprWVCCNU_3dYIY",
  "expira_em": "2026-09-04T23:51:39.202Z"
}
```

O token é **opaco e revogável**. O servidor guarda apenas o HMAC dele — não há
como reconstruí-lo a partir do banco. Guarde-o no `EncryptedSharedPreferences`,
nunca em texto puro.

> **Sessão web usa cookie; app usa Bearer.** A mesma rota atende os dois. Para
> o Android, use sempre o cabeçalho.

### Primeiro acesso

Se `deve_trocar_senha` vier `true`, **nenhuma outra rota responde** — todas
devolvem `403` com `erro: "troca_de_senha_obrigatoria"`. O app precisa mostrar
a troca antes de qualquer tela:

```
POST /api/auth/senha
{ "senha_atual": "...", "senha_nova": "..." }
```

A senha nova precisa ser diferente da inicial e ter no mínimo 8 caracteres.

### Sair

```
POST /api/auth/sair
```

Revoga o token. O app deve chamar isso ao deslogar, não só apagar o token
local: um token esquecido no aparelho continua valendo até expirar.

---

## 3. O dia inteiro numa requisição

```
GET /api/app/inicio
```

Devolve **tudo que o aplicativo precisa para funcionar offline pelo resto do
dia**. Chame ao abrir e ao puxar para atualizar; guarde a resposta inteira
localmente (Room, DataStore, o que preferir).

```json
{
  "usuario": { "id": "...", "nome": "...", "cargo_id": "...", "cargo_nome": "Motorista",
               "usa_veiculo_diario": true },

  "tarefas": [
    { "solicitacao_id": "sol_...", "numero": 2, "momento": "saida",
      "janela_inicio": "...", "janela_fim": "...", "motivo": "...",
      "atrasada": false, "template_id": "tpl_...",
      "veiculo": { "id": "vei_...", "placa": "ABC1D23", "marca": "Fiat",
                   "modelo": "Strada", "tipo": "pickup", "km_atual": 41200 } }
  ],

  "preventivas": [
    { "preventiva_id": "prv_...", "momento": "saida", "status": "vencida",
      "modo": "km", "alvo": "51000 km", "template_id": "tpl_...",
      "veiculo": { "...": "..." } }
  ],

  "avulso": [
    { "veiculo": { "...": "..." }, "templates": ["tpl_..."] }
  ],

  "modelos": [
    { "id": "tpl_...", "codigo": "diario-compacto", "nome": "...", "versao": 1,
      "finalidade": "padrao",
      "exige_assinatura": false,
      "periodicidade": "diario", "dias_semana": [1,2,3,4,5], "horario_limite": "08:30",
      "estrutura": { "perguntas": [ "..." ] } }
  ],

  "politicas": { "bloqueio_por_critica": true },
  "gerado_em": "2026-09-06T10:18:00.000Z"
}
```

### As três origens de um checklist

Esta é a distinção mais importante da API, e a que mais confunde quem chega:

| Lista | O que é | Ao enviar, mande |
|---|---|---|
| `tarefas` | Veículo pedido e liberado. Saída e **retorno obrigatórios** | `solicitacao_id` |
| `preventivas` | Manutenção agendada. Saída e **retorno obrigatórios** | `preventiva_id` |
| `avulso` | Checklist diário de quem usa carro todo dia. **Só saída** | `veiculo_id` |

Mande **um** dos três. Mandar `solicitacao_id` e `preventiva_id` juntos é
recusado com `400`.

`avulso` só vem preenchido para quem tem `usa_veiculo_diario: true`. Não há
condutor fixo: a lista traz os carros do galpão para a pessoa escolher.

---

## 4. A estrutura de um checklist

`modelos[].estrutura` é o que o app renderiza:

```json
{
  "perguntas": [
    {
      "id": "lateral_esquerda",
      "titulo": "Lateral esquerda",
      "foto_exibicao": "/imagens/modelo/tpl_.../a1b2c3.jpg",
      "foto_ok": "obrigatorio",
      "max_fotos_ok": 4,
      "opcoes_problema": [
        { "id": "risco", "nome": "Risco na pintura",
          "foto": "obrigatorio", "max_fotos": 3,
          "abrir_ocorrencia": true, "prioridade": "baixa" }
      ]
    }
  ]
}
```

| Campo | Valores |
|---|---|
| `foto_ok`, `foto` | `obrigatorio` · `opcional` · `nao_capturar` |
| `prioridade` | `baixa` · `media` · `alta` · `critica` |
| `finalidade` | `padrao` · `preventiva` |
| `periodicidade` | `avulso` · `diario` · `semanal` · `mensal` |
| `dias_semana` | `0`=domingo … `6`=sábado |
| `momento` | `saida` · `retorno` |

`foto_exibicao` é uma URL **relativa ao servidor**, servida em `/imagens/...`.
Exige a mesma sessão das outras rotas: mande o `Authorization` também nela.
Baixe e guarde no aparelho — o checklist precisa abrir sem sinal.

### O julgamento é do servidor

O aplicativo **pode** avaliar o checklist localmente para mostrar o resumo antes
de enviar — o painel web faz isso. Mas o servidor **re-julga do zero** quando
recebe, com a mesma lógica e a versão do modelo que foi respondida. Qualquer
resultado que venha no corpo é ignorado.

Isso não é desconfiança do app: um aparelho no pátio é cliente não confiável, e
o resultado do checklist é o que bloqueia ou libera um caminhão.

Se o app quiser espelhar a lógica, ela está em `compartilhado/template.js` —
umas 300 linhas, sem dependência, portável para Kotlin quase linha a linha.

---

## 5. Enviar um checklist

```
POST /api/inspecoes
```

```json
{
  "cliente_uuid": "gerado-no-aparelho-uma-vez-por-checklist",

  "solicitacao_id": "sol_...",
  "preventiva_id": null,
  "veiculo_id": null,

  "template_id": "tpl_...",
  "momento": "saida",
  "km_informado": 41850,
  "assinatura": "data:image/png;base64,...",

  "iniciada_em": "2026-09-06T07:12:00.000Z",
  "finalizada_em": "2026-09-06T07:20:00.000Z",

  "respostas": {
    "lateral_esquerda": {
      "desfecho": "ok",
      "fotos": 2
    },
    "pneus": {
      "desfecho": "ocorrencia",
      "opcao_id": "liso",
      "relatorio": "texto livre, quando não escolheu opção",
      "fotos": 1
    }
  },

  "proxima_preventiva": { "modo": "km", "proximo_km": 116000 }
}
```

### Os dois instantes são obrigatórios num app offline

`iniciada_em` e `finalizada_em` dizem quando o checklist **aconteceu**. Se o app
não mandar, o servidor usa a hora em que **recebeu** — e num envio offline isso é
a hora em que o aparelho pegou sinal.

O estrago não é cosmético. Quem preenche às 07h50 no galpão e só tem rede às 14h
aparece como **atrasado** num modelo com prazo até 08h30; e quem termina às 23h50
e sincroniza à meia-noite e dez cai no dia seguinte, some do dia certo e vira
**falta** no relatório de quem não fez.

**Mande os dois, sempre**, no relógio do aparelho, em ISO-8601 com fuso.

O servidor aceita dentro de uma janela e não confia cegamente — relógio de
celular atrasa, adianta e pode ser mexido:

| Situação | O que o servidor faz |
|---|---|
| Mais de 5 min no futuro | Usa a hora do recebimento e registra na auditoria |
| Mais de 30 dias atrás | Idem |
| `finalizada_em` antes de `iniciada_em` | Usa `iniciada_em` |
| Ilegível | Usa a hora do recebimento, e **registra** `inspecao.relogio_recusado` |
| Ausente | Usa a hora do recebimento, sem registro — não informar não é defeito |

Fora da janela **a inspeção não é recusada** — ela aconteceu no mundo. Só a hora
informada é descartada.

### `cliente_uuid` — a peça que faz o offline funcionar

Gere **um por checklist, no aparelho, antes de começar**. Reenviar o mesmo
`cliente_uuid` devolve a inspeção existente com `repetida: true`, em vez de
duplicar:

```json
{ "inspecao": { "...": "..." }, "repetida": true }
```

Isso é o que permite a fila offline reenviar sem medo. A resposta pode ter se
perdido no caminho; a inspeção, não.

### `antes` e `depois` vêm sempre como objeto

Nos eventos de auditoria — tanto em `GET /api/auditoria` quanto em
`GET /api/veiculos/:id/historico` — os campos `antes` e `depois` chegam **já
lidos**, como objeto JSON, e não como texto. Podem ser `null` quando o evento
não tem um dos lados (a primeira publicação de um checklist não substitui
ninguém).

### `PUT /api/templates/:id` aceita corpo parcial

Mande só o que mudou. Todo campo ausente conserva o valor que já estava —
inclusive `estrutura`, `dias_semana` e `horario_limite`. Só versão em
`rascunho` aceita o `PUT`, e o mesmo vale para o envio da imagem de exemplo
(`POST /api/templates/:id/imagem`): versão publicada é imutável (D50).

### O `template_id` pode ser de uma versão arquivada

Pode, e precisa poder: é a versão que o aparelho baixou antes de ficar sem
sinal. Só `rascunho` é recusado (`409`) — um rascunho nunca passou pela
conferência de estrutura, que só roda na publicação. Ver D50.

O atalho é **por autor**. O mesmo `cliente_uuid` vindo de outra conta da mesma
empresa responde `409 conflito` — não é reenvio, é colisão de id, e o aplicativo
precisa gerar outro. (Devolver a inspeção passaria por cima da regra que as duas
rotas de leitura aplicam: colaborador só enxerga as inspeções que ele mesmo fez.)

### `fotos` é uma contagem, não os arquivos

O campo `fotos` de cada resposta é **quantas fotos existem**, um número. As
imagens sobem depois, uma a uma (seção 6). O servidor usa a contagem para
julgar "foto obrigatória pendente" sem esperar o upload.

### Resposta

```json
{
  "inspecao": { "id": "ins_...", "numero": 148, "...": "..." },
  "resumo": {
    "resultado": "com_pendencia",
    "conformes": 12,
    "ocorrencias": [ { "pergunta_id": "...", "titulo": "...", "prioridade": "alta" } ],
    "maior_prioridade": "alta",
    "estado_veiculo_previsto": "com_pendencia",
    "pode_finalizar": true,
    "motivo": "..."
  }
}
```

`numero` é sequencial por empresa e é o que a operação cita em voz alta
("confere o 148"). Mostre-o.

### Retorno de preventiva: outro corpo

Quando `momento: "retorno"` e o modelo tem `finalidade: "preventiva"`, as
respostas mudam de forma — não há OK nem Ocorrência:

```json
{
  "respostas": {
    "pinca_freio": {
      "manutencao_feita": true,
      "relatorio": "Pastilha e disco trocados.",
      "fotos": 1
    }
  },
  "proxima_preventiva": { "modo": "data", "proxima_data": "2027-03-15" }
}
```

`manutencao_feita` é **booleano**, não `"sim"`/`"não"`: o servidor distingue
`false` de não-respondido, e string vazia viraria `false` por acidente.

O `relatorio` é **obrigatório quando `manutencao_feita` é `true`** (mínimo 5
caracteres). `proxima_preventiva` é obrigatória no retorno — sem ela o servidor
recusa, porque concluir sem agendar deixa a frota sem agenda de manutenção.

---

## 6. Fotos

Uma por requisição, base64:

```
POST /api/inspecoes/:id/evidencias
{
  "cliente_id": "id-gerado-no-aparelho",
  "pergunta_id": "lateral_esquerda",
  "tipo_mime": "image/jpeg",
  "conteudo": "<base64 sem o prefixo data:>",
  "capturado_em": "2026-09-06T07:13:00.000Z"
}
```

- Máximo **4 MB por foto**. Comprima antes: 1600px de lado e qualidade 0.7
  resolve, e o upload no 3G do pátio agradece.
- `cliente_id` torna o reenvio idempotente, como o `cliente_uuid` da inspeção.
- Tipos aceitos: `image/jpeg`, `image/png`, `image/webp`.
- `gps_lat` e `gps_lon` são opcionais e ficam gravados com a foto.

> **Quem decide o tipo são os bytes, não o `tipo_mime`.** O servidor lê a
> assinatura do arquivo. Conteúdo que não é imagem aceita é recusado com **400**,
> mesmo declarado como `image/png`. E o contrário também vale: uma imagem de
> verdade com `tipo_mime` errado **é aceita**, e o servidor grava o tipo real —
> mandar o rótulo errado é defeito de cliente, não motivo para perder a foto que
> o motorista já tirou. O `tipo_mime` do corpo entra só na mensagem de erro.

Antes de reenviar a fila, consulte o que já chegou:

```
GET /api/inspecoes/:id/evidencias
→ { "evidencias": [ { "id", "pergunta_id", "cliente_id", "bytes", "capturado_em" } ] }
```

É como o app evita subir de novo o que o servidor já tem.

Para exibir: `GET /api/evidencias/:id` devolve os bytes, com sessão. **Imagem
nunca é pública** — link vazado não vira acesso.

---

## 7. Solicitar veículo pelo app

```
POST /api/solicitacoes
{ "categoria_id": "cat_...", "janela_inicio": "...", "janela_fim": "...",
  "motivo": "mínimo 10 caracteres" }
```

O colaborador escolhe **categoria de uso** (`GET /api/categorias`), nunca
placa. Mandar `veiculo_id` é recusado com `400`: quem escolhe o carro é a
equipe da frota, na liberação.

Depois de liberada, a solicitação aparece em `tarefas` com a placa.

### Devolução

```
GET  /api/solicitacoes/:id/devolucao
→ { "atrasada": true, "exige_motivo": true, "minutos_de_atraso": 47,
    "mensagem": "Notamos que passou do prazo de retorno. Descreva o motivo." }

POST /api/solicitacoes/:id/devolver    { "motivo_atraso": "..." }
```

A `mensagem` vem pronta do servidor — mostre-a como veio, para o texto ser o
mesmo no web e no app.

Consulte o `GET` antes: quando `exige_motivo` é `true`, o `POST` sem
`motivo_atraso` é recusado. Pergunte **antes** de encerrar a tela — depois a
pessoa já foi embora.

---

## 8. Notificações

```
GET  /api/notificacoes          → { "notificacoes": [...], "nao_lidas": 3 }
POST /api/notificacoes/lidas    { "id": "..." }   // sem id = todas
```

Cada item: `{ id, tipo, nivel, texto, destino, entidade_id, lida_em, criado_em }`.

`nivel` é `informativo` · `atencao` · `critico`. `destino` é a tela do painel —
o app Android pode ignorá-lo ou mapear para as próprias telas.

**Não há push.** O servidor não conhece o aparelho. Se o app precisar de
notificação fora dele, isso é trabalho novo: FCM no cliente e um registro de
device token no servidor.

---

## 9. O que eu já mandei

A pergunta que o app precisa responder sozinho, sem rede: *"esse checklist foi
mesmo?"*. Sem resposta, a pessoa manda de novo por dúvida — e dúvida sobre
envio é a origem de metade das duplicatas.

```
GET /api/inspecoes?veiculo_id=…&momento=saida|retorno
GET /api/inspecoes/:id
```

A lista devolve `{ "inspecoes": [...] }`, as 100 mais recentes, da mais nova
para a mais velha. Cada item traz `placa`, `modelo`, `usuario_nome`,
`checklist`, `momento`, `resultado`, `numero` e as datas.

**Quem vê o quê.** Colaborador vê só os próprios. Frota vê os da empresa
inteira — é ela que confere se o dia fechou. Os dois filtros são opcionais, e
`momento` fora de `saida`/`retorno` é ignorado em vez de dar erro: parâmetro de
URL vem do mundo.

O detalhe devolve:

```json
{
  "inspecao":   { "...": "sem a estrutura, que vem separada", "checklist_versao": 1 },
  "estrutura":  { "perguntas": [ "…" ] },
  "respostas":  [ "…" ],
  "ocorrencias":[ "…" ]
}
```

> **A estrutura é a da versão respondida, não a de hoje.** `inspecoes` aponta
> para a linha exata do modelo, e editar versão publicada é proibido (§4).
> Uma pergunta retirada na v2 continua aparecendo em quem respondeu na v1 —
> senão o app mostraria um checklist que ninguém preencheu.

Checklist de outra pessoa na mesma empresa dá **403**; de outra empresa dá
**404** (§11).

---

## 10. Erros

| Status | `erro` | O que fazer |
|---|---|---|
| 400 | `requisicao_invalida` | Mostrar `mensagem` ao usuário. Ela é escrita para ser lida |
| 401 | `nao_autenticado` | Token vencido ou revogado → tela de login |
| 403 | `sem_permissao` | Cargo ou nível não alcança |
| 403 | `troca_de_senha_obrigatoria` | Tela de troca de senha |
| 403 | `credencial_<status>` | A conta está `bloqueado`, `suspenso` ou `desativado` |
| 403 | `empresa_suspensa` | A **empresa inteira** está suspensa — sair da sessão, e não tentar de novo em seguida |
| 404 | `nao_encontrado` | Registro não existe **nesta empresa** |
| 409 | `conflito` | Estado mudou no servidor → recarregar e mostrar `mensagem` |
| 429 | `muitas_tentativas` | Freio de tentativas. A `mensagem` diz em quantos minutos volta — **não** tente de novo em seguida |

### O que a fila offline pode descartar, e o que ela nunca pode

A regra que parece óbvia e está errada: **"4xx é recusa por regra, não adianta
repetir"**. A razão está certa; a conta de quais respostas são recusa por regra,
não.

| Status | Repetir? | Por quê |
|---|---|---|
| `401` | **sim, depois de entrar de novo** | A sessão venceu. Não é recusa — é credencial vencida |
| `408` · `425` | **sim** | O servidor desistiu de esperar, ou pediu para chegar mais tarde |
| `429` | **sim, respeitando a espera** | É literalmente um pedido para tentar depois |
| `400` `403` `404` `409` `413` `422` | não | O servidor recusou por regra: repetir dá o mesmo resultado |
| `5xx` | **sim** | Problema do servidor, não do pedido |

**Uma foto recusada em definitivo também não some em silêncio.** Ela sai do
aparelho — insistir daria o mesmo resultado — mas o motivo fica no item da fila,
com a pergunta a que ela pertencia. A inspeção continua `enviada`, porque ela
está no servidor; o que falta é a evidência, e é justamente isso que alguém vai
procurar meses depois, num sinistro.

**O item nunca some em silêncio.** Numa recusa definitiva ele fica na fila,
marcado, com a mensagem do servidor à vista — quem executou precisa saber que
aquele checklist não entrou, e por quê.

**E uma foto nunca é apagada do aparelho por um `401`.** Esse é o caso que
custa caro: a sessão do PWA dura 12 horas, então quem termina o dia no pátio e
sincroniza na manhã seguinte cai exatamente nele. A inspeção já está no
servidor; apagar a foto deixaria a prova dela sem existir em lugar nenhum.

As mensagens são em português e escritas para o usuário final. Mostrá-las é
melhor do que traduzir para "erro ao salvar".

**Toda resposta traz `x-requisicao-id`.** Numa falha inesperada (500) o mesmo
número vem dentro da mensagem e no campo `requisicao_id`. Guarde-o junto do item
na fila e mostre-o na tela de erro: é o que liga a queixa de quem está no pátio à
linha certa do log do servidor.

**409 no envio de checklist** quase sempre significa que a solicitação mudou de
estado enquanto o aparelho estava offline. Não descarte a inspeção da fila sem
mostrar o que aconteceu.

**429 é erro de frequência, não de conteúdo.** Aparece no login e na troca de
senha. A fila offline deve tratá-lo como erro temporário — espera crescente,
nunca reenvio imediato —, e a tela deve mostrar a mensagem em vez de repetir o
pedido, porque cada repetição só empurra o prazo para frente.

---

## 11. Multi-tenant

Toda rota é filtrada pela empresa da sessão. Um id de outra empresa devolve
`404`, nunca `403` — negar confirmaria que o registro existe.

O app não precisa fazer nada a respeito. Só não guarde ids entre logins de
usuários diferentes.

---

## 12. O que o app Android precisa implementar

Em ordem de importância:

1. **Login + troca de senha obrigatória.**
2. **`GET /api/app/inicio` guardado localmente**, com data do download. A tela
   deve dizer quando está mostrando cópia — dado de frota velho é pior que dado
   ausente.
3. **Execução do checklist offline**, com `cliente_uuid` gerado antes de
   começar.
4. **Fila de envio**: inspeção primeiro, fotos depois, com retentativa. Só
   descarte da fila o que o servidor confirmou.
5. **Câmera que não trava o fluxo.** Se ela não abrir, não responder ou for
   cancelada, tem que haver caminho para frente. Foi o defeito nº 1 no PWA.
6. **Tela "meus checklists"** (§9), com o que ainda está na fila marcado como
   *não enviado*. É ela que responde à dúvida que gera duplicata.

O que **não** precisa: painel, relatórios, cadastros. Isso é web.
