'use client'

/**
 * Marketing-only sample-list prop.
 *
 * Visual and behavioural non-negotiables (brand spec, Appendix A7):
 *   - Same row shape as in-app SeenByCard.tsx, so the marketing prop
 *     and the in-app card never drift out of sync.
 *   - Non-interactive on the marketing site: no hover, no per-row click,
 *     no relative time on a person's tick (relative time belongs to
 *     the list, not the person).
 *   - "Asked to confirm" phrasing — never "has seen it."
 *   - Real names; the marketing caption is visible on every instance.
 *   - Reduced motion and motion-off: lands at the final state, no anim.
 *
 * Why a fork and not SeenByCard.tsx directly: SeenByCard is interactive
 * and reads live data from /api/domains. The marketing hero has neither
 * a tenant nor a route, so it cannot fetch. Splitting the data shape
 * here keeps both responsibilities legible.
 */

export interface MarketingSeenByListRow {
  /** e.g. "Car insurance — renewal 14 March". */
  text: string
  /** Names of adults who have marked this row as seen. */
  seenBy: string[]
  /** Names of adults who have not. Optional — defaults to []. */
  pendingBy?: string[]
}

export interface MarketingSeenByLastSeen {
  name: string
  /** Days since the adult last looked at any row on the list. */
  days: number
}

export interface MarketingSeenByListProps {
  /** Family or team name shown at the top of the prop. */
  familyName: string
  /** Row shape — one entry per item on the list. */
  rows: MarketingSeenByListRow[]
  /** Optional relative-time footer. Sentence-case, plain. */
  lastSeen?: MarketingSeenByLastSeen[]
  /**
   * Optional one-line change note under the rows, e.g. "Changed 9 days ago —
   * everyone was asked to look again." The second shot of the sheet
   * (TheList.tsx) uses it to show the mechanic in motion; the hero's
   * opening still leaves it off.
   */
  changedNote?: string
  /** Final line under the prop. Always visible. */
  caption?: string
  /** Aria label for the prop, since the surrounding mock is silent. */
  ariaLabel?: string
}

export function MarketingSeenByList({
  familyName,
  rows,
  lastSeen,
  changedNote,
  caption = 'An example list of one family. Yours begins empty and stays yours.',
  ariaLabel = 'Sample family list, as shown in the app',
}: MarketingSeenByListProps) {
  return (
    <div className="lk-msl" role="img" aria-label={ariaLabel} data-testid="marketing-seen-by-list">
      <div className="lk-msl-head">
        <p className="lk-msl-family">{familyName}</p>
        <span className="lk-msl-tag">Sample</span>
      </div>
      <ul className="lk-msl-rows">
        {rows.map((row, i) => (
          <li key={`${i}-${row.text}`} className="lk-msl-row">
            <span className="lk-msl-label">{row.text}</span>
            <span className="lk-msl-ticks" aria-hidden="true">
              {row.seenBy.map((name) => (
                <span key={name} className="lk-msl-tick" data-name={name}>
                  ✓
                </span>
              ))}
              {(row.pendingBy ?? []).map((name) => (
                <span
                  key={name}
                  className="lk-msl-tick is-pending"
                  data-name={name}
                  title={`${name} asked to confirm`}
                >
                  ○
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {changedNote && <p className="lk-msl-changed">{changedNote}</p>}
      {lastSeen && lastSeen.length > 0 && (
        <p className="lk-msl-footer">
          {lastSeen.map(({ name, days }) => (
            <span key={name} className="lk-msl-footline">
              {name} last looked {days} {days === 1 ? 'day' : 'days'} ago.
            </span>
          ))}
        </p>
      )}
      <p className="lk-msl-caption">{caption}</p>
    </div>
  )
}
