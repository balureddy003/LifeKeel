/**
 * Hand an invite link to the other adult in one tap: the phone's share sheet when
 * there is one (Messages, WhatsApp...), otherwise copy it. Cancelling the sheet is a
 * normal exit, not an error.
 */
export type ShareOutcome = 'shared' | 'copied' | 'cancelled'

interface ShareEnv {
  share?: ((data: { title: string; text: string; url: string }) => Promise<void>) | undefined
  clipboard?: { writeText: (s: string) => Promise<void> } | undefined
}

export async function shareInviteLink(
  url: string,
  firstName: string,
  env: ShareEnv,
): Promise<ShareOutcome> {
  if (typeof env.share === 'function') {
    try {
      await env.share({
        title: 'Our family list on LifeKeel',
        text: `${firstName}, here is our shared family list. Open it to see what is on file:`,
        url,
      })
      return 'shared'
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled'
      // fall through to copy
    }
  }
  await env.clipboard?.writeText(url)
  return 'copied'
}
