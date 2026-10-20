'use client'

/**
 * Channel profiles (PRD-210, phase 2): the desired profile text per network, what is actually
 * there, the drift between them, a manual checklist, and an approved update where the network
 * allows one. Accounts are created by a person; nothing here creates one.
 */

import { useEffect, useState } from 'react'
import { Check, Copy, Loader2 } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import {
  applyChannelProfile,
  checkChannelProfile,
  fetchChannelProfiles,
  saveChannelProfile,
  tickProfileStep,
  type ChannelProfileView,
} from '@/lib/api'

const NAMES: Record<string, string> = {
  linkedin: 'LinkedIn',
  bluesky: 'Bluesky',
  instagram: 'Instagram',
  facebook: 'Facebook',
  threads: 'Threads',
  x: 'X',
}

const STEP_LABEL: Record<string, string> = {
  account_created: 'Account created (by a person)',
  two_factor_app: 'Two-factor on, using an authenticator app',
  avatar_set: 'Profile picture set',
  banner_set: 'Banner set',
  bio_set: 'Bio set',
  link_set: 'Link set',
  two_admins: 'At least two admins',
  website_verified: 'Website verified',
  domain_handle: 'Domain handle in use',
  linked_to_facebook_page: 'Linked to the Facebook Page',
  professional_account: 'Professional account',
}

const DRIFT_LABEL: Record<string, string> = {
  display_name: 'Name',
  bio: 'Bio',
  avatar: 'Picture',
  banner: 'Banner',
}

export function ProfilesPanel() {
  const toast = useToast()
  const [profiles, setProfiles] = useState<ChannelProfileView[] | null>(null)

  useEffect(() => {
    fetchChannelProfiles().then(setProfiles)
  }, [])

  const replace = (p: ChannelProfileView) =>
    setProfiles((cur) => (cur ?? []).map((x) => (x.channel === p.channel ? p : x)))

  if (!profiles) return <div className="shimmer h-24 rounded-2xl" />

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-secondary leading-relaxed">
        The text each profile should carry. Edit it here, then paste it into the network, or, where the
        network allows, check what is live and approve an update. Nothing here creates an account.
      </p>
      {profiles.map((p) => (
        <ProfileCard key={p.channel} profile={p} onChange={replace} toast={toast} />
      ))}
    </div>
  )
}

function ProfileCard({
  profile,
  onChange,
  toast,
}: {
  profile: ChannelProfileView
  onChange: (p: ChannelProfileView) => void
  toast: ReturnType<typeof useToast>
}) {
  const [draft, setDraft] = useState(profile.desired)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const name = NAMES[profile.channel] ?? profile.channel
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile.desired)
  const over = draft.bio.length > profile.bio_limit

  const run = async (label: string, fn: () => Promise<ChannelProfileView>, done?: string) => {
    setBusy(label)
    try {
      const next = await fn()
      onChange(next)
      setDraft(next.desired)
      if (done) toast({ message: done })
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : 'That did not work', variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast({ message: `${what} copied` })
    } catch {
      toast({ message: 'Could not copy; select the text instead', variant: 'error' })
    }
  }

  const doneCount = profile.checklist_items.filter((i) => profile.checklist[i]).length

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-base font-semibold text-ink-primary">{name}</h3>
        <span className="text-xs text-ink-tertiary">
          {doneCount} of {profile.checklist_items.length} steps
          {profile.applied_at ? ' · updated from here' : ''}
        </span>
      </div>

      <label className="block text-xs text-ink-tertiary mb-1" htmlFor={`${profile.channel}-name`}>
        Name
      </label>
      <input
        id={`${profile.channel}-name`}
        value={draft.display_name}
        onChange={(e) => setDraft({ ...draft, display_name: e.target.value })}
        className="glass-input w-full rounded-xl px-3 py-2 text-sm mb-2"
      />
      <label className="block text-xs text-ink-tertiary mb-1" htmlFor={`${profile.channel}-handle`}>
        Handle
      </label>
      <input
        id={`${profile.channel}-handle`}
        value={draft.handle}
        onChange={(e) => setDraft({ ...draft, handle: e.target.value })}
        className="glass-input w-full rounded-xl px-3 py-2 text-sm mb-2"
      />
      <label className="block text-xs text-ink-tertiary mb-1" htmlFor={`${profile.channel}-bio`}>
        Bio
      </label>
      <textarea
        id={`${profile.channel}-bio`}
        rows={3}
        value={draft.bio}
        onChange={(e) => setDraft({ ...draft, bio: e.target.value })}
        className="glass-input w-full rounded-xl px-3 py-2 text-sm"
      />
      <div className={`text-xs mt-1 mb-2 ${over ? 'text-danger' : 'text-ink-tertiary'}`}>
        {draft.bio.length} of {profile.bio_limit}
      </div>
      <label className="block text-xs text-ink-tertiary mb-1" htmlFor={`${profile.channel}-link`}>
        Link (with its UTM tags)
      </label>
      <input
        id={`${profile.channel}-link`}
        value={draft.link}
        onChange={(e) => setDraft({ ...draft, link: e.target.value })}
        className="glass-input w-full rounded-xl px-3 py-2 text-sm mb-2"
      />

      {profile.problems.length > 0 && !dirty && (
        <ul role="alert" className="text-xs text-danger mb-2 list-disc pl-4 space-y-0.5">
          {profile.problems.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={() => run('save', () => saveChannelProfile(profile.channel, draft), 'Saved')}
          disabled={!dirty || over || busy !== null}
          className="rounded-xl px-3 py-2 text-xs font-semibold bg-family-500/15 border border-family-500/25 text-family-400 disabled:opacity-40"
        >
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={() => copy(profile.desired.bio, 'Bio')}
          className="rounded-xl px-3 py-2 text-xs font-semibold bg-tint/[0.04] border border-tint/[0.08] text-ink-secondary inline-flex items-center gap-1"
        >
          <Copy size={12} /> Copy bio
        </button>
        <button
          onClick={() => copy(profile.desired.link, 'Link')}
          className="rounded-xl px-3 py-2 text-xs font-semibold bg-tint/[0.04] border border-tint/[0.08] text-ink-secondary inline-flex items-center gap-1"
        >
          <Copy size={12} /> Copy link
        </button>
        {profile.supports_check && (
          <button
            onClick={() => run('check', () => checkChannelProfile(profile.channel), 'Checked the live profile')}
            disabled={busy !== null}
            className="rounded-xl px-3 py-2 text-xs font-semibold bg-tint/[0.04] border border-tint/[0.08] text-ink-secondary disabled:opacity-40"
          >
            {busy === 'check' ? 'Checking…' : 'Check live profile'}
          </button>
        )}
      </div>

      {profile.supports_check && profile.actual && (
        <div className="text-xs mb-3">
          {profile.drift.length === 0 ? (
            <p className="text-success inline-flex items-center gap-1">
              <Check size={12} /> Matches the live profile
            </p>
          ) : (
            <div>
              <p className="text-warning mb-1">Differs from the live profile:</p>
              <ul className="space-y-1">
                {profile.drift.map((d) => (
                  <li key={d.field} className="text-ink-secondary">
                    <span className="font-semibold">{DRIFT_LABEL[d.field] ?? d.field}:</span> live shows “{d.actual}”, wanted “{d.desired}”
                  </li>
                ))}
              </ul>
              {profile.supports_apply && profile.drift.some((d) => d.field === 'display_name' || d.field === 'bio') && (
                <div className="mt-2">
                  {!confirming ? (
                    <button
                      onClick={() => setConfirming(true)}
                      disabled={profile.problems.length > 0 || dirty}
                      className="rounded-xl px-3 py-2 text-xs font-semibold bg-family-500/15 border border-family-500/25 text-family-400 disabled:opacity-40"
                    >
                      Update the live profile…
                    </button>
                  ) : (
                    <div className="rounded-xl border border-tint/[0.1] p-3">
                      <p className="text-xs text-ink-secondary mb-2">
                        This changes the public profile on {name} to exactly:
                      </p>
                      <p className="text-sm text-ink-primary mb-1 font-semibold">{profile.desired.display_name}</p>
                      <p className="text-sm text-ink-primary whitespace-pre-wrap mb-3">{profile.desired.bio}</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            run('apply', () => applyChannelProfile(profile.channel, profile.desired_hash), 'Profile updated').finally(() =>
                              setConfirming(false),
                            )
                          }
                          disabled={busy !== null}
                          className="flex-1 rounded-xl px-3 py-2 text-xs font-semibold bg-family-500 text-white"
                        >
                          {busy === 'apply' ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Approve and update'}
                        </button>
                        <button
                          onClick={() => setConfirming(false)}
                          className="rounded-xl px-3 py-2 text-xs font-semibold bg-tint/[0.04] border border-tint/[0.08] text-ink-secondary"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <fieldset>
        <legend className="text-xs text-ink-tertiary mb-1">Setup steps</legend>
        <div className="grid grid-cols-1 gap-1">
          {profile.checklist_items.map((item) => (
            <label key={item} className="flex items-center gap-2 text-xs text-ink-secondary">
              <input
                type="checkbox"
                checked={Boolean(profile.checklist[item])}
                onChange={(e) => run(`tick:${item}`, () => tickProfileStep(profile.channel, item, e.target.checked))}
              />
              {STEP_LABEL[item] ?? item}
            </label>
          ))}
        </div>
      </fieldset>
    </GlassCard>
  )
}
