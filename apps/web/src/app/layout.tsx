import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { MotionConfig } from 'framer-motion'
import './globals.css'
import { AuthProvider } from '@/lib/auth-context'
import { ModeProvider } from '@/lib/mode-context'
import { AppShell } from '@/components/AppShell'
import { Observability } from '@/components/Observability'
import { ConfirmSheetProvider } from '@/components/ConfirmSheetProvider'

// globals.css's --font-sans was always 'Inter' by declaration, but no font
// was ever loaded — every visitor actually got system-ui. next/font self-
// hosts at build time, so this works with the static export (no runtime
// Google Fonts dependency, no FOIT) and keeps the cross-platform look
// consistent — system-ui means Roboto on Android, SF on iOS, Segoe on
// Windows, three different apps' worth of text rendering.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const TITLE = 'Agent Oak — When life doesn\'t go to plan, Oak knows what to do next'
const DESCRIPTION = 'A guided response plan for job loss, medical crises, and the unexpected — built for families of all ages. Informational only, not financial advice.'
// kairos-trellis is this site's actual Firebase Hosting target (see
// apps/web/.firebaserc) — used as a real, verifiable base rather than a
// guessed custom domain, since none is configured anywhere in this repo.
const SITE_URL = 'https://kairos-trellis.web.app'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Agent Oak',
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: 'Agent Oak',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Agent Oak' }],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/og-image.png'],
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
    <html lang="en" className={inter.variable}>
      <head>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        {/* iOS Safari's Add to Home Screen ignores SVG here and falls back
            to a screenshot of the page — a real 180x180 PNG is required. */}
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        {/* JSON-LD lives here, in the root layout, and nowhere else —
            verified the hard way: every route's actual content (marketing
            page included) renders inside AppShell, a Client Component
            gated on an async `isLoading` auth check (AuthGate in
            AppShell.tsx). A build-time static prerender can freeze on that
            gate's loading skeleton, so anything placed inside that tree —
            including a second `<script type="application/ld+json">` — is
            not reliably present in the raw HTML a non-JS crawler fetches.
            This tag, in a true Server Component with no client boundary
            above it, is unconditional. FAQPage answers here are all facts
            already stated somewhere on the public site — schema doesn't
            get to claim more than the visible copy does. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@graph': [
                {
                  '@type': 'Organization',
                  name: 'Agent Oak',
                  url: SITE_URL,
                  logo: `${SITE_URL}/icon.svg`,
                },
                {
                  '@type': 'WebSite',
                  name: 'Agent Oak',
                  url: SITE_URL,
                  description: DESCRIPTION,
                },
                {
                  '@type': 'FAQPage',
                  mainEntity: [
                    {
                      '@type': 'Question',
                      name: 'Is Agent Oak financial advice?',
                      acceptedAnswer: {
                        '@type': 'Answer',
                        text: 'No. Agent Oak is informational and educational only — not financial, investment, tax, or legal advice, and not a substitute for a licensed professional or for calling 911 in a real emergency.',
                      },
                    },
                    {
                      '@type': 'Question',
                      name: 'How much does Agent Oak cost?',
                      acceptedAnswer: {
                        '@type': 'Answer',
                        text: 'Agent Oak is free to start, no credit card required. Oak Plus is £7.99/month and adds AI document reading (provider, policy number, amount, and dates pulled automatically) and an AI-summarized inbox on top of everything in the free plan.',
                      },
                    },
                    {
                      '@type': 'Question',
                      name: 'Is my financial data sold or used to train AI models?',
                      acceptedAnswer: {
                        '@type': 'Answer',
                        text: "No. Your financial data isn't sold, and it isn't used to train models beyond the request that needs it. Connector passwords and access tokens are encrypted before they're ever stored.",
                      },
                    },
                    {
                      '@type': 'Question',
                      name: 'Can I cancel Oak Plus anytime?',
                      acceptedAnswer: {
                        '@type': 'Answer',
                        text: 'Yes. No credit card is required to start free, and you can cancel Oak Plus anytime from your account.',
                      },
                    },
                    {
                      '@type': 'Question',
                      name: 'Does Agent Oak work for the whole family, not just one person?',
                      acceptedAnswer: {
                        '@type': 'Answer',
                        text: "Yes. Add your partner and kids to your family's roster and every score, insight, and \"what if\" scenario accounts for the whole household, not just the person who signed up.",
                      },
                    },
                  ],
                },
              ],
            }),
          }}
        />
      </head>
      <body>
        <Observability />
        {/* Live-verification finding: the global CSS prefers-reduced-motion
            rule only zeroes out native CSS animations/transitions — it
            can't touch Framer Motion's own animation engine, which drives
            almost every motion.* component in this app (page transitions,
            card entrances, gestures, the tab bar). reducedMotion="user"
            makes every motion component in the tree check the OS-level
            preference itself, the one app-wide fix for all of them. */}
        <MotionConfig reducedMotion="user">
          <AuthProvider>
            <ModeProvider>
              <ConfirmSheetProvider>
                <AppShell>{children}</AppShell>
              </ConfirmSheetProvider>
            </ModeProvider>
          </AuthProvider>
        </MotionConfig>
      </body>
    </html>
  )
}
