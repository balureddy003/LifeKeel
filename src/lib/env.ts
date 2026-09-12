// Single source of truth for the backend URL Trellis talks to. Previously
// duplicated as `process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'`
// in four separate files with no validation — a typo'd or missing env var
// would silently fall back to localhost in production instead of failing
// loudly. Still points at the shared kairos-ai API today; will move to a
// dedicated Trellis backend URL once that ships.
export function getApiBase(): string {
  const url = process.env.NEXT_PUBLIC_API_URL

  if (!url) {
    if (process.env.NODE_ENV === 'production') {
      console.error(
        'NEXT_PUBLIC_API_URL is not set — falling back to http://localhost:3001, which will not work in production.',
      )
    }
    return 'http://localhost:3001'
  }

  return url
}
