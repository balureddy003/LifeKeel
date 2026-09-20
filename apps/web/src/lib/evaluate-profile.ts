import { getApiBase } from './env'
import { invalidateCache } from './fetch-cache'

/**
 * Runs the detectors against the profile already on file (POST
 * /family/financial-profile/evaluate), for a family whose wizard autosaved
 * but never reached the final submit. Resolves with the number of insights
 * generated; rejects with a user-presentable message otherwise.
 */
export async function evaluateSavedProfile(): Promise<number> {
  const token = typeof window === 'undefined' ? null : localStorage.getItem('agentoak_token')
  const res = await fetch(`${getApiBase()}/family/financial-profile/evaluate`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(
      res.status === 422
        ? 'Your saved profile is missing some required numbers — finish it in the profile form.'
        : data.error || 'Could not analyse your profile right now.',
    )
  }
  // Everything downstream reads these cached copies.
  invalidateCache('financial-profile')
  invalidateCache('family-insights')
  return data.insights_generated ?? 0
}
