# MYLOG — ROADMAP MESTRE

> **Arquitetura de destino:** [`ARQUITETURA.md`](ARQUITETURA.md). Este roadmap
> descreve o produto e o andamento; a pilha de produção e a ordem das fases
> estão lá.

**Plataforma de checklist, ocorrências, solicitação de veículo e manutenção preventiva para frotas corporativas**

Versão 3.0 — 03 de setembro de 2026
Substitui integralmente a versão 2.0 de 01/09/2026.

---

## Tese do MyLog

O MyLog substitui o uso operacional do PROLOG dentro da empresa. O navegador é o
centro de supervisão e controle; o aplicativo de campo é o posto de execução de
checklist, evidência e solicitação; o motor central conecta veículos, usuários,
solicitações, ocorrências, preventivas e histórico.

| Camada | Quem usa | Objetivo |
|---|---|---|
| Web / Painel | Equipe da frota | Configurar, cadastrar usuários e cargos, acompanhar a frota, aprovar solicitações, tratar ocorrências e preventivas. |
| Aplicativo de campo | Colaboradores | Solicitar veículo, executar checklist de saída e retorno, registrar evidências. |
| Backend / Motor | Sistema | Regras, permissões, sincronização, histórico e relatórios. |
| Storage | Sistema | Fotos, documentos e evidências, fora do banco. |

---

## 1. Objetivo do documento

Este é o documento único do MyLog. Não existe roadmap paralelo, anexo ou
versão complementar: toda decisão de produto vive aqui, e o que não está aqui
não está combinado.

A implementação pode ser quebrada em tarefas menores, mas a lógica de domínio,
os estados e as permissões devem permanecer alinhados a esta versão.

### O que a versão 3.0 mudou

A versão 2.0 desenhou uma plataforma de inspeção genérica, com muitos graus de
liberdade. O uso real é mais estreito e mais rígido:

> A plataforma faz checklist de automóvel, guarda tudo que foi feito, mostra o
> que precisa ser consertado e quem vai usar cada carro.

Cinco mudanças estruturais decorrem disso:

| # | Mudança | Por quê |
|---|---|---|
| 1 | **Sai o vínculo usuário-veículo** | Os carros trocam de mão o tempo todo. Não existe condutor principal nem lista de condutores. |
| 2 | **Saem os cinco papéis de acesso** | Dois níveis bastam: **Frota** e **Colaborador**. |
| 3 | **Ticket vira Solicitação de veículo** | Não é chamado de suporte: é reserva de carro com janela de horário, aprovação e devolução. |
| 4 | **Toda pergunta de checklist vira foto + OK/Ocorrência** | Saem número, texto, seleção, sim/não e o checklist adaptativo. |
| 5 | **O checklist roda duas vezes** | SAÍDA na retirada e RETORNO na devolução, com o mesmo modelo. |

---

## 2. Visão do produto

O MyLog tem dois produtos integrados, não duas telas:

**Painel web.** Controle operacional e administrativo da frota. É onde ficam
usuários, cargos, veículos, modelos de checklist, solicitações, ocorrências,
preventivas, indicadores e relatórios.

**Aplicativo de campo.** Estação de trabalho do colaborador. Otimizado para
executar checklist com poucos toques, funcionar sem internet e capturar
evidência com contexto.

**Motor central.** Aplica regras, identifica pendências, controla permissões e
preserva o histórico das decisões.

> **Princípio.** O usuário do aplicativo não administra o sistema. Ele executa
> tarefas liberadas pela Frota. A Frota define quem entra, o que cada pessoa
> pode fazer e quais checklists estão disponíveis para cada cargo.

---

## 3. Modelo de acesso

O MyLog tem **dois níveis de acesso**, e apenas dois:

| Nível | Onde entra | O que faz |
|---|---|---|
| **Frota** | Painel web e aplicativo | Cadastra usuários e cargos, cadastra veículos, cria e publica checklists, aprova solicitações, trata ocorrências, libera veículo bloqueado, consulta auditoria. |
| **Colaborador** | Somente aplicativo | Solicita veículo, executa os checklists liberados para o seu cargo, devolve o veículo. |

No cadastro isso é uma marcação única: **acessa o painel? sim/não**.

### Cargo não é permissão

**Cargo** é a função da pessoa na empresa — RH, Técnico de campo, Motorista,
Vendedor, Analista — cadastrado livremente pela Frota. Ele **não concede
permissão de sistema**. Serve para duas coisas:

1. identificar quem é a pessoa no cadastro;
2. decidir **quais checklists aparecem** para ela no aplicativo.

Se o cargo do colaborador não estiver liberado num modelo de checklist, aquele
checklist **nem aparece** na tela dele.

### Como alguém chega a um veículo

Não existe trava por veículo dentro do sistema. Quem opera carro tem cargo
compatível, e o controle real é físico: só mexe na frota quem tem acesso ao
galpão, e existe uma equipe de frota para isso.

**O sistema registra; ele não guarda a chave.** Essa é uma decisão consciente:
duplicar em software um controle que já existe no mundo físico só produziria
atrito e cadastro desatualizado.

---

## 4. Fluxo macro do MyLog

```
Frota cadastra cargo  →  Frota cadastra usuário com senha inicial
      →  colaborador troca a senha no primeiro acesso (fica ATIVO)
      →  colaborador solicita veículo com janela de horário e motivo
      →  Frota aprova
      →  colaborador retira o carro e executa o CHECKLIST DE SAÍDA
      →  usa o veículo dentro da janela
      →  devolve e executa o CHECKLIST DE RETORNO
      →  se passou do prazo, descreve o motivo antes de encerrar
      →  ocorrências abertas nos checklists caem na fila da Frota
      →  crítica bloqueia o veículo até a Frota liberar com motivo
```

---

## 5. Arquitetura de alto nível

| Componente | Função | Decisão |
|---|---|---|
| Aplicativo de campo | Execução de checklist | **PWA instalável**, offline-first, fila local de sincronização, câmera, assinatura. |
| Web | Supervisão e configuração | Painel responsivo, foco em leitura rápida e ação prioritária. |
| API/Backend | Regras e segurança | Centraliza autenticação, autorização, estados, auditoria. |
| Banco | Dados estruturados | PostgreSQL em produção; SQLite em desenvolvimento, com esquema portável. |
| Object Storage | Arquivos | Fotos e documentos; cada objeto com referência e vínculo à entidade. |
| Worker/Jobs | Processos assíncronos | Relatórios, processamento de imagem, lembretes de preventiva. |
| PDF/Relatórios | Saída documental | Relatório operacional, executivo e dossiê de evidências. |

### Por que PWA primeiro, e não app nativo

O risco concentrado da fase de campo não é a linguagem: é a **fila de fotos
offline**. Um app nativo colocaria uma stack nova exatamente em cima do trecho
mais arriscado do projeto. O PWA usa o mesmo stack já dominado, e a API
permanece agnóstica de cliente — trocar por Kotlin depois não mexe no backend.

> **Atualização de 06/09/2026.** O Android nativo está decidido, e será escrito
> **do zero**. O PWA passa a regime de manutenção
> ([ARQUITETURA 4.1](ARQUITETURA.md)): continua sendo o cliente de campo até o
> APK existir, e para de receber investimento novo. O que se aproveita no
> nativo é o **contrato**, não o cliente.

### O motor de checklist é um arquivo só

O julgamento de conformidade é **um único arquivo**, importado pelo servidor e
servido ao navegador. Não há cópia. Duas implementações divergiriam, e a
divergência apareceria da pior forma possível: *"aprovado no pátio, reprovado no
painel horas depois"*.

Consequência: esse arquivo não pode importar nada do Node, tocar o banco ou ler
o relógio.

### O servidor re-julga toda inspeção recebida

O aplicativo calcula o resultado para mostrar ao colaborador na hora. Quando a
inspeção chega ao servidor, ele **re-julga do zero**, com o mesmo motor e a
versão do modelo que foi respondida. Qualquer resultado que venha no corpo da
requisição é ignorado.

Um aparelho no pátio é um cliente não confiável, e o resultado do checklist é o
que bloqueia ou libera um caminhão.

---

## 6. Modelo mental de dados

O domínio não é construído ao redor da tabela "checklist". O núcleo é a relação
entre pessoa, cargo, ativo, inspeção, evidência, ocorrência, solicitação e
manutenção.

| Entidade | Representa | Relacionamentos essenciais |
|---|---|---|
| Empresa | Organização cliente | Possui usuários, cargos, veículos e políticas. |
| **Cargo** | Função na empresa | Agrupa usuários e libera modelos de checklist. |
| Usuário | Pessoa com credencial | Tem cargo, estado de acesso e a marcação de acesso ao painel. |
| Veículo | Ativo inspecionado | Tem placa, modelo, tipo, status e KM atual. |
| Modelo de checklist | Modelo de inspeção | Tem versões, perguntas e opções de problema. |
| Inspeção | Execução de um modelo | Tem veículo, usuário, momento (SAÍDA/RETORNO), respostas e evidências. |
| Ocorrência | Falha encontrada | Vincula pergunta, evidência, prioridade e tratamento. |
| **Solicitação de veículo** | Reserva de carro | Tem solicitante, veículo, janela de horário, motivo e devolução. |
| Preventiva | Próxima manutenção | Controlada por KM ou data, gera alerta. |
| Evento de auditoria | Histórico imutável | Registra criação, alteração, bloqueio, liberação e fechamento. |

> **Sai do modelo:** a entidade *Vínculo usuário-veículo* da v2.0.

---

## 7. Painel web — dashboard de supervisão

Ao abrir, a Frota deve enxergar o que exige ação sem entrar em menus.

| Card/Área | Informação | Ação rápida |
|---|---|---|
| Frota | Total por status | Filtrar e abrir veículo. |
| Checklists | Hoje, saídas em aberto | Ver lista e detalhe. |
| Ocorrências | Críticas, abertas, recorrentes | Abrir e atribuir. |
| **Solicitações** | Pendentes de aprovação, em uso, atrasadas na devolução | Aprovar, recusar, ver detalhe. |
| Preventivas | Vencidas, próximas, em dia | Abrir e reagendar. |
| Usuários | Pendentes de primeiro acesso, bloqueados | Abrir cadastro. |
| Alertas | Eventos de prioridade alta | Navegar direto para a origem. |

Cada card e cada linha da fila de ação leva à tela que resolve aquele alerta.

---

## 8. Usuários, cargos e credenciais

A Frota é responsável pela governança dos acessos. O colaborador não cria sua
credencial.

### 8.1 Cadastro de usuário

O botão **+ Novo usuário** abre um popup com:

| Campo | Regra |
|---|---|
| Nome completo | obrigatório |
| CPF | obrigatório |
| Email | obrigatório — é por ele que a pessoa entra e recebe senha nova |
| Número de telefone | obrigatório |
| Cargo | escolhido da lista de cargos cadastrados |
| Acessa o painel? | sim/não — define Frota ou Colaborador |
| **Usa veículo todos os dias?** | sim/não — ver 8.2 |
| Senha inicial | **gerada pelo sistema**: alfanumérica, mínimo 8 dígitos |

A senha inicial **não é digitada** pela Frota. O sistema sorteia e mostra na
tela para ser repassada. No **primeiro acesso ao aplicativo a troca de senha é
obrigatória**, antes de qualquer outra tela.

### 8.2 Usa veículo todos os dias — a chave dos dois fluxos

Este campo separa dois tipos de gente, e com eles dois fluxos que a v3.0
tratava como um só:

| | **Sim** — usa veículo todos os dias | **Não** — usa eventualmente |
|---|---|---|
| Quem é | Técnico de campo, técnico de redes: sai com carro toda manhã | Vendas, marketing, administrativo |
| Como pega o carro | Já tem carro à disposição; não pede | Faz **solicitação** (seção 10) |
| O que executa | **Checklist diário avulso**, sem solicitação por trás | Checklist de **saída e retorno**, amarrado à solicitação |
| Retorno | Não exigido | **Obrigatório** |
| Cobrança | Entra na conta de "não realizado" quando o modelo é obrigatório no dia (11.2) | Não entra: só faz checklist quando pede carro |

> **De onde veio esta regra.** O relatório real do PROLOG de 05/08 a 04/09/2026
> traz **863 checklists de Saída para 54 de Retorno** — retorno em 6% dos
> casos. Não é indisciplina: é que a esmagadora maioria dos checklists é o
> diário de quem sai com carro toda manhã, e para esse não existe "devolução".
> Exigir retorno de todo mundo produziria 800 pendências falsas por mês.

### 8.3 Cargos

Ao lado de **+ Novo usuário**, o botão **Cargos** abre um popup que lista os
cargos existentes e permite criar novos. É a mesma lista consumida pelo editor
de checklist.

### 8.4 Estados da credencial

| Estado | Significado exato | Entra no aplicativo? |
|---|---|---|
| **Pendente** | Ainda não acessou e ainda não trocou a senha inicial | Só para trocar a senha |
| **Ativo** | Já trocou a senha e está apto a usar | Sim |
| **Bloqueado** | Acesso impedido por decisão corporativa | Não |
| **Suspenso** | Acesso suspenso temporariamente | Não |
| **Desativado** | Não aparece em lugar nenhum como se estivesse em uso; os dados permanecem guardados | Não |

> **Mudou em relação à v2.0.** "Pendente" deixa de significar *aguardando
> liberação do ADM* e passa a significar *ainda não fez o primeiro acesso*. A
> ativação deixa de ser um ato da Frota e passa a ser consequência da troca de
> senha pelo próprio colaborador.

### 8.5 Ações do usuário

Os botões soltos na linha saem. Na ponta direita, **três pontinhos** abrem:

- **Editar**
- **Mudar senha** — gera nova senha aleatória e envia para o email cadastrado; ao entrar com ela a troca é obrigatória, como no primeiro acesso
- **Bloquear**
- **Suspender**
- **Desativar**
- **Histórico completo do usuário**

### 8.6 Histórico completo do usuário

Tela dedicada com **tudo que o colaborador fez ou deixou de fazer**, com data e
hora em cada linha:

- checklists executados, com veículo, momento (saída/retorno) e resultado
- ocorrências abertas
- solicitações feitas, aprovadas, recusadas, devolvidas
- devoluções fora do prazo, com o motivo que ele escreveu
- ações da Frota sobre ele: bloqueio, suspensão, desativação, troca de senha

O objetivo é ter em mãos o registro completo do colaborador.

### 8.7 Regras de segurança

- Nunca armazenar senha em texto puro.
- Sessões e tokens devem permitir revogação imediata.
- Perder o estado "Ativo" derruba as sessões abertas na requisição seguinte.
- Alterações de cargo, acesso ao painel e estado de credencial geram evento de auditoria.
- A empresa não pode ficar sem nenhum usuário de Frota ativo.

---

## 9. Frota — cadastro de veículos

### 9.1 Cadastro

| Campo | Observação |
|---|---|
| Placa | Identifica o ativo. **Imutável** após o cadastro. |
| Marca, modelo, ano | Dados descritivos |
| Tipo | Compactos leves · Pick-up · 4x4 · Motocicleta · Caminhões |
| KM atual | Campo digitável **dentro de Editar** |
| Status | Ver 9.3 |

> **Não existe condutor principal** e **não existe área de Condutores**. Os
> carros trocam de mão o tempo todo; registrar um dono fixo produziria cadastro
> mentiroso em uma semana.

### 9.2 Quilometragem

O KM é campo digitável dentro de **Editar** — sem botão próprio e sem tela
separada.

Regras que permanecem:

- o hodômetro **não anda para trás** sem justificativa escrita;
- a correção vai para a auditoria;
- o KM também é lido **na abertura de cada checklist** (ver 11.4).

Um erro de digitação aqui (410000 no lugar de 41000) adiaria uma manutenção por
370 mil km sem ninguém perceber.

### 9.3 Status do veículo

| Status | Significado |
|---|---|
| **Disponível** | Pode ser solicitado e operado |
| **Com pendência** | Opera, mas tem ocorrência aberta |
| **Bloqueado** | Não pode sair. Liberar exige motivo |
| **Em manutenção** | Fora de operação por serviço |

O filtro **Todos os status** lista exatamente essas quatro opções.

> Sai o status *Restrito* da v2.0 — a operação não usava a diferença entre
> restrito e bloqueado.

**Estado crítico alterável.** Uma ocorrência de prioridade **crítica** bloqueia
o veículo automaticamente. A Frota pode alterar esse estado manualmente — por
exemplo, quando um diagnóstico técnico conclui que o problema não impede a
operação. A alteração exige motivo e fica na auditoria.

### 9.4 Ações do veículo

Mesmo padrão: botões laterais saem, **três pontinhos** na ponta direita abrem
Editar, Status e Histórico.

---

## 10. Solicitação de veículo

### 10.1 O problema que resolve

Quem não tem carro à disposição o tempo todo precisa de um jeito de pedir um.
Sem isso, ou a pessoa fica sem meio de transporte, ou pega um carro sem
registro nenhum.

> **A v2.0 interpretou este módulo errado.** Ele não é abertura de chamado sobre
> problema, dano, limpeza ou documentação. É **reserva de veículo**.

### 10.2 Quem pede é quem não tem carro fixo

A solicitação existe para quem tem **"usa veículo todos os dias" = não** (8.2).
Quem sai com carro toda manhã não pede: executa o checklist diário avulso.

### 10.3 O colaborador pede uma CATEGORIA, não uma placa

Quem precisa de carro sabe **o que vai fazer**, não qual carro está livre. Pedir
placa obriga o colaborador a conhecer a frota, e faz ele escolher errado — pede
o carro de que gostou, não o que serve.

Então ele escolhe uma **categoria de uso**, descrita pelo que importa para o
trabalho: quantos lugares e que tipo de carroceria.

| Categoria | Para que serve |
|---|---|
| 4 assentos — compacto | Deslocamento de pessoas: reunião, visita |
| 2 assentos — compacto | Deslocamento curto, uma ou duas pessoas |
| 4 assentos — utilitário | Equipe mais carga ou equipamento |
| 2 assentos — utilitário | Carga, material, equipamento |

São dois eixos cruzados — **quantos lugares** e **que tipo de carroceria** —
e é assim que quem precisa de carro descreve a necessidade: "vou levar três
pessoas" ou "vou levar escada e caixa de ferramenta".

A lista é **cadastrável pela Frota**, não fixa no código: a frota muda e a
categoria descreve a frota que existe.

> **Categoria e tipo de veículo são coisas diferentes e não se convertem uma na
> outra.** A categoria é a necessidade de uso, declarada pelo colaborador. O
> **tipo** (compacto leve, pick-up, 4x4, motocicleta, caminhão) é uma
> propriedade do carro, e é ele — e só ele — que decide qual checklist aparece
> no aplicativo. Pedir "4 assentos utilitário" e receber uma pick-up faz aparecer
> o checklist de pick-up, porque o checklist verifica o carro que está na mão,
> não o que foi pedido.

### 10.4 Fluxo

1. **Pedido.** O colaborador informa:
   - **categoria de uso** — ex.: 4 assentos utilitário;
   - dia e janela de horário — por exemplo, sexta-feira das 13:00 às 18:00;
   - motivo — por exemplo, reunião em outra cidade.

   Ele **não vê placas** nesta tela, e não precisa ver.
2. **Antecedência.** O pedido é feito com **24 horas de antecedência**.
3. **Aprovação — escolher a placa É aprovar.** A Frota abre o pedido e vê os
   veículos daquela categoria livres na janela, com **marca, modelo e placa**.
   Seleciona um e libera.

   São **um ato só**, não dois. Não existe "aprovar agora e dizer o carro
   depois": uma solicitação aprovada sem placa deixaria o colaborador de pé no
   pátio sem saber o que pegar. O botão de liberar só funciona com um veículo
   selecionado, e a escolha vai para a auditoria com o nome de quem escolheu.

   Se não houver carro livre na categoria, a Frota pode liberar um carro de
   outra categoria — explicando o porquê — ou recusar com motivo.
4. **O solicitante vê o carro que vai usar.** Assim que a Frota libera, o
   pedido dele deixa de mostrar a categoria e passa a mostrar o **veículo**:

   ```
   Solicitação #14                            APROVADA

   Fiat Strada                    Pick-up
   ABC1D23
   sexta, 05/09 · 13:00 às 18:00

   Liberado por Marina Lopes
   ```

   Essa tela é o que ele consulta no pátio para saber qual carro é o dele. A
   placa em destaque, porque é ela que ele vai procurar no estacionamento —
   não a marca.

   Aparece **no aplicativo** (é onde ele está quando vai pegar o carro) e
   também na lista de solicitações do painel.
5. **Retirada.** Ele vai até o local, pega o carro e executa o **checklist de
   SAÍDA**. O checklist que abre é o do **tipo do veículo liberado** (10.3).
6. **Uso.** O veículo fica associado a ele durante a janela aprovada.
7. **Devolução.** Ele devolve até o prazo e executa o **checklist de RETORNO**.
   **O retorno é obrigatório aqui, e só aqui** — carro pedido tem que voltar
   para a mão de quem o entregou (8.2).
8. **Fora do prazo.** Se a devolução passar do horário pedido, antes de encerrar
   o aplicativo mostra:

   > *Notamos que passou do prazo de retorno. Descreva o motivo.*

   E ele escreve — por exemplo: *"cheguei tarde, a base estava fechada e tive
   que ir com o carro embora para não deixar no tempo"*. O texto fica no
   registro da solicitação e no histórico do usuário.

### 10.5 Estados da solicitação

| Estado | Quando |
|---|---|
| Pendente | Pedido feito com uma categoria, aguardando a Frota |
| Aprovada | Frota escolheu o carro e liberou; a placa fica reservada na janela e o solicitante já a vê |
| Recusada | Frota negou, com motivo |
| Em uso | Checklist de saída concluído |
| Devolvida | Checklist de retorno concluído dentro do prazo |
| Devolvida com atraso | Checklist de retorno concluído fora do prazo, com motivo registrado |
| Cancelada | Desistência antes da retirada |

### 10.6 Regra de segurança

O colaborador escolhe **categoria, janela e motivo**. Não escolhe carro, não
altera placa, modelo ou qualquer dado mestre. A garantia é de permissão no
servidor — não de botão escondido na tela: a rota de criação de solicitação
recusa `veiculo_id` vindo do colaborador, mesmo que alguém o injete na
requisição.

---

## 11. Checklist

### 11.1 O que o modelo é

Toda pergunta é uma **verificação visual com dois desfechos: OK ou Ocorrência**.

Saem da v2.0: os tipos de resposta sim/não, número, seleção, texto e data/hora,
e o checklist adaptativo com itens condicionais.

A **assinatura** deixa de ser um tipo de pergunta e vira uma configuração do
checklist inteiro.

### 11.2 Criação — primeira tela

A Frota clica em **+ Novo checklist** e informa:

| Campo | Exemplo / opções |
|---|---|
| Nome | Checklist padrão diário |
| Tipo de veículo | Compactos leves · Pick-up · 4x4 · Motocicleta · Caminhões |
| Cargos liberados | Todos, ou um/alguns cargos da lista |
| Exigir assinatura digital ao finalizar? | botão deslizante sim/não |
| **Periodicidade** | Avulso · Diário · Semanal · Mensal — ver 11.2.1 |
| **Tem horário limite?** | caixa de marcar; se sim, um horário — ver 11.2.2 |

Dois botões ao final: **Cancelar** e **Criar rascunho**. Criado o rascunho, a
tela cai direto na configuração das perguntas.

#### 11.2.1 Periodicidade e obrigatoriedade

Nem todo checklist é do dia a dia. O PROLOG real roda quatro modelos ao mesmo
tempo, com ritmos diferentes:

| Modelo real | Execuções no mês | Ritmo |
|---|---|---|
| Checklist Padrão (diário) | 797 | Todo dia útil |
| Check List OCORRÊNCIA | 51 | Avulso, quando acontece algo |
| Checklist Semanal (Calibragem/Limpeza/Itens) | 38 | Uma vez por semana |
| Checklist Padrão Moto (diário) | 31 | Todo dia útil, quem anda de moto |

Daí as quatro periodicidades:

| Periodicidade | O que a Frota configura | O que o sistema cobra |
|---|---|---|
| **Avulso** | nada | Nada. Aparece no app, é feito quando alguém precisa |
| **Diário** | quais **dias da semana** são obrigatórios | Um checklist por dia marcado, por colaborador obrigado |
| **Semanal** | em que **dia da semana** vence | Um por semana |
| **Mensal** | o mês inteiro é a janela | Um por mês |

Os dias da semana são sete caixas de marcar. O relatório real mostra por que
isso importa: **155 a 189 checklists de segunda a sexta, contra 62 no sábado e
13 no domingo**. Cobrar sábado e domingo criaria ~90 faltas falsas por mês.

**Quem é cobrado:** só o colaborador com "usa veículo todos os dias" = sim
(8.2), e só se o **cargo dele estiver liberado** naquele modelo (11.2.3).

#### 11.2.2 Horário limite

Caixa de marcar: **"Tem horário limite para ser realizado?"**. Marcada, abre um
campo de horário.

| Situação | Estado do checklist |
|---|---|
| Feito antes do horário limite | **No prazo** |
| Feito depois do horário limite, no mesmo dia | **Atrasado** |
| Não feito depois do horário limite | **Não realizado** |

#### Como "não realizado" é calculado

**Não existe tabela de faltas.** É estado derivado, calculado na hora — guardar
falta seria guardar uma acusação que o próprio sistema pode ter que retirar:
bastaria o checklist subir da fila offline dez minutos depois.

Quem é cobrado, no dia:

1. está **ativo**;
2. tem **"usa veículo todos os dias" = sim** (8.2) — quem não usa só faz
   checklist quando pede um, e cobrar dela seria inventar falta;
3. tem o **cargo liberado** em ao menos um modelo obrigatório naquele dia.

E a conta é de **um checklist por pessoa, não um por modelo**. Se o cargo dela
libera quatro modelos — um por tipo de veículo — continua sendo um checklist:
ela faz o diário do carro que pegou.

**A falta só vale depois do horário limite.** Antes disso a pessoa não está
devendo nada, está trabalhando. Cobrar às 07h05 quem tem até as 08h30 é o tipo
de alarme falso que faz a operação parar de olhar o painel.

Aparece em dois lugares: na **fila de ação** do painel, e acima da lista em
*Checklists feitos* quando o filtro é de **um dia só** — "faltou" é pergunta de
dia, não de intervalo.

O horário limite não impede a execução: um checklist atrasado ainda é melhor
que checklist nenhum. Ele **classifica**, e a classificação é o que a Frota
cobra.

> **O número que justifica isso:** das saídas do checklist diário, **74%
> acontecem entre 07h e 08h** — 256 às 7h e 352 às 8h, contra 86 às 9h e menos
> de 20 em cada hora depois. Existe um horário de fato, e hoje ele não está em
> lugar nenhum do sistema. Um limite às 08h30 separaria a rotina da exceção sem
> inventar regra nova: só escreveria a que já existe.

#### 11.2.3 Cargo liberado esconde o modelo

Se o cargo do colaborador **não** está entre os liberados, o modelo **não
aparece** na tela dele — não aparece cinza, não aparece bloqueado, não aparece.

> **O caso que define a regra.** A frota tem um mecânico, e existe um
> *checklist pós-manutenção*. Esse modelo é liberado só para o cargo dele.
> Nenhum técnico de campo vê esse checklist na lista; o mecânico vê. Um
> checklist que aparece para quem não deve preenchê-lo é convite a preenchimento
> errado, e o dado errado é pior que a ausência dele.

A regra vale nas duas pontas: a tela esconde, e **o servidor recusa** uma
inspeção enviada com um modelo que o cargo não libera. A tela é conveniência; a
recusa no servidor é a garantia.

E vale **para todo mundo, inclusive a equipe da Frota**. O caso que criou a
regra é o checklist pós-manutenção do mecânico — e o mecânico é da Frota.
Abrir exceção para o nível de acesso esvaziaria a regra exatamente no exemplo
que a originou. Quem precisa executar um modelo acrescenta o próprio cargo à
lista de liberados; não existe atalho por nível.

### 11.3 Criação — cada pergunta

| Campo | Opções |
|---|---|
| Título da pergunta | ex.: Lateral do carro |
| Foto de exemplo | **upload de imagem** mostrando como a foto deve ser tirada; é a mesma imagem que o colaborador vê na tela da pergunta |
| Captura de fotos ao selecionar OK | **Obrigatório** (abre a câmera direto) · **Opcional** (pergunta se quer abrir a câmera, inserir foto ou seguir sem foto) · **Não capturar** (segue sozinho) |
| Quantidade máxima de fotos | número digitável — ex.: 4 |

#### Opções de problema para ocorrência

A imagem é **enviada ali mesmo**, não é uma URL digitada: quem cadastra o
checklist tem a foto no computador, não um endereço. A tela mostra a prévia em
tamanho grande — uma miniatura não responde à única pergunta que importa aqui,
que é se a imagem realmente *mostra* como fotografar a peça.

Vale igual para os dois tipos de modelo: **padrão e preventiva usam o mesmo
editor**. No checklist de preventiva a imagem tem peso a mais — é ela que a
foto tirada pelo mecânico substitui na tela do retorno (14.2.2).

> **Onde a imagem fica.** No mesmo storage das evidências, em ramo próprio
> (`empresa/modelos/template/`): ela não pertence a veículo nem a inspeção
> nenhuma — pertence ao modelo, e sobrevive a todas as execuções dele.
>
> É servida em `/imagens/modelo/...`, **fora de `/api/`**. O service worker
> ignora `/api/` de propósito — dado de frota velho é pior que dado ausente —
> mas guarda o resto. Assim a foto de exemplo entra no cache e o checklist abre
> no pátio sem sinal (seção 19). Continua passando por sessão e por empresa:
> link vazado não vira acesso.

Ainda na criação da pergunta monta-se a lista de problemas padrão daquela
pergunta, para o colaborador não precisar escrever tudo toda vez. Cada opção:

| Campo | Opções |
|---|---|
| Nome da opção | ex.: Lataria amassada |
| Obrigatoriedade de fotos | Obrigatório · Opcional · Não capturar |
| Quantidade máxima de fotos | número digitável |
| Abrir ocorrência? | Sim · Não |
| Se abrir ocorrência → prioridade | Baixa · Média · Alta · **Crítica** |

Na outra extremidade do bloco, um botão para **criar mais uma opção**.

> Exemplo, na pergunta "Lateral do carro": risco · amassado · furo · maçaneta
> quebrada.

### 11.4 Execução no aplicativo

**Antes da primeira pergunta**, uma tela única pede a **quilometragem do
hodômetro**. É a única entrada numérica do checklist, e é ela que mantém a
preventiva por KM funcionando.

Cada pergunta ocupa uma tela:

```
 ←                                                  seta de sair

     checklist diário padrão: ABC1D23 (SAÍDA)       topo, letra pequena

     ‹        pergunta 3 / 10        ›              setas: só já respondidas

     +----------------------------------+
     |                                  |
     |        foto de exibição          |
     |     (exemplo da pergunta)        |
     |                                  |
     +----------------------------------+

     [   OCORRÊNCIA   ]     [     OK     ]
         vermelho                verde
        (esquerda)             (direita)
```

- **Topo, letra pequena:** modelo, placa e momento — SAÍDA ou RETORNO.
- **Barra de contagem:** `pergunta 3/10`, com setas para os dois lados. As setas
  **só navegam entre perguntas já respondidas**; não dá para pular adiante.
- **Seta no topo esquerdo:** sai da execução do checklist.
- **Meio da tela:** a foto de exibição configurada na pergunta.
- **Dois botões:** **Ocorrência** em vermelho, à esquerda; **OK** em verde, à
  direita.

#### Caminho OK

Abre a câmera conforme a configuração da pergunta. Depois da foto, três opções:

| Opção | Efeito |
|---|---|
| Tirar novamente | apaga a foto e tira outra |
| Adicionar + foto | tira mais uma para a mesma pergunta, até o máximo configurado |
| Próximo | vai para a próxima pergunta |

#### Caminho Ocorrência

Abre a câmera. Depois da foto, as mesmas três opções. **Próximo** leva à seleção
dos problemas padrão daquela pergunta, ou à opção **escrever relatório**, que
troca a lista por um campo de texto livre para descrever o que houve.

### 11.5 Saída e retorno

O mesmo modelo roda **duas vezes por solicitação**: **SAÍDA** na retirada e
**RETORNO** na devolução.

Rodar o mesmo modelo nos dois momentos é o que permite comparar a mesma pergunta
antes e depois. É assim que se prova dano novo, em vez de discutir.

**O retorno não é universal.** Ele existe quando há solicitação por trás — ou
seja, para quem tem "usa veículo todos os dias" = não (8.2). O checklist diário
avulso, que é a esmagadora maioria, tem **só saída**: não há devolução, o carro
fica com a pessoa.

| Origem da execução | Saída | Retorno |
|---|---|---|
| Solicitação de veículo | sim | **obrigatório** |
| Checklist diário avulso | sim | não se aplica |
| Checklist de ocorrência (avulso) | sim | não se aplica |

### 11.6 Versionamento

Modelo publicado é **imutável**. Alterar o checklist cria a versão seguinte;
publicar a nova arquiva a anterior.

Cada inspeção aponta para a versão que foi respondida. Editar uma versão
publicada reescreveria o significado de inspeções já feitas — uma pergunta
removida faria uma inspeção antiga parecer incompleta.

### 11.7 Encerramento

Antes de concluir, o aplicativo mostra um resumo com:

- perguntas conformes;
- ocorrências abertas e sua prioridade;
- fotos obrigatórias pendentes;
- estado final previsto do veículo;
- assinatura, quando o modelo exigir.

### 11.8 A aba Checklists no painel

Passar o mouse sobre **Checklists** no menu lateral abre duas linhas:

```
  Checklists  ▸   Checklists feitos      o que aconteceu
                  Modelos de checklist   o que deve acontecer
```

São duas coisas diferentes e hoje estão empilhadas na mesma tela. *Modelos* é
cadastro: raro, feito pela Frota, muda pouco. *Feitos* é operação: aberto todo
dia, várias vezes.

### 11.9 Checklists feitos

**Ao abrir, mostra os checklists de hoje.** Sem clicar em nada. Quem entra
nessa tela quer saber o que já foi feito hoje e o que está faltando — essa é a
pergunta das 8h da manhã, e ela não deveria custar dois cliques.

Dois filtros no topo, lado a lado:

**1. Período**

- **De … até …** — intervalo livre entre duas datas;
- **navegação por mês completo** — setas ‹ › que andam de mês em mês, mostrando
  o mês inteiro de uma vez;
- atalhos: **Hoje** (padrão) · Ontem · Esta semana · Este mês.

**2. Visualização**

- **Todos** — tudo que foi feito no período;
- **Por cargo** — agrupa pelos cargos cadastrados, o mesmo recorte que a tela
  da Frota usa;
- **Um cargo específico** — só Técnico de Campo, só Vendedor, e assim por
  diante.

A lista traz, por linha: data e hora, colaborador, cargo, modelo, placa, tipo do
veículo, KM coletado, momento (saída/retorno), quantas ocorrências, e o estado
de prazo (no prazo · atrasado). Clicar abre o dossiê de impressão da inspeção
(seção 27).

### 11.10 Exportar para planilha

Botão **Exportar** na tela de checklists feitos, aplicando os mesmos filtros que
estão na tela — exporta o que está sendo visto, não a base inteira.

O formato reproduz o relatório que a operação já lê hoje no PROLOG, para que
ninguém precise aprender a ler outra planilha durante a substituição. Colunas,
nesta ordem:

```
Unidade;Modelo checklist;Código checklist;Data realização;Data importado;
Colaborador;CPF;Equipe;Cargo;Placa;ID Frota;Tipo de veículo;KM coletado;
Tempo realização (segundos);Tipo;Total de perguntas;Total itens com problemas;
Total imagens ou anexos;Total imagens alternativas;Itens com Prioridade baixa;
Itens com Prioridade alta;Itens com Prioridade crítica;Itens não se aplica;
Observação
```

Separador `;`, codificação UTF-8 com BOM — é o que o Excel em português abre
sem pedir nada.

Três colunas exigem explicação, porque o nome engana:

- **`Itens não se aplica`** é sempre `Total de perguntas − Total itens com
  problemas`. Conferido em todas as 917 linhas do relatório real: não existe um
  terceiro desfecho no PROLOG, apesar do nome. O MyLog preenche com a contagem
  de conformes, que é a mesma coisa dita direito.
- **`Equipe`** sai **vazia**. O PROLOG tem Equipe e Cargo como duas
  classificações independentes; o MyLog tem só Cargo (decisão da operação). A
  coluna fica no arquivo para o leiaute não quebrar, e vazia porque preenchê-la
  com o cargo seria inventar um dado que não existe.
- **`Código checklist`** é um número sequencial por empresa, legível e citável
  ("confere o 21713016"). O identificador interno da inspeção é opaco e não
  serve para conversa de rádio.

`Data importado` e `ID Frota` também saem vazias: são campos de importação e de
lotação que não existem no modelo do MyLog.

---

## 12. Ocorrências

### 12.1 O que é

Ocorrência responde **"o que deu errado"**. Nasce de uma pergunta de checklist
respondida como Ocorrência, quando a opção de problema escolhida está marcada
como *abrir ocorrência: sim*.

### 12.2 Prioridade

| Prioridade | Consequência padrão |
|---|---|
| Baixa | Entra na fila; veículo segue disponível |
| Média | Entra na fila; veículo fica com pendência |
| Alta | Fila prioritária; veículo fica com pendência |
| **Crítica** | **Bloqueia o veículo** na abertura |

A prioridade vem da opção de problema configurada no modelo (11.3), não é
digitada na hora.

Um veículo bloqueado por ocorrência crítica só é liberado pela Frota, com
motivo, e a liberação vai para a auditoria.

### 12.3 Estados

Em aberto → Em tratamento → Resolvida → Encerrada

> Sai o estado *Validada* da v2.0: a etapa de validação em separado não existe
> na operação.

### 12.4 Filtros

- **Filtro de situação:** Em aberto · Em tratamento · Resolvida · Encerrada
- **Filtro de prioridade:** Baixa · Média · Alta · Crítica

> Sai o nível *Informativo* da v2.0.

**Filtro por veículo, sem seletor.** É o único que não tem caixa própria: quem
quer ver as ocorrências de um carro chega pelo carro — no histórico do veículo,
"abrir as ocorrências deste veículo". A lista então mostra uma etiqueta com a
placa e um *limpar* que devolve a frota inteira. Um seletor de placa a mais na
barra de filtros seria uma escolha entre setenta itens para responder uma
pergunta que já nasce respondida.

### 12.4.1 Histórico do veículo abre com o que está em aberto

Quem abre o histórico de um carro está decidindo se libera ele. A pergunta
"o que ainda está em aberto" vem **antes** de "o que já aconteceu", porque é
ela que impede a liberação. Sem isso, o histórico contava a vida do carro sem
dizer o que ele tem hoje.

### 12.5 Ações

Mesmo padrão: botões laterais saem, **três pontinhos** na ponta direita.

---

## 13. Evidências e armazenamento de imagens

As imagens ficam em Object Storage; o banco guarda o vínculo e os metadados.

| Metadado | Exemplo |
|---|---|
| empresa_id | emp_001 |
| veiculo_id | vei_104 |
| inspecao_id | ins_9831 |
| pergunta_id | lateral_esquerda |
| ocorrencia_id | oco_883 |
| capturado_em | 2026-09-03 09:42 |
| usuario_id | usr_77 |
| tipo | image/jpeg |
| caminho | empresa/vei_104/ins_9831/lateral_esquerda/001.jpg |

Regras:

- comprimir e redimensionar no aplicativo antes do upload;
- não depender da URL como identificador lógico;
- controlar acesso por empresa;
- preservar a evidência original quando a política exigir;
- manter miniaturas para relatório e visualização rápida;
- **não armazenar imagem dentro de tabela do banco**.

### Foto com contexto

Para itens críticos, a política pode exigir que a foto seja capturada naquele
momento e associada automaticamente a usuário, veículo, pergunta, inspeção e
horário.

| Informação | Uso |
|---|---|
| Data e hora | Quando a evidência foi capturada |
| Usuário | Quem executou |
| Veículo | Qual ativo |
| Pergunta | Qual pergunta originou a foto |
| GPS contextual | Onde a inspeção ocorreu, quando habilitado |
| Hash do arquivo | Integridade e rastreabilidade |

---

## 14. Vistorias preventivas

As preventivas são parte oficial do MyLog. A lógica é híbrida: veículos novos
podem seguir periodicidade por quilometragem; veículos mais antigos, por data.
O cadastro da preventiva determina o método.

| Método | Uso | Exemplo |
|---|---|---|
| Por KM | Veículos novos, operação por uso | Próxima em +10.000 km |
| Por data | Veículos antigos, periodicidade temporal | Próxima em 20/10/2026 |

### 14.1 Ciclo

1. A Frota cadastra ou ativa a preventiva do veículo.
2. Define o método: KM ou data.
3. Define o alvo e a janela de alerta.
4. Ao executar, registra data, KM, serviço e responsável.
5. **Na conclusão, o sistema exige definir a próxima** — por KM ou por data.
6. O sistema calcula o vencimento e passa a monitorar.

Concluir e agendar a próxima são o mesmo ato. Não existe "concluir e decidir
depois": é assim que uma frota perde a agenda de manutenção.

**Cada ciclo é um registro.** Concluir não reescreve a preventiva existente:
ela vira "realizada" e nasce a próxima. O histórico de manutenção do veículo
fica legível, com KM, data, serviço e responsável de cada execução.

### 14.2 Checklist de preventiva — a execução da manutenção

A preventiva deixa de ser só uma data no calendário: ela é **executada por um
checklist próprio**, criado na seção de Preventivas. Concluir a preventiva e
finalizar o checklist de retorno passam a ser o mesmo ato.

#### 14.2.1 O que o difere do checklist padrão

| | Checklist padrão | Checklist de preventiva |
|---|---|---|
| Momentos | Saída sempre; retorno quando há solicitação | **Saída e retorno, os dois obrigatórios** |
| O que a saída registra | Estado do veículo antes de rodar | Estado da peça **antes do serviço** |
| O que o retorno registra | Estado na devolução | **O que foi feito** em cada peça |
| Relatório escrito | Não existe | Campo em toda pergunta |
| Ao finalizar | Encerra a inspeção | Encerra a preventiva e **agenda a próxima** |

O resto é igual: tipo de veículo, cargos liberados, assinatura, foto de
exibição, modos de captura e opções de problema são configurados na criação do
modelo exatamente como no checklist convencional. É o mesmo editor.

**Onde se cria, e por quê.** A porta fica em Preventivas — *"Modelos de
preventiva"* —, e não junto dos checklists padrão: quem cuida de manutenção é
quem sabe o que a oficina precisa conferir. A lista dali mostra só os modelos de
preventiva, e o botão de criar já cria desse tipo. **A finalidade não é um campo
que se escolhe no meio do formulário:** a pessoa chegou pela seção certa, e
trocar depois de criado não existe, porque muda o que o aplicativo exige na
execução.

**Preventiva não tem frequência.** O bloco de periodicidade — diário, dias da
semana, horário limite — some do formulário. Quem diz quando a preventiva
acontece é o agendamento, por KM ou por data; oferecer "diário, nos dias
marcados" aqui seria oferecer uma cobrança que nunca vai existir.

> Isto **estava escrito aqui e não existia no código**. `criarTemplate` nunca
> mandava `finalidade`, então o servidor gravava `padrao` em tudo: não havia
> como criar um modelo de preventiva pela interface — só a semente criava — e a
> tela de agendamento pedia um modelo que ninguém podia fazer. O consumidor
> existia, o produtor não.

#### 14.2.2 A tela do retorno

O retorno é a parte nova. Ele repete as mesmas perguntas da saída, mas o que
interessa nele não é "está OK?" — é "o que foi feito aqui?".

```
     pinça de freio                              título da pergunta

     +----------------------------------+
     |     foto de exibição             |        exemplo de como fotografar
     |     (exemplo da região)          |
     +----------------------------------+

              [   Próximo   ]                    abre a câmera
```

Tirada a foto, **ela substitui a foto de exemplo** — quem confere passa a ver o
que foi registrado, não mais o modelo:

```
     pinça de freio

     +----------------------------------+
     |     A FOTO QUE ACABOU DE         |
     |     SER TIRADA                   |
     +----------------------------------+

     Foi feito manutenção?
          [  Não  ]        [  Sim  ]

     +----------------------------------+
     |  relatório desta foto            |
     +----------------------------------+

   [Tirar novamente]  [+ foto]  [Próximo]
```

**O relatório é obrigatório quando a resposta é "sim".** Mexer numa peça e não
descrever o que foi feito produz um registro que não serve para nada — nem para
a próxima manutenção, nem para uma discussão de garantia. Quando a resposta é
"não", o campo continua ali, opcional.

#### 14.2.3 Antes da assinatura: quando é a próxima

Ao finalizar o **retorno**, antes da assinatura digital, entra uma tela a mais:

> **Quando vence a próxima preventiva deste veículo?**
> ( ) Por quilometragem → KM-alvo
> ( ) Por data → data-alvo

São as mesmas duas opções do cadastro de preventiva (14.1), pedidas na hora em
que a informação existe: quem acabou de fazer o serviço é quem sabe quando ele
precisa ser refeito. Perguntar depois, no painel, é perguntar a quem não estava
lá.

Finalizado o retorno, o sistema, num ato só:

1. grava a inspeção de retorno;
2. marca a preventiva como **realizada**, com data, KM e responsável;
3. **cria a próxima** com o alvo informado.

É a regra da seção 14.1 — "concluir e agendar a próxima são o mesmo ato" —
agora acontecendo onde o serviço acontece.

#### 14.2.4 Quem executa

O mesmo mecanismo de sempre: o modelo declara os **cargos liberados**, e o
checklist só aparece para quem tem o cargo. Um modelo de preventiva liberado só
para "Analista de manutenção" não aparece para mais ninguém — nem para o resto
da Frota (11.2.3).

### 14.3 Reagendamento

| Caso | Ação |
|---|---|
| Próxima por KM | Informar KM-alvo e alerta antecipado |
| Próxima por data | Informar data-alvo e alerta antecipado |
| Mudança excepcional | A Frota altera **com motivo**, e vai para a auditoria |
| Manutenção atrasada | Status "Vencida" permanece até o registro de conclusão |

### 14.4 Estados e sinais no painel

| Estado | Visual | Ação |
|---|---|---|
| Em dia | verde | Nenhuma |
| Próxima | amarelo | Exibir quanto falta |
| Muito próxima | laranja | Destacar na fila |
| Vencida | vermelho | Fixar no painel até resolver |
| Realizada | concluído | Registrar histórico e próxima regra |

O status é **calculado** a partir de KM e data, nunca digitado. A regra é
determinística e explicável: a tela consegue dizer *por que* está amarelo.

- `muito próxima` = dentro da janela de alerta configurada
- `próxima` = dentro de três vezes essa janela

---

## 15. Notificações e alertas

São duas coisas diferentes, e confundi-las produz um painel que grita sem
dizer nada.

| | **Fila de ação** (painel) | **Notificação** (sino) |
|---|---|---|
| O que é | O estado da frota agora | Um fato que acabou de acontecer |
| Como nasce | Calculada a cada abertura do painel | Gravada no instante do fato |
| De quem é | De todo mundo que abre o painel | De **uma pessoa** |
| Some quando | O problema é resolvido | A pessoa lê |

A fila de ação responde *"o que está errado?"*. A notificação responde *"o que
mudou desde a última vez que olhei?"*.

### 15.1 O sino

Fica no alto, à direita, em **todas as telas** do painel — por isso não mora no
cabeçalho de nenhuma delas. Um **ponto vermelho** aparece quando há aviso não
lido.

**Sem número.** O que importa é *"tem coisa nova"*. Um contador grande vira
aviso que a pessoa aprende a ignorar, e aviso ignorado não é aviso.

Clicar abre a lista: não lidas primeiro, mais recente no topo. Cada linha leva
à tela que resolve — pedido novo abre Solicitações, ocorrência crítica abre
Ocorrências — e marca aquela como lida no caminho. Lida **não some da lista**:
quem quiser reler, relê.

### 15.2 O que gera notificação, e para quem

| Fato | Quem recebe | Nível |
|---|---|---|
| Pedido de veículo | Equipe da frota | informativo, ou **atenção** sem as 24 h |
| Pedido liberado, com a placa | Quem pediu | informativo |
| Pedido recusado, com o motivo | Quem pediu | atenção |
| Devolução **fora do prazo**, com o motivo escrito | Equipe da frota | atenção |
| Ocorrência **crítica** no checklist | Equipe da frota | **crítico** |
| Checklist com ocorrência de prioridade alta | Equipe da frota | atenção |
| Ocorrência atribuída a alguém | O responsável | conforme a prioridade |
| Preventiva concluída | Equipe da frota | informativo |

Duas regras que valem para todas:

**Ninguém é notificado da própria ação.** Receber aviso do que você mesmo
acabou de fazer é ruído, e ruído ensina a ignorar o sino.

**Devolução no prazo não avisa ninguém.** É o esperado, e avisar o esperado
enche a caixa de entrada do que não exige decisão. Só o atraso avisa.

> **Não confundir com a auditoria.** `eventos_auditoria` é o histórico de tudo
> que aconteceu, imutável, para prestar contas. A notificação é caixa de
> entrada: some do destaque quando a pessoa lê, e ninguém presta contas com
> base nela.

### 15.3 Regras da fila de ação

| Regra | Ação |
|---|---|
| Preventiva por data | Hoje ≥ vencimento → VENCIDA |
| Preventiva por KM | KM atual ≥ KM alvo → VENCIDA |
| Janela de alerta | Faltam N dias/km → MUITO PRÓXIMA |
| Ocorrência crítica | Bloqueia o veículo |
| Solicitação pendente | Aguardando aprovação da Frota |
| Devolução atrasada | Janela vencida com veículo em uso → alerta vermelho |
| Usuário pendente | Cadastro criado sem primeiro acesso |
| Checklist não realizado | Passou do horário limite e ninguém enviou |

**Para onde o clique leva, quem decide é o servidor.** Cada alerta viaja com um
`destino`, que é a chave da tela que resolve aquele alerta. O painel tinha um
mapa próprio por tipo, e ele não conhecia `checklist`: o aviso mais novo caía no
padrão e recarregava a mesma tela. Duas fontes de verdade para a mesma pergunta,
e a que a pessoa via era a errada.

### 15.4 O número do painel leva à lista dele

Cada selo de contagem — "3 bloqueados", "1 crítica", "2 pendentes" — abre a
lista **já filtrada** por aquele status. As telas de destino sempre souberam ler
o filtro; era o painel que nunca mandava, e quem clicava em "3 bloqueados"
recebia a frota inteira para procurar os três de novo.

O clique no selo não dispara o do card por baixo, que abriria a lista completa
por cima da filtrada. E o selo responde ao teclado: anunciar um botão que não
atende ao Enter é pior do que não anunciar botão nenhum.

---

## 16. Comparação antes × depois

O histórico do veículo permite comparar a condição anterior com a atual.

Com o checklist rodando em SAÍDA e RETORNO sobre o **mesmo modelo**, a
comparação deixa de ser um recurso extra e passa a ser consequência natural do
fluxo: a mesma pergunta tem duas fotos, tiradas com horas de diferença, pela
mesma pessoa, no mesmo veículo.

- última resposta do mesmo item visível na inspeção atual;
- indicação de "problema já existente" quando houver histórico correspondente;
- indicação de "possível problema novo" quando o item anterior estava conforme;
- foto de antes e depois anexáveis ao relatório.

---

## 17. Entidades separadas

Para evitar confusão de conceitos, o MyLog mantém entidades distintas:

| Objeto | Pergunta que responde |
|---|---|
| Ocorrência | O que deu errado? |
| Solicitação de veículo | Quem precisa de um carro, quando e por quê? |
| Ordem de serviço | Qual intervenção de manutenção foi executada? |
| **Categoria de uso** | Que tipo de carro esse trabalho exige? |
| **Tipo de veículo** | O que esse carro é? |

Uma ocorrência pode gerar uma ordem de serviço. Uma solicitação nunca vira
ocorrência: são fluxos diferentes que apenas compartilham o veículo.

**Categoria e tipo são o par que mais tenta se fundir, e não pode.** A
categoria é o que o colaborador precisa e sabe declarar; o tipo é o que o carro
é e o que decide o checklist. Fundir os dois obrigaria o colaborador a conhecer
a frota para pedir um carro, ou faria o checklist ser escolhido pelo pedido em
vez de pelo veículo que está na mão.

---

## 18. Estados e transições

| Objeto | Estados |
|---|---|
| Usuário | Pendente → Ativo → Bloqueado/Suspenso → Ativo ou Desativado |
| Inspeção | Em execução → Sincronizando → Finalizada |
| Execução esperada | No prazo · Atrasado · Não realizado — derivado do relógio, nunca gravado (37) |
| Ocorrência | Em aberto → Em tratamento → Resolvida → Encerrada |
| Solicitação | Pendente → Aprovada (já com placa) → Em uso → Devolvida / Devolvida com atraso; ou Recusada / Cancelada |
| Preventiva | Em dia → Próxima → Muito próxima → Vencida → Realizada |
| Veículo | Disponível → Com pendência → Bloqueado → Em manutenção → Disponível |

---

## 19. Offline e sincronização

O checklist precisa funcionar sem internet.

| Situação | Comportamento |
|---|---|
| Sem conexão | O checklist continua normalmente |
| Foto capturada | Arquivo vai para a fila local |
| Internet voltou | Sincronização retoma automaticamente |
| Upload parcial | O sistema registra progresso por arquivo |
| Reenvio da fila | **Idempotente**: devolve a inspeção existente em vez de duplicar |
| Falha de sincronização | Exibe o item pendente e permite nova tentativa |

A identificação de cada inspeção é gerada **no aparelho**, o que torna o reenvio
seguro mesmo quando a resposta do servidor se perdeu no caminho.

---

## 20. Segurança e isolamento por empresa

- Arquitetura multi-tenant: cada registro pertence a uma empresa.
- Autorização no servidor para toda operação sensível.
- Links de mídia privados ou temporários.
- Auditoria para mudança de credencial, cargo, prioridade, bloqueio e fechamento.
- Política de retenção de fotos e documentos configurável por empresa.
- Backup do banco e estratégia de recuperação **testada com restauração**, não apenas com cópia, antes do lançamento.

### Auditoria

A trilha de auditoria é **somente inserção**: nenhuma rota atualiza ou apaga
evento. Se um dia for preciso corrigir um registro, será migração revisada, não
funcionalidade de tela.

Os registros de checklist são prova em acidente e em processo trabalhista. É
isso que sustenta a regra.

---

## 21. Padrões de interface

Valem para todas as telas de lista:

1. **Sem botões soltos na linha.** Toda ação vai para um menu de três pontos na
   ponta direita. Botão visível em cada linha polui a leitura, e a tabela existe
   para ser lida antes de ser clicada.
2. **O filtro lista o que existe.** Se um estado pode acontecer, ele aparece no
   filtro.
3. **Placa, KM, CPF e horário em fonte monoespaçada.**
4. **Vermelho à esquerda, verde à direita** nos botões de decisão do checklist.
5. **Cor saturada é sinal, não decoração.** Verde, âmbar, laranja e vermelho são
   reservados a gravidade; o cromo é neutro e a cor de marca não encosta em
   nenhuma faixa de status.

---

## 22. MVP — o que precisa existir antes de substituir o PROLOG

| Pilar | Obrigatório no MVP |
|---|---|
| Identidade | Login, troca de senha no primeiro acesso, bloqueio, cargos |
| Veículos | Cadastro, placa, modelo, tipo, status e KM |
| Checklist | Modelos versionados por cargo e tipo de veículo, periodicidade e horário limite, execução com foto, saída e retorno, offline |
| Checklists feitos | Tela com filtro de período (padrão hoje) e por cargo, e exportação em planilha |
| Ocorrências | Prioridade, evidência, fluxo de tratamento, bloqueio por crítica |
| Solicitações | Pedido por categoria de uso, liberação com escolha da placa, veículo visível ao solicitante, retirada, devolução e atraso justificado |
| Preventivas | KM/data, próxima regra e alerta no painel |
| Painel | Frota, checklists, solicitações, ocorrências e preventivas |
| Relatórios | PDF completo e executivo |
| Auditoria | Histórico de eventos críticos e histórico por usuário |
| Storage | Fotos e documentos privados, vinculados ao domínio |

---

## 23. Fases de desenvolvimento

| Fase | Entrega | Situação |
|---|---|---|
| F0 — Descoberta | Mapear o PROLOG real em uso | **pendente — depende da empresa** |
| F1 — Fundação | Repo, banco, auth, tenant, auditoria | **feita** |
| F2 — Web ADM | Usuários, veículos, painel, editor de checklist | **feita** — reescrita na v3.0 |
| F3 — Aplicativo de campo | Login, checklist, evidências, offline | **feita** — reescrita na v3.0 |
| F4 — Regras | Prioridade, bloqueio, ocorrências | **feita** |
| F4.1 — v3.1 | Categoria de uso, checklist diário avulso, ritmo do modelo, checklists feitos e planilha | **feita** |
| F5 — Preventivas | Agenda por KM/data, reagendamento, alertas | **feita** |
| F6 — Relatórios | Dossiês de impressão, comparativo, frota | **feita** |
| F6.1 — v3.2 | Checklist de preventiva, dossie antes x depois, upload de imagem, notificacoes, cobranca de nao realizado | **feita** |
| F7 — Piloto | Rodar em paralelo com o PROLOG | pendente — depende da empresa |
| F8 — Migração | Migrar cadastros e histórico útil | pendente — depende da F0 |
| F9 — Substituição | Homologar e retirar o PROLOG | pendente |
| **A0 — Servidor no ar** | Firebase Hosting + Auth + Firestore + Functions + R2 | pendente — bloqueia a A1 |
| **A1 — App Android nativo** | Aplicativo em Android Studio, publicado na Play Store | pendente — contrato em `docs/API.md` |
| F10 — Evolução | OCR, detecção visual, analytics | futuro |

### A ordem entre a web, o servidor e o APK

A sequência não é preferência, é dependência. Cada etapa só existe depois da
anterior:

1. **Web 100% na máquina de desenvolvimento** — é onde estamos. O painel é o
   produto de administração e supervisão, e ele fecha sozinho: não depende de
   aplicativo nenhum.
2. **A0 — servidor no ar, com HTTPS e domínio.** Um app instalado num celular
   não enxerga `localhost`, e o Android bloqueia tráfego sem TLS por padrão.
   Sem esta etapa não existe teste de APK — existe emulador falando com a
   máquina do desenvolvedor, que não prova nada sobre rede de campo.
   A pilha está fechada em [`ARQUITETURA.md`](ARQUITETURA.md): Firebase
   Hosting, Authentication, Firestore, Cloud Functions e Cloudflare R2.
3. **A1 — o APK.** Escrito do zero em Android Studio, contra o contrato de
   [`docs/API.md`](API.md). O primeiro teste real é o que o servidor local
   nunca vai poder responder: se a foto sobe de dentro do galpão, com o sinal
   que existe lá.

**O storage é a peça mais solta da corrente.** Trocar disco local por R2 é a
implementação de três funções em `storage.js`, invisível para o aplicativo —
nada no contrato muda. Faz parte da A0 por decisão de arquitetura, mas é a
única parte dela que poderia acontecer antes ou depois sem quebrar nada.

### Sobre o aplicativo Android

Será escrito **do zero, em Android Studio**, original — não é o PWA
empacotado, e nenhuma linha dele é reaproveitada. O PWA continua existindo e
funcionando como cliente de campo até o APK sair; o nativo é outro cliente do
mesmo servidor.

O PWA serve ao Android de **implementação de referência**: não código a copiar,
mas uma resposta que funciona para o que o nativo terá que resolver — o que o
servidor espera em cada envio, como a dependência foto→inspeção é respeitada, e
o que a tela mostra quando o servidor recusa.

A **API é o contrato entre os dois**, e está documentada em
[`docs/API.md`](API.md): as quatro rotas que fecham o ciclo de checklist, a
distinção entre solicitação, preventiva e avulso, a idempotência que faz o
offline funcionar, e o formato de cada erro.

Duas coisas que o servidor **ainda não tem** e que o app nativo vai pedir:

- **Push.** O servidor não conhece aparelho nenhum. Notificação fora do app
  exige FCM no cliente e um registro de *device token* no servidor.
- **Hospedagem com HTTPS.** Hoje o MyLog roda em `localhost`. Um app instalado
  num celular precisa de um endereço que exista fora da máquina.

Da F1 à F6 o software está escrito e coberto por testes. O que separa o MyLog
do piloto não é mais código: é a F0 — sentar com quem usa o PROLOG hoje e
descobrir o que ele realmente faz. Codificar antes disso seria inventar
requisito.

### O que a v3.0 obrigou a revisar — e já foi revisto

| Área | Ação | Situação |
|---|---|---|
| Vínculos usuário-veículo | **remover** — tabela, rotas, tela e testes | feito |
| Papéis de acesso | **substituir** os cinco por Frota/Colaborador | feito |
| Tickets | **reescrever** como Solicitação de veículo | feito |
| Motor de checklist | **simplificar** — sai tipo de resposta e condicional; entra foto de exibição, opções de problema e execução em duas passagens | feito |
| Usuários | **acrescentar** CPF, telefone, cargo, senha gerada, histórico completo | feito |
| Listas | **trocar** botões por menu de três pontos | feito |
| Preventivas, auditoria, design system | mantidos | — |

### Regras de estado do veículo que a implementação fixou

Três consequências da seção 12.2 que só aparecem quando o sistema roda por
semanas, e que o código passou a garantir:

1. **Prioridade baixa não para o carro.** Um risco de pintura entra na fila e
   o veículo segue disponível. Se toda ocorrência tirasse o carro de
   circulação, em um mês a frota inteira estaria "com pendência" e ninguém
   olharia mais para o status.
2. **Checklist só aperta, nunca afrouxa.** Uma inspeção pode piorar o estado
   de um veículo, jamais melhorá-lo. Sem isso, um retorno com problema médio
   rebaixaria para "com pendência" um carro bloqueado por falha crítica —
   liberando pela porta dos fundos o que só a Frota libera, com motivo.
3. **Pendência sai sozinha; bloqueio não.** Fechada a última ocorrência aberta
   do veículo, ele volta a disponível automaticamente, porque a pendência era
   consequência dela. Bloqueio e manutenção continuam saindo apenas por
   decisão explícita da Frota, com motivo e registro em auditoria (9.3).

---

## 24. F0 — Descoberta do PROLOG em uso

Antes de codificar fluxos específicos, o primeiro trabalho prático é a
engenharia reversa do ambiente real. O objetivo é descobrir tudo o que o PROLOG
faz hoje e classificar cada item como *obrigatório*, *melhorável*,
*desnecessário* ou *novo no MyLog*.

| Levantamento | Perguntas |
|---|---|
| Usuários | Quem entra? Quem aprova? Quais cargos existem? |
| Veículos | Quais campos existem? Há implementos? |
| Checklists | Quais modelos? Qual frequência? Quais perguntas críticas? |
| Relatórios | Quais PDFs são realmente utilizados? |
| Ocorrências | Como a empresa trata problemas hoje? |
| Solicitações | Como se pede um carro hoje? Quem autoriza? |
| Preventivas | Como calculam vencimento? Quem recebe alerta? |
| Exceções | O que acontece quando o veículo quebra ou sai da frota? |
| Integrações | Existem ERP, email, WhatsApp, BI ou APIs envolvidas? |

### 24.1 O que a primeira evidência real já respondeu

Em 04/09/2026 entrou o primeiro dado de verdade: a exportação de *resumo de
checklist* do PROLOG, em três janelas — dia, semana e mês. O recorte mensal
cobre **05/08 a 04/09/2026, com 917 execuções**.

| | |
|---|---|
| Volume | ~40 checklists por dia útil |
| Frota | 42 placas distintas |
| Pessoas | 51 colaboradores |
| Unidade | Ibiúna (uma só em todo o período) |
| Momento | Saída 863 · Retorno 54 |
| Tempo de execução | mediana 158 s · mínimo 19 s · máximo 44 min |
| Observação escrita | 46 de 917 execuções (5%) |

**Modelos em uso:** Padrão diário (797) · Ocorrência (51) · Semanal
Calibragem/Limpeza/Itens (38) · Padrão Moto (31).

**Tipos de veículo:** Compacto leve (783) · Pick-up (91) · Motocicleta (34) ·
4x4 (9). Caminhão não aparece no mês.

**Cargos (12):** Técnico de Campo (603), Técnico de Redes (146), Vendedor (56),
Técnico Multskill (42), Gestor de Frota (33), Líder de operações, Supervisor
Redes, Supervisor Técnico, Auxiliar de Logística, Supervisor de Marketing,
Supervisor de Sucesso do Cliente, Fiscal Técnico.

#### O que a planilha confirmou do desenho atual

- **Não existe terceiro desfecho.** `Itens não se aplica` é sempre
  `total − problemas`, nas 917 linhas. OK e Ocorrência bastam.
- **Não existe condutor fixo.** A placa TIO7A14 aparece no mesmo dia, com o
  mesmo KM, para dois colaboradores diferentes. Remover o vínculo
  usuário-veículo estava certo.
- **A prioridade da ocorrência é do modelo, não digitada.** As colunas de
  baixa/alta/crítica saem contadas, sem campo livre.

#### O que a planilha obrigou a mudar

- **Retorno não é universal** — 6% de retorno virou a distinção entre checklist
  diário avulso e checklist de solicitação (8.2, 11.5).
- **Periodicidade existe** — há modelo semanal em produção (11.2.1).
- **Existe um horário de fato** — 74% das saídas entre 07h e 08h (11.2.2).
- **Sábado e domingo não são dias de rotina** — 62 e 13 execuções contra ~170
  nos dias úteis; obrigatoriedade tem que ser por dia da semana.

#### O que continua faltando da F0

Este relatório é o **resumo** — uma linha por execução. Falta o **detalhe**:
resposta pergunta a pergunta, com as fotos. Sem ele não dá para desenhar a
migração do histórico (F8) nem conferir as 13 perguntas do Padrão diário.

Também falta: o cadastro de veículos completo, o cadastro de usuários, os
modelos de checklist exportados, e como a empresa trata hoje uma ocorrência da
abertura ao fechamento.

---

## 25. Critérios de aceite do MVP

| Critério | Aceito quando |
|---|---|
| Login | Usuário não autorizado não consegue entrar |
| Primeiro acesso | A troca de senha é obrigatória e só depois o usuário fica Ativo |
| Checklist | É possível completar sem internet e sincronizar depois |
| Evidência | Cada foto abre no relatório associada à pergunta, veículo e inspeção |
| Prioridade | Uma ocorrência crítica bloqueia o veículo |
| Liberação | Só a Frota libera veículo bloqueado, e o motivo fica registrado |
| Solicitação | O colaborador pede carro com janela e motivo; a Frota aprova; a retirada exige checklist de saída |
| Atraso | Devolução fora do prazo exige motivo escrito antes de encerrar |
| Saída e retorno | O mesmo modelo roda duas vezes e as respostas são comparáveis |
| Cargo | Checklist não liberado para o cargo não aparece no aplicativo |
| Preventiva | Ao concluir, é obrigatório escolher a próxima por KM ou data |
| Auditoria | Alterações críticas deixam rastro de quem, quando e o que mudou |
| Histórico | O histórico do usuário mostra tudo que ele fez, com data e hora |
| Multi-tenant | Uma empresa jamais acessa dados de outra |

---

## 26. QA e testes

| Área | Testes mínimos |
|---|---|
| Auth | Primeiro acesso, troca de senha, bloqueio, sessão expirada, revogação |
| Permissões | Frota e Colaborador |
| Cargo | Checklist visível e invisível conforme o cargo |
| Checklist | Foto obrigatória, opcional e ausente; limite de fotos; navegação entre respondidas; saída e retorno |
| Offline | Modo avião, queda durante upload, retomada, duplicidade |
| Mídia | Compressão, upload, acesso privado, relatório |
| Ocorrência | Prioridade, bloqueio por crítica, liberação com motivo |
| Solicitação | Janela, aprovação, retirada, devolução no prazo e com atraso |
| Preventiva | KM, data, vencida, reagendamento, troca de método |
| Relatórios | Fotos, paginação, PDFs grandes |
| Auditoria | Eventos aparecem e não são apagados |
| **Isolamento** | **Leitura, escrita, lista, exportação e caixa de entrada, com identificador de outra empresa** |
| Relógio | O dia da operação não muda com o fuso do servidor |
| Upload | O tipo sai dos bytes; rótulo errado é corrigido, não-imagem é recusada |
| Transação | Tudo ou nada, e a trava tomada na abertura |
| Freio | Conta, troca de senha, e varredura por IP sem punir o escritório |
| Cabeçalhos | CSP em toda resposta, nenhum script embutido, câmera preservada |
| Painel | O alerta vai ao destino do servidor; o selo abre a lista filtrada |
| Vocabulário | Todo status do domínio tem rótulo e tom na tela |
| **Contrato** | **Forma:** rota, corpo de envio e código de erro conferidos contra o servidor.
  **Significado:** o resultado que o app manda é ignorado, `momento` só aceita dois valores,
  o resumo tem os campos que a tela final lê |
| Modelos | A seção de preventiva cria modelo de preventiva; a padrão, padrão |
| Relógio do aparelho | A hora é a do pátio; fora da janela, cai para o recebimento e audita |
| Fila offline | Reenvia sozinha com espera crescente, e para quando esvazia |
| Performance | Painel com volume e sincronização concorrente |

### Onde a cobertura começa e onde termina

São 258 testes em três camadas:

| Camada | Arquivo | O que prova |
|---|---|---|
| Motor | `template.teste.js`, `dominio.teste.js` | O julgamento do checklist, offline e no servidor |
| API | `api.teste.js`, `relatorios.teste.js` | O servidor HTTP real, ponta a ponta |
| Tela | `interface.teste.js`, `campo.teste.js` sobre `dom.js` | O que a interface faz com a resposta |

A camada de tela existe por um motivo concreto:

> O teste `cadastro: usuario nasce pendente com senha gerada pelo sistema`
> provava que `POST /api/usuarios` devolve uma senha inicial e que ela
> autentica de verdade. Passava. Mas na tela, `abrirModal` limpava a área de
> modais depois do `aoConfirmar` — apagando a janela que acabara de exibir
> essa senha. Todo usuário criado pelo painel nascia com uma senha que
> ninguém jamais veria, e o cadastro era inutilizável. Suíte verde,
> funcionalidade morta.

`servidor/testes/dom.js` é um DOM mínimo escrito à mão — sem dependência, sem
afrouxar a D1. Não é um navegador: não tem layout, não tem CSS, não calcula
visibilidade. Implementa o que `web/js/ui.js` chama, e nada além.

**Painel** (`interface.teste.js`): montagem do modal, encadeamento de telas,
erro do servidor sem perder o que foi digitado, campo condicional que não vaza
valor, menu de três pontos com um aberto por vez, e o escape de texto do banco.

**App de campo** (`campo.teste.js`): o hodômetro antes da primeira pergunta,
OCORRÊNCIA à esquerda e OK à direita, a seta que só anda até onde foi
respondido, voltar sem perder resposta, uma folha por vez, a prioridade que
vem da opção configurada, o aviso de bloqueio (e a ausência dele quando a
prioridade é baixa), e o botão final que nomeia a pendência.

### Isolamento entre empresas

O critério não é a tela esconder o recurso — é a **API recusar**. Os testes de
isolamento chamam a rota direto, com identificador da outra empresa, e o
atacante é a **Frota B**: administradora plena da própria empresa, ou seja,
alguém com todas as capacidades no seu tenant e nenhuma no alheio.

Cinco frentes: leitura de veículo, usuário, ocorrência, inspeção, evidência,
modelo e relatório; escrita — bloquear carro, tratar e atribuir ocorrência,
editar e versionar modelo, renomear pessoa, gerar senha; as nove listas, linha
por linha; a **exportação em planilha**, que é o caminho mais fácil de
esquecer porque não passa pela tela; e a caixa de entrada, incluindo o "marcar
todas como lidas".

A resposta correta é **404 e não 403**: 403 confirmaria que o identificador
existe, e "esse veículo existe em alguma empresa" já é informação. E não basta
a resposta ser 404 — o teste relê o banco depois, porque uma rota pode recusar
e mesmo assim ter gravado.

Conferidos contra três furos abertos de propósito: consulta de veículo sem
filtro de empresa, "marcar todas" sem destinatário e consulta de execuções sem
tenant. Cada furo derrubou exatamente os testes que deveria, e nenhum outro.

Todo teste que diz cobrir um defeito foi conferido contra ele: o código antigo
é reintroduzido, o teste fica vermelho, o código novo devolve o verde. Um
teste que nunca viu o bug que alega cobrir não prova nada — e foi assim que
`campo.teste.js` revelou que a primeira versão do teste de folha empilhada
exercitava o caminho errado e passaria de qualquer jeito.

**O que continua sem cobertura automatizada:**

- captura de foto e assinatura — IndexedDB, câmera e canvas de verdade;
- qualquer coisa que dependa de geometria (o menu que abre para cima perto do
  rodapé) — sem layout, `getBoundingClientRect` devolve zeros;
- CSS: contraste, tema claro/escuro, quebra de página na impressão;
- **o service worker**, e com ele todo o modo offline do app de campo;
- **o histórico do navegador** — `pushState`, `popstate`, o botão Voltar. Fazer
  o DOM de teste fingir ser um navegador só para isso contradiria a D35, que
  existe justamente para o arcabouço parar onde a interface para.

> Sobre o service worker: o navegador embutido usado nos testes recusa
> qualquer registro — um SW de uma linha falha com a mesma mensagem que o
> nosso. Foi conferido que os 11 arquivos da casca respondem 200 (o que
> importa, porque `cache.addAll` é atômico: um único 404 derruba a instalação
> inteira). Mas **o offline precisa ser testado num navegador de verdade,
> com o modo avião ligado**, antes do piloto. Nada aqui prova que ele
> funciona.

Para esses três, **o passe manual no navegador continua obrigatório** a cada
mudança:

1. criar usuário → ler a senha inicial → entrar com ela → trocar a senha;
2. solicitar veículo → aprovar → checklist de saída → devolução → retorno;
3. tratar uma ocorrência até `encerrada` e conferir o estado do veículo;
4. abrir os três relatórios;
5. navegar por três telas, apertar **Voltar** duas vezes e confirmar que cada
   uma reaparece — e que um modal aberto fecha junto, em vez de ficar boiando
   sobre outro assunto.

---

## 27. Relatórios

| Relatório | Conteúdo |
|---|---|
| Checklist completo | Todas as perguntas, respostas, evidências, usuário, veículo, momento e horário |
| Comparativo saída × retorno | As duas passagens lado a lado, pergunta a pergunta |
| Executivo | Resumo do resultado e principais problemas |
| Dossiê de evidências | Fotos, contexto, assinaturas e histórico |
| Preventivas | Realizadas, próximas, vencidas e histórico por veículo |
| Solicitações | Pedidos, aprovações, devoluções e atrasos |
| Frota | Status, ocorrências e indicadores |
| Auditoria | Alterações críticas de cadastro e operação |
| Histórico do usuário | Tudo que um colaborador fez, com data e hora |
| **Dossiê de preventiva** | Antes × depois de cada peça, com foto dos dois lados — ver 27.1 |
| **Resumo de checklists (planilha)** | Uma linha por execução, no leiaute do PROLOG — ver 11.10 |

Todos os relatórios acima são **HTML pronto para imprimir**, abertos pelo
navegador (decisão D28). O resumo de checklists é a exceção: sai como **CSV**,
porque não é para ler, é para filtrar e somar em planilha.

### 27.1 Dossiê de preventiva

O documento que prova o serviço. Estruturado a partir do PDF que a operação já
lê hoje no PROLOG, com uma diferença: **as fotos vêm em duas colunas, antes e
depois**.

O que cada bloco traz:

| Bloco | Conteúdo |
|---|---|
| Cabeçalho | Nome do modelo · momento · **número do checklist** · colaborador |
| Veículo | Placa, marca e modelo, tipo, odômetro no início e no fim |
| Responsável | Nome, **CPF mascarado**, data de envio, duração da execução |
| Contagens | Ocorrências por prioridade, conformes, perguntas respondidas |
| Preventiva | Alvo que venceu, o que foi executado, **alvo da próxima** |
| Pergunta a pergunta | Numeradas 01, 02, 03… com a coluna ANTES e a coluna DEPOIS |
| Assinatura | Traçado digital de quem executou |
| Rodapé | Quem gerou, quando, e a paginação |

Cada pergunta ocupa um bloco que não se parte entre páginas:

```
  03   Pinça de freio

  ┌────────────────────────┬────────────────────────┐
  │  ANTES — saída         │  DEPOIS — retorno      │
  ├────────────────────────┼────────────────────────┤
  │  [foto]  [foto]        │  [foto]                │
  │                        │                        │
  │  Ocorrência: desgaste  │  Manutenção: SIM       │
  │  PRIORIDADE ALTA       │                        │
  │                        │  "Pastilha e disco     │
  │  "Pastilha no limite,  │   trocados, pinça      │
  │   pinça com folga."    │   revisada."           │
  └────────────────────────┴────────────────────────┘
```

Duas escolhas herdadas do PROLOG, porque estão certas:

- **CPF mascarado** (`559.***.***-04`). O documento circula: vai para a
  oficina, para o seguro, para o cliente. O CPF inteiro num papel que anda não
  serve a ninguém — os quatro dígitos bastam para conferir quem é.
- **Rodapé em toda página**, com quem gerou, quando, e "página X de Y". Um
  documento impresso se separa; a página solta precisa dizer de onde veio.

O arquivo final é PDF, gerado pelo **botão de impressão do navegador** — o
mesmo caminho dos outros relatórios (decisão D28). Não há biblioteca de PDF no
servidor, e não há dependência a instalar.

---

## 28. Métricas do produto

| Indicador | Objetivo |
|---|---|
| % checklists concluídos sem ajuda | Medir simplicidade do aplicativo |
| Tempo médio de checklist | Reduzir atrito sem comprometer qualidade |
| % inspeções com evidência quando exigida | Medir conformidade |
| Tempo médio de resolução de ocorrência | Medir eficiência operacional |
| % preventivas realizadas no prazo | Medir disciplina de manutenção |
| % devoluções no prazo | Medir aderência ao processo de solicitação |
| Falhas recorrentes por veículo | Identificar problemas sistêmicos |
| Taxa de sincronização sem intervenção | Medir qualidade do offline |

---

## 29. Roadmap de evolução

| Etapa | Funcionalidades futuras |
|---|---|
| V1.1 | Mais relatórios, filtros, exportações, melhorias de UX |
| V1.2 | QR Code do veículo, comparador visual antes/depois |
| V1.3 | Notificação externa de solicitação e devolução atrasada |
| V2 | IA assistiva para classificação de evidências e resumo operacional |
| V2+ | Detecção visual assistida, analytics preditivo e integrações |

---

## 30. O que NÃO fazer

- Não construir telemetria ou rastreamento 24h como parte do núcleo.
- Não colocar IA antes de haver dados confiáveis e processo estável.
- Não transformar cada funcionalidade em configuração infinita.
- Não permitir que histórico operacional seja apagado.
- Não armazenar imagem dentro de tabela do banco.
- Não permitir que o aplicativo altere cadastro mestre de veículo.
- Não fazer bloqueio automático sem regra clara e auditável.
- Não duplicar em software um controle que já existe no mundo físico.

---

## 31. Definição de sucesso

> **O MyLog substitui o PROLOG quando** a equipe consegue executar as mesmas
> operações críticas ou melhores; a Frota controla usuários, cargos e veículos
> pela web; colaboradores solicitam carro e executam checklist de saída e
> retorno pelo aplicativo, mesmo sem internet; ocorrências têm rastreabilidade;
> preventivas geram alertas; evidências chegam aos relatórios; e o histórico é
> confiável o bastante para ser usado como registro operacional e como prova.

---

## 32. Decisões técnicas

| Decisão | Escolha |
|---|---|
| Frontend web | Vanilla JS com design system próprio, sem framework |
| Aplicativo de campo | PWA instalável, offline-first |
| Backend | Node sem dependências externas; API stateless com regras centralizadas |
| Banco | PostgreSQL em produção; SQLite portável em desenvolvimento |
| Auth | Token opaco revogável; o banco guarda apenas o HMAC |
| Storage | S3-compatible; Cloudflare R2 como opção |
| PDF | Geração assíncrona; impressão do próprio painel como caminho inicial |
| Observabilidade | Logs estruturados, métricas e alertas |
| Versionamento | Modelos de checklist e alterações críticas com histórico |

O detalhamento de cada escolha, com o motivo e o custo aceito, está em
`docs/DECISOES.md`. A identidade visual e as regras de interface estão em
`docs/DESIGN.md`.

---

## 33. Apêndice — estrutura lógica do veículo

| Campo | Descrição |
|---|---|
| vehicle_id | Identificador interno |
| tenant_id | Empresa proprietária |
| plate | Placa — imutável |
| brand, model, year | Marca, modelo, ano |
| type | Compacto leve, pick-up, 4x4, motocicleta, caminhão |
| current_km | Quilometragem atual |
| status | Disponível, com pendência, bloqueado, em manutenção |
| status_reason | Motivo do status atual |
| created_at / updated_at | Controle temporal |

> Sai o campo `assigned_user_id` da v2.0.

---

## 34. Apêndice — estrutura lógica do usuário

| Campo | Descrição |
|---|---|
| user_id | Identificador |
| tenant_id | Empresa |
| full_name | Nome completo |
| cpf | CPF |
| email | Email — identificador de login |
| phone | Telefone |
| role_id | Cargo |
| panel_access | Acessa o painel: Frota (sim) ou Colaborador (não) |
| daily_vehicle | Usa veículo todos os dias — separa checklist diário de solicitação (8.2) |
| status | Pendente, ativo, bloqueado, suspenso, desativado |
| must_change_password | Verdadeiro até a primeira troca |
| created_at / updated_at | Controle temporal |

---

## 35. Apêndice — estrutura lógica da solicitação

| Campo | Descrição |
|---|---|
| request_id | Número da solicitação |
| requester_id | Quem pediu |
| category_id | **Categoria de uso pedida** — o que o colaborador escolhe (10.3) |
| vehicle_id | Veículo entregue — **nulo até a aprovação**; quem preenche é a Frota |
| window_start / window_end | Janela de horário pedida |
| reason | Motivo do pedido |
| status | Pendente, aprovada, recusada, em uso, devolvida, devolvida com atraso, cancelada |
| approved_by / approved_at | Quem escolheu o carro e liberou, e quando |
| category_override_reason | Preenchido quando a Frota entrega carro de outra categoria |
| checkout_inspection_id | Inspeção de saída |
| checkin_inspection_id | Inspeção de retorno |
| returned_at | Devolução efetiva |
| late_reason | Motivo escrito quando houve atraso |

---

## 36. Apêndice — estrutura lógica da categoria de uso

Cadastrável pela Frota. Descreve necessidade de transporte, não o carro.

| Campo | Descrição |
|---|---|
| category_id | Identificador |
| tenant_id | Empresa |
| name | Ex.: "4 assentos — utilitário" |
| seats | Número de assentos, para ordenar e filtrar |
| body | Carroceria: `compacto` ou `utilitario` |
| active | Categoria fora de uso some do formulário sem apagar histórico |

## 37. Apêndice — periodicidade do modelo de checklist

| Campo | Descrição |
|---|---|
| periodicity | `avulso` · `diario` · `semanal` · `mensal` |
| weekdays | Dias obrigatórios, quando diário — sete posições |
| week_day | Dia de vencimento, quando semanal |
| deadline_time | Horário limite, ou nulo quando não há |

Estado derivado de cada execução esperada, nunca gravado como verdade fixa:
**no prazo** · **atrasado** · **não realizado**. É recalculado a partir do
relógio, como a preventiva — gravar "atrasado" produziria um registro que mente
assim que o horário limite do modelo mudar.

---

## 38. Apêndice — estrutura lógica da preventiva

| Campo | Descrição |
|---|---|
| preventive_id | Identificador |
| vehicle_id | Veículo |
| mode | KM ou DATA |
| last_service_km / last_service_date | Última execução |
| next_target_km / next_target_date | Próximo alvo |
| alert_before_km / alert_before_days | Antecedência de alerta |
| status | Em dia, próxima, muito próxima, vencida, realizada |
| completed_by / completed_at | Responsável e data |
| notes | Serviço executado |

---

## 39. Em aberto

Pontos que ainda dependem de decisão da operação:

1. **Antecedência de 24 h** — é trava rígida, com o sistema recusando pedido
   feito com menos de 24 h, ou orientação, aceitando e marcando como urgente?
   *Implementado hoje como orientação; inverter é um booleano.*
2. **Conflito de janela** — dois pedidos para a mesma **categoria** com
   horários sobrepostos e só um carro livre: o sistema segura o segundo ou
   deixa a Frota decidir na hora de escolher a placa?
3. **Login por CPF** — hoje é por email. Digitar email de luva, em pátio, sob
   sol, é pior que digitar CPF. Vale trocar?
4. **Notificação fora do painel.** O sino já existe (15.1) e cobre quem está
   com o MyLog aberto. Falta decidir se pedido novo e ocorrência crítica
   também disparam **e-mail ou WhatsApp** — e para quem, já que o sino hoje
   avisa a equipe da frota inteira.
5. **Exportação do histórico do PROLOG** — bloqueia a F8. O resumo já chegou
   (24.1); falta o detalhe pergunta a pergunta, com fotos.
6. **Horário limite de cada modelo** — os dados mostram o pico às 07h–08h, mas
   o horário oficial é decisão da operação, não da estatística.
7. **Categorias de uso** — as quatro definidas em 10.3 ("4 assentos
   compacto", "2 assentos compacto", "4 assentos utilitário", "2 assentos
   utilitário") cobrem a frota inteira? Falta decidir se **moto e caminhão**
   entram como categoria pedível — hoje não entram, e quem precisa de um
   fala com a Frota.
8. **O filtro de período "igual ao do Fibra nos relatórios de O.S."** — desenhei
   como *de… até…* mais navegação por mês e atalhos (11.9). Se a tela do Fibra
   tem algo além disso, um print resolve.

### Respondidos em 04/09/2026

- ~~**Retirada sem solicitação**~~ — sim, e é a maioria. Virou o checklist
  diário avulso, separado pelo campo "usa veículo todos os dias" (8.2).
- ~~**Equipe como classificação**~~ — não entra. O filtro agrupa por Cargo; a
  coluna Equipe da exportação sai vazia (11.10).
- ~~**Unidade**~~ — ignorada por ora. Uma só em todo o período observado.
- ~~**Categoria × tipo de veículo**~~ — não se convertem. Categoria é
  necessidade de uso; tipo é propriedade do carro e é ele que decide o
  checklist (10.3).
