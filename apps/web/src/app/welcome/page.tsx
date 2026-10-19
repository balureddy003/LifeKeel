'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { Map, MessageSquare, ShieldQuestion, Users, Lock } from 'lucide-react'
import { AuthShell } from '@/components/landing/AuthShell'
import { haptic } from '@/lib/haptics'
const SLIDES = [
  {
    icon: Map,
    title: "Your Family's Life Map",
    subtitle:
      'See everything connected — protection, wealth, goals, and your whole family in one living map.',
  },
  {
    icon: MessageSquare,
    title: 'Just Ask',
    subtitle:
      'Never search through menus. Ask "Where is my travel insurance?" and get an instant answer.',
  },
  {
    icon: ShieldQuestion,
    title: 'Steps for a bad day',
    subtitle:
      'Tell Keel what happened and it lists the steps in order, with the policies and contacts you have on file filled in.',
  },
  {
    icon: Users,
    title: 'Built for Every Age',
    subtitle:
      'From your 8-year-old to your 70-year-old grandparent — the app adapts to each person.',
  },
  {
    icon: Lock,
    title: 'Your Data, Your Control',
    subtitle:
      'Your details are never sold. They are encrypted at rest, and you can export or delete your account from Settings.',
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

  const current = SLIDES[slide]
  const Icon = current?.icon ?? Map
  const last = slide >= SLIDES.length - 1

  return (
    <AuthShell title={current?.title ?? ''} sub={current?.subtitle} aside={<SkipLink />} wide>
      {/* Carousel pattern: announce the new slide without stealing focus, so "Continue" stays
          the one button to keep pressing. The status line is stable, only its text changes. */}
      <p className="lk-sr" role="status">
        {current?.title}. {current?.subtitle}
      </p>
      <div className="lk-welcome">
        <motion.div
          key={slide}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="lk-tile"
        >
          <Icon size={36} strokeWidth={1.5} />
        </motion.div>
      </div>

      <div className="lk-dots">
        {SLIDES.map((s, i) => (
          <button
            key={s.title}
            type="button"
            className="lk-dot"
            onClick={() => goToSlide(i)}
            aria-label={`Slide ${i + 1} of ${SLIDES.length}: ${s.title}`}
            aria-current={i === slide ? 'true' : undefined}
          />
        ))}
      </div>

      {last ? (
        <Link href="/signup" className="lk-btn">
          Get Started
        </Link>
      ) : (
        <>
          <button type="button" className="lk-btn" onClick={next}>
            Continue
          </button>
          {slide > 0 && (
            <button type="button" className="lk-textlink lk-textlink-muted" onClick={prev}>
              Back
            </button>
          )}
        </>
      )}
      <p className="lk-hint lk-center">
        Already have an account?{' '}
        <Link href="/login" className="lk-textlink">
          Sign in
        </Link>
      </p>
    </AuthShell>
  )
}

function SkipLink() {
  return (
    <Link href="/signup" className="lk-textlink lk-textlink-muted" onClick={() => haptic('light')}>
      Skip
    </Link>
  )
}
