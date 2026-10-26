import type { ReactNode } from 'react'
import Link from 'next/link'

export function AppHeroHeader({
  children,
  onHomeClick,
}: {
  children?: ReactNode
  onHomeClick?: () => void
}) {
  return (
    <header className="app-hero">
      <div className="app-hero-inner">
        <Link
          href="/"
          {...(onHomeClick ? { onClick: onHomeClick } : {})}
          aria-label="LifeKeel home"
          className="flex items-center gap-3 min-w-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={36} height={36} className="rounded-xl shrink-0" />
          <div className="min-w-0">
            <div className="text-xl font-semibold tracking-tight">LifeKeel</div>
            <p className="text-caption text-ink-tertiary">Your family, together</p>
          </div>
        </Link>
        {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
      </div>
    </header>
  )
}
