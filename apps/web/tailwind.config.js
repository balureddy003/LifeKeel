/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Refined accent — cool indigo/violet (Linear/Perplexity-inspired)
        family: {
          50: '#f0f0ff',
          100: '#e0e0ff',
          200: '#c4c0ff',
          300: '#a8a0ff',
          400: '#8b80f8',
          // Was #7c6ef0 — 3.93:1 for white text on this, the app's
          // primary CTA fill (GlassButton, Continue, Send, Save &
          // Generate Insights, etc. — 15 files), below WCAG AA's 4.5:1
          // for normal-size text. Only ever used as a background/border
          // (text-family-500 doesn't exist in the app; text uses the
          // lighter family-400 against dark surfaces instead), so
          // darkening it can't regress contrast the other direction.
          // Same hue/saturation, darkened just enough for 4.52:1.
          500: '#7061ef',
          // Foreground accent on dark surfaces (icons, active states,
          // gradients) — reads from the CSS var so it can never drift from
          // the value components use in inline styles. Deliberately lighter
          // than 500: this shade passes AA as a text/icon color on the dark
          // background, where 500 is tuned for white text on a purple fill.
          accent: 'var(--family-accent)',
          600: '#6b5ce0',
          700: '#5a4dd0',
          800: '#4a3eb0',
          900: '#3a2e90',
        },
        // Surface tokens — deeper, cooler dark (Linear-inspired)
        surface: {
          0: '#08080c',
          1: '#0f0f15',
          2: '#16161e',
          3: '#1d1d28',
        },
        ink: {
          primary: '#f5f5f7',
          secondary: '#a0a0b0',
          // Was #6b6b80 — 3.85:1 against surface-0 (#08080c), below WCAG AA's
          // 4.5:1 for normal text. ink-tertiary is used almost exclusively
          // at text-xs/text-sm (captions, timestamps, disclaimers) across
          // the whole app, well under the "large text" size that would
          // allow the lower 3:1 threshold, so this was a real, systemic
          // failure, not a borderline judgment call. Same hue/saturation,
          // lightened just enough for 4.84:1.
          tertiary: '#7b7b91',
        },
        haze: {
          DEFAULT: '#2a2a35',
          light: '#3a3a48',
        },
        // Semantic
        success: '#4ade80',
        warning: '#fbbf24',
        danger: '#f87171',
        info: '#60a5fa',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      // Named type ramp — replaces the ~20 one-off text-[Npx]/text-[Nrem]
      // literals that had accreted across the app (10px, 10.5px, 11px,
      // 11.5px, 12px, 12.5px, 13px, 13.5px, 14.5px, 15px, 1.05rem–2.6rem).
      // Sizes collapse to the nearest step (±0.5px) — the half-pixel noise
      // was never intentional, just unscaled. html is 17px so rem steps
      // resolve slightly larger than a stock Tailwind setup.
      fontSize: {
        caption:      ['10px',   '13px'],  // tab labels, badges
        footnote:     ['12px',   '16px'],  // fine print, timestamps, card meta
        subhead:      ['13.5px', '18px'],  // secondary body, list subtitles
        callout:      ['15px',   '20px'],  // emphasized body, card titles
        lead:         ['1.05rem','1.5'],   // hero/intro paragraphs
        'title-sm':   ['1.3rem', '1.2'],   // section headings
        'title-md':   ['1.5rem', '1.2'],   // page-section headings
        'title-lg':   ['1.8rem', '1.15'],  // page titles (PageHeader)
        'display-sm': ['2.1rem', '1.15'],  // marketing hero
        'display':    ['2.6rem', '1.1'],   // marketing hero, lg+
      },
      // Named stacking scale — replaces ad-hoc z-10/20/30/40/50/[60]/[100]/
      // [200] literals that only held order by coincidence. Layers read
      // bottom→top: backdrop < content < sticky headers < nav < FABs <
      // banners < overlays < modals < skip link (always topmost).
      zIndex: {
        behind: '-10',   // MeshGradient page backdrop
        raised: '10',    // in-component stacking above sibling layers
        sticky: '20',    // sticky page headers (PageHeader)
        nav: '30',       // primary navigation (tab bar, rail, marketing nav)
        fab: '40',       // floating action buttons (Ask Oak, Emergency)
        banner: '50',    // status banners (OfflineBanner)
        overlay: '60',   // EmergencyMode full-screen overlay
        modal: '100',    // BottomSheet, CommandPalette
        skip: '200',     // skip-to-content link — nothing goes above this
      },
      animation: {
        'slide-up': 'slideUp 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
      },
    },
  },
  plugins: [],
}
