'use client'

/**
 * PRD-142 amendment 3 — which AI processors can receive what, and whether
 * their terms have been reviewed. Rendered from the API (the same registries
 * the gateway enforces), so it cannot drift from what actually runs. It says
 * "not reviewed" where that is the truth.
 */
import { useEffect, useState } from 'react'
import { GlassCard, PageHeader } from '@/components/Glass'
import { fetchAiDisclosure, type AiDisclosure } from '@/lib/api'
import {
  RETENTION_TEXT,
  RULE_TEXT,
  STATUS_TEXT,
  UNREVIEWED_NOTE,
  WHERE_TEXT,
} from '@/lib/ai-disclosure-copy'

export default function AiProcessingPage() {
  const [data, setData] = useState<AiDisclosure | null | undefined>(undefined)

  useEffect(() => {
    void fetchAiDisclosure().then(setData)
  }, [])

  const name = (id: string) => data?.processors.find((p) => p.id === id)?.name ?? id
  const anyUnreviewed = data?.processors.some((p) => p.status === 'terms_under_review')

  return (
    <div className="px-5 pt-2 pb-12">
      <PageHeader title="Who processes your documents" />
      <p className="text-sm text-ink-secondary leading-relaxed mt-2">{RULE_TEXT}</p>

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
          <h2 className="text-base font-semibold text-ink-primary mt-6 mb-2">Providers</h2>
          <div className="space-y-3">
            {data.processors.map((p) => (
              <GlassCard key={p.id} className="p-4">
                <div className="text-sm font-semibold text-ink-primary">{p.name}</div>
                <p className="text-xs text-ink-secondary mt-1">{STATUS_TEXT[p.status]}</p>
                <dl className="mt-2 space-y-1 text-xs text-ink-tertiary">
                  <div>
                    <dt className="inline font-medium">Where: </dt>
                    <dd className="inline">
                      {p.region ?? (p.hosting === 'hosted' ? 'Not yet confirmed' : 'LifeKeel')}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">What it keeps: </dt>
                    <dd className="inline">
                      {p.status === 'terms_under_review'
                        ? 'Not yet confirmed'
                        : p.retention.map((r) => RETENTION_TEXT[r] ?? r).join(' ')}
                    </dd>
                  </div>
                  {p.hosting === 'hosted' && (
                    <div>
                      <dt className="inline font-medium">Other companies it uses: </dt>
                      <dd className="inline">
                        {p.sub_processors === null
                          ? 'Not yet confirmed'
                          : p.sub_processors.join(', ') || 'None'}
                      </dd>
                    </div>
                  )}
                </dl>
              </GlassCard>
            ))}
          </div>
          {anyUnreviewed && (
            <p className="text-[11px] text-ink-tertiary mt-2 leading-relaxed">{UNREVIEWED_NOTE}</p>
          )}

          <h2 className="text-base font-semibold text-ink-primary mt-6 mb-2">What uses AI</h2>
          <div className="space-y-3">
            {data.tasks.map((t) => (
              <GlassCard key={t.task_id} className="p-4">
                <div className="text-sm font-medium text-ink-primary">{t.purpose}</div>
                <p className="text-xs text-ink-secondary mt-1">{WHERE_TEXT[t.where]}</p>
                {t.where !== 'device' && (
                  <p className="text-[11px] text-ink-tertiary mt-1">
                    May use: {t.processors.map(name).join(', ')}
                  </p>
                )}
              </GlassCard>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
