/**
 * Email one-time codes (CLOUDFLARE_INTEGRATION.md §6).
 *
 * One **chain** per authentication attempt, identified by a stable
 * `chain_id`. A resend replaces the code inside the same chain
 * (`code_version + 1`, attempts reset); the chain's absolute expiry never
 * moves. Codes are stored only as HMAC-SHA256(pepper, chain:version:code).
 *
 * Every limit is an atomic conditional database operation, never
 * check-then-write (D12):
 *   - send budget: cooldown / hourly / daily upserts in `otp_send_windows`,
 *     whose documents outlive the challenge so restarting signup or login
 *     cannot reset them;
 *   - verify: claim an attempt and read the hash in one findOneAndUpdate,
 *     compare in constant time, then consume conditional on the compared
 *     code_version.
 *
 * What this is and isn't: mailbox-ownership verification and a second step
 * against password-only attacks. It is not phishing-resistant MFA; the
 * pending token is a bearer credential a relay proxy can forward (§6.1).
 */
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Collection, Db } from 'mongodb'
import type { Env } from '../security/boot-guards.js'
import { isDevOrTest, purposeKey } from './signing-key.js'
import type { OtpPurpose } from './otp-token.js'

export const OTP_CODE_TTL_MS = 10 * 60 * 1000
export const OTP_CHAIN_TTL_MS = 30 * 60 * 1000
export const OTP_MAX_ATTEMPTS = 5
export const OTP_COOLDOWN_MS = 60 * 1000
export const OTP_MAX_PER_HOUR = 5
export const OTP_MAX_PER_DAY = 10
/** Budget windows are retained this long past their end (TTL index). */
const WINDOW_RETENTION_MS = 25 * 60 * 60 * 1000

export type AuthOtpMode = 'off' | 'signup' | 'signup_login'

export function authOtpMode(env: Env, deploymentMode: string): AuthOtpMode {
  const raw = env['AUTH_OTP_MODE']
  if (raw === 'off' || raw === 'signup' || raw === 'signup_login') return raw
  return deploymentMode === 'dev' ? 'off' : 'signup_login'
}

export const otpRequiredFor = (mode: AuthOtpMode, purpose: OtpPurpose): boolean =>
  purpose === 'signup' ? mode !== 'off' : mode === 'signup_login'

export function evaluateOtpBoot(
  env: Env,
  deploymentMode: string,
): { violations: string[]; exceptions: string[] } {
  const mode = authOtpMode(env, deploymentMode)
  const violations: string[] = []
  const exceptions: string[] = []
  if (deploymentMode === 'dev') return { violations, exceptions }
  if (mode !== 'signup_login') exceptions.push(`AUTH_OTP_MODE=${mode}`)
  if (mode !== 'off') {
    if ((env['OTP_PEPPER'] ?? '').length < 32)
      violations.push('AUTH_OTP_MODE requires OTP_PEPPER (at least 32 characters) outside dev')
    if (!env['SENDGRID_API_KEY'])
      violations.push('AUTH_OTP_MODE requires SENDGRID_API_KEY outside dev')
  }
  return { violations, exceptions }
}

// ── Code and hash ──────────────────────────────────────────────────────────

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function currentPepper(): { kid: string; key: Buffer } {
  const secret = process.env['OTP_PEPPER']
  if (secret && secret.length >= 32)
    return { kid: process.env['OTP_PEPPER_ID'] ?? 'v1', key: Buffer.from(secret) }
  if (!isDevOrTest()) throw new Error('OTP_PEPPER must be set outside dev/test')
  return { kid: 'dev', key: purposeKey('otp-pepper') }
}

/** The previous pepper stays usable for in-flight chains during a rotation. */
function pepperFor(kid: string): Buffer | null {
  const cur = currentPepper()
  if (kid === cur.kid) return cur.key
  const prevId = process.env['OTP_PEPPER_PREVIOUS_ID']
  const prev = process.env['OTP_PEPPER_PREVIOUS']
  return prevId === kid && prev ? Buffer.from(prev) : null
}

export function hashOtpCode(key: Buffer, chainId: string, version: number, code: string): string {
  return createHmac('sha256', key).update(`${chainId}:${version}:${code}`).digest('hex')
}

function constantTimeHexEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right)
}

// ── Collections ────────────────────────────────────────────────────────────

export interface OtpChain {
  chain_id: string
  user_id: string
  tenant_id: string
  purpose: OtpPurpose
  /** Signup only: the pending-registration version this chain may activate. */
  registration_version: string | null
  code_hash: string
  pepper_kid: string
  code_version: number
  attempts: number
  code_expires_at: Date
  chain_expires_at: Date
  created_at: Date
  last_sent_at: Date
  consumed_at: Date | null
  delivery: 'sent' | 'failed' | 'unknown'
  /** Login only: the session length the user asked for at the password step. */
  remember_me: boolean
  purge_at: Date
}

interface OtpSendWindow {
  _id: string
  count?: number
  next_send_at?: Date
  expires_at: Date
}

export const otpChains = (db: Db): Collection<OtpChain> => db.collection<OtpChain>('otp_chains')
const sendWindows = (db: Db): Collection<OtpSendWindow> =>
  db.collection<OtpSendWindow>('otp_send_windows')

export async function ensureOtpIndexes(db: Db): Promise<void> {
  await Promise.all([
    otpChains(db).createIndex({ chain_id: 1 }, { unique: true }),
    otpChains(db).createIndex({ user_id: 1, purpose: 1, created_at: -1 }),
    otpChains(db).createIndex({ purge_at: 1 }, { expireAfterSeconds: 0 }),
    sendWindows(db).createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
  ])
}

const isDuplicateKey = (err: unknown): boolean => (err as { code?: number })?.code === 11000

// ── Send budget ────────────────────────────────────────────────────────────

export type ReserveResult =
  | { ok: true; resendAvailableAt: Date }
  | { ok: false; reason: 'cooldown'; retryAfterS: number }
  | { ok: false; reason: 'hourly' | 'daily' }

function utcKey(d: Date, unit: 'h' | 'd'): { key: string; end: Date } {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  if (unit === 'd') {
    return { key: `${y}${m}${day}`, end: new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate() + 1)) }
  }
  const h = String(d.getUTCHours()).padStart(2, '0')
  return {
    key: `${y}${m}${day}${h}`,
    end: new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate(), d.getUTCHours() + 1)),
  }
}

/**
 * Account-wide per-user budget covering every issuance path. Three
 * conditional upserts in order; the first refusal aborts. A counter spent by
 * an earlier step stays spent if a later one refuses (fails closed).
 */
export async function reserveSend(db: Db, userId: string, now = new Date()): Promise<ReserveResult> {
  const col = sendWindows(db)
  const nextSendAt = new Date(now.getTime() + OTP_COOLDOWN_MS)
  try {
    await col.updateOne(
      { _id: `${userId}:cool`, next_send_at: { $lte: now } },
      {
        $set: {
          next_send_at: nextSendAt,
          expires_at: new Date(now.getTime() + WINDOW_RETENTION_MS),
        },
      },
      { upsert: true },
    )
  } catch (err) {
    if (!isDuplicateKey(err)) throw err
    const doc = await col.findOne({ _id: `${userId}:cool` })
    const waitMs = Math.max(0, (doc?.next_send_at?.getTime() ?? now.getTime()) - now.getTime())
    return { ok: false, reason: 'cooldown', retryAfterS: Math.ceil(waitMs / 1000) }
  }
  for (const [unit, max, reason] of [
    ['h', OTP_MAX_PER_HOUR, 'hourly'],
    ['d', OTP_MAX_PER_DAY, 'daily'],
  ] as const) {
    const { key, end } = utcKey(now, unit)
    try {
      await col.updateOne(
        { _id: `${userId}:${unit}:${key}`, count: { $lt: max } },
        {
          $inc: { count: 1 },
          $setOnInsert: { expires_at: new Date(end.getTime() + WINDOW_RETENTION_MS) },
        },
        { upsert: true },
      )
    } catch (err) {
      if (!isDuplicateKey(err)) throw err
      return { ok: false, reason }
    }
  }
  return { ok: true, resendAvailableAt: nextSendAt }
}

/** After a definite delivery failure the user may resend at once (§6.8); the budget is not refunded. */
export async function releaseCooldown(db: Db, userId: string, now = new Date()): Promise<void> {
  await sendWindows(db).updateOne({ _id: `${userId}:cool` }, { $set: { next_send_at: now } })
}

// ── Chains ─────────────────────────────────────────────────────────────────

export interface IssuedCode {
  chain: OtpChain
  code: string
}

export async function issueChain(
  db: Db,
  input: {
    user_id: string
    tenant_id: string
    purpose: OtpPurpose
    registration_version: string | null
    remember_me?: boolean
  },
  now = new Date(),
): Promise<IssuedCode> {
  const code = generateOtpCode()
  const chain_id = randomUUID()
  const pepper = currentPepper()
  const chainExpires = new Date(now.getTime() + OTP_CHAIN_TTL_MS)
  const chain: OtpChain = {
    chain_id,
    user_id: input.user_id,
    tenant_id: input.tenant_id,
    purpose: input.purpose,
    registration_version: input.registration_version,
    code_hash: hashOtpCode(pepper.key, chain_id, 1, code),
    pepper_kid: pepper.kid,
    code_version: 1,
    attempts: 0,
    code_expires_at: new Date(now.getTime() + OTP_CODE_TTL_MS),
    chain_expires_at: chainExpires,
    created_at: now,
    last_sent_at: now,
    consumed_at: null,
    delivery: 'unknown',
    remember_me: input.remember_me === true,
    purge_at: new Date(chainExpires.getTime() + 60 * 60 * 1000),
  }
  await otpChains(db).insertOne({ ...chain })
  return { chain, code }
}

export type ResendResult =
  | { ok: true; issued: IssuedCode }
  | { ok: false; reason: 'expired' }

/** New code in the same chain: version+1, attempts 0, code TTL restarts, chain TTL unchanged. */
export async function resendInChain(
  db: Db,
  ids: { chain_id: string; user_id: string; purpose: OtpPurpose },
  now = new Date(),
): Promise<ResendResult> {
  const col = otpChains(db)
  const current = await col.findOne({
    chain_id: ids.chain_id,
    user_id: ids.user_id,
    purpose: ids.purpose,
    consumed_at: null,
    chain_expires_at: { $gt: now },
  })
  if (!current) return { ok: false, reason: 'expired' }
  const code = generateOtpCode()
  const pepper = currentPepper()
  const nextVersion = current.code_version + 1
  // Conditional on the version we read: two racing resends cannot both win,
  // and a verify that already consumed the chain stops this one.
  const updated = await col.findOneAndUpdate(
    {
      chain_id: ids.chain_id,
      code_version: current.code_version,
      consumed_at: null,
      chain_expires_at: { $gt: now },
    },
    {
      $set: {
        code_hash: hashOtpCode(pepper.key, ids.chain_id, nextVersion, code),
        pepper_kid: pepper.kid,
        code_version: nextVersion,
        attempts: 0,
        code_expires_at: new Date(now.getTime() + OTP_CODE_TTL_MS),
        last_sent_at: now,
        delivery: 'unknown',
      },
    },
    { returnDocument: 'after' },
  )
  if (!updated) return { ok: false, reason: 'expired' }
  return { ok: true, issued: { chain: updated, code } }
}

export async function recordDelivery(
  db: Db,
  chainId: string,
  version: number,
  delivery: OtpChain['delivery'],
): Promise<void> {
  await otpChains(db).updateOne({ chain_id: chainId, code_version: version }, { $set: { delivery } })
}

export type VerifyResult =
  | { ok: true; chain: OtpChain }
  | { ok: false; reason: 'invalid'; attemptsLeft: number }
  | { ok: false; reason: 'expired' | 'locked' }

/**
 * §6.3.1 steps 1–3. Every call that reaches the compare has already spent
 * an attempt, so parallel guesses cannot evaluate more than five codes.
 */
export async function verifyChain(
  db: Db,
  ids: { chain_id: string; user_id: string; purpose: OtpPurpose },
  code: string,
  now = new Date(),
): Promise<VerifyResult> {
  const col = otpChains(db)
  const claimed = await col.findOneAndUpdate(
    {
      chain_id: ids.chain_id,
      user_id: ids.user_id,
      purpose: ids.purpose,
      consumed_at: null,
      code_expires_at: { $gt: now },
      chain_expires_at: { $gt: now },
      attempts: { $lt: OTP_MAX_ATTEMPTS },
    },
    { $inc: { attempts: 1 } },
    { returnDocument: 'after' },
  )
  if (!claimed) {
    const doc = await col.findOne({ chain_id: ids.chain_id, user_id: ids.user_id })
    const live =
      doc &&
      doc.consumed_at === null &&
      doc.code_expires_at > now &&
      doc.chain_expires_at > now
    return { ok: false, reason: live ? 'locked' : 'expired' }
  }

  const key = pepperFor(claimed.pepper_kid)
  const matches =
    key !== null &&
    constantTimeHexEqual(
      hashOtpCode(key, claimed.chain_id, claimed.code_version, code),
      claimed.code_hash,
    )
  if (!matches) {
    const attemptsLeft = Math.max(0, OTP_MAX_ATTEMPTS - claimed.attempts)
    return attemptsLeft === 0
      ? { ok: false, reason: 'locked' }
      : { ok: false, reason: 'invalid', attemptsLeft }
  }

  // Only one of two concurrent correct submissions can win; a resend that
  // landed after the claim changed code_version and makes this miss.
  const consumed = await col.updateOne(
    { chain_id: claimed.chain_id, consumed_at: null, code_version: claimed.code_version },
    { $set: { consumed_at: now } },
  )
  if (consumed.modifiedCount !== 1) return { ok: false, reason: 'expired' }
  return { ok: true, chain: { ...claimed, consumed_at: now } }
}

/** "j***@example.com": enough for the user to recognise, not enough to harvest. */
export function emailHint(email: string): string {
  const [local = '', domain = ''] = email.split('@')
  return `${local.slice(0, 1)}***@${domain}`
}
