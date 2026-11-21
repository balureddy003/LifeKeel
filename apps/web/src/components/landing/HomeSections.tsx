'use client'

import Link from 'next/link'
import {
  ArrowRight,
  Check,
  Compass,
  FolderLock,
  ShieldCheck,
  Siren,
  type LucideIcon,
} from 'lucide-react'
import { appUrl } from '@/lib/region'
import { track } from '@/lib/growth-track'
import { haptic } from '@/lib/haptics'
import { Heading, PLUS_PRICE } from './VividSections'
import { PROMISES } from './Promises'

/** The short home page's own sections: each one says one thing and links to the page with the rest. */

const EXPLORE: {
  icon: LucideIcon
  tone: string
  title: string
  body: string
  href: string
  cta: string
}[] = [
  {
    icon: Compass,
    tone: 'cyan',
    title: 'One problem, one number',
    body: 'Pick the question in front of your household, enter a few figures, and send the other adult the same answer.',
    href: '/how-it-works',
    cta: 'How it works',
  },
  {
    icon: FolderLock,
    tone: 'violet',
    title: 'What is on file',
    body: 'Policies, papers, dates and who to call, in one list every adult can open.',
    href: '/features',
    cta: 'See the features',
  },
  {
    icon: Siren,
    tone: 'amber',
    title: 'When something happens',
    body: 'Emergency Mode, papers the adults can open, and a draft to your own insurer that you edit and send.',
    href: '/features#bad-day',
    cta: 'During and after',
  },
]

export function Explore() {
  return (
    <section className="vv-section" aria-labelledby="vv-explore-h">
      <Heading
        eyebrow="What LifeKeel does"
        id="vv-explore-h"
        title="Three things, from what your family adds."
      />
      <ul className="vv-grid3">
        {EXPLORE.map(({ icon: Icon, tone, title, body, href, cta }) => (
          <li key={title} className={`vv-card vv-${tone}`}>
            <span className="vv-icon">
              <Icon size={20} aria-hidden="true" />
            </span>
            <h3>{title}</h3>
            <p>{body}</p>
            <Link className="vv-learn" href={href}>
              {cta}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

const TEASER_PROMISES = PROMISES.slice(0, 3)

export function PromisesTeaser() {
  return (
    <section className="vv-section" aria-labelledby="vv-promises-h">
      <Heading
        eyebrow="Trust"
        id="vv-promises-h"
        title="What Keel does not do."
        intro="No commissions, no product picks, no quiet actions."
      />
      <ul className="vv-grid3">
        {TEASER_PROMISES.map((p) => (
          <li key={p.title} className="vv-card">
            <span className="vv-icon vv-icon-grad">
              <ShieldCheck size={20} aria-hidden="true" />
            </span>
            <h3>{p.title}</h3>
            <p>{p.body}</p>
          </li>
        ))}
      </ul>
      <p className="vv-center">
        <Link className="vv-learn" href="/about">
          All six, and what we do with your data
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </p>
    </section>
  )
}

const PLAN_TEASER = [
  { name: 'Free', price: '£0', line: 'Your family list, Emergency Mode and your first brief.' },
  {
    name: 'Keel Plus',
    price: PLUS_PRICE,
    line: 'Unlimited briefs, a record kept current, and policy details read for you to confirm.',
  },
]

export function PlansTeaser() {
  return (
    <section className="vv-section" aria-labelledby="vv-plans-teaser-h">
      <Heading
        eyebrow="Pricing"
        id="vv-plans-teaser-h"
        title="Free to start. One optional paid plan."
      />
      <div className="vv-plans">
        {PLAN_TEASER.map((p) => (
          <article key={p.name} className={`vv-plan${p.name === 'Free' ? '' : ' vv-plan-plus'}`}>
            <h3>{p.name}</h3>
            <p className="vv-price">{p.price}</p>
            <p className="vv-plan-line">
              <Check size={16} aria-hidden="true" />
              {p.line}
            </p>
          </article>
        ))}
      </div>
      <div className="vv-center vv-cta-row">
        <a
          className="vv-btn"
          href={appUrl('/signup')}
          onClick={() => {
            haptic('light')
            track('landing_cta_click', { location: 'plans_teaser', method: 'signup' })
          }}
        >
          Create your free account
        </a>
        <Link className="vv-btn vv-btn-ghost" href="/pricing">
          Compare plans
        </Link>
      </div>
    </section>
  )
}
