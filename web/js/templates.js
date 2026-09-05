// Editor de checklist (roadmap 11).
// Toda pergunta e' uma verificacao visual: foto + OK/Ocorrencia. Nao ha tipo
// de resposta nem item condicional.
import { api } from './api.js'
import {
  elemento, cabecalhoTela, tabela, selo, vazio, abrirModal, notificar, menuAcoes, dataCurta,
  ROTULO_TIPO_VEICULO, ROTULO_PRIORIDADE, TOM_PRIORIDADE,
} from './ui.js'

const TIPOS = Object.entries(ROTULO_TIPO_VEICULO).map(([valor, rotulo]) => ({ valor, rotulo }))

const MODOS_FOTO = [
  { valor: 'obrigatorio', rotulo: 'Obrigatorio — abre a camera direto' },
  { valor: 'opcional', rotulo: 'Opcional — pergunta antes' },
  { valor: 'nao_capturar', rotulo: 'Nao capturar — segue sozinho' },
]

const PRIORIDADES = Object.entries(ROTULO_PRIORIDADE).map(([valor, rotulo]) => ({ valor, rotulo }))

const TOM_STATUS_TEMPLATE = { rascunho: 's-atencao', publicado: 's-ok', arquivado: 's-neutro' }

function idAPartirDo(texto, usados) {
  const base = texto
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'item'
  if (!usados.has(base)) return base
  let n = 2
  while (usados.has(`${base}_${n}`)) n += 1
  return `${base}_${n}`
}

// ------------------------------------------------------------------ criar

async function novoChecklist(contexto) {
  const { cargos } = await api.cargos()
  const area = document.getElementById('area-modal')

  const nome = elemento('input', { required: true, placeholder: 'Checklist padrao diario' })
  const codigo = elemento('input', { required: true, placeholder: 'diario-padrao' })
  const tipo = elemento('select', {}, TIPOS.map((t) =>
    elemento('option', { value: t.valor, texto: t.rotulo })))
  const assinatura = elemento('input', { type: 'checkbox' })
  const aviso = elemento('div', { classe: 'aviso aviso--erro oculto' })

  // "Todos" e' uma opcao real, nao a ausencia de escolha.
  const todos = elemento('input', { type: 'checkbox', checked: true })
  const caixasCargo = cargos.map((c) => {
    const caixa = elemento('input', { type: 'checkbox', value: c.id })
    return { cargo: c, caixa, no: elemento('label', { classe: 'campo-linha' }, [caixa, c.nome]) }
  })
  const listaCargos = elemento('div', { classe: 'oculto' }, caixasCargo.map((x) => x.no))
  todos.addEventListener('change', () => listaCargos.classList.toggle('oculto', todos.checked))

  // Ritmo do modelo (roadmap 11.2.1). Avulso e' o padrao: um checklist que
  // ninguem configurou nao deveria comecar cobrando falta de ninguem.
  const periodicidade = elemento('select', {}, [
    { valor: 'avulso', rotulo: 'Avulso — feito quando precisa' },
    { valor: 'diario', rotulo: 'Diario — nos dias marcados' },
    { valor: 'semanal', rotulo: 'Semanal' },
    { valor: 'mensal', rotulo: 'Mensal' },
  ].map((o) => elemento('option', { value: o.valor, texto: o.rotulo })))

  const DIAS = [
    { n: 1, nome: 'seg' }, { n: 2, nome: 'ter' }, { n: 3, nome: 'qua' },
    { n: 4, nome: 'qui' }, { n: 5, nome: 'sex' }, { n: 6, nome: 'sab' }, { n: 0, nome: 'dom' },
  ]
  // Segunda a sexta ja marcados: e' o ritmo real da operacao — o relatorio do
  // PROLOG tem ~170 checklists por dia util contra 62 no sabado e 13 no
  // domingo. O padrao certo poupa o erro mais provavel.
  const caixasDia = DIAS.map((d) => {
    const caixa = elemento('input', { type: 'checkbox', value: String(d.n) })
    caixa.checked = d.n >= 1 && d.n <= 5
    return { ...d, caixa, no: elemento('label', { classe: 'dia-semana' }, [caixa, d.nome]) }
  })
  const campoDias = elemento('div', { classe: 'campo oculto' }, [
    elemento('label', { texto: 'Obrigatorio em quais dias' }),
    elemento('div', { classe: 'dias-semana' }, caixasDia.map((d) => d.no)),
  ])

  const diaSemana = elemento('select', {},
    DIAS.map((d) => elemento('option', { value: String(d.n), texto: d.nome })))
  const campoDiaSemana = elemento('div', { classe: 'campo oculto' }, [
    elemento('label', { texto: 'Vence em que dia da semana' }), diaSemana,
  ])

  const temPrazo = elemento('input', { type: 'checkbox' })
  const horario = elemento('input', { type: 'time', value: '08:30' })
  const campoHorario = elemento('div', { classe: 'campo oculto' }, [
    elemento('label', { texto: 'Horario limite' }), horario,
    elemento('div', { classe: 'campo-dica',
      texto: 'Feito depois disso entra como atrasado. Nao impede de fazer: checklist atrasado ainda e melhor que checklist nenhum.' }),
  ])
  const linhaPrazo = elemento('div', { classe: 'campo oculto' }, [
    elemento('label', { classe: 'campo-linha' }, [temPrazo, 'Tem horario limite para ser realizado?']),
  ])

  function ajustarRitmo() {
    const p = periodicidade.value
    campoDias.classList.toggle('oculto', p !== 'diario')
    campoDiaSemana.classList.toggle('oculto', p !== 'semanal')
    // Prazo so faz sentido para quem e' cobrado. Avulso ninguem cobra, entao a
    // pergunta nem aparece — e o servidor recusa se vier assim mesmo.
    linhaPrazo.classList.toggle('oculto', p === 'avulso')
    if (p === 'avulso') temPrazo.checked = false
    campoHorario.classList.toggle('oculto', p === 'avulso' || !temPrazo.checked)
  }
  periodicidade.addEventListener('change', ajustarRitmo)
  temPrazo.addEventListener('change', ajustarRitmo)

  // O codigo acompanha o nome ate alguem digitar um codigo proprio.
  let codigoTocado = false
  codigo.addEventListener('input', () => { codigoTocado = true })
  nome.addEventListener('input', () => {
    if (!codigoTocado) codigo.value = idAPartirDo(nome.value, new Set()).replace(/_/g, '-')
  })

  const formulario = elemento('form', {
    classe: 'modal',
    aoSubmit: async (evento) => {
      evento.preventDefault()
      aviso.classList.add('oculto')
      const selecionados = todos.checked
        ? ['*']
        : caixasCargo.filter((x) => x.caixa.checked).map((x) => x.cargo.id)
      if (!selecionados.length) {
        aviso.textContent = 'Escolha ao menos um cargo, ou marque "todos".'
        aviso.classList.remove('oculto')
        return
      }
      try {
        const { template } = await api.criarTemplate({
          nome: nome.value.trim(), codigo: codigo.value.trim().toLowerCase(),
          tipo_veiculo: tipo.value, cargos_liberados: selecionados,
          exige_assinatura: assinatura.checked,
          periodicidade: periodicidade.value,
          dias_semana: periodicidade.value === 'diario'
            ? caixasDia.filter((d) => d.caixa.checked).map((d) => d.n)
            : [],
          dia_semana: periodicidade.value === 'semanal' ? Number(diaSemana.value) : null,
          horario_limite: temPrazo.checked && periodicidade.value !== 'avulso'
            ? horario.value : null,
          estrutura: { perguntas: [] },
        })
        area.replaceChildren()
        // Criado o rascunho, cai direto na configuracao das perguntas.
        contexto.irPara('templates', { id: template.id })
      } catch (falha) {
        aviso.textContent = falha.message
        aviso.classList.remove('oculto')
      }
    },
  }, [
    elemento('h3', { texto: 'Novo checklist' }),
    elemento('p', { classe: 'modal-sub',
      texto: 'Nasce como rascunho. So passa a valer no aplicativo quando for publicado.' }),
    aviso,
    elemento('div', { classe: 'campo' }, [elemento('label', { texto: 'Nome' }), nome]),
    elemento('div', { classe: 'campo' }, [
      elemento('label', { texto: 'Codigo' }), codigo,
      elemento('div', { classe: 'campo-dica', texto: 'Identificador estavel entre versoes.' }),
    ]),
    elemento('div', { classe: 'campo' }, [
      elemento('label', { texto: 'Tipo de veiculo' }), tipo,
      elemento('div', { classe: 'campo-dica', texto: 'O checklist so aparece para veiculos deste tipo.' }),
    ]),
    elemento('div', { classe: 'campo' }, [
      elemento('label', { texto: 'Cargos liberados' }),
      elemento('label', { classe: 'campo-linha' }, [todos, 'Todos os cargos']),
      listaCargos,
      elemento('div', { classe: 'campo-dica',
        texto: 'Se o cargo da pessoa nao estiver liberado, o checklist nem aparece para ela.' }),
    ]),
    elemento('div', { classe: 'campo' }, [
      elemento('label', { classe: 'campo-linha' }, [assinatura, 'Exigir assinatura digital ao finalizar']),
    ]),
    elemento('div', { classe: 'campo' }, [
      elemento('label', { texto: 'Com que frequencia' }), periodicidade,
      elemento('div', { classe: 'campo-dica',
        texto: 'Avulso nao cobra ninguem. As demais entram na conta de quem usa veiculo todos os dias.' }),
    ]),
    campoDias,
    campoDiaSemana,
    linhaPrazo,
    campoHorario,
    elemento('div', { classe: 'modal-acoes' }, [
      elemento('button', { classe: 'botao botao--suave', type: 'button', texto: 'Cancelar',
        aoClick: () => area.replaceChildren() }),
      elemento('button', { classe: 'botao', type: 'submit', texto: 'Criar rascunho' }),
    ]),
  ])

  area.replaceChildren(elemento('div', { classe: 'fundo-modal' }, [formulario]))
}

// ------------------------------------------------------------------ lista

export async function telaTemplates(raiz, contexto) {
  if (contexto.parametros.id) return editor(raiz, contexto, contexto.parametros.id)

  const areaLista = elemento('div', {})
  const { cargos } = await api.cargos()
  const nomeCargo = (id) => cargos.find((c) => c.id === id)?.nome || id

  async function recarregar() {
    const { templates } = await api.templates()
    areaLista.replaceChildren(desenhar(templates))
  }

  function desenhar(templates) {
    if (!templates.length) return vazio('Nenhum checklist ainda. Crie o primeiro modelo da empresa.')

    return tabela(['Checklist', 'Veiculo', 'Cargos', 'Versao', 'Situacao', 'Publicado', ''],
      templates.map((t) => {
        const acoes = [{
          rotulo: t.status === 'rascunho' ? 'Editar perguntas' : 'Ver perguntas',
          aoClick: () => contexto.irPara('templates', { id: t.id }),
        }]
        if (t.status === 'publicado') {
          acoes.push({ rotulo: 'Criar nova versao', aoClick: async () => {
            try {
              const { template } = await api.novaVersaoTemplate(t.id)
              notificar(`Versao ${template.versao} criada como rascunho.`)
              contexto.irPara('templates', { id: template.id })
            } catch (falha) { notificar(falha.message) }
          } })
        }
        if (t.status === 'rascunho') {
          acoes.push({ rotulo: 'Descartar rascunho', perigo: true, separar: true, aoClick: async () => {
            try {
              await api.descartarTemplate(t.id)
              notificar('Rascunho descartado.')
              await recarregar()
            } catch (falha) { notificar(falha.message) }
          } })
        }

        const cargosTexto = t.cargos_liberados.includes('*')
          ? 'Todos'
          : t.cargos_liberados.map(nomeCargo).join(', ')

        return elemento('tr', {}, [
          elemento('td', {}, [
            elemento('div', { classe: 'celula-forte', texto: t.nome }),
            elemento('div', { classe: 'celula-fraca dado', texto: t.codigo }),
          ]),
          elemento('td', { classe: 'celula-fraca', texto: ROTULO_TIPO_VEICULO[t.tipo_veiculo] || t.tipo_veiculo }),
          elemento('td', { classe: 'celula-fraca limite-texto-curto', texto: cargosTexto }),
          elemento('td', { classe: 'celula-fraca dado', texto: `v${t.versao}` }),
          elemento('td', {}, [
            elemento('div', { classe: 'card-detalhe' }, [
              selo(t.status, TOM_STATUS_TEMPLATE[t.status]),
              t.exige_assinatura ? selo('assinatura', 's-neutro') : null,
              t.periodicidade && t.periodicidade !== 'avulso'
                ? selo(t.periodicidade, 's-marca') : null,
              t.horario_limite ? selo(`ate ${t.horario_limite}`, 's-atencao') : null,
            ].filter(Boolean)),
            elemento('div', { classe: 'celula-fraca esp-t-1',
              texto: `${t.total_perguntas} pergunta(s)` }),
          ]),
          elemento('td', { classe: 'celula-fraca', texto: t.publicado_em ? dataCurta(t.publicado_em) : '—' }),
          elemento('td', { classe: 'celula-acoes' }, [menuAcoes(acoes)]),
        ])
      }))
  }

  raiz.append(
    cabecalhoTela({
      titulo: 'Checklists',
      descricao: 'Modelos versionados. O aplicativo executa a versao publicada do tipo de veiculo e do cargo.',
      acoes: [elemento('button', { classe: 'botao', texto: '+ Novo checklist',
        aoClick: () => novoChecklist(contexto) })],
    }),
    areaLista,
  )
  await recarregar()
}

// ----------------------------------------------------------------- editor

async function editor(raiz, contexto, id) {
  const { template } = await api.template(id)
  const editavel = template.status === 'rascunho'
  const estrutura = template.estrutura
  if (!Array.isArray(estrutura.perguntas)) estrutura.perguntas = []

  const areaPerguntas = elemento('div', {})
  const areaAviso = elemento('div', {})

  const idsUsados = () => new Set(estrutura.perguntas.map((p) => p.id))

  async function salvar() {
    await api.salvarTemplate(template.id, { estrutura })
    await conferir()
  }

  async function conferir() {
    const r = await api.conferirTemplate(estrutura)
    areaAviso.replaceChildren(
      r.valido
        ? elemento('div', { classe: 'aviso aviso--ok',
            texto: `Estrutura valida: ${r.resumo.perguntas} pergunta(s), ${r.resumo.opcoes_que_abrem_ocorrencia} opcao(oes) que abrem ocorrencia. Pronto para publicar.` })
        : elemento('div', { classe: 'aviso aviso--erro', texto: r.mensagem }),
    )
    return r.valido
  }

  // ---------------------------------------------------------- pergunta

  function formularioPergunta(indice) {
    const criando = indice === null
    const p = criando
      ? { foto_ok: 'obrigatorio', max_fotos_ok: 4, opcoes_problema: [] }
      : estrutura.perguntas[indice]

    abrirModal({
      titulo: criando ? 'Nova pergunta' : 'Editar pergunta',
      subtitulo: 'O colaborador ve a foto de exemplo e decide entre Ocorrencia e OK.',
      campos: [
        { nome: 'titulo', rotulo: 'Titulo da pergunta', valor: p.titulo || '', obrigatorio: true,
          dica: 'E o que ele le na tela do celular. Ex.: Lateral esquerda.' },
        { nome: 'foto_exibicao', rotulo: 'Foto de exibicao (URL)', valor: p.foto_exibicao || '',
          dica: 'Exemplo de como a foto deve ser tirada. Aparece no meio da tela.' },
        { nome: 'foto_ok', rotulo: 'Captura de foto ao marcar OK', tipo: 'select',
          opcoes: MODOS_FOTO, valor: p.foto_ok || 'obrigatorio' },
        { nome: 'max_fotos_ok', rotulo: 'Maximo de fotos no OK', tipo: 'number',
          valor: p.max_fotos_ok ?? 4,
          visivelQuando: (v) => v.foto_ok !== 'nao_capturar' },
      ],
      confirmar: criando ? 'Adicionar' : 'Salvar',
      aoConfirmar: async (v) => {
        const nova = {
          id: criando ? idAPartirDo(v.titulo, idsUsados()) : p.id,
          titulo: v.titulo,
          foto_exibicao: v.foto_exibicao || null,
          foto_ok: v.foto_ok,
          max_fotos_ok: v.foto_ok === 'nao_capturar' ? 1 : Number(v.max_fotos_ok || 1),
          opcoes_problema: p.opcoes_problema || [],
        }
        if (criando) estrutura.perguntas.push(nova)
        else estrutura.perguntas[indice] = nova
        await salvar()
        desenhar()
      },
    })
  }

  function formularioOpcao(iPergunta, iOpcao) {
    const criando = iOpcao === null
    const pergunta = estrutura.perguntas[iPergunta]
    const o = criando
      ? { foto: 'obrigatorio', max_fotos: 3, abrir_ocorrencia: true, prioridade: 'media' }
      : pergunta.opcoes_problema[iOpcao]

    abrirModal({
      titulo: criando ? 'Nova opcao de problema' : 'Editar opcao',
      subtitulo: `${pergunta.titulo} — o colaborador escolhe daqui em vez de escrever.`,
      campos: [
        { nome: 'nome', rotulo: 'Nome da opcao', valor: o.nome || '', obrigatorio: true,
          dica: 'Ex.: Lataria amassada.' },
        { nome: 'foto', rotulo: 'Obrigatoriedade de fotos', tipo: 'select',
          opcoes: MODOS_FOTO, valor: o.foto || 'obrigatorio' },
        { nome: 'max_fotos', rotulo: 'Maximo de fotos', tipo: 'number', valor: o.max_fotos ?? 3,
          visivelQuando: (v) => v.foto !== 'nao_capturar' },
        { nome: 'abrir_ocorrencia', rotulo: 'Abrir ocorrencia?', tipo: 'select',
          opcoes: [{ valor: 'sim', rotulo: 'Sim — vai para a fila da frota' },
                   { valor: 'nao', rotulo: 'Nao — so registra no checklist' }],
          valor: o.abrir_ocorrencia === false ? 'nao' : 'sim' },
        { nome: 'prioridade', rotulo: 'Prioridade da ocorrencia', tipo: 'select',
          opcoes: PRIORIDADES, valor: o.prioridade || 'media',
          dica: 'Critica bloqueia o veiculo na hora, e so a frota libera com motivo.',
          visivelQuando: (v) => v.abrir_ocorrencia === 'sim' },
      ],
      confirmar: criando ? 'Adicionar opcao' : 'Salvar',
      aoConfirmar: async (v) => {
        const usados = new Set((pergunta.opcoes_problema || []).map((x) => x.id))
        if (!criando) usados.delete(o.id)
        const abre = v.abrir_ocorrencia === 'sim'
        const nova = {
          id: criando ? idAPartirDo(v.nome, usados) : o.id,
          nome: v.nome,
          foto: v.foto,
          max_fotos: v.foto === 'nao_capturar' ? 1 : Number(v.max_fotos || 1),
          abrir_ocorrencia: abre,
        }
        if (abre) nova.prioridade = v.prioridade
        if (criando) pergunta.opcoes_problema.push(nova)
        else pergunta.opcoes_problema[iOpcao] = nova
        await salvar()
        desenhar()
      },
    })
  }

  async function mover(indice, direcao) {
    const destino = indice + direcao
    if (destino < 0 || destino >= estrutura.perguntas.length) return
    const lista = estrutura.perguntas
    ;[lista[indice], lista[destino]] = [lista[destino], lista[indice]]
    await salvar()
    desenhar()
  }

  // ------------------------------------------------------------ desenho

  function blocoPergunta(p, i) {
    const marcas = [
      selo(MODOS_FOTO.find((m) => m.valor === p.foto_ok)?.rotulo.split(' —')[0] || p.foto_ok,
        p.foto_ok === 'obrigatorio' ? 's-marca' : 's-neutro'),
    ]
    if (p.foto_ok !== 'nao_capturar') marcas.push(selo(`ate ${p.max_fotos_ok} foto(s)`, 's-neutro'))
    if (p.foto_exibicao) marcas.push(selo('com foto de exemplo', 's-neutro'))

    const acoes = editavel ? [
      { rotulo: '+ Opcao de problema', aoClick: () => formularioOpcao(i, null) },
      { rotulo: 'Editar pergunta', aoClick: () => formularioPergunta(i) },
      { rotulo: 'Mover para cima', aoClick: () => mover(i, -1) },
      { rotulo: 'Mover para baixo', aoClick: () => mover(i, 1) },
      { rotulo: 'Remover pergunta', perigo: true, separar: true, aoClick: async () => {
        estrutura.perguntas.splice(i, 1)
        await salvar()
        desenhar()
      } },
    ] : []

    const opcoes = (p.opcoes_problema || []).length
      ? tabela(['Opcao', 'Foto', 'Ocorrencia', ''], p.opcoes_problema.map((o, j) =>
          elemento('tr', {}, [
            elemento('td', {}, [
              elemento('div', { classe: 'celula-forte', texto: o.nome }),
              elemento('div', { classe: 'celula-fraca dado', texto: o.id }),
            ]),
            elemento('td', { classe: 'celula-fraca' }, [
              elemento('div', { texto: o.foto }),
              o.foto !== 'nao_capturar' ? elemento('div', { texto: `ate ${o.max_fotos}` }) : null,
            ]),
            elemento('td', {}, [
              o.abrir_ocorrencia
                ? selo(ROTULO_PRIORIDADE[o.prioridade], TOM_PRIORIDADE[o.prioridade])
                : selo('so registra', 's-neutro'),
            ]),
            elemento('td', { classe: 'celula-acoes' }, [menuAcoes(editavel ? [
              { rotulo: 'Editar', aoClick: () => formularioOpcao(i, j) },
              { rotulo: 'Remover', perigo: true, aoClick: async () => {
                p.opcoes_problema.splice(j, 1)
                await salvar()
                desenhar()
              } },
            ] : [])]),
          ])))
      : vazio('Sem opcoes de problema. Sem elas o colaborador nao tem o que escolher ao marcar Ocorrencia.')

    return elemento('section', { classe: 'secao' }, [
      elemento('div', { classe: 'secao-titulo' }, [
        elemento('div', {}, [
          elemento('h2', { texto: `${i + 1}. ${p.titulo}` }),
          elemento('div', { classe: 'celula-fraca dado', texto: p.id }),
        ]),
        elemento('div', { classe: 'linha' }, [
          elemento('div', { classe: 'card-detalhe' }, marcas),
          menuAcoes(acoes),
        ]),
      ]),
      opcoes,
    ])
  }

  function desenhar() {
    areaPerguntas.replaceChildren(
      estrutura.perguntas.length
        ? elemento('div', {}, estrutura.perguntas.map(blocoPergunta))
        : vazio('Nenhuma pergunta ainda. Cada pergunta e uma verificacao visual do veiculo.'),
    )
  }

  // --------------------------------------------------------- cabecalho

  const acoes = [elemento('button', {
    classe: 'botao botao--suave', texto: '← Checklists',
    aoClick: () => contexto.irPara('templates'),
  })]

  if (editavel) {
    acoes.push(elemento('button', {
      classe: 'botao botao--suave', texto: '+ Pergunta',
      aoClick: () => formularioPergunta(null),
    }))
    acoes.push(elemento('button', {
      classe: 'botao', texto: 'Publicar versao',
      aoClick: async () => {
        if (!(await conferir())) { notificar('Corrija a estrutura antes de publicar.'); return }
        abrirModal({
          titulo: `Publicar versao ${template.versao}?`,
          subtitulo: 'Depois de publicada esta versao nao pode ser alterada — mudancas viram a versao seguinte. A versao publicada anterior sera arquivada.',
          confirmar: 'Publicar',
          aoConfirmar: async () => {
            await api.publicarTemplate(template.id)
            notificar('Versao publicada. O aplicativo passa a usar esta.')
            contexto.irPara('templates')
          },
        })
      },
    }))
  }

  raiz.append(
    cabecalhoTela({
      titulo: template.nome,
      descricao: `${template.codigo} · versao ${template.versao} · ${ROTULO_TIPO_VEICULO[template.tipo_veiculo]}`
        + (template.exige_assinatura ? ' · exige assinatura' : '')
        + (editavel ? ' — alteracoes salvam sozinhas' : ' — somente leitura'),
      acoes,
    }),
    areaAviso,
    areaPerguntas,
  )

  desenhar()
  if (editavel) await conferir()
}
