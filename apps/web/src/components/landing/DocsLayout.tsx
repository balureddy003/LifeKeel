'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import './docs.css'

export interface DocsLink {
  href: string
  label: string
}

export interface DocsGroup {
  heading?: string
  links: DocsLink[]
}

const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)

/**
 * A section of related public pages (legal, guides) with a sticky sidebar on wide
 * screens and a collapsible "in this section" menu above the content on phones.
 */
export function DocsLayout({
  label,
  groups,
  children,
}: {
  label: string
  groups: DocsGroup[]
  children: ReactNode
}) {
  const pathname = trim(usePathname() ?? '')
  const current = groups.flatMap((g) => g.links).find((l) => trim(l.href) === pathname)

  const list = (
    <>
      {groups.map((g, i) => (
        <div key={g.heading ?? i} className="lk-docs-group">
          {g.heading && <p className="lk-docs-h">{g.heading}</p>}
          <ul>
            {g.links.map((l) => {
              const active = trim(l.href) === pathname
              return (
                <li key={l.href}>
                  <Link href={l.href} aria-current={active ? 'page' : undefined}>
                    {l.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </>
  )

  return (
    <div className="lk-docs">
      <aside className="lk-docs-side">
        <nav aria-label={label}>
          <p className="lk-docs-label">{label}</p>
          {list}
        </nav>
      </aside>
      {/* keyed by route so the menu closes after a link is followed */}
      <details key={pathname} className="lk-docs-mnav">
        <summary>
          <span className="lk-docs-label">{label}</span>
          <span className="lk-docs-current">{current?.label ?? 'All pages'}</span>
          <ChevronDown size={18} aria-hidden />
        </summary>
        <nav aria-label={`${label} pages`}>{list}</nav>
      </details>
      <div className="lk-docs-main">{children}</div>
    </div>
  )
}
