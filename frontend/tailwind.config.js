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
