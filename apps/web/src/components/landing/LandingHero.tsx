'use client'

/**
 * Cinematic hero — paper-mode opening shot.
 *
 * Three calm beats, the platform line as the h1.
 * H1 reads as "Know where to look." per the brand guide §3 — the platform
 * line is also the headline, locked. Above and below it sit two body
 * beats: the problem and the resolution whisper.
 *
 * H1 hierarchy:    "Know where to look."
 * Above (body):    "The important things usually live in one head."
 * Below (body):    "One list. The people who need to know can see it."
 *
 * Below the lines: one singular primary CTA ("Start a free list") and
 * a quiet team secondary ("For a small team — see plans"). The team
 * path is a text link, not a button, so the page does not split into
 * two products on a phone.
 *
 * On the right (above on mobile): the props component
 * MarketingSeenByList, which is the visual hero — a paper-textured
 * shared list with real names, real ticks, ink-coloured ticks.
 *
 * The cast (Dev, Marcia, Asha — the Rivera family) is shared with
 * MomentCards and ThroughTheYear — the home page reads
 * as one story. See `__tests__/HomeExperience.test.tsx` for the
 * cast invariant.
 *
 * Implementation references
 *   - Brand spec / Appendix A1–A8 — narrative brief, 2026-11-26
 *   - claims.ts rows relied on by copy: family-list,
 *     every-adult-confirms, no-commissions, no-money-moved,
 *     no-policy-picks, no-selling, free-plan. (All `live`.)
 */

import { useEffect, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { appUrl } from '@/lib/region'
import { track } from '@/lib/growth-track'
import { haptic } from '@/lib/haptics'
import { MarketingSeenByList } from './MarketingSeenByList'
import { SAMPLE_LAST_SEEN, SAMPLE_ROWS } from './sample-list'

export function LandingHero() {
  const ref = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const el = ref.current
    if (!el || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver((entries) => setVisible(entries[0]!.isIntersecting), {
      threshold: 0.1,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <section
      ref={ref}
      className="lk-paper-hero"
      data-visible={visible}
      aria-labelledby="lk-paper-hero-h"
    >
      <div className="lk-paper-hero-copy">
        <p className="lk-paper-hero-line1">The important things usually live in one head.</p>
        <h1 id="lk-paper-hero-h" className="lk-paper-hero-h1">
          Know where to look.
        </h1>
        <p className="lk-paper-hero-line2">One list. The people who need to know can see it.</p>
        <div className="lk-paper-hero-cta" id="signup">
          <a
            href={appUrl('/signup')}
            className="lk-paper-hero-primary"
            onClick={() => {
              haptic('light')
              track('landing_cta_click', { location: 'paper_hero', method: 'signup' })
            }}
          >
            Start a free list
            <ArrowRight size={18} aria-hidden="true" />
          </a>
          <a href="/pricing" className="lk-paper-hero-secondary">
            For a small team — see plans →
          </a>
        </div>
        <p className="lk-paper-hero-micro">
          Free for a household. Honest plans for a team. Information only — never moves money, never
          gives advice.
        </p>
      </div>

      <div className="lk-paper-hero-prop">
        <MarketingSeenByList
          familyName="The Rivera family"
          rows={SAMPLE_ROWS}
          lastSeen={SAMPLE_LAST_SEEN}
        />
      </div>
    </section>
  )
}
