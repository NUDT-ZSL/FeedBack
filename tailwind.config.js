/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/client/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        cream: '#FFF8F0',
        'warm-orange': '#FF9A5C',
        'warm-orange-light': '#FFB88C',
        'warm-green': '#7BC47F',
        'warm-green-light': '#A5D6A7',
      },
      fontFamily: {
        sans: ['Noto Sans SC', 'Quicksand', 'sans-serif'],
        display: ['Quicksand', 'Noto Sans SC', 'sans-serif'],
      },
      borderRadius: {
        'xl2': '16px',
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};
