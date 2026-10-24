'use client'

/**
 * Emergency sheet (PRD-220): the owner picks sections, preview is built
 * from their own data on request, and the sheet leaves as a file/print —
 * never a hosted URL. Footer carries the referral link unless turned off.
 */
import { useState } from 'react'
import { GlassCard, PageHeader } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import { previewEmergencySheet, referralLink, type SheetSectionView } from '@/lib/api'
import { credFetch } from '@/lib/http'
import { getApiBase } from '@/lib/env'
import { getSessionToken } from '@/lib/session-token'
import { track } from '@/lib/growth-track'

const SECTIONS = [
  ['who_to_call', 'Who to call'],
  ['key_papers', 'Where the key papers are'],
  ['accounts', 'Accounts'],
  ['policies', 'Cover on file'],
  ['balances', 'Include balances'],
  ['children', "Children's details"],
] as const

export default function EmergencySheetPage() {
  const toast = useToast()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [sheet, setSheet] = useState<SheetSectionView[] | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [showFooter, setShowFooter] = useState(true)
  const [busy, setBusy] = useState(false)

  const generate = async () => {
    setBusy(true)
    try {
      const r = await previewEmergencySheet([...picked])
      setSheet(r.sections)
      track('sheet_generated', { src: 'sheet' })
      const token = getSessionToken()
      const rc = await credFetch(`${getApiBase()}/referrals/my-code`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const { code } = (await rc.json().catch(() => ({}))) as { code?: string }
      if (code) setLink(referralLink(code, 'sheet'))
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : 'Failed', variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Emergency sheet" subtitle="A page your family can find on a hard day." />
      <GlassCard className="p-4 print:hidden">
        <p className="text-sm text-ink-secondary mb-3">
          Choose what to include — nothing is shown or stored until you pick it. You send the file
          yourself; LifeKeel never hosts or sends it.
        </p>
        {SECTIONS.map(([id, label]) => (
          <label key={id} className="flex items-center gap-2 py-1 text-sm text-ink-primary">
            <input
              type="checkbox"
              checked={picked.has(id)}
              onChange={(e) => {
                const next = new Set(picked)
                e.target.checked ? next.add(id) : next.delete(id)
                setPicked(next)
              }}
            />
            {label}
          </label>
        ))}
        <label className="flex items-center gap-2 py-1 mt-2 text-sm text-ink-secondary">
          <input
            type="checkbox"
            checked={showFooter}
            onChange={(e) => setShowFooter(e.target.checked)}
          />
          Include "Made with LifeKeel" and my referral link
        </label>
        <button
          onClick={generate}
          disabled={busy || picked.size === 0}
          className="mt-3 w-full rounded-xl py-2.5 text-sm font-semibold bg-family-500 text-white disabled:opacity-40"
        >
          {busy ? 'Building…' : 'Preview the sheet'}
        </button>
      </GlassCard>

      {sheet && (
        <GlassCard className="p-6" data-testid="emergency-sheet">
          {sheet.map((s) => (
            <div key={s.id} className="mb-4">
              <h2 className="text-base font-semibold text-ink-primary">{s.title}</h2>
              <ul className="mt-1 space-y-1">
                {s.items.map((it, i) => (
                  <li key={i} className="text-sm text-ink-secondary">
                    {it.label}
                    {it.detail ? ` — ${it.detail}` : ''}
                  </li>
                ))}
                {s.items.length === 0 && (
                  <li className="text-sm text-ink-tertiary italic">Nothing on file yet.</li>
                )}
              </ul>
            </div>
          ))}
          <p className="text-xs text-ink-tertiary mt-4">
            Informational only — not advice. For decisions about cover, talk to a licensed
            professional.
          </p>
          {showFooter && (
            <p className="text-xs text-ink-tertiary mt-2 border-t border-tint/[0.08] pt-2">
              Made with LifeKeel{link ? ` — ${link}` : ''}
            </p>
          )}
          <div className="print:hidden mt-4 flex gap-2">
            <button
              onClick={() => {
                window.print()
                track('sheet_shared', { src: 'sheet' })
              }}
              className="rounded-xl px-3 py-2 text-sm font-semibold bg-family-500/15 text-family-400"
            >
              Print / save as PDF
            </button>
            {link && (
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(link)
                  track('referral_link_copied', { src: 'sheet' })
                  toast({ message: 'Referral link copied' })
                }}
                className="rounded-xl px-3 py-2 text-sm font-semibold bg-tint/[0.06] text-ink-secondary"
              >
                Copy referral link
              </button>
            )}
          </div>
        </GlassCard>
      )}
    </div>
  )
}
