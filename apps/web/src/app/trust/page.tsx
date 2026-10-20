'use client'

/**
 * PRD-208 public trust page. Everything dynamic comes from GET /trust: the
 * claims that are evidenced and in date, the live processor table (the same
 * registry the product enforces) and the backup window. If a claim lapses it
 * disappears from here on its own.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { GlassCard, PageHeader } from '@/components/Glass'
import { fetchTrust, type TrustData } from '@/lib/api'
import { RETENTION_TEXT, STATUS_TEXT, UNREVIEWED_NOTE } from '@/lib/ai-disclosure-copy'
import {
  BACKUPS_LEAD,
  BACKUPS_TITLE,
  CLAIMS_EMPTY,
  CLAIMS_TITLE,
  EVIDENCE_LABEL,
  MONEY_TEXT,
  MONEY_TITLE,
  PROCESSORS_TITLE,
  TRUST_INTRO,
  TRUST_TITLE,
} from '@/lib/trust-copy'

function H2({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-base font-semibold text-ink-primary mt-8 mb-2">
      {children}
    </h2>
  )
}

export default function TrustPage() {
  const [data, setData] = useState<TrustData | null | undefined>(undefined)
  useEffect(() => {
    void fetchTrust().then(setData)
  }, [])

  return (
    <div className="px-5 pt-2 pb-12">
      <PageHeader title={TRUST_TITLE} />
      <p className="text-sm text-ink-secondary leading-relaxed mt-2">{TRUST_INTRO}</p>

      <H2>{MONEY_TITLE}</H2>
      <p className="text-sm text-ink-secondary leading-relaxed">{MONEY_TEXT}</p>

      {data === undefined && <div className="shimmer h-32 rounded-2xl mt-4" />}
      {data === null && (
        <GlassCard className="p-4 mt-4">
          <p className="text-sm text-ink-secondary">
            This information is not available right now. Try again in a moment.
          </p>
        </GlassCard>
      )}

      {data && (
        <>
          <H2>{CLAIMS_TITLE}</H2>
          {data.claims.length === 0 ? (
            <p className="text-sm text-ink-secondary">{CLAIMS_EMPTY}</p>
          ) : (
            <ul className="space-y-3">
              {data.claims.map((c) => (
                <li key={c.id}>
                  <GlassCard className="p-4">
                    <p className="text-sm text-ink-primary">{c.statement}</p>
                    {c.evidence && (
                      <p className="text-xs text-ink-tertiary mt-1.5">
                        {EVIDENCE_LABEL[c.evidence.kind]}:{' '}
                        {c.evidence.href ? (
                          <Link href={c.evidence.href} className="text-family-400 font-medium">
                            {c.evidence.how}
                          </Link>
                        ) : (
                          c.evidence.how
                        )}{' '}
                        Last confirmed {c.verified_at.slice(0, 10)}.
                      </p>
                    )}
                  </GlassCard>
                </li>
              ))}
            </ul>
          )}

          <H2 id="processors">{PROCESSORS_TITLE}</H2>
          <div className="space-y-3">
            {data.ai.processors.map((p) => (
              <GlassCard key={p.id} className="p-4">
                <div className="text-sm font-semibold text-ink-primary">{p.name}</div>
                <p className="text-xs text-ink-secondary mt-1">{STATUS_TEXT[p.status]}</p>
                <p className="text-xs text-ink-tertiary mt-1">
                  {p.status === 'terms_under_review'
                    ? 'What it keeps: not yet confirmed.'
                    : p.retention.map((r) => RETENTION_TEXT[r] ?? r).join(' ')}
                </p>
              </GlassCard>
            ))}
          </div>
          {data.ai.processors.some((p) => p.status === 'terms_under_review') && (
            <p className="text-[11px] text-ink-tertiary mt-2 leading-relaxed">{UNREVIEWED_NOTE}</p>
          )}

          <H2>{BACKUPS_TITLE}</H2>
          <p className="text-sm text-ink-secondary leading-relaxed">
            {BACKUPS_LEAD} {data.backups.statement}
          </p>
        </>
      )}

      <p className="text-xs text-ink-tertiary mt-8">
        <Link href="/security" className="text-family-400 font-medium">
          Report a security problem
        </Link>
      </p>
    </div>
  )
}
