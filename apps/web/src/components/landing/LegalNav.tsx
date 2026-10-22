'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export const LEGAL_LINKS = [
  { href: '/legal', label: 'Overview' },
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/cookies', label: 'Cookies' },
  { href: '/security', label: 'Security' },
  { href: '/trust', label: 'Trust' },
]

export function LegalNav() {
  const pathname = usePathname()?.replace(/\/$/, '')
  if (!LEGAL_LINKS.some((link) => pathname === link.href)) return null
  return (
    <nav className="lk-legal-nav" aria-label="Legal and trust">
      {LEGAL_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={pathname === link.href ? 'page' : undefined}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  )
}
