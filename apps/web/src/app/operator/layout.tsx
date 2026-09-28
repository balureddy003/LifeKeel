import Link from 'next/link'
import type { ReactNode } from 'react'
import { OperatorGate } from './_components/OperatorGate'
import { OperatorSidebar, OperatorSignOutButton, OperatorTabs } from './_components/OperatorNav'
import { OperatorSessionProvider } from './_components/OperatorSession'

export default function OperatorLayout({ children }: { children: ReactNode }) {
  return (
    <OperatorSessionProvider>
    <div className="min-h-screen bg-canvas text-ink-primary">
      {/* Desktop: fixed left rail owns the header role entirely. */}
      <OperatorSidebar />
      <div className="md:pl-56">
        {/* Mobile: no room for a rail — compact header + scrollable tabs. */}
        <header className="sticky top-0 z-sticky border-b border-tint/[0.08] bg-navbg/90 backdrop-blur-xl md:hidden">
          <div className="flex items-center justify-between gap-4 px-5 pt-4">
            <Link href="/operator" className="font-semibold text-family-400">Agent Oak Operator</Link>
            <div className="flex items-center gap-1">
              <Link href="/" className="px-2 text-sm text-ink-tertiary">Product</Link>
              <OperatorSignOutButton />
            </div>
          </div>
          <div className="px-5 pb-3 pt-3">
            <OperatorTabs />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-5 py-6">
          <OperatorGate>{children}</OperatorGate>
        </main>
      </div>
    </div>
    </OperatorSessionProvider>
  )
}
