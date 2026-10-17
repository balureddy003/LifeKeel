/**
 * TOTP (RFC 6238) helpers for MFA — SHA-1, 6 digits, 30s step, ±1 window.
 * Hand-rolled on node:crypto rather than pulling an otp library: the whole
 * algorithm is ~40 lines and keeping the secret-handling code local means
 * there's no dependency surface to audit.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Base32-encoded 160-bit secret — the standard size authenticator apps expect. */
export function generateTotpSecret(): string {
  const bytes = randomBytes(20)
  let out = ''
  for (const b of bytes) out += B32_ALPHABET[b & 31]
  return out
}

function base32Decode(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/[\s=]+/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const c of clean) {
    const idx = B32_ALPHABET.indexOf(c)
    if (idx < 0) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret)
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', key).update(buf).digest()
  const offset = hmac[hmac.length - 1]! & 0x0f
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    (hmac[offset + 1]! << 16) |
    (hmac[offset + 2]! << 8) |
    hmac[offset + 3]!
  return String(code % 1_000_000).padStart(6, '0')
}

/** Current TOTP code — exported for tests and enrollment verification. */
export function totp(secret: string, stepOffset = 0): string {
  return hotp(secret, Math.floor(Date.now() / 1000 / 30) + stepOffset)
}

/** Constant-time compare across the ±1-step window — tolerates device clock drift. */
export function verifyTotp(secret: string, code: string): boolean {
  const normalized = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(normalized)) return false
  const expected = Buffer.from(normalized)
  for (let i = -1; i <= 1; i++) {
    const candidate = Buffer.from(totp(secret, i))
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return true
  }
  return false
}

export function otpauthUrl(secret: string, email: string): string {
  const label = encodeURIComponent(`LifeKeel:${email}`)
  return `otpauth://totp/${label}?secret=${secret}&issuer=LifeKeel&algorithm=SHA1&digits=6&period=30`
}

/** One-time fallback codes shown exactly once at enrollment — only SHA-256
 *  hashes are stored, each consumed on first successful use. */
export function generateRecoveryCodes(count = 8): { codes: string[]; hashes: string[] } {
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    const raw = randomBytes(4).toString('hex').toUpperCase()
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`)
  }
  return { codes, hashes: codes.map(hashRecoveryCode) }
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256')
    .update(
      code
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, ''),
    )
    .digest('hex')
}
