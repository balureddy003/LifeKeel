/**
 * PRD-113 + Device-First AI Foundation: on-device inference runtime,
 * grammar-constrained generation, client-side safety/grounding guards,
 * deterministic offline fallback, and reversible PII redaction ("Curtain").
 *
 * Runtime probe hierarchy (zero-download native models first):
 *   1. `capacitor_native` — iOS 26+ Apple Foundation Models / Android AICore
 *      Gemini Nano via @capgo/capacitor-llm (chat-session adapter) or the
 *      experimental @capacitor/local-llm (one-shot prompt), allowlisted in
 *      NATIVE_LLM_PLUGIN_KEYS. Readiness-gated: an undownloaded model is
 *      skipped, never silently downloaded inside a Draft click.
 *   2. `browser_builtin`  — Chrome/Edge Built-In AI (`self.LanguageModel`,
 *      Gemini Nano; `initialPrompts` + `responseConstraint` per the shipped
 *      Prompt API).
 *   3. `webllm`           — `@mlc-ai/web-llm` on WebGPU with XGrammar
 *      JSON-schema constrained decoding (`Llama-3.2-1B-Instruct-q4f16_1-MLC`).
 *
 * Every on-device output passes through `verifyOnDeviceOutput` before
 * returning to the caller. This is a client-side SUBSET of the server
 * gateway's controls — bounded length, Rule 2 advice/provider/action
 * patterns, secret patterns, and numeral-presence grounding. It has no
 * input screening, budget, deadline, or telemetry; it is not equivalent to
 * the server task gateway.
 *
 * @mlc-ai/web-llm is dynamically imported so nobody who never touches
 * this feature pays for it in the main bundle.
 */

const STORAGE_KEY = 'lifekeel:on-device-drafts'

// Named model catalogue: 1B default for fast mobile WebGPU load; 1.7B Qwen3
// option where higher device memory is available.
export const DEFAULT_WEBLLM_MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC'
const MODEL_ID = DEFAULT_WEBLLM_MODEL_ID

export type OnDeviceProviderKind = 'capacitor_native' | 'browser_builtin' | 'webllm' | 'unavailable'

// Byte-identical in intent to generate-draft.ts's SYSTEM_PROMPT — same
// draft-only framing, same "never invent details," same generic sign-
// off. Explicitly forbids naming a specific product/provider: CLAUDE.md's
// "second rule" applies here exactly as it does to the cloud path, and is
// mechanically verified post-generation by `verifyOnDeviceOutput`.
const SYSTEM_PROMPT = `You draft short, polite outreach messages for a family finance app called LifeKeel. Given a description of a step in a family's crisis checklist, write a brief email body (2-4 sentences) the family could send to their insurer or provider to follow up.

Rules:
- This is a DRAFT ONLY, for a human to review and send themselves. Never claim anything has been sent, scheduled, or already acted upon.
- Do not invent policy numbers, account numbers, or personal details that weren't given to you.
- Never recommend, compare, or name a specific product or provider to switch to — only reference what the family already has.
- Sign off generically (e.g. "Thank you,") with no name — the sender will add their own.
- Output only the email body text, no subject line, no commentary.`

// JSON Schema used when the runtime supports grammar-constrained decoding
// (XGrammar in WebLLM / responseConstraint in Chrome Prompt API).
const DRAFT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    body: { type: 'string' },
  },
  required: ['body'],
  additionalProperties: false,
} as const

// Bounded generation: caps output length and gives a floor for hung calls.
const MAX_OUTPUT_TOKENS = 300
const INFERENCE_TIMEOUT_MS = 30_000
const SESSION_CREATE_TIMEOUT_MS = 10_000

// Allowlisted Capacitor bridge keys for the native tier. An object at any
// other key is an unvetted third party — detection ignores it even if it
// duck-types the expected API, because this tier receives raw family data.
//   LocalLLM    — @capacitor/local-llm (ionic-team Labs; prompt()-style)
//   CapgoLLM    — @capgo/capacitor-llm (chat-session API, see below)
const NATIVE_LLM_PLUGIN_KEYS = ['LocalLLM', 'CapgoLLM'] as const

// @capgo/capacitor-llm exposes a chat-session API rather than a one-shot
// prompt(): getReadiness() -> createChat() -> sendMessage(), with output
// streamed back through 'textFromAi' chunks and terminated by 'aiFinished'
// or 'generationError' events filtered by chatId.
interface CapgoLikePlugin {
  getReadiness?: () => Promise<{ readiness?: string }>
  createChat?: () => Promise<{ id?: string }>
  sendMessage?: (opts: { chatId: string; message: string }) => Promise<void>
  addListener?: (
    event: string,
    fn: (e: { chatId?: string; text?: string; error?: string }) => void,
  ) => Promise<{ remove?: () => Promise<void> }>
}

interface NativePluginPick {
  plugin: Record<string, any>
  kind: 'prompt' | 'capgo'
}

// Prefers a plugin exposing one-shot prompt() (no session state to leak
// between calls) over the Capgo chat-session API.
function selectNativePlugin(capPlugins: Record<string, any> | undefined): NativePluginPick | null {
  for (const key of NATIVE_LLM_PLUGIN_KEYS) {
    const p = capPlugins?.[key]
    if (!p) continue
    if (typeof p.prompt === 'function') return { plugin: p, kind: 'prompt' }
    if (typeof p.createChat === 'function' && typeof p.sendMessage === 'function') {
      return { plugin: p, kind: 'capgo' }
    }
  }
  return null
}

// Client-side guard patterns mirroring packages/engine/src/__tests__/advice-rule.test.ts
// and packages/platform/src/llm-guards.ts (zero node:crypto dependency).
const ADVICE_RULE_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  {
    name: 'personal_recommendation',
    pattern:
      /\b(you should|we recommend|i recommend|i'd recommend|we advise|i advise|we suggest|i suggest|you may want to switch|consider (switching|moving to))\b/i,
  },
  {
    // "compare quotes" is deliberately NOT banned — CLAUDE.md names
    // "compare quotes from multiple insurers" as compliant copy.
    name: 'buy_or_switch',
    pattern:
      /\b(switch(ing)? to|sign up (with|for)|take out a new|move your (policy|pension|cover|account)|cancel your (policy|pension|cover|plan)|a cheaper (policy|deal|cover) elsewhere)\b/i,
  },
  {
    name: 'best_product_claim',
    pattern:
      /\b(best|better|cheaper) (policy|provider|insurer|fund|product|plan|deal|cover)( available| elsewhere)?\b/i,
  },
  {
    name: 'autonomous_action_claim',
    pattern:
      /\b(we have sent|i have sent|i've sent|we've sent|has been sent|have been sent|has been submitted|i've submitted|we've submitted|already contacted|already sent|scheduled for you|(i|we) (have|'ve) (already )?(filed|submitted|notified|cancelled|registered|arranged)|on your behalf)\b/i,
  },
  {
    name: 'secret_leak',
    pattern: /\b(sk-[A-Za-z0-9_-]{12,}|pk_live_[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._-]+)\b/,
  },
]

// Named-provider denylist. Each entry is matched whole-word (Unicode-aware)
// on BOTH the candidate and the source; an output may only mention a
// provider that already appears whole-word in the family's own context.
const PROVIDER_NAMES: readonly string[] = [
  'aviva',
  'legal and general',
  'legal & general',
  'vitality',
  'prudential',
  'zurich',
  'axa',
  'hargreaves lansdown',
  'vanguard',
  'fidelity',
  'nutmeg',
  'moneybox',
  'admiral',
  'direct line',
  'royal london',
  'scottish widows',
  'aegon',
  'standard life',
  'bupa',
  'lv=',
  'lv insurance',
]

export interface OnDeviceGuardResult {
  accepted: boolean
  text: string | null
  reason?: string
}

/**
 * Normalize text for pattern matching: NFKC folds fullwidth digits/letters
 * and compatibility homoglyphs to ASCII; zero-width characters are stripped
 * so "Avi\u200bva" cannot evade the provider check.
 */
function normalizeForMatch(text: string): string {
  return text.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '')
}

/**
 * Unicode-aware whole-word test — \b is ASCII-only and fails both ways for
 * names like Zoë/José and brands like AXA inside "taxable". A boundary is a
 * non-letter/non-number/underscore character (or string edge).
 */
function containsWholeWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  const re = new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, 'iu')
  return re.test(text)
}

function findWholeWordMatches(text: string, word: string): string[] {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  const re = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escaped})($|[^\\p{L}\\p{N}_])`, 'giu')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m[2] !== undefined) out.push(m[2])
  }
  return out
}

/**
 * Extract normalized numeric tokens (e.g. "200,000" -> "200000",
 * "200,000.00" -> "200000") so we can verify that an on-device SLM did not
 * emit numeric tokens absent from the source. NFKC folds fullwidth digits.
 */
export function extractNormalizedNumerals(text: string): Set<string> {
  const normalized = normalizeForMatch(text)
  const matches = normalized.match(/\d+(?:[.,]\d+)*/g) ?? []
  const out = new Set<string>()
  for (const raw of matches) {
    const stripped = raw.replace(/,/g, '').replace(/\.0+$/, '')
    if (stripped.length > 0) out.add(stripped)
    // Also allow the dotted-decimal form itself so "200000.00" output
    // isn't false-rejected against "200000" source (and vice versa).
    const noDot = raw.replace(/,/g, '').replace(/\.\d+$/, '')
    if (noDot.length > 0) out.add(noDot)
  }
  return out
}

// A numeral immediately followed by a magnitude word/suffix is a NEW claim,
// not a copied one — "£200" must not authorize "£200k" or "200 million".
const MAGNITUDE_RE = /\d[\d,.]*\s*(k|m|bn|thousand|million|billion)\b/gi
const NUMBER_WORDS_RE = /\b(hundred|thousand|million|billion|trillion)\b/gi

/**
 * Isomorphic client-side output verifier for on-device SLM generations.
 * Enforces:
 *   1. Non-empty bounded length (20..1200 chars).
 *   2. CLAUDE.md Rule 2 (no advice, switching, or named providers not
 *      already whole-word present in the family's source context).
 *   3. Numeral-presence grounding: every numeric token — including
 *      magnitude-suffixed ("200k") and spelled-out magnitudes — must appear
 *      in `sourceContext` (or `extraAllowedNumerals`). This is presence
 *      checking, not semantic verification: "30 days" still authorizes
 *      "£30"; it rejects ungrounded figures, it cannot prove truth.
 */
export function verifyOnDeviceOutput(
  candidate: string,
  sourceContext: string,
  extraAllowedNumerals: Iterable<string> = [],
): OnDeviceGuardResult {
  const trimmed = candidate.trim()
  if (trimmed.length < 20) {
    return { accepted: false, text: null, reason: 'too_short' }
  }
  if (trimmed.length > 1200) {
    return { accepted: false, text: null, reason: 'too_long' }
  }

  const outputNorm = normalizeForMatch(trimmed)
  const sourceNorm = normalizeForMatch(sourceContext)

  for (const rule of ADVICE_RULE_PATTERNS) {
    if (rule.pattern.test(outputNorm)) {
      return { accepted: false, text: null, reason: rule.name }
    }
  }

  // Named providers: EVERY whole-word provider mention in the output must
  // itself appear whole-word in the source. One grounded provider must not
  // whitelist other ungrounded providers.
  for (const provider of PROVIDER_NAMES) {
    for (const mention of findWholeWordMatches(outputNorm, provider)) {
      if (!containsWholeWord(sourceNorm, mention.toLowerCase())) {
        return { accepted: false, text: null, reason: 'named_provider' }
      }
    }
  }

  const allowedNumerals = extractNormalizedNumerals(sourceNorm)
  for (const n of extraAllowedNumerals) {
    allowedNumerals.add(n.replace(/,/g, '').replace(/\.\d+$/, ''))
  }

  // Magnitude suffixes and spelled-out magnitudes must be verbatim-grounded
  // too — otherwise "£200" authorizes "£200k" and "two hundred thousand".
  for (const match of outputNorm.match(MAGNITUDE_RE) ?? []) {
    if (!sourceNorm.toLowerCase().includes(match.toLowerCase().replace(/\s+/g, ' '))) {
      return { accepted: false, text: null, reason: `ungrounded_magnitude:${match.trim()}` }
    }
  }
  for (const match of outputNorm.match(NUMBER_WORDS_RE) ?? []) {
    if (!sourceNorm.toLowerCase().includes(match.toLowerCase())) {
      return { accepted: false, text: null, reason: `ungrounded_number_word:${match}` }
    }
  }

  const outputNumerals = extractNormalizedNumerals(outputNorm)
  for (const n of outputNumerals) {
    if (!allowedNumerals.has(n)) {
      return { accepted: false, text: null, reason: `ungrounded_numeral:${n}` }
    }
  }

  return { accepted: true, text: trimmed }
}

// Longest source span the template can carry while staying under the
// verifier's own 1200-char bound (template adds ~215 chars of boilerplate).
const TEMPLATE_STEP_MAX = 900

/**
 * Deterministic, zero-model offline draft for when on-device generation is
 * rejected by the guard or the model is unavailable. Still passes through
 * `verifyOnDeviceOutput` at the call site — step text can itself contain
 * phrases the guard rejects.
 */
export function buildDeterministicStepDraft(stepBody: string): string {
  const cleanStep = stepBody.trim().replace(/\s+/g, ' ').replace(/\.$/, '')
  const clipped =
    cleanStep.length > TEMPLATE_STEP_MAX
      ? cleanStep.slice(0, TEMPLATE_STEP_MAX).replace(/\s\S*$/, '') + '…'
      : cleanStep
  const relation = clipped.length > 0 ? ` in relation to: ${clipped}` : ''
  return [
    'Hello,',
    '',
    `I am writing regarding our household records${relation}.`,
    'Could you please confirm the current status on file and let me know what information or documentation you need from us next?',
    '',
    'Thank you,',
  ].join('\n')
}

// ── Reversible On-Device PII Curtain (before cloud escalation) ────────────

export interface RedactionCurtain {
  redactedText: string
  redactionCount: number
  /** True when free-text special-category hints (health/medical) were found
   *  but NOT redacted — regexes can't remove contextual PII. Callers may use
   *  this to quarantine the prompt rather than egress it. */
  hasSpecialCategoryHint: boolean
  restore: (cloudText: string) => string
}

export interface CurtainDictionary {
  memberNames?: string[]
  policyNumbers?: string[]
  providerNames?: string[]
}

/**
 * An entity span produced by an external recognizer — e.g. the Layer-B NER
 * classifier in on-device-ner.ts. Declared structurally (not imported) so
 * this module never depends on the model layer.
 */
export interface CurtainEntity {
  category: 'PERSON' | 'ORG' | 'LOC' | 'MISC'
  text: string
}

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
// Lookbehind-free phone candidate: a plausible run of 9-15 digits with
// separators/country code. Digit-count + date-shape validated in callback.
const PHONE_CANDIDATE_RE = /(^|[^\w])(\+?\(?\d[\d ().-]{6,}\d\)?)(?=[^\w]|$)/g
const UK_POSTCODE_RE = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s\d[A-Z]{2}\b/g
// Explicit card shapes only — prevents a trailing CVV/digits from breaking
// the Luhn check and letting the real card leak.
const CARD_CANDIDATE_RE = /\b(?:\d{4}[ -]?){3}\d{4}\b|\b\d{4}[ -]\d{6}[ -]\d{5}\b/g
const SORT_CODE_RE = /\b\d{2}-\d{2}-\d{2}\b/g
const IBAN_CANDIDATE_RE = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){1,6}\s?[A-Z0-9]{1,4}\b/g
const NI_NUMBER_RE =
  /\b(?!BG|GB|KN|NK|NT|TN|ZZ)[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g
const NHS_CANDIDATE_RE = /\b\d{3}\s\d{3}\s\d{4}\b/g
const DATE_LIKE_RE = /^\d{4}[-/.]\d{2}[-/.]\d{2}|^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/

// ── Layer-B contextual recognizers (deterministic, heuristic) ────────────
// PII classes a dictionary+checksum layer cannot see: titled or
// relationship-anchored third-party names ("my solicitor Dr Amari"),
// street addresses, dates of birth in prose, employer names. Deliberately
// high-precision — every pattern needs a structural anchor (title,
// relationship word, house number, DoB keyword, employer verb) so ordinary
// prose isn't mangled. The blueprint's real Layer-B (a quantized NER token
// classifier via transformers.js) remains debt — this narrows the gap now.
const TITLED_NAME_RE =
  /\b((?:Mr|Mrs|Ms|Miss|Dr|Prof|Rev|Sir|Dame|Fr)\.?\s+)([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+){0,2})\b/g
// The negative lookahead skips honorifics — after TITLED_NAME_RE consumes
// "Dr Amari Patel" the leftover "Dr" must not be captured as a name.
const RELATION_NAME_RE =
  /\b(?:mum|mam|mom|dad|mother|father|brother|sister|son|daughter|husband|wife|partner|uncle|aunt|auntie|grandma|grandad|grandfather|grandmother|nan|nana|granny|cousin|nephew|niece|neighbour|neighbor|landlord|landlady|boss|solicitor|accountant|carer|doctor)\s+((?!(?:Mr|Mrs|Ms|Miss|Dr|Prof|Rev|Sir|Dame|Fr)\b)[A-Z][a-zA-Z'’-]+)\b/g
const STREET_ADDRESS_RE =
  /\b\d{1,4}\s+[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,2}\s+(?:Street|St|Road|Rd|Lane|Ln|Avenue|Ave|Close|Drive|Dr|Way|Terrace|Crescent|Gardens?|Place|Square|Court|Row|Hill|Grove|Park|Rise|View|Walk|Mews|Parade)\b/g
const DOB_RE =
  /\b(?:born|d\.?\s?o\.?\s?b\.?|date\s+of\s+birth)(?:\s+(?:is|was|on))?\s*:?\s*(\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+\s+\d{4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/gi
const EMPLOYER_RE =
  /\b(?:works?\s+(?:at|for)|working\s+(?:at|for)|employed\s+(?:at|by)|employer\s+is)\s+([A-Z][A-Za-z&.'’-]*(?:\s+[A-Z][A-Za-z&.'’-]*){0,3})\b/g

// Layer-A special-category screen: free-text health/medical hints that a
// dictionary+regex curtain cannot remove. Presence means "consider
// quarantine rather than egress" — it is a signal, not a guarantee.
const SPECIAL_CATEGORY_RE =
  /\b(hospital|diagnos\w+|prognosis|prescription|medication|therapy|therapist|cancer|tumou?r|chemotherapy|mental health|depression|anxiety disorder|pregnant|pregnancy|miscarriage|clinic(al)?|surgery|surgical|disability|disabled|dementia|alzheimer|diabetes|nhs|gp surgery|consultant)\b/i

export function containsSpecialCategoryContent(text: string): boolean {
  return SPECIAL_CATEGORY_RE.test(normalizeForMatch(text))
}

function passesLuhn(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 13 || digits.length > 19) return false
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i])
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}

function isLikelyPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 9 || digits.length > 15) return false
  if (DATE_LIKE_RE.test(value.trim())) return false
  return value.trim().startsWith('+') || digits.startsWith('0') || /[()\s.-]/.test(value)
}

function isLikelyIban(value: string): boolean {
  const s = value.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false
  const rearranged = s.slice(4) + s.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const expanded = ch >= '0' && ch <= '9' ? ch : String(ch.charCodeAt(0) - 55)
    for (const d of expanded) remainder = (remainder * 10 + Number(d)) % 97
  }
  return remainder === 1
}

function isLikelyNhsNumber(value: string): boolean {
  const d = value.replace(/\D/g, '')
  if (d.length !== 10) return false
  let sum = 0
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * (10 - i)
  const check = 11 - (sum % 11)
  const expected = check === 11 ? 0 : check
  return expected < 10 && expected === Number(d[9])
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Cloud replies can echo placeholders inside URLs/link targets; restoring
// there would exfiltrate the real value. Leave the placeholder in place.
function isInsideLinkContext(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 120), index)
  return /(?:https?:\/\/|\]\()[^\s)\]]*$/.test(before)
}

/**
 * Layer-A Reversible On-Device PII Redactor ("Curtain Protocol").
 * Masks known Family Twin entities (member names, policy numbers) plus
 * structured PII (emails, UK phones/postcodes, Luhn cards, sort codes,
 * IBANs, NI/NHS numbers) into nonce-suffixed numbered placeholders in an
 * ephemeral in-memory map before a prompt leaves the device. Coverage is
 * probabilistic, not a structural guarantee: deterministic Layer-B
 * contextual recognizers (titled/relationship-anchored names, street
 * addresses, dates of birth, employers) catch the common anchored cases,
 * but free-text PII without a structural anchor (bare names, "the house
 * on Mill Road") and free-text medical hints are not caught. The real
 * Layer-B token classifier remains debt — see ARCHITECTURE.md §8.4a.
 */
export function redactForCloudEgress(
  input: string,
  dictionary: CurtainDictionary = {},
  extraEntities: CurtainEntity[] = [],
): RedactionCurtain {
  // Per-curtain nonce makes placeholders unguessable and prevents a hostile
  // cloud response (or prior curtain output in chat history) from colliding
  // with tokens and pulling PII into arbitrary positions.
  const nonce = Math.random().toString(36).slice(2, 8)
  const placeholderToOriginal = new Map<string, string>()
  const originalToPlaceholder = new Map<string, string>()
  const counters: Record<string, number> = {}

  const allocate = (category: string, original: string): string => {
    const key = `${category}:${original.toLowerCase()}`
    const existing = originalToPlaceholder.get(key)
    if (existing) return existing
    const next = (counters[category] ?? 0) + 1
    counters[category] = next
    const token = `[${category}_${next}_${nonce}]`
    originalToPlaceholder.set(key, token)
    placeholderToOriginal.set(token, original)
    return token
  }

  let text = input

  // 1. Emails first — otherwise member-name parts match inside the local
  // part ("sarah.jenkins@…" → "[MEMBER_1].[MEMBER_2]@…"), leaking structure
  // and preventing whole-address redaction.
  text = text.replace(EMAIL_RE, (m) => allocate('EMAIL', m))

  // 2. Exact dictionary spans from the Family Twin (longest first). For
  // multi-part member names, also redact first/last tokens >=4 chars so
  // "Sarah" alone doesn't leak when "Sarah Jenkins" is in the dictionary.
  const dictEntries: Array<{ category: string; value: string }> = []
  for (const name of dictionary.memberNames ?? []) {
    const trimmed = name?.trim()
    if (trimmed && trimmed.length >= 2) {
      dictEntries.push({ category: 'MEMBER', value: trimmed })
      for (const part of trimmed.split(/\s+/)) {
        if (part.length >= 4) dictEntries.push({ category: 'MEMBER', value: part })
      }
    }
  }
  for (const pol of dictionary.policyNumbers ?? []) {
    if (pol && pol.trim().length >= 3) dictEntries.push({ category: 'POLICY', value: pol.trim() })
  }
  for (const prov of dictionary.providerNames ?? []) {
    if (prov && prov.trim().length >= 2) {
      dictEntries.push({ category: 'PROVIDER', value: prov.trim() })
    }
  }
  // Layer-B model spans (NER). They ride the same literal-match path as
  // dictionary values — sorted longest-first, so a Family Twin name that
  // overlaps an NER span wins (dict entries are pushed first and equal
  // lengths keep insertion order under a stable sort... guard anyway by
  // skipping an entity that is wholly contained in a dictionary value).
  const dictValues = dictEntries.map((e) => e.value.toLowerCase())
  for (const ent of extraEntities) {
    const value = ent?.text?.trim()
    if (!value || value.length < 2) continue
    if (!['PERSON', 'ORG', 'LOC', 'MISC'].includes(ent.category)) continue
    if (
      dictValues.some((dv) => dv.includes(value.toLowerCase()) || value.toLowerCase().includes(dv))
    )
      continue
    dictEntries.push({ category: ent.category, value })
  }
  dictEntries.sort((a, b) => b.value.length - a.value.length)

  for (const { category, value } of dictEntries) {
    // Unicode-aware boundaries (lookbehind-free for iOS <16.4 WebViews).
    const re = new RegExp(
      `(^|[^\\p{L}\\p{N}_])(${escapeRegExp(value)})(?=[^\\p{L}\\p{N}_]|$)`,
      'giu',
    )
    text = text.replace(re, (_m, prefix: string, span: string) => prefix + allocate(category, span))
  }

  // 2b. Layer-B contextual recognizers — third-party names/addresses/DoB/
  // employer that aren't in the Family Twin dictionary. Titled names and
  // addresses redact the whole match; relationship/DoB/employer keep the
  // anchor word so the sentence still reads ("my mum [PERSON_1_…]").
  text = text.replace(
    TITLED_NAME_RE,
    (_m, title: string, name: string) => title + allocate('PERSON', name),
  )
  text = text.replace(STREET_ADDRESS_RE, (m) => allocate('ADDRESS', m))
  text = text.replace(RELATION_NAME_RE, (_m, name: string) =>
    _m.replace(name, allocate('PERSON', name)),
  )
  text = text.replace(DOB_RE, (_m, date: string) => _m.replace(date, allocate('DOB', date)))
  text = text.replace(EMPLOYER_RE, (_m, org: string) => _m.replace(org, allocate('ORG', org)))

  // 3. Structured PII patterns — NHS before phone (NHS is a special-
  // category identifier; don't let it be mislabeled as a phone number).
  text = text.replace(NHS_CANDIDATE_RE, (m) => (isLikelyNhsNumber(m) ? allocate('NHS', m) : m))
  text = text.replace(NI_NUMBER_RE, (m) => allocate('NI', m))
  text = text.replace(UK_POSTCODE_RE, (m) => allocate('POSTCODE', m))
  text = text.replace(IBAN_CANDIDATE_RE, (m) => (isLikelyIban(m) ? allocate('IBAN', m) : m))
  text = text.replace(SORT_CODE_RE, (m) => allocate('SORTCODE', m))
  text = text.replace(CARD_CANDIDATE_RE, (m) => (passesLuhn(m) ? allocate('CARD', m) : m))
  text = text.replace(
    PHONE_CANDIDATE_RE,
    (_m, prefix: string, candidate: string) =>
      prefix + (isLikelyPhone(candidate) ? allocate('PHONE', candidate) : candidate),
  )

  // Single-pass restore over known tokens only; placeholder variants the
  // cloud invents (wrong case, missing nonce) simply don't restore.
  const tokenAlternation = [...placeholderToOriginal.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|')

  return {
    redactedText: text,
    redactionCount: placeholderToOriginal.size,
    hasSpecialCategoryHint: containsSpecialCategoryContent(text),
    restore(cloudText: string): string {
      if (!tokenAlternation) return cloudText
      const re = new RegExp(tokenAlternation, 'g')
      return cloudText.replace(re, (token, offset: number) => {
        if (isInsideLinkContext(cloudText, offset)) return token
        const original = placeholderToOriginal.get(token)
        if (original === undefined) return token
        // Never restore payment cards into text — show last-4 only.
        if (token.startsWith('[CARD_')) return `•••• ${original.replace(/\D/g, '').slice(-4)}`
        return original
      })
    },
  }
}

/**
 * Curtain + optional Layer-B NER pass. `classify` is injected so this
 * module stays free of the model layer — pass `classifyEntities` from
 * on-device-ner.ts. A classifier that is disabled, absent, slow or
 * throwing resolves to zero entities and the deterministic curtain runs
 * unchanged; the NER pass never widens or weakens the curtain, it can only
 * add redactions.
 */
export async function redactForCloudEgressAsync(
  input: string,
  dictionary: CurtainDictionary = {},
  opts: {
    classify?: (text: string) => Promise<CurtainEntity[]>
    inferTimeoutMs?: number
  } = {},
): Promise<RedactionCurtain> {
  let entities: CurtainEntity[] = []
  if (opts.classify) {
    entities =
      (await withTimeout(
        Promise.resolve(opts.classify(input)).catch(() => []),
        opts.inferTimeoutMs ?? 5_000,
      )) ?? []
  }
  return redactForCloudEgress(input, dictionary, entities)
}

// ── Runtime probing & execution (Capacitor OS -> Browser AI -> WebLLM) ────

let engine: any = null
let enginePromise: Promise<any | null> | null = null
// Incremented on disable so a load that finishes later cannot resurrect
// the engine the user just turned off.
let engineGeneration = 0

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

export function isOnDeviceEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Deletes cached WebLLM model weights/WASM (~700MB) from Cache Storage.
 * Called on disable — "off" should mean "removed", not just "paused".
 */
export async function clearOnDeviceModelData(): Promise<void> {
  try {
    const webllm = await import('@mlc-ai/web-llm')
    const deleter = (webllm as { deleteModelAllInfoInCache?: (id: string) => Promise<void> })
      .deleteModelAllInfoInCache
    if (deleter) await deleter(MODEL_ID)
  } catch {
    // Cache eviction is best-effort — storage APIs vary across browsers.
  }
}

export function setOnDeviceEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false')
  } catch {
    // Private browsing / storage-full — the toggle just won't persist
    // across reloads, not a functional failure worth surfacing.
  }
  if (!enabled) {
    engineGeneration++
    const existing = engine
    engine = null
    enginePromise = null
    if (existing) {
      try {
        void existing.unload?.()
      } catch {
        // unload is best-effort; GC will reclaim if it fails.
      }
    }
    // The Layer-B NER pipeline shares the toggle — unload it too and
    // evict its cached weights (lazy import keeps the module out of the
    // disable path's bundle for users who never opted in).
    void import('./on-device-ner.js').then((m) => {
      m.unloadNerClassifier()
      void m.clearNerModelCache()
    })
    void clearOnDeviceModelData()
  }
}

/**
 * Inspect which on-device runtime tier is present on the current client,
 * ordered by lowest download overhead. This is a PRESENCE probe, not a
 * readiness check — a detected tier may still fail at call time (no GPU
 * adapter, model not downloaded, plugin absent `prompt()`), in which case
 * generation returns null rather than cascading to a hung download.
 */
export function detectOnDeviceProvider(): OnDeviceProviderKind {
  const g = globalThis as any
  const capPlugins = g?.Capacitor?.Plugins
  // Allowlisted bridge keys only — anything else under Capacitor.Plugins
  // that duck-types the contract is an unvetted third party receiving raw
  // family data on the very path sold as "never leaves this device".
  // TODO: verify plugin identity/version against a manifest before first
  // use once the plugin is confirmed shipping in apps/mobile builds.
  if (selectNativePlugin(capPlugins)) {
    return 'capacitor_native'
  }
  if (typeof g?.LanguageModel !== 'undefined') {
    return 'browser_builtin'
  }
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    return 'webllm'
  }
  return 'unavailable'
}

/**
 * Best-effort presence check — true when any on-device execution tier
 * (Capacitor native OS model, browser built-in AI, or WebGPU) is present.
 */
export function isOnDeviceSupported(): boolean {
  return detectOnDeviceProvider() !== 'unavailable'
}

/**
 * Memoized WebLLM engine loader: concurrent enable/draft calls share a
 * single initialization, a failed load clears the memo for retry, and a
 * disable while loading discards the result rather than resurrecting it.
 */
async function ensureEngine(onProgress?: (pct: number) => void): Promise<any | null> {
  if (engine) return engine
  if (!enginePromise) {
    const gen = ++engineGeneration
    enginePromise = (async () => {
      try {
        const webllm = await import('@mlc-ai/web-llm')
        const created = await webllm.CreateMLCEngine(MODEL_ID, {
          initProgressCallback: (report: { progress: number }) => {
            onProgress?.(Math.round(report.progress * 100))
          },
        })
        if (gen !== engineGeneration) {
          try {
            await created.unload?.()
          } catch {
            // best-effort cleanup of the superseded engine
          }
          return null
        }
        engine = created
        return engine
      } catch {
        return null
      }
    })()
    void enginePromise.then((loaded) => {
      if (!loaded) enginePromise = null
    })
  }
  return enginePromise
}

/**
 * Triggers the one-time model preparation (readiness check for native/
 * browser built-in models, or Cache-Storage weight caching for WebLLM).
 * Returns false on any failure rather than throwing.
 */
export async function enableOnDeviceModel(onProgress?: (pct: number) => void): Promise<boolean> {
  const provider = detectOnDeviceProvider()
  if (provider === 'unavailable') return false

  if (provider === 'capacitor_native' || provider === 'browser_builtin') {
    onProgress?.(100)
    return true
  }

  const loaded = await ensureEngine(onProgress)
  return loaded != null
}

/**
 * Structured-output unwrap — FAIL CLOSED. If the runtime was asked for
 * JSON and produced malformed/truncated JSON (or a JSON value without a
 * non-empty string `body`), the caller gets null rather than raw braces
 * rendered to the user. Plain (non-JSON) text passes through unchanged.
 */
export function unwrapStructuredDraft(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { body?: unknown }
      if (typeof parsed.body === 'string' && parsed.body.trim().length > 0) {
        return parsed.body.trim()
      }
    } catch {
      // malformed JSON — fall through to the fail-closed return
    }
    return null
  }
  return trimmed.length > 0 ? trimmed : null
}

function buildUserPrompt(stepBody: string, jsonMode: boolean): string {
  const suffix = jsonMode
    ? 'Respond with JSON of the form {"body": "<the email body text>"}.'
    : 'Write the draft email body.'
  return `Checklist step: ${stepBody}\n\n${suffix}`
}

// One-shot prompt() contract — @capacitor/local-llm shape.
async function runPromptPlugin(
  plugin: Record<string, any>,
  stepBody: string,
): Promise<string | null> {
  const res = await withTimeout<{ text?: unknown; response?: unknown }>(
    Promise.resolve(
      plugin.prompt({
        systemPrompt: SYSTEM_PROMPT,
        prompt: buildUserPrompt(stepBody, false),
      }),
    ),
    INFERENCE_TIMEOUT_MS,
  )
  const text = res?.text ?? res?.response ?? null
  return typeof text === 'string' ? text : null
}

// Chat-session adapter for @capgo/capacitor-llm. Readiness is gated so a
// not-ready/downloadable model returns null instead of starting a multi-GB
// download inside a Draft click. sendMessage has no system-prompt slot, so
// the draft rules ride inside the message; output is still guard-checked
// downstream like every other tier.
async function runCapgoSession(plugin: CapgoLikePlugin, stepBody: string): Promise<string | null> {
  if (typeof plugin.getReadiness === 'function') {
    const state = await withTimeout(plugin.getReadiness(), 5000)
    if (state?.readiness !== 'ready') return null
  }
  const chat = await withTimeout(Promise.resolve(plugin.createChat!()), SESSION_CREATE_TIMEOUT_MS)
  const chatId = chat?.id
  if (!chatId || typeof plugin.addListener !== 'function' || !plugin.sendMessage) return null

  // Listeners MUST be attached before sendMessage — streamed events fired
  // into an unregistered listener window are dropped (missed aiFinished
  // would hang until the timeout).
  let acc = ''
  let done!: (v: string | null) => void
  const finished = new Promise<string | null>((resolve) => {
    done = resolve
  })
  const handles = await Promise.all([
    plugin.addListener('textFromAi', (e) => {
      if (e?.chatId === chatId && typeof e?.text === 'string') acc += e.text
    }),
    plugin.addListener('aiFinished', (e) => {
      if (e?.chatId === chatId) done(acc)
    }),
    plugin.addListener('generationError', (e) => {
      if (!e?.chatId || e.chatId === chatId) done(null)
    }),
  ]).catch(() => null)
  if (!handles) return null
  try {
    void plugin
      .sendMessage({ chatId, message: `${SYSTEM_PROMPT}\n\n${buildUserPrompt(stepBody, false)}` })
      .catch(() => done(null))
    return await withTimeout(finished, INFERENCE_TIMEOUT_MS)
  } finally {
    for (const h of handles) void h?.remove?.().catch(() => undefined)
  }
}

async function runRawOnDeviceCompletion(stepBody: string): Promise<string | null> {
  const provider = detectOnDeviceProvider()
  const g = globalThis as any

  if (provider === 'capacitor_native') {
    const pick = selectNativePlugin(g.Capacitor.Plugins)
    if (!pick) return null
    const text =
      pick.kind === 'prompt'
        ? await runPromptPlugin(pick.plugin, stepBody)
        : await runCapgoSession(pick.plugin as unknown as CapgoLikePlugin, stepBody)
    return typeof text === 'string' ? unwrapStructuredDraft(text) : null
  }

  if (provider === 'browser_builtin') {
    const factory = g.LanguageModel
    if (typeof factory?.create !== 'function') return null
    // Never trigger a multi-GB model download inside a Draft click —
    // only a ready ('available') model may run.
    if (typeof factory.availability === 'function') {
      const availability = await withTimeout(factory.availability(), 5000)
      if (availability !== 'available') return null
    }
    interface BuiltInSession {
      prompt?: (input: string, options?: unknown) => Promise<unknown>
      destroy?: () => void
    }
    const session = await withTimeout<BuiltInSession>(
      Promise.resolve(
        factory.create({
          // Shipped Prompt API surface: system instruction goes in
          // initialPrompts, NOT a `systemPrompt` option (WebIDL silently
          // drops unknown dictionary members, which would strip all rules).
          initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
        }),
      ),
      SESSION_CREATE_TIMEOUT_MS,
    )
    if (!session || typeof session.prompt !== 'function') return null
    try {
      const reply = await withTimeout(
        session.prompt(buildUserPrompt(stepBody, true), {
          responseConstraint: DRAFT_JSON_SCHEMA,
          signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
        }),
        INFERENCE_TIMEOUT_MS + 5000,
      )
      return typeof reply === 'string' ? unwrapStructuredDraft(reply) : null
    } finally {
      session.destroy?.()
    }
  }

  if (provider === 'webllm') {
    const eng = engine ?? (await ensureEngine())
    if (!eng) return null
    interface WebLlmReply {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const reply = await withTimeout<WebLlmReply>(
      Promise.resolve(
        eng.chat.completions.create({
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildUserPrompt(stepBody, true) },
          ],
          response_format: {
            type: 'json_object',
            schema: JSON.stringify(DRAFT_JSON_SCHEMA),
          },
          max_tokens: MAX_OUTPUT_TOKENS,
          temperature: 0.2,
        }),
      ),
      INFERENCE_TIMEOUT_MS,
    )
    const content = reply?.choices?.[0]?.message?.content
    return typeof content === 'string' ? unwrapStructuredDraft(content) : null
  }

  return null
}

/**
 * Generates a draft entirely client-side, given the step's already-fetched
 * body text, then validates it through `verifyOnDeviceOutput` (enforcing
 * CLAUDE.md Rule 2 and numeral-presence grounding).
 *
 * Returns null if the model is unavailable, times out, or its output fails
 * the client safety/grounding guard — allowing the caller to choose a
 * fallback (deterministic template or consented cloud path).
 */
export type OnDeviceDraftOutcome = 'generated' | 'guard_rejected' | 'unavailable' | 'error'

export interface OnDeviceDraftResult {
  draft: string | null
  outcome: OnDeviceDraftOutcome
  /** Guard rejection reason or diagnostic — never contains user content. */
  reason?: string | undefined
}

/**
 * Outcome-reporting variant of generateDraftOnDevice — lets the caller
 * telemetry the *reason* on-device drafting abstained (metadata only, no
 * content), which the device-vs-hosted coverage metric needs.
 */
export async function generateDraftOnDeviceDetailed(
  stepBody: string,
): Promise<OnDeviceDraftResult> {
  if (typeof stepBody !== 'string' || stepBody.trim().length === 0) {
    return { draft: null, outcome: 'unavailable', reason: 'empty_input' }
  }
  if (!isOnDeviceSupported()) return { draft: null, outcome: 'unavailable' }
  try {
    const raw = await runRawOnDeviceCompletion(stepBody)
    if (!raw) return { draft: null, outcome: 'unavailable' }
    const checked = verifyOnDeviceOutput(raw, stepBody)
    if (checked.accepted) return { draft: checked.text, outcome: 'generated' }
    return { draft: null, outcome: 'guard_rejected', reason: checked.reason }
  } catch {
    return { draft: null, outcome: 'error' }
  }
}

export async function generateDraftOnDevice(stepBody: string): Promise<string | null> {
  const result = await generateDraftOnDeviceDetailed(stepBody)
  return result.draft
}
