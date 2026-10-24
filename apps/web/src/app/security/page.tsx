/**
 * PRD-208 vulnerability disclosure page, plus how the service protects data.
 * The address comes from NEXT_PUBLIC_SECURITY_CONTACT at build time, the same
 * value that produces /.well-known/security.txt, so the page and the file agree.
 * With no contact configured the page says nothing has been published rather
 * than inventing one. The protections listed are the ones the Privacy Notice
 * already states; keep the two in step.
 */
import Link from 'next/link'
import { PageHeader } from '@/components/Glass'
import { SECURITY_ASK, SECURITY_INTRO, SECURITY_NO_CONTACT, SECURITY_TITLE } from '@/lib/trust-copy'
import { H2, linkClass, P, UL } from '../legal/prose'

const PROTECTIONS: { title: string; text: string }[] = [
  { title: 'Encrypted in transit', text: 'Every connection to LifeKeel uses HTTPS (TLS).' },
  {
    title: 'Encrypted at rest',
    text: 'Passwords are stored only as salted hashes. Email credentials, connector tokens and vault documents are encrypted before storage, and vault documents can also be sealed in your browser.',
  },
  {
    title: 'Households kept apart',
    text: 'Each household’s data is separated by account, so one family cannot see another’s.',
  },
  {
    title: 'Read-only connections',
    text: 'Connected mail is read-only: LifeKeel cannot send, change or delete your email.',
  },
  {
    title: 'Sign-in protection',
    text: 'Sign-in attempts are rate-limited, two-factor authentication is available, and sign-in history is kept for 30 days to help investigate unusual activity.',
  },
  {
    title: 'Careful with logs',
    text: 'Error logs have tokens and personal details removed before they are stored.',
  },
]

export default function SecurityPage() {
  const contact = (process.env.NEXT_PUBLIC_SECURITY_CONTACT ?? '').trim()
  const href = /^(mailto:|https:\/\/)/.test(contact) ? contact : `mailto:${contact}`
  return (
    <div className="px-5 pt-2 pb-12">
      <PageHeader title="Security" />
      <P>
        LifeKeel holds information about your family&apos;s finances and documents, so it is built
        to keep that information private by default. This page covers how it is protected, what you
        can do to keep your account safe, and how to report a problem.
      </P>

      <H2 id="protections">How your data is protected</H2>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        {PROTECTIONS.map((p) => (
          <div key={p.title} className="glass rounded-2xl p-4">
            <h3 className="text-sm font-semibold text-ink-primary">{p.title}</h3>
            <p className="text-sm text-ink-secondary leading-relaxed mt-1">{p.text}</p>
          </div>
        ))}
      </div>
      <P>
        No system is perfectly secure. If a breach puts you at high risk, we will tell you without
        undue delay. The AI providers that may process your documents are listed on our{' '}
        <Link href="/trust" className={linkClass}>
          Trust
        </Link>{' '}
        page.
      </P>

      <H2 id="your-account">Keeping your account safe</H2>
      <UL>
        <li>Turn on two-factor authentication in Settings.</li>
        <li>Use a password you do not use anywhere else; a password manager makes this easy.</li>
        <li>
          Never share your password, two-factor codes or recovery codes with anyone, including
          someone who says they are from LifeKeel.
        </li>
        <li>
          Sign out on shared devices, and contact us if you see activity you do not recognise.
        </li>
      </UL>

      <H2 id="report">{SECURITY_TITLE}</H2>
      <P>{SECURITY_INTRO}</P>
      <P>{SECURITY_ASK}</P>
      <div className="glass rounded-2xl p-4 mb-3">
        <p className="text-xs text-ink-tertiary uppercase tracking-wide font-semibold">Report to</p>
        <p className="text-sm text-ink-primary mt-1 break-words">
          {contact ? (
            <a href={href} className={linkClass}>
              {contact.replace(/^mailto:/, '')}
            </a>
          ) : (
            SECURITY_NO_CONTACT
          )}
        </p>
      </div>

      <H2 id="scope">Testing in scope</H2>
      <UL>
        <li>In scope: the LifeKeel web app, its API, and the public website.</li>
        <li>
          Use only accounts you created yourself, and stop as soon as you reach anyone else&apos;s
          data.
        </li>
        <li>
          Out of scope: denial-of-service or load testing, social engineering or phishing of staff
          or users, physical attacks, and automated scanning that degrades the service.
        </li>
        <li>
          Out of scope: reports about third-party services we do not control, unless LifeKeel&apos;s
          use of them causes the issue.
        </li>
      </UL>

      <H2 id="disclosure">Disclosure</H2>
      <P>
        Please give us reasonable time to investigate and fix an issue before sharing it publicly,
        and keep any data you came across confidential.
      </P>
      {contact && (
        <p className="text-xs text-ink-tertiary leading-relaxed mt-4">
          The same contact is published in machine-readable form at /.well-known/security.txt.
        </p>
      )}
    </div>
  )
}
