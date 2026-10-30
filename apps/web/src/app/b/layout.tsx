import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'A household brief — LifeKeel' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
