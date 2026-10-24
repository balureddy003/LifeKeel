/**
 * PRD-219: post formats and the hook allow-list, loaded from
 * definitions/marketing-formats.yaml and validated with Zod at boot —
 * an invalid file fails the API start, like the other definitions/.
 *
 * Selection is deterministic (least-used suitable format, a different one
 * per slot where possible); a `held` or `thread` format is never picked —
 * no publisher posts multi-post threads today.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as loadYaml } from 'js-yaml'
import { z } from 'zod'

const HookSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  label: z.string().min(1).max(80),
})

const FormatSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  label: z.string().min(1).max(80),
  status: z.enum(['active', 'held']).default('active'),
  channels: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/)).min(1),
  draft_prompt: z.string().min(10),
  fallback: z.string().min(1),
  card: z.enum(['headline', 'myth_fact']).optional(),
  card_sub: z.string().max(120).optional(),
  /** Reserved for later — no channel's publisher posts threads today. */
  thread: z.boolean().optional(),
})

export type HookDef = z.infer<typeof HookSchema>
export type FormatDef = z.infer<typeof FormatSchema>

export interface FormatsFile {
  hooks: HookDef[]
  formats: FormatDef[]
}

const FILE_SCHEMA = z.object({
  hooks: z.array(HookSchema).min(1),
  formats: z.array(FormatSchema).min(1),
})

let cached: FormatsFile | null = null

export function loadFormats(): FormatsFile {
  if (cached) return cached
  const here = path.dirname(fileURLToPath(import.meta.url))
  const file = path.resolve(here, '..', '..', '..', '..', 'definitions', 'marketing-formats.yaml')
  const parsed = FILE_SCHEMA.safeParse(loadYaml(fs.readFileSync(file, 'utf8')))
  if (!parsed.success) throw new Error(`marketing-formats.yaml invalid: ${parsed.error.message}`)
  const ids = new Set<string>()
  for (const f of parsed.data.formats) {
    if (ids.has(f.id)) throw new Error(`marketing-formats.yaml: duplicate format ${f.id}`)
    ids.add(f.id)
  }
  cached = parsed.data
  return cached
}

/** Test hook — bypass the file. */
export function setFormatsForTest(f: FormatsFile | null): void {
  cached = f
}

/** Formats a channel may use today: active, listed for the channel, and not a
 *  thread format (no publisher supports threads — see file header). */
export function suitableFormats(defs: FormatDef[], channel: string): FormatDef[] {
  return defs.filter((f) => f.status === 'active' && f.channels.includes(channel) && !f.thread)
}

/** Least-used suitable format not already taken this week; when every
 *  suitable format is taken, the least-used one repeats. `usage` counts past
 *  posts per format id. */
export function chooseFormat(
  defs: FormatDef[],
  channel: string,
  usage: Map<string, number>,
  taken: ReadonlySet<string>,
): FormatDef | null {
  const pool = suitableFormats(defs, channel).sort(
    (a, b) => (usage.get(a.id) ?? 0) - (usage.get(b.id) ?? 0) || defs.indexOf(a) - defs.indexOf(b),
  )
  if (pool.length === 0) return null
  return pool.find((f) => !taken.has(f.id)) ?? pool[0]!
}

/** Least-used hook, preferring one not already taken this week. */
export function chooseHook(
  hooks: HookDef[],
  usage: Map<string, number>,
  taken: ReadonlySet<string>,
): HookDef {
  const pool = [...hooks].sort(
    (a, b) =>
      (usage.get(a.id) ?? 0) - (usage.get(b.id) ?? 0) || hooks.indexOf(a) - hooks.indexOf(b),
  )
  return pool.find((h) => !taken.has(h.id)) ?? pool[0]!
}

/** The no-model path: the format's own template over the brief facts. */
export function renderFormatFallback(format: FormatDef, facts: string): string {
  return format.fallback.replace('{{facts}}', facts.trim()).trim()
}
