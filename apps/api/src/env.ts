/**
 * Environment loading and validation.
 *
 * Uses dotenv to load .env files (replacing the custom parser).
 * Validates critical env vars at startup using zod — fails fast
 * if required config is missing in production.
 *
 * In development, missing optional vars default to safe values.
 * In production, required vars must be set or the server refuses to start.
 */

import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { createLogger } from '@lifekeel/platform'
import { dropEmptyEnv, optionalEnum, optionalFlag } from './env-helpers.js'

const log = createLogger({ service: 'env', version: '0.0.0' })

// Load .env from monorepo root (3 levels up from dist/)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(__dirname, '../../..', '.env')
dotenv.config({ path: envPath })

// An empty value (e.g. an unset deploy variable passed as KEY=) must behave as unset everywhere:
// code reads process.env['X'] ?? default, and '' is not nullish. See env-helpers.ts.
const droppedEmpty = dropEmptyEnv()
if (droppedEmpty.length > 0)
  log.info({ vars: droppedEmpty.join(',') }, 'Treating empty environment variables as unset')

// ── Config schema ─────────────────────────────────────────────────────────────
//
// Validates env vars at startup. Optional vars have defaults.
// Required vars in production are enforced below.

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  LIFEKEEL_DEPLOYMENT_MODE: z.enum(['dev', 'cloud', 'on-prem']).default('dev'),

  // Database
  MONGODB_URL: z.string().optional(),
  MONGODB_DB: z.string().default('lifekeel'),
  REDIS_URL: z.string().optional(),

  // Auth
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  SETTINGS_ENCRYPTION_KEY: z.string().optional(),
  ALLOW_DEMO_TOKENS: z.enum(['0', '1']).optional(),

  // LLM providers (all optional — at least one needed for goal compilation)
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  AZURE_OPENAI_ENDPOINT: z.string().optional(),
  AZURE_OPENAI_API_KEY: z.string().optional(),
  AZURE_OPENAI_DEPLOYMENT: z.string().optional(),
  AZURE_OPENAI_API_VERSION: z.string().optional(),
  OLLAMA_BASE_URL: z.string().optional(),
  // Self-hosted small model for the move judge (see infra/local-judge). When set,
  // the judge never calls a cloud LLM.
  LOCAL_JUDGE_BASE_URL: z.string().optional(),
  // How the API authenticates to the model service: 'cloudrun-iam' attaches a Google
  // identity token (service deployed with --no-allow-unauthenticated); unset/none sends none.
  LOCAL_JUDGE_AUTH: optionalEnum(['none', 'cloudrun-iam']),
  LOCAL_JUDGE_MODEL: z.string().optional(),
  LOCAL_CLASSIFIER_MODEL: z.string().optional(),
  LOCAL_OCR_MODEL: z.string().optional(),
  // Opt in to the self-hosted model for interactive text (Ask Keel, drafts, support).
  // Fan email scans out through the queue (parallel across workers) instead of one sequential cron loop.
  EMAIL_SCAN_FANOUT: optionalFlag(),
  EMAIL_SCAN_CONCURRENCY: z.string().optional(),
  // USD per hour of one model instance; enables the busy-time cost estimate metric.
  LOCAL_MODEL_COST_PER_HOUR_USD: z.string().optional(),
  // Email policy-relevance encoder (infra/encoder-service). Mode off/unset = not used.
  EMAIL_ENCODER_URL: z.string().optional(),
  EMAIL_ENCODER_MODE: optionalEnum(['off', 'shadow', 'gate']),
  EMAIL_TWO_STEP: optionalFlag(),
  LOCAL_MODEL_MAX_CONCURRENT: z.string().optional(),
  // Keep the cloud judge authoritative and measure the local one behind it (shadow mode).
  JUDGE_SHADOW: optionalFlag(),
  LOCAL_TEXT_ENABLED: optionalFlag(),
  LOCAL_TEXT_MODEL: z.string().optional(),

  // Billing
  BILLING_V2_ENABLED: z.enum(['true', 'false']).optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  LIFEKEEL_STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Notifications
  LIFEKEEL_SLACK_BOT_TOKEN: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  SENDGRID_FROM_EMAIL: z.string().optional(),

  // URLs
  STUDIO_URL: z.string().default('http://localhost:3000'),
  LIFEKEEL_URL: z.string().default('http://localhost:3002'),
  API_BASE_URL: z.string().default('http://localhost:3001'),
  NEXT_PUBLIC_API_URL: z.string().optional(),
  CORS_ORIGIN: z.string().optional(),

  // Edition
  LIFEKEEL_EDITION: z.enum(['busl', 'enterprise']).default('busl'),
  LIFEKEEL_ENTERPRISE_KEY: z.string().optional(),
})

export type Config = z.infer<typeof ConfigSchema>

// ── Parse and validate ────────────────────────────────────────────────────────

const parsed = ConfigSchema.safeParse(process.env)

if (!parsed.success) {
  const errors = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
  log.error({ errors }, 'FATAL: Invalid environment configuration')
  process.exit(1)
}

export const config = parsed.data

// In production, enforce required vars that are optional in dev
if (config.NODE_ENV === 'production') {
  const requiredInProd: Array<keyof Config> = [
    'MONGODB_URL',
    'JWT_SECRET',
    'REDIS_URL',
    'SETTINGS_ENCRYPTION_KEY',
  ]
  const missing = requiredInProd.filter((k) => !config[k])
  if (missing.length > 0) {
    log.error({ missing: missing.join(', ') }, 'FATAL: Missing required env vars in production')
    process.exit(1)
  }
}
