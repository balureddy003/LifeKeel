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
          50: '#fdf6e7',
          100: '#faecc8',
          200: '#f3d896',
          300: '#ecc56a',
          // Text/link purple on the page surface — reads from the CSS var
          // so it stays AA-legible in both themes (light theme darkens it).
          400: 'rgb(var(--family-400) / <alpha-value>)',
          // Was #7c6ef0 — 3.93:1 for white text on this, the app's
          // primary CTA fill (GlassButton, Continue, Send, Save &
          // Generate Insights, etc. — 15 files), below WCAG AA's 4.5:1
          // for normal-size text. Only ever used as a background/border
          // (text-family-500 doesn't exist in the app; text uses the
          // lighter family-400 against dark surfaces instead), so
          // darkening it can't regress contrast the other direction.
          // Same hue/saturation, darkened just enough for 4.52:1.
          500: 'rgb(var(--family-500) / <alpha-value>)',
          // Foreground accent on the page surface (icons, active states,
          // gradients) — reads from the CSS var so it stays AA-legible in
          // both themes (light theme darkens it) and can never drift from
          // the value components use in inline styles.
          accent: 'rgb(var(--family-accent) / <alpha-value>)',
          600: 'rgb(var(--family-600) / <alpha-value>)',
          700: 'rgb(var(--family-700) / <alpha-value>)',
          800: '#7a5206',
          900: '#5c3d04',
        },
        // The one token every white-alpha surface goes through. Dark theme
        // maps it to white; light theme to near-black — so bg-tint/5 is the
        // same "subtle card on the page background" in both.
        tint: 'rgb(var(--tint) / <alpha-value>)',
        // Surface tokens — flip to the light palette under
        // [data-theme='light']; deeper, cooler dark remains the default.
        surface: {
          0: 'rgb(var(--surface-0) / <alpha-value>)',
          1: 'rgb(var(--surface-1) / <alpha-value>)',
          2: 'rgb(var(--surface-2) / <alpha-value>)',
          3: 'rgb(var(--surface-3) / <alpha-value>)',
        },
        // Sticky nav/header chrome — dark surface or white, by theme.
        navbg: 'rgb(var(--nav-bg) / <alpha-value>)',
        ink: {
          primary: 'rgb(var(--ink-1) / <alpha-value>)',
          secondary: 'rgb(var(--ink-2) / <alpha-value>)',
          // Was #6b6b80 — 3.85:1 against surface-0 (#08080c), below WCAG AA's
          // 4.5:1 for normal text. ink-tertiary is used almost exclusively
          // at text-xs/text-sm (captions, timestamps, disclaimers) across
          // the whole app, well under the "large text" size that would
          // allow the lower 3:1 threshold, so this was a real, systemic
          // failure, not a borderline judgment call. Same hue/saturation,
          // lightened just enough for 4.84:1. Both themes now hold AA.
          tertiary: 'rgb(var(--ink-3) / <alpha-value>)',
        },
        haze: {
          DEFAULT: 'rgb(var(--haze) / <alpha-value>)',
          light: 'rgb(var(--haze-light) / <alpha-value>)',
        },
        // Semantic — flip to deeper shades in light theme so status text
        // keeps AA on the light background.
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-body)', 'var(--font-sans)', 'system-ui', 'sans-serif'],
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
        fab: '40',       // floating action buttons (Ask Keel, Emergency)
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
