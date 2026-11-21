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
    <MarketingPage
      page="features"
      eyebrow="Features"
      title="What LifeKeel does today"
      intro="Six questions families say out loud, and what LifeKeel helps with for each, from what your family adds."
    >
      <FeaturesContent />
    </MarketingPage>
  )
}
