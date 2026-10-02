/**
 * Client-side document sealing (PRD-134) — an opt-in extra layer on the
 * Digital Estate Vault. A sealed document is AES-256-GCM encrypted in the
 * browser under a key derived (PBKDF2, 310k iterations) from a passphrase
 * that never leaves the device, then *also* wrapped in the server-side
 * layer on upload — so the stored blob is double-encrypted and the
 * operator cannot read it without the passphrase.
 *
 * Envelope: [16-byte salt][12-byte iv][ciphertext + 16-byte GCM tag].
 *
 * Honest limits (also stated in the UI): the passphrase can't be recovered
 * — a forgotten passphrase means the document is unreadable forever.
 * Document metadata (name, type, size, upload date) stays server-visible:
 * the estate detector needs doc_type, and the list needs a filename.
 * This deliberately is NOT per-user zero-knowledge — the vault's job is
 * family access in a crisis, where the person holding a private key may
 * be exactly the person unavailable. The shared-passphrase model matches
 * how families actually handle these documents.
 */

const SALT_BYTES = 16
const IV_BYTES = 12
const PBKDF2_ITERATIONS = 310_000

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function sealFile(data: ArrayBuffer, passphrase: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(passphrase, salt)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, data)
  const envelope = new Uint8Array(SALT_BYTES + IV_BYTES + ciphertext.byteLength)
  envelope.set(salt, 0)
  envelope.set(iv, SALT_BYTES)
  envelope.set(new Uint8Array(ciphertext), SALT_BYTES + IV_BYTES)
  return envelope
}

/** Throws `VaultSealError` on a wrong passphrase or tampered envelope. */
export class VaultSealError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VaultSealError'
  }
}

export async function unsealFile(envelope: ArrayBuffer | Uint8Array, passphrase: string): Promise<ArrayBuffer> {
  const bytes = envelope instanceof Uint8Array ? envelope : new Uint8Array(envelope)
  if (bytes.length <= SALT_BYTES + IV_BYTES + 16) {
    throw new VaultSealError('That sealed file is damaged — it’s too short to be valid')
  }
  const salt = bytes.slice(0, SALT_BYTES)
  const iv = bytes.slice(SALT_BYTES, SALT_BYTES + IV_BYTES)
  const ciphertext = bytes.slice(SALT_BYTES + IV_BYTES)
  const key = await deriveKey(passphrase, salt)
  try {
    return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ciphertext as BufferSource)
  } catch {
    // GCM auth-tag failure is how a wrong passphrase surfaces — the only
    // signal WebCrypto gives, and an honest one.
    throw new VaultSealError('That passphrase doesn’t open this document')
  }
}
