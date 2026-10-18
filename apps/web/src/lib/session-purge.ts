import { clearAllCaches } from './fetch-cache'

/**
 * Everything on this device that can hold a signed-in user's data. Keep in
 * sync with the writers: auth-context.tsx (family-auth, lifekeel_token),
 * offline-queue.ts (lifekeel-offline), public/sw.js (lifekeel-* caches,
 * family-offline). `lifekeel-theme` is deliberately kept — it's a device
 * preference, not personal data.
 */
const LOCAL_STORAGE_KEYS = ['family-auth', 'lifekeel_token', 'lifekeel_tenant', 'family-mode']
const INDEXED_DB_NAMES = ['lifekeel-offline', 'family-offline']

// Same paths public/sw.js treats as API calls.
const isApiPath = (pathname: string) =>
  pathname.startsWith('/api/') || pathname.startsWith('/engine/')

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name)
      // Resolve on blocked too: another tab holding the DB open must not hang
      // sign-out; the delete completes once that connection closes.
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    } catch {
      resolve()
    }
  })
}

/**
 * Wipe all client-side copies of user data. Called on sign-out and whenever
 * the server rejects the session, so the next person on a shared phone or
 * iPad can't read the previous user's data from caches or the offline queue.
 * Service-worker API entries are cleared by path. Every step is best-effort — storage can be blocked (private mode, ITP) and
 * one failure must not stop the rest. Any mutations still queued offline are
 * discarded, not flushed under a different user.
 */
export async function purgeClientData(): Promise<void> {
  try {
    for (const key of LOCAL_STORAGE_KEYS) localStorage.removeItem(key)
  } catch {
    // storage blocked
  }

  clearAllCaches()

  const tasks: Promise<unknown>[] = INDEXED_DB_NAMES.map(deleteDatabase)

  if (typeof caches !== 'undefined') {
    // Only API entries are personal. The app shell and static assets are
    // public build output — keeping them preserves the offline launch.
    // sw.js no longer writes API responses; this clears entries left by
    // older workers that did.
    tasks.push(
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names.map(async (name) => {
              const cache = await caches.open(name)
              const requests = await cache.keys()
              await Promise.all(
                requests
                  .filter((r) => isApiPath(new URL(r.url).pathname))
                  .map((r) => cache.delete(r)),
              )
            }),
          ),
        )
        .catch(() => {}),
    )
  }

  await Promise.all(tasks)
}
