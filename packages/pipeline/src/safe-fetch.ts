/**
 * SSRF-safe fetch wrapper for pipeline outbound HTTP calls (ADR-0065).
 *
 * Validates the target URL to prevent requests to private/internal addresses.
 * Mirrors packages/platform/src/safe-http-client.ts logic.
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export async function safeFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const url = input instanceof URL ? input : new URL(input)
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error(`Blocked URL protocol: ${url.protocol}`)
  if (url.username || url.password) throw new Error('URLs containing credentials are blocked')
  await assertPublicHost(url.hostname)
  return fetch(url, { ...init, redirect: 'manual' })
}

async function assertPublicHost(hostname: string): Promise<void> {
  const normalized = hostname.toLowerCase().replace(/\.$/, '')
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) {
    throw new Error(`Blocked private host: ${hostname}`)
  }
  const addresses = isIP(normalized)
    ? [{ address: normalized }]
    : await lookup(normalized, { all: true })
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error(`Blocked private address for host: ${hostname}`)
  }
}

function isPrivateAddress(address: string): boolean {
  const value = address.toLowerCase()
  if (value === '::1' || value === '0.0.0.0' || value === '::') return true
  if (value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:')) return true
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isFinite(part))) return false
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127)
}
