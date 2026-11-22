/**
 * `accent` is not a Tailwind colour here: the token is `family-accent` (or `family-500` for fills, `family-400`
 * for text). `bg-accent` and `text-accent` compile to nothing, which left white-on-white buttons (the confirm
 * button on Home, "Save to the family list") and unstyled links. This fails if one comes back.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '..', '..')

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(p)
    return /\.(ts|tsx)$/.test(e.name) ? [p] : []
  })
}

describe('colour classes', () => {
  it('no file uses bg-accent, text-accent or border-accent, which do not exist', () => {
    const bad = walk(SRC).flatMap((f) =>
      fs
        .readFileSync(f, 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          /(?<![\w-])(bg|text|border|ring)-accent(?![\w-])/.test(line)
            ? [`${path.relative(SRC, f)}:${i + 1}`]
            : [],
        ),
    )
    expect(bad).toEqual([])
  })

  it('no text uses family-500, which is a pale fill colour and reads as disabled on light screens', () => {
    const bad = walk(SRC).flatMap((f) =>
      fs
        .readFileSync(f, 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          /(?<![\w-])text-family-500(?![\w-])/.test(line)
            ? [`${path.relative(SRC, f)}:${i + 1}`]
            : [],
        ),
    )
    expect(bad).toEqual([])
  })
})
