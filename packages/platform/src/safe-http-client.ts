import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export class SafeHttpClient {
  async fetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
    const url = input instanceof URL ? input : new URL(input)
    if (!['https:', 'http:'].includes(url.protocol))
      throw new Error(`Blocked URL protocol: ${url.protocol}`)
    if (url.username || url.password) throw new Error('URLs containing credentials are blocked')
    await assertPublicHost(url.hostname)
    return fetch(url, { ...init, redirect: 'error' })
  }
}

/**
 * Resolves `hostname` and returns one address only if every resolved
 * address is public. Callers that open raw sockets (IMAP) connect to the
 * returned address, so a second DNS answer can't rebind them to an internal
 * host between this check and the connection.
 */
export async function resolvePublicAddress(hostname: string): Promise<string> {
  const normalized = hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^\[|\]$/g, '')
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal')
  ) {
    throw new Error(`Blocked private host: ${hostname}`)
  }
  const addresses = isIP(normalized)
    ? [{ address: normalized }]
    : await lookup(normalized, { all: true })
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error(`Blocked private address for host: ${hostname}`)
  }
  return addresses[0]!.address
}

async function assertPublicHost(hostname: string): Promise<void> {
  await resolvePublicAddress(hostname)
}

/** Loopback, private, link-local, CGNAT, benchmark, multicast and reserved ranges, IPv4 and IPv6. */
export function isPrivateAddress(address: string): boolean {
  let value = address.toLowerCase()
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value)
  if (mapped) value = mapped[1]!
  if (value.includes(':')) {
    return (
      value === '::1' ||
      value === '::' ||
      value.startsWith('fc') ||
      value.startsWith('fd') ||
      value.startsWith('fe8') ||
      value.startsWith('fe9') ||
      value.startsWith('fea') ||
      value.startsWith('feb') ||
      value.startsWith('ff') ||
      value.startsWith('64:ff9b:') ||
      value.startsWith('2001:db8')
    )
  }
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return true
  const [a, b] = parts as [number, number, number, number]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}
