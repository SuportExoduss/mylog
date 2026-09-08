// Aplicativo de campo do MyLog (roadmap 2 e 10).
//
// O colaborador abre isto no patio, muitas vezes sem sinal. O caminho e' curto
// de proposito: entrar -> ver o que tem para fazer -> executar -> devolver.
import * as envio from './envio.js'
import { CHAVES, tokensEfetivos } from '../../compartilhado/marca.js'
import { elemento, executarChecklist } from './checklist.js'

const raiz = document.getElementById('app')

const estado = {
  usuario: null,
  tarefas: [],
  avulso: [],
  preventivas: [],
  modelos: [],
  politicas: {},
  marca: null,
}

const modeloPorId = (id) => estado.modelos.find((m) => m.id === id)

// ------------------------------------------------------------- marca

// Co-branding no patio tambem (roadmap 7). A marca chega DENTRO do contexto,
// que tem dono: nao existe instante em que o aplicativo mostra a marca de uma
// empresa e as tarefas de outra.
//
// Por folha de estilo, e nao por estilo em linha, pelo mesmo motivo do painel:
// os tokens sao POR TEMA, e estilo em linha nao tem tema — a cor do claro
// ficaria por cima do escuro na primeira troca. A folha espelha a cascata que
// o `estilo.css` ja usa, e o navegador resolve.
function pintarMarca(marca) {
  let folha = document.getElementById('marca-da-empresa')
  if (!folha) {
    folha = document.createElement('style')
    folha.id = 'marca-da-empresa'
    document.head.append(folha)
  }
  const bloco = (tema) => {
    const t = tokensEfetivos(marca?.tokens?.[tema], tema)
    return CHAVES.map((c) => `--${c}:${t[c]};`).join('')
  }
  folha.textContent = [
    `:root{${bloco('claro')}}`,
    `@media (prefers-color-scheme: dark){:root:not([data-tema="claro"]){${bloco('escuro')}}}`,
    `:root[data-tema="escuro"]{${bloco('escuro')}}`,
    `:root[data-tema="claro"]{${bloco('claro')}}`,
  ].join('\n')
}

// A marca da empresa AO LADO da do MyLog, nunca no lugar dela. Nao ha
// parametro para esconder o MyLog — a ausencia do caminho e' a garantia.
function marcaDaEmpresa() {
  const m = estado.marca
  if (!m?.logo_url && !m?.nome_exibicao) return null
  return elemento('div', { classe: 'login-empresa' }, [
    m.logo_url
      ? elemento('img', { classe: 'login-empresa-logo', src: m.logo_url,
          // O nome no `alt`: uma logo que nao carrega nao pode deixar a tela
          // sem dizer de quem e' o aplicativo.
          alt: m.nome_exibicao || 'Logo da empresa' })
      : null,
    m.nome_exibicao
      ? elemento('div', { classe: 'login-empresa-nome', texto: m.nome_exibicao })
      : null,
  ])
}

// ------------------------------------------------------------- estrutura

function tela({ titulo, subtitulo, voltar, corpo, acoes = [] }) {
  // `.filter(Boolean)` obrigatorio: `replaceChildren` do navegador converte
  // `null` em texto e escreve a palavra "null" na tela. Duas das quatro linhas
  // abaixo sao condicionais — a tira de conexao (que so existe sem rede) e o
  // rodape (que so existe com acoes).
  //
  // Quem filtra nulo por dentro e' o `elemento()`; `replaceChildren` e'
  // navegador cru, e nao filtra nada.
  raiz.replaceChildren(...[
    elemento('header', { classe: 'topo' }, [
      voltar
        ? elemento('button', { classe: 'topo-voltar', type: 'button', texto: '←',
            'aria-label': 'Voltar', aoClick: voltar })
        : null,
      elemento('div', {}, [
        elemento('h1', { classe: 'topo-titulo', texto: titulo }),
        subtitulo ? elemento('p', { classe: 'topo-sub', texto: subtitulo }) : null,
      ]),
    ]),
    tiraConexao(),
    elemento('main', { classe: 'corpo' }, corpo),
    acoes.length ? elemento('footer', { classe: 'rodape' }, acoes) : null,
  ].filter(Boolean))
}

// A tira de conexao continua, com outro trabalho.
//
// Na era da fila ela contava o que ainda nao tinha subido — "3 checklists
// aguardando conexao". Sem fila nao ha nada esperando: o checklist sobe no
// momento em que e' finalizado, ou nao e' finalizado. O que a tira faz agora
// e' AVISAR ANTES, para ninguem comecar quarenta perguntas sem sinal e
// descobrir no fim.
function tiraConexao() {
  if (navigator.onLine) return null
  return elemento('div', {
    classe: 'tira',
    // Aparece sozinha, sem ninguem ter tocado em nada: `status` e' o que faz
    // um leitor de tela anunciar isso sem interromper o que esta sendo lido.
    role: 'status',
    texto: 'Sem conexao. Nao da para enviar checklist agora.',
  })
}

function aviso(mensagem, tom = 'erro') {
  return elemento('div', { classe: `aviso aviso--${tom}`, texto: mensagem })
}

// ------------------------------------------------------------------ login

// `depois` e' o que acontece quando o login der certo. O padrao — ir para a
// tela inicial — vale para quem esta abrindo o aplicativo.
//
// Existe um caso em que ir para o inicio PERDE trabalho: a sessao venceu no
// meio do envio, o checklist inteiro esta na mao da tela de falha, e a propria
// tela promete "entre de novo e o checklist sera enviado na mesma hora". Sem
// isto a promessa era falsa: o login levava ao inicio e a inspecao morria com
// a tela. Um checklist de quarenta perguntas, com fotos, feito no patio.
function telaLogin(mensagem, depois = carregar) {
  const email = elemento('input', { type: 'email', autocomplete: 'username',
    inputmode: 'email', placeholder: 'seu@email', required: true })
  const senha = elemento('input', { type: 'password', autocomplete: 'current-password',
    placeholder: 'sua senha', required: true })
  const erro = elemento('div', { classe: 'aviso aviso--erro oculto' })
  const botao = elemento('button', { classe: 'botao botao--grande botao--ok',
    type: 'submit', texto: 'Entrar' })

  if (mensagem) { erro.textContent = mensagem; erro.classList.remove('oculto') }

  raiz.replaceChildren(elemento('div', { classe: 'login' }, [
    elemento('form', {
      classe: 'login-caixa',
      aoSubmit: async (evento) => {
        evento.preventDefault()
        erro.classList.add('oculto')
        botao.disabled = true
        botao.textContent = 'Entrando...'
        try {
          const resposta = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ email: email.value.trim(), senha: senha.value, origem: 'app' }),
          })
          const dados = await resposta.json().catch(() => ({}))
          if (!resposta.ok) throw new Error(dados.mensagem || 'Nao foi possivel entrar.')
          estado.usuario = dados.usuario
          if (dados.marca) { estado.marca = dados.marca; pintarMarca(dados.marca) }
          if (dados.usuario.deve_trocar_senha) return telaTrocaDeSenha()
          await depois()
        } catch (falha) {
          erro.textContent = falha.message
          erro.classList.remove('oculto')
        } finally {
          botao.disabled = false
          botao.textContent = 'Entrar'
        }
      },
    }, [
      marcaDaEmpresa(),
      elemento('div', { classe: 'login-marca', texto: 'MyLog' }),
      elemento('p', { classe: 'login-sub', texto: 'Checklist de frota' }),
      erro,
      elemento('label', { classe: 'campo' }, [elemento('span', { texto: 'Email' }), email]),
      elemento('label', { classe: 'campo' }, [elemento('span', { texto: 'Senha' }), senha]),
      botao,
    ]),
  ]))
}

// Roadmap 8.1: no primeiro acesso a troca de senha vem antes de qualquer outra
// tela, e nao ha como pula-la. Mas "nao pular" nao e' "nao sair".
//
// Esta tela nao tinha saida nenhuma, e a falta sobrevivia ao recarregamento: a
// sessao ja existe, entao `iniciar` le `deve_trocar_senha` e volta para ca.
// Quem entrasse na conta errada — ou nao soubesse a senha recebida — prendia o
// aparelho ate o cookie vencer, doze horas depois. No patio o aparelho e'
// compartilhado, e a proxima pessoa ficava sem aplicativo pelo resto do dia.
//
// Sair sempre pode. Nao pula a troca: encerra a sessao.
function telaTrocaDeSenha() {
  const atual = elemento('input', { type: 'password', autocomplete: 'current-password', required: true })
  const nova = elemento('input', { type: 'password', autocomplete: 'new-password', required: true })
  const erro = elemento('div', { classe: 'aviso aviso--erro oculto' })

  raiz.replaceChildren(elemento('div', { classe: 'login' }, [
    elemento('form', {
      classe: 'login-caixa',
      aoSubmit: async (evento) => {
        evento.preventDefault()
        erro.classList.add('oculto')
        try {
          const resposta = await fetch('/api/auth/senha', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ senha_atual: atual.value, senha_nova: nova.value }),
          })
          const dados = await resposta.json().catch(() => ({}))
          if (!resposta.ok) throw new Error(dados.mensagem || 'Nao foi possivel trocar a senha.')
          estado.usuario = dados.usuario
          await carregar()
        } catch (falha) {
          erro.textContent = falha.message
          erro.classList.remove('oculto')
        }
      },
    }, [
      elemento('div', { classe: 'login-marca', texto: 'Primeiro acesso' }),
      elemento('p', { classe: 'login-sub',
        texto: 'Troque a senha que voce recebeu. Ela nao deve continuar em uso.' }),
      erro,
      elemento('label', { classe: 'campo' }, [elemento('span', { texto: 'Senha recebida' }), atual]),
      elemento('label', { classe: 'campo' }, [elemento('span', { texto: 'Nova senha' }), nova]),
      elemento('p', { classe: 'campo-dica', texto: 'Minimo de 8 caracteres, com letras e numeros.' }),
      elemento('button', { classe: 'botao botao--grande botao--ok', type: 'submit',
        texto: 'Trocar e entrar' }),
      elemento('button', { classe: 'botao botao--suave', type: 'button',
        texto: 'Nao sou eu — sair', aoClick: sair }),
    ]),
  ]))
}

// ------------------------------------------------------------------ inicio

function horaCurta(iso) {
  return new Date(iso).toLocaleString('pt-BR',
    { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function telaInicio() {
  const corpo = []

  if (!estado.tarefas.length && !estado.avulso.length && !estado.preventivas.length) {
    corpo.push(elemento('div', { classe: 'vazio' }, [
      elemento('p', { texto: 'Nenhum veiculo aguardando checklist.' }),
      elemento('p', { classe: 'vazio-dica',
        texto: 'Quando a frota liberar um veiculo para voce, ele aparece aqui com a placa.' }),
    ]))
  }

  for (const tarefa of estado.tarefas) {
    const modelo = modeloPorId(tarefa.template_id)
    const saida = tarefa.momento === 'saida'

    corpo.push(elemento('button', {
      classe: `tarefa${tarefa.atrasada ? ' tarefa--atrasada' : ''}`,
      type: 'button',
      // Sem modelo liberado para o cargo, o cartao explica por escrito e o
      // toque nao leva a lugar nenhum — `abrirTarefa` faz `if (!modelo) return`.
      // Um botao que nao responde le-se como aplicativo quebrado, e nao como
      // explicacao: a pessoa toca de novo, e de novo. Desabilitado, ele para de
      // convidar o toque e o texto continua ali dizendo o porque.
      disabled: !modelo,
      aoClick: () => abrirTarefa(tarefa),
    }, [
      elemento('div', { classe: 'tarefa-topo' }, [
        elemento('span', { classe: 'tarefa-placa dado', texto: tarefa.veiculo.placa }),
        elemento('span', { classe: `tarefa-momento tarefa-momento--${tarefa.momento}`,
          texto: saida ? 'SAIDA' : 'RETORNO' }),
      ]),
      elemento('div', { classe: 'tarefa-modelo',
        texto: `${tarefa.veiculo.marca || ''} ${tarefa.veiculo.modelo}`.trim() }),
      elemento('div', { classe: 'tarefa-janela dado',
        texto: saida
          ? `Retirada a partir de ${horaCurta(tarefa.janela_inicio)}`
          : `Devolver ate ${horaCurta(tarefa.janela_fim)}` }),
      tarefa.atrasada
        ? elemento('div', { classe: 'tarefa-alerta', texto: 'Passou do prazo de devolucao' })
        : null,
      modelo
        ? elemento('div', { classe: 'tarefa-checklist',
            texto: `${modelo.nome} · ${modelo.estrutura.perguntas.length} perguntas` })
        : elemento('div', { classe: 'tarefa-alerta',
            texto: 'Nenhum checklist liberado para o seu cargo neste veiculo.' }),
    ]))
  }

  // Preventivas com checklist (roadmap 14.2). Vem antes do resto: manutencao
  // vencida e' o que mais custa deixar para depois.
  if (estado.preventivas.length) {
    corpo.push(elemento('h2', { classe: 'secao-campo', texto: 'Preventivas' }))
    corpo.push(elemento('p', { classe: 'secao-campo-dica',
      texto: 'Saida antes do servico, retorno depois. O retorno encerra a manutencao.' }))

    for (const prev of estado.preventivas) {
      const modelo = modeloPorId(prev.template_id)
      const saida = prev.momento === 'saida'
      corpo.push(elemento('button', {
        classe: `tarefa tarefa--preventiva${prev.status === 'vencida' ? ' tarefa--atrasada' : ''}`,
        type: 'button',
        disabled: !modelo,     // mesmo motivo do cartao de tarefa
        aoClick: () => abrirPreventiva(prev),
      }, [
        elemento('div', { classe: 'tarefa-topo' }, [
          elemento('span', { classe: 'tarefa-placa dado', texto: prev.veiculo.placa }),
          elemento('span', { classe: `tarefa-momento tarefa-momento--${prev.momento}`,
            texto: saida ? 'SAIDA' : 'RETORNO' }),
        ]),
        elemento('div', { classe: 'tarefa-modelo',
          texto: `${prev.veiculo.marca || ''} ${prev.veiculo.modelo}`.trim() }),
        elemento('div', { classe: 'tarefa-janela dado',
          texto: saida
            ? `Preventiva ${prev.status === 'vencida' ? 'VENCIDA' : 'aberta'} · alvo ${prev.alvo}`
            : 'Servico feito? Registre o que foi mexido.' }),
        modelo
          ? elemento('div', { classe: 'tarefa-checklist',
              texto: `${modelo.nome} · ${modelo.estrutura.perguntas.length} pecas` })
          : elemento('div', { classe: 'tarefa-alerta',
              texto: 'Nenhum checklist liberado para o seu cargo nesta preventiva.' }),
      ]))
    }
  }

  // Checklist diario avulso (roadmap 8.2). Quem sai com carro toda manha nao
  // pede veiculo: pega um no galpao. Como nao ha condutor fixo, ele escolhe a
  // placa aqui — e' o unico lugar do sistema onde o colaborador escolhe carro,
  // e so porque o carro ja esta na mao dele.
  if (estado.avulso.length) {
    corpo.push(elemento('h2', { classe: 'secao-campo', texto: 'Checklist do dia' }))
    corpo.push(elemento('p', { classe: 'secao-campo-dica',
      texto: 'Escolha o veiculo que voce vai usar hoje.' }))

    for (const item of estado.avulso) {
      const modelo = modeloPorId(item.templates[0])
      corpo.push(elemento('button', {
        classe: 'tarefa tarefa--avulsa',
        type: 'button',
        disabled: !modelo,     // mesmo motivo do cartao de tarefa
        aoClick: () => abrirAvulso(item),
      }, [
        elemento('div', { classe: 'tarefa-topo' }, [
          elemento('span', { classe: 'tarefa-placa dado', texto: item.veiculo.placa }),
          elemento('span', { classe: 'tarefa-momento tarefa-momento--saida', texto: 'DIARIO' }),
        ]),
        elemento('div', { classe: 'tarefa-modelo',
          texto: `${item.veiculo.marca || ''} ${item.veiculo.modelo}`.trim() }),
        item.veiculo.status === 'com_pendencia'
          ? elemento('div', { classe: 'tarefa-alerta', texto: 'Este carro tem ocorrencia em aberto' })
          : null,
        modelo
          ? elemento('div', { classe: 'tarefa-checklist',
              texto: `${modelo.nome} · ${modelo.estrutura.perguntas.length} perguntas`
                + (modelo.horario_limite ? ` · ate ${modelo.horario_limite}` : '') })
          // Sem modelo o cartao mostrava so a placa, sem uma palavra sobre por
          // que nada acontece ao tocar. Os outros dois cartoes ja diziam; este
          // ficava calado, que e' o pior dos tres jeitos de nao funcionar.
          : elemento('div', { classe: 'tarefa-alerta',
              texto: 'Nenhum checklist liberado para o seu cargo neste veiculo.' }),
      ].filter(Boolean)))
    }
  }

  tela({
    titulo: `Ola, ${estado.usuario.nome.split(' ')[0]}`,
    subtitulo: estado.usuario.cargo_nome || 'MyLog',
    corpo,
    acoes: [
      elemento('button', { classe: 'botao botao--suave', type: 'button', texto: 'Atualizar',
        aoClick: carregar }),
      elemento('button', { classe: 'botao botao--suave', type: 'button', texto: 'Sair',
        aoClick: sair }),
    ],
  })
}

function abrirTarefa(tarefa) {
  const modelo = modeloPorId(tarefa.template_id)
  if (!modelo) return
  raiz.replaceChildren(executarChecklist({
    tarefa: { ...tarefa, politicas: estado.politicas },
    modelo,
    aoSair: telaInicio,
    aoConcluir: (inspecao) => concluir(tarefa, inspecao),
  }))
}

// ------------------------------------------------------------- conclusao

// Checklist avulso: nao ha solicitacao por tras, entao a "tarefa" e' montada
// aqui a partir do carro escolhido. Momento e' sempre saida — nao existe
// devolucao de um carro que ninguem reservou (roadmap 11.5).
function abrirAvulso(item) {
  const modelo = modeloPorId(item.templates[0])
  if (!modelo) return
  const tarefa = {
    solicitacao_id: null,
    veiculo_id: item.veiculo.id,
    veiculo: item.veiculo,
    momento: 'saida',
    template_id: modelo.id,
    politicas: estado.politicas,
  }
  raiz.replaceChildren(executarChecklist({
    tarefa,
    modelo,
    aoSair: telaInicio,
    aoConcluir: (inspecao) => concluir(tarefa, inspecao),
  }))
}

// Preventiva: a "tarefa" carrega preventiva_id em vez de solicitacao_id. O
// resto e' o mesmo checklist — a diferenca de tela vem da finalidade do modelo
// e do momento (roadmap 14.2.2).
function abrirPreventiva(prev) {
  const modelo = modeloPorId(prev.template_id)
  if (!modelo) return
  const tarefa = {
    solicitacao_id: null,
    preventiva_id: prev.preventiva_id,
    veiculo_id: prev.veiculo.id,
    veiculo: prev.veiculo,
    momento: prev.momento,
    template_id: modelo.id,
    politicas: estado.politicas,
  }
  raiz.replaceChildren(executarChecklist({
    tarefa,
    modelo,
    aoSair: telaInicio,
    aoConcluir: (inspecao) => concluir(tarefa, inspecao),
  }))
}

// O checklist sobe agora, e falhar nao pode perder o trabalho.
//
// `finalizada_em` e' carimbado UMA vez, aqui: e' a hora em que a pessoa
// terminou, nao a hora em que a rede finalmente deixou. Tentar de novo as
// 10h05 nao pode dizer que o checklist das 09h40 foi feito as 10h05.
async function concluir(tarefa, inspecao) {
  return enviar(tarefa, {
    ...inspecao,
    veiculo_id: tarefa.veiculo?.id || tarefa.veiculo_id || null,
    preventiva_id: tarefa.preventiva_id || null,
    finalizada_em: new Date().toISOString(),
  })
}

async function enviar(tarefa, inspecao) {
  tela({
    titulo: 'Enviando checklist',
    subtitulo: tarefa.veiculo.placa,
    corpo: [elemento('p', { classe: 'texto',
      texto: 'Nao feche o aplicativo. Isto leva alguns segundos.' })],
  })

  const r = await envio.enviarInspecao(inspecao)
  if (!r.ok) return telaEnvioFalhou(tarefa, inspecao, r)

  // A inspecao esta gravada. Se alguma foto ficou para tras, o aviso vai junto
  // — uma evidencia que nao entrou e' exatamente o que alguem procura meses
  // depois, num sinistro, e ela nunca pode sumir em silencio.
  const pendencia = [
    r.restantes.length ? `${r.restantes.length} foto(s) nao subiram.` : null,
    r.recusadas.length
      ? `${r.recusadas.length} foto(s) recusada(s): ${r.recusadas[0].motivo}`
      : null,
  ].filter(Boolean).join(' ')

  // Preventiva nao tem devolucao: o carro nao foi emprestado, foi para a
  // oficina. O retorno encerra a manutencao e ja agendou a proxima.
  if (tarefa.preventiva_id) {
    return telaFeito(tarefa, inspecao.resumo, tarefa.momento === 'retorno'
      ? 'Preventiva encerrada. A proxima ja esta agendada.'
      : 'Estado registrado. Faca o servico e volte para o checklist de retorno.', pendencia)
  }

  // Roadmap 10.2, passo 7: na devolucao fora do prazo, o motivo e' pedido
  // ANTES de encerrar. Nao adianta perguntar depois — a pessoa ja foi embora.
  if (tarefa.momento === 'retorno') return telaDevolucao(tarefa, inspecao.resumo)
  telaFeito(tarefa, inspecao.resumo, 'Checklist de saida enviado. Bom trabalho.', pendencia)
}

// O envio falhou e o checklist inteiro esta na variavel `inspecao`.
//
// Sem fila, esta tela e' a unica coisa entre o trabalho feito e o trabalho
// perdido. Ela nao pode se fechar sozinha, nao pode voltar ao inicio por
// engano, e nao pode esconder o que esta em jogo: sair daqui sem enviar perde
// o checklist. Por isso o descarte existe — uma tela sem saida e' pior, e ja
// custou caro na devolucao — mas pede confirmacao e diz o que custa.
//
// Reenviar e' seguro: a inspecao leva `cliente_uuid` e cada foto leva
// `cliente_id`. O servidor devolve o registro que ja existe em vez de
// duplicar, mesmo que a resposta da primeira tentativa tenha se perdido.
function telaEnvioFalhou(tarefa, inspecao, resultado) {
  const confirmar = elemento('div', { classe: 'descarte oculto' }, [
    elemento('p', { classe: 'texto',
      texto: 'Sair agora PERDE este checklist. Ele nao fica guardado no aparelho '
        + 'e sera preciso refazer as respostas e as fotos.' }),
    elemento('button', { classe: 'botao botao--perigo', type: 'button',
      texto: 'Perder o checklist e voltar', aoClick: carregar }),
  ])

  tela({
    titulo: 'Nao deu para enviar',
    subtitulo: tarefa.veiculo.placa,
    corpo: [
      aviso(resultado.motivo, 'erro'),
      elemento('p', { classe: 'texto',
        texto: resultado.sessao
          ? 'Entre de novo e o checklist sera enviado na mesma hora.'
          : 'O checklist esta aqui na tela, inteiro. Procure sinal e tente de novo.' }),
      confirmar,
    ],
    acoes: [
      resultado.sessao
        ? elemento('button', { classe: 'botao botao--grande botao--ok', type: 'button',
            texto: 'Entrar de novo',
            // Com credencial nova, retoma o ENVIO — nao vai para o inicio. E'
            // o que a frase logo acima promete a quem esta olhando.
            aoClick: () => telaLogin(
              'Entre de novo e o checklist sobe em seguida.',
              () => enviar(tarefa, inspecao)) })
        : elemento('button', { classe: 'botao botao--grande botao--ok', type: 'button',
            texto: 'Tentar enviar de novo',
            aoClick: () => enviar(tarefa, inspecao) }),
      elemento('button', { classe: 'botao botao--suave', type: 'button',
        texto: 'Descartar e voltar ao inicio',
        aoClick: () => confirmar.classList.remove('oculto') }),
    ],
  })
}

function telaDevolucao(tarefa, resumo) {
  const atrasada = new Date() > new Date(tarefa.janela_fim)
  const area = elemento('textarea', { classe: 'relatorio', rows: 4,
    placeholder: 'Ex.: cheguei tarde, a base estava fechada e tive que ir com o carro embora.' })
  const erro = elemento('div', { classe: 'aviso aviso--erro oculto' })

  // A saida de emergencia so aparece depois que a devolucao falha.
  //
  // Esta tela nao tinha saida NENHUMA: sem seta de voltar e com um unico
  // botao, que e' justamente o que nao funciona sem rede. Quem devolvesse o
  // carro no patio sem sinal ficava preso aqui — o checklist ja tinha subido,
  // o trabalho estava feito, e o unico jeito de sair era matar o aplicativo.
  // Quem faz isso uma vez desconfia do aparelho para sempre.
  //
  // Ela nao aparece antes da falha de proposito: enquanto der para encerrar
  // direito, o caminho e' encerrar direito, com o motivo escrito.
  //
  // O texto dizia "o checklist ja esta salvo no aparelho e sera enviado
  // sozinho quando houver sinal". Era verdade com a fila; sem ela virou
  // mentira — e mentira tranquilizadora, do tipo que faz a pessoa ir embora
  // achando que esta resolvido. Aqui o checklist ja subiu de verdade: esta
  // tela so aparece DEPOIS do envio, e por isso da para dizer isso com todas
  // as letras.
  const saida = elemento('div', { classe: 'devolucao-saida oculto' }, [
    elemento('p', { classe: 'texto',
      texto: 'O checklist ja foi enviado e esta gravado — isso nao se perde. '
        + 'O que falta e so registrar a devolucao, e ela precisa de rede. Se '
        + 'nao voltar, a equipe da frota encerra pelo painel.' }),
    elemento('button', { classe: 'botao botao--suave', type: 'button',
      texto: 'Voltar ao inicio', aoClick: carregar }),
  ])

  async function devolver() {
    const motivo = area.value.trim()
    if (atrasada && motivo.length < 5) {
      erro.textContent = 'Descreva o motivo do atraso para encerrar.'
      erro.classList.remove('oculto')
      return
    }
    try {
      const resposta = await fetch(`/api/solicitacoes/${tarefa.solicitacao_id}/devolver`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ motivo_atraso: motivo }),
      })
      const dados = await resposta.json().catch(() => ({}))
      if (!resposta.ok) throw new Error(dados.mensagem || 'Nao foi possivel encerrar.')
      telaFeito(tarefa, resumo, atrasada
        ? 'Devolucao registrada com o motivo do atraso.'
        : 'Veiculo devolvido no prazo. Obrigado.')
    } catch (falha) {
      // Sem rede a devolucao nao fecha, mas o checklist ja esta na fila:
      // nada do que ele fez se perde.
      erro.textContent = falha.message
      erro.classList.remove('oculto')
      saida.classList.remove('oculto')
    }
  }

  tela({
    titulo: atrasada ? 'Passou do prazo' : 'Devolver veiculo',
    subtitulo: `${tarefa.veiculo.placa} · prazo ${horaCurta(tarefa.janela_fim)}`,
    corpo: [
      erro,
      atrasada
        ? aviso('Notamos que passou do prazo de retorno. Descreva o motivo.', 'atencao')
        : elemento('p', { classe: 'texto',
            texto: 'Confirme a devolucao para liberar o veiculo para outra pessoa.' }),
      atrasada
        ? elemento('label', { classe: 'campo' }, [
            elemento('span', { texto: 'Motivo do atraso' }), area,
          ])
        : null,
      saida,
    ],
    acoes: [
      elemento('button', { classe: 'botao botao--grande botao--ok', type: 'button',
        texto: atrasada ? 'Enviar motivo e devolver' : 'Confirmar devolucao', aoClick: devolver }),
    ],
  })
  if (atrasada) setTimeout(() => area.focus(), 80)
}

function telaFeito(tarefa, resumo, mensagem, pendencia = '') {
  const bloqueou = resumo.estado_veiculo_previsto === 'bloqueado'
  tela({
    titulo: 'Pronto',
    subtitulo: tarefa.veiculo.placa,
    corpo: [
      elemento('div', { classe: `feito feito--${bloqueou ? 'bloqueado' : 'ok'}` }, [
        elemento('div', { classe: 'feito-simbolo', texto: bloqueou ? '!' : '✓' }),
        elemento('p', { classe: 'feito-texto', texto: mensagem }),
      ]),
      bloqueou
        ? aviso(`Este veiculo ficou BLOQUEADO. ${resumo.motivo} Avise a equipe da frota.`, 'erro')
        : resumo.ocorrencias.length
          ? aviso(`${resumo.ocorrencias.length} ocorrencia(s) foram abertas para a frota tratar.`, 'atencao')
          : null,
      pendencia ? aviso(pendencia, 'atencao') : null,
    ],
    acoes: [
      elemento('button', { classe: 'botao botao--grande botao--ok', type: 'button',
        texto: 'Voltar ao inicio', aoClick: carregar }),
    ],
  })
}

// ------------------------------------------------------------------ sessao

async function sair() {
  try { await fetch('/api/auth/sair', { method: 'POST', credentials: 'same-origin' }) } catch { /* sem rede */ }
  estado.usuario = null
  // A tela de login nao e' de empresa nenhuma. Deixar a marca da ultima ali
  // diria, para quem pega o aparelho depois, de quem ele estava — e no patio
  // o aparelho passa de mao em mao.
  estado.marca = null
  pintarMarca(null)
  telaLogin()
}

// `haviaSessao` diz o que um 401 SIGNIFICA para quem esta olhando.
//
// Para quem estava dentro, ele significa "sua credencial venceu, entre de
// novo". Para quem acabou de abrir o aplicativo e nunca entrou, a mesma frase
// manda procurar um problema que nao existe — e transforma a tela de login,
// que e' onde ela deveria estar, numa tela de erro.
async function carregar({ haviaSessao = true } = {}) {
  let r
  try {
    r = await envio.baixarContexto()
  } catch {
    return telaLogin('Sem conexao com o servidor. O MyLog precisa de internet para funcionar.')
  }
  if (r.erro === 'sessao') {
    return telaLogin(haviaSessao ? 'Sua sessao expirou. Entre de novo.' : '')
  }

  estado.usuario = r.dados.usuario || estado.usuario
  estado.tarefas = r.dados.tarefas || []
  estado.avulso = r.dados.avulso || []
  estado.preventivas = r.dados.preventivas || []
  estado.modelos = r.dados.modelos || []
  estado.politicas = r.dados.politicas || {}
  estado.marca = r.dados.marca || null
  pintarMarca(estado.marca)
  telaInicio()
}

// ------------------------------------------------------------------ inicio

// A tira de conexao vive em todas as telas. Some quando a rede volta, aparece
// quando ela cai — no lugar, sem redesenhar a tela por baixo de quem responde.
function redesenharTira() {
  const tira = raiz.querySelector('.tira')
  const nova = tiraConexao()
  if (tira && nova) return tira.replaceWith(nova)
  if (tira && !nova) return tira.remove()
  if (!tira && nova) raiz.querySelector('.topo')?.after(nova)
}

window.addEventListener('online', redesenharTira)
window.addEventListener('offline', redesenharTira)

async function iniciar() {
  // Sem `try/catch` em volta de tudo de proposito.
  //
  // A versao anterior tratava as duas saidas como uma so, e as duas dizem
  // coisas opostas para quem esta olhando: "nao consegui falar com o servidor"
  // manda procurar sinal; "sua sessao expirou" manda entrar de novo. Juntas,
  // davam "Sua sessao expirou. Entre de novo." para quem abriu o aplicativo
  // pela PRIMEIRA VEZ e nunca teve sessao nenhuma — a pessoa procura um
  // problema que nao existe, e a tela de login vira uma tela de erro.
  let resposta
  try {
    resposta = await fetch('/api/auth/eu', { credentials: 'same-origin' })
  } catch {
    // Uma chamada que nao volta pode ser o servidor fora do ar ou um soluco de
    // sinal nesta chamada so. Nao da para saber com uma tentativa, e declarar
    // "sem conexao" na primeira fecha o aplicativo para quem tinha sinal.
    // `carregar` faz a segunda tentativa e diz o que for verdade.
    return carregar({ haviaSessao: false })
  }

  // 401 aqui nao e' erro: e' a primeira tela de quem ainda nao entrou. O
  // formulario limpo ja e' a mensagem.
  if (resposta.status === 401) return telaLogin()
  if (!resposta.ok) return telaLogin('O servidor nao respondeu. Tente de novo em instantes.')

  const { usuario } = await resposta.json()
  estado.usuario = usuario
  if (usuario.deve_trocar_senha) return telaTrocaDeSenha()
  // Daqui para baixo existe sessao — e ai sim um 401 significa que ela venceu.
  await carregar()
}

// O service worker foi embora com o offline (D58), e ir embora do repositorio
// nao basta: um service worker instalado continua vivo no aparelho, servindo
// a versao que ele guardou em cache, para sempre. Quem ja tinha o MyLog
// instalado ficaria preso ao aplicativo antigo — com fila, com IndexedDB, sem
// nenhuma das correcoes seguintes — e nenhuma publicacao nova o alcancaria.
//
// Por isso a despedida e' explicita: cancela o registro e apaga os caches que
// ele criou. E' o unico jeito de um service worker sair do ar.
//
// Esta parte tem que ficar aqui por algumas versoes. Tirar cedo demais nao da
// erro nenhum — so deixa para tras os aparelhos que nao abriram o aplicativo
// no meio tempo, que sao exatamente os que mais precisam dela.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations?.()
    .then((registros) => Promise.all(registros.map((r) => r.unregister())))
    .then(() => caches?.keys())
    .then((chaves) => Promise.all((chaves || []).map((c) => caches.delete(c))))
    .catch(() => { /* navegador sem a API, ou ja limpo */ })
}

iniciar()
