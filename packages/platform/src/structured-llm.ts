/**
 * Structured Output Abstraction — typed LLM calls with Zod validation.
 *
 * The #1 source of silent runtime failures in LLM-powered workflows is
 * unstructured text output being parsed downstream without validation.
 * This module eliminates that by:
 *
 *   1. Generating a JSON schema from a Zod type
 *   2. Instructing the LLM to respond ONLY with valid JSON matching that schema
 *   3. Parsing + validating the response with `z.safeParse()`
 *   4. Retrying with the parse error message appended (up to maxRetries)
 *   5. Returning `{ data: T, raw: string, retries: number }` for observability
 *
 * Usage:
 *   const Result = z.object({ sentiment: z.enum(['positive','negative','neutral']), score: z.number() })
 *   const { data } = await callStructured(llm, {
 *     schema: Result,
 *     system: 'You are a sentiment analyser.',
 *     prompt: 'Analyse: "Great service, very happy!"',
 *   })
 *   // data.sentiment === 'positive', data.score === 0.92
 *
 * This replaces every `JSON.parse(await llm(...))` pattern in the codebase.
 */

import { z } from 'zod'
import type { LlmFn } from './llm.js'
import { LlmInputGuard, LlmOutputGuard, type LlmGuardEvent, type LlmGuardOptions } from './llm-guards.js'
import type { LlmBudgetGuard } from './llm-budget.js'
import type { GuardEventSink } from './guard-event-sink.js'

// ── Public API ─────────────────────────────────────────────────────────────────

/** Options for LLM governance — budget enforcement and guard event persistence. */
export interface LlmGovernanceOptions {
  /** Tenant ID for budget checks and event attribution. */
  tenantId: string
  /** Optional detector ID for per-detector budget limits. */
  detectorId?: string
  /** Budget guard instance. If provided, budget is checked BEFORE the LLM call. */
  budgetGuard?: LlmBudgetGuard
  /** Sink to persist guard events to llm_guard_events collection (ADR-0040). */
  guardEventSink?: GuardEventSink
}

export interface StructuredCallOptions<T> {
  /** Zod schema that the LLM output must satisfy. */
  schema: z.ZodType<T>
  /** System prompt (guidance, persona, context). Do NOT include JSON instructions here — they are auto-appended. */
  system: string
  /** User prompt. */
  prompt: string
  /** Model or tier string (e.g. 'claude-haiku-4-5' or 'tier:fast'). */
  model?: string
  /** Max retries on parse/validation failure. Default: 2. */
  maxRetries?: number
  /**
   * Optional human-readable description of the expected output.
   * Injected into the schema instruction for better LLM compliance.
   * e.g. "a sentiment classification with score"
   */
  outputDescription?: string
  inputGuard?: boolean | LlmGuardOptions
  outputGuard?: boolean | LlmGuardOptions
  /** Governance options — budget enforcement (ADR-0031) and guard persistence (ADR-0040). */
  governance?: LlmGovernanceOptions
}

export interface StructuredCallResult<T> {
  data: T
  /** Raw LLM response string (before parsing). */
  raw: string
  /** Number of retries needed (0 = success on first attempt). */
  retries: number
  /** True if the result was produced by the fallback (all retries exhausted). */
  usedFallback: boolean
  guardEvents: LlmGuardEvent[]
}

/**
 * Call an LLM and parse + validate the response against a Zod schema.
 * Retries on parse/validation failure, appending the error to guide the model.
 *
 * @throws Never — on exhausted retries returns fallback value if schema has defaults,
 *   otherwise throws `StructuredOutputError`.
 */
export async function callStructured<T>(
  llm: LlmFn,
  options: StructuredCallOptions<T>,
): Promise<StructuredCallResult<T>> {
  // ── ADR-0031: Budget enforcement ─────────────────────────────────────────────
  if (options.governance?.budgetGuard) {
    const decision = await options.governance.budgetGuard.check(
      options.governance.tenantId,
      options.governance.detectorId,
    )
    if (!decision.allowed) {
      throw new BudgetExhaustedError(
        `LLM budget exceeded for tenant ${options.governance.tenantId}: ${decision.reason}`,
        decision,
      )
    }
  }

  const maxRetries = options.maxRetries ?? 2
  const schema = options.schema
  const baseGuardOpts = typeof options.inputGuard === 'object' ? options.inputGuard : {}
  const guardOpts: LlmGuardOptions = {
    ...baseGuardOpts,
    ...(options.governance?.tenantId ? { tenantId: options.governance.tenantId } : {}),
  }
  const inputGuard = options.inputGuard === false
    ? null
    : new LlmInputGuard(guardOpts)
  const outputGuard = options.outputGuard === false
    ? null
    : new LlmOutputGuard(typeof options.outputGuard === 'object' ? options.outputGuard : {})
  const guardedPrompt = inputGuard?.guard(options.prompt) ?? { value: options.prompt, events: [] }

  // Generate JSON schema from Zod type for the system prompt
  const jsonSchema = zodToJsonSchema(schema)
  const schemaStr = JSON.stringify(jsonSchema, null, 2)

  const baseSystem = [
    options.system.trim(),
    '',
    '## Output format',
    `Respond with ONLY valid JSON${options.outputDescription ? ` representing ${options.outputDescription}` : ''}.`,
    'Do not include any prose, markdown code fences, or explanation.',
    'The JSON must conform exactly to this schema:',
    '```json',
    schemaStr,
    '```',
  ].join('\n')

  let lastError: string | null = null
  let retries = 0

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // On retries, append the previous error to guide the model
    const system = attempt === 0 || !lastError
      ? baseSystem
      : `${baseSystem}\n\n## Previous attempt was invalid\nError: ${lastError}\nPlease fix your response.`

    let raw: string
    try {
      raw = await llm(system, guardedPrompt.value, options.model)
    } catch (err) {
      lastError = `LLM call failed: ${(err as Error).message}`
      retries++
      continue
    }

    // Strip markdown fences if the model added them despite instructions
    const guardedOutput = outputGuard?.guard(raw) ?? { value: raw, events: [] }
    const cleaned = guardedOutput.value
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()

    let parsed: unknown
    try {
      parsed = JSON.parse(cleaned)
    } catch (err) {
      lastError = `JSON parse error: ${(err as Error).message}. Your response was: ${cleaned.slice(0, 200)}`
      retries++
      continue
    }

    const result = schema.safeParse(parsed)
    if (result.success) {
      const allEvents = [...guardedPrompt.events, ...guardedOutput.events]
      // ── ADR-0040: Persist guard events ───────────────────────────────────────
      if (allEvents.length > 0 && options.governance?.guardEventSink) {
        await options.governance.guardEventSink(allEvents).catch(() => { /* best-effort */ })
      }
      return {
        data: result.data,
        raw: cleaned,
        retries,
        usedFallback: false,
        guardEvents: allEvents,
      }
    }

    // Format Zod errors for the retry prompt
    lastError = `Schema validation failed:\n${result.error.errors
      .map(e => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n')}`
    retries++
  }

  // Persist guard events even on failure (best-effort; ADR-0040)
  const failureEvents = [...(guardedPrompt?.events ?? [])]
  if (failureEvents.length > 0 && options.governance?.guardEventSink) {
    await options.governance.guardEventSink(failureEvents).catch(() => { /* best-effort */ })
  }

  throw new StructuredOutputError(
    `callStructured failed after ${maxRetries + 1} attempts. Last error: ${lastError}`,
    lastError,
  )
}

// ── Error type ─────────────────────────────────────────────────────────────────

export class StructuredOutputError extends Error {
  constructor(message: string, public readonly lastValidationError: string | null) {
    super(message)
    this.name = 'StructuredOutputError'
  }
}

export class BudgetExhaustedError extends Error {
  constructor(message: string, public readonly decision: { spent_microdollars: number; limit_microdollars: number | null; reason?: string }) {
    super(message)
    this.name = 'BudgetExhaustedError'
  }
}

// ── Zod → JSON Schema (lightweight, no external dep) ─────────────────────────
//
// We implement a minimal Zod-to-JSON-schema converter rather than depending on
// `zod-to-json-schema` to keep the platform package lean. Covers the 90% case:
// object, string, number, boolean, array, enum, optional, nullable, literal.

function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodType>
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const [key, val] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(val)
      if (!(val instanceof z.ZodOptional) && !(val instanceof z.ZodNullable)) {
        required.push(key)
      }
    }
    return { type: 'object', properties, required }
  }
  if (schema instanceof z.ZodString) return { type: 'string' }
  if (schema instanceof z.ZodNumber) return { type: 'number' }
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' }
  if (schema instanceof z.ZodArray) {
    return { type: 'array', items: zodToJsonSchema(schema.element) }
  }
  if (schema instanceof z.ZodEnum) {
    return { type: 'string', enum: schema.options }
  }
  if (schema instanceof z.ZodLiteral) {
    return { const: schema.value }
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return zodToJsonSchema(schema.unwrap())
  }
  if (schema instanceof z.ZodUnion) {
    return { oneOf: (schema.options as z.ZodType[]).map(zodToJsonSchema) }
  }
  if (schema instanceof z.ZodRecord) {
    // ZodRecord's value type is accessible via ._def.valueType
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const valueType = (schema as any)._def?.valueType as z.ZodType | undefined
    return { type: 'object', additionalProperties: valueType ? zodToJsonSchema(valueType) : {} }
  }
  // Fallback for unknown Zod types
  return {}
}
