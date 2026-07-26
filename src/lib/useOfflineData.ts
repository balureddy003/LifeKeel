'use client'

import { useCallback, useEffect, useState } from 'react'

const DB_NAME = 'family-offline'
const DB_VERSION = 1
const DATA_STORE = 'familyData'
const ACTION_STORE = 'pendingActions'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(DATA_STORE)) {
        db.createObjectStore(DATA_STORE, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(ACTION_STORE)) {
        db.createObjectStore(ACTION_STORE, { keyPath: 'id' })
      }
    }
  })
}

export function useOfflineData<T>(key: string, fetchFn: () => Promise<T>): {
  data: T | null
  loading: boolean
  error: Error | null
  refresh: () => Promise<void>
} {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    // Try IndexedDB cache first (offline-first)
    try {
      const db = await openDB()
      const tx = db.transaction(DATA_STORE, 'readonly')
      const store = tx.objectStore(DATA_STORE)
      const cached = await new Promise<{ key: string; data: T; timestamp: number } | null>(
        (resolve, reject) => {
          const req = store.get(key)
          req.onsuccess = () => resolve(req.result ?? null)
          req.onerror = () => reject(req.error)
        }
      )
      if (cached) {
        setData(cached.data)
        setLoading(false)
      }
    } catch {
      // IndexedDB not available — continue to network
    }

    // Then try network (stale-while-revalidate)
    try {
      const result = await fetchFn()
      setData(result)
      setLoading(false)

      // Persist to IndexedDB for next offline use
      try {
        const db = await openDB()
        const tx = db.transaction(DATA_STORE, 'readwrite')
        const store = tx.objectStore(DATA_STORE)
        store.put({ key, data: result, timestamp: Date.now() })
      } catch {
        // Storage full or unavailable — non-fatal
      }
    } catch (e) {
      setError(e as Error)
      setLoading(false)
    }
  }, [key, fetchFn])

  useEffect(() => {
    load()
  }, [load])

  return { data, loading, error, refresh: load }
}

export function useOfflineActions() {
  const [pendingCount, setPendingCount] = useState(0)
  const [isOnline, setIsOnline] = useState(true)

  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  const queueAction = useCallback(async (action: {
    id: string
    url: string
    method: string
    body: unknown
  }) => {
    try {
      const db = await openDB()
      const tx = db.transaction(ACTION_STORE, 'readwrite')
      tx.objectStore(ACTION_STORE).put({ ...action, timestamp: Date.now(), synced: false })

      // Request background sync
      const sw = navigator.serviceWorker as unknown as { sync?: { register: (tag: string) => Promise<void> } }
      if ('serviceWorker' in navigator && sw?.sync) {
        try {
          const reg = await navigator.serviceWorker.ready
          await (reg as unknown as { sync: { register: (tag: string) => Promise<void> } }).sync.register('sync-family-actions')
        } catch {
          // Background sync not supported
        }
      }
    } catch {
      // IndexedDB not available
    }
  }, [])

  const syncPending = useCallback(async () => {
    if (!isOnline) return
    try {
      const db = await openDB()
      const tx = db.transaction(ACTION_STORE, 'readwrite')
      const store = tx.objectStore(ACTION_STORE)
      const pending = await new Promise<Array<{ id: string; url: string; method: string; body: unknown }>>(
        (resolve, reject) => {
          const req = store.getAll()
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => reject(req.error)
        }
      )

      for (const action of pending) {
        try {
          const res = await fetch(action.url, {
            method: action.method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(action.body),
          })
          if (res.ok) {
            store.delete(action.id)
          }
        } catch {
          // Will retry
        }
      }
    } catch {
      // IndexedDB not available
    }
  }, [isOnline])

  useEffect(() => {
    if (isOnline) syncPending()
  }, [isOnline, syncPending])

  return { queueAction, syncPending, pendingCount, isOnline }
}
