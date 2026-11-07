/**
 * Turns one typed or dictated sentence into draft records for the family list.
 *
 * Local and deterministic: no network, no model, no provider. It uses only what
 * a pack already declares (its record types, field labels, kinds and choices)
 * plus the family roster, so a new domain gets sentence capture for free. It
 * never saves anything: the caller shows the draft and a person confirms it.
 *
 * What it reads: real dates ("9 May", "9th of May 2027", "09/05/2027",
 * "2027-05-09"), UK number plates, amounts ("£120"), a choice that matches an
 * option, and a family member's first name. Anything else is returned as
 * "unused" so the person can see what was left out.
 */
import type { DomainView } from '@/lib/api'

type Pack = DomainView['pack']
type RecordType = Pack['records'][number]
type Field = RecordType['fields'][number]

export interface Draft {
  record: string
  recordLabel: string
  holderMemberId: string | null
  values: Record<string, string>
}

export interface ParseResult {
  drafts: Draft[]
  /** Words in the sentence that no field used. Shown so nothing is silently dropped. */
  unused: string
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]
const MONTH_RE =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const STOP = new Set([
  'is',
  'on',
  'the',
  'a',
  'an',
  'its',
  'it',
  'due',
  'at',
  'of',
  'in',
  'for',
  'to',
  'and',
  'my',
  'our',
  'we',
  'has',
  'have',
  'next',
  'expires',
  'expire',
  'renews',
  'renew',
  'ends',
  'end',
  'by',
  'with',
])

interface Span {
  start: number
  end: number
}

function monthIndex(name: string): number {
  const n = name.toLowerCase().slice(0, 3)
  return MONTHS.findIndex((m) => m.startsWith(n))
}

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m || dt.getUTCDate() !== d) return null
  return dt.toISOString().slice(0, 10)
}

/** A date with no year means its next occurrence. */
function withYear(m: number, d: number, now: Date): string | null {
  const y = now.getUTCFullYear()
  const today = Date.UTC(y, now.getUTCMonth(), now.getUTCDate())
  const thisYear = iso(y, m, d)
  if (thisYear && Date.parse(thisYear) >= today) return thisYear
  return iso(y + 1, m, d)
}

interface Found<T> extends Span {
  value: T
}

function findDates(text: string, now: Date): Found<string>[] {
  const out: Found<string>[] = []
  const push = (m: RegExpMatchArray, value: string | null) => {
    if (value) out.push({ start: m.index!, end: m.index! + m[0].length, value })
  }
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g))
    push(m, iso(+m[1]!, +m[2]! - 1, +m[3]!))
  for (const m of text.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g))
    push(m, iso(+m[3]!, +m[2]! - 1, +m[1]!))
  const dm = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH_RE}(?:\\s+(\\d{4}))?\\b`,
    'gi',
  )
  for (const m of text.matchAll(dm)) {
    const mi = monthIndex(m[2]!)
    push(m, m[3] ? iso(+m[3], mi, +m[1]!) : withYear(mi, +m[1]!, now))
  }
  const md = new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'gi')
  for (const m of text.matchAll(md)) {
    const mi = monthIndex(m[1]!)
    push(m, m[3] ? iso(+m[3], mi, +m[2]!) : withYear(mi, +m[2]!, now))
  }
  // Drop a match fully inside a longer one (e.g. "9 May" inside "9 May 2027").
  return out.filter(
    (a) =>
      !out.some(
        (b) => b !== a && b.start <= a.start && b.end >= a.end && b.end - b.start > a.end - a.start,
      ),
  )
}

function findPlates(text: string): Found<string>[] {
  return [...text.matchAll(/\b([A-Z]{2}\d{2})\s?([A-Z]{3})\b/gi)].map((m) => ({
    start: m.index!,
    end: m.index! + m[0].length,
    value: `${m[1]} ${m[2]}`.toUpperCase(),
  }))
}

function findAmounts(text: string): Found<string>[] {
  return [...text.matchAll(/£\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g)].map(
    (m) => ({
      start: m.index!,
      end: m.index! + m[0].length,
      value: m[1]!.replace(/,/g, ''),
    }),
  )
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9£ ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

/** Words that name a field or record, ignoring filler like "due" and "date". */
function labelWords(label: string): string[] {
  return words(label).filter((w) => !STOP.has(w) && !['date', 'name', 'contact'].includes(w))
}

function nearestField(fields: Field[], text: string, at: Span): Field | null {
  // People say the label first ("tax due 1 June"), so the closest label BEFORE
  // the match wins; a label after it only counts when none came before.
  const lower = text.toLowerCase()
  let before: { f: Field; d: number } | null = null
  let after: { f: Field; d: number } | null = null
  for (const f of fields) {
    for (const w of labelWords(f.label)) {
      for (const m of lower.matchAll(new RegExp(`\\b${w}\\b`, 'g'))) {
        const end = m.index! + w.length
        if (end <= at.start) {
          const d = at.start - end
          if (!before || d < before.d) before = { f, d }
        } else if (m.index! >= at.end) {
          const d = m.index! - at.end
          if (!after || d < after.d) after = { f, d }
        }
      }
    }
  }
  if (before && before.d <= 40) return before.f
  if (after && after.d <= 20) return after.f
  return null
}

export function parseSentence(
  sentence: string,
  pack: Pack,
  roster: Array<{ id: string; name: string }>,
  now: Date = new Date(),
): ParseResult {
  const text = sentence.replace(/\s+/g, ' ').trim()
  const stores = pack.records.filter((r) => r.source.kind === 'store')
  if (!text || stores.length === 0) return { drafts: [], unused: text }

  // Which record is this about? Words from its label and its field labels.
  const lower = text.toLowerCase()
  const scored = stores.map((r) => {
    const keys = new Set([...labelWords(r.label), ...r.fields.flatMap((f) => labelWords(f.label))])
    const hits = [...keys].filter((k) => new RegExp(`\\b${k}\\b`).test(lower)).length
    return { r, hits }
  })
  scored.sort((a, b) => b.hits - a.hits)
  const rec = scored[0]!.hits > 0 || stores.length === 1 ? scored[0]!.r : null
  if (!rec) return { drafts: [], unused: text }

  const used: Span[] = []
  const values: Record<string, string> = {}
  const set = (f: Field | null, value: string, span: Span) => {
    if (!f || values[f.key]) return false
    values[f.key] = value
    used.push(span)
    return true
  }

  const dateFields = rec.fields.filter((f) => f.kind === 'date')
  for (const d of findDates(text, now)) {
    const target =
      nearestField(dateFields, text, d) ?? dateFields.find((f) => !values[f.key]) ?? null
    set(target, d.value, d)
  }
  const plateField = rec.fields.find((f) => f.kind === 'text' && /regist|plate/i.test(f.label))
  for (const p of findPlates(text)) set(plateField ?? null, p.value, p)
  const moneyFields = rec.fields.filter((f) => f.kind === 'money')
  for (const a of findAmounts(text))
    set(nearestField(moneyFields, text, a) ?? moneyFields[0] ?? null, a.value, a)

  for (const f of rec.fields.filter((x) => x.kind === 'choice')) {
    for (const c of f.choices ?? []) {
      const m = new RegExp(`\\b${c.replace(/_/g, '[ _]')}\\b`, 'i').exec(text)
      if (m) {
        set(f, c, { start: m.index, end: m.index + m[0].length })
        break
      }
    }
  }

  // Whose is it? A family member's first name, optionally possessive.
  let holder: string | null = null
  if (rec.person_attribution === 'holder') {
    for (const person of roster) {
      const first = person.name.trim().split(/\s+/)[0]!
      const m = new RegExp(`\\b${first}(?:['’]s)?\\b`, 'i').exec(text)
      if (m) {
        holder = person.id
        used.push({ start: m.index, end: m.index + m[0].length })
        break
      }
    }
  }
  // Member-kind fields take a name too.
  for (const f of rec.fields.filter((x) => x.kind === 'member')) {
    for (const person of roster) {
      const first = person.name.trim().split(/\s+/)[0]!
      const m = new RegExp(`\\b${first}\\b`, 'i').exec(text)
      if (m && set(f, person.id, { start: m.index, end: m.index + m[0].length })) break
    }
  }

  // Words naming the record or its fields were understood too; the rest is "unused".
  for (const k of new Set([
    ...labelWords(rec.label),
    ...rec.fields.flatMap((f) => labelWords(f.label)),
  ]))
    for (const m of lower.matchAll(new RegExp(`\\b${k}\\b`, 'g')))
      used.push({ start: m.index!, end: m.index! + k.length })

  let rest = ''
  for (let i = 0; i < text.length; i++)
    rest += used.some((s) => i >= s.start && i < s.end) ? ' ' : text[i]
  const unused = words(rest)
    .filter((w) => !STOP.has(w) && w.length > 1)
    .join(' ')

  if (Object.keys(values).length === 0 && !holder) return { drafts: [], unused: text }
  return {
    drafts: [{ record: rec.key, recordLabel: rec.label, holderMemberId: holder, values }],
    unused,
  }
}
