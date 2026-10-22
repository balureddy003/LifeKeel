import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader } from '@/components/Glass'
import { DraftNotice, H2, linkClass, P, UL } from '../prose'

export const metadata: Metadata = {
  title: 'GDPR & your data rights — LifeKeel',
  description:
    'Your rights under the UK GDPR and EU GDPR, how to use each one in LifeKeel, response times, and how to complain.',
  alternates: { canonical: 'https://lifekeel.co.uk/legal/gdpr/' },
}

// Same deployment-supplied identity as the privacy notice, so the two never disagree.
const LEGAL_ENTITY = process.env.NEXT_PUBLIC_LEGAL_ENTITY ?? ''
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_PRIVACY_CONTACT ?? ''
const WHO = LEGAL_ENTITY || 'the company operating LifeKeel (not yet named on this deployment)'

const RIGHTS: { name: string; what: string; how: string }[] = [
  {
    name: 'Be informed',
    what: 'Clear information about what we collect, why, and who receives it.',
    how: 'Our Privacy Notice and this page. We tell you before anything material changes.',
  },
  {
    name: 'Access',
    what: 'A copy of the personal data we hold about you, and how we use it.',
    how: 'Settings → Export Your Data gives an instant copy. For anything the export does not cover, contact us.',
  },
  {
    name: 'Rectification',
    what: 'Have inaccurate data corrected, or incomplete data completed.',
    how: 'Edit your profile, family and financial details directly in the app, or ask us to correct anything you cannot change yourself.',
  },
  {
    name: 'Erasure',
    what: 'Have your data deleted when there is no longer a reason to keep it.',
    how: 'An organizer deletes the household from Settings → Delete Account. Other members can ask the organizer to remove them, or contact us.',
  },
  {
    name: 'Restrict processing',
    what: 'Ask us to pause using your data, for example while an accuracy question is checked.',
    how: 'Contact us with what you would like paused and why.',
  },
  {
    name: 'Data portability',
    what: 'Receive data you gave us in a structured, machine-readable format to reuse elsewhere.',
    how: 'The Settings export is a JSON file, readable by other software, that you can keep or move.',
  },
  {
    name: 'Object',
    what: 'Object to processing based on legitimate interests, and to direct marketing at any time.',
    how: 'Use the unsubscribe link in any marketing email, change your cookie choice, or contact us.',
  },
  {
    name: 'Automated decisions',
    what: 'Not be subject to a decision made solely by automated means that has legal or similarly significant effects on you.',
    how: 'LifeKeel does not make such decisions. Its insights are information for your household to read, never a decision about you.',
  },
]

const BASES: { use: string; basis: string }[] = [
  {
    use: 'Running your account, profile, insights, documents and household sharing',
    basis: 'Contract',
  },
  { use: 'Taking payment and keeping tax records', basis: 'Contract; legal obligation' },
  { use: 'Keeping accounts secure and preventing abuse', basis: 'Legitimate interests' },
  {
    use: 'Details of family members the organizer adds for household planning',
    basis: 'Legitimate interests',
  },
  { use: 'Marketing emails, and optional analytics or advertising cookies', basis: 'Consent' },
]

export default function GdprPage() {
  return (
    <div className="px-5 pt-2 pb-12">
      <PageHeader title="GDPR & your data rights" />

      {!LEGAL_ENTITY && (
        <DraftNotice>
          <b className="text-warning">Draft.</b> This summarises rights that apply under
          data-protection law and how LifeKeel supports them today. The controller&apos;s name and
          contact address are not yet set on this deployment.
        </DraftNotice>
      )}

      <P>
        LifeKeel holds information about your household, so data-protection law applies to how we
        handle it. In the UK that is the UK General Data Protection Regulation (UK GDPR) and the
        Data Protection Act 2018, as amended by the Data (Use and Access) Act 2025. If you live in
        the European Economic Area, the EU GDPR gives you equivalent rights. {WHO} is the controller
        of your data. The full detail of what we collect is in our{' '}
        <Link href="/privacy" className={linkClass}>
          Privacy Notice
        </Link>
        .
      </P>

      <H2 id="principles">How we apply the principles</H2>
      <UL>
        <li>
          <b className="text-ink-primary">Lawful, fair and transparent:</b> every use has a lawful
          basis, listed below and in the Privacy Notice.
        </li>
        <li>
          <b className="text-ink-primary">Purpose limitation:</b> household data is used to run
          LifeKeel for that household. It is never sold, and never used to train AI models.
        </li>
        <li>
          <b className="text-ink-primary">Data minimisation:</b> AI features receive only the fields
          a task needs, and health terms are removed from free text before it is sent to a model.
        </li>
        <li>
          <b className="text-ink-primary">Accuracy:</b> you can see and edit what LifeKeel holds,
          and document fields read by a model are shown to you for review.
        </li>
        <li>
          <b className="text-ink-primary">Storage limitation:</b> data is kept while the account is
          open and erased when it is deleted, apart from the limited records described below.
        </li>
        <li>
          <b className="text-ink-primary">Integrity and confidentiality:</b> encryption in transit
          and at rest, households kept separate, and optional two-factor sign-in. See{' '}
          <Link href="/security" className={linkClass}>
            Security
          </Link>
          .
        </li>
        <li>
          <b className="text-ink-primary">Accountability:</b> the claims we make are listed with
          their evidence on our{' '}
          <Link href="/trust" className={linkClass}>
            Trust
          </Link>{' '}
          page.
        </li>
      </UL>

      <H2 id="rights">Your rights, and how to use them</H2>
      <div className="glass rounded-2xl divide-y divide-tint/[0.08] mb-3">
        {RIGHTS.map((r) => (
          <div key={r.name} className="p-4 sm:grid sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-5">
            <h3 className="text-sm font-semibold text-ink-primary">
              Right to {r.name.toLowerCase()}
            </h3>
            <div className="mt-1 sm:mt-0">
              <p className="text-sm text-ink-secondary leading-relaxed">{r.what}</p>
              <p className="text-sm text-ink-primary leading-relaxed mt-1.5">
                <span className="text-ink-tertiary">In LifeKeel: </span>
                {r.how}
              </p>
            </div>
          </div>
        ))}
      </div>
      <P>
        Where we rely on consent, you can withdraw it at any time, and withdrawing does not affect
        anything done before.
      </P>

      <H2 id="requests">Making a request</H2>
      <UL>
        <li>
          Contact {CONTACT_EMAIL || 'us through the support page'}, saying which right you want to
          use. You do not need to use particular words.
        </li>
        <li>
          We may ask you to confirm your identity first, so we never give your household&apos;s data
          to someone else.
        </li>
        <li>
          We respond within one month. For complex or multiple requests we can extend this by up to
          two further months; if so we tell you, with the reason, within the first month.
        </li>
        <li>
          Requests are free. Only if a request is manifestly unfounded or excessive may we charge a
          reasonable fee or decline it, and we would explain why.
        </li>
        <li>
          A request about a child&apos;s details is handled with the parent or guardian who added
          them.
        </li>
      </UL>

      <H2 id="bases">Lawful bases at a glance</H2>
      <div className="glass rounded-2xl divide-y divide-tint/[0.08] mb-3">
        {BASES.map((b) => (
          <div
            key={b.use}
            className="p-4 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
          >
            <p className="text-sm text-ink-secondary leading-relaxed">{b.use}</p>
            <p className="text-sm font-semibold text-ink-primary sm:shrink-0">{b.basis}</p>
          </div>
        ))}
      </div>

      <H2 id="transfers">International transfers</H2>
      <P>
        Some of the providers we use process data outside the UK. Where they do, we rely on UK
        adequacy regulations or the UK International Data Transfer Agreement or Addendum. The AI
        providers that may receive your content, and the status of their terms, are listed on our
        Trust page.
      </P>

      <H2 id="retention">What is kept after deletion</H2>
      <P>
        Deleting a household erases its data from live systems straight away and gives you a
        receipt. We keep a record that the deletion happened (counts, no content), and invoices for
        the period tax law requires. Encrypted backups roll off within the window stated on your
        receipt.
      </P>

      <H2 id="complaints">Complaints</H2>
      <P>
        If you are unhappy with how we have handled your data, please tell us first at{' '}
        {CONTACT_EMAIL || 'the support page'}. We acknowledge complaints within 30 days, look into
        them without undue delay, and tell you the outcome.
      </P>
      <P>
        You can also complain to the UK Information Commissioner&apos;s Office (ico.org.uk, 0303 123
        1113) or, if you live in the EEA, to the data-protection authority where you live or work.
      </P>

      <p className="text-xs text-ink-tertiary leading-relaxed mt-8">
        This page explains your rights in general terms. It is not legal advice about your own
        circumstances.
      </p>
    </div>
  )
}
