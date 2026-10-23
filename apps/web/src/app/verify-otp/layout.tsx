import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Enter your code — LifeKeel', robots: { index: false } }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
