import OperatorUserDossierClient from './OperatorUserDossierClient'

// Static export (Firebase Hosting): every /operator/users/<id> URL is
// rewritten to this one pre-rendered "placeholder" page (see
// apps/web/firebase.json). The client component reads the real id from
// useParams() against the browser URL.
export function generateStaticParams() {
  return [{ id: 'placeholder' }]
}

export default function Page() {
  return <OperatorUserDossierClient />
}
