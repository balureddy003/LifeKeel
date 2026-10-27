'use client'

import type { ReactNode, Ref } from 'react'
import Link from 'next/link'
import { FileText, Heart, Monitor, Moon, ShieldCheck, Sparkles, Sun, Wallet } from 'lucide-react'
import { useThemePreference } from '@/lib/theme'
import { Brand } from './Brand'
import './landing.css'
import './hero.css'
import './bands.css'
import './auth.css'
import './auth-refresh.css'

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
  const [theme, setTheme] = useThemePreference()
  const nextTheme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
  const ThemeIcon = theme === 'system' ? Monitor : theme === 'light' ? Sun : Moon

  return (
    <div className="landing lk-auth lk-studio">
      <header className="lk-auth-top">
        <Brand />
        <div className="lk-auth-tools">
          <button
            type="button"
            className="lk-auth-theme"
            onClick={() => setTheme(nextTheme)}
            aria-label={`Theme: ${theme}. Switch to ${nextTheme} theme`}
          >
            <ThemeIcon size={17} aria-hidden="true" />
            <span>{theme}</span>
          </button>
          {aside}
        </div>
      </header>
      <div className="lk-auth-layout">
        <aside className="lk-auth-intro" aria-label="About LifeKeel">
          <p className="lk-eyebrow">
            <Sparkles size={15} aria-hidden="true" /> A LITTLE MORE READY FOR LIFE
          </p>
          <h2>
            Less scattered.
            <br />
            <span>More together.</span>
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
    </div>
  )
}
