// Aplicativo de campo do MyLog (secao 10).
// Login -> inicio -> pre-check -> checklist -> resumo -> conclusao.
// Uma decisao por tela. Nada de menu escondido.
import { elemento, desenharChecklist, resumirInspecao, painelAssinatura } from './checklist.js'
import { fila, fotos, contexto as depositoContexto, garantirPersistencia, uuid } from './armazem.js'
import * as sincronia from './sincronia.js'

const raiz = document.getElementById('app')

const estado = {
  contexto: null,
  doCache: false,
  veiculo: null,
  template: null,
  respostas: {},
  clienteUuid: null,
  iniciadaEm: null,
  assinatura: null,
}

// ------------------------------------------------------------------ apoio

function tela({ titulo, subtitulo, voltar, corpo, acoes = [] }) {
  raiz.replaceChildren(
    elemento('div', { classe: 'campo-app' }, [
      elemento('header', { classe: 'campo-topo' }, [
        voltar
          ? elemento('button', { classe: 'botao botao--suave botao--mini', texto: '←', aoClick: voltar })
          : null,
        elemento('div', {}, [
          elemento('h1', { texto: titulo }),
          subtitulo ? elemento('div', { classe: 'campo-topo-sub', texto: subtitulo }) : null,
        ]),
      ]),
      tiraConexao(),
      elemento('main', { classe: 'campo-corpo' }, [corpo]),
      acoes.length ? elemento('div', { classe: 'campo-rodape' }, acoes) : null,
    ]),
  )
}

function tiraConexao() {
  if (!sincronia.estado.online) {
    return elemento('div', { classe: 'tira-conexao tira-conexao--offline' }, [
      'Sem conexao — o checklist funciona normalmente e sera enviado depois.',
    ])
  }
  if (sincronia.estado.pendentes > 0) {
    return elemento('div', { classe: 'tira-conexao tira-conexao--fila' }, [
      `${sincronia.estado.pendentes} inspecao(oes) aguardando envio.`,
      elemento('button', {
        classe: 'botao botao--suave botao--mini', texto: 'Enviar agora',
        style: 'margin-left:auto', aoClick: () => sincronia.sincronizar(),
      }),
    ])
  }
  return null
}

function aviso(mensagem, tom = 'erro') {
  return elemento('div', { classe: `aviso aviso--${tom}`, texto: mensagem })
}

// ------------------------------------------------------------------ login

function telaLogin(mensagem) {
  const email = elemento('input', { type: 'email', autocomplete: 'username', required: 'true' })
  const senha = elemento('input', { type: 'password', autocomplete: 'current-password', required: 'true' })
  const botao = elemento('button', { classe: 'botao botao--largo', type: 'submit', texto: 'Entrar' })
  const areaAviso = elemento('div', {})

  const formulario = elemento('form', { classe: 'login-caixa' }, [
    elemento('div', { classe: 'login-topo' }, [
      elemento('div', { classe: 'marca-nome marca-nome--grande', texto: 'MyLog' }),
      elemento('p', { classe: 'login-sub', texto: 'Checklist de veiculos' }),
    ]),
    areaAviso,
    elemento('div', { classe: 'campo' }, [elemento('label', { texto: 'Email' }), email]),
    elemento('div', { classe: 'campo' }, [elemento('label', { texto: 'Senha' }), senha]),
    elemento('div', { classe: 'esp-t-4' }, [botao]),
  ])

  if (mensagem) areaAviso.append(aviso(mensagem))

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault()
    areaAviso.replaceChildren()
    botao.disabled = true
    botao.textContent = 'Entrando...'
    try {
      const resposta = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: email.value.trim(), senha: senha.value, origem: 'android' }),
      })
      const dados = await resposta.json()
      if (!resposta.ok) throw new Error(dados.mensagem || 'Falha ao entrar.')
      await iniciar()
    } catch (falha) {
      areaAviso.append(aviso(
        navigator.onLine ? falha.message : 'Sem conexao. O primeiro acesso precisa de internet.',
      ))
      botao.disabled = false
      botao.textContent = 'Entrar'
    }
  })

  raiz.replaceChildren(elemento('div', { classe: 'login' }, [formulario]))
}

// ------------------------------------------------------------------ inicio

function telaInicio() {
  const { veiculos, templates, inspecoes_hoje: hoje, tickets, usuario } = estado.contexto
  const corpo = elemento('div', {})

  if (estado.doCache) {
    corpo.append(aviso('Mostrando os dados baixados da ultima conexao.', 'info'))
  }

  if (!veiculos.length) {
    corpo.append(elemento('div', { classe: 'vazio' }, [
      'Voce ainda nao tem veiculo autorizado. Fale com o administrador — '
      + 'sem vinculo, o sistema nao aceita a inspecao.',
    ]))
  }

  for (const veiculo of veiculos) {
    const feita = hoje.find((i) => i.veiculo_id === veiculo.id && i.finalizada_em)
    const temTemplate = Boolean(templates[veiculo.id])
    const bloqueado = veiculo.status === 'bloqueado'

    corpo.append(elemento('button', {
      classe: 'veiculo-cartao',
      disabled: !temTemplate || bloqueado,
      aoClick: () => iniciarInspecao(veiculo, templates[veiculo.id]),
    }, [
      elemento('div', {}, [
        elemento('div', { classe: 'veiculo-placa', texto: veiculo.placa }),
        elemento('div', { classe: 'veiculo-modelo',
          texto: `${veiculo.marca || ''} ${veiculo.modelo}`.trim() }),
      ]),
      elemento('div', { classe: 'veiculo-cartao-fim' }, [
        bloqueado
          ? elemento('span', { classe: 'selo s-critico', texto: 'Bloqueado' })
          : feita
            ? elemento('span', { classe: 'selo s-ok', texto: 'Feito hoje' })
            : temTemplate
              ? elemento('span', { classe: 'selo s-marca', texto: 'Iniciar' })
              : elemento('span', { classe: 'selo s-neutro', texto: 'Sem checklist' }),
        veiculo.principal
          ? elemento('div', { classe: 'campo-dica', texto: 'seu veiculo' })
          : null,
      ]),
    ]))
  }

  if (bloqueadoComMotivo(veiculos)) {
    corpo.append(elemento('div', { classe: 'campo-dica esp-t-3', texto: bloqueadoComMotivo(veiculos) }))
  }

  corpo.append(
    elemento('div', { classe: 'secao' }, [
      elemento('div', { classe: 'secao-titulo' }, [
        elemento('h2', { texto: 'Meus tickets' }),
        elemento('button', { classe: 'botao botao--suave botao--mini', texto: 'Novo',
          aoClick: telaNovoTicket }),
      ]),
      tickets.length
        ? elemento('div', {}, tickets.map((t) => elemento('div', { classe: 'fila-cartao' }, [
            elemento('span', { classe: 'dado celula-forte', texto: `#${t.numero}` }),
            elemento('div', { classe: 'foto-texto', texto: t.descricao.slice(0, 70) }),
            elemento('span', { classe: 'selo s-neutro', texto: t.status.replace('_', ' ') }),
          ])))
        : elemento('div', { classe: 'vazio', texto: 'Nenhuma solicitacao aberta.' }),
    ]),
  )

  tela({
    titulo: `Ola, ${usuario.nome.split(' ')[0]}`,
    subtitulo: 'Escolha o veiculo para iniciar o checklist',
    corpo,
    acoes: [
      elemento('button', { classe: 'botao botao--suave', texto: 'Fila de envio', aoClick: telaFila }),
      elemento('button', { classe: 'botao botao--suave', texto: 'Sair', aoClick: sair }),
    ],
  })
}

function bloqueadoComMotivo(veiculos) {
  const bloqueado = veiculos.find((v) => v.status === 'bloqueado' && v.motivo_status)
  return bloqueado ? `${bloqueado.placa}: ${bloqueado.motivo_status}` : null
}

// --------------------------------------------------------------- pre-check

function iniciarInspecao(veiculo, template) {
  estado.veiculo = veiculo
  estado.template = template
  estado.respostas = {}
  estado.clienteUuid = uuid()
  estado.iniciadaEm = new Date().toISOString()
  estado.assinatura = null
  telaPreCheck()
}

function telaPreCheck() {
  const { veiculo, template } = estado
  const km = elemento('input', { type: 'number', inputmode: 'numeric' })
  km.value = veiculo.km_atual

  tela({
    titulo: veiculo.placa,
    subtitulo: `${veiculo.marca || ''} ${veiculo.modelo}`.trim(),
    voltar: telaInicio,
    corpo: elemento('div', {}, [
      elemento('div', { classe: 'item' }, [
        elemento('div', { classe: 'item-secao', texto: 'Antes de comecar' }),
        elemento('div', { classe: 'item-pergunta', texto: 'Confirme a quilometragem do hodometro' }),
        elemento('div', { classe: 'campo' }, [km]),
        elemento('div', { classe: 'campo-dica',
          texto: `Ultimo registro: ${Number(veiculo.km_atual).toLocaleString('pt-BR')} km. `
            + 'A preventiva por KM depende deste numero.' }),
      ]),
      elemento('div', { classe: 'campo-dica esp-t-3',
        texto: `Checklist: ${template.nome} (versao ${template.versao})` }),
    ]),
    acoes: [
      elemento('button', {
        classe: 'botao', texto: 'Comecar checklist',
        aoClick: () => {
          estado.kmInformado = Number(km.value) || null
          telaChecklist()
        },
      }),
    ],
  })
}

// --------------------------------------------------------------- checklist

function telaChecklist() {
  const { estrutura } = estado.template
  const { area } = desenharChecklist({
    estrutura,
    respostas: estado.respostas,
    clienteUuid: estado.clienteUuid,
    aoMudar: () => { /* o progresso ja se redesenha */ },
  })

  tela({
    titulo: estado.veiculo.placa,
    subtitulo: estado.template.nome,
    voltar: telaPreCheck,
    corpo: area,
    acoes: [
      elemento('button', { classe: 'botao', texto: 'Ver resumo', aoClick: telaResumo }),
    ],
  })
}

// ----------------------------------------------------------------- resumo

// Secao 27: antes de concluir, o motorista ve o que foi encontrado E a
// consequencia. Nada de descobrir que o veiculo bloqueou depois de sair.
function telaResumo() {
  const politicas = estado.contexto.politicas || {}
  const r = resumirInspecao(estado.template.estrutura, estado.respostas, politicas)

  const corpo = elemento('div', {}, [
    elemento('div', { classe: 'resumo-numeros' }, [
      elemento('div', { classe: 'resumo-numero' }, [
        elemento('b', { texto: String(r.conformes) }), elemento('span', { texto: 'conformes' })]),
      elemento('div', { classe: 'resumo-numero' }, [
        elemento('b', { texto: String(r.nao_conformidades.length) }), elemento('span', { texto: 'pendencias' })]),
      elemento('div', { classe: 'resumo-numero' }, [
        elemento('b', { texto: String(r.pendencias.length) }), elemento('span', { texto: 'sem resposta' })]),
    ]),
    elemento('div', { classe: `veredito veredito--${r.resultado}` }, [
      elemento('h3', { texto: {
        aprovado: 'Veiculo aprovado', com_pendencia: 'Aprovado com pendencia', reprovado: 'Veiculo reprovado',
      }[r.resultado] }),
      elemento('p', { texto: r.motivo || 'Nenhuma nao conformidade encontrada.' }),
    ]),
  ])

  if (r.nao_conformidades.length) {
    corpo.append(
      elemento('div', { classe: 'secao-titulo' }, [elemento('h2', { texto: 'O que foi encontrado' })]),
      elemento('div', { classe: 'lista-nc' }, r.nao_conformidades.map((nc) =>
        elemento('div', { classe: 'lista-nc-item' }, [
          elemento('b', { texto: nc.rotulo }),
          elemento('div', { texto: `${nc.secao} · criticidade ${nc.criticidade}` }),
        ]))),
    )
  }

  if (!r.pode_finalizar) {
    const faltando = [
      ...r.pendencias.map((p) => `${p.rotulo} (sem resposta)`),
      ...r.fotos_pendentes.map((f) => `${f.rotulo} (foto obrigatoria)`),
    ]
    corpo.append(
      elemento('div', { classe: 'esp-t-4' }, [aviso('Falta preencher antes de concluir:')]),
      elemento('div', { classe: 'lista-nc' }, faltando.map((t) =>
        elemento('div', { classe: 'lista-nc-item', texto: t }))),
    )
  } else if (!templateTemAssinatura()) {
    // So pedimos assinatura aqui quando o checklist nao tem um item proprio
    // para isso — senao o motorista assinaria duas vezes a mesma inspecao.
    corpo.append(elemento('div', { classe: 'esp-t-4' }, [
      elemento('div', { classe: 'item-secao', texto: 'Assinatura do condutor' }),
      painelAssinatura({ aoAssinar: (v) => { estado.assinatura = v } }),
    ]))
  }

  tela({
    titulo: 'Resumo',
    subtitulo: `${estado.veiculo.placa} · ${estado.template.nome}`,
    voltar: telaChecklist,
    corpo,
    acoes: [
      elemento('button', { classe: 'botao botao--suave', texto: 'Voltar', aoClick: telaChecklist }),
      elemento('button', {
        classe: 'botao', texto: 'Concluir', disabled: !r.pode_finalizar,
        aoClick: () => concluir(r),
      }),
    ],
  })
}

// --------------------------------------------------------------- concluir

// A inspecao vai para a fila local e a tela ja segue. Ninguem espera a rede.
async function concluir(resumo) {
  await fila.enfileirar({
    cliente_uuid: estado.clienteUuid,
    veiculo_id: estado.veiculo.id,
    veiculo_placa: estado.veiculo.placa,
    template_id: estado.template.id,
    respostas: estado.respostas,
    km_informado: estado.kmInformado,
    assinatura: estado.assinatura,
    iniciada_em: estado.iniciadaEm,
    finalizada_em: new Date().toISOString(),
    resultado_local: resumo.resultado,
  })

  sincronia.sincronizar()

  tela({
    titulo: 'Checklist concluido',
    corpo: elemento('div', {}, [
      elemento('div', { classe: `veredito veredito--${resumo.resultado}` }, [
        elemento('h3', { texto: `${estado.veiculo.placa} — ${{
          aprovado: 'aprovado', com_pendencia: 'aprovado com pendencia', reprovado: 'reprovado',
        }[resumo.resultado]}` }),
        elemento('p', { texto: resumo.motivo || 'Nenhuma nao conformidade encontrada.' }),
      ]),
      elemento('div', { classe: 'campo-dica' }, [
        navigator.onLine
          ? 'Enviando para o servidor. Se falhar, fica na fila e vai sozinho depois.'
          : 'Guardado no aparelho. Sera enviado assim que houver conexao.',
      ]),
    ]),
    acoes: [elemento('button', { classe: 'botao', texto: 'Voltar ao inicio', aoClick: recarregarInicio })],
  })
}

function templateTemAssinatura() {
  return estado.template.estrutura.secoes.some((s) => s.itens.some((i) => i.tipo === 'assinatura'))
}

async function recarregarInicio() {
  const r = await sincronia.atualizarContexto()
  if (r.dados) { estado.contexto = r.dados; estado.doCache = r.doCache }
  telaInicio()
}

// ------------------------------------------------------------------- fila

async function telaFila() {
  const itens = await fila.todas()
  const corpo = itens.length
    ? elemento('div', {}, itens.map((i) => elemento('div', { classe: 'fila-cartao' }, [
        elemento('div', {}, [
          elemento('div', { classe: 'dado celula-forte', texto: i.veiculo_placa || i.veiculo_id }),
          elemento('div', { classe: 'campo-dica',
            texto: new Date(i.criado_em).toLocaleString('pt-BR') }),
          i.erro ? elemento('div', { classe: 'campo-dica', texto: i.erro }) : null,
        ]),
        elemento('span', {
          classe: 'selo ' + ({ enviada: 's-ok', pendente: 's-atencao', recusada: 's-critico' }[i.estado] || 's-neutro'),
          texto: { enviada: 'Enviada', pendente: 'Aguardando', recusada: 'Recusada' }[i.estado] || i.estado,
        }),
      ])))
    : elemento('div', { classe: 'vazio', texto: 'Nada na fila. Tudo sincronizado.' })

  tela({
    titulo: 'Fila de envio',
    subtitulo: sincronia.estado.online ? 'Conectado' : 'Sem conexao',
    voltar: telaInicio,
    corpo,
    acoes: [
      elemento('button', {
        classe: 'botao', texto: 'Tentar enviar agora',
        disabled: !sincronia.estado.online,
        aoClick: async () => { await sincronia.sincronizar(); telaFila() },
      }),
    ],
  })
}

// ------------------------------------------------------------------ ticket

function telaNovoTicket() {
  const categoria = elemento('select', {}, [
    ['solicitacao', 'Solicitacao de uso'], ['problema', 'Problema no veiculo'],
    ['dano', 'Dano'], ['limpeza', 'Limpeza'], ['documentacao', 'Documentacao'], ['outro', 'Outro'],
  ].map(([v, r]) => elemento('option', { value: v, texto: r })))

  const veiculo = elemento('select', {}, [
    elemento('option', { value: '', texto: 'Nenhum veiculo especifico' }),
    ...estado.contexto.veiculos.map((v) =>
      elemento('option', { value: v.id, texto: `${v.placa} — ${v.modelo}` })),
  ])

  const descricao = elemento('textarea', { rows: 4, placeholder: 'O que aconteceu ou o que voce precisa' })
  const areaAviso = elemento('div', {})

  tela({
    titulo: 'Novo ticket',
    voltar: telaInicio,
    corpo: elemento('div', {}, [
      areaAviso,
      elemento('div', { classe: 'campo' }, [elemento('label', { texto: 'Categoria' }), categoria]),
      elemento('div', { classe: 'campo' }, [elemento('label', { texto: 'Veiculo' }), veiculo]),
      elemento('div', { classe: 'campo' }, [elemento('label', { texto: 'Descricao' }), descricao]),
      elemento('div', { classe: 'campo-dica',
        texto: 'Ticket precisa de conexao. Sem rede, anote e abra depois.' }),
    ]),
    acoes: [
      elemento('button', {
        classe: 'botao', texto: 'Abrir ticket',
        aoClick: async () => {
          areaAviso.replaceChildren()
          try {
            const resposta = await fetch('/api/tickets', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({
                categoria: categoria.value,
                veiculo_id: veiculo.value || null,
                descricao: descricao.value,
              }),
            })
            const dados = await resposta.json()
            if (!resposta.ok) throw new Error(dados.mensagem)
            await recarregarInicio()
          } catch (falha) {
            areaAviso.append(aviso(navigator.onLine ? falha.message : 'Sem conexao.'))
          }
        },
      }),
    ],
  })
}

// ------------------------------------------------------------------ sessao

async function sair() {
  await fetch('/api/auth/sair', { method: 'POST', credentials: 'same-origin' }).catch(() => {})
  await depositoContexto.limpar()
  telaLogin()
}

// ------------------------------------------------------------------ inicio

async function iniciar() {
  const r = await sincronia.atualizarContexto()
  if (r.erro === 'sessao') { telaLogin(); return }
  if (r.erro === 'sem_contexto') {
    telaLogin('Sem conexao e sem dados guardados. O primeiro acesso precisa de internet.')
    return
  }
  estado.contexto = r.dados
  estado.doCache = r.doCache
  telaInicio()
}

sincronia.aoMudar(() => {
  // A tira de conexao vive no topo de toda tela; redesenha so ela.
  const tira = document.querySelector('.tira-conexao')
  const nova = tiraConexao()
  if (tira && nova) tira.replaceWith(nova)
  else if (tira) tira.remove()
  else if (nova) document.querySelector('.campo-topo')?.after(nova)
})

await sincronia.iniciar()
await fila.limparEnviadasAntigas()
garantirPersistencia()
await iniciar()

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/app/sw.js').catch(() => { /* segue sem offline do shell */ })
}
