import { z } from 'zod'

/**
 * Treats an empty string as "not set". The deploy workflow passes optional flags
 * as `KEY=${{ vars.KEY }}`, which becomes `KEY=` when the repo variable does not
 * exist. A strict `z.enum([...]).optional()` rejects '' and env.ts then exits at
 * boot, so an unset optional flag must never be able to take the API down.
 */
export const optionalFlag = () =>
  z.preprocess((v) => (v === '' ? undefined : v), z.enum(['true', 'false']).optional())
