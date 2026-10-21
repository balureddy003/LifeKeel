'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouteParam } from '@/lib/useRouteParam'
import { ArrowLeft } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { fetchOperatorUser, type OperatorUserDossier } from '@/lib/api'

function fmt(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

/** One-screen support dossier — everything a ticket needs without opening
 *  four other pages: identity, workspace, security posture, insight
 *  activity, billing ledger tail, open support cases, and the operator
 *  actions already taken on this account. */
export default function OperatorUserDossierPage() {
  const userId = useRouteParam('/operator/users')
  const [data, setData] = useState<OperatorUserDossier | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    fetchOperatorUser(userId)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load user'))
  }, [userId])

  if (error) return <p className="text-sm text-danger">{error}</p>
  if (!data) return <div className="shimmer mt-4 h-64 rounded-2xl" />

  const { user, tenant, dossier } = data
  const locked = user.locked_until && new Date(user.locked_until) > new Date()

  return (
    <div>
      <Link
        href="/operator/users"
        className="flex items-center gap-1 text-xs text-ink-tertiary hover:text-ink-secondary"
      >
        <ArrowLeft size={12} /> Back to users
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{user.name}</h1>
          <p className="text-sm text-ink-secondary">{user.email}</p>
        </div>
        <div className="flex gap-2">
          {locked && (
            <span className="rounded-full border border-warning/40 px-2 py-0.5 text-xs text-warning">
              locked
            </span>
          )}
          <span
            className={`rounded-full border px-2 py-0.5 text-xs ${user.status === 'suspended' || user.status === 'erased' ? 'border-danger/25 text-danger' : 'border-success/25 text-success'}`}
          >
            {user.status ?? 'active'}
          </span>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <GlassCard className="p-4">
          <h2 className="text-sm font-semibold">Identity</h2>
          <dl className="mt-3 space-y-1.5 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-ink-tertiary">User ID</dt>
              <dd className="font-mono">{user.id}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-tertiary">Roles</dt>
              <dd>{user.roles.join(', ') || '—'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-tertiary">Email verified</dt>
              <dd>{user.email_verified ? 'yes' : 'no'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-tertiary">Sign-in method</dt>
              <dd>{user.external_provider ?? 'password'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-tertiary">Joined</dt>
              <dd>{fmt(user.created_at)}</dd>
            </div>
            {user.attribution?.utm_source && (
              <div className="flex justify-between gap-2">
                <dt className="text-ink-tertiary">Acquired via</dt>
                <dd className="text-family-400">
                  {user.attribution.utm_source}
                  {user.attribution.utm_campaign ? ` / ${user.attribution.utm_campaign}` : ''}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <dt className="text-ink-tertiary">Sessions revoked</dt>
              <dd>{fmt(user.sessions_revoked_at)}</dd>
            </div>
          </dl>
        </GlassCard>

        <GlassCard className="p-4">
          <h2 className="text-sm font-semibold">Workspace</h2>
          {tenant ? (
            <dl className="mt-3 space-y-1.5 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-ink-tertiary">Name</dt>
                <dd>{tenant.name ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-tertiary">Tenant</dt>
                <dd>
                  <Link
                    href={`/operator/tenants?q=${encodeURIComponent(user.tenant_id)}`}
                    className="font-mono text-family-400 hover:underline"
                  >
                    {user.tenant_id}
                  </Link>
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-tertiary">Plan</dt>
                <dd>{tenant.plan ?? 'free'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-tertiary">Status</dt>
                <dd>{tenant.status ?? 'unknown'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-tertiary">Health</dt>
                <dd
                  title={
                    tenant.health?.factors.map((f) => `${f.label} (${f.points})`).join('\n') ??
                    'No issues detected'
                  }
                >
                  {tenant.health?.score ?? '—'}/100
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-xs text-ink-tertiary">
              No tenant record found for <code>{user.tenant_id}</code>.
            </p>
          )}
        </GlassCard>

        <GlassCard className="p-4">
          <h2 className="text-sm font-semibold">Security — recent sign-ins</h2>
          <div className="mt-3 space-y-1.5">
            {dossier.recent_logins.map((login, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg bg-tint/[0.04] px-3 py-1.5 text-xs"
              >
                <span className={login.success ? 'text-success' : 'text-danger'}>
                  {login.success ? 'success' : 'failed'}
                  {login.method ? ` · ${login.method}` : ''}
                </span>
                <span className="text-ink-tertiary">
                  {login.ip ?? '—'} · {fmt(login.created_at)}
                </span>
              </div>
            ))}
            {dossier.recent_logins.length === 0 && (
              <p className="text-xs text-ink-tertiary">No sign-in events on record.</p>
            )}
          </div>
        </GlassCard>

        <GlassCard className="p-4">
          <h2 className="text-sm font-semibold">Insights delivered</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(dossier.insights).map(([state, count]) => (
              <span
                key={state}
                className="rounded-full border border-tint/[0.08] px-2.5 py-1 text-xs text-ink-secondary"
              >
                {state}: {count}
              </span>
            ))}
            {Object.keys(dossier.insights).length === 0 && (
              <p className="text-xs text-ink-tertiary">No insights on record.</p>
            )}
          </div>

          <h2 className="mt-5 text-sm font-semibold">Billing ledger</h2>
          <div className="mt-3 space-y-1.5">
            {dossier.ledger_tail.map((entry, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg bg-tint/[0.04] px-3 py-1.5 text-xs"
              >
                <span className="text-ink-secondary">
                  {entry.type} {entry.amount > 0 ? `+${entry.amount}` : entry.amount}
                  {entry.reason ? ` · ${entry.reason}` : ''}
                </span>
                <span className="text-ink-tertiary">
                  {entry.balance_after !== undefined ? `bal ${entry.balance_after} · ` : ''}
                  {fmt(entry.timestamp)}
                </span>
              </div>
            ))}
            {dossier.ledger_tail.length === 0 && (
              <p className="text-xs text-ink-tertiary">No ledger entries.</p>
            )}
          </div>
        </GlassCard>

        <GlassCard className="p-4">
          <h2 className="text-sm font-semibold">Support cases</h2>
          <div className="mt-3 space-y-1.5">
            {dossier.support_cases.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-lg bg-tint/[0.04] px-3 py-1.5 text-xs"
              >
                <span className="min-w-0 truncate text-ink-secondary">{c.subject}</span>
                <span
                  className={`ml-2 shrink-0 rounded-full border px-2 py-0.5 ${c.status === 'open' ? 'border-warning/40 text-warning' : 'border-tint/[0.08] text-ink-tertiary'}`}
                >
                  {c.status}
                </span>
              </div>
            ))}
            {dossier.support_cases.length === 0 && (
              <p className="text-xs text-ink-tertiary">No support cases.</p>
            )}
          </div>
          {dossier.support_cases.length > 0 && (
            <Link
              href={`/operator/support?q=${encodeURIComponent(user.email)}`}
              className="mt-2 inline-block text-xs text-family-400 hover:underline"
            >
              Open in support inbox →
            </Link>
          )}
        </GlassCard>

        <GlassCard className="p-4">
          <h2 className="text-sm font-semibold">Operator audit trail</h2>
          <div className="mt-3 space-y-1.5">
            {dossier.audit_trail.map((entry, i) => (
              <div key={i} className="rounded-lg bg-tint/[0.04] px-3 py-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-ink-secondary">{entry.action}</span>
                  <span className="text-ink-tertiary">{fmt(entry.created_at)}</span>
                </div>
                {entry.reason && <p className="mt-0.5 text-ink-tertiary">{entry.reason}</p>}
              </div>
            ))}
            {dossier.audit_trail.length === 0 && (
              <p className="text-xs text-ink-tertiary">No operator actions on this account.</p>
            )}
          </div>
        </GlassCard>
      </div>
    </div>
  )
}
