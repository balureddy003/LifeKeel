/**
 * PRD-208: writes public/.well-known/security.txt from NEXT_PUBLIC_SECURITY_CONTACT
 * (an email address or https URL for vulnerability reports). With no contact
 * configured it writes nothing and removes any old copy: an unreachable contact
 * is worse than no file, so the page and the file appear together or not at all.
 * Runs as `prebuild`.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildSecurityTxt } from './security-txt.mjs'

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/.well-known')
const file = path.join(dir, 'security.txt')
const body = buildSecurityTxt(process.env.NEXT_PUBLIC_SECURITY_CONTACT)
if (body) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, body)
  console.log('security.txt written')
} else {
  rmSync(file, { force: true })
  console.log('security.txt skipped: NEXT_PUBLIC_SECURITY_CONTACT is not set')
}
