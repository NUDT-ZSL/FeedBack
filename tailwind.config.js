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
        brand: {
          brown: "#8B6914",
          cream: "#F5F0E8",
          dark: "#4A3525",
        },
        success: "#5D8A4A",
        warning: "#E8873C",
        danger: "#C44536",
        progress: {
          gray: "#D4C8B8",
        },
      },
      fontFamily: {
        display: ['"Playfair Display"', 'serif'],
        serif: ['"Noto Serif SC"', 'serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        card: "12px",
      },
      boxShadow: {
        card: "0 4px 12px rgba(0,0,0,0.08)",
        cardHover: "0 8px 24px rgba(0,0,0,0.12)",
      },
      keyframes: {
        ripple: {
          "0%": { transform: "scale(0)", opacity: "0.5" },
          "100%": { transform: "scale(2.5)", opacity: "0" },
        },
        checkSlideIn: {
          "0%": { transform: "translateX(-100%)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        pulseGlow: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(232, 135, 60, 0.6)" },
          "50%": { boxShadow: "0 0 0 10px rgba(232, 135, 60, 0)" },
        },
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "25%": { transform: "translateX(-4px)" },
          "75%": { transform: "translateX(4px)" },
        },
        slideInRight: {
          "0%": { transform: "translateX(120%)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        slideInTop: {
          "0%": { transform: "translateY(-100%)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        slideInLeft: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(0)" },
        },
        fadeOut: {
          "0%": { opacity: "1" },
          "100%": { opacity: "0" },
        },
      },
      animation: {
        ripple: "ripple 0.4s ease-out forwards",
        checkSlide: "checkSlideIn 0.4s ease-out forwards",
        pulseGlow: "pulseGlow 1.33s ease-in-out infinite",
        shake: "shake 0.3s ease-in-out infinite alternate",
        slideInRight: "slideInRight 0.4s ease-out forwards",
        slideInTop: "slideInTop 0.3s ease-out forwards",
        slideInLeft: "slideInLeft 0.3s ease-out forwards",
        fadeOut: "fadeOut 0.4s ease-in forwards",
      },
    },
  },
  plugins: [],
};
