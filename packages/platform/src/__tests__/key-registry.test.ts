import { describe, expect, it, beforeEach } from 'vitest'
import { EnvKeyRegistry } from '../key-registry.js'

describe('EnvKeyRegistry', () => {
  const envBackup = { ...process.env }

  beforeEach(() => {
    process.env = { ...envBackup }
    delete process.env['ENCRYPTION_KEY_CURRENT_VERSION']
    delete process.env['ENCRYPTION_KEY_V1']
    delete process.env['ENCRYPTION_KEY_V2']
    delete process.env['SETTINGS_ENCRYPTION_KEY']
  })

  it('returns undefined when no keys are configured', () => {
    const reg = new EnvKeyRegistry()
    expect(reg.getKey()).toBeUndefined()
    expect(reg.listVersions()).toEqual([])
  })

  it('reads SETTINGS_ENCRYPTION_KEY as fallback', () => {
    process.env['SETTINGS_ENCRYPTION_KEY'] = 'aa'.repeat(32)
    const reg = new EnvKeyRegistry()
    expect(reg.getKey()).toBe(process.env['SETTINGS_ENCRYPTION_KEY'])
    expect(reg.listVersions()).toEqual([1])
  })

  it('can set and rotate keys', () => {
    const reg = new EnvKeyRegistry()
    reg.setKey(2, 'bb'.repeat(32))
    expect(reg.getKey(2)).toBe('bb'.repeat(32))
    reg.rotateTo(2, 'bb'.repeat(32))
    expect(reg.currentVersion()).toBe(2)
    expect(process.env['ENCRYPTION_KEY_CURRENT_VERSION']).toBe('2')
  })
})
