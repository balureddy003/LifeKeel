/**
 * The readiness score is a count of gaps found in what the family has put on the list. With nothing read yet it
 * comes back as 0, which on Home looks like a failing grade on day one. It is shown only once there is data
 * behind it and the number is a real one; until then Home leads with the next thing to do instead.
 */
export function shouldShowScore({
  score,
  hasLiveData,
}: {
  score: number
  hasLiveData: boolean
}): boolean {
  return hasLiveData && Number.isFinite(score) && score > 0
}
