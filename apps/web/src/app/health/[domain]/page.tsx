import HealthDomainClient from './HealthDomainClient'

// Static export (Firebase Hosting): every /health/** URL is rewritten to this
// one pre-rendered "placeholder" page (see apps/family/firebase.json).
// HealthDomainClient resolves the real domain from the browser URL via
// useRouteParam — useParams() would return this build-time 'placeholder'.
export function generateStaticParams() {
  return [{ domain: 'placeholder' }]
}

export default function Page() {
  return <HealthDomainClient />
}
