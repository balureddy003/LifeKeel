import { test, expect } from '@playwright/test'

/**
 * Signing out must leave nothing of the user's on the device — the case that
 * matters is a shared phone or iPad. Covers the legacy service-worker cache
 * (older workers cached /api/ responses), localStorage and the offline-queue
 * IndexedDB, on every device project.
 */
test('sign-out removes cached API data, the offline queue and per-user storage', async ({
  page,
}) => {
  await page.goto('/settings')
  await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible()

  // Simulate what v3 service workers left behind, plus an offline-queue DB
  // and the tenant key, so the assertions below don't depend on timing.
  await page.evaluate(async () => {
    const cache = await caches.open('lifekeel-v3')
    await cache.put('/api/family', new Response('{"name":"private"}'))
    await cache.put('/events', new Response('shell'))
    localStorage.setItem('lifekeel_tenant', 'tenant-1')
    await new Promise<void>((resolve) => {
      const req = indexedDB.open('lifekeel-offline', 1)
      req.onupgradeneeded = () =>
        req.result.createObjectStore('pending_mutations', { keyPath: 'id', autoIncrement: true })
      req.onsuccess = () => {
        req.result.close()
        resolve()
      }
    })
  })

  await page.getByRole('button', { name: 'Sign Out' }).click()
  // No URL assertion: sign-out lands on /login in Chromium but on the signed-out
  // landing page in WebKit; what matters is that the device data is gone.

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const apiEntries: string[] = []
        for (const name of await caches.keys()) {
          const cache = await caches.open(name)
          for (const req of await cache.keys()) {
            const { pathname } = new URL(req.url)
            if (pathname.startsWith('/api/') || pathname.startsWith('/engine/'))
              apiEntries.push(req.url)
          }
        }
        const dbs = (await indexedDB.databases()).map((d) => d.name)
        return {
          apiEntries,
          token: localStorage.getItem('lifekeel_token'),
          tenant: localStorage.getItem('lifekeel_tenant'),
          family: localStorage.getItem('family-auth'),
          hasOfflineDb: dbs.includes('lifekeel-offline') || dbs.includes('family-offline'),
        }
      }),
    )
    .toEqual({ apiEntries: [], token: null, tenant: null, family: null, hasOfflineDb: false })
})
