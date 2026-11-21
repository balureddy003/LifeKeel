import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// The tab opens the screen titled "What If?", so both navs must use the same name.
describe('events tab name matches its screen title', () => {
  for (const f of ['AppNav.tsx', 'NavRail.tsx']) {
    it(`${f} labels /events "What If"`, () => {
      const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
      expect(src).toMatch(/href: '\/events', label: 'What If'/)
      expect(src).not.toMatch(/label: 'Events'/)
    })
  }
})
