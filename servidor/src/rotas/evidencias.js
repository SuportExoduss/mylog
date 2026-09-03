// Evidencias fotograficas (roadmap 13).
//
// A foto sobe DEPOIS da inspecao, uma por requisicao. Duas razoes:
//   - o corpo da inspecao continua pequeno, e a fila offline reenvia JSON leve;
//   - cada foto tem sua propria vida de tentativa. Uma falha no upload da
//     quarta foto nao invalida o checklist inteiro, que ja esta gravado.
import { consultar, consultarUm, executar, novoId, agora } from '../nucleo/banco.js'
import { erro } from '../nucleo/http.js'
import { registrarEvento } from '../nucleo/auditoria.js'
import { exigirAutenticado } from '../seguranca/sessao.js'
import { ehFrota } from '../seguranca/nivel.js'
import { caminhoDe, gravar, ler, tipoAceito, LIMITE_BYTES } from '../nucleo/storage.js'

function inspecaoDoUsuario(empresaId, inspecaoId, usuario) {
  const inspecao = consultarUm(
    'SELECT * FROM inspecoes WHERE id = ? AND empresa_id = ?', [inspecaoId, empresaId])
  if (!inspecao) throw erro.naoEncontrado('Inspecao nao encontrada.')
  // Quem executou a inspecao anexa a evidencia. A Frota tambem, para corrigir.
  if (inspecao.usuario_id !== usuario.id && !ehFrota(usuario)) {
    throw erro.permissao('Esta inspecao e de outra pessoa.')
  }
  return inspecao
}

export function registrarRotasEvidencias(rotas) {
  // ------------------------------------------------------------- upload
  rotas.post('/api/inspecoes/:id/evidencias', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    const inspecao = inspecaoDoUsuario(eu.empresa_id, ctx.params.id, eu)

    const perguntaId = String(ctx.corpo.pergunta_id || '').trim()
    const mime = String(ctx.corpo.tipo_mime || '').toLowerCase()
    const base64 = String(ctx.corpo.conteudo || '')

    if (!perguntaId) throw erro.requisicao('Informe a pergunta da evidencia.')
    if (!tipoAceito(mime)) throw erro.requisicao('Tipo de imagem nao aceito.')
    if (!base64) throw erro.requisicao('Conteudo da imagem ausente.')

    let buffer
    try { buffer = Buffer.from(base64, 'base64') } catch { throw erro.requisicao('Conteudo invalido.') }
    if (!buffer.length) throw erro.requisicao('Conteudo vazio.')
    if (buffer.length > LIMITE_BYTES) {
      throw erro.requisicao(`Imagem acima do limite de ${Math.round(LIMITE_BYTES / 1048576)} MB.`)
    }

    // Idempotencia: reenvio da mesma foto (mesmo id do aparelho) nao duplica.
    const clienteId = String(ctx.corpo.cliente_id || '').trim() || null
    if (clienteId) {
      const jaExiste = consultarUm(
        'SELECT * FROM evidencias WHERE empresa_id = ? AND inspecao_id = ? AND cliente_id = ?',
        [eu.empresa_id, inspecao.id, clienteId])
      if (jaExiste) return { evidencia: jaExiste, repetida: true }
    }

    const caminho = caminhoDe({
      empresaId: eu.empresa_id, veiculoId: inspecao.veiculo_id,
      inspecaoId: inspecao.id, perguntaId, mime,
    })
    const { bytes, hash } = gravar(caminho, buffer)

    const id = novoId('evidencia')
    const ts = agora()
    executar(
      `INSERT INTO evidencias (id, empresa_id, veiculo_id, inspecao_id, pergunta_id, usuario_id,
                               tipo_mime, caminho, hash_arquivo, bytes, gps_lat, gps_lon,
                               cliente_id, capturado_em, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, eu.empresa_id, inspecao.veiculo_id, inspecao.id, perguntaId, eu.id,
       mime, caminho, hash, bytes,
       ctx.corpo.gps_lat ?? null, ctx.corpo.gps_lon ?? null,
       clienteId, ctx.corpo.capturado_em || ts, ts],
    )

    return { evidencia: consultarUm('SELECT * FROM evidencias WHERE id = ?', [id]) }
  })

  // Lista o que ja chegou — o aplicativo usa para nao reenviar.
  rotas.get('/api/inspecoes/:id/evidencias', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    const inspecao = inspecaoDoUsuario(eu.empresa_id, ctx.params.id, eu)
    return {
      evidencias: consultar(
        `SELECT id, pergunta_id, cliente_id, bytes, capturado_em
           FROM evidencias WHERE inspecao_id = ? ORDER BY capturado_em`, [inspecao.id]),
    }
  })

  // ------------------------------------------------------------- servir
  // A imagem NUNCA e' publica: passa pela sessao e pelo tenant, como qualquer
  // outro dado. Um link vazado nao vira acesso.
  rotas.get('/api/evidencias/:id', async (ctx) => {
    const eu = exigirAutenticado(ctx)
    const evidencia = consultarUm(
      'SELECT * FROM evidencias WHERE id = ? AND empresa_id = ?', [ctx.params.id, eu.empresa_id])
    if (!evidencia) throw erro.naoEncontrado('Evidencia nao encontrada.')
    if (evidencia.usuario_id !== eu.id && !ehFrota(eu)) {
      throw erro.permissao('Esta evidencia e de outra pessoa.')
    }

    const buffer = ler(evidencia.caminho)
    if (!buffer) throw erro.naoEncontrado('Arquivo da evidencia nao encontrado no storage.')

    ctx.res.writeHead(200, {
      'content-type': evidencia.tipo_mime,
      'content-length': buffer.length,
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff',
    })
    ctx.res.end(buffer)
    return undefined   // resposta ja enviada
  })
}
