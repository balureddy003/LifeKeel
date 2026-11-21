import type { Metadata } from 'next'
import { MarketingPage, PricingContent } from '@/components/landing/MarketingPage'

export const metadata: Metadata = {
  title: 'Pricing — LifeKeel',
  description: 'LifeKeel pricing: free to start, one optional paid plan. No commissions, no ads.',
  alternates: { canonical: 'https://lifekeel.co.uk/pricing/' },
  openGraph: {
    title: 'Pricing — LifeKeel',
    description: 'LifeKeel pricing: free to start, one optional paid plan. No commissions, no ads.',
    url: 'https://lifekeel.co.uk/pricing/',
    type: 'website',
  },
}

export default function PricingPage() {
  return (
    <MarketingPage page="pricing" eyebrow="Pricing" title="Pricing">
      <PricingContent />
    </MarketingPage>
  )
}
