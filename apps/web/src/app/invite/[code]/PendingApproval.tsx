import Link from 'next/link'
import { Clock } from 'lucide-react'

/**
 * Shown after someone asks to join a family. It says only what is true: the
 * request is waiting, the organizer decides, and an email follows approval.
 * It does not name the family: the person asking holds only a code and may be
 * someone the family is avoiding. (The organizer sees the request when they open the app; nothing is pushed to
 * them, so this does not claim they were told.)
 */
export function PendingApproval() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <div className="w-16 h-16 rounded-3xl bg-family-500/10 border border-family-500/20 flex items-center justify-center mb-4 mx-auto">
        <Clock size={32} className="text-family-400" aria-hidden="true" />
      </div>
      <h1 className="text-2xl font-bold mb-2">Waiting for approval</h1>
      <p className="text-sm text-ink-secondary leading-relaxed max-w-xs mx-auto">
        Your request is with the family&apos;s organizer and stays open for 14 days. If they approve
        it, we will email the address you gave, so check you typed it correctly. If nothing arrives,
        ask the organizer or send a new request.
      </p>
      <Link
        href="/login"
        className="mt-6 inline-flex min-h-[48px] items-center text-sm font-semibold text-family-400"
      >
        Already approved? Sign in
      </Link>
    </div>
  )
}
