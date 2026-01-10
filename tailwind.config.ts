import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Warm backgrounds
        cream: {
          DEFAULT: '#faf9f7',
          alt: '#f3f1ed',
        },
        // Text colors
        charcoal: {
          DEFAULT: '#1a1a1f',
          light: '#2d2d35',
        },
        slate: {
          DEFAULT: '#5a5a65',
          muted: '#8a8a95',
        },
        // Accent - warm taupe/bronze
        taupe: {
          DEFAULT: '#b8845c',
          hover: '#a37249',
          light: 'rgba(184, 132, 92, 0.08)',
          border: 'rgba(184, 132, 92, 0.2)',
        },
        // Borders
        border: {
          DEFAULT: '#e5e3df',
          light: '#eeece8',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        body: ['var(--font-body)', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      fontSize: {
        'display-xl': ['clamp(2.5rem, 6vw, 4.5rem)', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        'display-lg': ['clamp(1.75rem, 4vw, 2.75rem)', { lineHeight: '1.2', letterSpacing: '-0.01em' }],
      },
      borderRadius: {
        card: '16px',
        'card-lg': '24px',
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.04), 0 8px 40px rgba(0,0,0,0.06)',
        'card-hover': '0 8px 32px rgba(184, 132, 92, 0.12)',
        subtle: '0 4px 24px rgba(0,0,0,0.04)',
        dropdown: '0 4px 20px rgba(0,0,0,0.08)',
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.6s ease forwards',
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
