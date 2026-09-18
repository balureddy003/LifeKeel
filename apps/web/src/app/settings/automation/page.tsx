'use client'

/**
 * Automation & approvals (remediation item 25) — the settings surface for
 * the Act-layer trust fields the backend already honored but nothing could
 * reach:
 *
 *  - Dry-run mode (writable): when on, approving an insight records the
 *    decision and what would have run without dispatching anything —
 *    the safest way to watch Oak before letting it act for real.
 *  - Trust levels (read-only): earned per workflow by real approvals —
 *    deliberately not editable. A trust level you could just type in
 *    wouldn't be trust.
 *
 * Approving an insight still always goes through the per-insight gate
 * screen (app/insights/[id]) — nothing here removes the human approval
 * step; dry-run only controls whether the approved actions dispatch.
 */

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, ShieldCheck, TrendingUp } from 'lucide-react'
import { GlassCard, PageHeader } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { fetchAutomationSettings, updateAutomationSettings, type AutomationSettings } from '@/lib/api'

export default function AutomationSettingsPage() {
  const [settings, setSettings] = useState<AutomationSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    fetchAutomationSettings().then((s) => {
      setSettings(s)
      setLoading(false)
    })
  }, [])

  const handleToggle = async () => {
    if (!settings || saving) return
    const next = !settings.dry_run_mode
    haptic('light')
    setSaving(true)
    setSaveError(null)
    const updated = await updateAutomationSettings(next)
    setSaving(false)
    if (!updated) {
      setSaveError("Couldn't save — please try again.")
      return
    }
    setSettings(updated)
  }

  const trustEntries = Object.entries(settings?.trust_level_by_workflow ?? {})

  return (
    <div className="px-5 pt-2 pb-8 space-y-5">
      <PageHeader
        title="Automation & approvals"
        backHref="/settings"
        subtitle="What Oak is allowed to do on your behalf"
      />

      {loading ? (
        <GlassCard className="p-5">
          <div className="shimmer h-4 rounded mb-2" />
          <div className="shimmer h-4 rounded w-2/3" />
        </GlassCard>
      ) : (
        <>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <GlassCard className="p-5">
              <div className="flex items-start gap-3">
                <ShieldCheck size={20} className="text-family-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="text-base font-semibold text-ink-primary">Dry-run mode</div>
                  <p className="text-sm text-ink-secondary leading-relaxed mt-1">
                    When on, approving an insight records your decision and shows what would have run —
                    no emails, messages, or external changes actually happen.
                  </p>
                  <div className="flex items-center justify-between mt-4">
                    <span className="text-sm font-medium text-ink-primary">
                      {settings?.dry_run_mode ? 'On — nothing is sent' : 'Off — approved actions run for real'}
                    </span>
                    <button
                      role="switch"
                      aria-checked={settings?.dry_run_mode ?? false}
                      aria-label="Dry-run mode"
                      onClick={handleToggle}
                      disabled={saving || settings === null}
                      className={`relative w-12 h-7 rounded-full transition-colors disabled:opacity-40 ${
                        settings?.dry_run_mode ? 'bg-family-500' : 'bg-white/10'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition-transform ${
                          settings?.dry_run_mode ? 'translate-x-[22px]' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                  {saveError && <p className="text-sm text-red-400 mt-2">{saveError}</p>}
                  {saving && <Loader2 size={14} className="animate-spin text-ink-tertiary mt-2" />}
                </div>
              </div>
            </GlassCard>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <GlassCard className="p-5">
              <div className="flex items-start gap-3">
                <TrendingUp size={20} className="text-family-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="text-base font-semibold text-ink-primary">Trust Oak earns</div>
                  <p className="text-sm text-ink-secondary leading-relaxed mt-1">
                    Every time you approve a recommendation, Oak's trust for that kind of action grows.
                    It's earned, not set — which is why there's no edit control here.
                  </p>
                  {trustEntries.length === 0 ? (
                    <p className="text-sm text-ink-tertiary mt-3">
                      No approvals yet — trust builds as you review and approve insights.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {trustEntries.map(([workflowId, level]) => (
                        <div key={workflowId} className="flex items-center justify-between">
                          <span className="text-sm text-ink-secondary">{workflowId}</span>
                          <div className="flex items-center gap-1.5">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <span
                                key={i}
                                className={`w-2 h-2 rounded-full ${i < level ? 'bg-family-400' : 'bg-white/10'}`}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </GlassCard>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <GlassCard className="p-5">
              <p className="text-sm text-ink-secondary leading-relaxed">
                Approving an insight always goes through its own review screen first — nothing on this
                page removes that step. Dry-run only decides whether an approved action actually dispatches.
              </p>
            </GlassCard>
          </motion.div>
        </>
      )}
    </div>
  )
}
