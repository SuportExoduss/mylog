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

## Em aberto — decidir antes da F3

- **Android nativo (Kotlin) x PWA instalavel.** A API ja e' agnostica de cliente
  (token no corpo, JSON puro), entao a decisao pode esperar. A recomendacao atual
  e' PWA para o piloto, pelo risco concentrado na fila de fotos offline.
- **Storage de evidencia.** Local no piloto; S3/Cloudflare R2 quando o volume
  justificar. O caminho ja esta modelado como `empresa/veiculo/inspecao/item/arquivo`.
- **Exportacao do historico do PROLOG.** Bloqueia a F8. Precisa ser respondido
  pela empresa, nao pela engenharia.
