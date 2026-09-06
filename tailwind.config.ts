import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Onest', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        base: '#08090f',
        panel: 'rgba(14,16,26,0.85)',
        glass: 'rgba(255,255,255,0.04)',
        accent: '#6e8eff',
        accent2: '#a78bfa',
        cyan: '#36e0be',
        muted: '#8b93a8',
        dim: '#525a70',
      },
      boxShadow: {
        glass: '0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.07)',
        glow: '0 0 40px rgba(110,142,255,0.25)',
        'glow-sm': '0 0 20px rgba(110,142,255,0.2)',
        panel: '0 20px 60px rgba(0,0,0,0.6)',
      },
      borderColor: {
        subtle: 'rgba(255,255,255,0.06)',
        normal: 'rgba(255,255,255,0.10)',
        accent: 'rgba(110,142,255,0.35)',
      },
      backdropBlur: {
        xs: '6px',
        sm: '12px',
        md: '20px',
        lg: '32px',
      },
      transitionTimingFunction: {
        premium: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '22px',
        '4xl': '28px',
      },
    },
  },
  plugins: [],
} satisfies Config;
