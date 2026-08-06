/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // VAYU brand palette — ISRO space-to-earth aesthetic
        'vayu-blue': '#0ea5e9',
        'vayu-dark': '#030810',
        'vayu-panel': 'rgba(6, 10, 22, 0.90)',
        'vayu-accent': '#22d3ee',
        'vayu-warm': '#ff6b35',
        'vayu-hot': '#ef4444',
        'vayu-cool': '#3b82f6',
        'vayu-success': '#22c55e',
        // ISRO tricolor accents
        'isro-saffron': '#ff9933',
        'isro-navy': '#0a2351',
        'isro-green': '#138808',
        // Theme-aware — foreground/panel flip with data-theme via CSS vars
        // in design-system/tokens.css, so `text-foreground/40` etc. read
        // correctly in both light and dark modes without a second class set.
        // Legacy comma rgba() form — required because --fg-rgb/--panel-bg-rgb
        // are comma-separated triplets (shared with the many inline
        // `rgba(var(--fg-rgb),var(--fg-aNN))` styles elsewhere); the modern
        // `rgb(var(...) / <alpha-value>)` slash syntax is invalid CSS when
        // mixed with a comma-separated var and silently drops the whole
        // declaration, which is why `text-foreground/*` etc. weren't working.
        foreground: 'rgba(var(--fg-rgb), <alpha-value>)',
        panel: 'rgba(var(--panel-bg-rgb), <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};
