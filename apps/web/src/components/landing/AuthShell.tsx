'use client'

import type { ReactNode, Ref } from 'react'
import Link from 'next/link'
import { FileText, Heart, ShieldCheck, Wallet } from 'lucide-react'
import { AuthIntro, type AuthIntroVariant } from './AuthIntro'
import { Brand } from './Brand'
import { Wave } from './SeaBackdrop'
import './landing.css'
import './hero.css'
import './bands.css'
import './auth.css'

/**
 * The frame for sign-in, sign-up and the other account screens: the brand lockup at the
 * top left on the page's own container, a card on the landing sky, a small sea along the
 * bottom, and the legal links. Pure presentation; the screens keep their own logic.
 */
export function AuthShell({
  title,
  sub,
  children,
  aside,
  wide,
  headingRef,
  intro,
}: {
  title: string
  sub?: string | undefined
  children?: ReactNode
  /** Shown in the top right, beside the brand (for example the region switch). */
  aside?: ReactNode
  wide?: boolean
  /** For screens that move focus to the heading after a step change. */
  headingRef?: Ref<HTMLHeadingElement>
  /** Page-specific left panel; screens without one keep the general intro. */
  intro?: AuthIntroVariant | undefined
}) {
  return (
    <div className="landing lk-auth">
      <header className="lk-auth-top">
        <Brand />
        {aside}
      </header>
      <div className="lk-auth-layout">
        {intro ? (
          <AuthIntro variant={intro} />
        ) : (
          <aside className="lk-auth-intro" aria-label="About LifeKeel">
            <p className="lk-eyebrow">A LITTLE MORE READY FOR LIFE</p>
            <h2>
              Less scattered.
              <br />
              More together.
            </h2>
            <p>
              A home for your family’s money, cover and important papers. Start with what you know,
              and build at your own pace.
            </p>
            <div className="lk-auth-tiles">
              {[
                { Icon: Wallet, label: 'Your money' },
                { Icon: ShieldCheck, label: 'Your cover' },
                { Icon: FileText, label: 'Your papers' },
                { Icon: Heart, label: 'Your people' },
              ].map(({ Icon, label }) => (
                <div key={label}>
                  <Icon size={28} aria-hidden="true" />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </aside>
        )}
        <main className={`lk-auth-card${wide ? ' wide' : ''}`}>
          <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined}>
            {title}
          </h1>
          {sub && <p className="lk-auth-sub">{sub}</p>}
          {children}
        </main>
      </div>
      <footer className="lk-auth-foot">
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/support">Support</Link>
      </footer>
      <div className="lk-auth-sea" aria-hidden="true">
        <div className="lk-layer lk-l1">
          <Wave i={1} gid="lk-ag1" />
        </div>
        <div className="lk-layer lk-l2">
          <Wave i={2} gid="lk-ag2" />
        </div>
        <div className="lk-front">
          <div className="lk-layer">
            <Wave i={3} gid="lk-ag3" />
          </div>
        </div>
      </div>
    </div>
  )
}
