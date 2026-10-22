/**
 * Upload malware scan (PRD-143 item 1), optional and env-gated.
 *
 * With CLAMD_HOST set, the file is streamed to a ClamAV daemon (clamd INSTREAM).
 * With it unset, no scan runs and the result says so: `not_performed`. This
 * module never reports `clean` for a file nothing looked at, and the document
 * record keeps the result so the claim is checkable. Running ClamAV is the
 * owner's infrastructure decision.
 *
 *   clean         scanner looked, found nothing
 *   infected      scanner found a signature: the upload is refused
 *   error         a scanner is configured but did not answer: the file is kept
 *                 but not extracted (the pipeline treats it as unscanned)
 *   not_performed no scanner configured
 */
import net from 'node:net'

export type ScanResult =
  | { result: 'clean'; engine: 'clamav' }
  | { result: 'infected'; engine: 'clamav'; signature: string }
  | { result: 'error'; engine: 'clamav'; reason: string }
  | { result: 'not_performed' }

const CHUNK = 64 * 1024

export function scanConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env['CLAMD_HOST'])
}

/**
 * Whether a file must be scanned before any parser (OCR, PDF extraction)
 * touches it (R25). MALWARE_SCAN_REQUIRED=true|false; outside local dev/test
 * the default is true, so with no scanner configured files are stored but
 * not parsed. Sealed vault files are ciphertext and can't be scanned here.
 */
export function scanRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env['MALWARE_SCAN_REQUIRED']
  if (raw === 'true') return true
  if (raw === 'false') return false
  const nodeEnv = env['NODE_ENV']
  return !(!nodeEnv || nodeEnv === 'development' || nodeEnv === 'test')
}

/** May a parser run on a file with this scan result? */
export function mayParse(scan: ScanResult, env: NodeJS.ProcessEnv = process.env): boolean {
  if (scan.result === 'clean') return true
  if (scan.result === 'not_performed') return !scanRequired(env)
  return false
}

export function scanUpload(
  data: Buffer,
  opts: { host?: string; port?: number; timeoutMs?: number } = {},
): Promise<ScanResult> {
  const host = opts.host ?? process.env['CLAMD_HOST']
  if (!host) return Promise.resolve({ result: 'not_performed' })
  const port = opts.port ?? Number(process.env['CLAMD_PORT'] ?? 3310)
  const timeoutMs = opts.timeoutMs ?? 15_000

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    let reply = ''
    let settled = false
    const done = (r: ScanResult) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(r)
    }
    socket.setTimeout(timeoutMs, () =>
      done({ result: 'error', engine: 'clamav', reason: 'timeout' }),
    )
    socket.on('error', (e) =>
      done({ result: 'error', engine: 'clamav', reason: e.message.slice(0, 80) }),
    )
    socket.on('data', (d) => {
      reply += d.toString()
    })
    socket.on('end', () => {
      const r = reply.replace(/\0/g, '').trim()
      if (/ OK$/.test(r)) return done({ result: 'clean', engine: 'clamav' })
      const found = /: (.+) FOUND$/.exec(r)
      if (found)
        return done({ result: 'infected', engine: 'clamav', signature: found[1]!.slice(0, 80) })
      done({ result: 'error', engine: 'clamav', reason: `unexpected reply: ${r.slice(0, 60)}` })
    })
    socket.on('connect', () => {
      socket.write('zINSTREAM\0')
      for (let i = 0; i < data.length; i += CHUNK) {
        const part = data.subarray(i, i + CHUNK)
        const len = Buffer.alloc(4)
        len.writeUInt32BE(part.length)
        socket.write(len)
        socket.write(part)
      }
      socket.write(Buffer.alloc(4)) // zero-length chunk ends the stream
    })
  })
}
