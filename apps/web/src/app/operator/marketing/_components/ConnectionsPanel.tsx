'use client'

/**
 * Every social platform at a glance: connected or not, whether the token is about to die, the
 * last real post, the last error, and — for a platform that is not connected yet — the exact
 * steps and redirect address to register. Developer-app credentials are shown as a yes/no only.
 */

import { useCallback, useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import {
  fetchChannelHealth,
  startConnectorConnect,
  type ChannelHealth,
  type ChannelStatus,
} from '@/lib/api'

const CONNECTOR: Record<string, string> = {
  x: 'twitter_x',
  facebook: 'facebook_pages',
  instagram: 'instagram_business',
  threads: 'threads',
  linkedin: 'linkedin',
}

const STATUS: Record<ChannelStatus, { label: string; cls: string }> = {
  connected: { label: 'connected', cls: 'bg-success/15 text-success' },
  expiring_soon: { label: 'expires soon', cls: 'bg-warning/15 text-warning' },
  needs_reauth: { label: 'reconnect needed', cls: 'bg-danger/15 text-danger' },
  error: { label: 'error', cls: 'bg-danger/15 text-danger' },
  not_configured: { label: 'not connected', cls: 'bg-tint/[0.08] text-ink-tertiary' },
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

function Card({
  c,
  onConnect,
  busy,
}: {
  c: ChannelHealth
  onConnect: (c: ChannelHealth) => void
  busy: boolean
}) {
  const st = STATUS[c.status]
  const oauth = c.channel !== 'bluesky'
  const credsMissing = oauth && !c.app_credentials
  const needsAction = c.status !== 'connected' && c.status !== 'expiring_soon'
  const [copied, setCopied] = useState(false)

  return (
    <GlassCard className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">{c.label}</h3>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>
            {st.label}
          </span>
          {c.handle && <span className="text-xs text-ink-tertiary">{c.handle}</span>}
        </div>
        {oauth && (
          <button
            onClick={() => onConnect(c)}
            disabled={busy || credsMissing}
            title={credsMissing ? 'Add the developer-app credentials to the API first' : undefined}
            className="rounded-lg border border-tint/[0.1] px-3 py-1.5 text-xs font-semibold text-ink-secondary hover:text-ink-primary disabled:opacity-40"
          >
            {c.status === 'not_configured' ? 'Connect' : 'Reconnect'}
          </button>
        )}
      </div>

      <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs text-ink-secondary sm:grid-cols-2">
        <div>
          <dt className="inline text-ink-tertiary">Last real post: </dt>
          <dd className="inline">{c.last_publish_at ? day(c.last_publish_at) : 'none yet'}</dd>
        </div>
        {c.expires_at && (
          <div>
            <dt className="inline text-ink-tertiary">Token expires: </dt>
            <dd
              className={`inline ${c.status === 'expiring_soon' ? 'text-warning font-semibold' : ''}`}
            >
              {day(c.expires_at)}
            </dd>
          </div>
        )}
        {oauth && (
          <div>
            <dt className="inline text-ink-tertiary">Developer app on the API: </dt>
            <dd className={`inline ${c.app_credentials ? 'text-success' : 'text-warning'}`}>
              {c.app_credentials ? 'set' : 'not set'}
            </dd>
          </div>
        )}
      </dl>

      {c.last_error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {c.last_error}
        </p>
      )}
      {credsMissing && (
        <p className="mt-2 text-xs text-warning">
          Set {c.setup.env.join(' and ')} on the API (see the steps below), then connect.
        </p>
      )}

      {(needsAction || credsMissing) && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer font-semibold text-ink-secondary">
            How to connect {c.label}
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-secondary">
            {c.setup.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          {c.setup.redirect_uri && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-ink-secondary">
              Redirect address to register:
              <code className="rounded bg-tint/[0.06] px-1.5 py-0.5">{c.setup.redirect_uri}</code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(c.setup.redirect_uri!)
                  setCopied(true)
                }}
                className="rounded border border-tint/[0.1] px-2 py-0.5"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </p>
          )}
          {c.setup.note && <p className="mt-2 text-ink-tertiary">{c.setup.note}</p>}
          <a
            href={c.setup.portal}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-2 inline-flex items-center gap-1 text-family-400"
          >
            Open the developer portal <ExternalLink size={11} />
          </a>
        </details>
      )}
    </GlassCard>
  )
}

export function ConnectionsPanel() {
  const toast = useToast()
  const [channels, setChannels] = useState<ChannelHealth[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setChannels((await fetchChannelHealth()).channels)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load connections')
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  async function connect(c: ChannelHealth) {
    setBusy(true)
    try {
      const res = await startConnectorConnect(CONNECTOR[c.channel]!)
      if (res?.auth_url) window.location.assign(res.auth_url)
      else toast({ message: `${c.label} OAuth is not configured on the API`, variant: 'error' })
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : 'Connect failed', variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  if (error)
    return (
      <GlassCard className="p-4">
        <p className="text-sm text-danger">{error}</p>
      </GlassCard>
    )
  if (!channels) return <div className="shimmer h-40 rounded-2xl" />

  const ready = channels.filter((c) => c.usable).length
  return (
    <div className="space-y-3">
      <GlassCard className="p-4">
        <h2 className="font-semibold">Connections</h2>
        <p className="text-xs text-ink-tertiary">
          {ready} of {channels.length} platforms ready to draft and post for. A platform with a dead
          or missing connection is left out of the weekly plan and shown here and in Mission
          Control. Connecting Bluesky uses an app password: use “Connect a channel” at the top of
          this page.
        </p>
      </GlassCard>
      {channels.map((c) => (
        <Card key={c.channel} c={c} onConnect={connect} busy={busy} />
      ))}
    </div>
  )
}
