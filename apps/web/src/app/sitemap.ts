import type { MetadataRoute } from 'next'
import { GUIDES } from './guides/guides-data'

// Same base as layout.tsx's metadataBase — the real Firebase Hosting
// target (.firebaserc). If a custom domain ever lands, both places change.
const SITE_URL = 'https://lifekeel.co.uk'

// Required under output:'export' — the file is generated at build time.
export const dynamic = 'force-static'

// Public, crawlable routes only — anything behind AuthGate (or a
// transactional URL like reset-password) gets no sitemap entry.
const PUBLIC_ROUTES: {
  path: string
  changefreq: 'weekly' | 'monthly' | 'yearly'
  priority: number
}[] = [
  { path: '/', changefreq: 'weekly', priority: 1.0 },
  { path: '/blog/', changefreq: 'weekly', priority: 0.7 },
  { path: '/guides/', changefreq: 'monthly', priority: 0.7 },
  { path: '/signup/', changefreq: 'monthly', priority: 0.6 },
  { path: '/support/', changefreq: 'monthly', priority: 0.4 },
  { path: '/login/', changefreq: 'monthly', priority: 0.3 },
  { path: '/privacy/', changefreq: 'yearly', priority: 0.2 },
  { path: '/terms/', changefreq: 'yearly', priority: 0.2 },
]

interface SitemapPost {
  slug: string
  published_at?: string
  updated_at?: string
}

// Blog posts are the SEO surface — fetched from the public API at build
// time so every published post lands in the sitemap without hand-editing
// a static XML file. API unreachable at build → static routes only;
// degraded is better than a failed deploy.
async function blogPostEntries(): Promise<MetadataRoute.Sitemap> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
  try {
    const res = await fetch(`${apiBase}/blog/posts`, { next: { revalidate: false } })
    if (!res.ok) return []
    const data = (await res.json()) as { posts?: SitemapPost[] }
    return (data.posts ?? []).map((p) => ({
      url: `${SITE_URL}/blog/${p.slug}/`,
      lastModified: p.updated_at ?? p.published_at,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    }))
  } catch {
    return []
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = PUBLIC_ROUTES.map((r) => ({
    url: `${SITE_URL}${r.path}`,
    changeFrequency: r.changefreq,
    priority: r.priority,
  }))
  const guideEntries: MetadataRoute.Sitemap = GUIDES.map((g) => ({
    url: `${SITE_URL}/guides/${g.slug}/`,
    changeFrequency: 'yearly' as const,
    priority: 0.8,
  }))
  return [...staticEntries, ...guideEntries, ...(await blogPostEntries())]
}
