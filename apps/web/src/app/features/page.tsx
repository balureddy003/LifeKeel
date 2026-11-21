import type { Metadata } from 'next'
import { MarketingPage, FeaturesContent } from '@/components/landing/MarketingPage'

export const metadata: Metadata = {
  title: 'Features — LifeKeel',
  description:
    'What LifeKeel helps with today: what is on file, dates coming up, and where to start when something happens.',
  alternates: { canonical: 'https://lifekeel.co.uk/features/' },
  openGraph: {
    title: 'Features — LifeKeel',
    description:
      'What LifeKeel helps with today: what is on file, dates coming up, and where to start when something happens.',
    url: 'https://lifekeel.co.uk/features/',
    type: 'website',
  },
}

export default function FeaturesPage() {
  return (
    <MarketingPage page="features" eyebrow="Features" title="What LifeKeel does today">
      <FeaturesContent />
    </MarketingPage>
  )
}
