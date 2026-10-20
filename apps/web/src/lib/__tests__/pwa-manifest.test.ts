/** PRD-147: the manifest, icons, screenshots and service worker meet the install criteria. */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const pub = path.resolve(__dirname, '../../../public')
const manifest = JSON.parse(readFileSync(path.join(pub, 'manifest.json'), 'utf8'))
const dims = (file: string) => {
  const d = readFileSync(path.join(pub, file))
  return { w: d.readUInt32BE(16), h: d.readUInt32BE(20), colorType: d[25] }
}

describe('manifest', () => {
  it('has a stable id and matches the app surface colour', () => {
    expect(manifest.id).toBe('/')
    expect(manifest.theme_color).toBe('#0a1822')
    expect(manifest.background_color).toBe('#0a1822')
  })
  it('never combines any and maskable in one entry, and has both', () => {
    const purposes = manifest.icons.map((i: { purpose: string }) => i.purpose)
    expect(purposes.every((p: string) => p === 'any' || p === 'maskable')).toBe(true)
    expect(purposes).toContain('maskable')
    expect(purposes).toContain('any')
  })
  it('lists icons that exist at their declared size, maskable ones opaque', () => {
    for (const icon of manifest.icons.filter((i: { type: string }) => i.type === 'image/png')) {
      const file = icon.src.replace(/^\//, '')
      expect(existsSync(path.join(pub, file))).toBe(true)
      const { w, h, colorType } = dims(file)
      expect(`${w}x${h}`).toBe(icon.sizes)
      if (icon.purpose === 'maskable') expect(colorType).toBe(2) // RGB, no alpha
    }
  })
  it('has narrow and wide screenshots of the declared size', () => {
    const forms = new Set(manifest.screenshots.map((s: { form_factor: string }) => s.form_factor))
    expect(forms).toEqual(new Set(['narrow', 'wide']))
    for (const s of manifest.screenshots) {
      const { w, h } = dims(s.src.replace(/^\//, ''))
      expect(`${w}x${h}`).toBe(s.sizes)
    }
  })
  it('keeps the iOS touch icon opaque', () => {
    expect(dims('apple-touch-icon.png').colorType).toBe(2)
  })
})

describe('service worker precache', () => {
  const sw = readFileSync(path.join(pub, 'sw.js'), 'utf8')
  it('lists only the public shell, not authenticated routes', () => {
    const list = /const APP_SHELL = \[([^\]]*)\]/.exec(sw)![1]!
    for (const authed of ['/vault', '/family', '/settings', '/documents', '/inbox'])
      expect(list).not.toContain(`'${authed}'`)
    expect(sw).toContain('lifekeel-v5')
  })
})
