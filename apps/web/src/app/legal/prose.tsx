import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

export function H2({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-base font-semibold text-ink-primary mt-8 mb-2.5">
      {children}
    </h2>
  )
}

export function P({ children }: { children: ReactNode }) {
  return <p className="text-sm text-ink-secondary leading-relaxed mb-3">{children}</p>
}

export function UL({ children }: { children: ReactNode }) {
  return (
    <ul className="list-disc list-outside pl-5 text-sm text-ink-secondary leading-relaxed mb-3 space-y-1.5">
      {children}
    </ul>
  )
}

export function DraftNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-warning/10 border border-warning/20 px-4 py-3.5 flex items-start gap-2.5 mb-6">
      <AlertTriangle size={16} className="text-warning flex-shrink-0 mt-0.5" aria-hidden />
      <p className="text-xs text-ink-secondary leading-relaxed">{children}</p>
    </div>
  )
}

export const linkClass = 'text-family-400 font-medium underline'
