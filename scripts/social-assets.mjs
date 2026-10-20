#!/usr/bin/env node
// Renders the social profile images (avatar, banners, launch cards) from the brand tokens.
//
//   cd apps/web && node ../../scripts/social-assets.mjs
//
// Needs network for Google Fonts (Instrument Serif, Hanken Grotesk) and the Playwright browser
// already installed for apps/web/e2e. Output: docs/marketing/social-assets/*.png
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolve Playwright from the directory the script is run in (apps/web), not from scripts/.
const { chromium } = createRequire(path.join(process.cwd(), 'noop.js'))('@playwright/test')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'docs', 'marketing', 'social-assets')
mkdirSync(out, { recursive: true })
const icon = readFileSync(path.join(root, 'apps/web/public/icon.svg'), 'utf8')
  .replace(/<svg /, '<svg style="width:100%;height:100%" ')

const FONTS =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Hanken+Grotesk:wght@400;600;700&family=Fraunces:wght@600&display=swap">'
const CSS = `
*{box-sizing:border-box;margin:0}
body{background:#0a1822;color:#e8eef2;font-family:'Hanken Grotesk',system-ui,sans-serif;overflow:hidden}
.sea{position:absolute;inset:0;background:
  radial-gradient(120% 90% at 15% 0%,#1d4a5c 0%,rgba(29,74,92,0) 60%),
  linear-gradient(180deg,#0d2a3a 0%,#0a1822 100%)}
.waves{position:absolute;left:0;right:0;bottom:0;height:34%;
  background:linear-gradient(180deg,rgba(31,95,119,.0),rgba(31,95,119,.45) 40%,rgba(15,54,71,.9))}
.row{position:relative;display:flex;align-items:center;height:100%}
.mark{flex:none;border-radius:22%;overflow:hidden}
.word{font-family:'Fraunces',Georgia,serif;font-weight:600;letter-spacing:-.01em}
h1{font-family:'Instrument Serif',Georgia,serif;font-weight:400;letter-spacing:-.01em;line-height:1.05}
h1 em{color:#e2b45c;font-style:italic}
.sub{color:#93a9b6}
.pill{display:inline-block;background:#e2b45c;color:#1a1203;font-weight:700;border-radius:999px}
`

const page = (w, h, body) =>
  `<!doctype html><meta charset=utf-8>${FONTS}<style>${CSS}html,body{width:${w}px;height:${h}px}</style><body>${body}</body>`

// The profile picture overlaps the lower left of every banner, so the text starts a quarter of the way in and the mark is left to the avatar.
const banner = (w, h) => {
  const s = h / 396 // scale relative to the LinkedIn proportions
  return page(
    w,
    h,
    `<div class=sea></div><div class=waves></div>
     <div class=row style="padding:0 ${Math.round(w * 0.06)}px 0 ${Math.round(w * 0.27)}px">
       <div>
         <div class=word style="font-size:${Math.round(40 * s)}px;margin-bottom:${Math.round(8 * s)}px">LifeKeel</div>
         <h1 style="font-size:${Math.round(62 * s)}px">Your family&rsquo;s chart, <em>kept current.</em></h1>
         <div class=sub style="font-size:${Math.round(22 * s)}px;margin-top:${Math.round(12 * s)}px">Savings, cover and papers in one place. Free to start.</div>
       </div>
     </div>`,
  )
}

const card = (headline, sub) =>
  page(
    1080,
    1080,
    `<div class=sea></div><div class=waves></div>
     <div style="position:relative;height:100%;padding:90px;display:flex;flex-direction:column;justify-content:space-between">
       <div style="display:flex;align-items:center;gap:22px">
         <div class=mark style="width:84px;height:84px">${icon}</div>
         <div class=word style="font-size:44px">LifeKeel</div>
       </div>
       <div>
         <h1 style="font-size:104px">${headline}</h1>
         <div class=sub style="font-size:36px;margin-top:28px;max-width:820px;line-height:1.35">${sub}</div>
       </div>
       <div style="font-size:26px" class=sub>lifekeel.co.uk &middot; Informational only, not financial advice.</div>
     </div>`,
  )

const JOBS = [
  ['avatar-1024.png', 1024, 1024, page(1024, 1024, `<div style="width:100%;height:100%;background:#0a1822;display:flex;align-items:center;justify-content:center"><div style="width:86%;height:86%;border-radius:22%;overflow:hidden">${icon}</div></div>`)],
  ['banner-linkedin-1584x396.png', 1584, 396, banner(1584, 396)],
  ['banner-x-bluesky-1500x500.png', 1500, 500, banner(1500, 500)],
  ['banner-facebook-1640x624.png', 1640, 624, banner(1640, 624)],
  ['card-1-chart-1080.png', 1080, 1080, card('Your family&rsquo;s chart, <em>kept current.</em>', 'What you hold on file, what is missing, and the steps if something happens.')],
  ['card-2-bad-day-1080.png', 1080, 1080, card('A hard day is easier with <em>the papers found.</em>', 'Steps for seven kinds of bad day, from what you already entered.')],
  ['card-3-cover-1080.png', 1080, 1080, card('Is your cover <em>on file?</em>', 'See life, income and health cover against a rough household estimate. Informational only.')],
]

const browser = await chromium.launch()
for (const [name, w, h, html] of JOBS) {
  const p = await browser.newPage({ viewport: { width: w, height: h } })
  await p.setContent(html, { waitUntil: 'networkidle' })
  await p.evaluate(() => document.fonts.ready)
  await p.screenshot({ path: path.join(out, name) })
  await p.close()
  console.log('wrote', name)
}
await browser.close()
