import type { Metadata } from 'next'

// Same pattern as readiness/layout.tsx — the blog index page is a client
// component, so its title/OG/canonical live in this server-only layout.
// Individual post pages can't prerender per-slug metadata (static export
// placeholder, see blog/[slug]/page.tsx); BlogPostClient injects them
// client-side once the post loads.
export const metadata: Metadata = {
  title: 'From Agent Oak — plain-language readiness explainers',
  description: 'Plain-language explainers behind what Oak checks for your family — job loss, medical bills, coverage gaps, and the stuff that surprises households.',
  alternates: { canonical: 'https://kairos-trellis.web.app/blog/' },
  openGraph: {
    title: 'From Agent Oak — plain-language readiness explainers',
    description: 'Plain-language explainers behind what Oak checks for your family.',
    url: 'https://kairos-trellis.web.app/blog/',
    type: 'website',
  },
}

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return children
}
