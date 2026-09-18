// Live-verification finding: real inbox items store their date as a raw
// ISO timestamp (apps/api/src/jobs/email-scan.ts: email.date.toISOString()),
// but the UI rendered that string completely unformatted — a live inbox
// item showed as e.g. "2026-09-10T14:32:00.000Z" instead of "2h ago". Sample/
// mock inbox items (shown before an email is connected) use pre-formatted
// strings like "2h ago" directly, which aren't valid dates — this only
// reformats input that actually parses as one, so sample data renders
// exactly as before.
export function formatRelativeDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  const diffMs = Date.now() - date.getTime()
  const diffDay = Math.round(diffMs / 86_400_000)

  // A future-dated item (clock skew, scheduled reminder) or anything
  // beyond a week reads better as a real date than as "3d ago" math run
  // backwards ("-3d ago") or forwards past the point it's still useful.
  if (diffMs < 0 || diffDay >= 7) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: diffDay > 365 ? 'numeric' : undefined })
  }

  const diffSec = Math.round(diffMs / 1000)
  if (diffSec < 45) return 'Just now'
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHour = Math.round(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h ago`
  return `${diffDay}d ago`
}
