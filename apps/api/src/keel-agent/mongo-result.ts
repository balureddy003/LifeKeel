/** Drivers differ on whether findOneAndUpdate returns the document or { value }. */
export function unwrapDoc<T>(result: unknown): T | null {
  if (!result || typeof result !== 'object') return null
  return 'value' in result ? ((result as { value: T | null }).value ?? null) : (result as T)
}
