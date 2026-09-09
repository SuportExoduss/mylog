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

Devolve **tudo que o aplicativo precisa para montar a tela**: quem é a pessoa,
o que ela tem para fazer, e os modelos de checklist já liberados para o cargo
dela. Chame ao abrir e ao puxar para atualizar.

> **Não guarde esta resposta no aparelho.** Ela tem nome, cargo, placas e as
> tarefas de uma pessoa só, e o aparelho do pátio passa de mão em mão. O MyLog
> já teve um cache disso, e ele custou dois furos: depois do logout, uma
> abertura sem sinal devolvia a tela inteira sem pedir senha; e a rede caindo
> logo após o login entregava a tela de quem usou o aparelho antes para quem
> acabou de entrar. Ver
> [D58](DECISOES.md#d58--o-offline-sai-inteiro-e-o-que-ele-protegia-fica).

```json
{
  "usuario": { "id": "...", "nome": "...", "cargo_id": "...", "cargo_nome": "Motorista",
               "usa_veiculo_diario": true },

  "marca": {
    "nome_exibicao": "Transportes Silva",
    "logo_url": "/imagens/marca/emp_...",
    "tokens": {
      "claro":  { "marca": "#35539f", "marca-forte": "#2a4180",
                  "marca-tinta": "#e9eef9", "marca-contraste": "#ffffff" },
      "escuro": { "marca": "#6f8fd6", "marca-forte": "#9db3e4",
                  "marca-tinta": "#1a2545", "marca-contraste": "#0e131a" }
    }
  },

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

**Carregue na hora, sem guardar no aparelho**
([D58](DECISOES.md#d58--o-offline-sai-inteiro-e-o-que-ele-protegia-fica)). Esta
instrução já foi a oposta — *baixe e guarde junto com o contexto* — porque o
checklist precisava abrir sem sinal. Não precisa mais: o MyLog exige internet, e
a pergunta só chega à tela de quem está com o servidor ao alcance.

O que **não** mudou: se a imagem não vier, a tela segue em frente. O exemplo
mostra *como* fotografar a peça (roadmap 11.3) — é ajuda, não requisito, e uma
imagem que falha nunca pode travar o checklist.

> **Num aparelho compartilhado, nada do contexto pode sobreviver à sessão.** Duas
> pessoas de empresas diferentes usam o mesmo tablet, e o MyLog já pagou duas
> vezes por esquecer isso: o contexto guardado devolvia a tela da pessoa
> anterior sem pedir senha, e a marca da empresa ficava na tela de login depois
> que a sessão vencia. Sem depósito local o primeiro caso não existe; o segundo
> é regra da tela, e vale igual no nativo.

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

### Os dois instantes são obrigatórios

`iniciada_em` e `finalizada_em` dizem quando o checklist **aconteceu**. Se o app
não mandar, o servidor usa a hora em que **recebeu** — que é a hora em que o
envio deu certo, não a hora do pátio.

O estrago não é cosmético. Quem termina às 07h50 no galpão, perde o sinal e só
consegue enviar às 08h40 aparece como **atrasado** num modelo com prazo até
08h30; e quem termina às 23h50 e só envia à meia-noite e dez cai no dia
seguinte, some do dia certo e vira **falta** no relatório de quem não fez.

Por isso `finalizada_em` é carimbado **uma vez**, quando a pessoa termina, e a
nova tentativa repete o mesmo carimbo.

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

### `cliente_uuid` — a peça que torna a nova tentativa segura

Gere **um por checklist, no aparelho, antes de começar**. Reenviar o mesmo
`cliente_uuid` devolve a inspeção existente com `repetida: true`, em vez de
duplicar:

```json
{ "inspecao": { "...": "..." }, "repetida": true }
```

Isso é o que permite tentar de novo sem medo — e sem fila importa mais, não
menos: a nova tentativa agora é de quem está com o aparelho na mão, e humano
toca duas vezes. A resposta pode ter se perdido no caminho; a inspeção, não.

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

Antes de tentar de novo, consulte o que já chegou:

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

### O que a nova tentativa pode descartar, e o que nunca pode

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

**Uma foto recusada em definitivo não some em silêncio.** Ela não volta para
nova tentativa — insistir daria o mesmo resultado — mas o motivo volta, com a
pergunta a que ela pertencia, e aparece na tela do fim. A inspeção está gravada;
o que falta é a evidência, e é justamente isso que alguém vai procurar meses
depois, num sinistro.

**E uma foto nunca é descartada por um `401`.** A sessão dura 12 horas, e quem
começa o dia cedo pode terminar do outro lado do vencimento. A inspeção já está
no servidor; descartar a foto deixaria a prova dela sem existir em lugar nenhum.
Um `401` no envio de foto é caminho de credencial: entrar de novo, não insistir
na rede.

As mensagens são em português e escritas para o usuário final. Mostrá-las é
melhor do que traduzir para "erro ao salvar".

**Toda resposta traz `x-requisicao-id`.** Numa falha inesperada (500) o mesmo
número vem dentro da mensagem e no campo `requisicao_id`. Mostre-o na tela de
erro: é o que liga a queixa de quem está no pátio à linha certa do log do
servidor.

**409 no envio de checklist** quase sempre significa que a solicitação mudou de
estado enquanto o checklist estava sendo preenchido — a Frota registrou a
devolução pelo painel, por exemplo. Não descarte a inspeção sem mostrar o que
aconteceu: a pessoa acabou de fazer o trabalho.

**429 é erro de frequência, não de conteúdo.** Aparece no login e na troca de
senha. Trate-o como erro temporário — a `mensagem` diz quanto esperar — e mostre
a mensagem em vez de repetir o pedido, porque cada repetição só empurra o prazo
para frente.

---

## 10.1 White label

> Roadmap 7, [D59](DECISOES.md#d59--white-label-muda-a-marca-e-só-a-marca).
> Configurar é da **Frota**. Ver é de todo mundo.

A marca **não tem chamada própria para o cliente**: ela chega dentro do mesmo
pacote que diz quem a pessoa é — `POST /api/auth/login`, `GET /api/auth/eu` e
`GET /api/app/inicio`. É de propósito: assim não existe instante em que a tela
está logada mostrando a marca de uma empresa e os dados de outra.

```json
"marca": {
  "nome_exibicao": "Transportes Silva",
  "logo_url": "/imagens/marca/emp_...",
  "tokens": {
    "claro":  { "marca": "#35539f", "marca-forte": "#2a4180",
                "marca-tinta": "#e9eef9", "marca-contraste": "#ffffff" },
    "escuro": { "marca": "#6f8fd6", "marca-forte": "#9db3e4",
                "marca-tinta": "#1a2545", "marca-contraste": "#0e131a" }
  }
}
```

`tokens` vem **sempre completo e já mesclado** com o padrão MyLog: quem pinta
não precisa saber o que a empresa escolheu e o que veio de fábrica, nem carregar
uma cópia da tabela de padrões. `logo_url` é `null` quando não há logo — e aí a
tela mostra só o MyLog.

**Pinte por folha de estilo, não por atributo `style`.** Os tokens são por
tema, e estilo em linha não tem tema: a cor do claro sobreviveria à troca para
o escuro, inclusive quando o tema muda sozinho porque o sistema mudou.

**Co-branding é obrigatório.** A marca MyLog permanece ao lado da marca do
contratante, nas duas telas. Não há campo para desligar isso, e por isso não há
caminho — mandar `esconder_mylog` no corpo não faz nada.

**Sair devolve a marca do MyLog.** A tela de login não é de empresa nenhuma, e
o aparelho do pátio passa de mão em mão.

### Configuração (Frota)

```
GET /api/marca
→ { "marca": { "nome_exibicao", "logo_url",
               "definidos": { "claro": {...}, "escuro": {...} },
               "efetivos":  { "claro": {...}, "escuro": {...} } },
    "contraste": { "ok": true, "temas": { "claro": {...}, "escuro": {...} } } }
```

`definidos` é o que a **empresa** escolheu; `efetivos` é isso mesclado com o
padrão. A diferença importa: é ela que faz "voltar ao padrão" ter sentido.

```
PUT /api/marca
{ "nome_exibicao": "Transportes Silva",
  "tokens_claro":  { "marca": "#1a5c2e" },
  "tokens_escuro":  null }
```

Parcial: o que não vier fica como está. `null` num tema é o pedido explícito de
**voltar aquele tema ao padrão MyLog** — e só aquele; cada tema volta sozinho.

Os quatro tokens aceitos são `marca`, `marca-forte`, `marca-tinta` e
`marca-contraste`. Qualquer outra chave é ignorada e volta em `recusadas`, com
o motivo. **As cores de estado — `ok`, `atencao`, `alerta`, `critico` — não
entram**: elas dizem o que a tela significa, e mudar significado não é
aparência.

O valor é `#rrggbb`. Nada de CSS, HTML ou script.

| Resposta | Quando |
|---|---|
| `200` | Publicado. Volta `marca`, `contraste` e `recusadas` |
| `400` | Contraste insuficiente. A `mensagem` nomeia o par e traz o número medido |
| `403` | Colaborador. Configurar é da Frota |

O contraste é conferido **no servidor**, com o mesmo motor que o painel usa
para avisar. A tela avisa enquanto a pessoa escolhe; o servidor decide — um
cliente desatualizado não pode deixar o painel ilegível.

### Logo

```
POST /api/marca/logo      { "conteudo": "<base64 ou data: URI>" }
DELETE /api/marca/logo
GET /imagens/marca/:empresa
```

PNG, JPEG ou WebP, até 4 MB. O tipo sai dos **bytes**, não do que foi declarado
— SVG não entra, porque SVG carrega script e a logo é servida dentro do painel.

A logo publica **na hora**: não entra em rascunho, porque arquivo não tem prévia
honesta. Trocar grava um arquivo novo, aponta o banco para ele e só então apaga
o antigo — upload que falha não pode deixar a empresa sem logo válida.

`GET /imagens/marca/:empresa` passa por sessão e por tenant. O `:empresa` da URL
**não escolhe** o que será servido: quem escolhe é a sessão. Pedir o endereço de
outra empresa devolve `404` — não a sua própria logo com `200`, que faria a URL
mentir, e não `403`, que confirmaria que a outra empresa existe.

---

## 11. Multi-tenant

Toda rota é filtrada pela empresa da sessão. Um id de outra empresa devolve
`404`, nunca `403` — negar confirmaria que o registro existe.

O app não precisa fazer nada a respeito — e, não guardando nada entre logins,
não tem como errar nisso.

---

## 12. O que o app Android precisa implementar

Em ordem de importância:

> **O Android nasce sem offline**, pela mesma
> [D58](DECISOES.md#d58--o-offline-sai-inteiro-e-o-que-ele-protegia-fica) que o
> tirou da Web: sem fila, sem Room, sem cache do contexto. O MyLog exige
> internet. O que a remoção **não** dispensa está nos itens 3 e 4 abaixo — são
> eles que fazem a diferença entre "sem rede" e "trabalho perdido".

1. **Login + troca de senha obrigatória.**
2. **`GET /api/app/inicio` a cada abertura**, sem guardar a resposta. Ela tem
   nome, cargo, placas e tarefas de uma pessoa só, e o aparelho do pátio passa
   de mão em mão.
3. **Falhar não pode perder o trabalho.** O `Finalizar` é uma chamada de rede e
   ela vai falhar no pátio. A tela de falha fica com o checklist inteiro em
   memória e oferece nova tentativa; sessão vencida é caminho diferente —
   entrar de novo, não insistir na rede. Descartar tem que existir (tela sem
   saída é pior), mas cobrando confirmação e dizendo que o checklist se perde.
4. **`cliente_uuid` gerado antes de começar**, e `cliente_id` em cada foto.
   Inspeção primeiro, fotos depois, uma a uma: a foto que falha não derruba o
   checklist. Foto com erro passageiro volta para nova tentativa; foto recusada
   em definitivo volta **com o motivo**, à vista de quem executou.
5. **`finalizada_em` carimbado uma vez**, quando a pessoa termina. A nova
   tentativa repete o mesmo carimbo — quem terminou às 09h40 não terminou às
   10h05.
6. **Câmera que não trava o fluxo.** Se ela não abrir, não responder ou for
   cancelada, tem que haver caminho para frente. Foi o defeito nº 1 no cliente
   Web.
7. **Tela "meus checklists"** (§9). É ela que responde à dúvida que gera
   duplicata: *já mandei este?*

O que **não** precisa: painel, relatórios, cadastros. Isso é web.
