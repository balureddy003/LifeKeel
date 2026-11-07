'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { GlassCard, PageHeader, Skeleton } from '@/components/Glass'
import {
  confirmDomain,
  getDomains,
  getDomainPlaybook,
  getDomainView,
  type DomainPackInfo,
  type DomainPlaybook,
  type DomainView,
} from '@/lib/api'
import { haptic } from '@/lib/haptics'
import { useToast } from '@/components/Toast'
import { cellText, confirmSummary, daysText } from './domain-copy'

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

  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get('d'))
  }, [])
  useEffect(() => {
    if (id === undefined) return
    if (id) void getDomainView(id).then(setView)
    else void getDomains().then((d) => setPacks(d.domains))
  }, [id])

  useEffect(() => {
    if (view) setPeople(view.matrix?.columns ?? [])
  }, [view])

  async function openPlaybook(memberId: string) {
    if (!id) return
    setPb(undefined)
    setPb(await getDomainPlaybook(id, memberId))
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
  }

  if (id === undefined) return <main className="mx-auto max-w-2xl px-4 pb-16" />

  if (!id) {
    return (
      <main className="mx-auto max-w-2xl px-4 pb-16">
        <PageHeader title="What is on file" subtitle="Each area of family life, in one place." />
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
        title="Who is covered"
        subtitle="Which policies are on file, who holds each one and who it covers."
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
            This could not be loaded. Only adults on the family list can see it.
          </p>
        </GlassCard>
      )}
      {view && (
        <>
          {!view.matrix || view.matrix.rows.length === 0 ? (
            <GlassCard className="mt-6 p-5">
              <p className="text-ink-secondary">
                Nothing on file yet. Add policies in your{' '}
                <Link href="/financial-profile" className="underline">
                  financial profile
                </Link>{' '}
                and they appear here.
              </p>
            </GlassCard>
          ) : (
            <GlassCard className="mt-6 overflow-x-auto p-0">
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
                        className="min-w-[10rem] break-normal p-3 font-medium text-ink-primary"
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
            </GlassCard>
          )}

          {view.gaps.length > 0 && (
            <GlassCard className="mt-4 p-5">
              <h2 className="font-medium text-ink-primary">To check</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-secondary">
                {view.gaps.map((g, i) => {
                  const label = view.matrix?.rows.find((r) => r.id === g.row_id)?.label
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
                    {u.row_label}: {u.label.toLowerCase()}, {daysText(u.days)} ({u.date})
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
              <span role="status">{confirmSummary(view.confirmation)}</span>
            </p>
            {!view.confirmation.viewer_confirmed && view.matrix && view.matrix.rows.length > 0 && (
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
          {view.matrix && view.matrix.rows.length > 0 && people.length > 0 && (
            <GlassCard className="mt-4 p-5">
              <h2 className="font-medium text-ink-primary">If someone dies: what is on file</h2>
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
                    className="inline-flex min-h-[40px] items-center rounded-full border border-haze px-4 text-sm font-medium text-ink-primary aria-pressed:bg-family-500 aria-pressed:text-white"
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
                      Nothing on file for {pb.member.name}.
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
