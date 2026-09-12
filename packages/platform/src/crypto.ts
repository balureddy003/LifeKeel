/**
 * AES-256-GCM field-level encryption for sensitive values (API keys, tokens).
 *
 * Key: 32-byte hex string from SETTINGS_ENCRYPTION_KEY env var.
 * Format: iv:authTag:ciphertext (all hex-encoded, colon-separated).
 *
 * Usage:
 *   const enc = encryptField('sk-ant-api03-...')   // → "a1b2c3:d4e5f6:..."
 *   const dec = decryptField(enc)                   // → "sk-ant-api03-..."
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { defaultKeyRegistry } from './key-registry.js'

const ALGORITHM = 'aes-256-gcm'
const KEY_HEX_LENGTH = 64  // 32 bytes = 64 hex chars

function getCurrentVersion(): number {
  return defaultKeyRegistry.currentVersion()
}

function getKey(version = getCurrentVersion()): Buffer {
  const raw = defaultKeyRegistry.getKey(version) ?? ''
  if (raw.length !== KEY_HEX_LENGTH) {
    // In dev/test, use a deterministic fallback key (NOT for production)
    if (process.env['NODE_ENV'] !== 'production') {
      return Buffer.from('0'.repeat(KEY_HEX_LENGTH), 'hex')
    }
    throw new Error(
      `[crypto] ENCRYPTION_KEY_V${version} must be a 64-char hex string (32 bytes). ` +
      'Generate with: openssl rand -hex 32'
    )
  }
  return Buffer.from(raw, 'hex')
}

/** Encrypt a plaintext string. Returns iv:authTag:ciphertext (hex). */
export function encryptField(plaintext: string): string {
  const version = getCurrentVersion()
  const key = getKey(version)
  const iv = randomBytes(12)   // 96-bit IV for GCM
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return `v${version}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

/** Decrypt a value produced by encryptField. Returns plaintext string. */
export function decryptField(ciphertext: string): string {
  const parts = ciphertext.split(':')
  const versioned = parts.length === 4 && /^v\d+$/.test(parts[0] ?? '')
  if (!versioned && parts.length !== 3) throw new Error('[crypto] Invalid encrypted field format')
  const version = versioned ? Number(parts.shift()!.slice(1)) : getCurrentVersion()
  const [ivHex, authTagHex, dataHex] = parts as [string, string, string]
  const key = getKey(version)
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const data = Buffer.from(dataHex, 'hex')

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

/**
 * Returns true if the value looks like a value produced by encryptField:
 * three colon-separated parts that are all valid hex strings.
 * Lengths: iv=24 hex chars (12 bytes), authTag=32 hex chars (16 bytes), ciphertext≥2 hex chars.
 */
function looksEncrypted(value: string): boolean {
  const parts = value.split(':')
  if (parts.length === 4 && /^v\d+$/.test(parts[0] ?? '')) parts.shift()
  if (parts.length !== 3) return false
  const [iv, tag, ct] = parts as [string, string, string]
  // Each part must be non-empty hex; iv=24, authTag=32, ciphertext≥2
  return iv.length === 24 && tag.length === 32 && ct.length >= 2 &&
    /^[0-9a-f]+$/i.test(iv) && /^[0-9a-f]+$/i.test(tag) && /^[0-9a-f]+$/i.test(ct)
}

/** Encrypt only if plaintext is non-empty and not already encrypted. */
export function encryptIfNeeded(value: string | undefined): string | undefined {
  if (!value) return value
  if (looksEncrypted(value)) return value  // already encrypted — skip double-encryption
  return encryptField(value)
}

/** Decrypt only if value looks like an encrypted field (iv:authTag:ciphertext). */
export function decryptIfNeeded(value: string | undefined): string | undefined {
  if (!value) return value
  if (!looksEncrypted(value)) return value  // plaintext passthrough for dev / unencrypted values
  try {
    return decryptField(value)
  } catch {
    return value  // graceful fallback — return as-is if decryption fails
  }
}
