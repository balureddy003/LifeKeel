import LifeEventPlaybookClient from './LifeEventPlaybookClient'

// Static export (Firebase Hosting): every /life-events/<id> URL is
// rewritten to this one pre-rendered "placeholder" page, same pattern as
// /events/[eventId]/page.tsx. LifeEventPlaybookClient resolves the real
// eventId from the browser URL via useRouteParam — useParams() would
// return this build-time 'placeholder'.
export function generateStaticParams() {
  return [{ eventId: 'placeholder' }]
}

export default function Page() {
  return <LifeEventPlaybookClient />
}
