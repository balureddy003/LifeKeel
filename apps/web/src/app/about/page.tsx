import type { Metadata } from 'next'
import { MarketingPage, AboutContent } from '@/components/landing/MarketingPage'

export const metadata: Metadata = {
  title: 'About LifeKeel',
  description: 'Why LifeKeel exists, what it does not do, and what happens to your data.',
  alternates: { canonical: 'https://lifekeel.co.uk/about/' },
  openGraph: {
    title: 'About LifeKeel',
    description: 'Why LifeKeel exists, what it does not do, and what happens to your data.',
    url: 'https://lifekeel.co.uk/about/',
    type: 'website',
  },
}

export default function AboutPage() {
  return (
    <MarketingPage
      page="about"
      eyebrow="About"
      title="Why LifeKeel"
      intro="Most families run on one person’s memory. LifeKeel is a shared list every adult can open, with clear limits on what it does."
    >
      <AboutContent />
    </MarketingPage>
  )
}
