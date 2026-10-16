const isStaticExport = process.env.FIREBASE_STATIC_EXPORT === '1'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Firebase Hosting serves static files only — no Next.js server, no Image
  // Optimization API, no dynamic SSR. See app/{member,asset,events,health}
  // dynamic routes for how they handle this (generateStaticParams +
  // client-side param resolution, mirroring apps/studio's approach).
  output: isStaticExport ? 'export' : undefined,
  // Needed so each route exports as <path>/index.html (matched by the
  // firebase.json rewrite destinations) instead of a flat <path>.html.
  ...(isStaticExport && { trailingSlash: true }),
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
    NEXT_PUBLIC_API_BASE_PATH: process.env.NEXT_PUBLIC_API_BASE_PATH ?? '',
    NEXT_PUBLIC_SAME_ORIGIN_API: process.env.NEXT_PUBLIC_SAME_ORIGIN_API ?? '',
  },
  // Same-origin API proxy for `next dev` when NEXT_PUBLIC_API_BASE_PATH=/api
  // — mirrors the firebase.json "/api/** → Cloud Run" rewrite used in
  // production. Not registered in export mode (rewrites don't apply to
  // static hosting; firebase.json owns them there).
  ...(isStaticExport ? {} : {
    async rewrites() {
      const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/$/, '')
      return [{ source: '/api/:path*', destination: `${apiBase}/:path*` }]
    },
  }),
  // No next/image usage anywhere in this app today — no `images` config to
  // maintain. Add one deliberately (with specific remotePatterns, not a
  // wildcard hostname) if/when a remote-image use case shows up.
}

module.exports = nextConfig
