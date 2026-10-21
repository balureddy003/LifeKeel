import InviteJoinClient from './InviteJoinClient'

// Static export (Firebase Hosting): every /invite/** URL is rewritten to
// this one pre-rendered "placeholder" page — InviteJoinClient resolves the
// real code from the browser URL via useRouteParam (useParams() would
// return this build-time 'placeholder'). Same pattern as /asset/[id].
export function generateStaticParams() {
  return [{ code: 'placeholder' }]
}

export default function Page() {
  return <InviteJoinClient />
}
