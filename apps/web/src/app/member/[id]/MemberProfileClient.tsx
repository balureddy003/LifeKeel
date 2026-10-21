'use client'

import { useEffect, useState } from 'react'
import { useRouteParam } from '@/lib/useRouteParam'
import Link from 'next/link'
import {
  ArrowLeft,
  HelpCircle,
  User,
  ChevronRight,
  Siren,
  Loader2,
  Mail,
  GraduationCap,
  ShieldCheck,
  AlertCircle,
  Sparkles,
  Eye,
  X,
} from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useMode } from '@/lib/mode-context'
import { ROLE_LABELS } from '@/lib/auth-types'
import { PageHeader, PageTransition, Money } from '@/components/Glass'
import {
  fetchMemberTwin,
  fetchMemberAgent,
  dismissMemberNudge,
  fetchAIResponse,
  inviteFamilyMember,
  type MemberTwin,
  type MemberAgent,
  type AssistantAnswerStatus,
} from '@/lib/api'
import { useToast } from '@/components/Toast'
import { calculateAge } from '@/lib/age'
import { haptic } from '@/lib/haptics'
import { readableHypothesis } from '@/lib/insight-text'

// Minor units → "£1,234" / "£1,234/mo" display strings (Money redacts in
// child-mode, so raw amounts never render unredacted).
function gbp(minor: number): string {
  return `£${Math.round(minor / 100).toLocaleString('en-GB')}`
}
function gbpPerMonth(minor: number): string {
  return `${gbp(minor)}/mo`
}

export default function MemberProfileClient() {
  const memberId = useRouteParam('/member')
  const { family, updateMemberDateOfBirth } = useAuth()
  const { config: modeConfig } = useMode()
  const toast = useToast()
  const [savingDob, setSavingDob] = useState(false)
  const [twin, setTwin] = useState<MemberTwin | null>(null)
  const [agent, setAgent] = useState<MemberAgent | null>(null)
  const [kidView, setKidView] = useState(false)
  const [askInput, setAskInput] = useState('')
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState<{ content: string; status: AssistantAnswerStatus } | null>(
    null,
  )
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteSent, setInviteSent] = useState<{ emailed: boolean; inviteUrl: string } | null>(null)
  const member = family?.members.find((m) => m.id === memberId)

  // PRD-124: a minor's page can render in "kid view" — the API then returns
  // a redacted youth twin (no amounts, no earner/policies/insights). The
  // toggle auto-engages when the whole app is already in Child mode.
  const memberAge = member?.dateOfBirth ? calculateAge(member.dateOfBirth) : null
  const isMinorMember = member?.role === 'child' || (memberAge !== null && memberAge < 18)
  const kidViewActive = isMinorMember && (kidView || modeConfig.mode === 'child')

  // PRD-117: the member twin — their earner slice, attributed policies,
  // education funds, and open insights, all server-assembled on read.
  useEffect(() => {
    if (!memberId) return
    let cancelled = false
    fetchMemberTwin(memberId, kidViewActive ? 'youth' : undefined).then((t) => {
      if (!cancelled) setTwin(t)
    })
    // The agent surface is adult-facing — a child's agent speaks to the
    // family, so it loads in grown-up view only.
    if (!kidViewActive) {
      fetchMemberAgent(memberId).then((a) => {
        if (!cancelled) setAgent(a)
      })
    }
    return () => {
      cancelled = true
    }
  }, [memberId, kidViewActive])

  // PRD-123: the pending member gets a per-person email invite — accepting
  // it activates THIS roster entry (not a duplicate). If SendGrid isn't
  // configured the API still returns the link, so we fall back to copying
  // it for manual sharing rather than a dead "resend" button.
  const sendInvite = async () => {
    if (!member) return
    const email = member.email || inviteEmail.trim()
    if (!email) return
    haptic('light')
    setInviting(true)
    try {
      const res = await inviteFamilyMember(member.id, member.email ? undefined : email)
      haptic('success')
      setInviteSent({ emailed: res.emailed, inviteUrl: res.inviteUrl })
      if (!res.emailed) await navigator.clipboard.writeText(res.inviteUrl).catch(() => {})
      toast({
        message: res.emailed
          ? `Invite emailed to ${email}`
          : 'Invite link copied — send it to them',
      })
    } catch (err) {
      haptic('warning')
      toast({
        message:
          err instanceof Error ? err.message : "Couldn't send the invite — try again in a moment.",
        variant: 'error',
      })
    } finally {
      setInviting(false)
    }
  }

  const askAboutMember = async () => {
    const q = askInput.trim()
    if (!q || asking || !member) return
    haptic('light')
    setAsking(true)
    try {
      setAnswer(await fetchAIResponse(q, member.id, { memberName: member.name }))
      setAskInput('')
    } finally {
      setAsking(false)
    }
  }

  const handleDobChange = async (value: string) => {
    if (!member || !value) return
    setSavingDob(true)
    try {
      await updateMemberDateOfBirth(member.id, value)
      toast({ message: 'Birthday saved' })
    } catch (err) {
      toast({
        message: err instanceof Error ? err.message : "Couldn't save that — try again in a moment.",
        variant: 'error',
      })
    } finally {
      setSavingDob(false)
    }
  }

  // memberId stays undefined until the real URL segment is resolved
  // post-mount (static export — see useRouteParam); show a shimmer rather
  // than a false "not found" for that first render.
  if (memberId === undefined) {
    return (
      <div className="px-5 pt-8 space-y-3">
        <div className="shimmer h-24 rounded-2xl" />
        <div className="shimmer h-24 rounded-2xl" />
      </div>
    )
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
            {member.status === 'pending' && !kidViewActive && (
              <span className="ml-auto text-xs font-semibold text-warning bg-warning/10 px-2 py-1 rounded-full">
                Pending
              </span>
            )}
          </div>
          {isMinorMember && modeConfig.mode !== 'child' && (
            <button
              onClick={() => {
                haptic('light')
                setKidView((v) => !v)
              }}
              className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-family-400"
            >
              {kidView ? <Eye size={14} /> : <Sparkles size={14} />}
              {kidView
                ? 'Back to grown-up view'
                : `Kid view — safe to show ${member.name.split(' ')[0]}`}
            </button>
          )}
        </div>

        {/* PRD-124 kid view — everything below the header swaps out for the
          redacted youth twin. The API already stripped amounts, so nothing
          money-shaped is ever rendered (or fetched) here. */}
        {kidViewActive && twin?.youth && (
          <div className="card space-y-4">
            <div>
              <div className="text-base font-semibold text-ink-primary">
                {twin.youth.age_band === 'teen'
                  ? 'Your savings journey'
                  : `${member.name.split(' ')[0]}'s savings`}
              </div>
              <p className="text-sm text-ink-secondary leading-relaxed mt-1">
                {twin.youth.headline}
              </p>
            </div>
            {twin.youth.savings_goals.map((g, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium text-ink-primary">{g.name}</span>
                  <span className="text-xs text-ink-tertiary">{g.progress_pct}% there</span>
                </div>
                <div className="h-2.5 rounded-full bg-tint/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-family-500"
                    style={{ width: `${g.progress_pct}%` }}
                  />
                </div>
                <p className="text-xs text-ink-tertiary">
                  {g.years_until_goal === 0
                    ? 'Almost there!'
                    : g.years_until_goal === 1
                      ? 'About a year to go'
                      : `About ${g.years_until_goal} years to go`}
                </p>
              </div>
            ))}
            {twin.youth.savings_goals.length === 0 && (
              <p className="text-sm text-ink-tertiary">
                When your family sets a savings goal for you, it&apos;ll show up here.
              </p>
            )}

            {/* PRD-129: age-banded literacy cards — served inside the
              redacted payload, so the band is chosen server-side. */}
            {(twin.youth.lessons?.length ?? 0) > 0 && (
              <div className="space-y-3 pt-2 border-t border-tint/10">
                <div className="text-sm font-semibold text-ink-primary">Things worth knowing</div>
                {twin.youth.lessons.map((l) => (
                  <details key={l.id} className="group rounded-xl bg-tint/[0.03] px-3.5 py-3">
                    <summary className="text-sm font-medium text-ink-primary cursor-pointer list-none flex items-center justify-between gap-2">
                      {l.title}
                      <ChevronRight
                        size={14}
                        className="text-ink-tertiary transition-transform group-open:rotate-90 flex-shrink-0"
                      />
                    </summary>
                    <p className="text-xs text-ink-secondary leading-relaxed mt-2">{l.body}</p>
                    <p className="text-xs text-ink-tertiary leading-relaxed mt-1.5">
                      <span className="font-semibold text-family-400">Try it:</span> {l.try_it}
                    </p>
                  </details>
                ))}
              </div>
            )}

            <p className="text-xs text-ink-tertiary pt-2 border-t border-tint/10">
              Grown-ups take care of bills, insurance, and plans — this part is just for you.
            </p>
          </div>
        )}

        {member.status === 'pending' && member.role !== 'child' && !kidViewActive && (
          <div className="card">
            <div className="text-sm font-semibold text-ink-primary mb-1">
              Finish {member.name.split(' ')[0]}&apos;s setup
            </div>
            <p className="text-xs text-ink-tertiary mb-3">
              They haven&apos;t joined yet. Email them a personal invite — accepting it activates
              this profile so their twin keeps everything already on file.
            </p>
            {!member.email && !inviteSent && (
              <input
                type="email"
                placeholder="Their email address"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                autoComplete="off"
                className="glass-input w-full rounded-xl px-3 py-2.5 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 mb-2"
              />
            )}
            {inviteSent && !inviteSent.emailed ? (
              <div className="rounded-xl bg-tint/[0.04] border border-tint/[0.08] px-3 py-2 text-xs text-ink-secondary break-all">
                {inviteSent.inviteUrl}
              </div>
            ) : (
              <button
                onClick={sendInvite}
                disabled={inviting || (!member.email && !inviteEmail.trim())}
                className="btn-secondary w-full flex items-center justify-center gap-2 disabled:opacity-40"
              >
                {inviting ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
                <span>
                  {inviteSent
                    ? 'Send invite again'
                    : member.email
                      ? `Email invite to ${member.email}`
                      : 'Send invite'}
                </span>
              </button>
            )}
          </div>
        )}

        {/* PRD-126: the member agent's voice — proactive nudges read off
          their twin. A child's agent reports to the adults (guardian
          persona); pending members' nudges are labeled provisional. */}
        {agent && agent.nudges.length > 0 && !kidViewActive && (
          <div className="card space-y-2.5">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-family-400" />
              <div className="text-sm font-semibold text-ink-primary">
                {agent.persona === 'guardian'
                  ? `What ${member.name.split(' ')[0]}'s twin notices`
                  : `What Keel notices about ${member.name.split(' ')[0]}`}
              </div>
              {agent.provisional && (
                <span className="text-[10px] font-semibold text-warning bg-warning/10 px-1.5 py-0.5 rounded-full">
                  provisional
                </span>
              )}
            </div>
            {agent.nudges.map((n) => (
              <div key={n.id} className="flex items-start gap-2.5">
                <span
                  className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    n.kind === 'progress'
                      ? 'bg-success'
                      : n.kind === 'attention'
                        ? 'bg-warning'
                        : 'bg-family-400'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink-primary capitalize">{n.title}</div>
                  {n.detail && (
                    <p className="text-xs text-ink-tertiary leading-relaxed">{n.detail}</p>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={async () => {
                    haptic('light')
                    setAgent((a) =>
                      a ? { ...a, nudges: a.nudges.filter((x) => x.id !== n.id) } : a,
                    )
                    await dismissMemberNudge(member.id, n.id).catch(() => {})
                  }}
                  className="p-1 rounded-lg text-ink-tertiary hover:text-ink-primary hover:bg-surface-hover transition-colors flex-shrink-0"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {!kidViewActive && (
          <div className="card">
            <label className="block">
              <div className="text-sm font-semibold text-ink-primary mb-1">Date of birth</div>
              <p className="text-xs text-ink-tertiary mb-2">
                {member.dateOfBirth
                  ? `${calculateAge(member.dateOfBirth)} years old — used to fill in age fields elsewhere so you don't have to re-type them.`
                  : 'Optional — lets Financial Profile fill in age fields on its own instead of asking.'}
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
                {savingDob && (
                  <Loader2 size={18} className="animate-spin text-ink-tertiary flex-shrink-0" />
                )}
              </div>
            </label>
          </div>
        )}

        {twin?.has_live_data && !kidViewActive && (
          <div className="card space-y-4">
            <div className="text-sm font-semibold text-ink-primary">Their financial picture</div>

            {twin.readiness && (
              <div className="space-y-1.5 pb-3 border-b border-tint/10">
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-bold text-ink-primary">
                    {twin.readiness.score !== null ? twin.readiness.score : '—'}
                  </span>
                  <span className="text-xs text-ink-tertiary">
                    {twin.readiness.score !== null
                      ? 'member readiness /100'
                      : 'no member data to score yet'}
                  </span>
                </div>
                {twin.readiness.components.map((c) => (
                  <p key={c.key} className="text-xs text-ink-secondary leading-relaxed">
                    <span className="font-medium text-ink-primary">{c.label}</span>
                    {c.gated ? ' — restricted' : c.score !== null ? ` — ${c.score}/100` : ''}
                    <span className="text-ink-tertiary"> · {c.detail}</span>
                  </p>
                ))}
              </div>
            )}

            {twin.financial.earner && (
              <div className="flex items-start gap-3">
                <User size={16} className="text-family-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-ink-secondary">
                  <span className="capitalize">
                    {twin.financial.earner.employment_status.replace('_', ' ')}
                  </span>
                  {' — '}
                  <Money value={gbpPerMonth(twin.financial.earner.monthly_salary_minor)} />
                  {twin.financial.earner.income_protection_monthly_minor > 0 && (
                    <span className="text-ink-tertiary">
                      {' '}
                      · income protection{' '}
                      <Money
                        value={gbpPerMonth(twin.financial.earner.income_protection_monthly_minor)}
                      />
                    </span>
                  )}
                  {(twin.financial.earner.monthly_pension_contribution_minor ?? 0) > 0 && (
                    <span className="text-ink-tertiary">
                      {' '}
                      · pension{' '}
                      <Money
                        value={gbpPerMonth(
                          twin.financial.earner.monthly_pension_contribution_minor!,
                        )}
                      />
                    </span>
                  )}
                </div>
              </div>
            )}

            {twin.financial.policies.map((p, i) => (
              <div key={`${p.type}-${i}`} className="flex items-start gap-3">
                <ShieldCheck size={16} className="text-family-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-ink-secondary">
                  <span className="capitalize">{p.type.replace('_', ' ')}</span>
                  {' — '}
                  {p.provider}
                  {p.coverage_amount_minor > 0 && (
                    <span className="text-ink-tertiary">
                      {' '}
                      · cover <Money value={gbp(p.coverage_amount_minor)} />
                    </span>
                  )}
                  {p.renewal_date && (
                    <span className="text-ink-tertiary">
                      {' '}
                      · renews {new Date(p.renewal_date).toLocaleDateString('en-GB')}
                    </span>
                  )}
                </div>
              </div>
            ))}

            {twin.financial.education_funds.map((f, i) => (
              <div key={f.child_name ?? i} className="flex items-start gap-3">
                <GraduationCap size={16} className="text-family-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-ink-secondary">
                  Education fund: <Money value={gbp(f.current_savings_minor)} />
                  {' of '}
                  <Money value={gbp(f.target_savings_minor)} />
                  <span className="text-ink-tertiary">
                    {' '}
                    — needs <Money value={gbpPerMonth(f.needed_monthly_minor)} /> for{' '}
                    {f.years_remaining}y
                  </span>
                </div>
              </div>
            ))}

            {twin.financial.insights.length > 0 && (
              <div className="pt-3 border-t border-tint/10 space-y-1.5">
                <div className="text-xs font-semibold text-ink-tertiary flex items-center gap-1.5">
                  <AlertCircle size={12} /> Open insights about {member.name.split(' ')[0]}
                </div>
                {twin.financial.insights.map((i) => (
                  <p key={String(i.id)} className="text-xs text-ink-secondary leading-relaxed">
                    {typeof i.hypothesis === 'string' ? readableHypothesis(i.hypothesis) : ''}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* PRD-122: member-scoped Ask Keel — the question is grounded on this
          member's twin (their slice, attributed insights, member
          readiness), not the whole household. Hidden in kid view: assistant
          prose can reference figures even though MoneyText redacts them,
          so the surface stays out of reach. */}
        {!kidViewActive && (
          <div className="card space-y-3">
            <div className="text-sm font-semibold text-ink-primary">
              Ask Keel about {member.name.split(' ')[0]}
            </div>
            {answer && (
              <div className="text-sm text-ink-secondary leading-relaxed">
                {answer.status === 'unavailable' ? (
                  <p className="text-xs text-warning">
                    Keel&apos;s assistant is temporarily unavailable — that&apos;s an outage, not a
                    missing answer. Try again in a moment.
                  </p>
                ) : (
                  <>
                    {answer.content}
                    {answer.status === 'canned' && (
                      <p className="text-xs text-ink-tertiary mt-2">
                        Sample answer — connect more of your family&apos;s data for a personalized
                        response.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={askInput}
                onChange={(e) => setAskInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void askAboutMember()
                }}
                placeholder={`e.g. is ${member.name.split(' ')[0]}'s pension on track?`}
                className="glass-input flex-1 rounded-xl px-4 py-3 text-base text-ink-primary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
              />
              <button
                onClick={() => void askAboutMember()}
                disabled={asking || !askInput.trim()}
                className="btn-primary px-4 py-3 flex items-center justify-center disabled:opacity-50"
                aria-label="Ask Keel"
              >
                {asking ? <Loader2 size={16} className="animate-spin" /> : 'Ask'}
              </button>
            </div>
          </div>
        )}

        {!kidViewActive && (
          <Link
            href="/financial-profile"
            className="card flex items-center gap-3 active:opacity-80"
          >
            <div className="flex-1">
              <div className="text-sm font-semibold text-ink-primary">Update financial details</div>
              <p className="text-sm text-ink-tertiary mt-0.5">
                {twin?.has_live_data
                  ? 'Per-member income, protection, and education funds live in the family Financial Profile.'
                  : 'Income, protection, and education funds are collected per-member — add them in the Financial Profile.'}
              </p>
            </div>
            <ChevronRight size={16} className="text-ink-tertiary flex-shrink-0" />
          </Link>
        )}

        {!kidViewActive && (
          <Link
            href="/events"
            className="btn-primary flex items-center justify-center gap-2 w-full"
          >
            <Siren size={18} />
            <span>Simulate Life Event</span>
          </Link>
        )}
      </div>
    </PageTransition>
  )
}
