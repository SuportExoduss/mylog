// Relatorios (roadmap 27).
//
// Saida em HTML preparado para impressao, e nao em PDF gerado por biblioteca.
// O navegador ja sabe paginar, numerar e imprimir em PDF; uma dependencia de
// geracao custaria manutencao para entregar o mesmo arquivo. Se um dia for
// preciso PDF sem interacao humana (envio automatico por email), o mesmo HTML
// alimenta um worker headless — a escolha nao fecha porta.
import { consultar, consultarUm } from '../nucleo/banco.js'
import { erro } from '../nucleo/http.js'
import { exigirAutenticado } from '../seguranca/sessao.js'
import { exigirFrota } from '../seguranca/nivel.js'
import { avaliarPreventivas } from '../nucleo/preventivas.js'
import { dataHoraLocal } from '../nucleo/relogio.js'
import { avaliarResposta } from '../../../compartilhado/template.js'
import { marcaDaEmpresa } from './marca.js'

// -------------------------------------------------------------- utilitarios

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
// Todo texto vindo do banco passa por aqui: relatorio recebe descricao escrita
// por motorista, e um "<" solto quebraria a pagina.
const e = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c])

// `toLocaleString` sem `timeZone` usa o fuso do processo. O dossie e' impresso
// e assinado: a hora nele tem que ser a do patio.
const dataHora = (iso) => dataHoraLocal(iso)

// Data pura (AAAA-MM-DD), sem hora. Montada em UTC de proposito: a preventiva
// vence num DIA, e converter para o fuso local jogaria o dia 01 para o 31 do
// mes anterior em quem esta a oeste de Greenwich.
const dataCurta = (iso) => {
  if (!iso) return '—'
  const [ano, mes, dia] = String(iso).slice(0, 10).split('-')
  return dia ? `${dia}/${mes}/${ano}` : String(iso)
}

const numero = (v) => Number(v || 0).toLocaleString('pt-BR')

const ROTULO_MOMENTO = { saida: 'SAIDA', retorno: 'RETORNO' }
const ROTULO_TIPO = {
  compacto_leve: 'Compacto leve', pickup: 'Pick-up', quatro_x_quatro: '4x4',
  motocicleta: 'Motocicleta', caminhao: 'Caminhao',
}

// O relatorio e' impresso e entregue na mao de alguem. "em_tratamento" com
// sublinhado e' vocabulario de banco de dados; num papel assinado, vira ruido.
const ROTULO_STATUS_VEICULO = {
  disponivel: 'Disponivel', com_pendencia: 'Com pendencia',
  bloqueado: 'Bloqueado', manutencao: 'Em manutencao',
}
const ROTULO_STATUS_OCORRENCIA = {
  aberta: 'Em aberto', em_tratamento: 'Em tratamento',
  resolvida: 'Resolvida', encerrada: 'Encerrada',
}
const ROTULO_PRIORIDADE = {
  baixa: 'Baixa', media: 'Media', alta: 'Alta', critica: 'Critica',
}
const ROTULO_STATUS_PREVENTIVA = {
  em_dia: 'Em dia', proxima: 'Proxima', muito_proxima: 'Muito proxima', vencida: 'Vencida',
}
const ROTULO_RESULTADO = {
  aprovado: 'Aprovado', com_pendencia: 'Com pendencia', reprovado: 'Reprovado',
}

// Traduz sem esconder: um valor que o mapa nao conhece aparece como esta, em
// vez de sumir do papel.
const rotular = (mapa, valor) => mapa[valor] || valor || '—'

// Estilo embutido de proposito: o relatorio impresso nao pode depender de um
// arquivo externo que pode nao carregar na hora da impressao.
const ESTILO = `
  :root { --tinta:#1a222c; --fraco:#5b6b7c; --linha:#d8dee8; --marca:#35539f;
          --marca-contraste:#ffffff;
          --ok:#1a7a45; --media:#8a6100; --alta:#9c4a15; --critica:#a3222a; }
  /* A cor da marca da empresa entra por cima desta, quando ha uma. As cores de
     ESTADO nao entram nunca: verde, amarelo e vermelho dizem o que a folha
     AFIRMA, e num dossie de sinistro isso pesa ainda mais que na tela (D59). */
  .logo-empresa { max-height:44px; max-width:180px; object-fit:contain; display:block;
                  margin-bottom:6px }
  .por-mylog { font-size:11px; color:var(--fraco); letter-spacing:.04em;
               text-transform:uppercase; margin-top:3px }
  * { box-sizing:border-box }
  body { margin:0; padding:24px; background:#fff; color:var(--tinta);
         font:13px/1.5 "Segoe UI",system-ui,sans-serif; }
  .dado { font-family:"Cascadia Mono",ui-monospace,Consolas,monospace; font-variant-numeric:tabular-nums }
  h1 { font-size:22px; margin:0 0 2px; letter-spacing:-.02em }
  h2 { font-size:15px; margin:24px 0 8px; padding-bottom:4px; border-bottom:2px solid var(--marca) }
  .sub { color:var(--fraco); margin:0 0 16px }
  .cabecalho { display:flex; justify-content:space-between; align-items:flex-start;
               gap:24px; border-bottom:2px solid var(--marca); padding-bottom:12px; margin-bottom:16px }
  .marca { font-size:20px; font-weight:700; letter-spacing:-.02em }
  .marca span { color:var(--marca) }
  .emitido { text-align:right; font-size:11px; color:var(--fraco) }
  table { width:100%; border-collapse:collapse; margin-bottom:12px }
  th,td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--linha); vertical-align:top }
  th { font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:var(--fraco);
       background:#f4f6f9 }
  .ficha { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:8px }
  .ficha div { padding:8px; background:#f4f6f9; border-radius:6px }
  .ficha dt { font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:var(--fraco); margin:0 }
  .ficha dd { margin:2px 0 0; font-weight:600 }
  .selo { display:inline-block; padding:1px 7px; border-radius:99px; font-size:11px; font-weight:700 }
  .s-ok { background:#e2f3e9; color:var(--ok) }
  .s-baixa { background:#eceef3; color:var(--fraco) }
  .s-media { background:#fdf0d2; color:var(--media) }
  .s-alta { background:#fbe9dd; color:var(--alta) }
  .s-critica { background:#fbe7e8; color:var(--critica) }
  .pergunta { border:1px solid var(--linha); border-radius:8px; padding:12px; margin-bottom:10px;
              break-inside:avoid; page-break-inside:avoid }
  .pergunta-topo { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:6px }
  .pergunta-titulo { font-weight:600; font-size:14px }
  .fotos { display:flex; gap:8px; flex-wrap:wrap; margin-top:8px }
  .fotos img { width:150px; height:112px; object-fit:cover; border:1px solid var(--linha); border-radius:6px }
  .foto-legenda { font-size:10px; color:var(--fraco); margin-top:2px }
  .assinatura img { max-width:280px; border:1px solid var(--linha); border-radius:6px; background:#fff }
  .rodape { margin-top:24px; padding-top:8px; border-top:1px solid var(--linha);
            font-size:10px; color:var(--fraco) }
  .vazio { padding:16px; text-align:center; color:var(--fraco); border:1px dashed var(--linha); border-radius:8px }
  .comparativo { display:grid; grid-template-columns:1fr 1fr; gap:12px }
  .comparativo h3 { margin:0 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:.06em; color:var(--fraco) }
  .mudou { border-left:4px solid var(--critica); padding-left:8px }
  .numero { display:inline-block; min-width:24px; color:var(--fraco); font-variant-numeric:tabular-nums }
  .relato { margin:6px 0 0; font-style:italic; color:var(--tinta) }
  .comparativo figure { margin:0 }
  .imprimir { margin-bottom:16px }
  /* Cor do texto pelo token --marca-contraste, e nao branco fixo: e' ele que
     tem o contraste CONFERIDO contra a marca, a 4.5:1, antes de publicar. Uma
     empresa pode escolher uma marca clara e passar na validacao — a tinta dela
     seria escura — e ai o branco fixo deixaria este botao ilegivel, sem nada
     acusar. Crase nenhuma neste comentario: ele vive dentro de um template
     literal, e uma crase aqui encerra a folha de estilo inteira. */
  .imprimir button { padding:8px 16px; background:var(--marca); color:var(--marca-contraste); border:none;
                     border-radius:6px; font:inherit; font-weight:600; cursor:pointer }
  @media print {
    body { padding:0 }
    .imprimir { display:none }
    h2 { break-after:avoid; page-break-after:avoid }
  }
`

// A folha impressa e' o que a empresa entrega para FORA — seguradora, cliente,
// perito. Ela mostrava so o MyLog, com o nome de registro da empresa em letra
// pequena embaixo: quem contratou o white label tinha a propria identidade em
// toda tela do produto, e em nenhuma folha que sai dele.
//
// A arquitetura promete que "a marca MyLog permanece AO LADO da marca do
// contratante". Aqui ela estava sozinha.
//
// Quem NAO personalizou nada continua vendo exatamente o cabecalho de antes: o
// co-branding aparece onde ha marca, e nao inventa uma para quem nao tem.
// Continua sem caminho para esconder o MyLog — nao existe campo para isso.
function cabecalhoDaMarca(empresa, marca) {
  const nome = marca?.nome_exibicao
  if (!nome && !marca?.logo_url) {
    return `<div class="marca">My<span>Log</span></div>
    <div class="sub">${e(empresa?.nome || '')}</div>`
  }
  return `${marca.logo_url
    ? `<img class="logo-empresa" src="${e(marca.logo_url)}" alt="${e(nome || empresa?.nome || 'Logo da empresa')}">`
    : ''}
    <div class="marca">${e(nome || empresa?.nome || '')}</div>
    <div class="por-mylog">por MyLog</div>`
}

function pagina({ titulo, corpo, empresa, gerador, marca }) {
  const corDaMarca = marca?.tokens?.claro?.marca
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(titulo)}</title><style>${ESTILO}</style>
${corDaMarca ? `<style>:root{--marca:${e(corDaMarca)};--marca-contraste:${e(marca.tokens.claro['marca-contraste'])}}</style>` : ''}
<script src="/js/imprimir.js" defer></script></head>
<body>
<div class="imprimir"><button type="button" data-imprimir>Imprimir ou salvar em PDF</button></div>
<div class="cabecalho">
  <div>
    ${cabecalhoDaMarca(empresa, marca)}
  </div>
  <div class="emitido">
    <div>${e(titulo)}</div>
    <div>Emitido em ${dataHora(new Date().toISOString())}</div>
  </div>
</div>
${corpo}
<div class="rodape">
  ${gerador ? `Gerado por <strong>${e(gerador)}</strong> em ${dataHora(new Date().toISOString())}. ` : ''}Documento gerado pelo MyLog. As evidencias fotograficas estao vinculadas a
  inspecao, ao veiculo e a pergunta que as originou, com data e hora de captura.
</div>
</body></html>`
}

function responderHtml(ctx, html) {
  ctx.res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  ctx.res.end(html)
}

// ------------------------------------------------------------- montagem

function carregarInspecao(empresaId, id) {
  const inspecao = consultarUm(
    `SELECT i.*, v.placa, v.marca, v.modelo, v.ano, v.tipo, u.nome AS usuario_nome, u.cpf,
            c.nome AS cargo_nome, t.nome AS checklist, t.versao AS checklist_versao,
            t.estrutura, t.exige_assinatura
       FROM inspecoes i
       JOIN veiculos v ON v.id = i.veiculo_id
       JOIN usuarios u ON u.id = i.usuario_id
       LEFT JOIN cargos c ON c.id = u.cargo_id
       JOIN templates t ON t.id = i.template_id
      WHERE i.id = ? AND i.empresa_id = ?`, [id, empresaId])
  if (!inspecao) throw erro.naoEncontrado('Inspecao nao encontrada.')

  inspecao.estrutura = JSON.parse(inspecao.estrutura)
  inspecao.respostas = consultar('SELECT * FROM respostas WHERE inspecao_id = ?', [id])
  inspecao.evidencias = consultar(
    'SELECT id, pergunta_id, capturado_em FROM evidencias WHERE inspecao_id = ? ORDER BY capturado_em', [id])
  inspecao.ocorrencias = consultar('SELECT * FROM ocorrencias WHERE inspecao_id = ?', [id])
  return inspecao
}

// O documento circula: vai para a oficina, para o seguro, para o cliente. O
// CPF inteiro num papel que anda nao serve a ninguem — os quatro digitos
// bastam para conferir quem e' (roadmap 27.1). Copiado do PROLOG porque esta
// certo.
function mascararCpf(cpf) {
  const so = String(cpf || '').replace(/\D/g, '')
  if (so.length !== 11) return '—'
  return `${so.slice(0, 3)}.***.***-${so.slice(9)}`
}

// Nome da opcao de problema escolhida, ou o relatorio escrito quando nao houve
// opcao. E' o mesmo texto que a fila de ocorrencias mostra.
function opcaoNome(pergunta, resposta) {
  const opcao = (pergunta.opcoes_problema || []).find((o) => o.id === resposta.opcao_id)
  return opcao ? opcao.nome : (resposta.relatorio || 'Ocorrencia')
}

function duracaoDe(inspecao) {
  if (!inspecao?.iniciada_em || !inspecao?.finalizada_em) return '—'
  const seg = Math.max(0,
    Math.round((new Date(inspecao.finalizada_em) - new Date(inspecao.iniciada_em)) / 1000))
  const m = Math.floor(seg / 60)
  return m < 60 ? `${m}min ${String(seg % 60).padStart(2, '0')}s`
    : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

function fichaInspecao(i) {
  return `<div class="ficha">
    <div><dt>Veiculo</dt><dd class="dado">${e(i.placa)}</dd></div>
    <div><dt>Modelo</dt><dd>${e([i.marca, i.modelo, i.ano].filter(Boolean).join(' '))}</dd></div>
    <div><dt>Tipo</dt><dd>${e(ROTULO_TIPO[i.tipo] || i.tipo)}</dd></div>
    <div><dt>Quilometragem</dt><dd class="dado">${numero(i.km_informado)} km</dd></div>
    <div><dt>Momento</dt><dd>${e(ROTULO_MOMENTO[i.momento] || i.momento)}</dd></div>
    <div><dt>Executado por</dt><dd>${e(i.usuario_nome)}</dd></div>
    <div><dt>Cargo</dt><dd>${e(i.cargo_nome || '—')}</dd></div>
    <div><dt>Finalizado em</dt><dd class="dado">${dataHora(i.finalizada_em)}</dd></div>
  </div>`
}

function blocoPergunta(pergunta, resposta, evidencias) {
  const juizo = resposta
    ? avaliarResposta(pergunta, { ...resposta, fotos: evidencias.length })
    : null

  const selo = !resposta
    ? '<span class="selo s-baixa">sem resposta</span>'
    : resposta.desfecho === 'ok'
      ? '<span class="selo s-ok">OK</span>'
      : `<span class="selo s-${juizo?.prioridade || 'baixa'}">${e(juizo?.descricao || 'ocorrencia')}</span>`

  const fotos = evidencias.length
    ? `<div class="fotos">${evidencias.map((ev) => `<figure style="margin:0">
        <img src="/api/evidencias/${e(ev.id)}" alt="Evidencia de ${e(pergunta.titulo)}">
        <div class="foto-legenda dado">${dataHora(ev.capturado_em)}</div>
      </figure>`).join('')}</div>`
    : ''

  const relatorio = resposta?.relatorio
    ? `<div style="margin-top:6px"><em>${e(resposta.relatorio)}</em></div>` : ''

  return `<div class="pergunta">
    <div class="pergunta-topo">
      <span class="pergunta-titulo">${e(pergunta.titulo)}</span>
      ${selo}
    </div>
    <div class="dado" style="font-size:11px;color:var(--fraco)">${e(pergunta.id)}</div>
    ${relatorio}${fotos}
  </div>`
}

export function registrarRotasRelatorios(rotas) {
  // ------------------------------------------- checklist completo (sec. 27)
  rotas.get('/relatorio/inspecao/:id', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const i = carregarInspecao(eu.empresa_id, ctx.params.id)
    const empresa = consultarUm('SELECT nome FROM empresas WHERE id = ?', [eu.empresa_id])

    const porPergunta = new Map(i.respostas.map((r) => [r.pergunta_id, r]))
    const evidPorPergunta = new Map()
    for (const ev of i.evidencias) {
      if (!evidPorPergunta.has(ev.pergunta_id)) evidPorPergunta.set(ev.pergunta_id, [])
      evidPorPergunta.get(ev.pergunta_id).push(ev)
    }

    const perguntas = i.estrutura.perguntas
      .map((p) => blocoPergunta(p, porPergunta.get(p.id), evidPorPergunta.get(p.id) || []))
      .join('')

    const ocorrencias = i.ocorrencias.length
      ? `<table><thead><tr><th>Prioridade</th><th>Descricao</th><th>Situacao</th></tr></thead><tbody>
         ${i.ocorrencias.map((o) => `<tr>
           <td><span class="selo s-${e(o.prioridade)}">${e(rotular(ROTULO_PRIORIDADE, o.prioridade))}</span></td>
           <td>${e(o.descricao)}</td><td>${e(rotular(ROTULO_STATUS_OCORRENCIA, o.status))}</td></tr>`).join('')}
         </tbody></table>`
      : '<div class="vazio">Nenhuma ocorrencia aberta nesta inspecao.</div>'

    const assinatura = i.assinatura
      ? `<h2>Assinatura do condutor</h2><div class="assinatura">
           <img src="${e(i.assinatura)}" alt="Assinatura de ${e(i.usuario_nome)}">
           <div class="foto-legenda">${e(i.usuario_nome)} · CPF ${e(i.cpf)}</div>
         </div>`
      : ''

    responderHtml(ctx, pagina({
      titulo: `Checklist ${ROTULO_MOMENTO[i.momento]} — ${i.placa}`,
      empresa,
      marca: marcaDaEmpresa(eu.empresa_id),
      corpo: `
        <h1>${e(i.checklist)}</h1>
        <p class="sub">Versao ${e(i.checklist_versao)} · resultado <strong>${e(rotular(ROTULO_RESULTADO, i.resultado))}</strong></p>
        ${fichaInspecao(i)}
        <h2>Perguntas e evidencias</h2>
        ${perguntas}
        <h2>Ocorrencias abertas</h2>
        ${ocorrencias}
        ${assinatura}`,
    }))
  })

  // ------------------------------ comparativo saida x retorno (roadmap 16)
  // O motivo de existir do modelo unico rodando duas vezes: a mesma pergunta,
  // duas fotos, horas de diferenca. E' o que prova dano novo em vez de discutir.
  rotas.get('/relatorio/solicitacao/:id', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const s = consultarUm(
      // LEFT JOIN em veiculos: pedido pendente ainda nao tem placa. Com JOIN,
      // o relatorio devolvia 404 "nao encontrada" para uma solicitacao que
      // existe — erro que manda a pessoa procurar a coisa errada.
      `SELECT s.*, v.placa, v.marca, v.modelo, u.nome AS solicitante,
              a.nome AS aprovador, cat.nome AS categoria_nome
         FROM solicitacoes s
         LEFT JOIN veiculos v ON v.id = s.veiculo_id
         LEFT JOIN categorias_uso cat ON cat.id = s.categoria_id
         JOIN usuarios u ON u.id = s.solicitante_id
         LEFT JOIN usuarios a ON a.id = s.aprovada_por
        WHERE s.id = ? AND s.empresa_id = ?`, [ctx.params.id, eu.empresa_id])
    if (!s) throw erro.naoEncontrado('Solicitacao nao encontrada.')
    const empresa = consultarUm('SELECT nome FROM empresas WHERE id = ?', [eu.empresa_id])

    const saida = s.inspecao_saida ? carregarInspecao(eu.empresa_id, s.inspecao_saida) : null
    const retorno = s.inspecao_retorno ? carregarInspecao(eu.empresa_id, s.inspecao_retorno) : null

    const mapa = (insp) => {
      if (!insp) return { respostas: new Map(), evid: new Map() }
      const evid = new Map()
      for (const ev of insp.evidencias) {
        if (!evid.has(ev.pergunta_id)) evid.set(ev.pergunta_id, [])
        evid.get(ev.pergunta_id).push(ev)
      }
      return { respostas: new Map(insp.respostas.map((r) => [r.pergunta_id, r])), evid }
    }
    const mS = mapa(saida)
    const mR = mapa(retorno)

    const estrutura = (saida || retorno)?.estrutura
    const linhas = estrutura ? estrutura.perguntas.map((p) => {
      const rs = mS.respostas.get(p.id)
      const rr = mR.respostas.get(p.id)
      // "Estava OK na saida e virou ocorrencia no retorno" e' a linha que
      // interessa: e' dano novo, ocorrido durante o uso.
      const danoNovo = rs?.desfecho === 'ok' && rr?.desfecho === 'ocorrencia'
      return `<div class="pergunta ${danoNovo ? 'mudou' : ''}">
        <div class="pergunta-topo">
          <span class="pergunta-titulo">${e(p.titulo)}</span>
          ${danoNovo ? '<span class="selo s-critica">possivel dano novo</span>' : ''}
        </div>
        <div class="comparativo">
          <div><h3>Saida</h3>${blocoPergunta(p, rs, mS.evid.get(p.id) || [])}</div>
          <div><h3>Retorno</h3>${blocoPergunta(p, rr, mR.evid.get(p.id) || [])}</div>
        </div>
      </div>`
    }).join('') : '<div class="vazio">Nenhuma inspecao registrada nesta solicitacao.</div>'

    const atraso = s.motivo_atraso
      ? `<h2>Devolucao fora do prazo</h2>
         <p><strong>Prazo:</strong> <span class="dado">${dataHora(s.janela_fim)}</span> ·
            <strong>Devolvido:</strong> <span class="dado">${dataHora(s.devolvido_em)}</span></p>
         <p><em>"${e(s.motivo_atraso)}"</em></p>`
      : ''

    // Enquanto a Frota nao escolheu a placa, o documento fala da CATEGORIA
    // pedida. Escrever "—" no lugar da placa faria parecer dado faltando,
    // quando a decisao e' que ainda nao foi tomada.
    const identificacao = s.placa
      ? `${s.placa} ${s.modelo || ''}`.trim()
      : `${s.categoria_nome || 'sem categoria'} — veiculo ainda nao escolhido`

    responderHtml(ctx, pagina({
      titulo: `Solicitacao #${s.numero} — ${s.placa || 'sem veiculo'}`,
      empresa,
      marca: marcaDaEmpresa(eu.empresa_id),
      corpo: `
        <h1>Comparativo de saida e retorno</h1>
        <p class="sub">Solicitacao #${e(s.numero)} · ${e(identificacao)}</p>
        <div class="ficha">
          <div><dt>Solicitante</dt><dd>${e(s.solicitante)}</dd></div>
          <div><dt>Categoria pedida</dt><dd>${e(s.categoria_nome || '—')}</dd></div>
          <div><dt>Aprovado por</dt><dd>${e(s.aprovador || '—')}</dd></div>
          <div><dt>Janela</dt><dd class="dado">${dataHora(s.janela_inicio)}</dd></div>
          <div><dt>Ate</dt><dd class="dado">${dataHora(s.janela_fim)}</dd></div>
        </div>
        <p><strong>Motivo do pedido:</strong> ${e(s.motivo)}</p>
        ${atraso}
        <h2>Pergunta a pergunta</h2>
        ${linhas}`,
    }))
  })

  // ------------------------------------------------------ frota (executivo)
  // ------------------------------------------------ dossie de preventiva
  // O documento que prova o servico (roadmap 27.1). Estruturado a partir do
  // PDF que a operacao ja le no PROLOG, com uma diferenca que muda tudo: as
  // fotos vem em DUAS COLUNAS, antes e depois.
  rotas.get('/relatorio/preventiva/:id', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const prev = consultarUm(
      `SELECT p.*, v.placa, v.marca, v.modelo, v.ano, v.tipo, v.km_atual,
              u.nome AS concluida_por_nome, t.nome AS checklist_nome
         FROM preventivas p
         JOIN veiculos v ON v.id = p.veiculo_id
         LEFT JOIN usuarios u ON u.id = p.concluida_por
         LEFT JOIN templates t ON t.id = p.template_id
        WHERE p.id = ? AND p.empresa_id = ?`, [ctx.params.id, eu.empresa_id])
    if (!prev) throw erro.naoEncontrado('Preventiva nao encontrada.')

    const empresa = consultarUm('SELECT nome FROM empresas WHERE id = ?', [eu.empresa_id])
    const saida = prev.inspecao_saida ? carregarInspecao(eu.empresa_id, prev.inspecao_saida) : null
    const retorno = prev.inspecao_retorno
      ? carregarInspecao(eu.empresa_id, prev.inspecao_retorno) : null

    const indexar = (insp) => {
      if (!insp) return { respostas: new Map(), evid: new Map() }
      const evid = new Map()
      for (const ev of insp.evidencias) {
        if (!evid.has(ev.pergunta_id)) evid.set(ev.pergunta_id, [])
        evid.get(ev.pergunta_id).push(ev)
      }
      return { respostas: new Map(insp.respostas.map((r) => [r.pergunta_id, r])), evid }
    }
    const mS = indexar(saida)
    const mR = indexar(retorno)

    const estrutura = (retorno || saida)?.estrutura
    const perguntas = estrutura?.perguntas || []

    // Contagens do cabecalho, no espirito do PDF do PROLOG.
    const mexidas = [...mR.respostas.values()].filter((r) => r.manutencao_feita).length
    const achados = saida ? saida.ocorrencias.length : 0
    const porPrioridade = { baixa: 0, media: 0, alta: 0, critica: 0 }
    for (const o of (saida?.ocorrencias || [])) {
      if (o.prioridade in porPrioridade) porPrioridade[o.prioridade] += 1
    }

    const fotos = (lista) => (lista || []).map((ev) =>
      `<figure><img src="/api/evidencias/${e(ev.id)}" alt="Evidencia">
         <figcaption class="foto-legenda">${dataHora(ev.capturado_em)}</figcaption></figure>`).join('')

    const linhas = perguntas.map((p, i) => {
      const rs = mS.respostas.get(p.id)
      const rr = mR.respostas.get(p.id)
      const feita = rr?.manutencao_feita === 1 || rr?.manutencao_feita === true

      const antes = rs
        ? `${rs.desfecho === 'ocorrencia'
              ? `<span class="selo s-alta">${e(opcaoNome(p, rs))}</span>`
              : '<span class="selo s-ok">Sem apontamento</span>'}
           ${rs.relatorio ? `<p class="relato">"${e(rs.relatorio)}"</p>` : ''}
           <div class="fotos">${fotos(mS.evid.get(p.id))}</div>`
        : '<div class="vazio">Sem registro de saida.</div>'

      const depois = rr
        ? `<span class="selo ${feita ? 's-media' : 's-ok'}">
             Manutencao: ${feita ? 'SIM' : 'NAO'}</span>
           ${rr.relatorio ? `<p class="relato">"${e(rr.relatorio)}"</p>` : ''}
           <div class="fotos">${fotos(mR.evid.get(p.id))}</div>`
        : '<div class="vazio">Sem registro de retorno.</div>'

      return `<div class="pergunta">
        <div class="pergunta-topo">
          <span class="pergunta-titulo">
            <span class="numero">${String(i + 1).padStart(2, '0')}</span> ${e(p.titulo)}
          </span>
          ${feita ? '<span class="selo s-media">servico executado</span>' : ''}
        </div>
        <div class="comparativo">
          <div><h3>Antes — saida</h3>${antes}</div>
          <div class="${feita ? 'mudou' : ''}"><h3>Depois — retorno</h3>${depois}</div>
        </div>
      </div>`
    }).join('')

    const executante = retorno || saida
    const assinatura = executante?.assinatura
      ? `<h2>Assinatura</h2><div class="assinatura">
           <img src="${e(executante.assinatura)}" alt="Assinatura de ${e(executante.usuario_nome)}">
           <div class="foto-legenda">${e(executante.usuario_nome)} · CPF ${e(mascararCpf(executante.cpf))}</div>
         </div>`
      : ''

    const alvoAtual = prev.modo === 'km'
      ? `${numero(prev.proximo_km)} km` : dataCurta(prev.proxima_data)
    const proxima = consultarUm(
      `SELECT modo, proximo_km, proxima_data FROM preventivas
        WHERE empresa_id = ? AND veiculo_id = ? AND status <> 'realizada'
        ORDER BY criado_em DESC LIMIT 1`, [eu.empresa_id, prev.veiculo_id])

    responderHtml(ctx, pagina({
      titulo: `Preventiva — ${prev.placa}`,
      empresa,
      marca: marcaDaEmpresa(eu.empresa_id),
      gerador: eu.nome,
      corpo: `
        <h1>${e(prev.checklist_nome || 'Preventiva')}</h1>
        <p class="sub">${e(prev.placa)} · ${e(prev.marca || '')} ${e(prev.modelo)} ·
           checklist ${retorno?.numero ? `#${e(retorno.numero)}` : '—'}</p>

        <div class="ficha">
          <div><dt>Placa</dt><dd class="dado">${e(prev.placa)}</dd></div>
          <div><dt>Tipo</dt><dd>${e(rotular(ROTULO_TIPO, prev.tipo))}</dd></div>
          <div><dt>KM na saida</dt><dd class="dado">${numero(saida?.km_informado)} km</dd></div>
          <div><dt>KM no retorno</dt><dd class="dado">${numero(retorno?.km_informado)} km</dd></div>
          <div><dt>Executado por</dt><dd>${e(executante?.usuario_nome || '—')}</dd></div>
          <div><dt>CPF</dt><dd class="dado">${e(mascararCpf(executante?.cpf))}</dd></div>
          <div><dt>Concluida em</dt><dd class="dado">${dataHora(prev.concluida_em)}</dd></div>
          <div><dt>Duracao</dt><dd class="dado">${duracaoDe(retorno)}</dd></div>
        </div>

        <h2>A manutencao</h2>
        <div class="ficha">
          <div><dt>Alvo que venceu</dt><dd class="dado">${e(alvoAtual)}</dd></div>
          <div><dt>Itens verificados</dt><dd>${perguntas.length}</dd></div>
          <div><dt>Itens com servico</dt><dd>${mexidas}</dd></div>
          <div><dt>Apontados na saida</dt><dd>${achados}</dd></div>
        </div>
        ${proxima ? `<p class="sub"><strong>Proxima preventiva:</strong>
           ${proxima.modo === 'km'
             ? `${numero(proxima.proximo_km)} km` : dataCurta(proxima.proxima_data)}</p>` : ''}
        ${achados ? `<p class="sub">Prioridades apontadas na saida:
           ${['critica', 'alta', 'media', 'baixa']
             .filter((k) => porPrioridade[k])
             .map((k) => `<span class="selo s-${k}">${porPrioridade[k]} ${rotular(ROTULO_PRIORIDADE, k).toLowerCase()}</span>`)
             .join(' ')}</p>` : ''}

        <h2>Peca a peca</h2>
        ${linhas || '<div class="vazio">Nenhuma peca registrada nesta preventiva.</div>'}
        ${assinatura}`,
    }))
  })

  rotas.get('/relatorio/frota', async (ctx) => {
    const eu = exigirFrota(exigirAutenticado(ctx))
    const empresa = consultarUm('SELECT nome FROM empresas WHERE id = ?', [eu.empresa_id])

    // O status da preventiva e' derivado de KM/data. Um relatorio impresso com
    // status velho e' pior que nenhum: alguem assina embaixo dele.
    avaliarPreventivas(eu.empresa_id)

    const veiculos = consultar(
      `SELECT v.*,
              (SELECT COUNT(*) FROM ocorrencias o
                WHERE o.veiculo_id = v.id AND o.status IN ('aberta','em_tratamento')) AS ocorrencias,
              (SELECT MAX(i.finalizada_em) FROM inspecoes i WHERE i.veiculo_id = v.id) AS ultimo_checklist
         FROM veiculos v WHERE v.empresa_id = ? ORDER BY v.placa`, [eu.empresa_id])

    const preventivas = consultar(
      `SELECT p.*, v.placa FROM preventivas p JOIN veiculos v ON v.id = p.veiculo_id
        WHERE p.empresa_id = ? AND p.status IN ('vencida','muito_proxima')
        ORDER BY CASE p.status WHEN 'vencida' THEN 0 ELSE 1 END, v.placa`, [eu.empresa_id])

    const ocorrencias = consultar(
      `SELECT o.*, v.placa FROM ocorrencias o JOIN veiculos v ON v.id = o.veiculo_id
        WHERE o.empresa_id = ? AND o.status IN ('aberta','em_tratamento')
        ORDER BY CASE o.prioridade WHEN 'critica' THEN 0 WHEN 'alta' THEN 1
                                   WHEN 'media' THEN 2 ELSE 3 END, o.aberta_em`, [eu.empresa_id])

    responderHtml(ctx, pagina({
      titulo: 'Relatorio de frota',
      empresa,
      marca: marcaDaEmpresa(eu.empresa_id),
      corpo: `
        <h1>Situacao da frota</h1>
        <p class="sub">${veiculos.length} veiculo(s) · ${ocorrencias.length} ocorrencia(s) aberta(s) ·
           ${preventivas.length} preventiva(s) exigindo atencao</p>

        <h2>Veiculos</h2>
        <table><thead><tr><th>Placa</th><th>Veiculo</th><th>Tipo</th><th>KM</th>
          <th>Status</th><th>Ocorrencias</th><th>Ultimo checklist</th></tr></thead><tbody>
          ${veiculos.map((v) => `<tr>
            <td class="dado"><strong>${e(v.placa)}</strong></td>
            <td>${e([v.marca, v.modelo].filter(Boolean).join(' '))}</td>
            <td>${e(ROTULO_TIPO[v.tipo] || v.tipo)}</td>
            <td class="dado">${numero(v.km_atual)}</td>
            <td>${e(rotular(ROTULO_STATUS_VEICULO, v.status))}${v.motivo_status ? `<br><span style="font-size:11px;color:var(--fraco)">${e(v.motivo_status)}</span>` : ''}</td>
            <td class="dado">${v.ocorrencias || 0}</td>
            <td class="dado">${dataHora(v.ultimo_checklist)}</td></tr>`).join('')}
        </tbody></table>

        <h2>Ocorrencias abertas</h2>
        ${ocorrencias.length ? `<table><thead><tr><th>Prioridade</th><th>Veiculo</th>
          <th>Descricao</th><th>Aberta em</th><th>Situacao</th></tr></thead><tbody>
          ${ocorrencias.map((o) => `<tr>
            <td><span class="selo s-${e(o.prioridade)}">${e(rotular(ROTULO_PRIORIDADE, o.prioridade))}</span></td>
            <td class="dado">${e(o.placa)}</td>
            <td>${e(o.descricao)}</td>
            <td class="dado">${dataHora(o.aberta_em)}</td>
            <td>${e(rotular(ROTULO_STATUS_OCORRENCIA, o.status))}</td></tr>`).join('')}
        </tbody></table>` : '<div class="vazio">Nenhuma ocorrencia aberta.</div>'}

        <h2>Preventivas exigindo atencao</h2>
        ${preventivas.length ? `<table><thead><tr><th>Veiculo</th><th>Metodo</th>
          <th>Alvo</th><th>Situacao</th></tr></thead><tbody>
          ${preventivas.map((p) => `<tr>
            <td class="dado">${e(p.placa)}</td>
            <td>${p.modo === 'km' ? 'Quilometragem' : 'Data'}</td>
            <td class="dado">${p.modo === 'km' ? `${numero(p.proximo_km)} km` : e(dataCurta(p.proxima_data))}</td>
            <td><span class="selo s-${p.status === 'vencida' ? 'critica' : 'media'}">${e(rotular(ROTULO_STATUS_PREVENTIVA, p.status))}</span></td>
          </tr>`).join('')}
        </tbody></table>` : '<div class="vazio">Todas as preventivas em dia.</div>'}`,
    }))
  })
}
