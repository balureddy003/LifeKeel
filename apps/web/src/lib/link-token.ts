/**
 * Emailed verification and reset links carry their token in the URL
 * fragment (#token=…), which browsers never send to servers, analytics tags
 * or Referer headers. Older emails used ?token=…, which still works. The
 * token is removed from the address bar as soon as it is read, and kept
 * here so a strict-mode double effect still sees it.
 */
let lastRead: { path: string; token: string } | null = null

export function readLinkToken(): string | null {
  const path = window.location.pathname
  const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token')
  const fromQuery = new URLSearchParams(window.location.search).get('token')
  const token = fromHash ?? fromQuery
  if (token) {
    lastRead = { path, token }
    window.history.replaceState(null, '', path)
    return token
  }
  return lastRead?.path === path ? lastRead.token : null
}
