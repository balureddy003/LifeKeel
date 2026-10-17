'use client'

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Search, Sparkles } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import {
  draftOperatorReply, fetchOperatorSupportCase, fetchOperatorSupportCases,
  replyOperatorCase, resolveOperatorCase, reopenOperatorCase,
  type OperatorCaseDetail, type SupportCase,
} from '@/lib/api'
import { ReasonAction } from '../_components/ReasonAction'
import { Pager } from '../_components/Pager'
import { useHasPermission } from '../_components/OperatorSession'

const PAGE_SIZE = 25
const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'answered', label: 'Answered' },
  { value: 'resolved', label: 'Resolved' },
]

const STATUS_STYLES: Record<SupportCase['status'], string> = {
  open: 'border-warning/30 text-warning',
  answered: 'border-family-500/30 text-family-400',
  resolved: 'border-success/25 text-success',
}

function CaseThread({ id, canManage, onChanged }: { id: string; canManage: boolean; onChanged: () => void }) {
  const toast = useToast()
  const [detail, setDetail] = useState<OperatorCaseDetail | null>(null)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [drafting, setDrafting] = useState(false)

  const load = useCallback(() => {
    fetchOperatorSupportCase(id).then(setDetail).catch(() => setDetail(null))
  }, [id])

  useEffect(() => { load() }, [load])

  if (!detail) return <div className="shimmer mt-3 h-24 rounded-xl" />
  const c = detail.case

  async function send() {
    const text = reply.trim()
    if (!text || sending) return
    setSending(true)
    try {
      await replyOperatorCase(id, text)
      setReply('')
      load()
      onChanged()
      toast({ message: 'Reply sent', variant: 'success' })
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : 'Reply failed', variant: 'error' })
    } finally {
      setSending(false)
    }
  }

  async function draft() {
    setDrafting(true)
    try {
      const { draft } = await draftOperatorReply(id)
      setReply(draft)
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : 'AI draft unavailable', variant: 'error' })
    } finally {
      setDrafting(false)
    }
  }

  return (
    <div className="mt-3 space-y-3 border-t border-tint/[0.06] pt-3">
      {(detail.user || detail.tenant) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-tint/[0.04] px-3 py-2 text-xs text-ink-tertiary">
          {detail.user && <span>Account: {detail.user.email} · status {detail.user.status ?? 'active'}</span>}
          {detail.tenant && <span>Workspace: {detail.tenant.name ?? detail.tenant.tenant_id} · {detail.tenant.plan ?? 'free'} plan</span>}
          <span>{detail.member_count} member{detail.member_count === 1 ? '' : 's'}</span>
          {detail.user && (
            <Link href={`/operator/users/${encodeURIComponent(detail.user.id)}`} className="text-family-400 hover:underline">Full dossier →</Link>
          )}
        </div>
      )}
      {c.messages.map((m) => (
        <div key={m.id} className={`w-fit max-w-[92%] rounded-xl px-3 py-2 ${m.author === 'operator' ? 'ml-auto bg-family-500/15' : m.author === 'keel' ? 'bg-success/10' : 'bg-tint/[0.06]'}`}>
          <p className="text-xs leading-relaxed text-ink-secondary">{m.text}</p>
          <p className="mt-1 text-[10px] text-ink-tertiary">
            {m.author === 'keel' ? 'Keel · AI triage' : m.author === 'operator' ? `${m.author_name ?? 'Operator'} · support` : 'Customer'}
            {' · '}{new Date(m.created_at).toLocaleString()}
          </p>
        </div>
      ))}
      {canManage && c.status !== 'resolved' && (
        <div className="space-y-2 pt-1">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Reply to customer…"
            rows={3}
            className="glass-input w-full rounded-lg px-3 py-2 text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <button onClick={send} disabled={sending || !reply.trim()} className="rounded-lg bg-family-500/15 px-3 py-1.5 text-xs font-semibold text-family-400 disabled:opacity-40">
              {sending ? 'Sending…' : 'Send reply'}
            </button>
            <button onClick={draft} disabled={drafting} className="flex items-center gap-1 rounded-lg border border-tint/[0.1] px-3 py-1.5 text-xs font-medium text-ink-secondary disabled:opacity-40">
              <Sparkles size={12} /> {drafting ? 'Drafting…' : 'Draft with AI'}
            </button>
            <ReasonAction
              label="Resolve"
              onConfirm={async (r) => { await resolveOperatorCase(id, r); toast({ message: 'Case resolved' }); load(); onChanged() }}
            />
          </div>
        </div>
      )}
      {canManage && c.status === 'resolved' && (
        <ReasonAction
          label="Reopen"
          onConfirm={async (r) => { await reopenOperatorCase(id, r); toast({ message: 'Case reopened' }); load(); onChanged() }}
        />
      )}
    </div>
  )
}

export default function OperatorSupportPage() {
  const [cases, setCases] = useState<SupportCase[]>([])
  const [statuses, setStatuses] = useState<Record<string, number>>({})
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [total, setTotal] = useState<number | undefined>(undefined)
  const [cursors, setCursors] = useState<string[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const canManage = useHasPermission('support.manage')

  const load = useCallback(async (q: string, statusFilter: string, cursor?: string) => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchOperatorSupportCases({
        ...(q ? { q } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      })
      setCases(result.cases)
      setTotal(result.total)
      setNextCursor(result.next_cursor)
      setStatuses(result.statuses ?? {})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load cases')
    } finally {
      setLoading(false)
    }
  }, [])

  const currentCursor = cursors[cursors.length - 1]
  useEffect(() => { void load(query.trim(), status, currentCursor) }, [load, cursors, status]) // eslint-disable-line react-hooks/exhaustive-deps

  function onQueryChange(value: string) {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setCursors([])
      void load(value.trim(), status)
    }, 350)
  }

  function search(event: FormEvent) {
    event.preventDefault()
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setCursors([])
    void load(query.trim(), status)
  }

  function goNext() {
    if (nextCursor) setCursors((prev) => [...prev, nextCursor])
  }

  function goPrev() {
    setCursors((prev) => prev.slice(0, -1))
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Support inbox</h1>
      <p className="mt-1 text-sm text-ink-tertiary">
        Cases from the in-app support channel — Keel triages first, so everything here already tried the AI answer.
      </p>
      <form onSubmit={search} className="mt-5 flex gap-2">
        <input value={query} onChange={(e) => onQueryChange(e.target.value)} placeholder="Subject, email or case ID" className="glass-input min-w-0 flex-1 rounded-xl px-4 py-3 text-sm" />
        <button className="rounded-xl bg-family-500 px-4 text-white" aria-label="Search cases"><Search size={18} /></button>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {STATUS_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => { setStatus(option.value); setCursors([]) }}
            className={`rounded-full border px-3 py-1 text-xs ${status === option.value ? 'border-family-500/40 bg-family-500/15 text-family-300' : 'border-tint/[0.08] text-ink-tertiary'}`}
          >
            {option.label}{option.value ? ` (${statuses[option.value] ?? 0})` : ''}
          </button>
        ))}
      </div>
      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      {loading ? <div className="shimmer mt-5 h-32 rounded-2xl" /> : (
        <div className="mt-5 space-y-3">
          {cases.map((c) => (
            <GlassCard key={c.id} className="p-4">
              <button onClick={() => setExpanded(expanded === c.id ? null : c.id)} className="flex w-full items-start justify-between gap-2 text-left">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink-primary">{c.subject}</div>
                  <div className="text-xs text-ink-tertiary">
                    {c.email} · {new Date(c.updated_at).toLocaleString()} · {c.messages.length} message{c.messages.length === 1 ? '' : 's'}
                    {c.ai_triaged ? ' · Keel triaged' : ''}
                  </div>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLES[c.status]}`}>{c.status}</span>
              </button>
              {expanded === c.id && (
                <CaseThread id={c.id} canManage={canManage} onChanged={() => void load(query.trim(), status, currentCursor)} />
              )}
            </GlassCard>
          ))}
          {cases.length === 0 && (
            <GlassCard className="p-4"><p className="text-sm text-ink-secondary">No cases match.</p></GlassCard>
          )}
        </div>
      )}
      <Pager page={cursors.length} count={cases.length} total={total} hasNext={nextCursor !== undefined} onPrev={goPrev} onNext={goNext} loading={loading} />
    </div>
  )
}
