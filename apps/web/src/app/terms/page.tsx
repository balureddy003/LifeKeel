import { AlertTriangle } from 'lucide-react'
import { PageHeader } from '@/components/Glass'

const EFFECTIVE_DATE = '[EFFECTIVE DATE — NOT YET SET]'
const LEGAL_ENTITY = '[LEGAL ENTITY NAME, e.g. "Agent Oak, Inc."]'
const CONTACT_EMAIL = '[legal@yourdomain.example]'
const GOVERNING_LAW = '[GOVERNING LAW / JURISDICTION — TBD WITH COUNSEL]'

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold text-ink-primary mt-7 mb-2.5">{children}</h2>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-secondary leading-relaxed mb-3">{children}</p>
}

export default function TermsPage() {
  return (
    <div className="px-5 pt-2 pb-12">
      <PageHeader title="Terms of Service" backHref="/settings" />

      <div className="rounded-2xl bg-warning/10 border border-warning/20 px-4 py-3.5 flex items-start gap-2.5 mb-6">
        <AlertTriangle size={16} className="text-warning flex-shrink-0 mt-0.5" />
        <p className="text-xs text-ink-secondary leading-relaxed">
          <b className="text-warning">Draft — not yet reviewed by an attorney.</b> This page was drafted to close a
          real gap (the sign-up screen referenced these terms before they existed) and reflects what the app
          actually does today. It is a starting point, not a substitute for review by a qualified lawyer before
          this is relied on as a binding agreement with real users.
        </p>
      </div>

      <p className="text-xs text-ink-tertiary mb-1">Effective date: {EFFECTIVE_DATE}</p>
      <p className="text-xs text-ink-tertiary mb-6">
        These Terms of Service ("Terms") govern your use of the Agent Oak application and related services
        (the "Service"), operated by {LEGAL_ENTITY} ("we," "us," "our").
      </p>

      <H2>1. Acceptance of these Terms</H2>
      <P>
        By creating an account or otherwise using the Service, you agree to be bound by these Terms and by our{' '}
        <a href="/privacy" className="text-family-400 font-medium">Privacy Policy</a>. If you do not agree, do not
        use the Service.
      </P>

      <H2>2. What Agent Oak is — and isn't</H2>
      <P>
        Agent Oak helps you see your household's finances in one place: income, savings, insurance, retirement
        progress, and education funding, based on information you provide and documents or accounts you choose to
        connect. Agent Oak surfaces informational estimates, plain-language summaries, and suggestions generated in
        part by automated systems, including AI models.
      </P>
      <P>
        <b className="text-ink-primary">Agent Oak is not a financial advisor, broker, insurance agent, tax
        preparer, or attorney, and nothing in the Service is financial, investment, tax, legal, or insurance
        advice.</b> Estimates and insights are based on the data you provide, may be incomplete or inaccurate, and
        should not be relied on as the sole basis for a financial decision. Always consult a qualified, licensed
        professional before making decisions about insurance, investments, retirement, taxes, or debt.
      </P>

      <H2>3. Eligibility and accounts</H2>
      <P>
        You must be at least 18 years old and able to form a binding contract to create an account. You're
        responsible for the accuracy of the information you provide, for keeping your password confidential, and
        for all activity under your account.
      </P>
      <P>
        Agent Oak lets an account holder add other household members to a shared family view (a "roster"). Adding
        someone as a family member does not give them their own login or independent account — today, one login
        per household controls the data. Don't add anyone to your roster without their knowledge and consent to
        being represented in your household's data.
      </P>

      <H2>4. Connecting accounts and documents</H2>
      <P>
        You may choose to upload financial documents (which may be processed by an AI service to extract fields
        like provider, amount, or renewal date) or connect an email account (via IMAP, using credentials you
        provide) so Agent Oak can scan for financial correspondence. You control what you connect and can disconnect
        at any time in Settings. You're responsible for having the right to share any account or document you
        connect, including anyone else's information it may contain.
      </P>

      <H2>5. Subscriptions and billing</H2>
      <P>
        Agent Oak offers a free tier and paid tiers with additional features (such as automated document field
        extraction and AI email summaries). Paid subscriptions are billed through our payment processor (Stripe)
        on the cycle shown at checkout. You can cancel at any time; cancellation takes effect at the end of the
        current billing period unless stated otherwise. Fees are non-refundable except where required by law.
      </P>

      <H2>6. Acceptable use</H2>
      <P>You agree not to:</P>
      <ul className="list-disc list-outside pl-5 text-sm text-ink-secondary leading-relaxed mb-3 space-y-1">
        <li>Use the Service for any unlawful purpose, or to submit data you don't have the right to share</li>
        <li>Attempt to gain unauthorized access to another user's account or data</li>
        <li>Reverse engineer, scrape, or interfere with the Service's normal operation</li>
        <li>Use the Service to make automated financial or credit decisions about a third party</li>
      </ul>

      <H2>7. Disclaimers</H2>
      <P>
        The Service is provided "as is" and "as available," without warranties of any kind, express or implied,
        including accuracy, reliability, or fitness for a particular purpose. We do not guarantee that insights,
        projections, or AI-generated summaries are correct or complete.
      </P>

      <H2>8. Limitation of liability</H2>
      <P>
        To the maximum extent permitted by law, {LEGAL_ENTITY} will not be liable for any indirect, incidental,
        special, or consequential damages, or for any financial loss arising from decisions made in reliance on
        information provided by the Service.
      </P>

      <H2>9. Termination</H2>
      <P>
        You may stop using the Service and request deletion of your account at any time (see the{' '}
        <a href="/privacy" className="text-family-400 font-medium">Privacy Policy</a> for how). We may suspend or
        terminate accounts that violate these Terms.
      </P>

      <H2>10. Changes to these Terms</H2>
      <P>
        We may update these Terms from time to time. Material changes will be reflected by an updated effective
        date on this page.
      </P>

      <H2>11. Governing law</H2>
      <P>These Terms are governed by {GOVERNING_LAW}.</P>

      <H2>12. Contact</H2>
      <P>Questions about these Terms: {CONTACT_EMAIL}.</P>
    </div>
  )
}
