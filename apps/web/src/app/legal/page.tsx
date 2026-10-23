import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader } from '@/components/Glass'

export const metadata: Metadata = {
  title: 'Legal — LifeKeel',
  description:
    'Terms, privacy, cookies, data-protection rights and security information for LifeKeel.',
  alternates: { canonical: 'https://lifekeel.co.uk/legal/' },
}

const PAGES = [
  {
    href: '/terms',
    title: 'Terms of Service',
    text: 'The agreement for using LifeKeel: what it is and is not, accounts, billing, acceptable use and liability.',
  },
  {
    href: '/privacy',
    title: 'Privacy Notice',
    text: 'What we collect, why, the lawful basis for each use, who we share it with and how long we keep it.',
  },
  {
    href: '/cookies',
    title: 'Cookies & device storage',
    text: 'Every cookie and storage entry LifeKeel sets on your device, and how to change your choice.',
  },
  {
    href: '/legal/gdpr',
    title: 'GDPR & your data rights',
    text: 'Your rights under UK and EU data-protection law, how to use them in LifeKeel, and how to complain.',
  },
  {
    href: '/security',
    title: 'Security',
    text: 'How your family’s information is protected, and how to report a weakness to us.',
  },
  {
    href: '/trust',
    title: 'Trust',
    text: 'The statements we make about handling your data, each with the evidence behind it.',
  },
]

export default function LegalIndex() {
  return (
    <div className="px-5 pt-2 pb-12">
      <PageHeader title="Legal" />
      <p className="text-sm text-ink-secondary leading-relaxed mb-6 max-w-[62ch]">
        The documents that govern how LifeKeel works and how it handles your household&apos;s
        information. LifeKeel provides information, not regulated financial advice.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {PAGES.map((p) => (
          <Link key={p.href} href={p.href} className="block">
            <article className="glass h-full rounded-2xl p-5 transition-colors hover:border-family-500/40">
              <h2 className="text-lg font-semibold text-ink-primary">{p.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">{p.text}</p>
            </article>
          </Link>
        ))}
      </div>
    </div>
  )
}
