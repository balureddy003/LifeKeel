import InsightGateClient from './InsightGateClient'

// Static export (Firebase Hosting): every /insights/<id> URL is rewritten to
// this one pre-rendered "placeholder" page (see apps/web/firebase.json).
// InsightGateClient reads the real id from useParams() on the client,
// against the actual browser URL, not this build-time placeholder.
export function generateStaticParams() {
  return [{ id: 'placeholder' }]
}

export default function Page() {
  return <InsightGateClient />
}
