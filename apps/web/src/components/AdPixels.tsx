'use client'

import Script from 'next/script'

// Rendered only by MarketingTags, after consent and on public pages (R36).
// disablePushState stops the pixel reporting in-app navigation.
// Meta Pixel + LinkedIn Insight Tag — the paid-ads measurement layer.
// Same contract as GoogleAnalytics: env-gated at build time, renders
// nothing without IDs, so an unconfigured build stays tracker-free.
// These tags only optimize ad delivery/attribution — first-party
// measurement (growth_events → funnel → paying) works without them.
const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID
const LINKEDIN_PARTNER_ID = process.env.NEXT_PUBLIC_LINKEDIN_PARTNER_ID

export function AdPixels() {
  if (!META_PIXEL_ID && !LINKEDIN_PARTNER_ID) return null
  return (
    <>
      {META_PIXEL_ID && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq.disablePushState=true;fbq('init','${META_PIXEL_ID}');fbq('track','PageView');`}
        </Script>
      )}
      {META_PIXEL_ID && (
        <noscript>
          {/* eslint-disable-next-line @next/next/no-img-element -- tracking fallback */}
          <img
            height="1"
            width="1"
            alt=""
            src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
          />
        </noscript>
      )}
      {LINKEDIN_PARTNER_ID && (
        <Script id="linkedin-insight" strategy="afterInteractive">
          {`_linkedin_partner_id='${LINKEDIN_PARTNER_ID}';window._linkedin_data_partner_ids=window._linkedin_data_partner_ids||[];window._linkedin_data_partner_ids.push(_linkedin_partner_id);
(function(l){if(!l){window.lintrk=function(a,b){window.lintrk.q.push([a,b])};window.lintrk.q=[]}
var s=document.getElementsByTagName('script')[0];var b=document.createElement('script');
b.type='text/javascript';b.async=true;b.src='https://snap.licdn.com/li.lms-analytics/insight.min.js';
s.parentNode.insertBefore(b,s);})(window.lintrk);`}
        </Script>
      )}
      {LINKEDIN_PARTNER_ID && (
        <noscript>
          {/* eslint-disable-next-line @next/next/no-img-element -- tracking fallback */}
          <img
            height="1"
            width="1"
            alt=""
            src={`https://px.ads.linkedin.com/collect/?pid=${LINKEDIN_PARTNER_ID}&fmt=gif`}
          />
        </noscript>
      )}
    </>
  )
}
