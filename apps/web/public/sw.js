/**
 * LifeKeel — Service Worker
 *
 * Offline-first strategy for non-technical family users:
 *   - App shell (pages) → Cache First with network update (stale-while-revalidate)
 *   - Static assets → Cache First
 *   - API calls → Network First, fallback to cache
 *   - Push notifications for urgent family alerts
 */

const CACHE_NAME = 'lifekeel-v3'
const STATIC_CACHE = 'lifekeel-static-v3'

// Every top-level authenticated route is pre-cached so a deep link or
// relaunch while offline still opens a real page instead of the browser's
// offline error. Dynamic routes (/member/[id], /events/[eventId], …) can't
// be listed here — they get cached on first visit via the navigation
// stale-while-revalidate path below.
const APP_SHELL = [
  '/',
  '/events',
  '/life-events',
  '/inbox',
  '/family',
  '/assistant',
  '/settings',
  '/financial-profile',
  '/vault',
  '/documents',
  '/cashflow',
  '/assets',
  '/upgrade',
  '/audit-log',
  '/support',
  '/readiness',
  '/welcome',
  '/login',
  '/signup',
  '/map',
  '/upload',
  '/connect',
  '/manifest.json',
  '/icon.svg',
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((c) => c.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME && k !== STATIC_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
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

  // API calls → Network First, fallback to cache
  if (isApiCall) {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone()
          caches.open(CACHE_NAME).then((c) => c.put(request, clone))
          return res
        })
        .catch(() => caches.match(request).then((c) => c ?? new Response(
          JSON.stringify({ error: 'offline', message: 'You are offline. Showing cached data.' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )))
    )
    return
  }

  // Navigation → Stale-while-revalidate (offline-first for app shell)
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request)
          .then((res) => {
            const clone = res.clone()
            caches.open(CACHE_NAME).then((c) => c.put(request, clone))
            return res
          })
          .catch(() => cached ?? caches.match('/'))
        return cached ?? fetchPromise
      })
    )
    return
  }

  // Static assets → Cache First
  if (url.pathname.match(/\.(js|css|woff2?|png|svg|ico|webp)$/)) {
    e.respondWith(
      caches.match(request).then((cached) =>
        cached ?? fetch(request).then((res) => {
          if (!res.ok) return res
          const clone = res.clone()
          caches.open(STATIC_CACHE).then((c) => c.put(request, clone))
          return res
        })
      )
    )
    return
  }

  // Everything else → Network with cache fallback
  e.respondWith(
    fetch(request).catch(() => caches.match(request))
  )
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
    })
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
