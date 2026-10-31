'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { FileText, Printer } from 'lucide-react'
import { GlassCard, PageHeader, Skeleton } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import { assembleClaimPacket, fetchFinancialProfile, type ClaimPacket } from '@/lib/api'
import { haptic } from '@/lib/haptics'

const ghostBtn =
  'inline-flex min-h-[40px] items-center gap-2 rounded-full border border-haze px-4 text-sm font-medium text-ink-primary'

export default function ClaimPacketPage() {
  const [lifePolicies, setLifePolicies] = useState<Array<{
    ref: string | number
    provider: string
  }> | null>(null)
  const [packet, setPacket] = useState<ClaimPacket | null>(null)
  const [busy, setBusy] = useState<string | number | null>(null)
  const toast = useToast()

  useEffect(() => {
    void fetchFinancialProfile().then((p) => {
      setLifePolicies(
        (p?.policies ?? [])
          .map((pol, i) => ({ ref: pol.id ?? i, type: pol.type, provider: pol.provider }))
          .filter((x) => x.type === 'life')
          .map(({ ref, provider }) => ({ ref, provider })),
      )
    })
  }, [])

  async function prepare(ref: string | number) {
    setBusy(ref)
    const res = await assembleClaimPacket(ref)
    setBusy(null)
    if (!res.ok || !res.data) {
      toast({ message: 'Could not assemble the packet. Try again.', variant: 'error' })
      return
    }
    haptic('success')
    setPacket(res.data.packet)
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16">
      <PageHeader
        title="Claim packet"
        subtitle="A checklist and a draft for a hard day — assembled from your own records. Nothing is sent."
      />

      {!lifePolicies && <Skeleton className="mt-6 h-24 w-full" />}

      {lifePolicies && lifePolicies.length === 0 && (
        <GlassCard className="mt-6 p-5">
          <p className="text-ink-secondary">
            No life policies on file. Add one in the{' '}
            <Link href="/financial-profile" className="font-medium text-family-400 underline">
              financial profile
            </Link>{' '}
            and it appears here.
          </p>
        </GlassCard>
      )}

      {lifePolicies && lifePolicies.length > 0 && !packet && (
        <GlassCard className="mt-6 space-y-3 p-5">
          {lifePolicies.map((p) => (
            <div key={p.ref} className="flex items-center justify-between gap-3">
              <p className="font-medium text-ink-primary">{p.provider}</p>
              <button
                type="button"
                onClick={() => prepare(p.ref)}
                disabled={busy !== null}
                className={ghostBtn}
              >
                <FileText size={16} aria-hidden="true" />
                {busy === p.ref ? 'Assembling…' : 'Prepare packet'}
              </button>
            </div>
          ))}
        </GlassCard>
      )}

      {packet && (
        <div className="mt-6 space-y-4">
          <GlassCard className="p-5">
            <h2 className="font-medium text-ink-primary">{packet.provider}</h2>
            <p className="mt-1 text-sm text-ink-secondary">Held by {packet.holder}</p>
            <dl className="mt-3 space-y-1 text-sm text-ink-secondary">
              <div className="flex gap-2">
                <dt className="min-w-32 font-medium text-ink-primary">Claims contact</dt>
                <dd>
                  {packet.contact.phone || packet.contact.email
                    ? [packet.contact.phone, packet.contact.email].filter(Boolean).join(' · ')
                    : 'not on file'}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="min-w-32 font-medium text-ink-primary">Policy number</dt>
                <dd>{packet.policy_number ?? 'not on file'}</dd>
              </div>
              {packet.nomination && (
                <div className="flex gap-2">
                  <dt className="min-w-32 font-medium text-ink-primary">Nomination</dt>
                  <dd>{packet.nomination}</dd>
                </div>
              )}
            </dl>
          </GlassCard>

          <GlassCard className="p-5">
            <h2 className="font-medium text-ink-primary">Papers</h2>
            <ul className="mt-2 space-y-2 text-sm">
              {packet.checklist.map((c) => (
                <li key={c.item} className="flex gap-2 text-ink-secondary">
                  <span aria-hidden="true">{c.on_file ? '✓' : '—'}</span>
                  <span>
                    {c.item}
                    {c.located ? (
                      <span className="block text-xs text-ink-tertiary">{c.located}</span>
                    ) : (
                      !c.on_file && (
                        <span className="block text-xs text-ink-tertiary">not located</span>
                      )
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-tertiary">{packet.authority_note}</p>
            {packet.provider_form_url && (
              <p className="mt-1 text-xs text-ink-tertiary">
                Provider page on file: {packet.provider_form_url}
              </p>
            )}
          </GlassCard>

          {packet.gaps.length > 0 && (
            <GlassCard className="p-5">
              <h2 className="font-medium text-ink-primary">Gaps</h2>
              <ul className="mt-2 list-disc pl-5 text-sm text-ink-secondary">
                {packet.gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </GlassCard>
          )}

          <GlassCard className="p-5">
            <h2 className="font-medium text-ink-primary">Draft notification</h2>
            <p className="mt-1 text-xs text-ink-tertiary">
              A draft for you to review and send yourself — LifeKeel sends nothing.
            </p>
            <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-surface-1 p-4 text-sm text-ink-primary">
              {packet.draft_notification}
            </pre>
          </GlassCard>

          <button
            type="button"
            onClick={() => window.print()}
            className={`${ghostBtn} print:hidden`}
          >
            <Printer size={16} aria-hidden="true" /> Print the packet
          </button>
        </div>
      )}
    </main>
  )
}
