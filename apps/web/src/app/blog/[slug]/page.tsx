import BlogPostClient from './BlogPostClient'

// Static export (Firebase Hosting): every /blog/<slug> URL is rewritten to
// this one pre-rendered "placeholder" page (see apps/web/firebase.json).
// BlogPostClient reads the real slug from useParams() on the client,
// against the actual browser URL, not this build-time placeholder.
export function generateStaticParams() {
  return [{ slug: 'placeholder' }]
}

export default function Page() {
  return <BlogPostClient />
}
