/**
 * MINEGUARD AI — service worker.
 *
 * Implements the offline-capable mobile-app requirement of PS SIH26024:
 * the inspection form must be usable underground (no signal). Strategy:
 *   * App shell (HTML/CSS/JS bundle) — cache-first, network-fallback.
 *   * /api/* reads — network-first; on failure, fall back to last cached
 *     response so the inspector can still see the register they last loaded.
 *   * /api/* writes (POST/PATCH) — when offline, queue into IndexedDB
 *     (mineguard-outbox) and replay on reconnect.
 *
 * The SW intentionally does not cache tile requests (OSM raster) —
 * those are large and the user is underground anyway. Map markers
 * are drawn from the cached zone list, so the GIS view still works
 * offline; only the basemap tiles go blank, which is acceptable.
 */
const CACHE_VERSION = 'mineguard-v1'
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL).catch(() => undefined)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  // Skip cross-origin (OSM tiles, etc) — never cache the basemap.
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // Never cache document uploads.
  if (req.url.includes('/api/documents/upload')) return

  // Read APIs: network-first with cache fallback.
  if (req.method === 'GET' && url.pathname.startsWith('/api/')) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req)
          // Cache a copy so a future offline request still has data.
          const cache = await caches.open(CACHE_VERSION)
          cache.put(req, res.clone())
          return res
        } catch (err) {
          const cached = await caches.match(req)
          if (cached) return cached
          // Last-ditch: an empty 200 with a sentinel payload so the UI can render an EmptyState.
          return new Response(JSON.stringify({ offline: true, detail: 'Network unavailable; showing last cached data.' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'X-Mineguard-Offline': '1' },
          })
        }
      })(),
    )
    return
  }

  // Write APIs: when offline, store in an outbox and respond with a queued acknowledgement.
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && url.pathname.startsWith('/api/')) {
    event.respondWith(
      (async () => {
        try {
          // First, try the network — if it succeeds, no need to queue.
          return await fetch(req)
        } catch (err) {
          // Network failed — queue the request for replay on reconnect.
          const body = await req.clone().text()
          await storeOutbox({ method: req.method, url: url.pathname, body, headers: Object.fromEntries(req.headers.entries()), at: Date.now() })
          return new Response(JSON.stringify({ queued: true, detail: 'Offline — your submission will be replayed on reconnect.' }), {
            status: 202,
            headers: { 'Content-Type': 'application/json', 'X-Mineguard-Queued': '1' },
          })
        }
      })(),
    )
    return
  }

  // App shell: cache-first.
  event.respondWith(
    (async () => {
      const cached = await caches.match(req)
      if (cached) return cached
      try {
        const res = await fetch(req)
        if (res && res.status === 200 && res.type === 'basic') {
          const cache = await caches.open(CACHE_VERSION)
          cache.put(req, res.clone())
        }
        return res
      } catch (err) {
        // Final fallback: serve index.html for any navigation request so the SPA still boots.
        if (req.mode === 'navigate') {
          const fallback = await caches.match('/index.html')
          if (fallback) return fallback
        }
        throw err
      }
    })(),
  )
})

// Simple outbox using IndexedDB — replay on the 'online' event.
async function storeOutbox(entry) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('outbox', 'readwrite')
    tx.objectStore('outbox').add(entry)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function drainOutbox() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('outbox', 'readwrite')
    const store = tx.objectStore('outbox')
    const req = store.getAll()
    req.onsuccess = async () => {
      const items = req.result || []
      for (const item of items) {
        try {
          const res = await fetch(item.url, {
            method: item.method,
            headers: item.headers,
            body: item.body,
          })
          if (res.ok) {
            await new Promise((r) => {
              const tx2 = db.transaction('outbox', 'readwrite')
              tx2.objectStore('outbox').delete(item.id)
              tx2.oncomplete = () => r()
            })
          }
        } catch (err) {
          // Stop on first failure — the network is still flaky.
          break
        }
      }
      resolve()
    }
    req.onerror = () => reject(req.error)
  })
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('mineguard-offline', 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('outbox')) {
        db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

self.addEventListener('message', async (event) => {
  if (event.data === 'mineguard:replay') {
    await drainOutbox()
    const clients = await self.clients.matchAll()
    clients.forEach((c) => c.postMessage({ type: 'mineguard:replay-done' }))
  }
})

self.addEventListener('online', drainOutbox)
