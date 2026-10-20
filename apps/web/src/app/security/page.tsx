/**
 * PRD-208 vulnerability disclosure page. The address comes from
 * NEXT_PUBLIC_SECURITY_CONTACT at build time, the same value that produces
 * /.well-known/security.txt, so the page and the file agree. With no contact
 * configured the page says nothing has been published rather than inventing one.
 */
import { PageHeader } from '@/components/Glass'
import { SECURITY_ASK, SECURITY_INTRO, SECURITY_NO_CONTACT, SECURITY_TITLE } from '@/lib/trust-copy'

export default function SecurityPage() {
  const contact = (process.env.NEXT_PUBLIC_SECURITY_CONTACT ?? '').trim()
  const href = /^(mailto:|https:\/\/)/.test(contact) ? contact : `mailto:${contact}`
  return (
    <div className="px-5 pt-2 pb-12">
      <PageHeader title={SECURITY_TITLE} />
      <p className="text-sm text-ink-secondary leading-relaxed mt-2">{SECURITY_INTRO}</p>
      <p className="text-sm text-ink-secondary leading-relaxed mt-3">{SECURITY_ASK}</p>
      <p className="text-sm text-ink-primary mt-4">
        {contact ? (
          <a href={href} className="text-family-400 font-medium">
            {contact.replace(/^mailto:/, '')}
          </a>
        ) : (
          SECURITY_NO_CONTACT
        )}
      </p>
    </div>
  )
}
