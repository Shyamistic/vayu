/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // VAYU brand palette — space-to-earth aesthetic
        'vayu-blue': '#0ea5e9',
        'vayu-dark': '#0a0f1e',
        'vayu-panel': 'rgba(10, 15, 30, 0.85)',
        'vayu-accent': '#22d3ee',
        'vayu-warn': '#f97316',
        'vayu-hot': '#ef4444',
        'vayu-cool': '#3b82f6',
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
