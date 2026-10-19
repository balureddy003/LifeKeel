#!/usr/bin/env node
// Landing-size gate (PRD-209 phase 4): fails when the JS a first-time visitor to "/"
// downloads exceeds the budget. Run after `build:export` and
// `externalize-inline-scripts.mjs`, so the inline hydration scripts are counted as the
// files they become.
//
//   node scripts/check-landing-size.mjs [out-dir] [budget-kb-gzipped]
//
// "First load JS" here is every <script src> in out/index.html plus any script
// preloads, each gzipped (level 9) and summed once. CSS and fonts are not counted.

import { gzipSync } from 'node:zlib'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

// Two layouts: the static export (`apps/web/out`, used at deploy) or the ordinary
// `next build` output (`--next apps/web/.next`, what CI already builds). The chunks
// are the same files in both, so CI does not need a second build.
const args = process.argv.slice(2)
const nextMode = args[0] === '--next'
if (nextMode) args.shift()
const dir = args[0] ?? (nextMode ? 'apps/web/.next' : 'apps/web/out')
// Budgets are ratchets set a little above the size when PRD-209 phase 4 landed (about 255 KB
// from `next build`, 260 KB from the export, which also counts the externalised inline
// scripts). Lower them when the app shell shrinks; raise them only on purpose, in a PR
// that says why.
const budgetKb = Number(args[1] ?? (nextMode ? 270 : 280))

export function scriptUrls(html) {
  const urls = new Set()
  for (const m of html.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"([^>]*)>/gi)) {
    // nomodule scripts (Next's legacy polyfills) are not downloaded by current browsers
    if (/\bnomodule\b|\bnoModule\b/.test(m[1] + m[3])) continue
    urls.add(m[2])
  }
  for (const m of html.matchAll(/<link\b[^>]*rel="preload"[^>]*as="script"[^>]*href="([^"]+)"/gi))
    urls.add(m[1])
  for (const m of html.matchAll(/<link\b[^>]*href="([^"]+)"[^>]*rel="preload"[^>]*as="script"/gi))
    urls.add(m[1])
  return [...urls].filter((u) => u.startsWith('/'))
}

export function measure(dir, nextMode = false) {
  const html = readFileSync(
    path.join(dir, nextMode ? 'server/app/index.html' : 'index.html'),
    'utf8',
  )
  const files = scriptUrls(html).map((u) => {
    const clean = u.split('?')[0]
    const f = nextMode ? path.join(dir, clean.replace(/^\/_next\//, '')) : path.join(dir, clean)
    if (!existsSync(f)) throw new Error(`index.html references ${u} but ${f} does not exist`)
    return { url: u, gz: gzipSync(readFileSync(f), { level: 9 }).length }
  })
  return { files, total: files.reduce((n, f) => n + f.gz, 0) }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  const { files, total } = measure(dir, nextMode)
  files.sort((a, b) => b.gz - a.gz)
  for (const f of files.slice(0, 8))
    console.log(`${(f.gz / 1024).toFixed(1).padStart(7)} KB  ${f.url}`)
  console.log(
    `${files.length} scripts, ${(total / 1024).toFixed(1)} KB gzipped (budget ${budgetKb} KB)`,
  )
  if (total > budgetKb * 1024) {
    console.error(
      `FAIL: landing first-load JS is over budget by ${((total - budgetKb * 1024) / 1024).toFixed(1)} KB`,
    )
    process.exit(1)
  }
}
