import EventDetailClient from './EventDetailClient'

// Static export (Firebase Hosting): every /events/<id> URL (that isn't the
// /events list page itself) is rewritten to this one pre-rendered
// "placeholder" page (see apps/family/firebase.json). EventDetailClient
// reads the real eventId from useParams() on the client, against the
// actual browser URL, not this build-time placeholder.
export function generateStaticParams() {
  return [{ eventId: 'placeholder' }]
}

export default function Page() {
  return <EventDetailClient />
}
