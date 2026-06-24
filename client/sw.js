const CACHE_NAME = 'grocerylk-v3'
const STATIC_CACHE = 'grocerylk-static-v3'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).then((res) => {
        const clone = res.clone()
        caches.open(CACHE_NAME).then((c) => c.put(request, clone))
        return res
      }).catch(() => caches.match(request))
    )
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).catch(() => caches.match(request))
    )
    return
  }

  event.respondWith(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.match(request).then((cached) => {
        const fetchAndCache = fetch(request).then((res) => {
          if (res.ok) cache.put(request, res.clone())
          return res
        })
        return cached || fetchAndCache
      })
    )
  )
})
