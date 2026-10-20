#!/usr/bin/env node
/**
 * Writes LifeKeel icons/splash art into the generated (gitignored) native
 * projects. Runs after `cap add` + `cap sync` in the prepare scripts, on any
 * platform (CI-safe — no macOS-only tools).
 *
 *   node scripts/apply-icons.mjs ios|android
 *
 * Sources (committed, regenerated from assets/src/*.svg — see
 * docs/mobile-release.md): assets/gen/icon-1024.png (opaque square),
 * assets/gen/mark-1024.png (transparent mark), assets/gen/splash-2732.png.
 */
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const GEN = path.join(ROOT, 'assets', 'gen')
const ICON = path.join(GEN, 'icon-1024.png')
const MARK = path.join(GEN, 'mark-1024.png')
const SPLASH = path.join(GEN, 'splash-2732.png')

const platform = process.argv[2]
if (!['ios', 'android'].includes(platform)) {
  console.error('usage: apply-icons.mjs ios|android')
  process.exit(1)
}

// Adaptive-icon foreground: the mark at ~66% of canvas on transparency —
// the safe zone Android guarantees won't be masked away.
async function foreground(size) {
  const mark = await sharp(MARK)
    .resize(Math.round(size * 0.66), Math.round(size * 0.66), { fit: 'contain' })
    .toBuffer()
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toBuffer()
}

async function splash(w, h) {
  return sharp(SPLASH).resize(w, h, { fit: 'cover', position: 'center' }).png().toBuffer()
}

const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 }
const SPLASHES = {
  drawable: [320, 480],
  'drawable-port-mdpi': [320, 480],
  'drawable-land-mdpi': [480, 320],
  'drawable-port-hdpi': [480, 800],
  'drawable-land-hdpi': [800, 480],
  'drawable-port-xhdpi': [720, 1280],
  'drawable-land-xhdpi': [1280, 720],
  'drawable-port-xxhdpi': [960, 1600],
  'drawable-land-xxhdpi': [1600, 960],
  'drawable-port-xxxhdpi': [1280, 1920],
  'drawable-land-xxxhdpi': [1920, 1280],
}

if (platform === 'ios') {
  const assets = path.join(ROOT, 'ios/App/App/Assets.xcassets')
  // App Store rejects icons carrying an alpha channel — flatten to opaque.
  await sharp(ICON)
    .flatten()
    .png()
    .toFile(path.join(assets, 'AppIcon.appiconset/AppIcon-512@2x.png'))
  const splashBuf = await sharp(SPLASH).png().toBuffer()
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    await sharp(splashBuf).toFile(path.join(assets, 'Splash.imageset', name))
  }
  console.log('iOS: AppIcon + Splash written')
} else {
  const res = path.join(ROOT, 'android/app/src/main/res')
  for (const [density, size] of Object.entries(DENSITIES)) {
    const iconBuf = await sharp(ICON).resize(size, size).png().toBuffer()
    const dir = path.join(res, `mipmap-${density}`)
    await sharp(iconBuf).toFile(path.join(dir, 'ic_launcher.png'))
    await sharp(iconBuf).toFile(path.join(dir, 'ic_launcher_round.png'))
    await sharp(await foreground(FOREGROUND[density])).toFile(
      path.join(dir, 'ic_launcher_foreground.png'),
    )
  }
  for (const [dir, [w, h]] of Object.entries(SPLASHES)) {
    await sharp(await splash(w, h)).toFile(path.join(res, dir, 'splash.png'))
  }
  // Brand background behind the adaptive-icon foreground (Capacitor ships white).
  fs.writeFileSync(
    path.join(res, 'values/ic_launcher_background.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0B3B5C</color>\n</resources>\n',
  )
  console.log('Android: launcher icons, foregrounds + splashes written')
}
