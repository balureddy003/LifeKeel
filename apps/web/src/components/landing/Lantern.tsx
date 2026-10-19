/** Drawn inline so the board does not depend on symbols rendered elsewhere on the page. */
export function Lantern({ lit = true, className }: { lit?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 20 30" aria-hidden="true" className={className}>
      <path
        d="M10 1 V5 M6 5 H14 L16 9 V21 L14 25 H6 L4 21 V9 Z M7 25 V28 H13 V25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={lit ? undefined : '3 2.5'}
      />
      {lit && <circle cx="10" cy="15" r="3.4" fill="currentColor" />}
    </svg>
  )
}
