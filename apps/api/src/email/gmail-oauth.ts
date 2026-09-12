/**
 * Gmail OAuth2 helpers — the two calls the family email connector needs
 * beyond the authorize/token-exchange flow already handled generically in
 * routes/connector-credentials.ts: refreshing an expired access token
 * before a scan, and looking up which Gmail address was actually
 * authorized (IMAP XOAUTH2 needs the address as the username, and the
 * initial OAuth consent screen never tells us that on its own without
 * requesting an extra `email`/`openid` scope).
 */

export async function refreshGoogleAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; expiresIn: number } | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  })
  if (!res.ok) return null
  const data = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token || !data.expires_in) return null
  return { accessToken: data.access_token, expiresIn: data.expires_in }
}

/** Uses the Gmail API's own profile endpoint rather than the separate
 * userinfo/OpenID endpoint — works with just the gmail.readonly scope the
 * connector already requests, no extra `email`/`openid` scope needed. */
export async function fetchGmailAddress(accessToken: string): Promise<string | null> {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return null
  const data = (await res.json()) as { emailAddress?: string }
  return data.emailAddress ?? null
}
