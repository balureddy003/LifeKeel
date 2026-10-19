/** SVG symbols shared by the landing scenes. Render once per page. */
export function LandingSymbols() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <symbol id="lk-boat" viewBox="0 0 120 140">
          <path d="M60 6 L20 98" stroke="currentColor" strokeWidth="1" fill="none" opacity=".5" />
          <path
            d="M60 8 C 86 40, 96 76, 92 96 L60 96 Z"
            fill="var(--surface)"
            stroke="var(--ink)"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M54 20 C 36 50, 26 76, 24 96 L54 96 Z"
            fill="var(--surface)"
            stroke="var(--ink)"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M62 14 C 80 42, 88 70, 87 90"
            stroke="var(--crest)"
            strokeWidth="2"
            fill="none"
          />
          <path d="M60 4 V98" stroke="var(--ink)" strokeWidth="2.2" />
          <path d="M8 98 H106 C102 111 93 119 80 121 H34 C21 119 12 111 8 98 Z" fill="var(--ink)" />
          <path d="M11 103 H103" stroke="var(--cta)" strokeWidth="2.4" />
          <path d="M54 121 H66 L62 138 H58 Z" fill="var(--cta)" />
        </symbol>
        <symbol id="lk-lantern-off" viewBox="0 0 20 30">
          <path
            d="M10 1 V5 M6 5 H14 L16 9 V21 L14 25 H6 L4 21 V9 Z M7 25 V28 H13 V25"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray="3 2.5"
          />
        </symbol>
        <symbol id="lk-lantern" viewBox="0 0 20 30">
          <path
            d="M10 1 V5 M6 5 H14 L16 9 V21 L14 25 H6 L4 21 V9 Z M7 25 V28 H13 V25"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle cx="10" cy="15" r="3.4" fill="currentColor" />
        </symbol>
      </defs>
    </svg>
  )
}
