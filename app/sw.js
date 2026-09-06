// Service worker do aplicativo de campo.
//
// Guarda a casca (HTML, CSS, JS e o motor compartilhado) para o app abrir no
// patio sem sinal. NAO guarda resposta de API: dado de frota velho e' pior que
// dado ausente — um veiculo pode ter sido bloqueado desde a ultima conexao.
// O contexto operacional fica no IndexedDB, com data de quando foi baixado, e
// a tela avisa quando esta mostrando copia.

const VERSAO = 'mylog-campo-v2'

const CASCA = [
  '/app/',
  '/app/index.html',
  '/app/css/campo.css',
  '/app/js/app.js',
  '/app/js/checklist.js',
  '/app/js/armazem.js',
  '/app/js/sincronia.js',
  '/app/manifest.json',
  '/app/icone.svg',
  '/css/estilo.css',
  '/js/tema-inicial.js',
  '/compartilhado/template.js',
]

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSAO)
      .then((cache) => cache.addAll(CASCA))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(
        chaves.filter((c) => c !== VERSAO).map((c) => caches.delete(c)),
      ))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (evento) => {
  const { request } = evento
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // API nunca vem do cache. Sem rede, quem responde e' o IndexedDB.
  if (url.pathname.startsWith('/api/')) return

  // Rede primeiro, cache como rede de seguranca: assim uma correcao publicada
  // chega no proximo carregamento com sinal, sem esperar troca de versao.
  evento.respondWith(
    fetch(request)
      .then((resposta) => {
        if (resposta.ok) {
          const copia = resposta.clone()
          caches.open(VERSAO).then((cache) => cache.put(request, copia))
        }
        return resposta
      })
      .catch(async () => {
        const guardado = await caches.match(request)
        if (guardado) return guardado
        // Navegacao dentro do app sem cache exato: entrega a casca.
        if (request.mode === 'navigate') {
          const casca = await caches.match('/app/index.html')
          if (casca) return casca
        }
        return new Response('Sem conexao e sem copia local.', {
          status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' },
        })
      }),
  )
})
