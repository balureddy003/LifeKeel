/**
 * Vertical (Template) Schema
 *
 * A **vertical** is a first-class, brandable bundle that composes the primitives
 * LifeKeel already loads — connectors, detectors, outcome packs, goal templates,
 * workflows — and adds the two things those primitives lack at bundle level:
 * **personas** (who the vertical serves) and **domain vocabulary/theme** (how
 * the product talks to them).
 *
 * The engine, decision contracts, autonomy ladder, calibration, attribution, and
 * the suretyai guard are all vertical-agnostic *core* and are NOT referenced here.
 * A vertical is pure composition + identity — no new engine surface.
 *
 * The manifest references content by **id** (not by path), so it works with the
 * existing loaders (OutcomePackLoader, detector loaders) that read the flat
 * `detectors/` and `definitions/` directories today. See
 * docs/prd/vertical-template-framework.md.
 */

import { z } from 'zod'

/** A persona the vertical serves — used for onboarding, copy, and goal suggestions. */
export const PersonaSchema = z.object({
  id: z.string(), // 'investor', 'home-owner'
  name: z.string(), // 'Property Investor'
  description: z.string(),
  /** Jobs-to-be-done, in the persona's own words. Drives goal suggestions. */
  jobs_to_be_done: z.array(z.string()),
  /** Goal-template ids this persona typically starts with. */
  primary_goal_templates: z.array(z.string()).default([]),
})

export type Persona = z.infer<typeof PersonaSchema>

/** Optional presentation layer for the vertical (accent + copy tone). Pure UI. */
export const VerticalThemeSchema = z.object({
  /** Design-system accent token name (never a raw hex). */
  accent_token: z.string().optional(),
  /** One-line copy tone guide for generated language. */
  tone: z.string().optional(),
  /** Noun the vertical uses for a tracked entity, e.g. 'property', 'customer'. */
  entity_noun: z.string().optional(),
  /**
   * Lowercase noun phrase for what attribution tracking recovers/protects in
   * this vertical, e.g. 'revenue recovered', 'portfolio gains protected'.
   * Used in the Outcomes narrative headline; falls back to 'value recovered'
   * when unset so the copy never assumes SaaS/business framing by default.
   */
  outcome_noun: z.string().optional(),
})

export const VerticalSchema = z.object({
  id: z.string(), // 'family'
  name: z.string(), // 'Family'
  tagline: z.string().max(80),
  /** Lifecycle so we can ship verticals incrementally behind the same core. */
  status: z.enum(['alpha', 'beta', 'ga']).default('alpha'),
  /** Identity — who this vertical is for. */
  personas: z.array(PersonaSchema),
  /** Presentation — optional; falls back to the default DS + tone. */
  theme: VerticalThemeSchema.optional(),
  /** Data sources. Ids resolve against connectors/. */
  required_connectors: z.array(z.string()),
  optional_connectors: z.array(z.string()).default([]),
  /** Opportunity-mining detectors. Ids resolve against detectors/. */
  detectors: z.array(z.string()),
  /** Outcome packs bundled with this vertical. Ids resolve against definitions/outcome-packs/. */
  outcome_packs: z.array(z.string()),
  /** Goal templates surfaced in the goal compiler. Ids resolve against definitions/goal-templates/. */
  goal_templates: z.array(z.string()),
  /** Workflows/playbooks. Usually inherited via outcome_packs; list extras here. */
  workflows: z.array(z.string()).default([]),
  /** Metric vocabulary shown in dashboards and the goal compiler. Only
   * terms that make sense for every tenant of this vertical regardless of
   * country — jurisdiction-specific terms (e.g. a UK tax wrapper) belong in
   * kpi_vocabulary_by_country instead, never mixed in here. */
  kpi_vocabulary: z.array(z.string()).default([]),
  /** Extra KPI vocabulary that only applies in specific countries (ISO
   * 3166-1 alpha-2 keys, e.g. 'GB', 'IN') — appended to kpi_vocabulary for
   * tenants resolved to that country. Empty/unresolved country sees only
   * the universal kpi_vocabulary list, never a guess. */
  kpi_vocabulary_by_country: z.record(z.string(), z.array(z.string())).default({}),
  tier_minimum: z.enum(['individual', 'team', 'smb', 'enterprise']).default('smb'),
  /** ISO 3166-1 alpha-2 country codes where this vertical is supported.
   * Empty array (default) means global — available in all countries.
   * Used by the onboarding UI to filter verticals by the tenant's country. */
  supported_countries: z.array(z.string()).default([]),
})

export type Vertical = z.infer<typeof VerticalSchema>
