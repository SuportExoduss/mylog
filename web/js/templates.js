// Editor de template de checklist (secoes 11 e 12).
// O checklist e' produto configuravel: quem monta e' o ADM, na tela, sem codigo.
// Uma versao publicada nunca e' editada — o botao vira "Nova versao".
import { api } from './api.js'
import {
  elemento, cabecalhoTela, tabela, selo, vazio, abrirModal, notificar, dataCurta,
} from './ui.js'

const TIPOS_ITEM = [
  { valor: 'ok_nok', rotulo: 'OK / Nao OK' },
  { valor: 'sim_nao', rotulo: 'Sim / Nao' },
  { valor: 'numero', rotulo: 'Numero com limite' },
  { valor: 'selecao', rotulo: 'Selecao de opcoes' },
  { valor: 'texto', rotulo: 'Texto livre' },
  { valor: 'foto', rotulo: 'Foto' },
  { valor: 'assinatura', rotulo: 'Assinatura' },
  { valor: 'datahora', rotulo: 'Data / hora' },
]

// Tipos que produzem juizo de conformidade — espelha o motor no servidor.
const TIPOS_AVALIAVEIS = new Set(['ok_nok', 'sim_nao', 'numero', 'selecao'])

const CRITICIDADES = [
  { valor: 'informativo', rotulo: 'Informativo' },
  { valor: 'baixo', rotulo: 'Baixo' },
  { valor: 'medio', rotulo: 'Medio' },
  { valor: 'alto', rotulo: 'Alto' },
  { valor: 'critico', rotulo: 'Critico' },
]

const TOM_CRITICIDADE = {
  informativo: 's-neutro', baixo: 's-neutro', medio: 's-atencao',
  alto: 's-alerta', critico: 's-critico',
}

const TOM_STATUS_TEMPLATE = { rascunho: 's-atencao', publicado: 's-ok', arquivado: 's-neutro' }

const OPERADORES = [
  { valor: 'igual', rotulo: 'for igual a' },
  { valor: 'diferente', rotulo: 'for diferente de' },
  { valor: 'nao_conforme', rotulo: 'estiver nao conforme' },
  { valor: 'conforme', rotulo: 'estiver conforme' },
  { valor: 'maior', rotulo: 'for maior que' },
  { valor: 'menor', rotulo: 'for menor que' },
  { valor: 'preenchido', rotulo: 'estiver preenchido' },
]

function idAPartirDoRotulo(rotulo) {
  return rotulo
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'item'
}

function idUnico(base, usados) {
  if (!usados.has(base)) return base
  let n = 2
  while (usados.has(`${base}_${n}`)) n += 1
  return `${base}_${n}`
}

// ------------------------------------------------------------------ lista

export async function telaTemplates(raiz, contexto) {
  if (contexto.parametros.id) return editorTemplate(raiz, contexto, contexto.parametros.id)

  const podeEscrever = contexto.pode('templates.escrever')
  const areaLista = elemento('div', {})

  async function recarregar() {
    const { templates } = await api.templates()
    areaLista.replaceChildren(desenhar(templates))
  }

  function desenhar(templates) {
    if (!templates.length) {
      return vazio('Nenhum template ainda. Crie o primeiro checklist da empresa.')
    }
    return tabela(['Checklist', 'Versao', 'Tamanho', 'Situacao', 'Publicado em', ''],
      templates.map((t) => {
        const acoes = []
        acoes.push(elemento('button', {
          classe: 'botao botao--suave botao--mini',
          texto: t.status === 'rascunho' && podeEscrever ? 'Editar' : 'Ver',
          aoClick: () => contexto.irPara('templates', { id: t.id }),
        }))
        if (podeEscrever && t.status === 'publicado') {
          acoes.push(elemento('button', {
            classe: 'botao botao--suave botao--mini', texto: 'Nova versao',
            aoClick: async () => {
              try {
                const { template } = await api.novaVersaoTemplate(t.id)
                notificar(`Versao ${template.versao} criada como rascunho.`)
                contexto.irPara('templates', { id: template.id })
              } catch (falha) { notificar(falha.message) }
            },
          }))
        }
        return elemento('tr', {}, [
          elemento('td', {}, [
            elemento('div', { classe: 'celula-forte', texto: t.nome }),
            elemento('div', { classe: 'celula-fraca dado', texto: t.codigo }),
          ]),
          elemento('td', { classe: 'celula-fraca dado', texto: `v${t.versao}` }),
          elemento('td', { classe: 'celula-fraca',
            texto: `${t.total_secoes} secoes · ${t.total_itens} itens` }),
          elemento('td', {}, [selo(t.status, TOM_STATUS_TEMPLATE[t.status])]),
          elemento('td', { classe: 'celula-fraca', texto: t.publicado_em ? dataCurta(t.publicado_em) : '—' }),
          elemento('td', {}, [elemento('div', { classe: 'linha linha--fim' }, acoes)]),
        ])
      }))
  }

  function novoTemplate() {
    abrirModal({
      titulo: 'Novo checklist',
      subtitulo: 'Nasce como rascunho. So passa a valer quando for publicado.',
      campos: [
        { nome: 'nome', rotulo: 'Nome', obrigatorio: true, dica: 'Ex.: Checklist diario — caminhao' },
        { nome: 'codigo', rotulo: 'Codigo', obrigatorio: true,
          dica: 'Identificador estavel entre versoes. Ex.: diario-caminhao' },
        { nome: 'tipo_veiculo', rotulo: 'Tipo de veiculo (opcional)' },
      ],
      confirmar: 'Criar rascunho',
      aoConfirmar: async (valores) => {
        const { template } = await api.criarTemplate({
          ...valores,
          estrutura: { secoes: [{ id: 'geral', titulo: 'Geral', itens: [] }] },
        })
        contexto.irPara('templates', { id: template.id })
      },
    })
  }

  raiz.append(
    cabecalhoTela({
      titulo: 'Checklists',
      descricao: 'Modelos de inspecao versionados. O aplicativo executa a versao publicada.',
      acoes: podeEscrever
        ? [elemento('button', { classe: 'botao', texto: '+ Novo checklist', aoClick: novoTemplate })]
        : [],
    }),
    areaLista,
  )
  await recarregar()
}

// ----------------------------------------------------------------- editor

async function editorTemplate(raiz, contexto, id) {
  const { template } = await api.template(id)
  const editavel = template.status === 'rascunho' && contexto.pode('templates.escrever')
  const estrutura = template.estrutura

  const areaSecoes = elemento('div', {})
  const areaAviso = elemento('div', {})

  function idsUsados() {
    const usados = new Set()
    for (const secao of estrutura.secoes) for (const item of secao.itens) usados.add(item.id)
    return usados
  }

  // Itens que vem ANTES do item indicado — os unicos que uma condicao pode olhar.
  function itensAnteriores(secaoIndice, itemIndice) {
    const anteriores = []
    estrutura.secoes.forEach((secao, si) => {
      secao.itens.forEach((item, ii) => {
        if (si < secaoIndice || (si === secaoIndice && ii < itemIndice)) anteriores.push(item)
      })
    })
    return anteriores
  }

  async function salvar({ silencioso } = {}) {
    await api.salvarTemplate(template.id, { estrutura })
    if (!silencioso) notificar('Rascunho salvo.')
    await conferir()
  }

  async function conferir() {
    const resultado = await api.conferirTemplate(estrutura)
    areaAviso.replaceChildren(
      resultado.valido
        ? elemento('div', { classe: 'aviso aviso--ok',
            texto: `Estrutura valida: ${resultado.resumo.secoes} secoes, ${resultado.resumo.itens} itens. Pronto para publicar.` })
        : elemento('div', { classe: 'aviso aviso--erro', texto: resultado.mensagem }),
    )
    return resultado.valido
  }

  // ------------------------------------------------------------- itens

  function formularioItem(secaoIndice, itemIndice) {
    const criando = itemIndice === null
    const item = criando ? { tipo: 'ok_nok', criticidade: 'medio' } : estrutura.secoes[secaoIndice].itens[itemIndice]
    const anteriores = itensAnteriores(secaoIndice, criando ? estrutura.secoes[secaoIndice].itens.length : itemIndice)

    const campos = [
      { nome: 'rotulo', rotulo: 'Pergunta', valor: item.rotulo || '', obrigatorio: true,
        dica: 'E o que o motorista le na tela do celular.' },
      { nome: 'tipo', rotulo: 'Tipo de resposta', tipo: 'select', opcoes: TIPOS_ITEM, valor: item.tipo },
      { nome: 'criticidade', rotulo: 'Criticidade quando nao conforme', tipo: 'select',
        opcoes: CRITICIDADES, valor: item.criticidade || 'medio',
        dica: 'Criticidade "critico" pode bloquear o veiculo, conforme a politica da empresa.',
        visivelQuando: (v) => TIPOS_AVALIAVEIS.has(v.tipo) },
      { nome: 'valor_conforme', rotulo: 'Resposta considerada conforme (Sim/Nao)', tipo: 'select',
        opcoes: [{ valor: 'sim', rotulo: 'Sim' }, { valor: 'nao', rotulo: 'Nao' }],
        valor: item.valor_conforme || 'sim',
        dica: 'Em "Ha vazamento?", a resposta conforme e "Nao".',
        visivelQuando: (v) => v.tipo === 'sim_nao' },
      { nome: 'minimo', rotulo: 'Minimo aceito', tipo: 'number', valor: item.minimo ?? '',
        visivelQuando: (v) => v.tipo === 'numero' },
      { nome: 'maximo', rotulo: 'Maximo aceito', tipo: 'number', valor: item.maximo ?? '',
        visivelQuando: (v) => v.tipo === 'numero' },
      { nome: 'unidade', rotulo: 'Unidade', valor: item.unidade || '',
        dica: 'Ex.: PSI, km, litros.',
        visivelQuando: (v) => v.tipo === 'numero' },
      { nome: 'opcoes', rotulo: 'Opcoes da selecao', tipo: 'textarea',
        visivelQuando: (v) => v.tipo === 'selecao',
        valor: (item.opcoes || []).map((o) =>
          `${o.valor}|${o.rotulo || o.valor}|${o.conforme === false ? 'nok' : 'ok'}|${o.criticidade || ''}`).join('\n'),
        dica: 'Uma por linha: valor|rotulo|ok ou nok|criticidade' },
      { nome: 'foto_obrigatoria_se_nok', rotulo: 'Exigir foto quando nao conforme', tipo: 'select',
        opcoes: [{ valor: 'nao', rotulo: 'Nao' }, { valor: 'sim', rotulo: 'Sim' }],
        valor: item.foto_obrigatoria_se_nok ? 'sim' : 'nao',
        dica: 'A foto vira evidencia no relatorio, amarrada ao item e ao horario.',
        visivelQuando: (v) => TIPOS_AVALIAVEIS.has(v.tipo) },
      { nome: 'condicao_item', rotulo: 'Mostrar somente quando...', tipo: 'select',
        opcoes: [{ valor: '', rotulo: 'Sempre mostrar' },
          ...anteriores.map((a) => ({ valor: a.id, rotulo: a.rotulo }))],
        valor: item.condicao?.item_id || '' },
      { nome: 'condicao_operador', rotulo: '...esse item', tipo: 'select', opcoes: OPERADORES,
        valor: item.condicao?.operador || 'igual',
        visivelQuando: (v) => Boolean(v.condicao_item) },
      { nome: 'condicao_valor', rotulo: '...com o valor', valor: item.condicao?.valor ?? '',
        dica: 'Nao usado nos operadores "conforme", "nao conforme" e "preenchido".',
        visivelQuando: (v) => Boolean(v.condicao_item)
          && !['conforme', 'nao_conforme', 'preenchido'].includes(v.condicao_operador) },
    ]

    abrirModal({
      titulo: criando ? 'Novo item' : 'Editar item',
      subtitulo: estrutura.secoes[secaoIndice].titulo,
      campos,
      confirmar: criando ? 'Adicionar' : 'Salvar item',
      aoConfirmar: async (v) => {
        const novo = { rotulo: v.rotulo, tipo: v.tipo, criticidade: v.criticidade }

        novo.id = criando ? idUnico(idAPartirDoRotulo(v.rotulo), idsUsados()) : item.id

        if (v.tipo === 'sim_nao') novo.valor_conforme = v.valor_conforme
        if (v.tipo === 'numero') {
          if (v.minimo !== '') novo.minimo = Number(v.minimo)
          if (v.maximo !== '') novo.maximo = Number(v.maximo)
          if (v.unidade) novo.unidade = v.unidade
        }
        if (v.tipo === 'selecao') {
          novo.opcoes = v.opcoes.split('\n').map((linha) => linha.trim()).filter(Boolean).map((linha) => {
            const [valor, rotulo, conformidade, criticidade] = linha.split('|').map((p) => (p || '').trim())
            const opcao = { valor, rotulo: rotulo || valor }
            if (conformidade === 'nok') {
              opcao.conforme = false
              if (criticidade) opcao.criticidade = criticidade
            }
            return opcao
          })
        }
        if (v.foto_obrigatoria_se_nok === 'sim') novo.foto_obrigatoria_se_nok = true
        if (v.condicao_item) {
          novo.condicao = { item_id: v.condicao_item, operador: v.condicao_operador }
          if (v.condicao_valor !== '') novo.condicao.valor = v.condicao_valor
        }

        if (criando) estrutura.secoes[secaoIndice].itens.push(novo)
        else estrutura.secoes[secaoIndice].itens[itemIndice] = novo

        await salvar({ silencioso: true })
        desenharSecoes()
      },
    })
  }

  function moverItem(secaoIndice, itemIndice, direcao) {
    const itens = estrutura.secoes[secaoIndice].itens
    const destino = itemIndice + direcao
    if (destino < 0 || destino >= itens.length) return
    ;[itens[itemIndice], itens[destino]] = [itens[destino], itens[itemIndice]]
    salvar({ silencioso: true }).then(desenharSecoes)
  }

  // ------------------------------------------------------------ desenho

  function linhaItem(item, secaoIndice, itemIndice, totalItens) {
    const marcas = []
    if (item.criticidade && item.tipo !== 'texto' && item.tipo !== 'foto' && item.tipo !== 'assinatura') {
      marcas.push(selo(item.criticidade, TOM_CRITICIDADE[item.criticidade]))
    }
    if (item.foto_obrigatoria_se_nok) marcas.push(selo('foto obrigatoria', 's-neutro'))
    if (item.condicao) marcas.push(selo('condicional', 's-atencao'))
    if (item.tipo === 'numero' && (item.minimo != null || item.maximo != null)) {
      marcas.push(selo(`${item.minimo ?? '—'} a ${item.maximo ?? '—'} ${item.unidade || ''}`.trim(), 's-neutro'))
    }

    const acoes = editavel ? [
      elemento('button', { classe: 'botao botao--suave botao--mini', texto: '↑',
        aoClick: () => moverItem(secaoIndice, itemIndice, -1), disabled: itemIndice === 0 }),
      elemento('button', { classe: 'botao botao--suave botao--mini', texto: '↓',
        aoClick: () => moverItem(secaoIndice, itemIndice, 1), disabled: itemIndice === totalItens - 1 }),
      elemento('button', { classe: 'botao botao--suave botao--mini', texto: 'Editar',
        aoClick: () => formularioItem(secaoIndice, itemIndice) }),
      elemento('button', { classe: 'botao botao--suave botao--mini', texto: 'Remover',
        aoClick: async () => {
          estrutura.secoes[secaoIndice].itens.splice(itemIndice, 1)
          await salvar({ silencioso: true })
          desenharSecoes()
        } }),
    ] : []

    return elemento('tr', {}, [
      elemento('td', {}, [
        elemento('div', { classe: 'celula-forte', texto: item.rotulo }),
        elemento('div', { classe: 'celula-fraca dado', texto: item.id }),
      ]),
      elemento('td', { classe: 'celula-fraca',
        texto: TIPOS_ITEM.find((t) => t.valor === item.tipo)?.rotulo || item.tipo }),
      elemento('td', {}, [elemento('div', { classe: 'card-detalhe' }, marcas)]),
      elemento('td', {}, [elemento('div', { classe: 'linha linha--fim' }, acoes)]),
    ])
  }

  function desenharSecoes() {
    const blocos = estrutura.secoes.map((secao, si) => {
      const cabecalho = elemento('div', { classe: 'secao-titulo esp-t-5' }, [
        elemento('div', {}, [
          elemento('h2', { texto: secao.titulo }),
          elemento('div', { classe: 'celula-fraca dado', texto: `${secao.id} · ${secao.itens.length} itens` }),
        ]),
        editavel ? elemento('div', { classe: 'linha linha--fim' }, [
          elemento('button', { classe: 'botao botao--mini', texto: '+ Item',
            aoClick: () => formularioItem(si, null) }),
          elemento('button', { classe: 'botao botao--suave botao--mini', texto: 'Renomear',
            aoClick: () => abrirModal({
              titulo: 'Renomear secao',
              campos: [{ nome: 'titulo', rotulo: 'Titulo', valor: secao.titulo, obrigatorio: true }],
              aoConfirmar: async (v) => {
                secao.titulo = v.titulo
                await salvar({ silencioso: true })
                desenharSecoes()
              },
            }) }),
          elemento('button', { classe: 'botao botao--suave botao--mini', texto: 'Remover secao',
            aoClick: async () => {
              estrutura.secoes.splice(si, 1)
              await salvar({ silencioso: true })
              desenharSecoes()
            } }),
        ]) : null,
      ])

      const corpo = secao.itens.length
        ? tabela(['Item', 'Tipo', 'Regras', ''],
            secao.itens.map((item, ii) => linhaItem(item, si, ii, secao.itens.length)))
        : vazio('Secao sem itens. Um template so publica com todas as secoes preenchidas.')

      return elemento('section', {}, [cabecalho, corpo])
    })

    areaSecoes.replaceChildren(...blocos)
  }

  // ------------------------------------------------------------ cabecalho

  const acoes = []
  acoes.push(elemento('button', {
    classe: 'botao botao--suave', texto: '← Checklists',
    aoClick: () => contexto.irPara('templates'),
  }))
  if (editavel) {
    acoes.push(elemento('button', {
      classe: 'botao botao--suave', texto: '+ Secao',
      aoClick: () => abrirModal({
        titulo: 'Nova secao',
        campos: [{ nome: 'titulo', rotulo: 'Titulo da secao', obrigatorio: true,
          dica: 'Ex.: Pneus e rodagem' }],
        aoConfirmar: async (v) => {
          const usados = new Set(estrutura.secoes.map((s) => s.id))
          estrutura.secoes.push({ id: idUnico(idAPartirDoRotulo(v.titulo), usados), titulo: v.titulo, itens: [] })
          await salvar({ silencioso: true })
          desenharSecoes()
        },
      }),
    }))
    acoes.push(elemento('button', {
      classe: 'botao', texto: 'Publicar versao',
      aoClick: async () => {
        if (!(await conferir())) { notificar('Corrija a estrutura antes de publicar.'); return }
        abrirModal({
          titulo: `Publicar versao ${template.versao}?`,
          subtitulo: 'Depois de publicada, esta versao nao pode ser alterada — mudancas viram a versao seguinte. A versao publicada anterior sera arquivada.',
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
      descricao: `${template.codigo} · versao ${template.versao} · ${template.status}`
        + (editavel ? ' — alteracoes sao salvas automaticamente' : ' — somente leitura'),
      acoes,
    }),
    areaAviso,
    areaSecoes,
  )

  desenharSecoes()
  if (editavel) await conferir()
}
