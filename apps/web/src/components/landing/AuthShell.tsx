'use client'

import type { ReactNode, Ref } from 'react'
import Link from 'next/link'
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
}: {
  title: string
  sub?: string | undefined
  children?: ReactNode
  /** Shown in the top right, beside the brand (for example the region switch). */
  aside?: ReactNode
  wide?: boolean
  /** For screens that move focus to the heading after a step change. */
  headingRef?: Ref<HTMLHeadingElement>
}) {
  return (
    <div className="landing lk-auth">
      <header className="lk-auth-top">
        <Brand />
        {aside}
      </header>
      <main className={`lk-auth-card${wide ? ' wide' : ''}`}>
        <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined}>
          {title}
        </h1>
        {sub && <p className="lk-auth-sub">{sub}</p>}
        {children}
      </main>
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
