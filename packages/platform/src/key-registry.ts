export interface KeyRegistry {
  currentVersion(): number
  getKey(version?: number): string | undefined
  listVersions(): number[]
  setKey(version: number, hexKey: string): void
  rotateTo(version: number, hexKey: string): void
}

/**
 * Simple environment-backed key registry used for development and as a
 * pluggable default implementation. Production deployments should replace
 * this with a secret-manager-backed implementation.
 */
export class EnvKeyRegistry implements KeyRegistry {
  currentVersion(): number {
    return Math.max(1, Number(process.env['ENCRYPTION_KEY_CURRENT_VERSION'] ?? 1))
  }

  getKey(version?: number): string | undefined {
    const v = version ?? this.currentVersion()
    return process.env[`ENCRYPTION_KEY_V${v}`] ?? process.env['SETTINGS_ENCRYPTION_KEY']
  }

  listVersions(): number[] {
    const keys = Object.keys(process.env)
      .filter(k => /^ENCRYPTION_KEY_V\d+$/.test(k))
      .map(k => Number(k.replace(/^ENCRYPTION_KEY_V/, '')))
      .sort((a, b) => a - b)
    if (process.env['SETTINGS_ENCRYPTION_KEY'] && keys.length === 0) return [1]
    return keys
  }

  setKey(version: number, hexKey: string): void {
    process.env[`ENCRYPTION_KEY_V${version}`] = hexKey
  }

  rotateTo(version: number, hexKey: string): void {
    this.setKey(version, hexKey)
    process.env['ENCRYPTION_KEY_CURRENT_VERSION'] = String(version)
  }
}

export const defaultKeyRegistry = new EnvKeyRegistry()
