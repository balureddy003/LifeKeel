/**
 * Every boot-time configuration check, in one list. server.ts refuses to
 * start on any violation and logs every accepted exception.
 */
import { evaluateBootGuards, type Env } from './boot-guards.js'
import { evaluateTurnstileBoot } from './turnstile.js'
import { evaluateOtpBoot } from '../auth/otp.js'
import { evaluateStorageBoot } from '../documents/storage.js'

export { apiDocsEnabled } from './boot-guards.js'

export function collectBootGuards(
  env: Env,
  mode: string,
): { violations: string[]; exceptions: string[] } {
  const parts = [
    evaluateBootGuards(env, mode),
    evaluateTurnstileBoot(env, mode),
    evaluateOtpBoot(env, mode),
    evaluateStorageBoot(env, mode),
  ]
  return {
    violations: parts.flatMap((p) => p.violations),
    exceptions: parts.flatMap((p) => p.exceptions),
  }
}
