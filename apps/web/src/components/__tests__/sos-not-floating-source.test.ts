import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Owner decision 2026-11-21: SOS is rare and not a real emergency line, so it no
// longer floats over every screen. It stays one tap away on the Family page.
describe('SOS is not a floating button', () => {
  it('AppShell renders no floating SOS or pulsing ring', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'AppShell.tsx'), 'utf8')
    expect(src).not.toMatch(/app-sos-fab|EmergencyButton/)
  })
  it('Family page offers Emergency mode as a list row', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'app', 'family', 'page.tsx'),
      'utf8',
    )
    expect(src).toMatch(/label="Emergency mode"/)
  })
})
