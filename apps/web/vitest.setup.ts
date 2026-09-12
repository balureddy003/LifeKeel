import '@testing-library/jest-dom/vitest'

// Neither jsdom nor Node 22+'s own experimental `localStorage` global (which
// requires --localstorage-file and otherwise resolves to undefined) reliably
// provide a working Storage here — jsdom detects the native global exists and
// declines to shim its own. Provide a plain in-memory Storage instead, since
// what matters for these tests is that app code's localStorage calls behave
// consistently, not which implementation backs them.
class MemoryStorage implements Storage {
  private store = new Map<string, string>()

  get length() {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
}

Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  writable: true,
  configurable: true,
})
