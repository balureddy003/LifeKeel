/**
 * AES-256-GCM field encryption tests.
 *
 * Tests: round-trip, determinism of decryption, wrong key detection,
 *        encryptIfNeeded idempotency, decryptIfNeeded graceful fallback.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── Set a test key before importing the module ─────────────────────────────────

const TEST_KEY = 'a'.repeat(64)  // 32 bytes of 0xAA — valid 64-char hex

beforeEach(() => {
  vi.resetModules()
  process.env['SETTINGS_ENCRYPTION_KEY'] = TEST_KEY
  process.env['NODE_ENV'] = 'test'
})

afterEach(() => {
  delete process.env['SETTINGS_ENCRYPTION_KEY']
})

// Import after env is set
async function getCrypto() {
  return import('../crypto.js')
}

describe('encryptField / decryptField', () => {
  it('round-trips a plaintext API key', async () => {
    const { encryptField, decryptField } = await getCrypto()
    const original = 'sk-ant-api03-supersecret'
    const encrypted = encryptField(original)
    expect(encrypted).not.toBe(original)
    expect(encrypted).toContain(':')
    expect(decryptField(encrypted)).toBe(original)
  })

  it('produces different ciphertext each call (random IV)', async () => {
    const { encryptField } = await getCrypto()
    const a = encryptField('same-plaintext')
    const b = encryptField('same-plaintext')
    expect(a).not.toBe(b)
  })

  it('ciphertext has version:iv:authTag:data format', async () => {
    const { encryptField } = await getCrypto()
    const parts = encryptField('test-key').split(':')
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('v1')
    // iv = 12 bytes = 24 hex chars
    expect(parts[1]).toHaveLength(24)
    // authTag = 16 bytes = 32 hex chars
    expect(parts[2]).toHaveLength(32)
  })

  it('decryption fails with tampered ciphertext', async () => {
    const { encryptField, decryptField } = await getCrypto()
    const encrypted = encryptField('secret')
    const tampered = encrypted.replace(/.$/, encrypted.endsWith('a') ? 'b' : 'a')
    expect(() => decryptField(tampered)).toThrow()
  })

  it('throws on invalid format (missing colons)', async () => {
    const { decryptField } = await getCrypto()
    expect(() => decryptField('notencrypted')).toThrow('Invalid encrypted field format')
  })
})

describe('encryptIfNeeded', () => {
  it('encrypts a plaintext value', async () => {
    const { encryptIfNeeded, decryptField } = await getCrypto()
    const result = encryptIfNeeded('sk-plain-key')
    expect(result).toBeDefined()
    expect(result!.split(':').length).toBe(4)
    expect(decryptField(result!)).toBe('sk-plain-key')
  })

  it('does not double-encrypt an already-encrypted value', async () => {
    const { encryptIfNeeded, encryptField } = await getCrypto()
    const encrypted = encryptField('already-encrypted')
    const result = encryptIfNeeded(encrypted)
    // Already has 3 parts with colons — should pass through
    expect(result).toBe(encrypted)
  })

  it('returns undefined/empty for empty input', async () => {
    const { encryptIfNeeded } = await getCrypto()
    expect(encryptIfNeeded(undefined)).toBeUndefined()
    // empty string passes through as-is (not encrypted)
    expect(encryptIfNeeded('')).toBe('')
  })
})

describe('decryptIfNeeded', () => {
  it('decrypts a properly encrypted value', async () => {
    const { encryptField, decryptIfNeeded } = await getCrypto()
    const enc = encryptField('my-secret-token')
    expect(decryptIfNeeded(enc)).toBe('my-secret-token')
  })

  it('passes through plaintext (no colons) without error', async () => {
    const { decryptIfNeeded } = await getCrypto()
    expect(decryptIfNeeded('plaintext-passthrough')).toBe('plaintext-passthrough')
  })

  it('returns undefined for undefined input', async () => {
    const { decryptIfNeeded } = await getCrypto()
    expect(decryptIfNeeded(undefined)).toBeUndefined()
  })
})

describe('encryptBuffer / decryptBuffer', () => {
  it('round-trips binary file bytes (not just UTF-8 text)', async () => {
    const { encryptBuffer, decryptBuffer } = await getCrypto()
    // A byte sequence that is not valid UTF-8 on its own, to catch any
    // accidental string round-trip in the implementation.
    const original = Buffer.from([0x00, 0xff, 0x10, 0x80, 0xfe, 0x01, 0x02, 0x03])
    const encrypted = encryptBuffer(original)
    expect(Buffer.compare(encrypted, original)).not.toBe(0)
    expect(Buffer.compare(decryptBuffer(encrypted), original)).toBe(0)
  })

  it('produces different ciphertext each call (random IV)', async () => {
    const { encryptBuffer } = await getCrypto()
    const plain = Buffer.from('same file contents')
    const a = encryptBuffer(plain)
    const b = encryptBuffer(plain)
    expect(Buffer.compare(a, b)).not.toBe(0)
  })

  it('prefixes the envelope with a 1-byte key version', async () => {
    const { encryptBuffer } = await getCrypto()
    const encrypted = encryptBuffer(Buffer.from('x'))
    expect(encrypted.readUInt8(0)).toBe(1) // default ENCRYPTION_KEY_CURRENT_VERSION
  })

  it('throws rather than silently corrupting on tampered ciphertext', async () => {
    const { encryptBuffer, decryptBuffer } = await getCrypto()
    const encrypted = encryptBuffer(Buffer.from('a will document'))
    encrypted[encrypted.length - 1] = encrypted[encrypted.length - 1]! ^ 0xff
    expect(() => decryptBuffer(encrypted)).toThrow()
  })

  it('throws on a too-short/invalid envelope rather than reading garbage', async () => {
    const { decryptBuffer } = await getCrypto()
    expect(() => decryptBuffer(Buffer.from([1, 2, 3]))).toThrow('Invalid encrypted buffer envelope')
  })

  it('round-trips a multi-kilobyte buffer (larger than a single cipher block)', async () => {
    const { encryptBuffer, decryptBuffer } = await getCrypto()
    const original = Buffer.alloc(64 * 1024, 7) // 64KB, stands in for a real document
    const decrypted = decryptBuffer(encryptBuffer(original))
    expect(Buffer.compare(decrypted, original)).toBe(0)
  })
})

describe('versioned encryption key registry', () => {
  it('encrypts with the current registry version and decrypts versioned ciphertext', async () => {
    process.env['ENCRYPTION_KEY_V1'] = 'b'.repeat(64)
    process.env['ENCRYPTION_KEY_V2'] = 'c'.repeat(64)
    process.env['ENCRYPTION_KEY_CURRENT_VERSION'] = '2'
    const { encryptField, decryptField } = await getCrypto()

    const encryptedV2 = encryptField('versioned-secret')
    expect(encryptedV2.startsWith('v2:')).toBe(true)
    expect(decryptField(encryptedV2)).toBe('versioned-secret')

    const encryptedV1 = `v1:${encryptedV2.split(':').slice(1).join(':')}`
    expect(() => decryptField(encryptedV1)).toThrow()
  })
})
