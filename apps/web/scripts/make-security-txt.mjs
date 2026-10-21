/**
 * PRD-208: writes public/.well-known/security.txt from NEXT_PUBLIC_SECURITY_CONTACT
 * (an email address or https URL for vulnerability reports). With no contact
 * configured it writes nothing and removes any old copy: an unreachable contact
 * is worse than no file, so the page and the file appear together or not at all.
 * Runs as `prebuild`.
 *
 * Also writes the legacy /security.txt location (pre-RFC-9116 convention —
 * scanners still probe it; UAT P6 checked both paths).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildSecurityTxt } from './security-txt.mjs'

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public')
const files = [
  path.join(publicDir, '.well-known', 'security.txt'),
  path.join(publicDir, 'security.txt'),
]
const body = buildSecurityTxt(process.env.NEXT_PUBLIC_SECURITY_CONTACT)
if (body) {
  for (const file of files) {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, body)
  }
  console.log('security.txt written')
} else {
  for (const file of files) rmSync(file, { force: true })
  console.log('security.txt skipped: NEXT_PUBLIC_SECURITY_CONTACT is not set')
}
