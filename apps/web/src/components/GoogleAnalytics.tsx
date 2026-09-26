'use client'

import Script from 'next/script'

// GA4 is optional infrastructure: with no measurement ID configured the
// component renders nothing at all — no request, no cookies — so the build
// is privacy-clean until an operator deliberately sets
// NEXT_PUBLIC_GA_MEASUREMENT_ID at build time (it's inlined, not runtime).
// The app's first-party growth tracking (lib/growth-track.ts) runs
// regardless; GA4 is the public-page/funnel view on top of it.
const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

export function GoogleAnalytics() {
  if (!GA_ID) return null
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${GA_ID}',{send_page_view:true});`}
      </Script>
    </>
  )
}
