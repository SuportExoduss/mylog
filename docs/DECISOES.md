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
