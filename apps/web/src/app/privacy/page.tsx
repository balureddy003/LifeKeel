import { AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { PageHeader } from '@/components/Glass'
import { CookieSettingsButton } from './CookieSettingsButton'

// Controller identity and contact come from the deployment, not from code
// (R11). Until all three are set the page says so instead of showing
// placeholder text as if it were real.
const EFFECTIVE_DATE = process.env.NEXT_PUBLIC_PRIVACY_EFFECTIVE_DATE ?? ''
const LEGAL_ENTITY = process.env.NEXT_PUBLIC_LEGAL_ENTITY ?? ''
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_PRIVACY_CONTACT ?? ''
const READY = Boolean(EFFECTIVE_DATE && LEGAL_ENTITY && CONTACT_EMAIL)
const WHO = LEGAL_ENTITY || 'the company operating LifeKeel (not yet named on this deployment)'
const CONTACT = CONTACT_EMAIL || 'the support page'

function H2({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-base font-semibold text-ink-primary mt-7 mb-2.5 scroll-mt-20">
      {children}
    </h2>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-secondary leading-relaxed mb-3">{children}</p>
}

function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul className="list-disc list-outside pl-5 text-sm text-ink-secondary leading-relaxed mb-3 space-y-1">
      {children}
    </ul>
  )
}

export default function PrivacyPage() {
  return (
    <div className="px-5 pt-2 pb-12">
      <PageHeader title="Privacy Notice" />

      {!READY && (
        <div className="rounded-2xl bg-warning/10 border border-warning/20 px-4 py-3.5 flex items-start gap-2.5 mb-6">
          <AlertTriangle size={16} className="text-warning flex-shrink-0 mt-0.5" />
          <p className="text-xs text-ink-secondary leading-relaxed">
            <b className="text-warning">Draft, not yet in force.</b> This describes what the app
            does today. The data controller, contact address and effective date are not set on this
            deployment, and the lawful bases below still need sign-off by a data-protection
            professional. Don&apos;t rely on this as a final notice.
          </p>
        </div>
      )}

      <p className="text-xs text-ink-tertiary mb-1">
        Effective date: {EFFECTIVE_DATE || 'not yet set'}
      </p>
      <p className="text-xs text-ink-tertiary mb-6">
        This notice explains what {WHO} (&quot;we&quot;, &quot;us&quot;), the controller of your
        data, collects when you use LifeKeel, why, who sees it, and the rights you have.
      </p>

      <H2>1. What we collect</H2>
      <P>
        <b className="text-ink-primary">Account information:</b> your name, email address and
        password (stored only as a salted hash). If you turn on two-factor sign-in, an encrypted
        authenticator secret and hashed recovery codes.
      </P>
      <P>
        <b className="text-ink-primary">Financial profile:</b> household income and outgoings,
        insurance, savings, pensions and goals you enter. Used to work out your household&apos;s
        readiness and the gaps worth looking at.
      </P>
      <P>
        <b className="text-ink-primary">Family members:</b> names, roles, dates of birth and email
        addresses of people you add. An organizer can invite an adult member to their own sign-in,
        which gives them read access to the household; members under 18 can never have a sign-in.
        If you add someone else&apos;s details, please let them know and point them to this notice.
      </P>
      <P>
        <b className="text-ink-primary">Documents you upload:</b> the file and, on paid plans, fields
        a model reads from it (provider, policy number, amounts, dates). Vault documents are
        encrypted before storage and can also be sealed in your browser.
      </P>
      <P>
        <b className="text-ink-primary">Email connection (optional):</b> with Gmail, you grant
        LifeKeel read-only access through Google; we can&apos;t send, change or delete your mail.
        With other providers you give an app password, stored encrypted, for read-only IMAP access.
        We read messages and finance-looking attachments to summarise them into your Inbox and do
        not keep the content of mail that isn&apos;t about your finances.
      </P>
      <P>
        <b className="text-ink-primary">Health information:</b> LifeKeel isn&apos;t designed for it.
        Please don&apos;t enter medical details. When free text you write is sent to a model, health
        terms are removed first.
      </P>
      <P>
        <b className="text-ink-primary">Technical and security data:</b> sign-in history (time, IP
        address, device) kept for 30 days, and error logs with tokens and personal details removed.
      </P>

      <H2>2. Why we use it, and our lawful basis</H2>
      <UL>
        <li>
          Running the service you signed up for: your profile, insights, documents, inbox and
          household sharing. <i>Basis: contract.</i>
        </li>
        <li>
          Taking payment and keeping tax records. <i>Basis: contract; legal obligation.</i>
        </li>
        <li>
          Keeping accounts secure and preventing abuse. <i>Basis: legitimate interests.</i>
        </li>
        <li>
          Information about family members who don&apos;t use LifeKeel themselves, provided by the
          organizer to plan for the household. <i>Basis: legitimate interests</i> (the
          organizer&apos;s and the household&apos;s), balanced against those members&apos;
          interests.
        </li>
        <li>
          Marketing emails, only if you ticked the box. <i>Basis: consent</i>, withdrawable from any
          email.
        </li>
        <li>
          Advertising and analytics cookies, only if you accept them. <i>Basis: consent.</i>
        </li>
      </UL>
      <P>
        LifeKeel gives information, not regulated financial advice, and never arranges insurance or
        moves money. We do not use your personal or family content to train AI models.
      </P>

      <H2>3. Who we share it with</H2>
      <P>We don&apos;t sell your data. We share the minimum needed with:</P>
      <UL>
        <li>
          <b className="text-ink-primary">Stripe</b>, for payments. Card details go to Stripe
          directly and never reach LifeKeel.
        </li>
        <li>
          <b className="text-ink-primary">AI processing.</b> Some features use a model to read
          documents, classify email or answer questions. LifeKeel-controlled models are preferred.
          A hosted AI provider is used only once its contract terms (no training on your content,
          retention, location) have been reviewed and recorded; until then the features that need
          one may be unavailable. The current list is published at /ai-processing.
        </li>
        <li>
          <b className="text-ink-primary">Email delivery</b> (for account and notification email)
          and <b className="text-ink-primary">hosting</b> providers, acting on our instructions.
        </li>
        <li>
          <b className="text-ink-primary">Google and Microsoft</b>, only when you connect Gmail,
          Google Drive or OneDrive, and only to read what you authorised.
        </li>
        <li>
          <b className="text-ink-primary">Law enforcement or courts</b>, only when the law requires.
        </li>
      </UL>
      <P>
        Some of these providers process data outside the UK. Where they do, we rely on UK adequacy
        regulations or the UK International Data Transfer Agreement or Addendum. Ask us for details.
      </P>
      <P>
        LifeKeel&apos;s use of information received from Google APIs adheres to the Google API
        Services User Data Policy, including the Limited Use requirements. Gmail data is used only
        to provide your Inbox, is never used for advertising, and is never used to train models
        shared with other households.
      </P>

      <H2>4. Security</H2>
      <P>
        Credentials, connector tokens and vault files are encrypted at rest, traffic is encrypted in
        transit, household data is separated by account, and sign-in is rate-limited, with optional
        two-factor authentication. No system is perfectly secure; if a breach puts you at high risk
        we will tell you without undue delay.
      </P>

      <H2>5. How long we keep it, and deletion</H2>
      <P>
        We keep household data while the account is open. An organizer can delete the household from
        Settings → Delete Account; other members can ask the organizer to remove them, which ends
        their access straight away. Deletion starts immediately: access closes at once and the
        removal usually completes within seconds. If anything is left it is retried automatically
        and the receipt you are shown says so.
      </P>
      <P>
        Kept after deletion: a record that the deletion happened (counts, no content) for 7 years,
        and invoices and payment records for the period tax law requires. Your subscription is
        cancelled when the household is deleted. Encrypted backups roll off within the window stated
        on your deletion receipt, and a restored backup is reconciled so deleted accounts stay
        deleted.
      </P>

      <H2>6. Your rights</H2>
      <P>
        You can ask for access to, correction of, a copy of, or deletion of your personal data, and
        object to or restrict some processing. Export is in Settings (an organizer exports the
        household; other members export their own account). For anything else contact {CONTACT}.
        We reply within one month.
      </P>
      <P>
        If you&apos;re unhappy with how we handle your data, you can complain to the Information
        Commissioner&apos;s Office (ico.org.uk, 0303 123 1113), or to your local data-protection
        authority if you live in the EU. We&apos;d appreciate the chance to put it right first.
      </P>

      <H2>7. Children</H2>
      <P>
        LifeKeel sign-ins are for adults (18+). Parents or guardians may add children to the
        household so plans can account for them. Children never get a sign-in, are never sent
        marketing, and their details are used only for the household&apos;s own planning.
      </P>

      <H2 id="cookies">8. Cookies and local storage</H2>
      <P>
        Essential: a sign-in cookie and your device&apos;s local storage keep you signed in and
        remember settings. These need no consent.
      </P>
      <P>
        Optional: on public pages only, and only if you accept, advertising and analytics tags from
        Google (Analytics and Ads), Meta and LinkedIn measure our marketing. They never run inside
        your account, and nothing is set if you reject them.
      </P>
      <CookieSettingsButton />
      <P>See our <Link href="/cookies" className="underline">cookies and device storage page</Link> for the storage we use and how to manage your choices.</P>

      <H2>9. Changes to this notice</H2>
      <P>We update the effective date when this notice changes materially.</P>

      <H2>10. Contact</H2>
      <P>Questions about this notice or your data: {CONTACT}.</P>
    </div>
  )
}
