# Design System do MyLog

Um arquivo: [`web/css/estilo.css`](../web/css/estilo.css). Sem framework, sem
build, sem fonte externa — o painel abre igual numa rede sem internet.

## A regra que sustenta o resto

**Cor saturada e' sinal, nao decoracao.**

O painel existe para responder uma pergunta: *o que exige acao agora?* Verde,
ambar, laranja e vermelho ja estao comprometidos com gravidade pelo roadmap
(secao 21: 🟢🟡🟠🔴). Se a interface usar vermelho como enfeite — num botao
bonito, num cabecalho, numa borda — o vermelho de "veiculo bloqueado" para de
significar alguma coisa.

Disso decorre todo o resto:

- o cromo (fundo, cartoes, tabelas, navegacao) e' **neutro**;
- a marca ocupa uma faixa que **nenhum status usa**;
- verde/ambar/laranja/vermelho aparecem **so** em selo de estado, borda de fila
  de acao e numero de alerta.

## Identidade

### Simbolo

Um quadrado de ficha com visto de conferencia e a linha de assinatura embaixo:
**registro conferido e assinado**. E' literalmente o que o produto faz.

Vive em `simbolo()` (`web/js/ui.js`), desenhado em SVG com `currentColor`.
Consequencias praticas: uma definicao so, funciona em qualquer fundo, sem
segunda versao para o tema escuro, e legivel a 16px na aba do navegador — onde
serve de favicon inline, sem arquivo externo e sem emoji.

### Cor da marca — "azul-registro"

`#35539f` no claro, `#6f8fd6` no escuro.

Indigo profundo, escolhido por eliminacao: precisa ser distinguivel a distancia
das quatro faixas de status. Verde e teal encostam em "conforme", ambar e
laranja em "atencao", vermelho em "critico". Sobra o azul-violeta — e um indigo
saturado escapa do azul corporativo generico que ele seria com mais luz.

Usos permitidos: marca, aba ativa, acao primaria, foco, links. Nada mais.

### Voz tipografica

**Texto em fonte de sistema; DADO em monoespacada.**

E' a decisao que mais define o produto visualmente. Placa, quilometragem, id de
item de checklist, numero de ticket, horario de auditoria — tudo com a classe
`.dado`, em `Cascadia Mono` / `ui-monospace`, com `tabular-nums`.

Duas razoes, uma estetica e uma operacional:

- faz a tela ler como **registro operacional**, nao como pagina de produto —
  que e' exatamente o que esses dados serao num processo trabalhista;
- uma coluna de placas ou de KM fica **conferivel de relance**, porque os
  digitos alinham verticalmente.

### Forma

Raios pequenos (4/6/10/14px) e sombras discretas: precisao de instrumento, nao
maciez de aplicativo de consumo. Um sistema que bloqueia caminhao nao deve
parecer um app de bem-estar.

## Tokens

Tres camadas, e a ordem importa:

| Camada | O que e | Quem usa |
|---|---|---|
| **Primitivas** | `--n-500`, `--marca-600`, `--e-4`, `--t-base` | ninguem, direto |
| **Semantica** | `--superficie`, `--texto-fraco`, `--critico`, `--borda` | os componentes |
| **Componentes** | `.card`, `.selo`, `.botao` | as telas |

Um componente que use `--n-500` direto quebra no tema escuro. Sempre semantica.

### Escalas

- **Espacamento** — base 4, oito degraus: `--e-1` (4px) a `--e-8` (64px).
  Antes deste sistema havia 14 valores distintos entre 8 e 28px, cada tela
  escolhendo o seu.
- **Tipografia** — `--t-micro` (11) a `--t-display` (34), sete degraus.
- **Raio** — `--r-1` (4) a `--r-4` (14), mais `--r-pilula`.
- **Movimento** — `--mov-rapido` (120ms) e `--mov-base` (180ms). Curto o
  bastante para nao atrasar quem trabalha com pressa, e desligado inteiro sob
  `prefers-reduced-motion`.

## Temas

Claro e escuro, em dois blocos deliberados:

- `@media (prefers-color-scheme: dark)` atende quem nunca escolheu nada;
- `:root[data-tema="escuro"]` atende quem clicou no botao, e **vence** a media
  query.

Todo token de cor e' redeclarado nos dois. **Nenhuma cor pode ter sua unica
definicao dentro de um bloco escuro** — o claro ficaria sem ela.

A escolha e' aplicada em `<head>`, antes da primeira pintura, para nao piscar
branco em quem prefere escuro.

## Acessibilidade — verificado, nao presumido

**Contraste.** Todos os pares de sinal medidos nos dois temas, formula WCAG 2.1:

| Par | Claro | Escuro |
|---|---|---|
| ok (verde) | 4.66 | 7.34 |
| atencao (ambar) | 4.90 | 7.89 |
| alerta (laranja) | 5.23 | 6.61 |
| critico (vermelho) | 6.28 | 6.26 |
| texto / fundo | 15.80 | 15.82 |
| texto fraco / superficie | 4.54 | 5.72 |
| marca / superficie | 7.27 | 5.30 |

Todos passam **AA** (>= 4.5:1). O par mais apertado e' o texto fraco no tema
claro, a 4.54 — se algum neutro for clareado, esse e' o primeiro a quebrar.

**Cor nunca sozinha.** Todo selo de estado tem rotulo em texto *e* um ponto
colorido. Quem nao distingue verde de vermelho le "Vencida" do mesmo jeito.

**Foco visivel.** `:focus-visible` global com anel de dois tons. Antes deste
trabalho, navegar por Tab era invisivel — e o checklist e' preenchido por gente
com pressa, as vezes de luva.

**Alvos de toque.** Botao com 34px de altura minima, `.botao--mini` com 28px.

## Regras de uso

1. **Nenhum `style` inline no JS.** Se uma tela precisa de algo que nao existe,
   a regra entra em `estilo.css`, nao no componente. Hoje: zero inline.
2. **Todo identificador e toda medida levam `.dado`.** Placa, KM, id, numero de
   ticket, horario.
3. **Selo de estado sempre com rotulo textual.** Nunca so a cor.
4. **Coluna de acoes tem cabecalho vazio** — `tabela()` a encolhe sozinha.
5. **Tabela larga rola dentro da propria caixa.** A pagina nunca rola de lado.

## Impressao

Ha um bloco `@media print` que esconde o cromo e mantem o conteudo. Quando a F6
(relatorios) chegar, o PDF sai daqui em vez de exigir uma biblioteca — coerente
com a decisao D1 de zero dependencias.

## Verificacao automatica

Nenhuma classe orfa: o teste no navegador percorre todo elemento renderizado e
confere que cada classe existe no CSS. Ultima execucao: **zero orfas**.
