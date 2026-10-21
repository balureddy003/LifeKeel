import InsightGateClient from './InsightGateClient'

// Static export (Firebase Hosting): every /insights/<id> URL is rewritten to
// this one pre-rendered "placeholder" page (see apps/web/firebase.json).
// InsightGateClient resolves the real id from the browser URL via
// useRouteParam — useParams() would return this build-time 'placeholder'.
export function generateStaticParams() {
  return [{ id: 'placeholder' }]
}

export default function Page() {
  return <InsightGateClient />
}
