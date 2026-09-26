'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, HelpCircle, User, ChevronRight, Siren, Loader2, Share2 } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { ROLE_LABELS } from '@/lib/auth-types'
import { PageHeader, PageTransition } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import { calculateAge } from '@/lib/age'
import { haptic } from '@/lib/haptics'

export default function MemberProfileClient() {
  const params = useParams<{ id: string }>()
  const { family, updateMemberDateOfBirth } = useAuth()
  const toast = useToast()
  const [savingDob, setSavingDob] = useState(false)
  const member = family?.members.find((m) => m.id === params.id)

  // A "Pending" member has a roster record but hasn't joined yet — this
  // app has no per-person emailed invite, only one shared family code
  // (Settings), so the honest, actually-working action here is helping
  // the organizer get that code to them, not a fake "resend" button.
  const shareInvite = async () => {
    if (!family || !member) return
    haptic('light')
    const message = `Join our family on Agent Oak, ${member.name.split(' ')[0]} — use invite code ${family.inviteCode} at the sign-up screen.`
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ text: message })
        return
      } catch {
        // User cancelled the share sheet or it's unsupported — fall through to clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(message)
      toast({ message: 'Invite message copied — paste it to them' })
    } catch {
      toast({ message: `Invite code: ${family.inviteCode}` })
    }
  }

  const handleDobChange = async (value: string) => {
    if (!member || !value) return
    setSavingDob(true)
    try {
      await updateMemberDateOfBirth(member.id, value)
      toast({ message: 'Birthday saved' })
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't save that — try again in a moment.", variant: 'error' })
    } finally {
      setSavingDob(false)
    }
  }

  if (!member) {
    return (
      <div className="px-4 pt-8 text-center">
        <div className="w-16 h-16 rounded-3xl bg-tint/[0.03] border border-tint/[0.08] flex items-center justify-center mb-4 mx-auto">
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
    <PageTransition>
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

      {member.status === 'pending' && (
        <div className="card">
          <div className="text-sm font-semibold text-ink-primary mb-1">Finish {member.name.split(' ')[0]}&apos;s setup</div>
          <p className="text-xs text-ink-tertiary mb-3">
            They haven&apos;t joined yet. Share your family&apos;s invite code with them so they can
            create their own account and see what&apos;s already on file.
          </p>
          <button
            onClick={shareInvite}
            className="btn-secondary w-full flex items-center justify-center gap-2"
          >
            <Share2 size={16} />
            <span>Share invite code</span>
          </button>
        </div>
      )}

      <div className="card">
        <label className="block">
          <div className="text-sm font-semibold text-ink-primary mb-1">Date of birth</div>
          <p className="text-xs text-ink-tertiary mb-2">
            {member.dateOfBirth
              ? `${calculateAge(member.dateOfBirth)} years old — used to fill in age fields elsewhere so you don't have to re-type them.`
              : "Optional — lets Financial Profile fill in age fields on its own instead of asking."}
          </p>
          <div className="flex items-center gap-2">
            <input
              type="date"
              defaultValue={member.dateOfBirth ?? ''}
              max={new Date().toISOString().slice(0, 10)}
              onBlur={(e) => handleDobChange(e.target.value)}
              disabled={savingDob}
              className="glass-input flex-1 rounded-xl px-4 py-3 text-base text-ink-primary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all disabled:opacity-60"
            />
            {savingDob && <Loader2 size={18} className="animate-spin text-ink-tertiary flex-shrink-0" />}
          </div>
        </label>
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
    </PageTransition>
  )
}
