'use client'

import Script from 'next/script'

// Rendered only by MarketingTags, after consent and on public pages (R36).
// page_location drops the query string and fragment.
// GA4 + Google Ads share one gtag.js — the Ads conversion ID (AW-...) is
// configured on the same tag when set, so ad clicks attribute correctly
// without a second script load. Both are optional infrastructure: with
// neither configured the component renders nothing at all — no request,
// no cookies — so the build is privacy-clean until an operator sets the
// env vars at build time (they're inlined, not runtime).
// The app's first-party growth tracking (lib/growth-track.ts) runs
// regardless; these are the public-page/funnel views on top of it.
const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
const ADS_ID = process.env.NEXT_PUBLIC_GADS_CONVERSION_ID

export function GoogleAnalytics() {
  if (!GA_ID && !ADS_ID) return null
  const tagId = GA_ID ?? ADS_ID
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${tagId}`}
        strategy="afterInteractive"
      />
      <Script id="gtag-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());${GA_ID ? `gtag('config','${GA_ID}',{send_page_view:true,page_location:location.origin+location.pathname});` : ''}${ADS_ID ? `gtag('config','${ADS_ID}');` : ''}`}
      </Script>
    </>
  )
}
