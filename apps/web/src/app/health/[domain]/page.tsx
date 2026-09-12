import HealthDomainClient from './HealthDomainClient'

// Static export (Firebase Hosting): every /health/** URL is rewritten to this
// one pre-rendered "placeholder" page (see apps/family/firebase.json).
// HealthDomainClient reads the real domain from useParams() on the client,
// against the actual browser URL, not this build-time placeholder.
export function generateStaticParams() {
  return [{ domain: 'placeholder' }]
}

export default function Page() {
  return <HealthDomainClient />
}
