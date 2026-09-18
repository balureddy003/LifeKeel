'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, HelpCircle, User, ChevronRight, Siren } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { ROLE_LABELS } from '@/lib/auth-types'
import { PageHeader } from '@/components/Glass'

export default function MemberProfileClient() {
  const params = useParams<{ id: string }>()
  const { family } = useAuth()
  const member = family?.members.find((m) => m.id === params.id)

  if (!member) {
    return (
      <div className="px-4 pt-8 text-center">
        <div className="w-16 h-16 rounded-3xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center mb-4 mx-auto">
          <HelpCircle size={32} className="text-ink-tertiary" />
        </div>
        <p className="text-ink-secondary">Family member not found</p>
        <Link href="/family" className="btn-secondary mt-4 inline-flex items-center gap-1">
          <ArrowLeft size={14} /> Back to Family
        </Link>
      </div>
    )
  }

  return (
    <div className="px-5 pt-2 space-y-5 animate-fade-in">
      <PageHeader title={member.name} backHref="/family" />

      <div className="card">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-family-500/10 border border-family-500/20 flex items-center justify-center flex-shrink-0">
            <User size={24} className="text-family-400" />
          </div>
          <div>
            <div className="text-base font-semibold text-ink-primary">{member.name}</div>
            <div className="text-sm text-ink-tertiary">{ROLE_LABELS[member.role]}</div>
          </div>
          {member.status === 'pending' && (
            <span className="ml-auto text-xs font-semibold text-warning bg-warning/10 px-2 py-1 rounded-full">
              Pending
            </span>
          )}
        </div>
      </div>

      <Link href="/financial-profile" className="card flex items-center gap-3 active:opacity-80">
        <div className="flex-1">
          <div className="text-sm font-semibold text-ink-primary">Add financial details</div>
          <p className="text-sm text-ink-tertiary mt-0.5">
            Income, protection, and assets aren&apos;t collected per-member yet — add them to your
            family&apos;s Financial Profile to power real insights.
          </p>
        </div>
        <ChevronRight size={16} className="text-ink-tertiary flex-shrink-0" />
      </Link>

      <Link href="/events" className="btn-primary flex items-center justify-center gap-2 w-full">
        <Siren size={18} />
        <span>Simulate Life Event</span>
      </Link>
    </div>
  )
}
