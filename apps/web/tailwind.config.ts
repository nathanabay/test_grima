import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Calm clinical palette: high contrast, low saturation, data-dense.
        ink: { DEFAULT: '#0f172a', muted: '#475569', subtle: '#94a3b8' },
        surface: { DEFAULT: '#ffffff', sunken: '#f8fafc', border: '#e2e8f0' },
        brand: { DEFAULT: '#0d7d6c', dark: '#0a6156', light: '#e6f4f1' },
        danger: { DEFAULT: '#b91c1c', light: '#fef2f2' },
        warn: { DEFAULT: '#b45309', light: '#fffbeb' },
        ok: { DEFAULT: '#15803d', light: '#f0fdf4' },
        info: { DEFAULT: '#1d4ed8', light: '#eff6ff' },
      },
      fontFamily: { sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config;
