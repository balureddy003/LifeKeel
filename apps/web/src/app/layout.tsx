import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AuthProvider } from '@/lib/auth-context'
import { ModeProvider } from '@/lib/mode-context'
import { AppShell } from '@/components/AppShell'
import { Observability } from '@/components/Observability'

export const metadata: Metadata = {
  title: 'Agent Oak — When life doesn\'t go to plan, Oak knows what to do next',
  description: 'A guided response plan for job loss, medical crises, and the unexpected — built for families of all ages. Informational only, not financial advice.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Agent Oak',
  },
}

export const viewport: Viewport = {
  themeColor: '#08080c',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icon.svg" />
      </head>
      <body>
        <Observability />
        <AuthProvider>
          <ModeProvider>
            <AppShell>{children}</AppShell>
          </ModeProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
