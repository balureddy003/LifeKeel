/**
 * The FAQ, once. The visible list and the FAQPage JSON-LD in app/layout.tsx both read
 * this array, so search-engine answers can never say more than the page does.
 */
export interface FaqItem {
  claim: string
  q: string
  a: string
}

export const FAQ: FaqItem[] = [
  {
    claim: 'no-policy-picks',
    q: 'Is LifeKeel financial advice?',
    a: 'No. LifeKeel is informational and educational only — not financial, investment, tax, or legal advice, and not a substitute for a licensed professional or for calling emergency services (999, 112, 911) in a real emergency.',
  },
  {
    claim: 'no-money-moved',
    q: 'Will Keel move money or act on my behalf?',
    a: 'No. Keel shows you what is on file and estimates possible gaps. It never moves money or buys products. Anything it sends for you, such as emails to people you name if you go quiet, stays off until you switch it on. It has no commercial relationship with any insurer or provider.',
  },
  {
    claim: 'plus-price',
    q: 'How much does LifeKeel cost?',
    a: 'LifeKeel is free to start, no credit card required. Keel Plus is £7.99/month and adds AI document reading (provider, policy number, amount, and dates pulled out for you to confirm) and a plain-language summary of financial email, on top of everything in the free plan.',
  },
  {
    claim: 'no-selling',
    q: 'Is my financial data sold?',
    a: "No. Your financial data isn't sold. Approved AI providers process it only for the request, and the privacy notice lists who they are. Connector passwords and access tokens are encrypted before they're ever stored.",
  },
  {
    claim: 'plus-price',
    q: 'Can I cancel Keel Plus anytime?',
    a: 'Yes. No credit card is required to start free, and you can cancel Keel Plus anytime from your account.',
  },
  {
    claim: 'family-roster',
    q: 'Does LifeKeel work for the whole family?',
    a: 'Yes. Add your partner and kids to your family’s roster and every score, insight, and "what if" scenario accounts for the whole household, not just the person who signed up.',
  },
  {
    claim: 'delete-account',
    q: 'What happens to my data if I delete my account?',
    a: 'You can request account deletion from Settings. See the privacy notice for how deletion is handled and which records must be retained.',
  },
]
