'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Mail, MessageCircle, Send, Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/Glass'
import { EmergencyNumberText } from '@/components/EmergencyNumberText'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/Toast'
import {
  askSupport, createSupportCase, fetchMySupportCases, fetchMySupportCase, replyToMyCase,
  type SupportCase,
} from '@/lib/api'

// Set NEXT_PUBLIC_SUPPORT_EMAIL to a real, monitored inbox to make this a
// live mailto: link — kept as a fallback channel alongside the in-app
// support channel below.
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? ''

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold text-ink-primary mt-7 mb-2.5">{children}</h2>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-secondary leading-relaxed mb-3">{children}</p>
}

interface TriageTurn {
  question: string
  answer: string
  isLive: boolean
}

/** Oak triage — the user asks; Oak answers grounded in their account state.
 *  Only "still need help" creates a human-visible case, carrying the triage
 *  transcript so the operator sees what was already tried. */
function AskOak({ onCaseCreated }: { onCaseCreated: (c: SupportCase) => void }) {
  const toast = useToast()
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<TriageTurn[]>([])
  const [asking, setAsking] = useState(false)
  const [escalating, setEscalating] = useState(false)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function ask(event: FormEvent) {
    event.preventDefault()
    const q = question.trim()
    if (!q || asking) return
    setAsking(true)
    setError(null)
    try {
      const res = await askSupport(q)
      setTurns((t) => [...t, { question: q, answer: res.answer, isLive: res.isLive }])
      setQuestion('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach support')
    } finally {
      setAsking(false)
    }
  }

  async function escalate(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const created = await createSupportCase(subject.trim(), message.trim(), turns.map((t) => ({ question: t.question, answer: t.answer })))
      toast({ message: 'Case opened — the team will reply here', variant: 'success' })
      onCaseCreated(created.case)
      setEscalating(false)
      setTurns([])
      setSubject('')
      setMessage('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open case')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-2xl border border-tint/[0.08] bg-tint/[0.03] p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={16} className="text-family-400" />
        <span className="text-sm font-semibold text-ink-primary">Ask Oak first</span>
      </div>
      <p className="text-xs text-ink-tertiary mb-3 leading-relaxed">
        Most questions are answered instantly. If Oak can&apos;t resolve it, escalate to a human — the conversation is carried over so you never re-explain.
      </p>

      {turns.map((turn, i) => (
        <div key={i} className="mb-3 space-y-2">
          <p className="ml-auto w-fit max-w-[85%] rounded-xl bg-family-500/15 px-3 py-2 text-xs text-ink-primary">{turn.question}</p>
          <div className="w-fit max-w-[90%] rounded-xl bg-tint/[0.06] px-3 py-2">
            <p className="text-xs leading-relaxed text-ink-secondary">{turn.answer}</p>
            {!turn.isLive && <p className="mt-1 text-[10px] text-ink-tertiary">offline answer — may be incomplete</p>}
          </div>
        </div>
      ))}
      {asking && <p className="mb-3 text-xs text-ink-tertiary">Oak is thinking…</p>}

      {turns.length > 0 && !escalating && (
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs text-ink-tertiary">Did that help?</span>
          <button onClick={() => setTurns([])} className="rounded-full border border-success/25 px-3 py-1 text-xs text-success">Yes, solved</button>
          <button onClick={() => setEscalating(true)} className="rounded-full border border-tint/[0.1] px-3 py-1 text-xs text-ink-secondary">
            Still need a human
          </button>
        </div>
      )}

      {escalating ? (
        <form onSubmit={escalate} className="space-y-2">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject — what's this about?"
            className="glass-input w-full rounded-lg px-3 py-2 text-sm"
            required
            minLength={3}
          />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe what you need — include anything Oak missed."
            rows={3}
            className="glass-input w-full rounded-lg px-3 py-2 text-sm"
            required
          />
          <div className="flex gap-2">
            <button disabled={submitting || subject.trim().length < 3 || !message.trim()} className="rounded-lg bg-family-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">
              {submitting ? 'Opening…' : 'Open a support case'}
            </button>
            <button type="button" onClick={() => setEscalating(false)} className="rounded-lg border border-tint/[0.08] px-3 py-2 text-xs text-ink-tertiary">Back</button>
          </div>
        </form>
      ) : (
        <form onSubmit={ask} className="flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="How do I…? / Why does…?"
            className="glass-input min-w-0 flex-1 rounded-xl px-4 py-2.5 text-sm"
          />
          <button disabled={asking || !question.trim()} className="rounded-xl bg-family-500 px-4 text-white disabled:opacity-40" aria-label="Ask Oak">
            <Send size={16} />
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}

const CASE_STATUS_STYLES: Record<SupportCase['status'], string> = {
  open: 'border-warning/30 text-warning',
  answered: 'border-family-500/30 text-family-400',
  resolved: 'border-success/25 text-success',
}

function CaseCard({ c, onUpdated }: { c: SupportCase; onUpdated: (c: SupportCase) => void }) {
  const toast = useToast()
  const [expanded, setExpanded] = useState(false)
  const [detail, setDetail] = useState<SupportCase | null>(null)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!expanded) return
    fetchMySupportCase(c.id).then((r) => setDetail(r.case)).catch(() => setDetail(c))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, c.id])

  async function send() {
    const text = reply.trim()
    if (!text || sending) return
    setSending(true)
    try {
      await replyToMyCase(c.id, text)
      const fresh = await fetchMySupportCase(c.id)
      setDetail(fresh.case)
      onUpdated(fresh.case)
      setReply('')
      toast({ message: 'Reply sent' })
    } catch {
      toast({ message: 'Could not send reply', variant: 'error' })
    } finally {
      setSending(false)
    }
  }

  const shown = detail ?? c
  return (
    <div className="rounded-2xl border border-tint/[0.08] p-4">
      <button onClick={() => setExpanded(!expanded)} className="flex w-full items-start justify-between gap-2 text-left">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink-primary truncate">{c.subject}</div>
          <div className="text-xs text-ink-tertiary">
            {new Date(c.updated_at).toLocaleDateString()} · {c.messages.length} message{c.messages.length === 1 ? '' : 's'}
            {c.ai_triaged ? ' · started with Oak' : ''}
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${CASE_STATUS_STYLES[c.status]}`}>{c.status}</span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-tint/[0.06] pt-3">
          {shown.messages.map((m) => (
            <div key={m.id} className={`w-fit max-w-[90%] rounded-xl px-3 py-2 ${m.author === 'user' ? 'ml-auto bg-family-500/15' : 'bg-tint/[0.06]'}`}>
              <p className="text-xs leading-relaxed text-ink-secondary">{m.text}</p>
              <p className="mt-1 text-[10px] text-ink-tertiary">
                {m.author === 'oak' ? 'Oak · AI' : m.author === 'operator' ? `${m.author_name ?? 'Operator'} · support team` : 'You'}
                {' · '}{new Date(m.created_at).toLocaleString()}
              </p>
            </div>
          ))}
          {shown.status === 'resolved' && (
            <p className="text-[11px] text-ink-tertiary">Resolved — send a reply to reopen if you still need help.</p>
          )}
          <div className="flex gap-2 pt-1">
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={shown.status === 'resolved' ? 'Reply to reopen…' : 'Reply…'}
              className="glass-input min-w-0 flex-1 rounded-lg px-3 py-2 text-xs"
            />
            <button onClick={send} disabled={sending || !reply.trim()} className="rounded-lg bg-family-500/15 px-3 text-xs font-semibold text-family-400 disabled:opacity-40">
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SupportPage() {
  const { user } = useAuth()
  const [cases, setCases] = useState<SupportCase[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    fetchMySupportCases()
      .then((r) => setCases(r.cases))
      .catch(() => setCases([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { if (user) load() }, [user, load])

  return (
    <div className="px-5 pt-2 pb-12">
      <PageHeader title="Support" backHref="/settings" />

      {user ? (
        <>
          <AskOak onCaseCreated={(c) => setCases((prev) => [c, ...prev])} />

          {(loading || cases.length > 0) && (
            <>
              <H2>Your cases</H2>
              {loading ? (
                <div className="shimmer h-20 rounded-2xl" />
              ) : (
                <div className="space-y-2">
                  {cases.map((c) => (
                    <CaseCard key={c.id} c={c} onUpdated={(updated) => setCases((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))} />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <div className="rounded-2xl border border-tint/[0.08] bg-tint/[0.03] p-4 mb-6 flex items-start gap-2.5">
          <MessageCircle size={16} className="text-family-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-ink-secondary leading-relaxed">
            Sign in to chat with Oak and open a support case — the conversation stays in-app so you never re-explain.
          </p>
        </div>
      )}

      {SUPPORT_EMAIL && (
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="rounded-2xl bg-family-500/10 border border-family-500/20 px-4 py-3.5 flex items-center gap-3 mb-6 active:opacity-80"
        >
          <Mail size={18} className="text-family-400 flex-shrink-0" />
          <span className="text-sm font-medium text-family-400">{SUPPORT_EMAIL}</span>
        </a>
      )}

      <H2>Account or billing questions</H2>
      <P>
        For anything about your account, an Oak Plus subscription, or a charge you don&apos;t recognize, open a
        case above — it lands in the operator inbox with your account context attached.
      </P>

      <H2>Reporting a security issue</H2>
      <P>
        If you&apos;ve found a security vulnerability, please open a case marked &quot;security&quot; or contact us
        directly rather than filing a public issue — we&apos;ll acknowledge the report and follow up on next steps.
      </P>

      <H2>Data and privacy requests</H2>
      <P>
        To delete your account and associated data, or to exercise any other right described in the{' '}
        <a href="/privacy" className="text-family-400 font-medium">Privacy Policy</a>, open a case marked
        &quot;privacy&quot; — erasure requests are handled by an operator with an audited workflow.
      </P>

      <H2>In a real emergency</H2>
      <P>
        Agent Oak is not emergency services and can&apos;t dispatch help. If you&apos;re in immediate danger, call{' '}
        <EmergencyNumberText /> first.
      </P>
    </div>
  )
}
