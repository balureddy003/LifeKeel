import type { MetadataRoute } from 'next'

// Same base as layout.tsx / sitemap.ts.
const SITE_URL = 'https://kairos-trellis.web.app'

// Required under output:'export' — the file is generated at build time.
export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Auth-required and transactional surfaces are pointless to index —
      // keep crawlers on the public marketing/content pages.
      disallow: ['/operator/', '/marketing/', '/auth/', '/reset-password/', '/settings/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
