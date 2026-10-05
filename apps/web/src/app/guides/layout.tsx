import type { Metadata } from 'next'

// Same pattern as blog/layout.tsx / readiness/layout.tsx — route-level
// title/OG/canonical live here so the page components stay simple.
// Per-guide metadata is generated in guides/[slug]/page.tsx.
export const metadata: Metadata = {
  title: 'Family finance guides — LifeKeel',
  description: 'Plain-language guides to the checks Keel runs for your family — emergency funds, protection gaps, retirement projections, and education savings.',
  alternates: { canonical: 'https://lifekeel.co.uk/guides/' },
  openGraph: {
    title: 'Family finance guides — LifeKeel',
    description: 'Plain-language guides to the checks Keel runs for your family.',
    url: 'https://lifekeel.co.uk/guides/',
    type: 'website',
  },
}

export default function GuidesLayout({ children }: { children: React.ReactNode }) {
  return children
}
