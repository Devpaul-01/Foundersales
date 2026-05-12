import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}', './index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Electric Blue primary system
        brand: {
          50:  '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          DEFAULT: '#2563eb',  // Electric Blue — blue-600
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },
        // Surface system (white-first)
        surface: {
          base:     '#f8fafc',   // very light slate
          white:    '#ffffff',
          card:     '#ffffff',
          elevated: '#ffffff',
          hover:    '#f1f5f9',
          selected: '#eff6ff',   // blue-50
          border:   '#e2e8f0',   // slate-200
          'border-strong': '#cbd5e1', // slate-300
        },
        // Text
        text: {
          primary:   '#0f172a',  // slate-900
          secondary: '#475569',  // slate-600
          muted:     '#94a3b8',  // slate-400
          disabled:  '#cbd5e1',  // slate-300
          inverse:   '#ffffff',
        },
        // Status
        success: {
          DEFAULT: '#10b981',
          light:   '#d1fae5',
          dark:    '#059669',
        },
        warning: {
          DEFAULT: '#f59e0b',
          light:   '#fef3c7',
          dark:    '#d97706',
        },
        danger: {
          DEFAULT: '#ef4444',
          light:   '#fee2e2',
          dark:    '#dc2626',
        },
        info: {
          DEFAULT: '#3b82f6',
          light:   '#dbeafe',
          dark:    '#2563eb',
        },
        // Pipeline stage colors
        stage: {
          new:        '#64748b',
          contacted:  '#3b82f6',
          replied:    '#8b5cf6',
          call_demo:  '#f59e0b',
          closed_won: '#10b981',
          closed_lost:'#ef4444',
        },
      },
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        display: ['Inter', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.75rem' }],
      },
      borderRadius: {
        DEFAULT: '0.5rem',
        sm:  '0.25rem',
        md:  '0.375rem',
        lg:  '0.75rem',
        xl:  '1rem',
        '2xl': '1.25rem',
      },
      boxShadow: {
        card:       '0 1px 3px 0 rgba(0,0,0,0.08), 0 1px 2px -1px rgba(0,0,0,0.06)',
        'card-md':  '0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05)',
        elevated:   '0 10px 25px -3px rgba(0,0,0,0.08), 0 4px 10px -4px rgba(0,0,0,0.06)',
        brand:      '0 0 0 3px rgba(37,99,235,0.18)',
        'brand-sm': '0 0 0 2px rgba(37,99,235,0.18)',
        inner:      'inset 0 2px 4px 0 rgba(0,0,0,0.06)',
      },
      keyframes: {
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.5' },
        },
        spin: {
          '0%':   { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0' },
        },
        bounce: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-4px)' },
        },
      },
      animation: {
        shimmer:  'shimmer 1.8s linear infinite',
        fadeIn:   'fadeIn 0.2s ease-out',
        slideUp:  'slideUp 0.2s ease-out',
        pulse:    'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        spin:     'spin 0.8s linear infinite',
        blink:    'blink 1s step-end infinite',
        bounce:   'bounce 1s ease-in-out infinite',
      },
      backgroundImage: {
        'shimmer-gradient': 'linear-gradient(90deg, transparent 25%, rgba(37,99,235,0.06) 50%, transparent 75%)',
      },
      transitionDuration: {
        '150': '150ms',
        '200': '200ms',
        '300': '300ms',
      },
    },
  },
  plugins: [],
} satisfies Config;
