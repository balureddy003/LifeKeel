/**
 * FCM HTTP v1 sender for the native shell (PRD-140). The Capacitor push plugin
 * returns an FCM token on Android, and on iOS once the Firebase SDK is added to
 * the shell; the Expo relay in channels.ts cannot deliver to either.
 *
 * Env-gated: with no `FCM_SERVICE_ACCOUNT_JSON` the sender reports itself not
 * configured and the router never selects it, so merging this changes nothing
 * until credentials exist. It signs its own service-account JWT with Node's
 * crypto (no new dependency) and caches the access token until shortly before
 * it expires.
 *
 * NOT VERIFIED AGAINST A REAL DEVICE OR PROJECT: covered by unit tests with an
 * injected fetch only. Payloads come from push-payload.ts, so nothing financial
 * is sent.
 */
import crypto from 'node:crypto'
import { PermanentPushFailure, type MobilePushSender, type MobilePushPayload } from './channels.js'

interface ServiceAccount {
  project_id: string
  client_email: string
  private_key: string
  token_uri?: string
}

type Fetch = typeof fetch

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url')

export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw) return null
  try {
    const j = JSON.parse(raw) as Partial<ServiceAccount>
    return j.project_id && j.client_email && j.private_key ? (j as ServiceAccount) : null
  } catch {
    return null
  }
}

export class FcmMobilePushSender implements MobilePushSender {
  private cached: { token: string; expiresAt: number } | null = null

  constructor(
    private readonly account: ServiceAccount | null = parseServiceAccount(
      process.env['FCM_SERVICE_ACCOUNT_JSON'],
    ),
    private readonly fetchImpl: Fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  isConfigured(): boolean {
    return this.account !== null
  }

  private async accessToken(): Promise<string> {
    const acct = this.account!
    if (this.cached && this.cached.expiresAt - 60_000 > this.now()) return this.cached.token
    const iat = Math.floor(this.now() / 1000)
    const tokenUri = acct.token_uri ?? 'https://oauth2.googleapis.com/token'
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const claims = b64url(
      JSON.stringify({ iss: acct.client_email, scope: SCOPE, aud: tokenUri, iat, exp: iat + 3600 }),
    )
    const signature = crypto
      .createSign('RSA-SHA256')
      .update(`${header}.${claims}`)
      .sign(acct.private_key)
    const res = await this.fetchImpl(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${header}.${claims}.${b64url(signature)}`,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`FCM auth returned ${res.status}`)
    const json = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!json.access_token) throw new Error('FCM auth returned no access token')
    this.cached = {
      token: json.access_token,
      expiresAt: this.now() + (json.expires_in ?? 3600) * 1000,
    }
    return json.access_token
  }

  async send(token: string, payload: MobilePushPayload): Promise<{ id?: string }> {
    if (!this.account) throw new Error('FCM not configured — set FCM_SERVICE_ACCOUNT_JSON')
    const access = await this.accessToken()
    const res = await this.fetchImpl(
      `https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: payload.title, body: payload.body },
            ...(payload.data
              ? {
                  data: Object.fromEntries(
                    Object.entries(payload.data).map(([k, v]) => [k, String(v)]),
                  ),
                }
              : {}),
            android: { priority: 'HIGH' },
            apns: { headers: { 'apns-priority': '10' } },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as { name?: string }
      return json.name ? { id: json.name } : {}
    }
    const err = (await res.json().catch(() => ({}))) as {
      error?: { status?: string; details?: { errorCode?: string }[] }
    }
    const code = err.error?.details?.find((d) => d.errorCode)?.errorCode ?? err.error?.status
    if (res.status === 404 || code === 'UNREGISTERED') {
      throw new PermanentPushFailure(`FCM token no longer registered (${code ?? res.status})`)
    }
    throw new Error(`FCM send returned ${res.status}${code ? ` (${code})` : ''}`)
  }
}

const isExpoToken = (t: string) => /^Expo(nent)?PushToken\[/.test(t)

/** Routes by token shape: Expo tokens to the Expo relay, everything else to FCM. */
export class CompositeMobilePushSender implements MobilePushSender {
  constructor(
    private readonly expo: MobilePushSender,
    private readonly fcm: FcmMobilePushSender,
  ) {}

  async send(token: string, payload: MobilePushPayload): Promise<{ id?: string }> {
    if (isExpoToken(token)) return this.expo.send(token, payload)
    if (!this.fcm.isConfigured()) throw new Error('FCM not configured for this token')
    return this.fcm.send(token, payload)
  }
}
