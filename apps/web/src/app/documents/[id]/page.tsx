import DocumentDetailClient from './DocumentDetailClient'

// Static export (Firebase Hosting): every /documents/** URL is rewritten to
// this one pre-rendered "placeholder" page (see apps/family/firebase.json).
// DocumentDetailClient reads the real id from useParams() on the client,
// against the actual browser URL, not this build-time placeholder.
export function generateStaticParams() {
  return [{ id: 'placeholder' }]
}

export default function Page() {
  return <DocumentDetailClient />
}
