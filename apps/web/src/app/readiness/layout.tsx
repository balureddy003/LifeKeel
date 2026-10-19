import type { Metadata } from 'next'
import { PublicShell } from '@/components/landing/PublicShell'

// readiness/page.tsx is 'use client' (it's an interactive quiz) so it can't
// export its own metadata — a server-only layout alongside it is the
// standard App Router way to give one specific route its own title/OG data
// without converting the page itself. No other route does this today
// because no other route is meant to be shared link-by-link the way this
// quiz's result is (see ShareScore in page.tsx) — everywhere else, the root
// layout's site-wide metadata is the right default.
export const metadata: Metadata = {
  title: 'Family Readiness Check — LifeKeel',
  description:
    'Six quick questions, no signup. See your Family Readiness Check result and what Keel would flag for your household — free, in about a minute.',
  openGraph: {
    title: 'Family Readiness Check — LifeKeel',
    description:
      'Six quick questions, no signup. See your Family Readiness Check result in about a minute.',
    url: 'https://lifekeel.co.uk/readiness',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Family Readiness Check — LifeKeel',
    description:
      'Six quick questions, no signup. See your Family Readiness Check result in about a minute.',
  },
}

export default function ReadinessLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>
}
