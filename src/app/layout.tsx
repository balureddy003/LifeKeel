import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AuthProvider } from '@/lib/auth-context'
import { ModeProvider } from '@/lib/mode-context'
import { AppShell } from '@/components/AppShell'

export const metadata: Metadata = {
  title: 'Family AI Office — Your family\'s financial operating system',
  description: 'Know the moment. Act with evidence. Built for families of all ages.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Family AI',
  },
}

export const viewport: Viewport = {
  themeColor: '#08080c',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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
        <AuthProvider>
          <ModeProvider>
            <AppShell>{children}</AppShell>
          </ModeProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
