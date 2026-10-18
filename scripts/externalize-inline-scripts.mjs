#!/usr/bin/env node
// Post-build step for the Firebase static export.
//
// The CSP in apps/web/firebase.json is `script-src 'self'`, which blocks the
// inline <script> bodies Next.js emits (self.__next_f.push hydration pushes,
// the theme init). Instead of weakening the CSP or emitting hundreds of
// sha256- hashes into the header, this script moves each inline JS body into
// a content-addressed file under out/_next/static/inline/ and rewrites the
// tag to <script src="...">. 'self' covers it, and the existing immutable
// cache rule for /_next/static/** applies.
//
// Non-JS script types (application/ld+json) are left inline — CSP only
// governs executable scripts.
//
// Run: node scripts/externalize-inline-scripts.mjs [out-dir]

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const outDir = process.argv[2] ?? 'apps/web/out'
const inlineDir = path.join(outDir, '_next', 'static', 'inline')
const INLINE_RE = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi

const htmlFiles = []
async function walk(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) await walk(p)
    else if (e.name.endsWith('.html')) htmlFiles.push(p)
  }
}

await walk(outDir)
await fs.mkdir(inlineDir, { recursive: true })

let moved = 0
let pages = 0
for (const file of htmlFiles) {
  const html = await fs.readFile(file, 'utf8')
  const jobs = []
  const rewritten = html.replace(INLINE_RE, (tag, attrs = '', body) => {
    if (/\bsrc\s*=/i.test(attrs)) return tag // already external
    if (/\btype\s*=/i.test(attrs)) return tag // ld+json etc — not JS
    if (!body.trim()) return tag // empty tag
    const hash = createHash('sha256').update(body).digest('hex').slice(0, 32)
    const name = `${hash}.js`
    jobs.push(fs.writeFile(path.join(inlineDir, name), body))
    moved++
    return `<script src="/_next/static/inline/${name}"></script>`
  })
  if (jobs.length) {
    await Promise.all(jobs)
    await fs.writeFile(file, rewritten)
    pages++
  }
}

console.log(
  `externalize-inline-scripts: moved ${moved} inline scripts across ${pages} pages -> ${inlineDir}`,
)
