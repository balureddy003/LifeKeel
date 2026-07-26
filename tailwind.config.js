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
          500: '#7c6ef0',
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
          tertiary: '#6b6b80',
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
