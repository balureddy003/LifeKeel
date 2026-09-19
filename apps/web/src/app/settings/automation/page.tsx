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
import { BellRing, Loader2, ShieldCheck, TrendingUp } from 'lucide-react'
import { GlassCard, PageHeader } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import { haptic } from '@/lib/haptics'
import {
  cancelReminder,
  fetchAutomationSettings,
  fetchReminders,
  updateAutomationSettings,
  type AutomationSettings,
  type PolicyReminder,
} from '@/lib/api'

export default function AutomationSettingsPage() {
  const [settings, setSettings] = useState<AutomationSettings | null>(null)
  const [reminders, setReminders] = useState<PolicyReminder[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const toast = useToast()

  useEffect(() => {
    Promise.all([fetchAutomationSettings(), fetchReminders()]).then(([s, r]) => {
      setSettings(s)
      setReminders(r)
      setLoading(false)
    })
  }, [])

  const applyPatch = async (patch: Partial<Pick<AutomationSettings, 'dry_run_mode' | 'renewal_reminders_enabled'>>) => {
    if (!settings || saving) return
    const previous = settings
    haptic('light')
    // Optimistic: flip the switch instantly; roll back if the save fails.
    setSettings({ ...settings, ...patch })
    setSaving(true)
    setSaveError(null)
    const updated = await updateAutomationSettings(patch)
    setSaving(false)
    if (updated === 'queued') {
      // Offline — keep the optimistic flip; the mutation replays on reconnect.
      toast({ message: "You're offline — this will apply when you're back online" })
      return
    }
    if (!updated) {
      setSettings(previous)
      setSaveError("That didn't save — your previous setting is still in place. Try again in a moment.")
      return
    }
    setSettings(updated)
  }

  const handleCancelReminder = async (id: string) => {
    haptic('light')
    const ok = await cancelReminder(id)
    if (!ok) {
      toast({ message: "Couldn't cancel that reminder — try again" })
      return
    }
    setReminders((rs) => rs.map((r) => (r.id === id ? { ...r, status: 'cancelled', cancelled_reason: 'user_cancelled' } : r)))
  }

  const trustEntries = Object.entries(settings?.trust_level_by_workflow ?? {})
  const upcomingReminders = reminders.filter((r) => r.status === 'scheduled' || r.status === 'sending')
  const recentAutomatic = reminders.filter((r) => r.status === 'sent' || r.status === 'failed' || r.status === 'cancelled').slice(-5).reverse()

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
                      onClick={() => applyPatch({ dry_run_mode: !settings?.dry_run_mode })}
                      disabled={saving || settings === null}
                      className={`relative w-12 h-7 rounded-full transition-colors disabled:opacity-40 ${
                        settings?.dry_run_mode ? 'bg-family-500' : 'bg-tint/10'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition-transform ${
                          settings?.dry_run_mode ? 'translate-x-[22px]' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                  {saveError && <p className="text-sm text-danger mt-2">{saveError}</p>}
                  {saving && <Loader2 size={14} className="animate-spin text-ink-tertiary mt-2" />}
                </div>
              </div>
            </GlassCard>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <GlassCard className="p-5">
              <div className="flex items-start gap-3">
                <BellRing size={20} className="text-family-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="text-base font-semibold text-ink-primary">Policy renewal reminders</div>
                  <p className="text-sm text-ink-secondary leading-relaxed mt-1">
                    Oak automatically reminds you on your devices before a policy on your financial
                    profile renews — nothing is sent to your insurer, and no changes are made.
                  </p>
                  <div className="flex items-center justify-between mt-4">
                    <span className="text-sm font-medium text-ink-primary">
                      {settings?.renewal_reminders_enabled ? 'On — Oak reminds you' : 'Off'}
                    </span>
                    <button
                      role="switch"
                      aria-checked={settings?.renewal_reminders_enabled ?? false}
                      aria-label="Policy renewal reminders"
                      onClick={() => applyPatch({ renewal_reminders_enabled: !settings?.renewal_reminders_enabled })}
                      disabled={saving || settings === null}
                      className={`relative w-12 h-7 rounded-full transition-colors disabled:opacity-40 ${
                        settings?.renewal_reminders_enabled ? 'bg-family-500' : 'bg-tint/10'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition-transform ${
                          settings?.renewal_reminders_enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>

                  {upcomingReminders.length > 0 && (
                    <div className="mt-4 space-y-2">
                      <div className="text-xs font-semibold text-ink-tertiary uppercase tracking-wide">Coming up</div>
                      {upcomingReminders.map((r) => (
                        <div key={r.id} className="flex items-center justify-between gap-2">
                          <span className="text-sm text-ink-secondary truncate">
                            {r.policy.provider} {r.policy.type.replace(/_/g, ' ')} — renews {r.renewal_date}
                          </span>
                          <button
                            onClick={() => handleCancelReminder(r.id)}
                            className="text-xs font-medium text-ink-tertiary active:opacity-60 shrink-0"
                          >
                            Cancel
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {recentAutomatic.length > 0 && (
                    <div className="mt-4 space-y-1.5">
                      <div className="text-xs font-semibold text-ink-tertiary uppercase tracking-wide">Oak handled automatically</div>
                      {recentAutomatic.map((r) => (
                        <div key={r.id} className="text-sm text-ink-tertiary truncate">
                          {r.status === 'sent' ? 'Reminded' : r.status === 'failed' ? 'Couldn’t send' : 'Cancelled'} · {r.policy.provider} {r.policy.type.replace(/_/g, ' ')} · {r.renewal_date}
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
                                className={`w-2 h-2 rounded-full ${i < level ? 'bg-family-400' : 'bg-tint/10'}`}
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

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
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
