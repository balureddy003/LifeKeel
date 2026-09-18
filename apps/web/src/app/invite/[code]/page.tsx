import InviteJoinClient from './InviteJoinClient'

// Static export (Firebase Hosting): every /invite/** URL is rewritten to
// this one pre-rendered "placeholder" page — InviteJoinClient reads the
// real code from useParams() on the client, against the actual browser
// URL, not this build-time placeholder. Same pattern as /asset/[id].
export function generateStaticParams() {
  return [{ code: 'placeholder' }]
}

export default function Page() {
  return <InviteJoinClient />
}
