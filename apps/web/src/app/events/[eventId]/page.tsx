import EventDetailClient from './EventDetailClient'

// Static export (Firebase Hosting): every /events/<id> URL (that isn't the
// /events list page itself) is rewritten to this one pre-rendered
// "placeholder" page (see apps/family/firebase.json). EventDetailClient
// resolves the real eventId from the browser URL via useRouteParam —
// useParams() would return this build-time 'placeholder'.
export function generateStaticParams() {
  return [{ eventId: 'placeholder' }]
}

export default function Page() {
  return <EventDetailClient />
}
