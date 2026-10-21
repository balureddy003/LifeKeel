import MemberProfileClient from './MemberProfileClient'

// Static export (Firebase Hosting): every /member/** URL is rewritten to this
// one pre-rendered "placeholder" page (see apps/family/firebase.json).
// MemberProfileClient resolves the real id from the browser URL via
// useRouteParam — useParams() would return this build-time 'placeholder'.
export function generateStaticParams() {
  return [{ id: 'placeholder' }]
}

export default function Page() {
  return <MemberProfileClient />
}
