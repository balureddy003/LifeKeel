/**
 * LifeKeel — Service Worker
 *
 * Offline-first strategy for non-technical family users:
 *   - App shell (pages) → Cache First with network update (stale-while-revalidate)
 *   - Static assets → Cache First
 *   - API calls → Network only (authenticated data is never cached)
 *   - Push notifications for urgent family alerts
 */

const CACHE_NAME = 'lifekeel-v6'
const STATIC_CACHE = 'lifekeel-static-v6'

// Public shell only (PRD-147). Authenticated routes are not precached: doing
// so fetched ~20 pages the user may never open, on first load, over mobile
// data. They are cached on first visit by the navigation
// stale-while-revalidate path below, so a relaunch while offline still works
// for the pages a person actually uses. Bumping the cache name makes the
// activate step delete the old, larger cache.
const APP_SHELL = ['/', '/login', '/signup', '/welcome', '/manifest.json', '/icon.svg']

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((c) => c.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME && k !== STATIC_CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const { request } = e
  const url = new URL(request.url)

  if (request.method !== 'GET') return

  const isApiCall = url.pathname.startsWith('/api/') || url.pathname.startsWith('/engine/')

  // Allow same-origin requests and cross-origin API calls (NEXT_PUBLIC_API_URL host)
  if (url.origin !== location.origin && !isApiCall) return

  // Next.js build assets → network only (versioned URLs)
  if (url.pathname.startsWith('/_next/')) {
    e.respondWith(fetch(request))
    return
  }

  // API calls → Network only. Responses are authenticated family data, so
  // they are never written to Cache Storage: a shared phone or iPad must not
  // be able to replay the previous user's data offline after sign-out.
  if (isApiCall) {
    e.respondWith(
      fetch(request).catch(
        () =>
          new Response(JSON.stringify({ error: 'offline', message: 'You are offline.' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )
    return
  }

  // Navigation → Network first, cache fallback. Stale-while-revalidate here
  // served the *previous release's* bundle after every deploy — the cached
  // HTML references build chunks that no longer exist, so returning users
  // ran a stale app (intent 58). The cache still covers a true offline open.
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone()
            caches.open(CACHE_NAME).then((c) => c.put(request, clone))
          }
          return res
        })
        .catch(() => caches.match(request).then((cached) => cached ?? caches.match('/'))),
    )
    return
  }

  // Static assets → Cache First
  if (url.pathname.match(/\.(js|css|woff2?|png|svg|ico|webp)$/)) {
    e.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((res) => {
            if (!res.ok) return res
            const clone = res.clone()
            caches.open(STATIC_CACHE).then((c) => c.put(request, clone))
            return res
          }),
      ),
    )
    return
  }

  // Everything else → Network with cache fallback
  e.respondWith(fetch(request).catch(() => caches.match(request)))
})

// Push notifications
self.addEventListener('push', (e) => {
  if (!e.data) return
  const data = e.data.json()
  e.waitUntil(
    self.registration.showNotification(data.title ?? 'LifeKeel', {
      body: data.body ?? '',
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: data.tag ?? 'lifekeel',
      data: data.url ? { url: data.url } : undefined,
      vibrate: [200, 100, 200],
    }),
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  if (e.notification.data?.url) {
    e.waitUntil(clients.openWindow(e.notification.data.url))
  }
})

// Background sync for offline actions
self.addEventListener('sync', (e) => {
  if (e.tag === 'sync-family-actions') {
    e.waitUntil(syncFamilyActions())
  }
})

async function syncFamilyActions() {
  const db = await openOfflineDB()
  const pending = await db.getAll('pendingActions')
  for (const action of pending) {
    try {
      await fetch(action.url, {
        method: action.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action.body),
      })
      await db.delete('pendingActions', action.id)
    } catch {
      // Will retry on next sync
    }
  }
}

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('family-offline', 1)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('pendingActions')) {
        db.createObjectStore('pendingActions', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('familyData')) {
        db.createObjectStore('familyData', { keyPath: 'key' })
      }
    }
  })
}
