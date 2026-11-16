/**
 * Zod expression of the extraction schemas (intent 97, slice 5).
 *
 * One Zod schema per document category (the PRD-143 field set in schema.ts)
 * and per mechanical-check document type (DOCUMENT_SCHEMAS in
 * resilience/extraction-checks.ts) — the same shapes the review screen, the
 * checks and the tests read. Behaviour is identical by construction:
 *
 * - Category field validators delegate to `normaliseValue`, so a value the
 *   schema accepts is exactly a value the pipeline would keep.
 * - Document schemas are loose objects (unknown keys pass through — the
 *   pipeline drops them via keepSchemaFields, it does not reject the
 *   document) whose superRefine runs `checkExtraction`, so `safeParse`
 *   succeeds exactly when the mechanical checks find no problems.
 *
 * The enforcement path is unchanged: pipeline.ts still calls normaliseValue
 * per key and profile-mapping still calls checkExtraction. These schemas are
 * the declarative mirror the intent asks for; a parity test pins agreement.
 */
import { z } from 'zod'
import { CATEGORIES, FIELD_SPECS, normaliseValue, type Category, type FieldSpec } from './schema.js'
import {
  DOCUMENT_SCHEMAS,
  checkExtraction,
  type DocumentType,
} from '../resilience/extraction-checks.js'

/** A raw model-output string is acceptable iff normaliseValue keeps it. */
const fieldValue = (spec: FieldSpec) => z.string().refine((v) => normaliseValue(spec, v) !== null)

const categoryShape = (cat: Category): Record<string, z.ZodTypeAny> =>
  Object.fromEntries(
    FIELD_SPECS.filter((f) => (f.categories as readonly string[]).includes(cat)).map((f) => [
      f.key,
      fieldValue(f).optional(),
    ]),
  )

const buildCategorySchema = (cat: Category) => z.looseObject(categoryShape(cat))
type CategorySchema = ReturnType<typeof buildCategorySchema>

export const CATEGORY_SCHEMAS = Object.fromEntries(
  CATEGORIES.map((cat) => [cat, buildCategorySchema(cat)]),
) as unknown as Record<Category, CategorySchema>

// ── Document-type schemas (mechanical checks) ────────────────────────────────

const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0
const isRealDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v)
}

const MONEY = z.number().refine(isWhole)
const DATE = z.string().refine(isRealDate)
const MONEY_LIST = z.array(z.number().refine(isWhole))

const docShape = (type: DocumentType): Record<string, z.ZodTypeAny> =>
  Object.fromEntries(
    Object.entries(DOCUMENT_SCHEMAS[type].fields).map(([key, kind]) => [
      key,
      (kind === 'money' ? MONEY : kind === 'date' ? DATE : MONEY_LIST).optional(),
    ]),
  )

export const DOCUMENT_ZOD_SCHEMAS = Object.fromEntries(
  (Object.keys(DOCUMENT_SCHEMAS) as DocumentType[]).map((type) => [
    type,
    z.looseObject(docShape(type)).superRefine((value, ctx) => {
      for (const problem of checkExtraction(type, value as Record<string, unknown>)) {
        ctx.addIssue({
          code: 'custom',
          path: [problem.field],
          message: problem.message,
        })
      }
    }),
  ]),
) as unknown as Record<DocumentType, z.ZodTypeAny>
