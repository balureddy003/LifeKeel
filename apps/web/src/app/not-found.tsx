'use client'

import Link from 'next/link'
import { Compass } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-family-500/10 border border-family-500/20 flex items-center justify-center mb-6">
        <Compass size={32} className="text-family-400" />
      </div>
      <h1 className="text-2xl font-bold mb-2">Page not found</h1>
      <p className="text-ink-tertiary mb-8 max-w-xs">
        This page doesn&apos;t exist, or may have moved.
      </p>
      <Link href="/" className="w-full max-w-xs">
        <button className="w-full bg-family-500 text-white font-semibold rounded-2xl py-4 text-base shadow-md shadow-family-500/15 active:opacity-90">
          Back to Home
        </button>
      </Link>
    </div>
  )
}
