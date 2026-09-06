# Decisoes tecnicas do MyLog

Registro curto de cada escolha que muda o custo do projeto. Quando uma decisao
for revista, edite a linha e diga por que — nao apague o historico.

## D1 — Backend sem dependencias externas

**Escolha:** Node 24 puro (`node:http`, `node:sqlite`, `node:crypto`). Zero `npm install`.

**Por que:** o disco C da maquina de desenvolvimento tem pouca folga (13 GB livres
de 118 GB) e o SDK do Android ja ocupa 2,7 GB dele. Cada dependencia e' cache,
lockfile, auditoria de seguranca e superficie de ataque. O `node:sqlite` cobre o
banco e o `scrypt` do `node:crypto` cobre o hash de senha — nada aqui exige
biblioteca de terceiros.

**Custo aceito:** roteador e serializacao escritos a mao (~200 linhas em
`src/nucleo/http.js`).

## D2 — SQLite no desenvolvimento, PostgreSQL na producao

**Escolha:** o esquema e' escrito em SQL portavel — ids texto, sem AUTOINCREMENT,
timestamps ISO-8601 em UTC, sem tipo exotico. Todo acesso ao banco passa por
`src/nucleo/banco.js`.

**Por que:** PostgreSQL local exigiria instalacao no disco cheio. O roadmap (secao
41) fixa PostgreSQL para producao e isso nao muda; a troca deve tocar um arquivo.

**A vigiar:** SQLite nao valida CHECK de enum como o Postgres faria. Hoje os enums
sao validados na camada de rota. Ao migrar, transforme-os em CHECK ou tipo ENUM.

## D3 — Email e' identidade global, nao por empresa

**Escolha:** indice unico em `usuarios(email)` sem `empresa_id`.

**Por que:** a tela de login pede apenas email e senha. Se o mesmo email pudesse
existir em duas empresas, o login seria ambiguo. A alternativa (pedir o codigo da
empresa no login) adiciona atrito a um app usado com luva, em campo, com pressa.

**Consequencia:** uma pessoa que trabalhe para duas empresas clientes precisa de
dois emails. Aceitavel enquanto o produto for usado por uma empresa por vez;
revisar se o MyLog for vendido para grupos com quadro compartilhado.

## D4 — Sessao com token opaco revogavel, nao JWT

**Escolha:** token aleatorio de 32 bytes; o banco guarda so o HMAC-SHA256 dele.

**Por que:** o roadmap (secao 8) exige revogacao imediata de credencial. Um JWT
so expira; revogar exige lista de bloqueio, que e' consulta ao banco de qualquer
jeito. Guardar o HMAC significa que vazar a tabela `sessoes` nao da acesso a conta
nenhuma.

**Efeito visivel:** bloquear um usuario derruba a sessao dele na requisicao
seguinte, web e Android. Coberto por teste manual e pela revalidacao de status em
`usuarioDaSessao`.

## D5 — Cookie HttpOnly na web, token no corpo para o Android

**Escolha:** o login devolve as duas coisas. A web usa o cookie `SameSite=Strict`;
o app usa `Authorization: Bearer`.

**Por que:** o painel nunca guarda token em `localStorage`, entao um XSS no
dashboard nao consegue le-lo. O Android nao tem cookie jar conveniente e usa o
cabecalho.

## D6 — Autorizacao por capacidade, nao por papel espalhado no codigo

**Escolha:** `src/seguranca/permissoes.js` tem uma tabela papel -> capacidades.
As rotas chamam `exigir(usuario, 'veiculos.escrever')`.

**Por que:** a regra da secao 16 do roadmap ("o app nunca altera dado mestre do
veiculo") vira uma linha de tabela em vez de um `if` repetido em cada rota. Mudar
o que um supervisor pode fazer e' editar um array.

## D7 — Placa e' imutavel

**Escolha:** a rota de edicao recusa troca de placa; a orientacao e' cadastrar
outro veiculo.

**Por que:** a placa amarra inspecoes, evidencias, tickets e preventivas do
historico. Reescrever a placa reescreveria o significado de registros passados —
e esses registros sao prova em acidente e em processo trabalhista.

## D8 — Hodometro nao anda para tras sem justificativa

**Escolha:** informar KM menor que o atual exige `motivo`, e a correcao vai para
a auditoria.

**Por que:** a preventiva por KM depende inteiramente desse numero. Um erro de
digitacao (410000 em vez de 41000) adiaria uma manutencao por 370 mil km sem que
ninguem percebesse.

## D9 — Status de preventiva e' derivado, nao digitado

**Escolha:** `avaliarPreventiva()` e' funcao pura; o painel recalcula antes de
exibir. Ninguem escreve "vencida" na mao.

**Por que:** secao 22 do roadmap pede regra deterministica e explicavel. A funcao
devolve tambem quanto falta, entao a tela consegue dizer *por que* esta amarelo.

**Definicao das faixas:** `muito_proxima` = dentro da janela de alerta configurada;
`proxima` = dentro de 3x essa janela. Escolha arbitraria mas explicavel — se a
operacao pedir outra, e' um numero so.

## D10 — Auditoria e' so insercao

**Escolha:** nenhuma rota faz UPDATE ou DELETE em `eventos_auditoria`.

**Por que:** secao 38 do roadmap ("nao permitir que historico operacional seja
apagado"). Se um dia for preciso corrigir um evento, sera migracao revisada, nao
funcionalidade de tela.

## D11 — Template publicado e' imutavel

**Escolha:** editar uma versao publicada e' recusado pela API. Alterar o
checklist cria a versao seguinte; publicar a nova arquiva a anterior.

**Por que:** cada inspecao aponta para a versao do template que foi respondida.
Editar uma versao publicada reescreveria o significado de inspecoes ja feitas —
um item removido faria uma inspecao antiga parecer incompleta, e um limite
alterado faria uma resposta aprovada virar reprovada retroativamente.

## D12 — Cada ciclo de preventiva e' uma linha

**Escolha:** concluir uma preventiva marca a linha como "realizada" e cria uma
nova para o proximo ciclo, em vez de reciclar a mesma linha.

**Por que:** o historico de manutencao do veiculo passa a ser uma consulta
simples, com km, data, servico e responsavel de cada execucao. Reciclar a linha
guardaria so o ultimo ciclo, e o roadmap (secao 26) pede relatorio de
preventivas realizadas por veiculo.

**Efeito de projeto:** concluir e agendar a proxima sao o mesmo endpoint. Nao
existe "concluir e decidir depois" — e' assim que uma frota perde a agenda.

## D13 — Ticket e nao conformidade sao entidades separadas

**Escolha:** tabelas distintas. Um ticket PODE virar ocorrencia, por acao
explicita da supervisao, e a ligacao fica na auditoria.

**Por que:** secao 24 do roadmap. Ticket responde "o que alguem solicitou";
nao conformidade responde "o que deu errado no checklist". Juntar os dois num
"chamado" generico faria o relatorio de conformidade contar pedido de limpeza
como falha de inspecao.

## D14 — Prazo de ticket derivado da prioridade

**Escolha:** 8 horas para prioridade alta, 72 para normal, calculado na
abertura. "Atrasado" e' prazo vencido com o ticket ainda aberto.

**Por que:** o painel precisa de uma nocao de atraso desde o primeiro dia, e
SLA configuravel por empresa e' complexidade que ainda nao se justifica.
Quando a operacao pedir, viram dois numeros na politica da empresa.

## D15 — O aplicativo de campo e' um PWA, nao um app nativo

**Escolha:** cliente instalavel em `app/`, servido pelo mesmo processo, com
service worker e IndexedDB. A decisao entre Kotlin, Flutter e PWA estava aberta;
esta e' a escolha para o PILOTO.

**Por que:** o risco concentrado da F3 nao e' a linguagem, e' a fila de fotos
offline. Um app nativo adiciona uma stack nova (que ninguem aqui ja publicou)
exatamente em cima do trecho mais arriscado. O PWA usa o que ja dominamos e
valida o dominio primeiro.

**O que isso NAO fecha:** a API continua agnostica de cliente (token no corpo
alem do cookie, JSON puro, nenhuma sessao de navegador obrigatoria). Trocar por
Kotlin depois nao mexe no backend.

**O risco assumido, explicitamente:** o navegador pode despejar o storage do
site e levar fotos junto. Mitigacoes ja no codigo — `navigator.storage.persist()`
pedido no inicio, fotos comprimidas antes de guardar, fila que nunca apaga item
em silencio. Isso precisa de teste em aparelho real antes do piloto: e' o
criterio que decide se o nativo volta a mesa.

## D16 — O motor de checklist e' UM arquivo, servido aos dois lados

**Escolha:** `compartilhado/template.js` e' importado pelo servidor (Node) e
servido ao navegador em `/compartilhado/template.js`. Nao ha copia.

**Por que:** o aplicativo precisa julgar a inspecao offline para mostrar o
resumo antes de finalizar (secao 27), e o servidor precisa julgar de novo ao
receber. Duas implementacoes divergiriam, e a divergencia apareceria da pior
forma possivel: o motorista ve "aprovado" no patio e o veiculo aparece
reprovado no painel horas depois.

**Consequencia de projeto:** esse arquivo nao pode importar `node:*`, nem tocar
banco, relogio de servidor ou variavel de ambiente. Esta escrito no topo dele.

## D17 — O servidor RE-JULGA toda inspecao recebida

**Escolha:** `POST /api/inspecoes` recalcula o veredito com o motor e a versao
do template respondida. Qualquer `resultado` ou `estado_veiculo` que venha no
corpo e' ignorado.

**Por que:** o aplicativo roda no aparelho do usuario. Aceitar o veredito dele
seria deixar a decisao de liberar um caminhao com freio reprovado do lado de
fora do sistema. O vinculo usuario-veiculo tambem e' reconferido aqui — nao
basta o app ter mostrado o veiculo na tela.

**Coberto por teste:** um envio que afirma "aprovado" respondendo falha critica
volta como "reprovado" e bloqueia o veiculo.

## D18 — Idempotencia por `cliente_uuid`

**Escolha:** o aplicativo gera o id da inspecao antes de enviar. Reenvio da
mesma inspecao devolve a que ja existe, com `duplicada: true`.

**Por que:** a fila offline reenvia o que nao teve confirmacao — e "nao teve
confirmacao" inclui o caso em que o servidor gravou e a resposta se perdeu no
caminho. Sem isso, um checklist virava tres.

## D19 — Desempate de checklist por data de publicacao

**Escolha:** quando mais de um template publicado se aplica ao veiculo, vence o
de tipo exato; empatou, vence o publicado mais recentemente.

**Por que:** a versao so tem significado dentro de um mesmo codigo. A regra
anterior ordenava por `versao DESC` entre codigos diferentes, o que fazia a
frota inteira responder um checklist escolhido ao acaso. Encontrado por teste.

## Em aberto — decidir antes da F3

- ~~Android nativo x PWA~~ — decidido em D15: PWA para o piloto.
- **Teste de retencao de storage em aparelho real.** E' o criterio que confirma
  ou derruba D15. Nao da para fazer nesta maquina.
- **Storage de evidencia.** Local no piloto; S3/Cloudflare R2 quando o volume
  justificar. O caminho ja esta modelado como `empresa/veiculo/inspecao/item/arquivo`.
- **Exportacao do historico do PROLOG.** Bloqueia a F8. Precisa ser respondido
  pela empresa, nao pela engenharia.

## D20 — O roadmap e' um documento so, com fonte em Markdown

**Escolha:** `docs/ROADMAP.md` e' a fonte de verdade; o `.docx` ao lado e'
gerado a partir dele. Nao existe roadmap paralelo, anexo nem "v3 complementar".

**Por que:** a v2.0 vivia num `.docx` solto no Downloads. Quando as regras
mudaram, a tentacao foi escrever um documento novo com as diferencas — e ai
passam a existir dois textos que so fazem sentido lidos juntos, o que sempre
termina com alguem implementando a versao errada.

Markdown como fonte tambem torna a mudanca de regra **diferenciavel no git**:
da para ver exatamente qual frase do produto mudou, e quando.

**Como atualizar:** editar `docs/ROADMAP.md`, regerar o `.docx` e copiar para
onde o time le. A v2.0 original esta preservada em `docs/historico/`.

## D21 — Dois niveis de acesso, nao cinco papeis

**Escolha:** `acessa_painel` booleano. Frota entra no painel e faz tudo;
Colaborador so usa o aplicativo.

**Por que:** a tabela de cinco papeis da v2.0 tinha 19 capacidades e nunca foi
usada em toda a sua largura — a operacao real e' "quem cuida da frota" e "quem
dirige". Cada papel a mais era uma linha de tabela para manter e uma decisao a
mais no cadastro de cada pessoa.

**Custo aceito:** quem cuida da frota tambem consegue apagar cadastro. Se um dia
a operacao pedir um nivel intermediario, ele volta como uma terceira marcacao —
nao como uma matriz de capacidades.

## D22 — Cargo e' funcao na empresa, nunca permissao

**Escolha:** `cargos` e' cadastro livre (RH, Tecnico de campo, Motorista) e
serve para **decidir quais checklists aparecem** para a pessoa. Nenhuma rota
consulta cargo para autorizar.

**Por que:** misturar as duas coisas foi o erro da v2.0. Quando "papel" decide
tanto o que a pessoa alcanca quanto o que ela executa, criar um cargo novo vira
decisao de seguranca — e quem cadastra gente nao deveria estar tomando decisao
de seguranca.

## D23 — Sem vinculo usuario-veiculo

**Escolha:** a tabela saiu. Nao ha condutor principal nem lista de condutores.

**Por que:** os carros trocam de mao o tempo todo. O controle real e' fisico —
so mexe na frota quem tem acesso ao galpao. Duplicar isso em software nao
acrescenta seguranca nenhuma e produz cadastro mentiroso em uma semana, que e'
pior que cadastro nenhum: da a impressao de que o sistema sabe.

**O que ficou no lugar:** a solicitacao de veiculo, que registra quem pediu,
para quando, por que, e quem liberou.

## D24 — "Pendente" e' quem ainda nao fez o primeiro acesso

**Escolha:** o cadastro nasce pendente com senha gerada; vira ativo quando o
proprio colaborador troca a senha. A Frota nao "ativa" ninguem.

**Por que:** na v2.0 a ativacao era um segundo ato manual da Frota, que so
existia para repetir o que o cadastro ja tinha dito. Amarrar o "ativo" a troca
de senha faz o estado significar algo verificavel: quem esta ativo provou que
recebeu a credencial.

**Efeito:** a sessao de um pendente existe, mas so abre a troca de senha.
Qualquer outra rota responde `troca_de_senha_obrigatoria`.

## D25 — Senha inicial gerada, sem caracteres ambiguos

**Escolha:** o sistema sorteia; a Frota nunca digita. O alfabeto exclui
`O 0 I l 1`.

**Por que:** quem repassa a senha e' uma pessoa falando com outra, muitas vezes
por telefone ou bilhete. Um zero lido como "o" custa um chamado de suporte.
Coberto por teste: 200 senhas seguidas, todas passam na propria validacao de
forca e nenhuma contem caractere ambiguo.

## D26 — Sobreposicao de janela e' barrada no servidor

**Escolha:** duas reservas do mesmo veiculo nao podem se sobrepor no tempo, e a
checagem e' refeita **na aprovacao**, nao so no pedido.

**Por que:** a tela do solicitante pode estar desatualizada, e entre o pedido e
a aprovacao outra reserva pode ter sido liberada. Dois carros prometidos para o
mesmo horario e' o tipo de erro que so aparece no patio, com gente esperando.

## D27 — Antecedencia de 24 h avisa, nao bloqueia

**Escolha:** `antecedencia_horas` e `antecedencia_rigida` na politica da
empresa. O padrao avisa e deixa passar.

**Por que:** trava rigida recusaria um pedido urgente feito de manha para a
tarde — exatamente o caso em que a pessoa mais precisa do carro. Comecar
avisando deixa a Frota decidir caso a caso; virar trava e' mudar um booleano
quando a operacao pedir.

## D28 — Relatorio e' HTML de impressao, nao PDF de biblioteca

**Escolha:** as rotas `/relatorio/*` devolvem HTML com `@media print` e um botao
"Imprimir ou salvar em PDF". Nenhuma dependencia de geracao.

**Por que:** o navegador ja sabe paginar, quebrar bloco e exportar PDF. Uma
biblioteca entregaria o mesmo arquivo em troca de manutencao, tamanho e mais
uma superficie para atualizar. E o CSS de impressao ja existia no design system.

**Nao fecha porta:** se um dia for preciso PDF sem gente na frente (envio
automatico por email), o mesmo HTML alimenta um navegador headless.

**Cuidado que isso obriga:** o HTML e' montado por concatenacao, entao TODO texto
vindo do banco passa por escape. A descricao de uma ocorrencia e' escrita por
motorista; um `<` solto quebraria a pagina e um `<script>` viraria execucao no
navegador de quem imprime. Coberto por teste.

## D29 — A foto sobe depois da inspecao, uma por requisicao

**Escolha:** `POST /api/inspecoes/:id/evidencias`, uma imagem por chamada, em
base64, com `cliente_id` gerado no aparelho.

**Por que:** duas razoes que puxam para o mesmo lado.
Primeira, o corpo da inspecao continua pequeno — a fila offline reenvia JSON
leve, e nao um pacote de vários MB que falha inteiro no meio.
Segunda, cada foto tem sua propria vida de tentativa: uma falha no upload da
quarta foto nao invalida um checklist que ja esta gravado e ja bloqueou (ou
liberou) o veiculo.

**Idempotencia:** o `cliente_id` faz o reenvio devolver a evidencia existente.
Sem isso, uma resposta perdida no caminho duplicaria a foto no storage a cada
tentativa.

**Descarte no aparelho:** foto confirmada sai da cota do navegador. Recusada por
regra (4xx) tambem sai — repetir nao melhoraria, e ela ocuparia espaco para
sempre.

## D30 — A imagem nunca e' publica

**Escolha:** `/api/evidencias/:id` passa por sessao e por tenant como qualquer
outro dado, e o arquivo e' lido do disco pelo servidor.

**Por que:** evidencia de checklist e' prova em acidente e em processo
trabalhista. Um link direto ao storage, mesmo com nome sorteado, vira acesso
permanente para quem o copiar. O custo e' o servidor intermediar o download —
aceitavel para o volume de uma frota.

**O caminho ja esta pronto para S3/R2:** `empresa/veiculo/inspecao/pergunta/arquivo`,
derivado no servidor e nunca recebido do cliente.

## D31 — O estado do veículo só é afrouxado por decisão humana

**Contexto.** Um checklist grava o estado que ele mesmo julgou. Um retorno com
problema médio julga "com pendência"; se isso for gravado sobre um veículo que
estava bloqueado por falha crítica, o checklist acabou de liberar um carro
que só a Frota podia liberar.

**Decisão.** Os estados têm uma ordem de restrição
(`disponivel < com_pendencia < manutencao < bloqueado`) e a inspeção só grava
o estado julgado quando ele **agrava** o atual.

**Consequência.** Nenhum caminho automático destrava um veículo. Destravar é
sempre `POST /api/veiculos/:id/status` com motivo obrigatório e evento de
auditoria.

## D32 — Pendência é consequência, bloqueio é decisão

**Contexto.** "Com pendência" nascia de uma ocorrência aberta e nunca saía
sozinho. Em poucos meses a frota inteira migraria para esse estado e o filtro
do painel deixaria de separar o que precisa de ação do que já foi resolvido.

**Decisão.** Fechada a última ocorrência aberta (`resolvida` ou `encerrada`)
de um veículo que está `com_pendencia`, ele volta a `disponivel` sozinho, com
evento de auditoria. `bloqueado` e `manutencao` não saem por esse caminho.

**Consequência.** O estado do veículo passa a ser legível: pendência descreve
a fila de ocorrências; bloqueio descreve uma decisão que alguém tomou e
assinou.

## D33 — Prioridade baixa não tira o carro de circulação

**Contexto.** O motor tratava qualquer ocorrência como pendência, contrariando
a tabela da seção 12.2 do roadmap, que reserva a baixa para "entra na fila;
veículo segue disponível".

**Decisão.** O estado previsto passa a considerar a maior prioridade: baixa
mantém `disponivel`; média e alta deixam `com_pendencia`; crítica bloqueia,
conforme a política da empresa.

**Consequência.** Um risco de pintura vira fila de trabalho, não carro parado.

## D34 — Um modal fecha a si mesmo, não a área de modais

**Contexto.** `abrirModal` fazia `await aoConfirmar(...)` e em seguida
`limpar(area)`. Quando o `aoConfirmar` abria outro modal — é assim que a senha
inicial gerada aparece depois de criar um usuário — o `limpar` apagava essa
segunda janela. A senha não fica em log nem em auditoria: some para sempre.
Todo usuário criado pelo painel nascia inutilizável.

**Decisão.** `fechar()` remove o próprio elemento de fundo daquele modal, não
o conteúdo da área. Um modal aberto por dentro do `aoConfirmar` sobrevive.

**Consequência.** Encadear telas passa a ser seguro. E fica o registro do que
o teste de API não pega: ele provava que a senha volta e autentica — e provava
certo. O que faltava era alguém abrir a tela.

## D35 — DOM de teste escrito à mão, em vez de afrouxar a D1

**Contexto.** O bug do D34 — a senha inicial que nunca aparecia — passou por
uma suíte inteiramente verde porque nenhum teste abria uma tela. Testar
interface pede um DOM, e o caminho normal seria instalar um (jsdom, happy-dom),
contra a decisão D1 de zero dependências.

**Decisão.** `servidor/testes/dom.js`: um DOM mínimo próprio, ~230 linhas, que
implementa exatamente o que `web/js/ui.js` chama — criar nó, pendurar, remover,
ouvir e disparar evento com bolha, e seletor simples (`tag`, `.classe`, `#id`,
lista separada por vírgula).

**O que ele deliberadamente NÃO faz.** Layout, CSS, visibilidade calculada.
`getBoundingClientRect()` devolve zeros: forjar um retângulo plausível criaria
confiança falsa sobre código que depende de posição real na tela.

**Consequência.** A camada de tela passou a ser testável sem dependência. O
teste `modal: o que o aoConfirmar abriu sobrevive ao fechamento` foi conferido
contra o defeito original — fica vermelho com o código antigo, verde com o
novo. O que o DOM não alcança está listado no roadmap 26 como passe manual
obrigatório, e continua listado: cobertura parcial declarada é honesta;
cobertura parcial silenciosa é a armadilha que criou o D34.

## D36 — O index cobre rota, não arquivo que falta

**Contexto.** O servidor estático caía no `index.html` para qualquer caminho
não encontrado, incluindo `.js`, `.css` e `.json`. Um import com erro de
digitação voltava como página HTML com status **200**, e o navegador tentava
interpretá-la como módulo. O erro que aparecia era *"unknown error occurred
when fetching the script"* — que não diz qual arquivo falta.

**Decisão.** O fallback para o index vale só quando o caminho **não tem
extensão** (ou é `.html`): isso é rota, resolvida no cliente. Qualquer outra
extensão que não exista responde **404 em texto puro**.

**Consequência.** Erro de caminho passa a falhar alto e no lugar certo. E um
manifesto ou uma imagem com nome errado deixa de virar uma página inteira
guardada no cache do service worker.

## D37 — O dia é da operação, não da máquina

**Contexto.** "Hoje", "até as 08:30" e "o dia 03" eram respondidos pelo fuso do
sistema operacional: `getDate()`, `getHours()`, `new Date(ano, mes, dia)`. Isso
funciona por acidente enquanto o servidor roda na mesma cidade da frota. No dia
em que ele subisse para uma nuvem em UTC — que é o destino aprovado — o filtro
de período, o "hoje" do painel, o horário limite, a obrigação diária e a
cobrança de quem não fez mudariam de resposta **todos juntos, em três horas, e
sem nenhum erro**. Um checklist das 07h50 apareceria como 10h50, atrasado.

**Decisão.** O fuso é da **operação** e entra por `MYLOG_FUSO`
(padrão `America/Sao_Paulo`). Todo cálculo de dia e de hora passa por
`nucleo/relogio.js`, que usa `Intl.DateTimeFormat` com `timeZone` — já dentro do
Node, sem dependência, e conhecendo horário de verão. Nome de fuso inválido
derruba a partida, não a primeira consulta.

**Consequência no motor.** `obrigatorioNoDia` passou a receber o **número** do
dia da semana e `classificarExecucao`, os **minutos** desde a meia-noite da
operação. Recebiam `Date`, e um `Date` carrega junto o fuso de quem o
construiu — o motor não pode ter opinião sobre onde está rodando. É a entrada
explícita que a revisão de arquitetura exige do domínio.

**Prova.** Um teste roda a mesma pergunta em processos filhos com `TZ` diferente
e exige resposta idêntica; ele também afirma que o **jeito antigo diverge**,
para não passar por vacuidade. A suíte inteira roda verde sob
`America/Sao_Paulo`, `UTC` e `Asia/Tokyo`.

**Fica em aberto:** o fuso é da instalação, não da empresa. Quando o SaaS
multiempresa existir, ele passa a ser coluna de `empresas` — uma frota em
Manaus e outra em São Paulo não fecham o dia na mesma hora.

## D38 — Quem diz o que o arquivo é são os bytes

**Contexto.** O `tipo_mime` chegava do aparelho e virava verdade: ia para a
extensão no disco, para a coluna do banco e para o `content-type` da resposta. A
conferência olhava só o rótulo. Um arquivo que não é imagem nenhuma entrava no
acervo de evidências desde que viesse etiquetado como `image/png`.

**Decisão.** O tipo sai da assinatura do conteúdo — três formatos, doze bytes.
Não é imagem aceita, não entra. **E o byte vence a declaração em vez de
contradizê-la em erro:** uma foto de verdade com rótulo errado é defeito de
cliente, não ataque, e recusá-la perderia a evidência que o motorista já tirou.
O PWA erra exatamente assim — quando o blob sai sem tipo, ele manda
`image/jpeg` por padrão.

**Por que importa.** Evidência de checklist é prova em acidente e em processo
trabalhista. E hoje o `nosniff` segura o estrago no navegador; uma URL assinada
do R2, que é o destino aprovado, não segura.

## D39 — A mudança de estado e o registro dela são um ato só

**Contexto.** Aprovar uma reserva, liberar um veículo bloqueado e encerrar uma
ocorrência tinham a mesma forma: gravar o novo estado e, **depois**, fora de
qualquer transação, registrar o evento de auditoria. Uma falha entre as duas
deixaria o carro entregue — ou liberado — sem nenhuma linha dizendo por quem.

**Decisão.** As três operações passam a gravar estado, efeito e auditoria dentro
de uma transação. A notificação fica de fora de propósito: um aviso que não sai
não pode desfazer uma liberação que já aconteceu.

**E `BEGIN IMMEDIATE`, não `BEGIN`.** O `BEGIN` do SQLite é adiado — a trava de
escrita só é tomada na primeira gravação. Numa transação que lê, decide e então
grava, dois processos podem ler o mesmo estado, ambos concluírem que podem
aprovar, e o segundo só descobrir o problema no fim, já tendo decidido sobre
dados velhos.

**Honestidade sobre o ganho.** Hoje nada disso acontece: o Node é de uma linha
só e o SQLite aqui é síncrono, então nenhum outro pedido corre no meio. A
atomicidade existia **por acidente de arquitetura**. O que muda é que ela passa a
estar escrita — e é a migração para Cloud Functions, com instâncias
concorrentes, que destruiria a versão acidental.

## D40 — O freio conta pessoas, não tentativas

**Contexto.** O login já tinha freio: oito tentativas por e-mail+IP em quinze
minutos. Cobria o ataque óbvio — martelar a senha de uma pessoa — e deixava
passar três outros. Espalhar uma senha por muitos e-mails do mesmo lugar nunca
repete e-mail, então nunca cruzava o limite. A **troca de senha**, que pede a
senha atual, não tinha freio nenhum: quem pegasse uma sessão aberta adivinhava à
vontade. E o mapa de contagens nunca era limpo — uma chave por e-mail tentado é
memória à disposição de quem quiser gastar a máquina.

**Decisão.** Três frentes: por conta (8), por conta na troca de senha (5), e por
IP contando **e-mails distintos** que falharam (15).

**A contagem por alvo distinto é o ponto.** Se o freio por IP contasse falhas, a
segunda-feira de manhã de uma frota atrás de um NAT — quatro pessoas errando a
própria senha cinco vezes cada — passaria de vinte falhas e trancaria a operação
inteira às sete da manhã. Contando e-mails distintos, são quatro, e nada
acontece. A varredura de credencial vazada tem a forma oposta: uma senha só,
muitos e-mails, e é ela que o limite pega.

**Consequência.** O erro passa a ser **429**, não 400: o pedido está correto, o
que sobra é a frequência, e o cliente precisa distinguir "você errou a senha" de
"pare de tentar". A mensagem diz quantos minutos faltam, porque "tente mais
tarde" faz a pessoa tentar de novo agora.

**Fica em aberto:** a contagem vive na memória do processo. Em Cloud Functions,
cada instância teria a própria, e o freio afrouxaria na proporção do número de
instâncias. A contagem precisa mudar de lugar junto com o servidor.

## D41 — CSP estrita, e o script embutido sai do HTML

**Contexto.** O servidor mandava um só cabeçalho de segurança, `nosniff`, e
mesmo esse só em algumas respostas. Sem CSP, um texto do banco que escapasse do
escape viraria script executando na sessão de quem abriu o painel.

**Decisão.** `content-security-policy` estrita, aplicada **uma vez por
requisição, antes de qualquer despacho** — assim vale também para o HTML, o CSS,
a imagem e as rotas que escrevem o binário elas mesmas. Junto: `x-frame-options`,
`referrer-policy: same-origin`, `cross-origin-opener-policy` e uma
`permissions-policy` que **mantém câmera e localização ligadas**, porque o
aplicativo de campo depende das duas. HSTS só em produção e só quando a conversa
já chegou por HTTPS: mandado em texto claro ele não protege nada e trava o
desenvolvimento em localhost.

**O trecho do tema saiu do HTML.** `script-src 'self'` recusa script embutido, e
os dois `index.html` tinham um — o que aplica o tema salvo antes da primeira
pintura. A alternativa era declarar o hash dele na política; aí qualquer edição
naquele trecho apagaria o tema **em silêncio**, porque o navegador recusa e nada
acusa. Virou `/js/tema-inicial.js`, síncrono e antes do `<body>`, e entrou na
casca do service worker — cuja versão de cache subiu junto, senão quem já
instalou a v1 nunca buscaria o arquivo novo.

**`style-src` mantém `'unsafe-inline'`,** e é uma escolha, não descuido: a
interface usa atributo `style` em elementos montados em JS, e os relatórios de
impressão levam a folha inteira embutida — são um documento só, salvo e enviado
por e-mail. Injeção de estilo é risco muito menor que injeção de script, e não
há caminho em que texto do usuário vire CSS.

**Verificado no navegador,** não só no teste: painel, aplicativo de campo e
modal com `style` embutido, sem nada recusado na rede nem no console. Um teste
não vê a tela quebrar, e uma CSP que quebra a tela é pior que nenhuma.

## D42 — Um número por requisição

**Escolha.** Cada resposta leva `x-requisicao-id`, e a falha inesperada repete o
número dentro da mensagem: *"Informe o código 4628579d"*.

**Por quê.** "Deu erro hoje de manhã" não localiza nada num log de dia inteiro.
O número é curto o bastante para ser ditado por rádio, e liga a queixa de quem
está no pátio à linha certa. É a peça mínima da observabilidade que a etapa de
produção vai exigir inteira.

**Fica em aberto:** o número ainda não entra na auditoria — isso é coluna nova
em `eventos_auditoria`, e o banco atual não tem mecanismo de migração.

## D43 — A hora do checklist é a do pátio, não a da sincronização

**Contexto.** O servidor gravava `finalizada_em` com a hora do **recebimento**.
Num checklist feito offline isso é a hora em que o aparelho pegou sinal. O
aplicativo já mandava o instante certo — e `iniciada_em` já era aceito; só
`finalizada_em` foi esquecido.

**O estrago.** Quem preencheu às 07h50 no galpão e só pegou rede às 14h
aparecia como **atrasado**, com prazo das 08h30. Pior: quem terminou às 23h50 e
sincronizou à meia-noite e dez sumia do dia certo e virava **falta** no relatório
de quem não fez — uma acusação contra alguém que fez o trabalho.

**Decisão.** O instante vem do aparelho, dentro de uma janela sensata: nada no
futuro (cinco minutos de folga para relógio adiantado), nada com mais de trinta
dias (mais que qualquer fila offline plausível), e o fim nunca antes do início —
duração negativa quebraria o dossiê. Fora da janela, cai para a hora do
recebimento **com registro na auditoria**, o mesmo tratamento que o KM que não
bate já recebia.

**Aceitar não é confiar.** Relógio de celular atrasa, adianta e pode ser mexido.
Mas recusar a inspeção por causa do relógio seria pior: ela aconteceu no mundo.

**Prova.** Três testes. Um envia um checklist das 07h50 com prazo até 08h30 e
exige `no_prazo`; conferido contra o defeito original. Outro manda uma data três
dias no futuro e exige que ela seja recusada **e auditada** — esse fica vermelho
com a correção ingênua, a de confiar cegamente no que o aparelho manda.

## D44 — A fila reenvia sozinha, com espera crescente

**Contexto.** O envio só era disparado por evento: voltar a ficar online, voltar
para a aba, abrir o app, ou tocar no botão. No pátio, com 4G oscilando, o
aparelho continua **"online"** — tem sinal, só não passa dado —, então o evento
`online` nunca chega; e quem fica com o app na frente terminando o dia nunca
troca de aba. O item ficava parado exibindo *"Será reenviado automaticamente"*,
uma promessa que o código não cumpria.

**Decisão.** Falha de envio com fila não vazia arma um reenvio: 15 s, 30 s, 1
min, 2 min, 5 min — e para nos 5. Fila vazia zera a contagem, para que a próxima
falha comece nos 15 segundos e não nos 5 minutos que sobraram da anterior. Todo
evento (online, voltar à aba) também zera antes de tentar: a rede acabou de
mudar de estado, a tentativa de agora não herda o castigo da anterior.

**Sem relógio quando não adianta.** Sem fila não há o que reenviar; sem rede,
quem acorda é o evento `online`, que chega na hora certa e não gasta bateria
esperando.

**Desvio de até 20%.** Quarenta aparelhos voltando juntos quando a torre volta
não podem bater no servidor no mesmo segundo — nem esperar o dobro por isso.

**A decisão foi separada do relógio.** `deveRetentar` e `proximaEspera` são
funções puras e testadas; `setTimeout` fica de fora delas. O teste de
comportamento troca `fila` e `fetch` por baixo e usa relógio falso — provando
que, sem ninguém tocar em nada e sem a rede mudar de estado, o reenvio acontece.

## D45 — A CSP recusa em silêncio, então o teste tem que olhar a página

**O que aconteceu.** A [D41](#) trocou o `nosniff` solitário por uma CSP
estrita, e junto tirou o `<script>` embutido dos dois `index.html`. Ficou de
fora o `onclick="print()"` do botão *"Imprimir ou salvar em PDF"* — que aparece
em **todos** os relatórios. Resultado: o botão continuou na tela, com o atributo
no lugar, e parou de fazer qualquer coisa.

**Por que passou.** Os testes de cabeçalho conferiam as duas páginas do painel e
mediam os cabeçalhos das rotas de API. Os relatórios são HTML **gerado pelo
servidor**, passam pelas mesmas regras, e não estavam na lista. E nenhum teste
de cabeçalho enxerga um clique que não acontece.

**Correção.** O manipulador virou `/js/imprimir.js`, um ouvinte delegado em
`[data-imprimir]`.

**A lição, que vale mais que a correção.** Uma política que recusa em silêncio
precisa de um teste que olhe o **produto**, não a política. A varredura agora
cobre as páginas do painel **e** os relatórios, e procura tanto `<script>`
embutido quanto **atributo `on*`** — que é a forma mais fácil de escrever script
inline sem perceber que é script inline.

## D46 — O PWA entra em regime de manutenção

**Decisão do dono do projeto, 06/09/2026.** O aplicativo de campo Android será
escrito **do zero, original**, em Android Studio. Nada do PWA vira código nele.

**Consequência para o trabalho.** O `app/` só é tocado quando quebra o painel, o
servidor ou o contrato da API — ou quando estiver impedindo a homologação em
aparelho real. Todo o resto do esforço vai para painel, servidor e contrato.

**O que se aproveita não é o cliente, é o contrato.** Por isso
[`API.md`](API.md) deixa de ser documentação para depois e passa a ser entrega
de primeira classe desta fase: é o único artefato desta etapa que o app nativo
vai consumir literalmente.

**E o PWA não é descartável enquanto o APK não existir.** Ele é o único jeito de
executar um checklist durante a construção, e é a implementação de referência
para quem escrever o nativo — não código a copiar, mas uma resposta funcionando
às perguntas que o Android terá que responder.

> Isto corrige um deslize meu: implementei a retentativa com espera crescente da
> fila offline (D44) durante a fase do painel. Era trabalho de cliente de campo,
> e eu devia ter perguntado antes de emendar. Fica — é pequena, testada e não
> atrapalha —, mas a regra passa a valer daqui em diante.

## D47 — O nível escolhido no cadastro vale na porta do painel

**Contexto.** O `nivel.js` diz, no cabeçalho que define o conceito, *"Colaborador
— somente aplicativo"*; o roadmap §3 repete na tabela do modelo de acesso, e a
tabela de camadas atribui o painel à equipe da frota. O shell, porém, marcava
**três** telas como `quem: 'todos'` — Frota, Solicitações e Checklists feitos —
e mandava quem não tem painel para Solicitações. A regra valia pela metade, e
nada acusava.

**Decisão.** O nível é escolhido no cadastro — **total ou somente aplicativo** —
e vale na porta: quem foi marcado como somente aplicativo não monta o painel. Vê
o próprio nome, a frase *"seu acesso é pelo aplicativo"* e o link para `/app/`.

**Onde a recusa mora, e por quê.** No **shell**, não no login do servidor.
Barrar por um campo do corpo seria teatro — bastaria mandar `origem: 'app'` para
passar — e ainda trancaria, sem explicação, um aplicativo Android que esquecesse
o campo. O que se restringe é a **interface**, então é a interface que restringe.
A sessão fica aberta de propósito: o aplicativo a reaproveita, e pedir a senha de
novo seria castigo por ter errado a porta com a credencial certa.

**Não é segurança, é coerência.** As rotas administrativas já recusam Colaborador
com 403, e há teste provando. Duas interfaces para a mesma pessoa dobram o que há
para manter, testar e proteger — e a fase seguinte multiplica cada tela por
empresa.

**O que se perde, dito por inteiro.** O painel era o único lugar onde um
Colaborador via os próprios checklists enviados; o PWA não tem essa tela. Não a
construo lá, porque o PWA está congelado ([D46](#)). Ela é requisito do cliente
de campo e já está na lista do que o Android precisa implementar
([API.md §12](API.md)). Até o APK existir, essa consulta fica com a Frota.

> Achado por uma leitura externa do repositório, e confirmado contra os três
> documentos antes de mexer em qualquer coisa — agir sobre o relato sem conferir
> teria removido comportamento que talvez fosse proposital.
