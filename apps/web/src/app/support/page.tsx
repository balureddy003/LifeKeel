import { AlertTriangle, Mail } from 'lucide-react'
import { PageHeader } from '@/components/Glass'

const SUPPORT_EMAIL = '[support@yourdomain.example]'

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold text-ink-primary mt-7 mb-2.5">{children}</h2>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-secondary leading-relaxed mb-3">{children}</p>
}

export default function SupportPage() {
  return (
    <div className="px-5 pt-2 pb-12">
      <PageHeader title="Support" backHref="/settings" />

      <div className="rounded-2xl bg-warning/10 border border-warning/20 px-4 py-3.5 flex items-start gap-2.5 mb-6">
        <AlertTriangle size={16} className="text-warning flex-shrink-0 mt-0.5" />
        <p className="text-xs text-ink-secondary leading-relaxed">
          <b className="text-warning">The inbox below isn&apos;t live yet.</b> This page exists so there&apos;s
          somewhere for a user, journalist, or app-store reviewer to be pointed to &mdash; replace the placeholder
          with a real, monitored address before this is relied on.
        </p>
      </div>

      <div className="rounded-2xl bg-family-500/10 border border-family-500/20 px-4 py-3.5 flex items-center gap-3 mb-6">
        <Mail size={18} className="text-family-400 flex-shrink-0" />
        <span className="text-sm font-medium text-ink-primary">{SUPPORT_EMAIL}</span>
      </div>

      <H2>Account or billing questions</H2>
      <P>
        For anything about your account, a Oak Plus subscription, or a charge you don&apos;t recognize, email
        the address above with the email you signed up with.
      </P>

      <H2>Reporting a security issue</H2>
      <P>
        If you&apos;ve found a security vulnerability, please email the address above rather than filing a public
        issue or posting about it &mdash; we&apos;ll acknowledge the report and follow up on next steps.
      </P>

      <H2>Data and privacy requests</H2>
      <P>
        To delete your account and associated data, or to exercise any other right described in the{' '}
        <a href="/privacy" className="text-family-400 font-medium">Privacy Policy</a>, email the address above from
        the email associated with your account.
      </P>

      <H2>In a real emergency</H2>
      <P>
        Agent Oak is not emergency services and can&apos;t dispatch help. If you&apos;re in immediate danger, call
        911 (or your local emergency number) first.
      </P>
    </div>
  )
}
