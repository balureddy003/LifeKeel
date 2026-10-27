'use client'

import type { ReactNode } from 'react'
import { useAuth } from '@/lib/auth-context'
import { SiteHeader } from './SiteHeader'
import { SiteFooter } from './SiteFooter'
import './landing.css'
import './hero.css'
import './bands.css'
import './public.css'
import './public-refresh.css'

/**
 * The frame for the public pages that are not the landing page itself (terms, privacy,
 * support, blog, guides, readiness): the landing header and footer around the page's own
 * content. Inside it the app's colour tokens are remapped to the landing palette (public.css),
 * so those pages' existing Tailwind classes follow the landing look in light and dark.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  // A signed-in person reading Terms from Settings should not be offered "Sign in".
  const { isAuthenticated } = useAuth()
  return (
    <div className="landing lk-public lk-studio">
      <SiteHeader home={false} signedIn={isAuthenticated} />
      <div className="lk-public-body">{children}</div>
      <SiteFooter home={false} />
    </div>
  )
}
