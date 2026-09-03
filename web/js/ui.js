// Blocos de interface reaproveitados pelas telas.

// Toda insercao de texto passa por aqui: nada de innerHTML com dado do banco.
export function elemento(tag, atributos = {}, filhos = []) {
  const el = document.createElement(tag)
  for (const [chave, valor] of Object.entries(atributos)) {
    if (valor === null || valor === undefined || valor === false) continue
    if (chave === 'classe') el.className = valor
    else if (chave === 'texto') el.textContent = valor
    else if (chave === 'html') el.innerHTML = valor
    else if (chave.startsWith('ao')) el.addEventListener(chave.slice(2).toLowerCase(), valor)
    else if (chave === 'dados') Object.assign(el.dataset, valor)
    else el.setAttribute(chave, valor)
  }
  for (const filho of [].concat(filhos)) {
    if (filho === null || filho === undefined || filho === false) continue
    el.append(typeof filho === 'string' ? document.createTextNode(filho) : filho)
  }
  return el
}

export function limpar(no) { while (no.firstChild) no.removeChild(no.firstChild) }


// --------------------------------------------------------------- marca

// Simbolo do MyLog: um registro conferido e assinado — quadrado de ficha,
// visto de verificacao e a linha de assinatura embaixo. Herda currentColor,
// entao serve em qualquer fundo e em qualquer tema sem segunda versao.
export function simbolo(classe = 'marca-simbolo') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 32 32')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', classe)
  svg.innerHTML = `
    <rect x="2.6" y="2.6" width="26.8" height="26.8" rx="7.5"
          stroke="currentColor" stroke-width="2.4"/>
    <path d="M9.8 15.6 L14 19.8 L22.4 11"
          stroke="currentColor" stroke-width="3"
          stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M10.2 24.2 H21.8"
          stroke="currentColor" stroke-width="2.4"
          stroke-linecap="round" opacity=".45"/>`
  return svg
}

// Assinatura visual completa: simbolo + nome.
export function marca({ grande = false } = {}) {
  return elemento('div', { classe: 'marca' }, [
    simbolo(grande ? 'marca-simbolo marca-simbolo--grande' : 'marca-simbolo'),
    elemento('div', {
      classe: grande ? 'marca-nome marca-nome--grande' : 'marca-nome',
      html: 'My<span>Log</span>',
    }),
  ])
}

// ---------------------------------------------------------------- tema

const CHAVE_TEMA = 'mylog.tema'

export function aplicarTemaGuardado() {
  try {
    const guardado = localStorage.getItem(CHAVE_TEMA)
    if (guardado) document.documentElement.dataset.tema = guardado
  } catch { /* navegador sem storage: segue a preferencia do sistema */ }
}

export function alternarTema() {
  const raiz = document.documentElement
  const escuroAgora = raiz.dataset.tema
    ? raiz.dataset.tema === 'escuro'
    : matchMedia('(prefers-color-scheme: dark)').matches
  const novo = escuroAgora ? 'claro' : 'escuro'
  raiz.dataset.tema = novo
  try { localStorage.setItem(CHAVE_TEMA, novo) } catch { /* sem storage, vale so nesta aba */ }
  return novo
}

// --------------------------------------------------------------- rotulos

export const ROTULO_STATUS_USUARIO = {
  pendente: 'Pendente', ativo: 'Ativo', bloqueado: 'Bloqueado',
  suspenso: 'Suspenso', desativado: 'Desativado',
}
export const TOM_STATUS_USUARIO = {
  pendente: 's-atencao', ativo: 's-ok', bloqueado: 's-critico',
  suspenso: 's-alerta', desativado: 's-neutro',
}

export const ROTULO_STATUS_VEICULO = {
  disponivel: 'Disponivel', com_pendencia: 'Com pendencia',
  bloqueado: 'Bloqueado', manutencao: 'Em manutencao',
}
export const TOM_STATUS_VEICULO = {
  disponivel: 's-ok', com_pendencia: 's-atencao',
  bloqueado: 's-critico', manutencao: 's-neutro',
}

export const ROTULO_TIPO_VEICULO = {
  compacto_leve: 'Compacto leve', pickup: 'Pick-up', quatro_x_quatro: '4x4',
  motocicleta: 'Motocicleta', caminhao: 'Caminhao',
}

// Dois niveis, e apenas dois (roadmap 3).
export const ROTULO_NIVEL = { frota: 'Equipe da frota', colaborador: 'Colaborador' }

export const ROTULO_PRIORIDADE = {
  baixa: 'Baixa', media: 'Media', alta: 'Alta', critica: 'Critica',
}
export const TOM_PRIORIDADE = {
  baixa: 's-neutro', media: 's-atencao', alta: 's-alerta', critica: 's-critico',
}

export const ROTULO_STATUS_OCORRENCIA = {
  aberta: 'Em aberto', em_tratamento: 'Em tratamento',
  resolvida: 'Resolvida', encerrada: 'Encerrada',
}
export const TOM_STATUS_OCORRENCIA = {
  aberta: 's-critico', em_tratamento: 's-alerta',
  resolvida: 's-ok', encerrada: 's-neutro',
}

export const ROTULO_STATUS_SOLICITACAO = {
  pendente: 'Pendente', aprovada: 'Aprovada', recusada: 'Recusada', em_uso: 'Em uso',
  devolvida: 'Devolvida', devolvida_com_atraso: 'Devolvida com atraso', cancelada: 'Cancelada',
}
export const TOM_STATUS_SOLICITACAO = {
  pendente: 's-atencao', aprovada: 's-marca', recusada: 's-neutro', em_uso: 's-alerta',
  devolvida: 's-ok', devolvida_com_atraso: 's-critico', cancelada: 's-neutro',
}

export const ROTULO_STATUS_PREVENTIVA = {
  em_dia: 'Em dia', proxima: 'Proxima', muito_proxima: 'Muito proxima',
  vencida: 'Vencida', realizada: 'Realizada',
}
export const TOM_STATUS_PREVENTIVA = {
  em_dia: 's-ok', proxima: 's-atencao', muito_proxima: 's-alerta',
  vencida: 's-critico', realizada: 's-neutro',
}

export function selo(texto, tom = 's-neutro') {
  return elemento('span', { classe: `selo ${tom}`, texto })
}

export function dataCurta(iso) {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Janela de solicitacao: data + hora, que e' o que a reserva significa.
export function dataHora(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export function cpfFormatado(cpf) {
  const n = String(cpf || '').replace(/\D/g, '')
  if (n.length !== 11) return cpf || '—'
  return `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9)}`
}

export function numero(valor) {
  return Number(valor || 0).toLocaleString('pt-BR')
}

// --------------------------------------------------------------- avisos

let temporizadorNotificacao = null
export function notificar(mensagem) {
  document.querySelector('.notificacao')?.remove()
  const no = elemento('div', { classe: 'notificacao', texto: mensagem })
  document.body.append(no)
  clearTimeout(temporizadorNotificacao)
  temporizadorNotificacao = setTimeout(() => no.remove(), 4000)
}

// ---------------------------------------------------------------- modal

// campos: [{ nome, rotulo, tipo, valor, opcoes, obrigatorio, dica, visivelQuando }]
//
// visivelQuando: (valores) => boolean — esconde o campo enquanto ele nao fizer
// sentido. Um formulario que mostra "minimo aceito" para uma pergunta de
// assinatura ensina o usuario errado.
export function abrirModal({ titulo, subtitulo, campos = [], confirmar = 'Salvar', perigo = false, aoConfirmar }) {
  const area = document.getElementById('area-modal')
  limpar(area)

  const avisoErro = elemento('div', { classe: 'aviso aviso--erro oculto' })
  const controles = {}
  const envolucros = {}

  function valoresAtuais() {
    const v = {}
    for (const [nome, entrada] of Object.entries(controles)) v[nome] = entrada.value
    return v
  }

  function aplicarVisibilidade() {
    const valores = valoresAtuais()
    for (const campo of campos) {
      if (!campo.visivelQuando) continue
      envolucros[campo.nome]?.classList.toggle('oculto', !campo.visivelQuando(valores))
    }
  }

  const corpoCampos = campos.map((campo) => {
    let entrada
    if (campo.tipo === 'select') {
      entrada = elemento('select', { id: `campo-${campo.nome}` },
        campo.opcoes.map((op) => elemento('option', { value: op.valor, texto: op.rotulo,
          selected: op.valor === campo.valor })))
    } else if (campo.tipo === 'textarea') {
      entrada = elemento('textarea', { id: `campo-${campo.nome}`, rows: 3 })
      entrada.value = campo.valor ?? ''
    } else {
      entrada = elemento('input', { id: `campo-${campo.nome}`, type: campo.tipo || 'text' })
      entrada.value = campo.valor ?? ''
    }
    if (campo.obrigatorio) entrada.required = true
    controles[campo.nome] = entrada
    entrada.addEventListener('change', aplicarVisibilidade)

    const envolucro = elemento('div', { classe: 'campo' }, [
      elemento('label', { for: `campo-${campo.nome}`, texto: campo.rotulo }),
      entrada,
      campo.dica ? elemento('div', { classe: 'campo-dica', texto: campo.dica }) : null,
    ])
    envolucros[campo.nome] = envolucro
    return envolucro
  })

  const botaoConfirmar = elemento('button', {
    classe: `botao${perigo ? ' botao--perigo' : ''}`, type: 'submit', texto: confirmar,
  })

  const fechar = () => limpar(area)

  const formulario = elemento('form', {
    classe: 'modal',
    aoSubmit: async (evento) => {
      evento.preventDefault()
      avisoErro.classList.add('oculto')
      botaoConfirmar.disabled = true
      // Campo escondido nao participa do resultado: se ele nao fazia sentido
      // para este tipo, o valor que sobrou nele tambem nao faz.
      const valores = {}
      for (const campo of campos) {
        const visivel = !campo.visivelQuando || campo.visivelQuando(valoresAtuais())
        valores[campo.nome] = visivel ? controles[campo.nome].value.trim() : ''
      }
      try {
        await aoConfirmar(valores)
        fechar()
      } catch (falha) {
        avisoErro.textContent = falha.message
        avisoErro.classList.remove('oculto')
        botaoConfirmar.disabled = false
      }
    },
  }, [
    elemento('h3', { texto: titulo }),
    subtitulo ? elemento('p', { classe: 'modal-sub', texto: subtitulo }) : null,
    avisoErro,
    ...corpoCampos,
    elemento('div', { classe: 'modal-acoes' }, [
      elemento('button', { classe: 'botao botao--suave', type: 'button', texto: 'Cancelar', aoClick: fechar }),
      botaoConfirmar,
    ]),
  ])

  const fundo = elemento('div', {
    classe: 'fundo-modal',
    aoClick: (evento) => { if (evento.target === fundo) fechar() },
  }, [formulario])

  area.append(fundo)
  aplicarVisibilidade()
  setTimeout(() => formulario.querySelector('input, select, textarea')?.focus(), 30)
  return { fechar }
}

// ------------------------------------------------------------- estruturas

// ------------------------------------------------------------ menu de acoes

// Roadmap 21: nenhuma lista tem botao solto na linha. Botao visivel em cada
// linha polui a leitura, e a tabela existe para ser lida antes de ser clicada.
// acoes: [{ rotulo, aoClick, perigo?, separar? }]
export function menuAcoes(acoes) {
  const uteis = acoes.filter(Boolean)
  if (!uteis.length) return elemento('span', {})

  const lista = elemento('div', { classe: 'menu-lista oculto', role: 'menu' },
    uteis.map((acao) => elemento('button', {
      classe: `menu-item${acao.perigo ? ' menu-item--perigo' : ''}${acao.separar ? ' menu-item--separado' : ''}`,
      type: 'button',
      texto: acao.rotulo,
      aoClick: (evento) => { evento.stopPropagation(); fechar(); acao.aoClick() },
    })))

  const gatilho = elemento('button', {
    classe: 'botao botao--icone', type: 'button',
    'aria-label': 'Acoes', 'aria-haspopup': 'menu', texto: '⋯',
    aoClick: (evento) => { evento.stopPropagation(); alternar() },
  })

  const caixa = elemento('div', { classe: 'menu' }, [gatilho, lista])

  function fechar() {
    lista.classList.add('oculto')
    document.removeEventListener('click', fechar)
  }
  function alternar() {
    const aberto = !lista.classList.contains('oculto')
    // So um menu aberto por vez na tela.
    for (const outro of document.querySelectorAll('.menu-lista')) outro.classList.add('oculto')
    if (aberto) return fechar()
    lista.classList.remove('oculto')
    // Se o menu fica perto do rodape, abre para cima.
    const espacoAbaixo = window.innerHeight - caixa.getBoundingClientRect().bottom
    lista.classList.toggle('menu-lista--acima', espacoAbaixo < 200)
    setTimeout(() => document.addEventListener('click', fechar), 0)
  }

  return caixa
}

export function cabecalhoTela({ titulo, descricao, acoes = [] }) {
  return elemento('header', { classe: 'topo' }, [
    elemento('div', {}, [
      elemento('h1', { texto: titulo }),
      descricao ? elemento('p', { texto: descricao }) : null,
    ]),
    acoes.length ? elemento('div', { classe: 'topo-acoes' }, acoes) : null,
  ])
}

// Coluna com rotulo vazio e' coluna de acoes: encolhe ao conteudo.
// A caixa rola na horizontal sozinha — a pagina nunca rola de lado.
export function tabela(colunas, linhas) {
  return elemento('div', { classe: 'tabela-caixa' }, [
    elemento('div', { classe: 'tabela-rolagem' }, [
      elemento('table', {}, [
        elemento('thead', {}, [elemento('tr', {}, colunas.map((c) =>
          elemento('th', { texto: c, classe: c === '' ? 'celula-acoes' : null })))]),
        elemento('tbody', {}, linhas),
      ]),
    ]),
  ])
}

export function vazio(mensagem) {
  return elemento('div', { classe: 'vazio', texto: mensagem })
}
