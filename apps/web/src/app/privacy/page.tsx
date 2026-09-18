import { AlertTriangle } from 'lucide-react'
import { PageHeader } from '@/components/Glass'

const EFFECTIVE_DATE = '[EFFECTIVE DATE — NOT YET SET]'
const LEGAL_ENTITY = '[LEGAL ENTITY NAME, e.g. "Agent Oak, Inc."]'
const CONTACT_EMAIL = '[privacy@yourdomain.example]'

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold text-ink-primary mt-7 mb-2.5">{children}</h2>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-secondary leading-relaxed mb-3">{children}</p>
}

export default function PrivacyPage() {
  return (
    <div className="px-5 pt-2 pb-12">
      <PageHeader title="Privacy Policy" backHref="/settings" />

      <div className="rounded-2xl bg-warning/10 border border-warning/20 px-4 py-3.5 flex items-start gap-2.5 mb-6">
        <AlertTriangle size={16} className="text-warning flex-shrink-0 mt-0.5" />
        <p className="text-xs text-ink-secondary leading-relaxed">
          <b className="text-warning">Draft — not yet reviewed by an attorney.</b> This reflects what the app
          actually collects, stores, and does today (verified against the codebase, not assumed) — it still needs
          a privacy/data-protection lawyer's review for your specific jurisdictions (GDPR, CCPA, and others) before
          it's relied on as your real policy.
        </p>
      </div>

      <p className="text-xs text-ink-tertiary mb-1">Effective date: {EFFECTIVE_DATE}</p>
      <p className="text-xs text-ink-tertiary mb-6">
        This Privacy Policy explains what {LEGAL_ENTITY} ("we," "us") collects when you use Agent Oak, why, and the
        choices you have.
      </p>

      <H2>1. What we collect</H2>
      <P><b className="text-ink-primary">Account information:</b> your name, email address, and password (stored
        as a salted hash, never in plain text).</P>
      <P><b className="text-ink-primary">Financial profile data you enter directly:</b> household income and
        expenses, insurance coverage, emergency savings, retirement details, and education fund goals — used to
        calculate your family's health scores and generate insights. This data is never sold and is scoped so only
        your account can read it.</P>
      <P><b className="text-ink-primary">Family roster:</b> names, email addresses, and roles of household members
        you add — used only to display your household; roster members do not receive their own login from this.</P>
      <P><b className="text-ink-primary">Documents you upload:</b> the file itself (stored encrypted) and, on paid
        plans, fields an AI model extracts from it (provider, policy number, amounts, dates).</P>
      <P><b className="text-ink-primary">Email connection (optional):</b> if you connect an email account, we
        store your email address and an encrypted password to access it via IMAP, and we read message
        headers/content and financial-looking attachments to summarize them into your Inbox. We do not store the
        full content of non-financial emails.</P>
      <P><b className="text-ink-primary">Usage data:</b> basic technical logs (timestamps, error rates) to keep
        the Service running and secure.</P>

      <H2>2. How we use it</H2>
      <ul className="list-disc list-outside pl-5 text-sm text-ink-secondary leading-relaxed mb-3 space-y-1">
        <li>To calculate your household's health scores and generate insights</li>
        <li>To extract structured fields from documents and connected email you choose to provide</li>
        <li>To operate your subscription and process payments</li>
        <li>To secure your account and prevent abuse</li>
        <li>To improve the Service — we do not use your individual financial data to train AI models</li>
      </ul>

      <H2>3. Who we share it with</H2>
      <P>We don't sell your data. We share the minimum necessary with:</P>
      <ul className="list-disc list-outside pl-5 text-sm text-ink-secondary leading-relaxed mb-3 space-y-1">
        <li><b className="text-ink-primary">Payment processing</b> — Stripe, for billing and subscription management</li>
        <li><b className="text-ink-primary">AI processing</b> — an AI provider (OpenAI or Azure OpenAI, depending on configuration) to extract document fields, classify email, and power the assistant. Content is sent only for the specific request being processed.</li>
        <li><b className="text-ink-primary">Your own email provider</b> — only when you choose to connect an account, and only to read your inbox on your behalf via IMAP</li>
        <li><b className="text-ink-primary">Law enforcement or legal process</b> — only when required by law</li>
      </ul>

      <H2>4. Security</H2>
      <P>
        Connector passwords and access tokens are encrypted at rest. All data is scoped to your account and never
        accessible cross-account. Traffic to the Service is encrypted in transit. Sign-in is protected by rate
        limiting to slow down credential-guessing attempts. No system is perfectly secure, and we can't guarantee
        absolute security.
      </P>

      <H2>5. Data retention and deletion</H2>
      <P>
        We keep your data for as long as your account is active. You can delete your account and its
        associated data yourself from Settings → Delete Account — deletion is immediate and removes your
        family's profile, documents, insights, and sign-in. One exception: the security activity log is
        retained on its documented schedule as the record of what happened on the account, and billing
        records are kept as required for financial reporting. You can also email {CONTACT_EMAIL} to ask
        us to do it for you.
      </P>

      <H2>6. Your rights</H2>
      <P>
        Depending on where you live, you may have the right to access, correct, export, or delete your
        personal data, and to object to certain processing. Export and deletion are self-service in
        Settings; contact {CONTACT_EMAIL} for anything else.
      </P>

      <H2>7. Children's privacy</H2>
      <P>
        Agent Oak accounts are for adults (18+). A parent or guardian may list children as family members for
        household visibility, but children do not create their own accounts or provide data directly to Agent Oak.
      </P>

      <H2>8. Local storage</H2>
      <P>
        Agent Oak uses your browser or device's local storage (not third-party tracking cookies) to keep you signed
        in between visits.
      </P>

      <H2>9. Changes to this policy</H2>
      <P>We'll update the effective date above when this policy changes materially.</P>

      <H2>10. Contact</H2>
      <P>Questions about this policy or your data: {CONTACT_EMAIL}.</P>
    </div>
  )
}
