import Link from 'next/link'
import { ArrowUpRight, Cookie, FileText, Fingerprint, ShieldCheck, LockKeyhole } from 'lucide-react'

const DOCUMENTS = [
  {
    href: '/terms',
    title: 'Terms of service',
    description: 'The agreement for using LifeKeel, your account and our service.',
    Icon: FileText,
  },
  {
    href: '/privacy',
    title: 'Privacy notice',
    description: 'What information we use, why we use it and the choices you have.',
    Icon: Fingerprint,
  },
  {
    href: '/cookies',
    title: 'Cookies & storage',
    description: 'What is stored on your device and how to manage optional cookies.',
    Icon: Cookie,
  },
  {
    href: '/security',
    title: 'Security',
    description: 'How to report a vulnerability and help keep LifeKeel safe.',
    Icon: LockKeyhole,
  },
  {
    href: '/trust',
    title: 'Trust centre',
    description: 'Published safeguards, processing information and backup details.',
    Icon: ShieldCheck,
  },
]

export default function LegalPage() {
  return (
    <div className="lk-legal-index">
      <p className="lk-eyebrow">LEGAL & TRUST</p>
      <h1>
        Clear terms.
        <br />
        No small print surprises.
      </h1>
      <p className="lk-intro">
        Your family&apos;s information deserves clear explanations. Find our policies, your choices
        and the details behind how LifeKeel works.
      </p>
      <div className="lk-legal-index-grid">
        {DOCUMENTS.map(({ href, title, description, Icon }) => (
          <Link key={href} href={href} className="lk-legal-card">
            <Icon size={26} aria-hidden="true" />
            <h2>{title}</h2>
            <p>{description}</p>
            <span>
              Read more <ArrowUpRight size={17} aria-hidden="true" />
            </span>
          </Link>
        ))}
      </div>
      <p className="lk-fine">
        Have a question? <Link href="/support">Talk to us through Support.</Link> Each policy states
        its own status and effective date where applicable.
      </p>
    </div>
  )
}
