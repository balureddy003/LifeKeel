import type { Metadata } from 'next'
import { MarketingPage, FaqContent } from '@/components/landing/MarketingPage'

export const metadata: Metadata = {
  title: 'FAQ — LifeKeel',
  description:
    'Common questions about LifeKeel: what it does, what it costs and how your data is handled.',
  alternates: { canonical: 'https://lifekeel.co.uk/faq/' },
  openGraph: {
    title: 'FAQ — LifeKeel',
    description:
      'Common questions about LifeKeel: what it does, what it costs and how your data is handled.',
    url: 'https://lifekeel.co.uk/faq/',
    type: 'website',
  },
}

export default function FaqPage() {
  return (
    <MarketingPage
      page="faq"
      eyebrow="FAQ"
      title="Questions"
      intro="Straight answers about what LifeKeel does, what it costs and what happens to your data."
    >
      <FaqContent />
    </MarketingPage>
  )
}
