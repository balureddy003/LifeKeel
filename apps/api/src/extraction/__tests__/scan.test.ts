/** PRD-143 item 1: the optional ClamAV scan records what really happened. */
import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { scanConfigured, scanUpload } from '../scan.js'

let server: net.Server | null = null
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()))
  server = null
})

/** A stand-in for clamd: speaks INSTREAM framing and answers with `verdict`. */
function fakeClamd(
  verdict: string,
  received: { payload: Buffer; command: string } = { payload: Buffer.alloc(0), command: '' },
) {
  return new Promise<number>((resolve) => {
    server = net.createServer((socket) => {
      let buf = Buffer.alloc(0)
      let ended = false
      socket.on('data', (d) => {
        buf = Buffer.concat([buf, d])
        if (!received.command && buf.length >= 10) {
          received.command = buf.subarray(0, 10).toString()
          buf = buf.subarray(10)
        }
        // Frames: 4-byte big-endian length then data; a zero length ends the stream.
        while (!ended && buf.length >= 4) {
          const len = buf.readUInt32BE(0)
          if (len === 0) {
            ended = true
            socket.end(`${verdict}\0`)
            return
          }
          if (buf.length < 4 + len) break
          received.payload = Buffer.concat([received.payload, buf.subarray(4, 4 + len)])
          buf = buf.subarray(4 + len)
        }
      })
    })
    server.listen(0, '127.0.0.1', () => resolve((server!.address() as net.AddressInfo).port))
  })
}

describe('scanUpload', () => {
  it('says not_performed, never clean, when no scanner is configured', async () => {
    expect(scanConfigured({})).toBe(false)
    expect(scanConfigured({ CLAMD_HOST: 'clam' })).toBe(true)
    const old = process.env['CLAMD_HOST']
    delete process.env['CLAMD_HOST']
    try {
      expect(await scanUpload(Buffer.from('x'))).toEqual({ result: 'not_performed' })
    } finally {
      if (old !== undefined) process.env['CLAMD_HOST'] = old
    }
  })

  it('streams the whole file in INSTREAM frames and reports clean', async () => {
    const received = { payload: Buffer.alloc(0), command: '' }
    const port = await fakeClamd('stream: OK', received)
    const big = Buffer.alloc(150_000, 7) // more than one 64 KiB chunk
    expect(await scanUpload(big, { host: '127.0.0.1', port })).toEqual({
      result: 'clean',
      engine: 'clamav',
    })
    expect(received.command).toBe('zINSTREAM\0')
    expect(received.payload.equals(big)).toBe(true)
  })

  it('reports an infection with the signature name', async () => {
    const port = await fakeClamd('stream: Eicar-Test-Signature FOUND')
    expect(await scanUpload(Buffer.from('x'), { host: '127.0.0.1', port })).toEqual({
      result: 'infected',
      engine: 'clamav',
      signature: 'Eicar-Test-Signature',
    })
  })

  it('reports error, not clean, when the scanner is unreachable', async () => {
    const probe = net.createServer()
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r))
    const closedPort = (probe.address() as net.AddressInfo).port
    await new Promise<void>((r) => probe.close(() => r()))
    expect(
      await scanUpload(Buffer.from('x'), { host: '127.0.0.1', port: closedPort }),
    ).toMatchObject({ result: 'error' })
  })

  it('reports error, not clean, when the scanner never answers', async () => {
    const sockets: net.Socket[] = []
    const hang = net.createServer((s) => void sockets.push(s))
    await new Promise<void>((r) => hang.listen(0, '127.0.0.1', r))
    const hangPort = (hang.address() as net.AddressInfo).port
    expect(
      await scanUpload(Buffer.from('x'), { host: '127.0.0.1', port: hangPort, timeoutMs: 150 }),
    ).toEqual({
      result: 'error',
      engine: 'clamav',
      reason: 'timeout',
    })
    sockets.forEach((s) => s.destroy())
    await new Promise<void>((r) => hang.close(() => r()))
  })

  it('reports error, not clean, when the scanner answers something unexpected', async () => {
    const port = await fakeClamd('INSTREAM size limit exceeded. ERROR')
    expect(await scanUpload(Buffer.from('x'), { host: '127.0.0.1', port })).toMatchObject({
      result: 'error',
    })
  })
})
