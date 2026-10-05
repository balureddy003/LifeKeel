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

function getToken(): string | null {
  try {
    return localStorage.getItem('lifekeel_token')
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
    const res = await fetch(`${getApiBase()}/push/vapid-key`, {
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
    const res = await fetch(`${getApiBase()}/push/subscribe`, {
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

/** Unsubscribe this browser and tell the API to drop the endpoint. */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!isPushSupported()) return false
  try {
    const reg = await navigator.serviceWorker.ready
    const subscription = await reg.pushManager.getSubscription()
    if (!subscription) return true
    const endpoint = subscription.endpoint
    await subscription.unsubscribe()

    const token = getToken()
    const res = await fetch(`${getApiBase()}/push/unsubscribe`, {
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
