/**
 * Where the browser keeps the API bearer token (R21).
 *
 * The session is the HttpOnly cookie the API sets on sign-in, which page
 * scripts can't read. The bearer token only exists for browsers that block
 * that cookie because the API is on a different site (Safari ITP). So after
 * every sign-in we ask the API whether the cookie alone works; if it does,
 * the token is deleted from storage and nothing script-readable remains.
 * Where the cookie is blocked, the token stays as the fallback until the
 * API is served same-site and this module can drop storage entirely.
 *
 * The native shell keeps its token: there is no cross-site cookie inside
 * the app's WebView.
 */
import { credFetch } from '@/lib/http'
import { getApiBase } from '@/lib/env'
import { isNativeShell } from '@/lib/native'

const KEY = 'lifekeel_token'
let memoryToken: string | null = null

export function getSessionToken(): string | null {
  if (typeof window === 'undefined') return null
  // Storage first: it reflects the latest sign-in in any tab. Memory covers
  // this page once the stored copy was dropped because the cookie works.
  try {
    return localStorage.getItem(KEY) ?? memoryToken
  } catch {
    return memoryToken
  }
}

export function clearSessionToken(): void {
  memoryToken = null
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* storage blocked */
  }
}

/** Call with the token a sign-in response returned. */
export function storeSessionToken(token: string | null | undefined): void {
  if (!token || typeof window === 'undefined') return
  memoryToken = token
  try {
    localStorage.setItem(KEY, token)
  } catch {
    /* storage blocked: memory only for this page */
  }
  if (!isNativeShell()) void dropTokenIfCookieWorks(token)
}

/** Removes the stored `token` when the cookie session works on its own.
 *  A different token stored meanwhile (a newer sign-in) is left alone. */
export async function dropTokenIfCookieWorks(token: string): Promise<void> {
  try {
    const res = await credFetch(`${getApiBase()}/auth/me`)
    if (!res.ok) return
    try {
      if (localStorage.getItem(KEY) === token) {
        memoryToken = token
        localStorage.removeItem(KEY)
      }
    } catch {
      /* nothing stored */
    }
    // Memory keeps working for this page view even if the next request's
    // cookie were to fail; a reload relies on the cookie alone.
  } catch {
    /* offline: keep the fallback */
  }
}
