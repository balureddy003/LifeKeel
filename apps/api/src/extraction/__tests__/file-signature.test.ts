import { describe, expect, it } from 'vitest'
import { signatureMatchesMime } from '../file-signature.js'

const pdf = Buffer.from('%PDF-1.7 fake body for length')
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.alloc(16)])
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.alloc(8)])
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WEBP'),
  Buffer.alloc(8),
])
const gif = Buffer.from('GIF89a' + 'x'.repeat(16))
const heic = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(8)])
const exe = Buffer.from('MZ' + 'x'.repeat(30))
const zipBasedExe = Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Buffer.alloc(16)])

describe('signatureMatchesMime', () => {
  it('accepts real signatures for every allowed type', () => {
    expect(signatureMatchesMime(pdf, 'application/pdf')).toBe(true)
    expect(signatureMatchesMime(jpeg, 'image/jpeg')).toBe(true)
    expect(signatureMatchesMime(png, 'image/png')).toBe(true)
    expect(signatureMatchesMime(webp, 'image/webp')).toBe(true)
    expect(signatureMatchesMime(gif, 'image/gif')).toBe(true)
    expect(signatureMatchesMime(heic, 'image/heic')).toBe(true)
    expect(signatureMatchesMime(heic, 'image/heif')).toBe(true)
  })

  it('rejects an executable declared as a PDF (UAT D3)', () => {
    expect(signatureMatchesMime(exe, 'application/pdf')).toBe(false)
    expect(signatureMatchesMime(zipBasedExe, 'application/pdf')).toBe(false)
    expect(signatureMatchesMime(exe, 'image/png')).toBe(false)
  })

  it('rejects a real file declared as a different allowed type', () => {
    expect(signatureMatchesMime(pdf, 'image/png')).toBe(false)
    expect(signatureMatchesMime(png, 'application/pdf')).toBe(false)
  })

  it('rejects truncated buffers and unknown types', () => {
    expect(signatureMatchesMime(Buffer.from('%PDF-'), 'application/pdf')).toBe(false)
    expect(signatureMatchesMime(pdf, 'application/x-msdownload')).toBe(false)
  })
})
