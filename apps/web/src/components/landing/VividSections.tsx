'use client'

import {
  ArrowRight,
  BellRing,
  Camera,
  Check,
  ClipboardList,
  Compass,
  FolderLock,
  KeyRound,
  LifeBuoy,
  Mail,
  MessageSquareText,
  PenLine,
  ScanSearch,
  ShieldCheck,
  Siren,
  Trash2,
  UserRoundX,
  type LucideIcon,
} from 'lucide-react'
import { appUrl } from '@/lib/region'
import { track } from '@/lib/growth-track'
import { haptic } from '@/lib/haptics'
import { CAPABILITIES, MOMENTS, type Moment } from './capabilities'
import { PROMISES } from './Promises'
import { SECURITY } from './Security'
import { FREE_ROWS, PLUS_ROWS } from './Pricing'
import { FAQ } from './faq-data'

function signup(location: string) {
  return () => {
    haptic('light')
    track('landing_cta_click', { location, method: 'signup' })
  }
}

function Heading({
  eyebrow,
  title,
  id,
  intro,
}: {
  eyebrow: string
  title: string
  id: string
  intro?: string
}) {
  return (
    <header className="vv-head">
      <p className="vv-eyebrow">{eyebrow}</p>
      <h2 id={id}>{title}</h2>
      {intro && <p className="vv-intro">{intro}</p>}
    </header>
  )
}

const STATS = [
  { value: '£0', label: 'to start, no card' },
  { value: '7', label: 'kinds of bad day, with steps' },
  { value: '0', label: 'commissions or ads' },
  { value: '£7.99', label: 'one optional plan, a month' },
]

export function StatStrip() {
  return (
    <ul className="vv-stats" aria-label="LifeKeel at a glance">
      {STATS.map((s) => (
        <li key={s.label}>
          <b>{s.value}</b>
          <span>{s.label}</span>
        </li>
      ))}
    </ul>
  )
}

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: ClipboardList,
    title: 'Add what you hold',
    body: 'Savings, cover, debts, wills and papers, and who is in the family. Type it in or upload the document.',
  },
  {
    icon: ScanSearch,
    title: 'Keel checks it',
    body: 'Runway, cover against a rough estimate, renewals, duplicates and retirement pace, all from your own figures.',
  },
  {
    icon: Compass,
    title: 'Know the next step',
    body: 'A readiness snapshot today, and a short set of steps on the day something happens.',
  },
]

export function HowItWorks() {
  return (
    <section className="vv-section" aria-labelledby="vv-how-h">
      <Heading eyebrow="How it works" id="vv-how-h" title="Three steps to a clearer picture." />
      <ol className="vv-steps">
        {STEPS.map(({ icon: Icon, title, body }, i) => (
          <li key={title}>
            <span className="vv-step-n">{i + 1}</span>
            <span className="vv-icon">
              <Icon size={22} aria-hidden="true" />
            </span>
            <h3>{title}</h3>
            <p>{body}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

const MOMENT_STYLE: Record<Moment, { tone: string; icon: LucideIcon }> = {
  before: { tone: 'cyan', icon: ShieldCheck },
  during: { tone: 'violet', icon: LifeBuoy },
  after: { tone: 'amber', icon: MessageSquareText },
}

const PROBLEMS: Array<[string, string, string]> = [
  [
    'income_stops',
    'One of us might stop earning',
    'How many months could the household run on savings and any cover on file?',
  ],
  [
    'earning_less',
    'Someone is about to earn less',
    'A known drop is coming — see the savings left when it lands, and the months after.',
  ],
  [
    'handover_gap',
    'The other adult does not know',
    'The runway, who to call, and where the key papers and policies live.',
  ],
  [
    'mortgage_fix',
    'Our mortgage fix is ending',
    'Enter the new payment and see how the months change from the day it starts.',
  ],
  [
    'fees_start',
    'Nursery or school fees are starting',
    'A new monthly cost from a known date — see what it does to the months left.',
  ],
  [
    'job_change',
    'A job change or notice period',
    'The gap after the final pay date, and the months you could cover it.',
  ],
]

export function ThreeProblems() {
  return (
    <section className="vv-section" aria-labelledby="vv-problems-h">
      <Heading
        eyebrow="Start here"
        id="vv-problems-h"
        title="One problem, one evening, one number."
        intro="Pick the question in front of your household. A few figures in, one answer out — send it to the other adult and you will see when they have opened it."
      />
      <div className="vv-plans">
        {PROBLEMS.map(([id, t, d]) => (
          <article className="vv-plan" key={t}>
            <h3>
              <a href={appUrl(`/signup?brief=${id}`)} onClick={signup('problems')}>
                {t}
              </a>
            </h3>
            <p>{d}</p>
          </article>
        ))}
      </div>
      <p className="vv-fine vv-center">
        Your first brief is free. No product recommendations, ever.
      </p>
      <div className="vv-center">
        <a className="vv-btn" href={appUrl('/signup')} onClick={signup('problems')}>
          Start your first brief
        </a>
      </div>
    </section>
  )
}

export function Features() {
  return (
    <section className="vv-section" id="features" aria-labelledby="vv-features-h">
      <Heading
        eyebrow="One home for the family"
        id="vv-features-h"
        title="Ready before. Found during. Sorted after."
        intro="Everything below works from what your family adds. Keel shows, estimates and drafts. You decide."
      />
      <div className="vv-moments">
        {MOMENTS.map((m) => {
          const { tone, icon: Icon } = MOMENT_STYLE[m.id]
          return (
            <article key={m.id} className={`vv-moment vv-${tone}`}>
              <header>
                <span className="vv-icon">
                  <Icon size={22} aria-hidden="true" />
                </span>
                <div>
                  <h3>{m.name}</h3>
                  <p>{m.line}</p>
                </div>
              </header>
              <ul>
                {CAPABILITIES.filter((c) => c.moment === m.id && c.live).map((c) => (
                  <li key={c.claim}>
                    <Check size={16} aria-hidden="true" />
                    <span>
                      {c.text}
                      <small>{c.qualifier}</small>
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          )
        })}
      </div>
    </section>
  )
}

const BAD_DAY: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Siren,
    title: 'Emergency Mode',
    body: 'Say what happened and get steps for seven kinds of bad day, starting with the first three.',
  },
  {
    icon: FolderLock,
    title: 'Papers the adults can open',
    body: 'The adults who have joined your household can open the documents you stored.',
  },
  {
    icon: PenLine,
    title: 'A draft to your own insurer',
    body: 'Keel finds the claim contact on file and drafts the message. You edit it and send it.',
  },
  {
    icon: Mail,
    title: 'If you go quiet',
    body: 'Optional emails to people you name, pointing them to papers they can already open. Off until you switch it on.',
  },
]

export function BadDay() {
  return (
    <section className="vv-section" aria-labelledby="vv-badday-h">
      <div className="vv-dark">
        <Heading
          eyebrow="During and after"
          id="vv-badday-h"
          title="When something happens, your family has somewhere to start."
        />
        <ul className="vv-badday">
          {BAD_DAY.map(({ icon: Icon, title, body }) => (
            <li key={title}>
              <span className="vv-icon">
                <Icon size={22} aria-hidden="true" />
              </span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ul>
        <p className="vv-dark-note">
          Not a substitute for emergency services. In an emergency call 999, 112 or 911.
        </p>
      </div>
    </section>
  )
}

const PLUS_FIELDS = [
  ['Provider', 'Example Insurance Co.'],
  ['Policy number', 'HO-88213-A'],
  ['Amount', '£1,240/yr'],
  ['Renews', '14 Jun 2027'],
] as const

export function PlusBand() {
  return (
    <section className="vv-section" aria-labelledby="vv-plus-h">
      <div className="vv-plus">
        <div>
          <p className="vv-eyebrow">Keel Plus</p>
          <h2 id="vv-plus-h">Keep the household record current.</h2>
          <p className="vv-intro">
            The paid plan keeps your household record and briefs current as figures change.
            Photograph an insurance policy or pension statement and it also reads out the provider,
            policy number, amount and renewal date for you to confirm. Typing things in yourself
            stays free.
          </p>
          <a
            className="vv-btn vv-btn-light"
            href={appUrl('/signup')}
            onClick={signup('plus_spotlight')}
          >
            Start free, add Plus later
            <ArrowRight size={18} aria-hidden="true" />
          </a>
        </div>
        <article className="vv-scan" aria-label="Sample policy fields read for you">
          <header>
            <span className="vv-icon">
              <Camera size={20} aria-hidden="true" />
            </span>
            <div>
              <h3>Read from a policy</h3>
              <small>Sample document</small>
            </div>
          </header>
          <dl>
            {PLUS_FIELDS.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>
                  {v}
                  <Check size={14} aria-hidden="true" />
                </dd>
              </div>
            ))}
          </dl>
          <p>Made-up document. You check each field before it is saved.</p>
        </article>
      </div>
    </section>
  )
}

const PROMISE_ICONS: LucideIcon[] = [BellRing, ShieldCheck, Compass, PenLine, UserRoundX, KeyRound]
const SECURITY_ICONS: LucideIcon[] = [KeyRound, ShieldCheck, Trash2]
const TONES = ['cyan', 'blue', 'violet', 'amber', 'pink', 'green'] as const

export function Trust() {
  return (
    <section className="vv-section" id="security" aria-labelledby="vv-trust-h">
      <Heading
        eyebrow="Trust and security"
        id="vv-trust-h"
        title="Six things Keel does not do."
        intro="No commissions, no product picks, no quiet actions. Here is what is true today."
      />
      <ul className="vv-grid3">
        {PROMISES.map((p, i) => {
          const Icon = PROMISE_ICONS[i] ?? ShieldCheck
          return (
            <li key={p.title} className={`vv-card vv-${TONES[i % TONES.length]}`}>
              <span className="vv-icon">
                <Icon size={20} aria-hidden="true" />
              </span>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </li>
          )
        })}
      </ul>
      <h3 className="vv-subhead">What we do with your data.</h3>
      <ul className="vv-grid3 vv-security">
        {SECURITY.map((s, i) => {
          const Icon = SECURITY_ICONS[i] ?? ShieldCheck
          return (
            <li key={s.title} className="vv-card">
              <span className="vv-icon vv-icon-grad">
                <Icon size={20} aria-hidden="true" />
              </span>
              <h4>{s.title}</h4>
              <p>{s.body}</p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function Plans() {
  return (
    <section className="vv-section" id="pricing" aria-labelledby="vv-pricing-h">
      <Heading
        eyebrow="Pricing"
        id="vv-pricing-h"
        title="Free to start. One optional paid plan."
        intro="Checking what you have told Keel is free — including your first brief. The paid plan keeps the household record current and unlocks further briefs."
      />
      <div className="vv-plans">
        <article className="vv-plan">
          <h3>Free</h3>
          <p className="vv-price">£0</p>
          <ul>
            {FREE_ROWS.map((r) => (
              <li key={r.text}>
                <Check size={16} aria-hidden="true" />
                {r.text}
              </li>
            ))}
          </ul>
          <a
            className="vv-btn vv-btn-ghost"
            href={appUrl('/signup')}
            onClick={signup('pricing_free')}
          >
            Create your free account
          </a>
        </article>
        <article className="vv-plan vv-plan-plus">
          <h3>Keel Plus</h3>
          <p className="vv-price">£7.99 a month</p>
          <ul>
            {PLUS_ROWS.map((r) => (
              <li key={r.text}>
                <Check size={16} aria-hidden="true" />
                {r.text}
              </li>
            ))}
          </ul>
          <p className="vv-fine">Cancel any time. No card needed to start.</p>
          <a className="vv-btn" href={appUrl('/signup')} onClick={signup('pricing_plus')}>
            Start free, add Plus later
          </a>
        </article>
      </div>
      <p className="vv-fine vv-center">You upgrade from inside your account once you are in.</p>
    </section>
  )
}

export function Questions() {
  return (
    <section className="vv-section" id="faq" aria-labelledby="vv-faq-h">
      <Heading eyebrow="Common questions" id="vv-faq-h" title="Straight answers." />
      <div className="vv-faq">
        {FAQ.map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

export function FinalCta() {
  return (
    <section className="vv-section" aria-labelledby="vv-final-h">
      <div className="vv-final" id="signup-final">
        <h2 id="vv-final-h">Make your account. Keel starts checking what you tell it.</h2>
        <p>
          Free to start. An optional paid plan reads policy documents for you. Information only: not
          financial, tax or legal advice.
        </p>
        <a className="vv-btn vv-btn-light" href={appUrl('/signup')} onClick={signup('final')}>
          Create your free account
          <ArrowRight size={18} aria-hidden="true" />
        </a>
      </div>
    </section>
  )
}
