'use client'

import { useEffect } from 'react'
import { reportError } from '@/lib/observability'

// Last-resort boundary — catches errors in the root layout itself, where
// error.tsx doesn't apply. Must render its own <html>/<body> and can't
// assume the app's CSS or providers are available, so this stays plain
// inline-styled HTML rather than reusing the app's design system.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    reportError(error, { digest: error.digest, boundary: 'global' })
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#08080c',
          color: '#f5f5f7',
        }}
      >
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
          Something went wrong
        </h1>
        <p style={{ color: '#9a9aa5', marginBottom: '2rem', maxWidth: '20rem' }}>
          Trellis hit an unexpected error loading the app. Your data is safe — reload to try again.
        </p>
        <button
          onClick={reset}
          style={{
            width: '100%',
            maxWidth: '20rem',
            background: '#6d5ef5',
            color: '#fff',
            fontWeight: 600,
            borderRadius: '1rem',
            padding: '1rem',
            fontSize: '1rem',
            border: 'none',
          }}
        >
          Reload
        </button>
      </body>
    </html>
  )
}
