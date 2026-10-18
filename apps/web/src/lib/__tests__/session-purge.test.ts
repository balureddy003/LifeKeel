import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { purgeClientData } from '../session-purge'
import { cachedFetch } from '../fetch-cache'

function fakeIndexedDB() {
  const deleted: string[] = []
  const deleteDatabase = vi.fn((name: string) => {
    deleted.push(name)
    const req: { onsuccess?: () => void } = {}
    queueMicrotask(() => req.onsuccess?.())
    return req
  })
  return { deleted, api: { deleteDatabase } }
}

function fakeCaches(entries: Record<string, string[]>) {
  const store = new Map(Object.entries(entries).map(([name, urls]) => [name, new Set(urls)]))
  const api = {
    keys: async () => [...store.keys()],
    open: async (name: string) => ({
      keys: async () => [...(store.get(name) ?? [])].map((url) => ({ url })),
      delete: async (req: { url: string }) => store.get(name)?.delete(req.url) ?? false,
    }),
  }
  return { store, api }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('purgeClientData', () => {
  it('removes per-user localStorage keys but keeps the theme preference', async () => {
    for (const k of ['family-auth', 'lifekeel_token', 'lifekeel_tenant', 'family-mode']) {
      localStorage.setItem(k, 'x')
    }
    localStorage.setItem('lifekeel-theme', 'dark')
    vi.stubGlobal('indexedDB', fakeIndexedDB().api)

    await purgeClientData()

    for (const k of ['family-auth', 'lifekeel_token', 'lifekeel_tenant', 'family-mode']) {
      expect(localStorage.getItem(k)).toBeNull()
    }
    expect(localStorage.getItem('lifekeel-theme')).toBe('dark')
  })

  it('deletes both offline databases so queued mutations are not flushed under the next user', async () => {
    const idb = fakeIndexedDB()
    vi.stubGlobal('indexedDB', idb.api)

    await purgeClientData()

    expect(idb.deleted.sort()).toEqual(['family-offline', 'lifekeel-offline'])
  })

  it('drops cached API responses from every cache but keeps the app shell and assets', async () => {
    const c = fakeCaches({
      'lifekeel-v3': [
        'https://app.lifekeel.si/api/family',
        'https://app.lifekeel.si/engine/score',
        'https://app.lifekeel.si/events',
      ],
      'lifekeel-static-v3': ['https://app.lifekeel.si/_next/static/app.js'],
    })
    vi.stubGlobal('caches', c.api)
    vi.stubGlobal('indexedDB', fakeIndexedDB().api)

    await purgeClientData()

    expect([...c.store.get('lifekeel-v3')!]).toEqual(['https://app.lifekeel.si/events'])
    expect([...c.store.get('lifekeel-static-v3')!]).toEqual([
      'https://app.lifekeel.si/_next/static/app.js',
    ])
  })

  it('clears the in-memory read cache', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDB().api)
    const fetcher = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')
    expect(await cachedFetch('k', 60_000, fetcher)).toBe('first')

    await purgeClientData()

    expect(await cachedFetch('k', 60_000, fetcher)).toBe('second')
  })

  it('keeps going when a storage backend throws', async () => {
    localStorage.setItem('family-auth', 'x')
    vi.stubGlobal('indexedDB', {
      deleteDatabase: () => {
        throw new Error('blocked')
      },
    })
    vi.stubGlobal('caches', {
      keys: async () => {
        throw new Error('blocked')
      },
    })

    await expect(purgeClientData()).resolves.toBeUndefined()
    expect(localStorage.getItem('family-auth')).toBeNull()
  })
})
