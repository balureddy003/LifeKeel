import type { Metadata } from 'next'

// Retired page (see page.tsx): it only redirects, so keep it out of search results.
export const metadata: Metadata = {
  title: 'Sign up — LifeKeel',
  robots: { index: false, follow: true },
}

export default function ReadinessLayout({ children }: { children: React.ReactNode }) {
  return children
}
