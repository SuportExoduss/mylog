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
  disponivel: 'Disponivel', com_pendencia: 'Com pendencia', restrito: 'Restrito',
  bloqueado: 'Bloqueado', manutencao: 'Em manutencao',
}
export const TOM_STATUS_VEICULO = {
  disponivel: 's-ok', com_pendencia: 's-atencao', restrito: 's-alerta',
  bloqueado: 's-critico', manutencao: 's-neutro',
}

export const ROTULO_PAPEL = {
  adm: 'Administrador', supervisor: 'Supervisor', colaborador: 'Colaborador',
  manutencao: 'Manutencao', auditoria: 'Auditoria',
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
  return elemento('span', { classe: `selo-status ${tom}`, texto })
}

export function dataCurta(iso) {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
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

// campos: [{ nome, rotulo, tipo, valor, opcoes, obrigatorio, dica }]
export function abrirModal({ titulo, subtitulo, campos = [], confirmar = 'Salvar', perigo = false, aoConfirmar }) {
  const area = document.getElementById('area-modal')
  limpar(area)

  const avisoErro = elemento('div', { classe: 'aviso aviso--erro oculto' })
  const controles = {}

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
    return elemento('div', { classe: 'campo' }, [
      elemento('label', { for: `campo-${campo.nome}`, texto: campo.rotulo }),
      entrada,
      campo.dica ? elemento('div', { classe: 'campo-dica', texto: campo.dica }) : null,
    ])
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
      const valores = {}
      for (const [nome, entrada] of Object.entries(controles)) valores[nome] = entrada.value.trim()
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
  setTimeout(() => formulario.querySelector('input, select, textarea')?.focus(), 30)
  return { fechar }
}

// ------------------------------------------------------------- estruturas

export function cabecalhoTela({ titulo, descricao, acoes = [] }) {
  return elemento('div', { classe: 'topo' }, [
    elemento('div', {}, [
      elemento('h1', { texto: titulo }),
      descricao ? elemento('p', { texto: descricao }) : null,
    ]),
    acoes.length ? elemento('div', { classe: 'topo-acoes' }, acoes) : null,
  ])
}

export function tabela(colunas, linhas) {
  return elemento('div', { classe: 'tabela-caixa' }, [
    elemento('table', {}, [
      elemento('thead', {}, [elemento('tr', {}, colunas.map((c) =>
        elemento('th', { texto: c, style: c === '' ? 'width:1%' : null })))]),
      elemento('tbody', {}, linhas),
    ]),
  ])
}

export function vazio(mensagem) {
  return elemento('div', { classe: 'vazio', texto: mensagem })
}
