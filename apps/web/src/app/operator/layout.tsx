import Link from 'next/link'
import type { ReactNode } from 'react'
import { OperatorGate } from './_components/OperatorGate'

const links: Array<[string, string]> = [
  ['Overview', '/operator'],
  ['Users', '/operator/users'],
  ['Tenants', '/operator/tenants'],
  ['Leads', '/operator/leads'],
  ['Promotions', '/operator/promotions'],
  ['Billing', '/operator/billing'],
  ['Content', '/operator/content'],
  ['Marketing', '/operator/marketing'],
  ['Operators', '/operator/operators'],
  ['Operations', '/operator/operations'],
  ['Configuration', '/operator/configuration'],
  ['Audit', '/operator/audit'],
]

export default function OperatorLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas text-ink-primary">
      <header className="sticky top-0 z-sticky border-b border-tint/[0.08] bg-navbg/90 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <Link href="/operator" className="font-semibold text-family-400">Agent Oak Operator</Link>
            <Link href="/" className="text-sm text-ink-tertiary">Product</Link>
          </div>
          <nav className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {links.map(([label, href]) => (
              <Link key={href} href={href} className="shrink-0 whitespace-nowrap rounded-lg border border-tint/[0.08] px-3 py-1.5 text-sm text-ink-secondary hover:text-ink-primary">
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-6">
        <OperatorGate>{children}</OperatorGate>
      </main>
    </div>
  )
}
