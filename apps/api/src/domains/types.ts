/**
 * Domain packs: one declarative contract for every "area of family life"
 * LifeKeel records (life & income protection, home, car, health, ...).
 *
 * A pack is data, not a feature. It declares what is recorded, who each
 * record belongs to, how the household confirms it, which first steps apply,
 * and which date changes prompt a re-check. Generic routes and UI read the
 * pack, so a new domain is a manifest plus copy.
 *
 * Boundaries stated in the type, not left to convention:
 *  - Facts, dates and steps only. No field or copy states whether cover is
 *    enough or what to buy (CLAUDE.md rule 2).
 *  - Nothing here acts on the family's behalf. Planning triggers are
 *    informational prompts (Tier 0).
 *  - `external` is a declaration of what a named outside person MAY see.
 *    It is not served to anyone until the safeguarding review (PRD-229)
 *    clears; `enabled` is pinned to false below.
 */
import { z } from 'zod'

const Slug = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/)

export const FieldSchema = z
  .object({
    key: Slug,
    label: z.string().min(1).max(80),
    kind: z.enum(['text', 'date', 'money', 'choice', 'member']),
    choices: z.array(z.string().min(1).max(60)).max(20).optional(),
    /** Encrypted at rest and excluded from logs (see crypto/envelope). */
    sensitive: z.boolean().default(false),
  })
  .strict()

export const RecordTypeSchema = z
  .object({
    key: Slug,
    label: z.string().min(1).max(80),
    /** Whose record it is: the holder, the person it concerns, or nobody. */
    person_attribution: z.enum(['holder', 'subject', 'none']),
    fields: z.array(FieldSchema).min(1).max(20),
    /**
     * `store`: kept in the generic domain_records collection.
     * `adapter`: read from an existing store, so data is never duplicated.
     */
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('store') }).strict(),
      z
        .object({
          kind: z.literal('adapter'),
          adapter: Slug,
          filter: z.record(z.string(), z.string()).optional(),
        })
        .strict(),
    ]),
  })
  .strict()

export const PlanningTriggerSchema = z
  .object({
    key: Slug,
    label: z.string().min(1).max(120),
    /** A date field on a record type, or a life-event kind. */
    on: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('date_field'), record: Slug, field: Slug }).strict(),
      z.object({ kind: z.literal('life_event'), event: Slug }).strict(),
    ]),
    /** Days before the date to prompt a re-check; ignored for life events. */
    lead_days: z.number().int().min(0).max(365).default(30),
  })
  .strict()

export const DomainPackSchema = z
  .object({
    id: Slug,
    title: z.string().min(1).max(80),
    /** One sentence: the question the household can answer. Facts only. */
    summary: z.string().min(1).max(200),
    records: z.array(RecordTypeSchema).min(1).max(8),
    /** A derived member x record view. Computed, never typed in. */
    matrix: z
      .object({ record: Slug, label: z.string().min(1).max(80) })
      .strict()
      .optional(),
    /** playbooks/family/<playbook>.yaml and which records it may show. */
    playbook: z
      .object({
        playbook: Slug,
        show_records: z.array(Slug).min(1),
        /** Heading above the person picker, e.g. 'If someone dies: what is on file'. */
        label: z.string().min(1).max(100).default('If something happens: what is on file'),
      })
      .strict()
      .optional(),
    planning: z.array(PlanningTriggerSchema).max(8).default([]),
    /** Who must confirm the record before it is "seen by both". */
    confirm: z.enum(['both_adults', 'organiser']),
    /** Entitlement key, or null for free. */
    entitlement: z.string().min(1).nullable().default(null),
    /** What a named outside person may see, per record type. Not served yet. */
    external: z
      .object({
        enabled: z.literal(false),
        permitted: z.record(Slug, z.array(Slug)),
      })
      .strict(),
  })
  .strict()

export type DomainPack = z.infer<typeof DomainPackSchema>
export type RecordType = z.infer<typeof RecordTypeSchema>
