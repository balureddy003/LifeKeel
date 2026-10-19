import type { Metadata } from 'next'
import { PublicShell } from '@/components/landing/PublicShell'

// Same pattern as readiness/layout.tsx — the blog index page is a client
// component, so its title/OG/canonical live in this server-only layout.
// Individual post pages can't prerender per-slug metadata (static export
// placeholder, see blog/[slug]/page.tsx); BlogPostClient injects them
// client-side once the post loads.
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
