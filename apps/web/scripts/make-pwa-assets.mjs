/**
 * Regenerates the PWA image assets (PRD-147) from the SVG sources, so they are
 * reproducible rather than hand-exported:
 *
 *   node scripts/make-pwa-assets.mjs            icons only
 *   node scripts/make-pwa-assets.mjs --screens  also install screenshots (needs the app on BASE_URL)
 *
 *   icon-maskable-192.png, icon-maskable-512.png   full-bleed, mark inside the safe zone
 *   apple-touch-icon.png                           opaque 180px: iOS paints transparent corners black
 *   screenshots/*.png                              install-dialog screenshots (narrow and wide)
 *
 * The "any" icons (icon-192.png, icon-512.png, icon.svg) keep their rounded
 * shape and are not touched here.
 */
import { readFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from '@playwright/test'

const pub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public')
const svg = (name) => readFileSync(path.join(pub, name), 'utf8')
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3002'

const browser = await chromium.launch()
try {
  async function renderSvg(source, size, out) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    })
    await page.setContent(
      `<body style="margin:0;background:transparent">${source.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`)}</body>`,
    )
    await page.screenshot({
      path: path.join(pub, out),
      clip: { x: 0, y: 0, width: size, height: size },
      omitBackground: false,
    })
    await page.close()
    console.log('wrote', out)
  }
  const maskable = svg('icon-maskable.svg')
  await renderSvg(maskable, 192, 'icon-maskable-192.png')
  await renderSvg(maskable, 512, 'icon-maskable-512.png')
  // iOS applies its own mask and paints transparency black, so the touch icon is
  // opaque and full-bleed. It uses the maskable art (mark already inset).
  await renderSvg(maskable, 180, 'apple-touch-icon.png')

  if (process.argv.includes('--screens')) {
    mkdirSync(path.join(pub, 'screenshots'), { recursive: true })
    const shots = [
      { name: 'home-narrow.png', url: '/', w: 540, h: 960 },
      { name: 'readiness-narrow.png', url: '/readiness', w: 540, h: 960 },
      { name: 'home-wide.png', url: '/', w: 1280, h: 720 },
      { name: 'readiness-wide.png', url: '/readiness', w: 1280, h: 720 },
    ]
    for (const s of shots) {
      const page = await browser.newPage({ viewport: { width: s.w, height: s.h } })
      await page.goto(BASE_URL + s.url, { waitUntil: 'networkidle' })
      await page.waitForTimeout(800)
      // Hide the Next dev-server badge if the app is running in dev mode.
      await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' })
      await page.screenshot({ path: path.join(pub, 'screenshots', s.name) })
      await page.close()
      console.log('wrote screenshots/' + s.name)
    }
  }
} finally {
  await browser.close()
}
