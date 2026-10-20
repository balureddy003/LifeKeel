'use client'

/**
 * PRD-136 §5 — the notification preference center card on /settings.
 * Tenant-level delivery prefs: channel order, quiet hours, digest,
 * urgency floor, heartbeat cadence, domain mutes, member scope. Every
 * control calls onPatch immediately (save-on-interaction, matching the
 * continuity card). Children never reach it — the API 403s them and the
 * parent hides the card when prefs come back null.
 */
import { Bell } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import type { NotificationPrefs, NotificationPrefsPatch } from '@/lib/api'

const URGENCIES = ['low', 'medium', 'high', 'critical'] as const
const CADENCES = ['weekly', 'monthly', 'off'] as const
const DOMAINS = ['emergency_fund', 'protection', 'retirement', 'education', 'estate'] as const
const SCOPES = ['all', 'mine'] as const
const HOURS = Array.from({ length: 24 }, (_, h) => h)

export function NotificationsCard({
  prefs,
  exemptCriticals,
  isOrganizer,
  busy,
  onPatch,
  onDigestOffer,
}: {
  prefs: NotificationPrefs
  exemptCriticals: string[]
  isOrganizer: boolean
  busy: boolean
  onPatch: (patch: NotificationPrefsPatch) => void
  /** The organizer's answer to the digest-only offer (PRD-139). */
  onDigestOffer?: (accept: boolean) => void
}) {
  const disabled = !isOrganizer || busy

  const moveChannel = (ch: string, dir: -1 | 1) => {
    const channels = [...prefs.channels]
    const i = channels.indexOf(ch)
    const j = i + dir
    if (i < 0 || j < 0 || j >= channels.length) return
    ;[channels[i], channels[j]] = [channels[j]!, channels[i]!]
    onPatch({ channels })
  }

  return (
    <GlassCard className="p-4 space-y-4">
      {/* The anchor the heartbeat email footer links to (#notifications). */}
      <div id="notifications" className="scroll-mt-20" />
      <div className="flex items-center gap-2">
        <Bell size={16} className="text-family-400 flex-shrink-0" />
        <span className="text-sm font-semibold text-ink-primary">Notifications</span>
        {!isOrganizer && (
          <span className="ml-auto text-[11px] text-ink-tertiary">
            Only the organizer can change these
          </span>
        )}
      </div>

      {/* PRD-139: an offer, never a silent change. Shown only while it is pending. */}
      {prefs.digest_offer_pending && (
        <div
          role="region"
          aria-label="Digest only offer"
          className="rounded-xl bg-family-500/10 border border-family-500/20 p-3"
        >
          <p className="text-xs text-ink-primary leading-relaxed">
            You haven&apos;t opened the last two alerts. Want digest only instead? You would get one
            summary email a month instead. Important reminders and safety messages still arrive
            either way.
          </p>
          {isOrganizer && onDigestOffer ? (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onDigestOffer(true)}
                className="flex-1 rounded-lg bg-family-500/20 border border-family-500/30 py-1.5 text-xs font-semibold text-family-300 disabled:opacity-50"
              >
                Use digest only
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onDigestOffer(false)}
                className="flex-1 rounded-lg bg-tint/[0.04] border border-tint/[0.08] py-1.5 text-xs text-ink-secondary disabled:opacity-50"
              >
                Keep alerts
              </button>
            </div>
          ) : (
            <p className="mt-1.5 text-[11px] text-ink-tertiary">The organizer can answer this.</p>
          )}
        </div>
      )}

      <div>
        <div className="text-xs font-medium text-ink-secondary mb-1.5">Delivery order</div>
        <div className="space-y-1">
          {prefs.channels.map((ch) => (
            <div key={ch} className="flex items-center gap-2 rounded-xl bg-tint/[0.04] px-3 py-2">
              <span className="flex-1 text-xs text-ink-primary">{ch.replace(/_/g, ' ')}</span>
              {isOrganizer && (
                <>
                  <button
                    aria-label={`Move ${ch} up`}
                    onClick={() => moveChannel(ch, -1)}
                    disabled={busy}
                    className="text-ink-tertiary disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    aria-label={`Move ${ch} down`}
                    onClick={() => moveChannel(ch, 1)}
                    disabled={busy}
                    className="text-ink-tertiary disabled:opacity-40"
                  >
                    ↓
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-ink-secondary">
          Quiet from
          <select
            value={prefs.quiet_hours_start ?? ''}
            onChange={(e) =>
              onPatch({ quiet_hours_start: e.target.value === '' ? null : Number(e.target.value) })
            }
            disabled={disabled}
            className="mt-1 w-full rounded-lg bg-tint/[0.04] border border-tint/[0.08] px-2 py-1.5 text-xs text-ink-primary disabled:opacity-50"
          >
            <option value="">Off</option>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h}:00
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-secondary">
          Quiet until
          <select
            value={prefs.quiet_hours_end ?? ''}
            onChange={(e) =>
              onPatch({ quiet_hours_end: e.target.value === '' ? null : Number(e.target.value) })
            }
            disabled={disabled}
            className="mt-1 w-full rounded-lg bg-tint/[0.04] border border-tint/[0.08] px-2 py-1.5 text-xs text-ink-primary disabled:opacity-50"
          >
            <option value="">Off</option>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h}:00
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex items-center justify-between gap-3">
        <span className="text-xs text-ink-secondary">
          Daily digest — batch low-priority items into one email
        </span>
        <input
          type="checkbox"
          checked={prefs.digest_mode}
          onChange={(e) => onPatch({ digest_mode: e.target.checked })}
          disabled={disabled}
          className="accent-family-500"
        />
      </label>

      <label className="flex items-center justify-between gap-3">
        <span className="text-xs text-ink-secondary">Only notify me at this urgency or higher</span>
        <select
          value={prefs.min_urgency}
          onChange={(e) =>
            onPatch({ min_urgency: e.target.value as NotificationPrefs['min_urgency'] })
          }
          disabled={disabled}
          className="rounded-lg bg-tint/[0.04] border border-tint/[0.08] px-2 py-1.5 text-xs text-ink-primary disabled:opacity-50"
        >
          {URGENCIES.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>

      <div>
        <div className="text-xs font-medium text-ink-secondary mb-1.5">Family heartbeat</div>
        <div className="flex gap-1.5">
          {CADENCES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onPatch({ heartbeat_cadence: c })}
              disabled={disabled}
              className={`flex-1 rounded-xl py-2 text-xs font-semibold disabled:opacity-50 ${
                prefs.heartbeat_cadence === c
                  ? 'bg-family-500/20 text-family-300 border border-family-500/30'
                  : 'bg-tint/[0.04] text-ink-tertiary border border-tint/[0.08]'
              }`}
            >
              {c === 'off' ? 'Off' : c === 'weekly' ? 'Weekly' : 'Monthly'}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-ink-tertiary leading-relaxed">
          Monthly is the Quiet Care digest: it always arrives, even when nothing changed, so you can
          tell a quiet month from a broken one. Weekly is a shorter &quot;what moved&quot; email.
        </p>
        <label className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-ink-secondary">Weekly: send even when nothing moved</span>
          <input
            type="checkbox"
            checked={prefs.heartbeat_quiet_weeks}
            onChange={(e) => onPatch({ heartbeat_quiet_weeks: e.target.checked })}
            disabled={disabled}
            className="accent-family-500"
          />
        </label>
      </div>

      <div>
        <div className="text-xs font-medium text-ink-secondary mb-1.5">Don&apos;t notify about</div>
        <div className="flex flex-wrap gap-1.5">
          {DOMAINS.map((d) => {
            const muted = prefs.domains_muted.includes(d)
            return (
              <button
                key={d}
                type="button"
                onClick={() =>
                  onPatch({
                    domains_muted: muted
                      ? prefs.domains_muted.filter((x) => x !== d)
                      : [...prefs.domains_muted, d],
                  })
                }
                disabled={disabled}
                className={`rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                  muted
                    ? 'bg-family-500/20 text-family-300 border border-family-500/30'
                    : 'bg-tint/[0.04] text-ink-tertiary border border-tint/[0.08]'
                }`}
              >
                {d.replace(/_/g, ' ')}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-ink-secondary">Cover</span>
        <div className="flex gap-1.5">
          {SCOPES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPatch({ member_scope: s })}
              disabled={disabled}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                prefs.member_scope === s
                  ? 'bg-family-500/20 text-family-300 border border-family-500/30'
                  : 'bg-tint/[0.04] text-ink-tertiary border border-tint/[0.08]'
              }`}
            >
              {s === 'all' ? 'The whole family' : 'Just me'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs font-medium text-ink-secondary mb-1">
          Always sent — these can&apos;t be silenced
        </div>
        <ul className="space-y-1">
          {exemptCriticals.map((c) => (
            <li key={c} className="text-[11px] text-ink-tertiary">
              {c.replace(/_/g, ' ')}
            </li>
          ))}
        </ul>
      </div>
    </GlassCard>
  )
}
