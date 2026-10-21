/**
 * Magic-byte check for uploaded files (UAT D3).
 *
 * The multipart Content-Type is whatever the client declares — an
 * executable renamed to ".pdf" arrives claiming application/pdf and the
 * allowlist alone admits it. Match the declared type against the file's
 * actual signature before the bytes are stored or sent for extraction.
 *
 * Sealed vault uploads can't be checked this way — the blob is client-
 * encrypted by design (vault.ts applies this only on the unsealed path).
 */

const latin = (buf: Buffer, start: number, end: number) =>
  buf.subarray(start, end).toString('latin1')

// ISO-BMFF brands that are legitimately HEIC/HEIF images. Plain 'mif1'/
// 'msf1' (generic HEIF) are admitted too — strictness beyond this costs
// real-world compatibility more than it buys.
const HEIF_BRANDS = /^(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1)/

export function signatureMatchesMime(buffer: Buffer, mime: string): boolean {
  if (buffer.length < 12) return false
  switch (mime) {
    case 'application/pdf':
      return latin(buffer, 0, 5) === '%PDF-'
    case 'image/jpeg':
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    case 'image/png':
      return (
        buffer[0] === 0x89 &&
        latin(buffer, 1, 4) === 'PNG' &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
      )
    case 'image/webp':
      return latin(buffer, 0, 4) === 'RIFF' && latin(buffer, 8, 12) === 'WEBP'
    case 'image/gif':
      return latin(buffer, 0, 4) === 'GIF8'
    case 'image/heic':
    case 'image/heif':
      return latin(buffer, 4, 8) === 'ftyp' && HEIF_BRANDS.test(latin(buffer, 8, 12))
    default:
      return false
  }
}
