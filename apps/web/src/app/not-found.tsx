'use client'

import Link from 'next/link'
import { AuthShell } from '@/components/landing/AuthShell'

export default function NotFound() {
  return (
    <AuthShell title="Page not found" sub="This page doesn't exist, or may have moved.">
      <Link href="/" className="lk-btn">
        Back to home
      </Link>
      <div className="lk-or">or try</div>
      <Link href="/guides" className="lk-btn lk-btn-quiet">
        Read the guides
      </Link>
      <Link href="/login" className="lk-textlink lk-textlink-muted">
        Sign in
      </Link>
    </AuthShell>
  )
}
