import { WAVES, wavePath } from './waves'

const PATHS = WAVES.map((w) => ({ ...wavePath(w), hasCrest: !!w.crest }))

export function Wave({ i, gid }: { i: number; gid: string }) {
  const p = PATHS[i]!
  return (
    <svg viewBox="0 0 2400 120" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" />
          <stop offset="1" stopColor="currentColor" stopOpacity=".72" />
        </linearGradient>
      </defs>
      <path d={p.fill} fill={`url(#${gid})`} />
      {p.hasCrest && (
        <path
          d={p.crest}
          fill="none"
          stroke="var(--crest)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  )
}

/** Sky, lighthouse, beam and three wave layers behind the hero. Decorative. */
export function SeaBackdrop() {
  return (
    <div className="lk-bg" aria-hidden="true">
      <div className="lk-sky lk-day" />
      <div className="lk-sky lk-dusk" />
      <div className="lk-glow" />
      <svg className="lk-lh" viewBox="0 0 22 64">
        <path d="M7 62 L9 22 H13 L15 62 Z" fill="currentColor" />
        <rect x="6" y="14" width="10" height="8" fill="currentColor" />
        <path d="M5 14 L11 6 L17 14 Z" fill="currentColor" />
        <rect x="9" y="16" width="4" height="4" fill="var(--cta)" />
      </svg>
      <div className="lk-beam" />
      <div className="lk-layer lk-l0">
        <Wave i={0} gid="lk-wg0" />
      </div>
      <div className="lk-layer lk-l1">
        <Wave i={1} gid="lk-wg1" />
      </div>
      <div className="lk-layer lk-l2">
        <Wave i={2} gid="lk-wg2" />
      </div>
    </div>
  )
}

/** The foreground wave, drawn over the boats and under the signup card. */
export function SeaFront() {
  return (
    <div className="lk-front" aria-hidden="true">
      <div className="lk-layer">
        <Wave i={3} gid="lk-wg3" />
      </div>
    </div>
  )
}
