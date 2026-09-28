/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/client/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        forest: {
          50: '#f5f0e8',
          100: '#e8dfd0',
          200: '#d1c4a8',
          300: '#b5a07a',
          400: '#9e845c',
          500: '#8a7049',
          600: '#6e5739',
          700: '#54412d',
          800: '#1a2f23',
          900: '#0f1d15',
        },
        copper: {
          50: '#fdf5ee',
          100: '#fbe8d4',
          200: '#f6cda5',
          300: '#f0ad6e',
          400: '#c47d4e',
          500: '#b0693d',
          600: '#955432',
          700: '#76412a',
          800: '#5e3426',
          900: '#4e2c23',
        },
        gold: {
          400: '#d4a855',
          500: '#c9983e',
        },
        charcoal: '#2d2d2d',
        ivory: '#f5f0e8',
      },
      fontFamily: {
        display: ['Playfair Display', 'serif'],
        body: ['Noto Sans SC', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
