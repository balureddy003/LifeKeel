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
import { createLogger } from '@agentoak/platform'

const log = createLogger({ service: 'env', version: '0.0.0' })

// Load .env from monorepo root (3 levels up from dist/)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(__dirname, '../../..', '.env')
dotenv.config({ path: envPath })

// ── Config schema ─────────────────────────────────────────────────────────────
//
// Validates env vars at startup. Optional vars have defaults.
// Required vars in production are enforced below.

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  KAIROS_DEPLOYMENT_MODE: z.enum(['dev', 'cloud', 'on-prem']).default('dev'),

  // Database
  MONGODB_URL: z.string().optional(),
  MONGODB_DB: z.string().default('kairos'),
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

  // Billing
  BILLING_V2_ENABLED: z.enum(['true', 'false']).optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  KAIROS_STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Notifications
  KAIROS_SLACK_BOT_TOKEN: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  SENDGRID_FROM_EMAIL: z.string().optional(),

  // URLs
  STUDIO_URL: z.string().default('http://localhost:3000'),
  AGENT_OAK_URL: z.string().default('http://localhost:3002'),
  API_BASE_URL: z.string().default('http://localhost:3001'),
  NEXT_PUBLIC_API_URL: z.string().optional(),
  CORS_ORIGIN: z.string().optional(),

  // Edition
  KAIROS_EDITION: z.enum(['busl', 'enterprise']).default('busl'),
  KAIROS_ENTERPRISE_KEY: z.string().optional(),
})

export type Config = z.infer<typeof ConfigSchema>

// ── Parse and validate ────────────────────────────────────────────────────────

const parsed = ConfigSchema.safeParse(process.env)

if (!parsed.success) {
  const errors = parsed.error.issues
    .map(i => `  ${i.path.join('.')}: ${i.message}`)
    .join('\n')
  log.error({ errors }, 'FATAL: Invalid environment configuration')
  process.exit(1)
}

export const config = parsed.data

// In production, enforce required vars that are optional in dev
if (config.NODE_ENV === 'production') {
  const requiredInProd: Array<keyof Config> = ['MONGODB_URL', 'JWT_SECRET', 'REDIS_URL', 'SETTINGS_ENCRYPTION_KEY']
  const missing = requiredInProd.filter(k => !config[k])
  if (missing.length > 0) {
    log.error({ missing: missing.join(', ') }, 'FATAL: Missing required env vars in production')
    process.exit(1)
  }
}
