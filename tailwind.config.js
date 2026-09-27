/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        cream: {
          50: '#FFFBF0',
          100: '#FFF8E7',
          200: '#FFEFC1',
          300: '#FFE499',
        },
        brown: {
          50: '#FDF6E3',
          100: '#F5E6C8',
          200: '#E8D4A8',
          300: '#C4A574',
          400: '#A67C52',
          500: '#8B6914',
          600: '#6B4F10',
          700: '#5A420D',
        },
        forest: {
          50: '#E8F5E9',
          100: '#C8E6C9',
          200: '#A5D6A7',
          500: '#2E7D32',
          600: '#1B5E20',
        },
        accent: {
          red: '#E53935',
        }
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        body: ['"Open Sans"', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.6s ease-out forwards',
        'bounce-num': 'bounceNum 0.5s ease-out',
        'pulse-dot': 'pulseDot 2s ease-in-out infinite',
        'ripple': 'ripple 0.6s ease-out',
        'spin-slow': 'spin 3s linear infinite',
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        bounceNum: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.3)' },
        },
        pulseDot: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.6', transform: 'scale(1.2)' },
        },
        ripple: {
          '0%': { transform: 'scale(0)', opacity: '1' },
          '100%': { transform: 'scale(4)', opacity: '0' },
        },
      },
      boxShadow: {
        'card': '0 2px 8px rgba(139, 105, 20, 0.1)',
        'card-hover': '0 8px 24px rgba(139, 105, 20, 0.15)',
      }
    },
  },
  plugins: [],
};
