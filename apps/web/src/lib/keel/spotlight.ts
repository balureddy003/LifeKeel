/**
 * After Keel sends the user to a page, outline the field it means.
 * Elements opt in with data-keel-anchor="<id>". Only the anchor id travels
 * through Keel; field values never do.
 */
const ANCHOR_RE = /^[a-z0-9-]{1,64}$/

export function collectAnchors(root: ParentNode = document): string[] {
  return [...root.querySelectorAll('[data-keel-anchor]')]
    .map((el) => el.getAttribute('data-keel-anchor') ?? '')
    .filter((a) => ANCHOR_RE.test(a))
    .slice(0, 50)
}

export function requestSpotlight(anchor: string | undefined, attempts = 20): void {
  if (!anchor || !ANCHOR_RE.test(anchor) || typeof document === 'undefined') return
  const el = document.querySelector<HTMLElement>(`[data-keel-anchor="${anchor}"]`)
  if (!el) {
    // The destination page may still be loading.
    if (attempts > 0) window.setTimeout(() => requestSpotlight(anchor, attempts - 1), 150)
    return
  }
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
  el.setAttribute('data-keel-spotlight', 'on')
  window.setTimeout(() => el.removeAttribute('data-keel-spotlight'), 3500)
}
