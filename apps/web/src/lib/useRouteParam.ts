'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

/**
 * Static export (Firebase Hosting): every /<section>/<id>-style URL is
 * rewritten to that route's one prerendered "placeholder" page (see
 * firebase.json). On those pages useParams() returns the build-time
 * 'placeholder' — the param was baked in at `next build`, not read from
 * the browser URL. usePathname() does reflect the real URL, so the
 * segment right after `prefix` is the real param.
 *
 * Returns undefined until mounted: the prerendered HTML (and the first
 * client render that hydrates it) has no real param, so callers gate
 * param-dependent rendering and fetches on the value being defined —
 * otherwise the placeholder HTML and the hydrated render disagree.
 */
export function useRouteParam(prefix: string): string | undefined {
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted || !pathname) return undefined
  const base = prefix.split('/').filter(Boolean)
  const segments = pathname.split('/').filter(Boolean)
  if (base.some((segment, i) => segments[i] !== segment)) return undefined
  const raw = segments[base.length]
  if (!raw) return undefined
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}
