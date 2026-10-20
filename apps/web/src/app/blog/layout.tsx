import type { Metadata } from 'next'
import { PublicShell } from '@/components/landing/PublicShell'

// The index page's title/OG/canonical live in this server-only layout. Individual post pages
// set their own metadata at build time (blog/[slug]/page.tsx, PRD-210 phase 1).
export const metadata: Metadata = {
  title: 'From LifeKeel — plain-language readiness explainers',
  description:
    'Plain-language explainers behind what Keel checks for your family — job loss, medical bills, coverage gaps, and the stuff that surprises households.',
  alternates: { canonical: 'https://lifekeel.co.uk/blog/' },
  openGraph: {
    title: 'From LifeKeel — plain-language readiness explainers',
    description: 'Plain-language explainers behind what Keel checks for your family.',
    url: 'https://lifekeel.co.uk/blog/',
    type: 'website',
  },
}

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>
}
