// Aplicativo de campo do MyLog (roadmap 2 e 10).
//
// O colaborador abre isto no patio, muitas vezes sem sinal. O caminho e' curto
// de proposito: entrar -> ver o que tem para fazer -> executar -> devolver.
import * as sincronia from './sincronia.js'
import { fila, garantirPersistencia } from './armazem.js'
import { elemento, executarChecklist } from './checklist.js'

const raiz = document.getElementById('app')

const estado = {
  usuario: null,
  tarefas: [],
  avulso: [],
  preventivas: [],
  modelos: [],
  politicas: {},
  doCache: false,
  baixadoEm: null,
}

const modeloPorId = (id) => estado.modelos.find((m) => m.id === id)

// ------------------------------------------------------------- estrutura

function tela({ titulo, subtitulo, voltar, corpo, acoes = [] }) {
  raiz.replaceChildren(
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
  )
}

// A tira de conexao e' permanente: quem esta no patio precisa saber, sem
// procurar, se o que ele fez ja saiu do aparelho.
function tiraConexao() {
  const s = sincronia.estado
  const online = navigator.onLine
  let texto
  let tom

  if (s.pendentes > 0 && !online) { tom = 'espera'; texto = `${s.pendentes} checklist(s) aguardando conexao` }
  else if (s.enviando) { tom = 'enviando'; texto = 'Enviando...' }
  else if (s.pendentes > 0) { tom = 'espera'; texto = `${s.pendentes} checklist(s) na fila` }
  else if (s.recusadas > 0) { tom = 'erro'; texto = `${s.recusadas} checklist(s) recusado(s) — toque para ver` }
  else if (!online) { tom = 'offline'; texto = 'Sem conexao. Da para trabalhar normalmente.' }
  else { tom = 'ok'; texto = 'Tudo sincronizado' }

  return elemento('button', {
    classe: `tira tira--${tom}`, type: 'button', texto,
    aoClick: telaFila,
  })
}

function aviso(mensagem, tom = 'erro') {
  return elemento('div', { classe: `aviso aviso--${tom}`, texto: mensagem })
}

// ------------------------------------------------------------------ login

function telaLogin(mensagem) {
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
          if (dados.usuario.deve_trocar_senha) return telaTrocaDeSenha()
          await carregar()
        } catch (falha) {
          erro.textContent = falha.message
          erro.classList.remove('oculto')
        } finally {
          botao.disabled = false
          botao.textContent = 'Entrar'
        }
      },
    }, [
      elemento('div', { classe: 'login-marca', texto: 'MyLog' }),
      elemento('p', { classe: 'login-sub', texto: 'Checklist de frota' }),
      erro,
      elemento('label', { classe: 'campo' }, [elemento('span', { texto: 'Email' }), email]),
      elemento('label', { classe: 'campo' }, [elemento('span', { texto: 'Senha' }), senha]),
      botao,
    ]),
  ]))
}

// Roadmap 8.1: no primeiro acesso a troca de senha e' obrigatoria e vem antes
// de qualquer outra tela.
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

  if (estado.doCache) {
    corpo.push(aviso(
      `Sem conexao. Mostrando o que foi baixado em ${estado.baixadoEm ? horaCurta(estado.baixadoEm) : 'algum momento'}.`,
      'atencao'))
  }

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
          : null,
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

async function concluir(tarefa, inspecao) {
  await fila.enfileirar({
    ...inspecao,
    veiculo_id: tarefa.veiculo?.id || tarefa.veiculo_id || null,
    preventiva_id: tarefa.preventiva_id || null,
    veiculo_placa: tarefa.veiculo.placa,
    finalizada_em: new Date().toISOString(),
  })
  sincronia.sincronizar()

  // Preventiva nao tem devolucao: o carro nao foi emprestado, foi para a
  // oficina. O retorno encerra a manutencao e ja agendou a proxima.
  if (tarefa.preventiva_id) {
    return telaFeito(tarefa, inspecao.resumo, tarefa.momento === 'retorno'
      ? 'Preventiva encerrada. A proxima ja esta agendada.'
      : 'Estado registrado. Faca o servico e volte para o checklist de retorno.')
  }

  // Roadmap 10.2, passo 7: na devolucao fora do prazo, o motivo e' pedido
  // ANTES de encerrar. Nao adianta perguntar depois — a pessoa ja foi embora.
  if (tarefa.momento === 'retorno') return telaDevolucao(tarefa, inspecao.resumo)
  telaFeito(tarefa, inspecao.resumo, 'Checklist de saida enviado. Bom trabalho.')
}

function telaDevolucao(tarefa, resumo) {
  const atrasada = new Date() > new Date(tarefa.janela_fim)
  const area = elemento('textarea', { classe: 'relatorio', rows: 4,
    placeholder: 'Ex.: cheguei tarde, a base estava fechada e tive que ir com o carro embora.' })
  const erro = elemento('div', { classe: 'aviso aviso--erro oculto' })

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
      erro.textContent = `${falha.message} O checklist ja foi salvo e sera enviado sozinho.`
      erro.classList.remove('oculto')
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
    ],
    acoes: [
      elemento('button', { classe: 'botao botao--grande botao--ok', type: 'button',
        texto: atrasada ? 'Enviar motivo e devolver' : 'Confirmar devolucao', aoClick: devolver }),
    ],
  })
  if (atrasada) setTimeout(() => area.focus(), 80)
}

function telaFeito(tarefa, resumo, mensagem) {
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
    ],
    acoes: [
      elemento('button', { classe: 'botao botao--grande botao--ok', type: 'button',
        texto: 'Voltar ao inicio', aoClick: carregar }),
    ],
  })
}

// -------------------------------------------------------------------- fila

async function telaFila() {
  const itens = await fila.todas()
  const corpo = itens.length
    ? itens.reverse().map((i) => elemento('div', { classe: `fila-item fila-item--${i.estado}` }, [
        elemento('div', { classe: 'fila-topo' }, [
          elemento('span', { classe: 'dado', texto: i.veiculo_placa || '—' }),
          elemento('span', { classe: 'fila-selo', texto: i.momento === 'saida' ? 'SAIDA' : 'RETORNO' }),
        ]),
        elemento('div', { classe: 'fila-quando dado', texto: horaCurta(i.criado_em) }),
        elemento('div', { classe: 'fila-estado', texto:
          i.estado === 'enviada' ? 'Enviado ao servidor'
            : i.estado === 'recusada' ? 'Recusado pelo servidor'
              : 'Aguardando envio' }),
        i.erro ? elemento('div', { classe: 'fila-erro', texto: i.erro }) : null,
      ]))
    : [elemento('div', { classe: 'vazio' }, [elemento('p', { texto: 'A fila esta vazia.' })])]

  const cota = await garantirPersistencia()
  if (cota.usadoMb !== null) {
    corpo.push(elemento('p', { classe: 'rodape-nota',
      texto: `Armazenamento: ${cota.usadoMb} MB usados de ${cota.cotaMb} MB${cota.persistente ? ' · protegido contra limpeza automatica' : ''}` }))
  }

  tela({
    titulo: 'Fila de envio',
    subtitulo: 'Nada se perde: o envio acontece sozinho quando houver rede.',
    voltar: telaInicio,
    corpo,
    acoes: [
      elemento('button', { classe: 'botao botao--grande botao--ok', type: 'button',
        texto: 'Tentar enviar agora',
        aoClick: async () => { await sincronia.sincronizar(); telaFila() } }),
    ],
  })
}

// ------------------------------------------------------------------ sessao

async function sair() {
  const pendentes = (await fila.pendentes()).filter((i) => i.estado === 'pendente')
  if (pendentes.length) {
    // Sair com fila pendente perderia a sessao que a fila precisa para enviar.
    return telaFila()
  }
  try { await fetch('/api/auth/sair', { method: 'POST', credentials: 'same-origin' }) } catch { /* offline */ }
  estado.usuario = null
  telaLogin()
}

async function carregar() {
  const r = await sincronia.atualizarContexto()
  if (r.erro === 'sessao') return telaLogin('Sua sessao expirou. Entre de novo.')
  if (r.erro === 'sem_contexto') return telaLogin('Sem dados baixados. Conecte-se uma vez para comecar.')

  estado.usuario = r.dados.usuario || estado.usuario
  estado.tarefas = r.dados.tarefas || []
  estado.avulso = r.dados.avulso || []
  estado.preventivas = r.dados.preventivas || []
  estado.modelos = r.dados.modelos || []
  estado.politicas = r.dados.politicas || {}
  estado.doCache = r.doCache
  estado.baixadoEm = r.dados.baixado_em || r.dados.gerado_em
  telaInicio()
}

// ------------------------------------------------------------------ inicio

sincronia.aoMudar(() => {
  // A tira de conexao vive em todas as telas; atualiza no lugar.
  const tira = raiz.querySelector('.tira')
  if (tira) tira.replaceWith(tiraConexao())
})

window.addEventListener('online', () => sincronia.sincronizar())

async function iniciar() {
  await sincronia.iniciar()
  try {
    const resposta = await fetch('/api/auth/eu', { credentials: 'same-origin' })
    if (!resposta.ok) throw new Error('sem sessao')
    const { usuario } = await resposta.json()
    estado.usuario = usuario
    if (usuario.deve_trocar_senha) return telaTrocaDeSenha()
    await carregar()
  } catch {
    // Sem rede mas com contexto baixado, o app abre mesmo assim.
    const r = await sincronia.atualizarContexto()
    if (r.dados?.usuario) {
      estado.usuario = r.dados.usuario
      estado.tarefas = r.dados.tarefas || []
      estado.avulso = r.dados.avulso || []
      estado.preventivas = r.dados.preventivas || []
      estado.modelos = r.dados.modelos || []
      estado.politicas = r.dados.politicas || {}
      estado.doCache = true
      estado.baixadoEm = r.dados.baixado_em
      return telaInicio()
    }
    telaLogin()
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/app/sw.js').catch(() => { /* segue sem cache */ })
}

iniciar()
