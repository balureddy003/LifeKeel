'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { GlassCard, PageHeader, Skeleton } from '@/components/Glass'
import {
  addDomainRecord,
  confirmDomain,
  deleteDomainRecord,
  getDomains,
  getDomainPlaybook,
  getDomainView,
  type DomainPackInfo,
  type DomainPlaybook,
  type DomainView,
} from '@/lib/api'
import { haptic } from '@/lib/haptics'
import { useToast } from '@/components/Toast'
import { AddRecordForm } from './AddRecordForm'
import { SentenceCapture } from './SentenceCapture'
import { RecordList } from './RecordList'
import { adapterSources, cellText, confirmSummary, daysText, rowLabel } from './domain-copy'

const primaryBtn =
  'inline-flex min-h-[48px] items-center justify-center rounded-full bg-family-500 px-5 text-base font-semibold text-white disabled:opacity-50'

export default function DomainsPage() {
  const [id, setId] = useState<string | null | undefined>(undefined)
  const [packs, setPacks] = useState<DomainPackInfo[] | null>(null)
  const [view, setView] = useState<DomainView | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([])
  const [pb, setPb] = useState<DomainPlaybook | null | undefined>(undefined)
  const toast = useToast()
  const statusRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get('d'))
  }, [])
  useEffect(() => {
    if (id === undefined) return
    if (id) void getDomainView(id).then(setView)
    else void getDomains().then((d) => setPacks(d.domains))
  }, [id])

  useEffect(() => {
    if (view) setPeople(view.roster)
  }, [view])

  async function openPlaybook(memberId: string) {
    if (!id) return
    setPb(undefined)
    setPb(await getDomainPlaybook(id, memberId))
  }

  async function add(record: string, holder: string | null, values: Record<string, string>) {
    if (!id) return false
    setBusy(true)
    const res = await addDomainRecord(id, record, { holder_member_id: holder, values })
    setBusy(false)
    if (!res.ok) {
      toast({
        message:
          (res.data as { error?: string } | undefined)?.error ?? 'Could not save. Try again.',
        variant: 'error',
      })
      return false
    }
    haptic('success')
    setView(await getDomainView(id))
    return true
  }

  async function remove(rowId: string) {
    if (!id) return
    const res = await deleteDomainRecord(id, rowId)
    if (!res.ok) {
      toast({ message: 'Could not remove. Try again.', variant: 'error' })
      return
    }
    haptic('warning')
    setView(await getDomainView(id))
    // The row and its buttons are gone; hand focus to the line saying who has seen the new version.
    requestAnimationFrame(() => statusRef.current?.focus())
  }

  async function confirm() {
    if (!view || !id) return
    setBusy(true)
    const res = await confirmDomain(id, view.result_version)
    setBusy(false)
    if (!res.ok) {
      toast({
        message:
          (res.data as { error?: string } | undefined)?.error ?? 'Could not confirm. Try again.',
        variant: 'error',
      })
      // A stale version means someone edited it: show the current one.
      if (res.status === 409) setView(await getDomainView(id))
      return
    }
    haptic('success')
    toast({ message: 'Confirmed' })
    setView(res.data)
    // The button that had focus is gone; hand focus to the confirmation line.
    requestAnimationFrame(() => statusRef.current?.focus())
  }

  function retry() {
    if (!id) return
    setView(undefined)
    void getDomainView(id).then(setView)
  }

  if (id === undefined) return <main className="mx-auto max-w-2xl px-4 pb-16" />

  if (!id) {
    return (
      <main className="mx-auto max-w-2xl px-4 pb-16">
        <PageHeader
          title="What is on the family list"
          subtitle="Each area of family life, in one place."
        />
        {!packs ? (
          <Skeleton className="mt-6 h-20 w-full" />
        ) : (
          <div className="mt-6 space-y-3">
            {packs.map((p) => (
              <a key={p.id} href={`/domains?d=${p.id}`} className="block">
                <GlassCard className="p-4" interactive>
                  <p className="font-medium text-ink-primary">{p.title}</p>
                  <p className="mt-1 text-sm text-ink-secondary">{p.summary}</p>
                </GlassCard>
              </a>
            ))}
          </div>
        )}
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16">
      <PageHeader
        title={view?.pack.title ?? 'What is on the family list'}
        subtitle={view?.pack.summary ?? 'Each area of family life, in one place.'}
      />
      {view === undefined && (
        <div className="mt-6 space-y-3" role="status" aria-label="Loading">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}
      {view === null && (
        <GlassCard className="mt-6 p-5">
          <p className="text-ink-secondary">
            This could not be loaded. Only adults in the family can see it.
          </p>
          <button type="button" onClick={retry} className={`${primaryBtn} mt-4`}>
            Try again
          </button>
        </GlassCard>
      )}
      {view && (
        <>
          {!view.can_edit && (
            <p className="mt-4 text-sm text-ink-secondary">
              You can look at this and confirm it. This account cannot add or remove what is on the
              family list. The organizer can change that in Settings, under Family.
            </p>
          )}
          {(view.absent ?? []).length > 0 && (
            <ul className="mt-4 space-y-1 text-base text-ink-secondary">
              {(view.absent ?? []).map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          {view.matrix && view.matrix.rows.length > 0 ? (
            <GlassCard className="mt-6 p-0">
              <div
                role="region"
                aria-label={view.matrix.label}
                tabIndex={0}
                className="overflow-x-auto rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-family-500"
              >
                <table className="w-full min-w-[520px] text-left text-sm">
                  <caption className="sr-only">{view.matrix.label}</caption>
                  <thead>
                    <tr className="border-b border-haze text-ink-tertiary">
                      <th scope="col" className="min-w-[10rem] break-normal p-3 font-medium">
                        Policy
                      </th>
                      {view.matrix.columns.map((c) => (
                        <th key={c.id} scope="col" className="p-3 font-medium">
                          {c.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {view.matrix.rows.map((r) => (
                      <tr key={r.id} className="border-b border-haze last:border-0">
                        <th
                          scope="row"
                          className="sticky left-0 min-w-[10rem] break-normal bg-surface-1 p-3 font-medium text-ink-primary"
                        >
                          {r.label}
                        </th>
                        {view.matrix!.columns.map((c) => (
                          <td
                            key={c.id}
                            className="whitespace-nowrap break-normal p-3 text-ink-secondary"
                          >
                            {cellText(r.cells[c.id] ?? null)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassCard>
          ) : view.rows.length === 0 ? (
            <GlassCard className="mt-6 p-5">
              <p className="text-ink-secondary">
                Nothing on the family list yet.
                {view.can_edit && ' Add the first one below.'}
              </p>
            </GlassCard>
          ) : (
            <RecordList view={view} onRemove={remove} />
          )}

          {view.rows.length > 0 && adapterSources(view.pack).length > 0 && (
            <p className="mt-4 text-sm text-ink-secondary">
              Some of this comes from your{' '}
              {adapterSources(view.pack).map((s, i, all) => (
                <span key={s.href}>
                  <Link href={s.href} className="underline">
                    {s.label}
                  </Link>
                  {i < all.length - 1 ? ' and ' : ''}
                </span>
              ))}
              . Change it there.
            </p>
          )}

          <SentenceCapture view={view} busy={busy} onAdd={add} />
          <AddRecordForm view={view} busy={busy} onAdd={add} />

          {view.can_edit && (
            <Link href="/upload" className="mt-4 block">
              <GlassCard className="p-4" interactive>
                <span className="inline-flex min-h-[48px] items-center text-base font-medium text-ink-primary">
                  Photograph a letter or policy
                </span>
                <p className="text-sm text-ink-secondary">
                  Take a photo or choose a file. Nothing is added to the family list until you
                  confirm it.
                </p>
              </GlassCard>
            </Link>
          )}

          {view.gaps.length > 0 && (
            <GlassCard className="mt-4 p-5">
              <h2 className="font-medium text-ink-primary">To check</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-secondary">
                {view.gaps.map((g, i) => {
                  const row = view.rows.find((r) => r.id === g.row_id)
                  const label = row ? rowLabel(view.pack, row) : undefined
                  return (
                    <li key={`${g.row_id}-${i}`}>
                      {label ? `${label}: ` : ''}
                      {g.note}
                    </li>
                  )
                })}
              </ul>
            </GlassCard>
          )}

          {view.upcoming.length > 0 && (
            <GlassCard className="mt-4 p-5">
              <h2 className="font-medium text-ink-primary">Coming up</h2>
              <ul className="mt-2 space-y-1 text-sm text-ink-secondary">
                {view.upcoming.map((u) => (
                  <li key={`${u.trigger}-${u.row_id}`}>
                    {u.row_label}: {u.label}, {daysText(u.days)} ({u.date})
                  </li>
                ))}
              </ul>
            </GlassCard>
          )}

          <GlassCard className="mt-4 p-5">
            <p className="flex items-start gap-2 text-ink-primary">
              {view.confirmation.both_confirmed && (
                <CheckCircle2
                  size={20}
                  className="mt-0.5 shrink-0 text-success"
                  aria-hidden="true"
                />
              )}
              <span
                role="status"
                ref={statusRef}
                tabIndex={-1}
                className="focus:outline-none focus-visible:ring-2 focus-visible:ring-family-500"
              >
                {confirmSummary(view.confirmation)}
              </span>
            </p>
            {!view.confirmation.viewer_confirmed && view.rows.length > 0 && (
              <button
                type="button"
                onClick={confirm}
                disabled={busy}
                className={`${primaryBtn} mt-4`}
              >
                I have seen this
              </button>
            )}
          </GlassCard>
          {view.rows.length > 0 && view.pack.playbook && people.length > 0 && (
            <GlassCard className="mt-4 p-5">
              <h2 className="font-medium text-ink-primary">{view.pack.playbook.label}</h2>
              <p className="mt-1 text-sm text-ink-secondary">
                Pick a person to see only the records that matter for them.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {people.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => openPlaybook(p.id)}
                    aria-pressed={pb?.member.id === p.id}
                    className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-full border border-haze px-4 text-base font-medium text-ink-primary aria-pressed:bg-family-500 aria-pressed:text-white"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
              {pb === null && (
                <p className="mt-3 text-sm text-ink-secondary">This could not be loaded.</p>
              )}
              {pb && (
                <div className="mt-4 space-y-4">
                  {pb.groups.length === 0 && (
                    <p className="text-sm text-ink-secondary">
                      Nothing on the family list for {pb.member.name}.
                    </p>
                  )}
                  {pb.groups.map((g) => (
                    <section key={g.key}>
                      <h3 className="text-sm font-medium text-ink-primary">{g.label}</h3>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-secondary">
                        {g.rows.map((r) => (
                          <li key={r.id}>
                            {r.label}
                            {r.claims_contact ? ` · claims contact: ${r.claims_contact}` : ''}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                  <p className="text-sm text-ink-secondary">
                    Each provider is contacted by you. The full list of first steps is under{' '}
                    <Link href="/life-events" className="underline">
                      life events
                    </Link>
                    .
                  </p>
                </div>
              )}
            </GlassCard>
          )}
        </>
      )}
    </main>
  )
}
