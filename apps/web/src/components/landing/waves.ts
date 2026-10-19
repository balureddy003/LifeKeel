/** Wave paths for the sea backdrop: fixed-width 2400 tiles so crests are never stretched. */
export interface WaveSpec {
  amp: number
  n: number
  base: number
  ph: number
  crest?: boolean
}

export const WAVES: WaveSpec[] = [
  { amp: 5, n: 3, base: 14, ph: 0 },
  { amp: 7, n: 4, base: 16, ph: 1.2 },
  { amp: 8, n: 5, base: 18, ph: 2.1 },
  { amp: 9, n: 6, base: 18, ph: 0.6, crest: true },
]

export function wavePath(w: WaveSpec, h = 120): { fill: string; crest: string } {
  const pts: string[] = []
  for (let x = 0; x <= 2400; x += 16) {
    const y =
      w.base +
      w.amp * Math.sin(((2 * Math.PI * w.n * x) / 2400) * 2 + w.ph) +
      w.amp * 0.35 * Math.sin((2 * Math.PI * w.n * 2 * x) / 1200 + w.ph * 1.7)
    pts.push(`${x} ${y.toFixed(1)}`)
  }
  return { fill: `M0 ${h} L${pts.join(' L')} L2400 ${h} Z`, crest: `M${pts.join(' L')}` }
}
