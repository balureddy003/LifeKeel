#!/usr/bin/env node
/**
 * Renders the committed brand SVGs in assets/src/ into the PNGs that
 * apply-icons.mjs consumes. Cross-platform (sharp/libvips rasterises the
 * SVGs — no qlmanage/rsvg-convert needed). Run after editing a source SVG:
 *
 *   node scripts/gen-assets.mjs
 */
import sharp from 'sharp'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SRC = path.join(ROOT, 'assets', 'src')
const GEN = path.join(ROOT, 'assets', 'gen')

// [source, output, output px, intrinsic SVG px] — density upscales the
// rasterisation so the 192px SVGs come out crisp at 1024.
const jobs = [
  ['icon-square.svg', 'icon-1024.png', 1024, 192], // opaque, full-bleed (Apple masks)
  ['icon-mark.svg', 'mark-1024.png', 1024, 192], // transparent mark for foregrounds
  ['splash.svg', 'splash-2732.png', 2732, 2732], // full-bleed, mark centered
]

for (const [src, out, px, intrinsic] of jobs) {
  await sharp(path.join(SRC, src), { density: Math.ceil((72 * px * 2) / intrinsic) })
    .resize(px, px)
    .png()
    .toFile(path.join(GEN, out))
  console.log(`${out} <- ${src} @${px}px`)
}
