import type { Metadata } from 'next'
import { MarketingPage, HowItWorksContent } from '@/components/landing/MarketingPage'

export const metadata: Metadata = {
  title: 'How it works — LifeKeel',
  description: 'How LifeKeel works: one problem, a few figures, one answer both adults can read.',
  alternates: { canonical: 'https://lifekeel.co.uk/how-it-works/' },
  openGraph: {
    title: 'How it works — LifeKeel',
    description: 'How LifeKeel works: one problem, a few figures, one answer both adults can read.',
    url: 'https://lifekeel.co.uk/how-it-works/',
    type: 'website',
  },
}

export default function HowItWorksPage() {
  return (
    <MarketingPage page="how-it-works" eyebrow="How it works" title="How it works">
      <HowItWorksContent />
    </MarketingPage>
  )
}
