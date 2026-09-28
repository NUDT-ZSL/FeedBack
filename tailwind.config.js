/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/client/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        wine: {
          50: '#faf5f5',
          100: '#f5e7e8',
          200: '#ebd0d2',
          300: '#d9a8ac',
          400: '#c0757b',
          500: '#a94e55',
          600: '#8d3b43',
          700: '#722F37',
          800: '#5e282f',
          900: '#4a2026',
          950: '#2f1215',
        },
        gold: {
          50: '#fdfbf4',
          100: '#faf4df',
          200: '#f3e7b9',
          300: '#ebd48c',
          400: '#e0bd5c',
          500: '#D4AF37',
          600: '#c09225',
          700: '#a07020',
          800: '#825922',
          900: '#6b4820',
          950: '#3c250e',
        },
        theater: {
          bg: '#1A1A2E',
          card: '#2D2D3A',
          cardHover: '#353545',
          border: '#3D3D52',
          text: '#F5F5F5',
          textDim: '#A0A0A0',
          textMuted: '#6B6B80',
        }
      },
      fontFamily: {
        display: ['"Playfair Display"', 'serif'],
        body: ['Lato', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        'card': '12px',
      },
      boxShadow: {
        'card': '0 2px 8px rgba(0, 0, 0, 0.3)',
        'cardHover': '0 12px 32px rgba(114, 47, 55, 0.25), 0 4px 12px rgba(0, 0, 0, 0.4)',
        'gold': '0 0 20px rgba(212, 175, 55, 0.3)',
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.5s ease-out forwards',
        'shake': 'shake 0.4s ease-in-out',
        'pulse-slow': 'pulse 2s ease-in-out infinite',
        'slide-in': 'slideIn 0.3s ease-out forwards',
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '15%': { transform: 'translateX(-6px)' },
          '30%': { transform: 'translateX(6px)' },
          '45%': { transform: 'translateX(-4px)' },
          '60%': { transform: 'translateX(4px)' },
          '75%': { transform: 'translateX(-2px)' },
          '90%': { transform: 'translateX(2px)' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      transitionTimingFunction: {
        'theater': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
};
