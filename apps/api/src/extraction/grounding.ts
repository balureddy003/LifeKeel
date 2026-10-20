/**
 * Grounding and confidence (PRD-143). The model's own confidence is not used:
 * it is not calibrated and a hallucinated value reads as confident as a real
 * one. Instead each extracted value is looked up in the document's own text.
 * A value found exactly once is grounded and gets a source span and snippet;
 * one found several times is ambiguous; one that cannot be found is probably
 * invented or reformatted and is flagged low. With no text (a photo read by a
 * hosted vision model) nothing can be verified, so there is no span and every
 * field is held for the user to check against the image.
 *
 * Deterministic and pure. Thresholds are hypotheses to test, not benchmarks.
 */
import { SPEC_BY_KEY } from './schema.js'

/** Below this the user must confirm the field against its source (PRD-143 item 4). */
export const REVIEW_THRESHOLD = 0.8
/** Below this the document type is not trusted and the user is asked what it is. */
export const CLASSIFICATION_THRESHOLD = 0.8
const SNIPPET_RADIUS = 60

export type GroundingKind =
  'verbatim_unique' | 'verbatim_ambiguous' | 'keyword' | 'absence' | 'not_found' | 'image_only'

export interface Grounding {
  confidence: number
  grounding: GroundingKind
  span: { start: number; end: number } | null
  snippet: string | null
}

interface Index {
  s: string
  map: number[]
}

function indexText(text: string, alnumOnly: boolean): Index {
  const out: string[] = []
  const map: number[] = []
  let lastSpace = true
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!.toLowerCase()
    if (alnumOnly) {
      if (/[a-z0-9]/.test(c)) {
        out.push(c)
        map.push(i)
      }
    } else if (/\s/.test(c)) {
      if (!lastSpace) {
        out.push(' ')
        map.push(i)
        lastSpace = true
      }
    } else {
      out.push(c)
      map.push(i)
      lastSpace = false
    }
  }
  return { s: out.join(''), map }
}

function findAll(hay: string, needle: string): number[] {
  if (!needle) return []
  const hits: number[] = []
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length))
    hits.push(i)
  return hits
}

function snippetAt(text: string, start: number, end: number) {
  const a = Math.max(0, start - SNIPPET_RADIUS)
  const b = Math.min(text.length, end + SNIPPET_RADIUS)
  return text.slice(a, b).replace(/\s+/g, ' ').trim().slice(0, 220)
}

export function groundField(key: string, value: string, text: string | null): Grounding {
  if (text === null) {
    return { confidence: 0.5, grounding: 'image_only', span: null, snippet: null }
  }
  const kind = SPEC_BY_KEY[key]?.kind

  if (kind === 'bool') {
    const m = /beneficiar/i.exec(text)
    if (value === 'yes') {
      if (!m) return { confidence: 0.2, grounding: 'not_found', span: null, snippet: null }
      const span = { start: m.index, end: m.index + m[0].length }
      return {
        confidence: 0.85,
        grounding: 'keyword',
        span,
        snippet: snippetAt(text, span.start, span.end),
      }
    }
    // "No beneficiary" is an absence: nothing in the text can show it.
    return { confidence: m ? 0.3 : 0.6, grounding: 'absence', span: null, snippet: null }
  }

  const forms: boolean[] = kind === 'text' || kind === 'email' ? [false] : [false, true]
  for (const alnum of forms) {
    const hay = indexText(text, alnum)
    const needle = indexText(value, alnum).s
    const hits = findAll(hay.s, needle)
    if (hits.length === 0) continue
    const first = hits[0]!
    const start = hay.map[first]!
    const end = hay.map[Math.min(first + needle.length - 1, hay.map.length - 1)]! + 1
    return {
      confidence: hits.length === 1 ? 0.95 : 0.75,
      grounding: hits.length === 1 ? 'verbatim_unique' : 'verbatim_ambiguous',
      span: { start, end },
      snippet: snippetAt(text, start, end),
    }
  }
  return { confidence: 0.2, grounding: 'not_found', span: null, snippet: null }
}

// ── Classification confidence ───────────────────────────────────────────────

const CLASS_WORDS: Record<string, RegExp[]> = {
  insurance: [
    /\bpolic(y|ies)\b/i,
    /\binsur/i,
    /\bpremium\b/i,
    /\bsum assured\b|\bcover\b|\bcoverage\b/i,
    /\bclaim/i,
  ],
  pension: [/\bpension\b/i, /\bretire/i, /\bfund value\b|\btransfer value\b/i, /\bcontribution/i],
  mortgage: [/\bmortgage\b/i, /\blender\b/i, /\boutstanding\b/i, /\binterest rate\b/i],
  income: [
    /\bpayslip\b|\bpay slip\b|\bp60\b|\bsalary\b/i,
    /\bnet pay\b|\bgross pay\b/i,
    /\bemployer\b/i,
    /\btax code\b|\bnational insurance\b/i,
  ],
  investment: [/\bportfolio\b/i, /\binvestment\b/i, /\bshares?\b|\bfund\b/i, /\bvaluation\b/i],
  tax: [/\btax\b/i, /\bhmrc\b|\birs\b/i, /\breturn\b|\bassessment\b/i],
  will: [/\blast will\b|\btestament\b/i, /\bexecutor/i, /\bbequeath|\bestate\b/i],
}

/**
 * How well the document's own words support the category the model chose.
 * Two or more telling words is firm; none is a coin toss at best. With no text
 * (a photo) nothing can be checked, so a non-'other' type needs the user.
 */
export function classificationConfidence(category: string, text: string | null): number {
  if (category === 'other') return 0.6
  if (text === null) return 0.5
  const hits = (CLASS_WORDS[category] ?? []).filter((r) => r.test(text)).length
  return hits >= 2 ? 0.9 : hits === 1 ? 0.7 : 0.3
}

export const needsTypeConfirmation = (category: string, confidence: number) =>
  category !== 'other' && confidence < CLASSIFICATION_THRESHOLD
