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
  },
  images: isStaticExport
    ? { unoptimized: true }
    : { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
}

module.exports = nextConfig
