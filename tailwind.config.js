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
        dark: {
          DEFAULT: '#1e1e2e',
          50: '#2a2a3d',
          100: '#33334d',
          200: '#3d3d5c',
        },
        neon: {
          DEFAULT: '#00d4aa',
          dim: '#00a888',
          glow: '#00ffcc',
        },
      },
      fontFamily: {
        display: ['Outfit', 'sans-serif'],
        body: ['Noto Sans SC', 'sans-serif'],
      },
      borderRadius: {
        glass: '12px',
      },
      backdropBlur: {
        glass: '12px',
      },
    },
  },
  plugins: [],
};
