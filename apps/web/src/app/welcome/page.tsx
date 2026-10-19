'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { Map, MessageSquare, ShieldQuestion, Users, ArrowLeft, Lock } from 'lucide-react'
import { haptic } from '@/lib/haptics'
const SLIDES = [
  {
    icon: Map,
    title: "Your Family's Life Map",
    subtitle:
      'See everything connected — protection, wealth, goals, and your whole family in one living map.',
    bg: 'from-family-500/20 to-transparent',
  },
  {
    icon: MessageSquare,
    title: 'Just Ask',
    subtitle:
      'Never search through menus. Ask "Where is my travel insurance?" and get an instant answer.',
    bg: 'from-info/20 to-transparent',
  },
  {
    icon: ShieldQuestion,
    title: 'Steps for a bad day',
    subtitle:
      'Tell Keel what happened and it lists the steps in order, with the policies and contacts you have on file filled in.',
    bg: 'from-family-500/20 to-transparent',
  },
  {
    icon: Users,
    title: 'Built for Every Age',
    subtitle:
      'From your 8-year-old to your 70-year-old grandparent — the app adapts to each person.',
    bg: 'from-success/20 to-transparent',
  },
  {
    icon: Lock,
    title: 'Your Data, Your Control',
    subtitle:
      'Your details are never sold. They are encrypted at rest, and you can export or delete your account from Settings.',
    bg: 'from-family-500/20 to-transparent',
  },
]

export default function WelcomePage() {
  const [slide, setSlide] = useState(0)

  const next = () => {
    haptic('light')
    if (slide < SLIDES.length - 1) {
      setSlide(slide + 1)
    }
  }

  const prev = () => {
    haptic('light')
    if (slide > 0) {
      setSlide(slide - 1)
    }
  }

  const goToSlide = (i: number) => {
    haptic('light')
    setSlide(i)
  }

  return (
    <div className="min-h-screen flex flex-col px-6 pt-12 pb-8">
      <div className="flex justify-end">
        <Link
          href="/signup"
          className="text-sm text-ink-tertiary font-semibold"
          onClick={() => haptic('light')}
        >
          Skip
        </Link>
      </div>

      {/* Live-verification finding: unlike a form wizard, this carousel's
          "Continue" button stays put (never unmounts), so focus is never
          lost the way it was on the Gmail manual-fallback reveal — but the
          slide content underneath changed silently, with nothing telling a
          screen-reader user the title/subtitle they just heard is now
          stale. Moving focus to each new slide (the wizard's fix) would be
          wrong here: it'd force re-navigating back to Continue every
          single slide in a flow that's meant to be "keep pressing the same
          button." The standard carousel pattern instead announces without
          stealing focus — aria-live on a stable wrapper (not the
          remounting AnimatePresence child, so it's read as a mutation of
          existing content rather than a brand-new, unannounced element). */}
      <div
        className="flex-1 flex flex-col items-center justify-center px-2"
        aria-live="polite"
        aria-atomic="true"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={slide}
            initial={{ opacity: 0, x: 32 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -32 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="flex flex-col items-center text-center p-6"
          >
            <motion.div
              className="w-24 h-24 rounded-[2rem] bg-family-500/8 border border-family-500/15 flex items-center justify-center mb-10"
              animate={{ scale: [1, 1.03, 1] }}
              transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
            >
              {(() => {
                const Icon = SLIDES[slide]?.icon ?? Map
                return <Icon size={40} className="text-family-400" strokeWidth={1.5} />
              })()}
            </motion.div>
            <h1 className="text-title-lg leading-tight font-bold tracking-tight mb-4 max-w-[14rem]">
              {SLIDES[slide]?.title ?? ''}
            </h1>
            <p className="text-lead text-ink-secondary leading-relaxed max-w-[17rem]">
              {SLIDES[slide]?.subtitle ?? ''}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Dots */}
      <div className="flex justify-center gap-2 mb-8">
        {SLIDES.map((s, i) => (
          <motion.button
            key={i}
            onClick={() => goToSlide(i)}
            className="rounded-full"
            aria-label={`Slide ${i + 1} of ${SLIDES.length}: ${s.title}`}
            aria-current={i === slide ? 'true' : undefined}
            animate={{
              width: i === slide ? 24 : 8,
              height: 8,
              backgroundColor:
                i === slide ? 'rgb(var(--family-accent))' : 'rgb(var(--tint) / 0.15)',
            }}
          />
        ))}
      </div>

      {/* CTA */}
      <div className="space-y-3">
        {slide < SLIDES.length - 1 ? (
          <div className="space-y-2">
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={next}
              className="w-full bg-family-500 text-white font-semibold rounded-2xl py-4 text-base shadow-md shadow-family-500/15 active:opacity-90"
            >
              Continue
            </motion.button>
            {slide > 0 && (
              <button
                onClick={prev}
                className="w-full text-sm text-ink-tertiary font-semibold py-2 flex items-center justify-center gap-1"
              >
                <ArrowLeft size={14} /> Back
              </button>
            )}
          </div>
        ) : (
          <Link href="/signup" className="block">
            <motion.button
              whileTap={{ scale: 0.96 }}
              className="w-full bg-family-500 text-white font-semibold rounded-2xl py-4 text-base shadow-md shadow-family-500/15 active:opacity-90"
            >
              Get Started
            </motion.button>
          </Link>
        )}
        <Link href="/login" className="block text-center">
          <span className="text-sm text-ink-tertiary">Already have an account? Sign in</span>
        </Link>
      </div>
    </div>
  )
}
