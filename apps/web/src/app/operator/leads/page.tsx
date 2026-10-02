'use client'

import { FormEvent, useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import {
  fetchOperatorLeads, fetchOperatorLead, updateOperatorLead, suppressOperatorLead,
  type LeadStage, type OperatorLead,
} from '@/lib/api'
import { ReasonAction } from '../_components/ReasonAction'
import { Pager } from '../_components/Pager'

const STAGES: LeadStage[] = ['new', 'qualified', 'contacted', 'trial', 'converted', 'lost']
const PAGE_SIZE = 25

type LeadDetail = OperatorLead & { attribution?: Record<string, string> }

function LeadDetailPanel({ lead, onSaved }: { lead: OperatorLead; onSaved: (lead: LeadDetail) => void }) {
  const toast = useToast()
  const [detail, setDetail] = useState<LeadDetail | null>(null)
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchOperatorLead(lead.id).then((r) => setDetail(r.lead)).catch(() => setDetail(lead))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id])

  if (!detail) return <div className="shimmer mt-3 h-16 rounded-xl" />
  const attribution = detail.attribution ?? {}

  return (
    <div className="mt-3 space-y-3 border-t border-tint/[0.06] pt-3 text-xs">
      <div className="grid gap-x-6 gap-y-1 text-ink-secondary sm:grid-cols-2">
        <span>Consent: {detail.consent?.marketing ? 'marketing ✓' : 'none'}{detail.consent?.captured_at ? ` · ${new Date(detail.consent.captured_at).toLocaleDateString()}` : ''}</span>
        <span>ID: <code>{detail.id}</code></span>
        {attribution.utm_source && <span>utm_source: {attribution.utm_source}</span>}
        {attribution.utm_campaign && <span>utm_campaign: {attribution.utm_campaign}</span>}
        {attribution.referrer && <span className="truncate">referrer: {attribution.referrer}</span>}
        {attribution.landing_path && <span>landing: {attribution.landing_path}</span>}
      </div>
      {detail.notes.length > 0 && (
        <div className="space-y-1">
          {detail.notes.map((n, i) => (
            <p key={i} className="text-ink-secondary">{n.text} <span className="text-ink-tertiary">— {n.author_id ?? 'operator'}, {new Date(n.created_at).toLocaleDateString()}</span></p>
          ))}
        </div>
      )}
      <div className="space-y-2">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (visible to operators only)" rows={2} className="glass-input w-full rounded-lg px-3 py-2" />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required, audited)" className="glass-input w-full rounded-lg px-3 py-2" />
        {error && <p className="text-danger">{error}</p>}
        <button
          disabled={busy || note.trim().length === 0 || reason.trim().length < 5}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              const updated = await updateOperatorLead(lead.id, { note: note.trim() }, reason.trim())
              onSaved(updated)
              setDetail(updated)
              setNote('')
              setReason('')
              toast({ message: 'Note added' })
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not add note')
            } finally {
              setBusy(false)
            }
          }}
          className="rounded-lg bg-family-500/15 px-3 py-1.5 font-semibold text-family-400 disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Add note'}
        </button>
      </div>
    </div>
  )
}

export default function OperatorLeadsPage() {
  const toast = useToast()
  const [leads, setLeads] = useState<OperatorLead[]>([])
  const [stages, setStages] = useState<Record<string, number>>({})
  const [sources, setSources] = useState<Record<string, number>>({})
  const [query, setQuery] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [suppressedOnly, setSuppressedOnly] = useState(false)
  const [total, setTotal] = useState<number | undefined>(undefined)
  // Cursor stack — cursors[i] fetched page i+1; Prev pops, Next pushes.
  const [cursors, setCursors] = useState<string[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const currentCursor = cursors[cursors.length - 1]

  async function load(q = '', stage = '', source = '', suppressed = false, cursor?: string) {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchOperatorLeads({
        ...(q ? { q } : {}),
        ...(stage ? { stage } : {}),
        ...(source ? { source } : {}),
        ...(suppressed ? { suppressed: 'true' as const } : {}),
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      })
      setLeads(result.leads)
      setTotal(result.total)
      setNextCursor(result.next_cursor)
      setStages(result.stages)
      setSources(result.sources ?? {})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load leads')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])  

  function resetToFirstPage(q = query.trim(), stage = stageFilter, source = sourceFilter, suppressed = suppressedOnly) {
    setCursors([])
    void load(q, stage, source, suppressed)
  }

  function search(event: FormEvent) {
    event.preventDefault()
    resetToFirstPage()
  }

  async function moveStage(lead: OperatorLead, stage: LeadStage, reason: string) {
    const updated = await updateOperatorLead(lead.id, { stage }, reason)
    toast({ message: `Moved to ${stage}` })
    // A stage move under an active filter can remove the lead from view, and
    // stage counts change — reload rather than patching the row in place.
    if (stageFilter) await load(query.trim(), stageFilter, sourceFilter, suppressedOnly, currentCursor)
    else setLeads((current) => current.map((l) => (l.id === lead.id ? updated : l)))
  }

  function goNext() {
    if (!nextCursor) return
    setCursors((prev) => [...prev, nextCursor])
    void load(query.trim(), stageFilter, sourceFilter, suppressedOnly, nextCursor)
  }

  function goPrev() {
    const next = cursors.slice(0, -1)
    setCursors(next)
    void load(query.trim(), stageFilter, sourceFilter, suppressedOnly, next[next.length - 1])
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Leads</h1>
      <p className="mt-1 text-sm text-ink-tertiary">
        Opted-in contacts from the readiness quiz and landing pages. Suppressed leads are never contacted.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => { setStageFilter(''); resetToFirstPage(query.trim(), '', sourceFilter, suppressedOnly) }}
          className={`rounded-full border px-3 py-1 text-xs ${!stageFilter ? 'border-family-500/30 text-family-400' : 'border-tint/[0.08] text-ink-tertiary'}`}
        >
          All ({Object.values(stages).reduce((a, b) => a + b, 0)})
        </button>
        {STAGES.map((stage) => (
          <button
            key={stage}
            onClick={() => { setStageFilter(stage); resetToFirstPage(query.trim(), stage, sourceFilter, suppressedOnly) }}
            className={`rounded-full border px-3 py-1 text-xs ${stageFilter === stage ? 'border-family-500/30 text-family-400' : 'border-tint/[0.08] text-ink-tertiary'}`}
          >
            {stage} ({stages[stage] ?? 0})
          </button>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {Object.keys(sources).length > 1 && (
          <select
            value={sourceFilter}
            onChange={(e) => { setSourceFilter(e.target.value); resetToFirstPage(query.trim(), stageFilter, e.target.value, suppressedOnly) }}
            className="glass-input rounded-lg px-2 py-1 text-xs text-ink-secondary"
            aria-label="Filter by source"
          >
            <option value="">All sources</option>
            {Object.entries(sources).map(([source, count]) => (
              <option key={source} value={source}>{source} ({count})</option>
            ))}
          </select>
        )}
        <button
          onClick={() => { const next = !suppressedOnly; setSuppressedOnly(next); resetToFirstPage(query.trim(), stageFilter, sourceFilter, next) }}
          className={`rounded-full border px-3 py-1 text-xs ${suppressedOnly ? 'border-danger/40 bg-danger/10 text-danger' : 'border-tint/[0.08] text-ink-tertiary'}`}
        >
          Suppressed only
        </button>
      </div>

      <form onSubmit={search} className="mt-4 flex gap-2">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Email, name or lead ID" className="glass-input min-w-0 flex-1 rounded-xl px-4 py-3 text-sm" />
        <button className="rounded-xl bg-family-500 px-4 text-white" aria-label="Search leads"><Search size={18} /></button>
      </form>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      {loading ? <div className="shimmer mt-5 h-32 rounded-2xl" /> : (
        <div className="mt-5 space-y-3">
          <p className="text-xs text-ink-tertiary">{total !== undefined ? `${total} leads` : `${leads.length} shown`}</p>
          {leads.map((lead) => (
            <GlassCard key={lead.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{lead.name ?? lead.email}</div>
                  {lead.name && <div className="text-sm text-ink-secondary">{lead.email}</div>}
                </div>
                <div className="flex gap-2">
                  <span className="rounded-full border border-family-500/25 px-2 py-0.5 text-xs text-family-400">{lead.stage}</span>
                  {lead.suppressed && <span className="rounded-full border border-danger/25 px-2 py-0.5 text-xs text-danger">suppressed</span>}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-tertiary">
                <span>Source: {lead.source}</span>
                {lead.score_band && <span>Score band: {lead.score_band}</span>}
                <span>Captured: {new Date(lead.created_at).toLocaleDateString()}</span>
              </div>
              {lead.notes.length > 0 && expanded !== lead.id && (
                <div className="mt-3 space-y-1 border-t border-tint/[0.06] pt-2">
                  {lead.notes.map((note, i) => (
                    <p key={i} className="text-xs text-ink-secondary">
                      {note.text} <span className="text-ink-tertiary">— {new Date(note.created_at).toLocaleDateString()}</span>
                    </p>
                  ))}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => setExpanded(expanded === lead.id ? null : lead.id)}
                  className="rounded-lg border border-tint/[0.1] px-3 py-1.5 text-xs font-medium text-ink-secondary hover:text-ink-primary"
                >
                  {expanded === lead.id ? 'Close' : 'Details'}
                </button>
                {STAGES.filter((s) => s !== lead.stage).map((stage) => (
                  <ReasonAction
                    key={stage}
                    label={`→ ${stage}`}
                    onConfirm={async (r) => { await moveStage(lead, stage, r) }}
                  />
                ))}
                {!lead.suppressed && (
                  <ReasonAction
                    label="Suppress"
                    destructive
                    onConfirm={async (r) => { await suppressOperatorLead(lead.id, r); toast({ message: 'Lead suppressed' }); await load(query.trim(), stageFilter, sourceFilter, suppressedOnly, currentCursor) }}
                  />
                )}
              </div>
              {expanded === lead.id && (
                <LeadDetailPanel
                  lead={lead}
                  onSaved={(updated) => setLeads((current) => current.map((l) => (l.id === lead.id ? updated : l)))}
                />
              )}
            </GlassCard>
          ))}
          {leads.length === 0 && (
            <GlassCard className="p-4"><p className="text-sm text-ink-secondary">No leads match.</p></GlassCard>
          )}
        </div>
      )}
      <Pager page={cursors.length} count={leads.length} total={total} hasNext={nextCursor !== undefined} onPrev={goPrev} onNext={goNext} loading={loading} />
    </div>
  )
}
