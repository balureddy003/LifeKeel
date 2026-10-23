import type { DocsGroup } from '@/components/landing/DocsLayout'

export const LEGAL_NAV: DocsGroup[] = [
  {
    links: [{ href: '/legal', label: 'Overview' }],
  },
  {
    heading: 'Agreements and notices',
    links: [
      { href: '/terms', label: 'Terms of Service' },
      { href: '/privacy', label: 'Privacy Notice' },
      { href: '/cookies', label: 'Cookies & device storage' },
      { href: '/legal/gdpr', label: 'GDPR & your data rights' },
    ],
  },
  {
    heading: 'Security and trust',
    links: [
      { href: '/security', label: 'Security' },
      { href: '/trust', label: 'Trust' },
    ],
  },
]
