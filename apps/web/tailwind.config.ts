import type { Config } from 'tailwindcss';

/**
 * Every colour is a CSS custom property holding an RGB channel triplet, so a
 * component can write `bg-surface` or `bg-danger/10` and the value follows the
 * active theme. Nothing here is a literal hex: see app/globals.css for the
 * palettes and specs/DESIGN_SYSTEM.md for what each token means.
 */
const token = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        background: token('--background'),
        surface: {
          DEFAULT: token('--surface'),
          sunken: token('--surface-sunken'),
          raised: token('--surface-raised'),
          border: token('--border'),
        },
        border: { DEFAULT: token('--border'), strong: token('--border-strong') },
        ink: {
          DEFAULT: token('--foreground'),
          muted: token('--muted'),
          subtle: token('--subtle'),
        },
        brand: {
          DEFAULT: token('--primary'),
          dark: token('--primary-strong'),
          light: token('--primary-soft'),
          fg: token('--primary-fg'),
        },
        ok: { DEFAULT: token('--success'), light: token('--success-soft') },
        warn: { DEFAULT: token('--warning'), light: token('--warning-soft') },
        danger: { DEFAULT: token('--danger'), fg: token('--danger-fg'), light: token('--danger-soft') },
        info: { DEFAULT: token('--info'), light: token('--info-soft') },
        ring: token('--ring'),

        // Pharmaceutical status. One meaning per token, product-wide.
        st: {
          available: token('--st-available'),
          low: token('--st-low'),
          out: token('--st-out'),
          near: token('--st-near-expiry'),
          expired: token('--st-expired'),
          quarantine: token('--st-quarantine'),
          recall: token('--st-recall'),
          blocked: token('--st-blocked'),
          cold: token('--st-cold-chain'),
          controlled: token('--st-controlled'),
          transit: token('--st-in-transit'),
          pending: token('--st-pending'),
        },
      },
      fontFamily: {
        sans: [
          'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto',
          'Helvetica Neue', 'Arial', 'Noto Sans Ethiopic', 'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        // The scale from the design system, each with its line height.
        caption: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.04em', fontWeight: '500' }],
        small: ['0.8125rem', { lineHeight: '1.125rem' }],
        body: ['0.875rem', { lineHeight: '1.25rem' }],
        section: ['0.9375rem', { lineHeight: '1.25rem', fontWeight: '600' }],
        title: ['1.25rem', { lineHeight: '1.75rem', fontWeight: '600' }],
        display: ['1.875rem', { lineHeight: '2.25rem', fontWeight: '600' }],
      },
      borderRadius: { DEFAULT: '0.375rem', card: '0.5rem', pill: '9999px' },
      boxShadow: {
        // Three steps, used for layering rather than to make cards float.
        raised: '0 1px 2px 0 rgb(var(--shadow) / 0.06)',
        panel: '0 4px 12px -2px rgb(var(--shadow) / 0.10), 0 2px 4px -2px rgb(var(--shadow) / 0.06)',
        overlay: '0 16px 40px -8px rgb(var(--shadow) / 0.24)',
      },
      transitionDuration: { state: '120ms', enter: '180ms', drawer: '240ms' },
      screens: { xs: '480px', '3xl': '1800px' },
    },
  },
  plugins: [],
} satisfies Config;
