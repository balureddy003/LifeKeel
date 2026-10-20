import type { Metadata } from 'next'

// The link carries a single-use token in its query string: never index it and
// never send it on as a referrer (firebase.json sets the matching header).
export const metadata: Metadata = {
  title: 'Keep your result — LifeKeel',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
