/**
 * Web push client — subscribes this browser to Keel's push notifications.
 *
 * Flow: Notification permission → service worker → PushManager.subscribe
 * (with the server's VAPID public key) → POST the subscription to the API.
 * The API stores it per-tenant and the DeliveryRouter handles the rest
 * (urgency floor, quiet hours, dedup, signed approve/dismiss links).
 *
 * Designed to degrade cleanly: unconfigured server (503 on vapid-key),
 * denied permission, or a browser with no PushManager all return false
 * rather than throwing — the caller decides what to tell the user.
 */

import { getApiBase } from './env'
import { credFetch } from './http'
import {
  getStoredPushToken,
  isNativeShell,
  nativePlatform,
  requestNativePushToken,
  storePushToken,
} from './native'
import { getSessionToken } from '@/lib/session-token'

function getToken(): string | null {
  try {
    return getSessionToken()
  } catch {
    return null
  }
}

/** Base64url → Uint8Array, as PushManager.subscribe expects. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** Fetch the server's VAPID public key. Null when push isn't configured. */
export async function fetchVapidKey(): Promise<string | null> {
  try {
    const token = getToken()
    const res = await credFetch(`${getApiBase()}/push/vapid-key`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) return null
    const data = await res.json()
    return typeof data.publicKey === 'string' ? data.publicKey : null
  } catch {
    return null
  }
}

/** Is this browser currently subscribed? */
export async function isPushSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    return sub !== null
  } catch {
    return false
  }
}

/** Permission + subscribe + register with the API. False on any failure. */
export async function subscribeToPush(): Promise<boolean> {
  if (!isPushSupported()) return false
  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return false

    const vapidKey = await fetchVapidKey()
    if (!vapidKey) return false

    const reg = await navigator.serviceWorker.ready
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
    })

    const json = subscription.toJSON()
    const token = getToken()
    const res = await credFetch(`${getApiBase()}/push/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ endpoint: subscription.endpoint, keys: json.keys }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Unsubscribe this browser and tell the API to drop the endpoint.
 *  `authToken` lets sign-out pass the session token it captured before the
 *  local wipe removes it. */
export async function unsubscribeFromPush(authToken?: string | null): Promise<boolean> {
  if (!isPushSupported()) return false
  try {
    const reg = await navigator.serviceWorker.ready
    const subscription = await reg.pushManager.getSubscription()
    if (!subscription) return true
    const endpoint = subscription.endpoint
    await subscription.unsubscribe()

    const token = authToken ?? getToken()
    const res = await credFetch(`${getApiBase()}/push/unsubscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ endpoint }),
    })
    return res.ok
  } catch {
    return false
  }
}

// ── Native shell push (PRD-140) ──────────────────────────────────────────

/** Permission, device token, register with the API. False on any failure. */
export async function subscribeNativePush(): Promise<boolean> {
  if (!isNativeShell()) return false
  const deviceToken = await requestNativePushToken()
  if (!deviceToken) return false
  try {
    const token = getToken()
    const res = await credFetch(`${getApiBase()}/push/mobile/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ token: deviceToken, platform: nativePlatform() }),
    })
    if (res.ok) await storePushToken(deviceToken)
    return res.ok
  } catch {
    return false
  }
}

/** Drop this device's native token on the server and forget it locally. */
export async function unsubscribeNativePush(authToken?: string | null): Promise<boolean> {
  const deviceToken = await getStoredPushToken()
  if (!deviceToken) return true
  try {
    const token = authToken ?? getToken()
    const res = await credFetch(`${getApiBase()}/push/mobile/unsubscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ token: deviceToken }),
    })
    if (res.ok) await storePushToken(null)
    return res.ok
  } catch {
    return false
  }
}

/**
 * Sign-out cleanup: stop this device receiving the signed-out user's alerts,
 * on a phone or iPad the next person may pick up. The session token is read
 * once, up front, because the local wipe removes it. Best effort: sign-out
 * never waits on or fails because of this.
 */
export async function unregisterAllPush(): Promise<void> {
  const authToken = getToken()
  await Promise.allSettled([unsubscribeFromPush(authToken), unsubscribeNativePush(authToken)])
}
