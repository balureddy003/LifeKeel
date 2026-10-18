/**
 * Tiny TTL cache for read-path API calls — the reason a page can paint
 * instantly instead of sitting on a skeleton while the network answers.
 *
 * A page that fetches on mount gets the cached value when it's fresh and
 * revalidates in the background; AppShell warms the highest-traffic reads
 * (inbox, insights) on idle so first navigation is instant too.
 *
 * Not a general cache — deliberately opt-in per endpoint, because only the
 * caller knows whether staleness is acceptable (30s-old inbox items: fine;
 * a balance: not fine).
 */

interface CacheEntry<T> {
  data: T
  at: number
}

const cache = new Map<string, CacheEntry<unknown>>()
const inflight = new Map<string, Promise<unknown>>()

/**
 * Return fresh-enough cached data, else fetch + cache. Concurrent callers
 * share one network request; AppShell keeps the hot keys warm so misses
 * on real navigations are rare.
 */
export async function cachedFetch<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key) as CacheEntry<T> | undefined
  if (hit && Date.now() - hit.at < ttlMs) {
    return hit.data
  }
  return revalidate(key, fetcher)
}

function revalidate<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  // Dedup concurrent callers — two components mounting the same tick share
  // one network request.
  const pending = inflight.get(key) as Promise<T> | undefined
  if (pending) return pending
  const p = fetcher()
    .then((data) => {
      cache.set(key, { data, at: Date.now() })
      return data
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

/** Populate the cache without anyone waiting on the result. */
export function warmCache<T>(key: string, fetcher: () => Promise<T>): void {
  const hit = cache.get(key) as CacheEntry<T> | undefined
  if (hit && Date.now() - hit.at < 30_000) return
  revalidate(key, fetcher).catch(() => {})
}

/** Drop an entry — after a mutation that changes what the read returns. */
export function invalidateCache(key: string): void {
  cache.delete(key)
}

// Also called on sign-out (session-purge.ts) so one user's cached reads
// never answer for the next. In tests, cachedFetch's module-level Map persists across
// every test in a file, so a mocked response from test 1 silently answers
// test 5's differently-mocked fetch — confirmed live: fetchFamilyInsights
// (cached 30s) made fetchFamilyReadinessScore's own tests all return the
// first test's score regardless of what each test mocked. Call this in a
// suite's afterEach/beforeEach when it exercises anything wrapped in
// cachedFetch.
export function clearAllCaches(): void {
  cache.clear()
  inflight.clear()
}
