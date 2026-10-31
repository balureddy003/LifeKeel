import type { Metadata } from 'next'

// Deliberately plain: the recipient should meet the brief itself, not nav.
// No figures can appear here — this is the static shell, the payload is
// fetched client-side (PRD-222).
export const metadata: Metadata = { title: 'A household brief — LifeKeel' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
