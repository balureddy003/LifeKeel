import type { Metadata, Viewport } from 'next'
import { Inter, Instrument_Serif, Hanken_Grotesk, IBM_Plex_Mono } from 'next/font/google'
import { MotionConfig } from 'framer-motion'
import './globals.css'
import '@/components/landing/landing.css'
import { AuthProvider } from '@/lib/auth-context'
import { ModeProvider } from '@/lib/mode-context'
import { AppShell } from '@/components/AppShell'
import { Observability } from '@/components/Observability'
import { GoogleAnalytics } from '@/components/GoogleAnalytics'
import { AdPixels } from '@/components/AdPixels'
import { ConfirmSheetProvider } from '@/components/ConfirmSheetProvider'
import { ToastProvider } from '@/components/Toast'
import { NativeRegionGate } from '@/components/NativeRegionGate'

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

// Landing-only faces (PRD-209), self-hosted at build like Inter. Only the display
// face is preloaded; the others load when the landing uses them. Used through the
// .landing token layer, so the signed-in app keeps Inter.
const display = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
})
const body = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
  preload: false,
})
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
  preload: false,
})

const TITLE = "LifeKeel — When life doesn't go to plan, LifeKeel knows what to do next"
const DESCRIPTION =
  'A guided response plan for job loss, medical crises, and the unexpected — built for families of all ages. Informational only, not financial advice.'
// Canonical public domain — served via the Firebase Hosting site
// "lifekeel-trellis" (apps/web/.firebaserc). lifekeel.si redirects here.
const SITE_URL = 'https://lifekeel.co.uk'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'LifeKeel',
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: 'LifeKeel',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'LifeKeel' }],
    locale: 'en_GB',
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
  // themeColor is a static export — it can't track data-theme, so it stays
  // the dark palette (the default, and what OS chrome hints show while the
  // inline script below is still resolving the stored preference).
  themeColor: '#08080c',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

// Runs before first paint so a light-mode user never sees a dark flash —
// the CSS tokens flip off [data-theme] on <html>, and SSR can't know the
// localStorage preference, so the client has to set it in <head>. Keep the
// storage key and resolution logic identical to lib/theme.ts.
const THEME_INIT = `(function(){try{var p=localStorage.getItem('lifekeel-theme');document.documentElement.dataset.theme=p==='light'?'light':p==='dark'?'dark':(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark')}catch(e){document.documentElement.dataset.theme='dark'}})()`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${display.variable} ${body.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Dark is the default stylesheet assumption; this flips the html
            attribute before first paint for stored/system light. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
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
                  name: 'LifeKeel',
                  url: SITE_URL,
                  logo: `${SITE_URL}/icon.svg`,
                },
                {
                  '@type': 'WebSite',
                  name: 'LifeKeel',
                  url: SITE_URL,
                  description: DESCRIPTION,
                },
                {
                  '@type': 'FAQPage',
                  mainEntity: [
                    {
                      '@type': 'Question',
                      name: 'Is LifeKeel financial advice?',
                      acceptedAnswer: {
                        '@type': 'Answer',
                        text: 'No. LifeKeel is informational and educational only — not financial, investment, tax, or legal advice, and not a substitute for a licensed professional or for calling emergency services (999, 112, 911) in a real emergency.',
                      },
                    },
                    {
                      '@type': 'Question',
                      name: 'Will Keel move money or act on my behalf?',
                      acceptedAnswer: {
                        '@type': 'Answer',
                        text: 'No. Keel shows you what is on file and estimates possible gaps. It never moves money, buys products, or contacts anyone for you without you approving each step — and it has no commercial relationship with any insurer or provider.',
                      },
                    },
                    {
                      '@type': 'Question',
                      name: 'How much does LifeKeel cost?',
                      acceptedAnswer: {
                        '@type': 'Answer',
                        text: 'LifeKeel is free to start, no credit card required. Keel Plus is £7.99/month and adds AI document reading (provider, policy number, amount, and dates pulled automatically) and an AI-summarized inbox on top of everything in the free plan.',
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
                      name: 'Can I cancel Keel Plus anytime?',
                      acceptedAnswer: {
                        '@type': 'Answer',
                        text: 'Yes. No credit card is required to start free, and you can cancel Keel Plus anytime from your account.',
                      },
                    },
                    {
                      '@type': 'Question',
                      name: 'Does LifeKeel work for the whole family, not just one person?',
                      acceptedAnswer: {
                        '@type': 'Answer',
                        text: 'Yes. Add your partner and kids to your family\'s roster and every score, insight, and "what if" scenario accounts for the whole household, not just the person who signed up.',
                      },
                    },
                  ],
                },
              ],
            }),
          }}
        />
      </head>
      {/* suppressHydrationWarning: browser extensions (Grammarly etc.)
          inject data-* attributes onto <body> before hydration — a
          mismatch here is theirs, not a render bug. */}
      <body suppressHydrationWarning>
        <Observability />
        <GoogleAnalytics />
        <AdPixels />
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
                <ToastProvider>
                  <NativeRegionGate />
                  <AppShell>{children}</AppShell>
                </ToastProvider>
              </ConfirmSheetProvider>
            </ModeProvider>
          </AuthProvider>
        </MotionConfig>
      </body>
    </html>
  )
}
