/**
 * Offline mutation queue — a write that fails because the network is gone
 * shouldn't be a lost write for a family-safety product.
 *
 * `fetchOrQueue` wraps a mutation fetch: if fetch() itself throws (offline,
 * DNS, tunnel dead — the request never reached the server), the mutation is
 * persisted to IndexedDB and 'queued' is returned so the caller keeps its
 * optimistic UI instead of rolling back. `flushMutationQueue` replays them
 * in order on reconnect — idempotent mutations only, and the queue
 * coalesces by path+method so toggling the same step three times offline
 * replays once with the last value.
 *
 * Deliberately NOT queued: anything the server version-guards (financial
 * profile autosave — a replayed save would 409 on a stale version), and
 * anything that isn't safe to retry blindly (checkout, account deletion).
 */

import { getApiBase } from './env'

const DB_NAME = 'lifekeel-offline'
const STORE = 'pending_mutations'

export interface QueuedMutation {
  id?: number
  path: string
  method: string
  body: string | null
  queuedAt: number
  label: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

export async function enqueueMutation(mutation: Omit<QueuedMutation, 'id'>): Promise<void> {
  try {
    const existing = await listMutations()
    // Same mutation queued twice offline (step toggled, dismissed again)
    // converges on the newest value — drop the stale entry.
    for (const m of existing) {
      if (m.path === mutation.path && m.method === mutation.method) {
        await withStore('readwrite', (s) => s.delete(m.id!))
      }
    }
    await withStore('readwrite', (s) => s.add(mutation))
  } catch {
    // IndexedDB unavailable (private mode, quota) — the write is lost, same
    // as before this existed. Better than throwing on the user's action.
  }
}

export async function listMutations(): Promise<QueuedMutation[]> {
  try {
    return await withStore('readonly', (s) => s.getAll() as IDBRequest<QueuedMutation[]>)
  } catch {
    return []
  }
}

export async function queueSize(): Promise<number> {
  return (await listMutations()).length
}

/**
 * Fetch wrapper for idempotent mutations. Returns the Response on success
 * (or on a server-answered error — those are for the caller to handle), or
 * 'queued' when the request never reached the network.
 */
export async function fetchOrQueue(
  path: string,
  init: RequestInit,
  label: string,
): Promise<Response | 'queued'> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('lifekeel_token') : null
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`
  try {
    return await fetch(`${getApiBase()}${path}`, { ...init, headers })
  } catch (err) {
    // fetch() throwing = the request never left the device. A non-TypeError
    // (e.g. an AbortError from a cancelled request) shouldn't be queued.
    if (err instanceof TypeError) {
      await enqueueMutation({
        path,
        method: init.method ?? 'POST',
        body: typeof init.body === 'string' ? init.body : null,
        queuedAt: Date.now(),
        label,
      })
      return 'queued'
    }
    throw err
  }
}

/**
 * Replay queued mutations oldest-first. Stops at the first network failure
 * (still offline); drops entries the server answers — a 404/409 means the
 * world moved on and retrying is wrong. Returns how many were replayed.
 */
export async function flushMutationQueue(): Promise<number> {
  const pending = await listMutations()
  if (pending.length === 0) return 0
  const token = localStorage.getItem('lifekeel_token')
  let replayed = 0
  for (const m of pending) {
    try {
      const res = await fetch(`${getApiBase()}${m.path}`, {
        method: m.method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: m.body,
      })
      // Any server response means it reached the world — success or a
      // definitive answer (already dismissed, already deleted), either
      // way there's nothing left to retry.
      await withStore('readwrite', (s) => s.delete(m.id!))
      if (res.ok) replayed++
    } catch (err) {
      if (err instanceof TypeError) break // still offline — keep the rest
    }
  }
  return replayed
}
