'use client'

import { useRef, useState } from 'react'
import { GlassCard } from '@/components/Glass'
import type { DomainView } from '@/lib/api'
import { parseSentence, type Draft } from '@/lib/capture/parse-sentence'
import { DICTATION_TIP } from './domain-copy'
import { VoiceInput } from './VoiceInput'

/** "2027-05-09" as "9 May 2027", the way people say it. */
function niceDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
}

const primaryBtn =
  'inline-flex min-h-[48px] items-center justify-center rounded-full bg-family-500 px-5 text-base font-semibold text-white disabled:opacity-50'
const ghostBtn =
  'inline-flex min-h-[48px] items-center rounded-full border border-haze px-4 text-base font-medium text-ink-primary'

/**
 * Say or type one sentence; see what we understood; save only if it is right.
 * Nothing is saved until the person taps Save, and nothing leaves the device
 * to read the sentence.
 */
export function SentenceCapture({
  view,
  busy,
  onAdd,
}: {
  view: DomainView
  busy: boolean
  onAdd: (record: string, holder: string | null, values: Record<string, string>) => Promise<boolean>
}) {
  const [text, setText] = useState('')
  const [result, setResult] = useState<{ drafts: Draft[]; unused: string } | null>(null)
  const [saved, setSaved] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const stores = view.pack.records.filter((r) => r.source.kind === 'store')
  if (!view.can_edit || stores.length === 0) return null

  const nameOf = (id: string) => view.roster.find((m) => m.id === id)?.name ?? id
  const draft = result?.drafts[0] ?? null
  const rec = draft ? view.pack.records.find((r) => r.key === draft.record) : null

  function prepare() {
    setSaved(false)
    setResult(parseSentence(text, view.pack, view.roster))
    requestAnimationFrame(() => headingRef.current?.focus())
  }

  return (
    <GlassCard className="mt-6 space-y-3 p-5">
      <label htmlFor="sentence" className="block text-base font-medium text-ink-primary">
        Tell us in one sentence
      </label>
      <p className="text-sm text-ink-secondary">
        For example: &quot;MOT due 9 May on AB12 CDE, Sam&apos;s car.&quot; {DICTATION_TIP}
      </p>
      <VoiceInput onText={(t) => setText(t)} />
      <textarea
        id="sentence"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        autoComplete="off"
        autoCapitalize="sentences"
        className="w-full rounded-xl border border-haze bg-surface-1 p-3 text-base text-ink-primary focus:outline-none focus:ring-2 focus:ring-family-500"
      />
      <button type="button" onClick={prepare} disabled={!text.trim()} className={primaryBtn}>
        Show me what you understood
      </button>

      {result && (
        <div className="space-y-3 border-t border-haze pt-3">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-medium text-ink-primary focus:outline-none"
          >
            {draft ? 'Check this before it is saved' : 'We could not read that'}
          </h2>
          {draft && rec ? (
            <>
              <dl className="space-y-1 text-base">
                <div className="flex gap-2">
                  <dt className="text-ink-tertiary">Adding</dt>
                  <dd className="text-ink-primary">{draft.recordLabel}</dd>
                </div>
                {draft.holderMemberId && (
                  <div className="flex gap-2">
                    <dt className="text-ink-tertiary">Whose</dt>
                    <dd className="text-ink-primary">{nameOf(draft.holderMemberId)}</dd>
                  </div>
                )}
                {rec.fields.map((f) => {
                  const v = draft.values[f.key]
                  if (!v) return null
                  return (
                    <div key={f.key} className="flex gap-2">
                      <dt className="text-ink-tertiary">{f.label}</dt>
                      <dd className="break-normal text-ink-primary">
                        {f.kind === 'member'
                          ? nameOf(v)
                          : f.kind === 'money'
                            ? `£${v}`
                            : f.kind === 'date'
                              ? niceDate(v)
                              : v.replace(/_/g, ' ')}
                      </dd>
                    </div>
                  )
                })}
              </dl>
              {result.unused && (
                <p className="text-sm text-ink-secondary">We did not use: {result.unused}.</p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className={primaryBtn}
                  onClick={async () => {
                    if (await onAdd(draft.record, draft.holderMemberId, draft.values)) {
                      setText('')
                      setResult(null)
                      setSaved(true)
                    }
                  }}
                >
                  Save to the family list
                </button>
                <button type="button" className={ghostBtn} onClick={() => setResult(null)}>
                  Not right
                </button>
              </div>
            </>
          ) : (
            <p className="text-base text-ink-secondary">
              We could not find a date, plate, amount or name in that. Add a little more, or use the
              form below.
            </p>
          )}
        </div>
      )}
      {saved && (
        <p role="status" className="text-base text-ink-primary">
          Saved to the family list.
        </p>
      )}
    </GlassCard>
  )
}
