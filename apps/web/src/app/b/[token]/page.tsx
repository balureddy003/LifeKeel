import BriefShareClient from './BriefShareClient'

// Static export (Firebase Hosting): every /b/** URL is rewritten to this
// one pre-rendered "placeholder" page — BriefShareClient resolves the real
// token from the browser URL via useRouteParam. Same pattern as
// /invite/[code]. The financial payload itself is fetched client-side with
// cache: 'no-store' — this static shell is cacheable, the numbers are not
// (PRD-222: "public, cacheable" never applies to the result).
export const metadata = {
  robots: { index: false, follow: false },
}

export function generateStaticParams() {
  return [{ token: 'placeholder' }]
}

export default function Page() {
  return <BriefShareClient />
}
