import { describe, expect, it } from 'vitest'
import { sealFile, unsealFile, VaultSealError } from '../vault-seal'

describe('vault-seal (PRD-134)', () => {
  it('round-trips bytes through seal and unseal', async () => {
    const plaintext = new TextEncoder().encode('last will and testament').buffer as ArrayBuffer
    const sealed = await sealFile(plaintext, 'family-passphrase')
    const unsealed = await unsealFile(sealed, 'family-passphrase')
    expect(new TextDecoder().decode(unsealed)).toBe('last will and testament')
  })

  it('produces an opaque envelope — no plaintext leaks into the sealed bytes', async () => {
    const bytes = await sealFile(new TextEncoder().encode('secret estate instructions').buffer as ArrayBuffer, 'pw')
    expect(bytes.length).toBeGreaterThan(16 + 12 + 16) // salt + iv + tag
    expect(new TextDecoder().decode(bytes)).not.toContain('secret')
  })

  it('rejects the wrong passphrase via the GCM auth tag', async () => {
    const sealed = await sealFile(new TextEncoder().encode('x').buffer as ArrayBuffer, 'right')
    await expect(unsealFile(sealed, 'wrong')).rejects.toBeInstanceOf(VaultSealError)
  })

  it('rejects a damaged envelope honestly', async () => {
    await expect(unsealFile(new Uint8Array(10), 'pw')).rejects.toBeInstanceOf(VaultSealError)
  })

  it('uses a random salt — same data + passphrase seals differently each time', async () => {
    const data = new TextEncoder().encode('same').buffer as ArrayBuffer
    const a = await sealFile(data, 'pw')
    const b = await sealFile(data, 'pw')
    expect(a).not.toEqual(b)
  })
})
