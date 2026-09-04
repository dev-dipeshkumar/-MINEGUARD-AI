/** @type {import('tailwindcss').Config} */
const tokens = {
  app: 'var(--bg-app)',
  panel: 'var(--bg-panel)',
  raised: 'var(--bg-raised)',
  sunken: 'var(--bg-sunken)',
  line: 'var(--line)',
  'line-strong': 'var(--line-strong)',
  ink: 'var(--text)',
  'ink-dim': 'var(--text-dim)',
  'ink-faint': 'var(--text-faint)',
  accent: 'var(--accent)',
  'accent-ink': 'var(--accent-ink)',
  low: 'var(--risk-low)',
  moderate: 'var(--risk-moderate)',
  elevated: 'var(--risk-elevated)',
  high: 'var(--risk-high)',
  critical: 'var(--risk-critical)',
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
  info: 'var(--info)',
}

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: tokens,
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', '-apple-system', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['10px', '13px'],
      },
      letterSpacing: {
        tightest: '-0.02em',
        wide2: '0.08em',
      },
      boxShadow: {
        panel: '0 1px 2px rgba(0,0,0,0.18)',
        pop: '0 12px 32px -8px rgba(0,0,0,0.5)',
        glow: '0 0 0 1px var(--accent-line)',
      },
      keyframes: {
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'none' } },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 var(--pulse)' },
          '70%': { boxShadow: '0 0 0 10px transparent' },
          '100%': { boxShadow: '0 0 0 0 transparent' },
        },
        'count-flash': { '0%': { background: 'var(--flash)' }, '100%': { background: 'transparent' } },
        shimmer: { '0%': { backgroundPosition: '-450px 0' }, '100%': { backgroundPosition: '450px 0' } },
      },
      animation: {
        'fade-up': 'fade-up 220ms ease-out',
        'pulse-ring': 'pulse-ring 2.4s ease-out infinite',
        'count-flash': 'count-flash 900ms ease-out',
        shimmer: 'shimmer 1.4s linear infinite',
      },
    },
  },
  plugins: [],
}
