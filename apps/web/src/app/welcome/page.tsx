'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Map, MessageSquare, ShieldQuestion, Users, Lock } from 'lucide-react'
import { AuthShell } from '@/components/landing/AuthShell'
import { haptic } from '@/lib/haptics'
const SLIDES = [
  {
    icon: Map,
    title: "Your family's chart",
    subtitle:
      'What you hold and where it looks light, in one place: cover, savings, wills and papers.',
  },
  {
    icon: MessageSquare,
    title: 'Ask about what is on file',
    subtitle:
      'Ask where a policy is, and Keel answers from the papers and figures you have added.',
  },
  {
    icon: ShieldQuestion,
    title: 'Steps for a bad day',
    subtitle:
      'Tell Keel what happened and it lists the steps in order, with the policies and contacts you have on file filled in.',
  },
  {
    icon: Users,
    title: 'A place for everyone',
    subtitle:
      'Add your partner and children. Each adult has their own view, and children get a simpler one.',
  },
  {
    icon: Lock,
    title: 'Your data, your control',
    subtitle:
      'Your details are never sold. They are encrypted at rest, and you can export your data or delete your account from Settings.',
  },
]

export default function WelcomePage() {
  const [slide, setSlide] = useState(0)
  const router = useRouter()

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
    <AuthShell title="Welcome to LifeKeel" aside={<SkipLink />} wide>
      {/* One stable primary button: its label changes on the last slide, so keyboard focus is
          never lost. The slide is announced through a stable status line. */}
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
        <h2 className="lk-slide-title">{current?.title}</h2>
        <p className="lk-slide-text">{current?.subtitle}</p>
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

      <button
        type="button"
        className="lk-btn"
        onClick={() => {
          if (last) {
            haptic('light')
            router.push('/signup')
          } else {
            next()
          }
        }}
      >
        {last ? 'Create your free account' : 'Continue'}
      </button>
      <button
        type="button"
        className="lk-textlink lk-textlink-muted"
        onClick={prev}
        hidden={slide === 0}
      >
        Back
      </button>
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
      Skip to sign up
    </Link>
  )
}
