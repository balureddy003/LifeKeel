'use client'

/**
 * /assets (gap 8, non-sensitive slice) — the family's declared-asset
 * register: property, vehicles, savings accounts, valuables. Same
 * sensitivity class as the financial profile; medical/health data stays
 * deferred by design. Adult-only at the API boundary.
 */

import { useEffect, useState } from 'react'
import { Plus, Trash2, Home, Loader2 } from 'lucide-react'
import { PageHeader, GlassCard, Money, ListSection, ListRow } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import { haptic } from '@/lib/haptics'
import {
  fetchFamilyAssets,
  addFamilyAsset,
  deleteFamilyAsset,
  ASSET_KINDS,
  ASSET_KIND_LABELS,
  type AssetKind,
  type AssetList,
} from '@/lib/api'

function gbp(minor: number): string {
  return `£${Math.round(minor / 100).toLocaleString('en-GB')}`
}

export default function AssetsPage() {
  const toast = useToast()
  const [data, setData] = useState<AssetList | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [kind, setKind] = useState<AssetKind>('property')
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = () => fetchFamilyAssets().then((d) => { setData(d); setLoaded(true) })
  useEffect(() => { void reload() }, [])

  const add = async () => {
    const pounds = Number(value)
    if (!name.trim() || !Number.isFinite(pounds) || pounds < 0) return
    haptic('light')
    setBusy(true)
    const created = await addFamilyAsset({ kind, name: name.trim(), value_minor: Math.round(pounds * 100) })
    setBusy(false)
    if (!created) {
      haptic('warning')
      toast({ message: "Couldn't save that — try again", variant: 'error' })
      return
    }
    setName('')
    setValue('')
    haptic('success')
    await reload()
  }

  const remove = async (id: string, assetName: string) => {
    haptic('light')
    if (await deleteFamilyAsset(id)) await reload()
    else toast({ message: `Couldn't remove ${assetName}`, variant: 'error' })
  }

  return (
    <div className="px-5 pt-2 pb-10 space-y-5">
      <PageHeader title="Assets" backHref="/" subtitle="What your family owns — property, vehicles, valuables" />

      {loaded && data && data.assets.length > 0 && (
        <GlassCard className="p-4">
          <div className="text-xs text-ink-tertiary">Total declared value</div>
          <Money value={gbp(data.summary.total_minor)} className="text-2xl font-bold text-ink-primary" />
          <div className="flex flex-wrap gap-2 mt-2">
            {Object.entries(data.summary.by_kind).map(([k, v]) => (
              <span key={k} className="text-[11px] rounded-full bg-tint/[0.05] px-2 py-0.5 text-ink-tertiary">
                {ASSET_KIND_LABELS[k as AssetKind] ?? k}: <Money value={gbp(v)} />
              </span>
            ))}
          </div>
        </GlassCard>
      )}

      <ListSection title="On the register">
        {data?.assets.map((a) => (
          <ListRow key={a.id} icon={Home}>
            <div className="flex items-center justify-between w-full gap-3">
              <div className="min-w-0 text-left">
                <div className="text-base font-medium truncate">{a.name}</div>
                <div className="text-xs text-ink-tertiary">
                  {ASSET_KIND_LABELS[a.kind]} · <Money value={gbp(a.value_minor)} />
                </div>
              </div>
              <button
                onClick={(ev) => { ev.stopPropagation(); void remove(a.id, a.name) }}
                aria-label={`Remove ${a.name}`}
                className="p-2 rounded-lg text-ink-tertiary hover:text-danger hover:bg-danger/10 transition-colors flex-shrink-0"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </ListRow>
        ))}
        {loaded && data?.assets.length === 0 && (
          <ListRow>
            <p className="text-sm text-ink-tertiary">Nothing registered yet — add the big things (the house, cars, savings accounts) so Keel has the full picture.</p>
          </ListRow>
        )}
      </ListSection>

      <GlassCard className="p-4 space-y-3">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as AssetKind)}
          className="glass-input w-full rounded-xl px-3 py-3 text-sm text-ink-primary outline-none"
          aria-label="Asset type"
        >
          {ASSET_KINDS.map((k) => (
            <option key={k} value={k}>{ASSET_KIND_LABELS[k]}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="e.g. Family home, the car"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 transition-all"
        />
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-tertiary text-sm">£</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            placeholder="Estimated value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            className="glass-input w-full rounded-xl pl-8 pr-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 transition-all"
          />
        </div>
        <button
          type="button"
          onClick={add}
          disabled={busy || !name.trim() || !value}
          className="w-full glass rounded-2xl py-3 text-sm font-semibold text-family-400 flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add asset
        </button>
      </GlassCard>

      <p className="text-xs text-ink-tertiary text-center px-4">
        Declared values only — Keel uses them for the household picture, never to recommend products or providers.
      </p>
    </div>
  )
}
