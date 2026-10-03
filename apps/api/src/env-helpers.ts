import { z } from 'zod'

/**
 * Treats an empty string as "not set". The deploy workflow passes optional settings
 * as `KEY=${{ vars.KEY }}`, which becomes `KEY=` when the repo variable does not
 * exist. A strict `z.enum([...]).optional()` rejects '' and env.ts then exits at
 * boot, so an unset optional setting must never be able to take the API down.
 */
export const optionalEnum = <T extends [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), z.enum(values).optional())

export const optionalFlag = () => optionalEnum(['true', 'false'])

/**
 * Removes environment variables whose value is the empty string, so they behave as unset.
 *
 * The deploy workflow passes optional settings as KEY=${{ vars.KEY }}, which is `KEY=` when the repo
 * variable does not exist. Code throughout the API reads `process.env['X'] ?? default`, and an empty
 * string is not nullish: an empty CORS_ORIGIN reached the CORS plugin as '' and every request,
 * /health/ready included, returned 500. Normalising once at startup fixes the whole class instead of
 * one variable at a time. Returns the names removed (for logging).
 */
export function dropEmptyEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const removed: string[] = []
  for (const [key, value] of Object.entries(env)) {
    if (value === '') {
      delete env[key]
      removed.push(key)
    }
  }
  return removed
}
