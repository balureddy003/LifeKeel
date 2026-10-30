'use client'

/**
 * Factual household briefs — pick what is changing, enter the household's
 * facts, get one deterministic answer both adults confirm they have seen.
 * New briefs are addressed to a named adult; the creator and that adult each
 * confirm the same stored result.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronRight,
  Clock,
  Copy,
  MessageSquare,
  Pencil,
  Search,
  Share2,
  Sparkles,
} from 'lucide-react'
import { GlassCard, PageHeader, Skeleton } from '@/components/Glass'
import {
  confirmBrief,
  createBrief,
  deleteBrief,
  getBrief,
  getBriefCatalogue,
  listBriefs,
  previewBrief,
  reShareBrief,
  revokeBriefShare,
  type BriefCatalogueEntry,
  type BriefPreview,
  type HouseholdBrief,
} from '@/lib/api'
import { track } from '@/lib/growth-track'
import { haptic } from '@/lib/haptics'
import { useConfirm } from '@/components/ConfirmSheetProvider'
import { useToast } from '@/components/Toast'
import { motion, useReducedMotion } from 'framer-motion'
import { MOMENTS, type MomentKey } from './moments'
import { CountUp } from './CountUp'
import { RunwayChart } from './RunwayChart'
import { WhatIf } from './WhatIf'
import { countdownText, daysUntil } from './what-if'
import { briefHeadline, runsOutAround, splitBriefSentence } from '@/lib/brief-text'
import {
  MAX_STEPS,
  buildInputs,
  dateChips,
  inputsToForm,
  needs,
  remainingFields,
  stepCount,
  validate,
  TODAY_KEYS,
  validateStep,
  type FormValues,
} from './brief-form'

const inputCls =
  'mt-1 w-full min-h-[48px] rounded-xl border border-haze bg-surface-1 px-3 text-ink-primary placeholder:text-ink-tertiary focus:outline-none focus:ring-2 focus:ring-family-500'
const primaryBtn =
  'inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-family-500 px-6 text-base font-semibold text-white disabled:opacity-50'
const ghostBtn =
  'inline-flex min-h-[44px] items-center gap-2 rounded-full border border-haze px-4 text-sm font-medium text-ink-secondary'

function Field({
  id,
  label,
  hint,
  error,
  prefix,
  children,
}: {
  id: string
  label: string
  hint?: string | undefined
  error?: string | undefined
  prefix?: string | undefined
  children: (props: {
    id: string
    describedBy: string | undefined
    invalid: boolean
  }) => React.ReactNode
}) {
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ')
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink-primary">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-ink-tertiary">
          {hint}
        </p>
      )}
      <div className="relative">
        {prefix && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1 flex min-h-[48px] items-center text-ink-tertiary"
          >
            {prefix}
          </span>
        )}
        {children({ id, describedBy: describedBy || undefined, invalid: !!error })}
      </div>
      {error && (
        <p id={`${id}-err`} role="alert" className="mt-1 text-sm text-red-500">
          {error}
        </p>
      )}
    </div>
  )
}

function Money({
  k,
  label,
  hint,
  f,
  set,
  errors,
}: {
  k: string
  label: string
  hint?: string | undefined
  f: FormValues
  set: (v: FormValues) => void
  errors: Record<string, string>
}) {
  return (
    <Field id={`f-${k}`} label={label} hint={hint} error={errors[k]} prefix="£">
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          name={k}
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={f[k] ?? ''}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          onChange={(e) => set({ ...f, [k]: e.target.value })}
          className={`${inputCls} pl-7`}
        />
      )}
    </Field>
  )
}

function DateField({
  k,
  label,
  hint,
  f,
  set,
  errors,
}: {
  k: string
  label: string
  hint?: string | undefined
  f: FormValues
  set: (v: FormValues) => void
  errors: Record<string, string>
}) {
  return (
    <Field id={`f-${k}`} label={label} hint={hint} error={errors[k]}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          name={k}
          type="date"
          value={f[k] ?? ''}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          onChange={(e) => set({ ...f, [k]: e.target.value })}
          className={inputCls}
        />
      )}
    </Field>
  )
}

function StepRows({
  f,
  set,
  errors,
}: {
  f: FormValues
  set: (v: FormValues) => void
  errors: Record<string, string>
}) {
  const n = stepCount(f)
  const p = { f, set, errors }
  function remove(at: number) {
    const next: FormValues = {}
    for (const [k, v] of Object.entries(f)) {
      const m = k.match(/^(step_\w+):(\d+)$/)
      if (!m) next[k] = v
      else if (Number(m[2]) < at) next[k] = v
      else if (Number(m[2]) > at) next[`${m[1]}:${Number(m[2]) - 1}`] = v
    }
    next['steps_n'] = String(n - 1)
    set(next)
  }
  return (
    <div>
      <p className="text-sm font-medium text-ink-primary">Later changes</p>
      <p className="text-xs text-ink-tertiary">
        For example, pay that steps down and then back up. Each one starts on its date and carries
        on until the next.
      </p>
      {Array.from({ length: n }).map((_, i) => (
        <fieldset key={i} className="mt-3 rounded-xl border border-haze p-3">
          <legend className="px-1 text-sm font-medium text-ink-secondary">Change {i + 1}</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DateField k={`step_date:${i}`} label="From this date" {...p} />
            <Money
              k={`step_income:${i}`}
              label="Money coming in from then"
              hint="Optional"
              {...p}
            />
            <Money
              k={`step_essentials:${i}`}
              label="Money going out from then"
              hint="Optional"
              {...p}
            />
            <Money k={`step_cash:${i}`} label="One-off cash received" hint="Optional" {...p} />
          </div>
          <button
            type="button"
            onClick={() => remove(i)}
            className="mt-2 min-h-[44px] text-sm text-ink-secondary underline"
          >
            Remove this change
          </button>
        </fieldset>
      ))}
      {n < MAX_STEPS && (
        <button
          type="button"
          onClick={() => set({ ...f, steps_n: String(n + 1) })}
          className="mt-3 inline-flex min-h-[44px] items-center rounded-full border border-haze px-4 text-sm font-medium text-ink-secondary"
        >
          + Add a later change
        </button>
      )}
    </div>
  )
}

function DateChips({ f, set }: { f: FormValues; set: (v: FormValues) => void }) {
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div role="group" aria-label="Quick dates" className="mt-2 flex flex-wrap gap-2">
      {dateChips(today).map((c) => {
        const on = f['change_date'] === c.value
        return (
          <button
            key={c.label}
            type="button"
            aria-pressed={on}
            onClick={() => set({ ...f, change_date: c.value })}
            className={`min-h-[40px] rounded-full border px-3 text-sm transition-colors ${
              on
                ? 'border-family-500 bg-family-500/10 text-ink-primary'
                : 'border-haze text-ink-secondary'
            }`}
          >
            {c.label}
          </button>
        )
      })}
    </div>
  )
}

function BriefFields({
  entry,
  f,
  set,
  errors,
  step,
}: {
  entry: BriefCatalogueEntry
  f: FormValues
  set: (v: FormValues) => void
  errors: Record<string, string>
  step: 1 | 2
}) {
  const p = { f, set, errors }
  if (entry.mode === 'handover') {
    return (
      <div className="space-y-4">
        <DateField
          k="change_date"
          label={entry.trigger}
          hint="Today's date is fine if this is a record of how things stand."
          {...p}
        />
        {errors['facts'] && (
          <p role="alert" className="text-sm text-red-500">
            {errors['facts']}
          </p>
        )}
        {(entry.fields ?? []).map((label, idx) => (
          <Field key={label} id={`f-fact-${idx}`} label={label}>
            {({ id }) => (
              <textarea
                id={id}
                rows={2}
                maxLength={2000}
                value={f[`fact:${label}`] ?? ''}
                onChange={(e) => set({ ...f, [`fact:${label}`]: e.target.value })}
                className={`${inputCls} py-2`}
              />
            )}
          </Field>
        ))}
        <p className="text-xs text-ink-tertiary">
          Record where things are, never a password, code or recovery key.
        </p>
        {entry.sensitive && (
          <div className="rounded-xl border border-haze bg-surface-1 p-4">
            <label className="flex items-start gap-3 text-sm text-ink-secondary">
              <input
                type="checkbox"
                checked={f['consent'] === 'yes'}
                onChange={(e) => set({ ...f, consent: e.target.checked ? 'yes' : '' })}
                className="mt-1 h-5 w-5"
              />
              <span>
                These are sensitive details. I am happy to record them and share them with the named
                adult only. They are encrypted, and I can delete them at any time.
              </span>
            </label>
            {errors['consent'] && (
              <p role="alert" className="mt-2 text-sm text-red-500">
                {errors['consent']}
              </p>
            )}
          </div>
        )}
      </div>
    )
  }
  const n = needs(entry)
  return (
    <div className="space-y-4">
      {step === 1 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Money
            k="income"
            label="Money coming in each month"
            hint="Household take-home, after tax"
            {...p}
          />
          <Money
            k="essentials"
            label="Money going out each month"
            hint="Bills, food, travel: what you need"
            {...p}
          />
          <Money
            k="savings"
            label="Savings you could use now"
            hint="Cash, not investments"
            {...p}
          />
        </div>
      )}
      {step === 2 && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <DateField
                k="change_date"
                label={entry.trigger}
                hint="A date that has passed is fine if this is already happening."
                {...p}
              />
              <DateChips f={f} set={set} />
            </div>
            {n.newIncome && (
              <Money
                k="new_income"
                label="Money coming in after the change"
                hint="Total household income, including pay that continues"
                {...p}
              />
            )}
            {n.newEssentials && (
              <Money
                k="new_essentials"
                label="Money going out after the change"
                hint="Total monthly spending from then"
                {...p}
              />
            )}
            {n.cash && (
              <>
                <Money k="cash_out" label="One-off payment from savings" {...p} />
                <Money k="cash_in" label="One-off cash received" hint="Optional" {...p} />
              </>
            )}
          </div>

          <details
            className="rounded-xl border border-haze bg-surface-1 p-4"
            onToggle={(e) => {
              if ((e.target as HTMLDetailsElement).open)
                track('brief_form_step', { step: 'optional_opened', problem_type: entry.id })
            }}
          >
            <summary className="cursor-pointer text-sm font-medium text-ink-primary">
              Add more detail (optional)
            </summary>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {n.cover && (
                <>
                  <Money
                    k="ip"
                    label="Cover payment each month"
                    hint="If you have any on file"
                    {...p}
                  />
                  <Field id="f-defer" label="Cover waiting period (months)">
                    {({ id }) => (
                      <input
                        id={id}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={f['defer'] ?? ''}
                        onChange={(e) => set({ ...f, defer: e.target.value })}
                        className={inputCls}
                      />
                    )}
                  </Field>
                  <DateField k="cover_end" label="Cover payments end" {...p} />
                </>
              )}
              {n.laterChange && (
                <>
                  <DateField k="return_date" label="Return or end date" {...p} />
                  {f['return_date'] && (
                    <>
                      <Money k="return_income" label="Money coming in from then" {...p} />
                      <Money k="return_essentials" label="Money going out from then" {...p} />
                    </>
                  )}
                </>
              )}
              <Field id="f-recorded_cover" label="Notes about cover or end dates">
                {({ id }) => (
                  <input
                    id={id}
                    type="text"
                    maxLength={600}
                    value={f['recorded_cover'] ?? ''}
                    onChange={(e) => set({ ...f, recorded_cover: e.target.value })}
                    className={inputCls}
                  />
                )}
              </Field>
              <DateField k="decision_deadline" label="A date you are working to" {...p} />
              <div className="sm:col-span-2">
                <StepRows {...p} />
              </div>
            </div>
          </details>
        </>
      )}
    </div>
  )
}

function Status({ b, other }: { b: HouseholdBrief; other: string }) {
  const c = b.confirmation
  const chip = (done: boolean, text: string) => (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
        done ? 'bg-green-500/15 text-green-600' : 'bg-surface-2 text-ink-tertiary'
      }`}
    >
      {done ? <Check size={12} aria-hidden="true" /> : <Clock size={12} aria-hidden="true" />}
      {text}
    </span>
  )
  return (
    <div className="flex flex-wrap gap-2">
      {chip(!!c?.creator_at, c?.creator_at ? 'You confirmed' : 'You have not confirmed')}
      {chip(!!c?.recipient_at, c?.recipient_at ? `${other} confirmed` : `Waiting for ${other}`)}
    </div>
  )
}

function ResultCard({
  brief,
  origin,
  onChanged,
}: {
  brief: HouseholdBrief
  origin: string
  onChanged: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [copiedMsg, setCopiedMsg] = useState(false)
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const url = brief.share?.url ? `${origin}/b/${brief.share.url}` : null
  const other = brief.share?.for_member_name ?? 'the other adult'
  const runway = brief.result?.['projectedRunwayMonths']
  const { main, note } = splitBriefSentence(brief.template_sentence)
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      haptic('success')
      toast({ message: 'Link copied' })
    } catch {
      toast({
        message: 'Could not copy. Press and hold the link above to copy it.',
        variant: 'error',
      })
    }
  }

  async function copyMessage() {
    if (!url) return
    const text = `Hi ${other} — I've put some numbers together for us (“${brief.title ?? 'a household brief'}”). Could you have a look and confirm once you've read it? ${url}`
    try {
      await navigator.clipboard.writeText(text)
      setCopiedMsg(true)
      setTimeout(() => setCopiedMsg(false), 2000)
      haptic('success')
      toast({ message: `Message copied. Paste it to ${other}.` })
    } catch {
      toast({ message: 'Could not copy the message.', variant: 'error' })
    }
  }

  async function confirm() {
    if (!brief.result_version) return
    setBusy(true)
    await confirmBrief(brief.id, brief.result_version)
    setBusy(false)
    onChanged()
  }

  return (
    <GlassCard className="space-y-5 p-6">
      <div>
        <p className="text-sm font-medium text-ink-tertiary">{brief.title}</p>
        {typeof runway === 'number' && (
          <p className="mt-2 text-ink-primary">
            <span className="text-5xl font-semibold tracking-tight">
              <CountUp value={runway} decimals={runway % 1 === 0 ? 0 : 1} />
            </span>
            <span className="ml-2 text-lg text-ink-secondary">
              months of savings after the change
            </span>
          </p>
        )}
        <p className="mt-3 text-xl font-medium leading-snug text-ink-primary">
          {briefHeadline(main)}
        </p>
        <details className="mt-2">
          <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-medium text-family-400">
            How this was worked out
          </summary>
          <p className="text-ink-secondary">{main}</p>
          {note && <p className="mt-2 text-xs text-ink-tertiary">{note}</p>}
        </details>
        <RunwayChart
          result={brief.result}
          startSavings={Number(brief.inputs?.liquid_savings_minor ?? 0)}
          runsOutLabel={runsOutAround(brief.template_sentence)}
        />
      </div>

      {brief.confirmation?.both_confirmed && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-2xl border border-green-500/30 bg-green-500/10 p-4"
        >
          <Check className="shrink-0 text-green-600" aria-hidden="true" />
          <p className="text-sm font-medium text-ink-primary">
            You have both seen the same numbers.
          </p>
        </div>
      )}

      {(brief.facts ?? []).length > 0 && (
        <dl className="space-y-1 text-sm">
          {brief.facts!.map((x, i) => (
            <div key={i} className="flex justify-between gap-4 border-b border-haze pb-1">
              <dt className="text-ink-tertiary">{x.label}</dt>
              <dd
                className={`text-right text-ink-primary ${
                  x.value.length <= 24 ? 'shrink-0 whitespace-nowrap' : 'min-w-0 break-words'
                }`}
              >
                {x.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <WhatIf brief={brief} />

      <div className="rounded-2xl border border-haze bg-surface-1 p-4">
        <p className="text-sm font-medium text-ink-primary">Two quick steps</p>
        <ol className="mt-4 space-y-5">
          <li className="flex gap-3">
            <span
              aria-hidden="true"
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                brief.confirmation?.creator_at
                  ? 'bg-green-500/20 text-green-600'
                  : 'bg-family-500 text-white'
              }`}
            >
              {brief.confirmation?.creator_at ? <Check size={16} /> : '1'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink-primary">Read your answer, then confirm</p>
              <p className="text-sm text-ink-secondary">
                This records that you have seen this exact version.
              </p>
              {brief.confirmation?.creator_at ? (
                <p className="mt-2 text-sm font-medium text-green-600">You confirmed</p>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void confirm()}
                  className="mt-3 inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-family-500 px-5 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"
                >
                  {busy ? 'Saving…' : 'I have read this'}
                </button>
              )}
            </div>
          </li>
          <li className="flex gap-3">
            <span
              aria-hidden="true"
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                brief.confirmation?.recipient_at
                  ? 'bg-green-500/20 text-green-600'
                  : 'bg-surface-2 text-ink-secondary'
              }`}
            >
              {brief.confirmation?.recipient_at ? <Check size={16} /> : '2'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink-primary">Send the link to {other}</p>
              <p className="text-sm text-ink-secondary">
                They sign in, read it and confirm too. The link works for 30 days.
              </p>
              {url && (
                <>
                  <code className="mt-3 block truncate rounded-lg bg-surface-2 px-3 py-2 text-xs">
                    {url}
                  </code>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void copy()} className={ghostBtn}>
                      {copied ? <Check size={16} /> : <Copy size={16} />}{' '}
                      {copied ? 'Copied' : 'Copy link'}
                    </button>
                    <button type="button" onClick={() => void copyMessage()} className={ghostBtn}>
                      {copiedMsg ? <Check size={16} /> : <MessageSquare size={16} />}{' '}
                      {copiedMsg ? 'Copied' : 'Copy a message'}
                    </button>
                    {canShare && (
                      <button
                        type="button"
                        onClick={() =>
                          void navigator
                            .share({ title: brief.title ?? 'A household brief', url })
                            .catch(() => {})
                        }
                        className={ghostBtn}
                      >
                        <Share2 size={16} /> Share
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </li>
        </ol>
        <div className="mt-5">
          <Status b={brief} other={other} />
        </div>
      </div>
    </GlassCard>
  )
}

function Glance({
  brief,
  title,
  canUpdate,
  onWhatIf,
  onUpdate,
}: {
  brief: HouseholdBrief
  title: string
  canUpdate: boolean
  onWhatIf: () => void
  onUpdate: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const date = typeof brief.inputs?.change_date === 'string' ? brief.inputs.change_date : null
  const days = date ? daysUntil(date, today) : null
  const other = brief.share?.for_member_name ?? 'the other adult'
  const c = brief.confirmation
  const next = !c?.creator_at
    ? 'Read it and confirm, so you can both see the same numbers.'
    : !c.recipient_at
      ? `Waiting for ${other} to read and confirm.`
      : 'You have both seen the same numbers. Things change, so update the figures when they do.'
  return (
    <GlassCard className="mt-6 p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">
        Your latest brief
      </p>
      <p className="mt-1 text-lg font-semibold text-ink-primary">{title}</p>
      {days !== null && (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-secondary">
          <CalendarClock size={16} aria-hidden="true" /> The change {countdownText(days)}
          {days >= 0 && days <= 7 && (
            <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-700">
              Coming up soon
            </span>
          )}
          {days < 0 && c?.both_confirmed && (
            <span className="rounded-full bg-family-500/15 px-2.5 py-0.5 text-xs font-medium text-ink-primary">
              Time to update?
            </span>
          )}
        </p>
      )}
      <p className="mt-2 text-sm text-ink-secondary">{next}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={onWhatIf} className={ghostBtn}>
          Try a what-if
        </button>
        {canUpdate && (
          <button type="button" onClick={onUpdate} className={ghostBtn}>
            <Pencil size={16} aria-hidden="true" /> Update the figures
          </button>
        )}
      </div>
    </GlassCard>
  )
}

export default function BriefsPage() {
  const [loaded, setLoaded] = useState(false)
  const [canCreate, setCanCreate] = useState(true)
  const [preview, setPreview] = useState<{
    state: 'idle' | 'loading' | 'ready' | 'error'
    data?: BriefPreview
    error?: string
  }>({ state: 'idle' })
  const [catalogue, setCatalogue] = useState<BriefCatalogueEntry[]>([])
  const [recipients, setRecipients] = useState<Array<{ id: string; name: string }>>([])
  const [briefs, setBriefs] = useState<HouseholdBrief[]>([])
  const [moment, setMoment] = useState<MomentKey | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [query, setQuery] = useState('')
  const [entry, setEntry] = useState<BriefCatalogueEntry | null>(null)
  const [forMember, setForMember] = useState('')
  const [f, setF] = useState<FormValues>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<HouseholdBrief | null>(null)
  const [gateHit, setGateHit] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [updatingFrom, setUpdatingFrom] = useState<string | null>(null)
  const [step, setStep] = useState<1 | 2>(1)
  const reduce = useReducedMotion()
  const confirmSheet = useConfirm()
  const toast = useToast()
  const formRef = useRef<HTMLDivElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void getBriefCatalogue().then((c) => {
      setCatalogue(c.catalogue)
      setRecipients(c.recipients)
      setCanCreate(c.can_create !== false)
      setForMember(c.recipients[0]?.id ?? '')
      setLoaded(true)
    })
    void listBriefs().then(setBriefs)
  }, [])

  const byId = useMemo(() => new Map(catalogue.map((e) => [e.id, e])), [catalogue])
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const recipientName = recipients.find((r) => r.id === forMember)?.name ?? 'the other adult'

  function choose(e: BriefCatalogueEntry, prefill?: FormValues, from?: string) {
    setEntry(e)
    setF(prefill ?? {})
    setStep(1)
    setUpdatingFrom(from ?? null)
    setErrors({})
    setError(null)
    setGateHit(false)
    setCreated(null)
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  async function newLink(b: HouseholdBrief, other: string) {
    const active = b.share && !b.share.revoked
    if (
      active &&
      !(await confirmSheet({
        title: 'Make a new link?',
        message:
          'The old link stops working, and you will both need to confirm again. Send the new link to ' +
          other +
          '.',
        confirmLabel: 'Make a new link',
      }))
    )
      return
    const r = await reShareBrief(b.id)
    if (r.ok && r.data?.share.url) {
      const link = `${origin}/b/${r.data.share.url}`
      try {
        await navigator.clipboard.writeText(link)
        haptic('success')
        toast({ message: `New link copied. Send it to ${other}.` })
      } catch {
        toast({ message: 'The new link is ready, but it could not be copied.', variant: 'error' })
      }
    }
    void refresh()
  }

  async function remove(b: HouseholdBrief) {
    const ok = await confirmSheet({
      title: 'Delete this brief?',
      message: 'It will be removed for both of you. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    await deleteBrief(b.id)
    haptic('warning')
    toast({ message: 'Brief deleted' })
    void refresh()
  }

  /** Start a new brief from the figures entered last time. */
  function startUpdate(b: HouseholdBrief) {
    const e = byId.get(b.problem_type)
    if (!e || e.mode === 'handover' || !b.inputs) return
    track('brief_update_started', { problem_type: e.id })
    choose(e, inputsToForm(e, b.inputs), new Date(b.created_at).toLocaleDateString('en-GB'))
  }

  function openBrief(id: string) {
    setOpen(id)
    setTimeout(
      () =>
        document
          .getElementById(`brief-${id}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      50,
    )
  }

  function back() {
    setEntry(null)
    setErrors({})
    setError(null)
    setGateHit(false)
  }

  async function refresh(id?: string) {
    setBriefs(await listBriefs())
    if (id && created?.id === id) {
      const b = await getBrief(id)
      if (b) setCreated({ ...b, share: b.share ?? created.share })
    }
  }

  // The answer as the household types: same solver, nothing saved or shared.
  useEffect(() => {
    if (!entry || entry.mode === 'handover' || entry.sensitive || !canCreate) {
      setPreview({ state: 'idle' })
      return
    }
    if (Object.keys(validate(entry, f)).length) {
      setPreview({ state: 'idle' })
      return
    }
    let cancelled = false
    setPreview((p) => ({ ...p, state: 'loading' }))
    const timer = setTimeout(async () => {
      const res = await previewBrief({ problem_type: entry.id, inputs: buildInputs(entry, f) })
      if (cancelled) return
      if (res.ok) setPreview({ state: 'ready', data: res.data!.preview })
      else
        setPreview({
          state: 'error',
          // A 400 is about the figures; anything else is not the household's doing.
          error:
            res.status === 400
              ? ((res.data as { error?: string } | undefined)?.error ?? 'Check the figures')
              : 'The live answer is not available right now. You can still create the brief.',
        })
    }, 600)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [entry, f, canCreate])

  function continueStep() {
    if (!entry) return
    const found = validateStep(entry, f, 1)
    setErrors(found)
    if (Object.keys(found).length) {
      document.getElementById(`f-${Object.keys(found)[0]}`)?.focus()
      return
    }
    haptic('light')
    setStep(2)
    track('brief_form_step', { step: 'change_opened', problem_type: entry.id })
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  async function submit() {
    if (!entry) return
    const found = validate(entry, f)
    setErrors(found)
    if (Object.keys(found).length) {
      const first = Object.keys(found)[0]!
      if (entry.mode !== 'handover' && (TODAY_KEYS as readonly string[]).includes(first)) {
        setStep(1)
        setTimeout(() => document.getElementById(`f-${first}`)?.focus(), 80)
        return
      }
      // Errors inside the optional section need it open to be seen.
      if (first.startsWith('step_') || first === 'return_date')
        document.querySelector('details')?.setAttribute('open', '')
      document
        .getElementById(first === 'facts' || first === 'consent' ? 'f-fact-0' : `f-${first}`)
        ?.focus()
      return
    }
    if (!forMember) {
      setError('Choose the other adult to share this with.')
      return
    }
    setBusy(true)
    setError(null)
    setGateHit(false)
    const res = await createBrief({
      contract_version: 2,
      problem_type: entry.id,
      inputs: buildInputs(entry, f),
      for_member_id: forMember,
    })
    setBusy(false)
    if (!res.ok) {
      if (res.status === 402) return setGateHit(true)
      return setError(
        (res.data as { error?: string })?.error ?? 'We could not create the brief. Try again.',
      )
    }
    setCreated(res.data!.brief)
    setEntry(null)
    setBriefs(await listBriefs())
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const moments = MOMENTS.map((m) => ({
    ...m,
    items: catalogue.filter((e) => e.moment === m.key),
  }))
  const q = query.trim().toLowerCase()
  const searchHits = q
    ? catalogue.filter(
        (e) => e.title.toLowerCase().includes(q) || e.group.toLowerCase().includes(q),
      )
    : catalogue
  const groups = [...new Set(searchHits.map((e) => e.group))]

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16">
      <PageHeader
        title="Household briefs"
        subtitle="One question, a few facts, one answer you both confirm you have seen."
      />

      {!loaded && (
        <div className="mt-6 space-y-3" role="status" aria-label="Loading">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {loaded && !canCreate && (
        <GlassCard className="mt-6 p-5">
          <p className="font-medium text-ink-primary">You can read briefs but not create them</p>
          <p className="mt-1 text-sm text-ink-secondary">
            Briefs are made by an organiser or parent in the household. Ask them to make one for
            you, and it will appear here to read and confirm.
          </p>
        </GlassCard>
      )}

      {loaded && canCreate && recipients.length === 0 && (
        <GlassCard className="mt-6 p-5">
          <p className="font-medium text-ink-primary">Add the other adult first</p>
          <p className="mt-1 text-sm text-ink-secondary">
            A brief is shared with one other adult in your household, and you each confirm it.
          </p>
          <Link href="/family" className={`${ghostBtn} mt-4`}>
            Go to Family <ChevronRight size={16} aria-hidden="true" />
          </Link>
        </GlassCard>
      )}

      {created && (
        <div ref={resultRef} className="mt-6 scroll-mt-40">
          <ResultCard brief={created} origin={origin} onChanged={() => void refresh(created.id)} />
          <button type="button" onClick={() => setCreated(null)} className={`${ghostBtn} mt-4`}>
            Start another
          </button>
        </div>
      )}

      {loaded &&
        canCreate &&
        recipients.length > 0 &&
        !entry &&
        !created &&
        briefs.length === 0 && (
          <GlassCard className="mt-6 flex items-start gap-3 p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-family-500/10 text-family-400">
              <Sparkles size={20} aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium text-ink-primary">Your first brief is free</p>
              <p className="mt-1 text-sm text-ink-secondary">
                It takes about 2 minutes. You will see your answer as you go, and nothing is shared
                until you send the link.
              </p>
            </div>
          </GlassCard>
        )}

      {loaded && canCreate && !entry && !created && briefs[0] && (
        <Glance
          brief={briefs[0]}
          title={briefs[0].title ?? byId.get(briefs[0].problem_type)?.title ?? 'Your brief'}
          canUpdate={
            byId.get(briefs[0].problem_type)?.mode !== 'handover' &&
            !!byId.get(briefs[0].problem_type)
          }
          onWhatIf={() => openBrief(briefs[0]!.id)}
          onUpdate={() => startUpdate(briefs[0]!)}
        />
      )}

      {loaded && canCreate && !entry && !created && (
        <section className="mt-6" aria-labelledby="moment-heading">
          <h2 id="moment-heading" className="text-lg font-semibold text-ink-primary">
            What is changing?
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">
            Pick the closest one. You will answer a few questions and get a single result.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {moments.map((m) => {
              const Icon = m.icon
              return (
                <div key={m.key} className={moment === m.key ? 'md:col-span-2' : ''}>
                  <button
                    type="button"
                    aria-pressed={moment === m.key}
                    onClick={() => {
                      const next = moment === m.key ? null : m.key
                      setMoment(next)
                      setShowAll(false)
                      if (next) track('brief_door_used', { door: m.key })
                    }}
                    className={`flex min-h-[88px] w-full items-start gap-3 rounded-2xl border p-4 text-left transition-colors ${
                      moment === m.key
                        ? 'border-family-500 bg-family-500/10'
                        : 'border-haze bg-surface-1'
                    }`}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-family-500/10 text-family-400">
                      <Icon size={20} aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block font-medium text-ink-primary">{m.title}</span>
                      <span className="block text-sm text-ink-secondary">{m.blurb}</span>
                    </span>
                  </button>
                  {moment === m.key && (
                    <div className="mt-2 rounded-2xl border border-haze bg-surface-1 p-2">
                      <ul>
                        {m.items.map((e) => (
                          <li key={e.id}>
                            <button
                              type="button"
                              onClick={() => choose(e)}
                              className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-ink-primary hover:bg-surface-2"
                            >
                              {e.title}
                              <ChevronRight
                                size={18}
                                className="text-ink-tertiary"
                                aria-hidden="true"
                              />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <button
            type="button"
            aria-expanded={showAll}
            onClick={() => {
              setShowAll(!showAll)
              setMoment(null)
            }}
            className="mt-4 text-sm font-medium text-family-400 underline"
          >
            {showAll ? 'Hide other situations' : 'Something else? See every situation'}
          </button>

          {showAll && (
            <div className="mt-3">
              <label className="relative block">
                <span className="sr-only">Search situations</span>
                <Search
                  size={18}
                  aria-hidden="true"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search, e.g. rent, pet, bereavement"
                  className={`${inputCls} pl-10`}
                />
              </label>
              {groups.length === 0 && (
                <p className="mt-3 text-sm text-ink-tertiary">Nothing matches “{query}”.</p>
              )}
              {groups.map((g) => (
                <div key={g} className="mt-4">
                  <h3 className="text-sm font-medium text-ink-tertiary">{g}</h3>
                  <ul className="mt-1 divide-y divide-haze rounded-2xl border border-haze bg-surface-1">
                    {searchHits
                      .filter((e) => e.group === g)
                      .map((e) => (
                        <li key={e.id}>
                          <button
                            type="button"
                            onClick={() => choose(e)}
                            className="flex min-h-[48px] w-full items-center justify-between gap-3 px-4 py-2 text-left text-ink-primary"
                          >
                            {e.title}
                            <ChevronRight
                              size={18}
                              className="text-ink-tertiary"
                              aria-hidden="true"
                            />
                          </button>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {entry && canCreate && (
        <section ref={formRef} className="mt-6 scroll-mt-40" aria-labelledby="form-heading">
          <button
            type="button"
            onClick={back}
            className="inline-flex min-h-[44px] items-center gap-1 text-sm text-ink-tertiary"
          >
            <ArrowLeft size={16} aria-hidden="true" /> Choose something else
          </button>
          <h2 id="form-heading" className="mt-1 text-xl font-semibold text-ink-primary">
            {entry.title}
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">
            {updatingFrom
              ? `Starting from the figures you entered on ${updatingFrom}. Change only what is different.`
              : 'Use your best figures. You can make a new brief any time they change.'}
          </p>
          {entry.mode !== 'handover' && (
            <div className="mt-4">
              <ol className="flex items-center gap-2 text-sm" aria-label="Progress">
                {(['Where you are today', 'What changes'] as const).map((label, i) => {
                  const n = (i + 1) as 1 | 2
                  const done = step > n
                  const current = step === n
                  return (
                    <li key={label} className="flex flex-1 items-center gap-2">
                      <span
                        aria-current={current ? 'step' : undefined}
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                          done
                            ? 'bg-green-500/20 text-green-600'
                            : current
                              ? 'bg-family-500 text-white'
                              : 'bg-surface-2 text-ink-tertiary'
                        }`}
                      >
                        {done ? <Check size={14} aria-hidden="true" /> : n}
                      </span>
                      <span
                        className={current ? 'font-medium text-ink-primary' : 'text-ink-tertiary'}
                      >
                        {label}
                      </span>
                    </li>
                  )
                })}
              </ol>
              <div
                className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2"
                aria-hidden="true"
              >
                <div
                  className="h-full rounded-full bg-family-500 transition-all duration-300 motion-reduce:transition-none"
                  style={{ width: step === 1 ? '50%' : '100%' }}
                />
              </div>
              <p className="mt-2 text-xs text-ink-tertiary">
                About 2 minutes. Nothing is shared until you send the link.
              </p>
              {step === 2 && (
                <button
                  type="button"
                  onClick={() => {
                    setStep(1)
                    setTimeout(
                      () => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
                      50,
                    )
                  }}
                  className="mt-1 inline-flex min-h-[44px] items-center gap-1 text-sm text-ink-secondary"
                >
                  <ArrowLeft size={16} aria-hidden="true" /> Back to today&apos;s figures
                </button>
              )}
            </div>
          )}

          <GlassCard className="mt-4 space-y-5 p-5">
            {recipients.length > 1 ? (
              <Field id="f-for" label="Share with">
                {({ id }) => (
                  <select
                    id={id}
                    value={forMember}
                    onChange={(e) => setForMember(e.target.value)}
                    className={inputCls}
                  >
                    {recipients.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            ) : recipients.length === 1 ? (
              <p className="text-sm text-ink-secondary">
                Sharing with <strong className="text-ink-primary">{recipientName}</strong>
              </p>
            ) : (
              <p className="text-sm text-ink-secondary">
                A brief is shared with one other adult.{' '}
                <Link href="/family" className="font-medium text-family-400 underline">
                  Add them in Family
                </Link>{' '}
                first.
              </p>
            )}

            <motion.div
              key={step}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <BriefFields
                entry={entry}
                f={f}
                set={setF}
                errors={errors}
                step={entry.mode === 'handover' ? 2 : step}
              />
            </motion.div>
          </GlassCard>

          {entry.mode !== 'handover' &&
            !entry.sensitive &&
            step === 2 &&
            preview.state === 'idle' &&
            remainingFields(entry, f) > 0 && (
              <p className="mt-4 rounded-2xl border border-dashed border-haze p-4 text-sm text-ink-secondary">
                {remainingFields(entry, f) === 1
                  ? '1 more thing to fill in, then your answer appears here.'
                  : `${remainingFields(entry, f)} more things to fill in, then your answer appears here.`}
              </p>
            )}
          {entry.mode !== 'handover' &&
            !entry.sensitive &&
            step === 2 &&
            preview.state !== 'idle' && (
              <div
                aria-live="polite"
                className="mt-4 rounded-2xl border border-family-500/30 bg-family-500/5 p-4"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">
                  Your answer so far · nothing is saved or shared yet
                </p>
                {preview.state === 'loading' && !preview.data && (
                  <Skeleton className="mt-3 h-16 w-full" />
                )}
                {preview.state === 'error' && (
                  <p className="mt-2 text-sm text-ink-secondary">{preview.error}</p>
                )}
                {preview.data && preview.state !== 'error' && (
                  <div className={preview.state === 'loading' ? 'opacity-60' : ''}>
                    <p className="mt-2 text-lg font-medium text-ink-primary">
                      {briefHeadline(splitBriefSentence(preview.data.template_sentence).main)}
                    </p>
                    <RunwayChart
                      result={preview.data.result}
                      startSavings={Number(f['savings'] ?? 0) * 100}
                      runsOutLabel={runsOutAround(preview.data.template_sentence)}
                    />
                  </div>
                )}
              </div>
            )}

          {gateHit && (
            <div
              role="alert"
              className="mt-4 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-ink-primary"
            >
              Your first brief is free. Making more, and keeping your record up to date, is part of
              the household record.
              <Link href="/upgrade" className="ml-2 font-semibold underline">
                See the plan
              </Link>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm text-red-500">
              {error}
            </p>
          )}

          <div className="sticky bottom-[96px] z-10 -mx-4 mt-5 bg-gradient-to-t from-navbg via-navbg/95 to-transparent px-4 pb-2 pt-4 md:static md:mx-0 md:bg-none md:px-0 md:pb-0 md:pt-0">
            {entry.mode !== 'handover' && step === 1 ? (
              <button type="button" onClick={continueStep} className={primaryBtn}>
                Continue <ChevronRight size={18} aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit()}
                className={primaryBtn}
              >
                {busy ? 'Working it out…' : 'Show me the answer'}
              </button>
            )}
          </div>
          <p className="mt-3 text-center text-xs text-ink-tertiary">
            Information only, not advice. Nothing is sent until you share the link.
          </p>
        </section>
      )}

      {briefs.length > 0 && (
        <section className="mt-10" aria-labelledby="yours-heading">
          <h2 id="yours-heading" className="text-lg font-semibold text-ink-primary">
            Your briefs
          </h2>
          <ul className="mt-3 space-y-3">
            {briefs.map((b) => {
              const title = b.title ?? byId.get(b.problem_type)?.title ?? b.problem_type
              const other = b.share?.for_member_name ?? 'the other adult'
              const isOpen = open === b.id
              return (
                <li
                  key={b.id}
                  id={`brief-${b.id}`}
                  className="scroll-mt-40 rounded-2xl border border-haze bg-surface-1 p-4"
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : b.id)}
                    className="flex w-full items-start justify-between gap-3 text-left"
                  >
                    <span>
                      <span className="block font-medium text-ink-primary">
                        {title}
                        {b.stale && (
                          <span className="ml-2 text-xs text-amber-600">(out of date)</span>
                        )}
                      </span>
                      <span className="block text-xs text-ink-tertiary">
                        {new Date(b.created_at).toLocaleDateString('en-GB')}
                      </span>
                    </span>
                    <ChevronRight
                      size={18}
                      aria-hidden="true"
                      className={`mt-1 shrink-0 text-ink-tertiary transition-transform ${isOpen ? 'rotate-90' : ''}`}
                    />
                  </button>
                  <div className="mt-3">
                    <Status b={b} other={other} />
                  </div>
                  {isOpen && (
                    <div className="mt-4 space-y-4 border-t border-haze pt-4">
                      <p className="text-lg font-medium text-ink-primary">
                        {briefHeadline(splitBriefSentence(b.template_sentence).main)}
                      </p>
                      <WhatIf brief={b} />
                      {!b.confirmation?.creator_at && b.result_version && (
                        <button
                          type="button"
                          onClick={() =>
                            void confirmBrief(b.id, b.result_version!).then(() => refresh())
                          }
                          className="min-h-[44px] rounded-full bg-family-500 px-4 text-sm font-semibold text-white"
                        >
                          I have read this
                        </button>
                      )}
                      <div className="flex flex-wrap gap-3 text-sm">
                        {byId.get(b.problem_type) &&
                          byId.get(b.problem_type)!.mode !== 'handover' && (
                            <button
                              type="button"
                              onClick={() => startUpdate(b)}
                              className="inline-flex min-h-[44px] items-center gap-1 font-medium text-family-400 underline"
                            >
                              <Pencil size={14} aria-hidden="true" /> Update these figures
                            </button>
                          )}

                        {b.share && !b.share.revoked && (
                          <button
                            type="button"
                            onClick={() =>
                              void revokeBriefShare(b.id).then(() => {
                                toast({ message: 'Link turned off' })
                                return refresh()
                              })
                            }
                            className="min-h-[44px] text-ink-secondary underline"
                          >
                            Turn off the link
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void newLink(b, other)}
                          className="min-h-[44px] text-ink-secondary underline"
                        >
                          {b.share && !b.share.revoked ? 'Get a new link' : 'Turn the link back on'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(b)}
                          className="min-h-[44px] text-red-500 underline"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </main>
  )
}
