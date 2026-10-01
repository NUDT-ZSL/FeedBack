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
        primary: {
          50: "#f0f5ff",
          100: "#e0ebff",
          200: "#b9d2ff",
          300: "#8ab1ff",
          400: "#5a8aff",
          500: "#3a6bff",
          600: "#2549e6",
          700: "#1e38b8",
          800: "#1a3094",
          900: "#1a2c78",
        },
        accent: {
          50: "#fff5f5",
          100: "#ffe0e0",
          200: "#ffc7c7",
          300: "#ffa3a3",
          400: "#ff7a7a",
          500: "#ff5252",
          600: "#e63939",
          700: "#b82a2a",
          800: "#942222",
          900: "#781c1c",
        },
        glass: {
          light: "rgba(255, 255, 255, 0.1)",
          DEFAULT: "rgba(255, 255, 255, 0.05)",
          dark: "rgba(0, 0, 0, 0.2)",
        },
        dark: {
          900: "#0f0f1a",
          800: "#1a1a2e",
          700: "#16213e",
          600: "#1f2a4f",
          500: "#2a3a5f",
        },
      },
      fontFamily: {
        display: ["'Space Grotesk'", "sans-serif"],
        body: ["'Poppins'", "sans-serif"],
      },
      animation: {
        "fade-in": "fadeIn 0.5s ease-out",
        "fade-in-up": "fadeInUp 0.6s ease-out",
        "slide-in": "slideIn 0.3s ease-out",
        "pulse-glow": "pulseGlow 2s ease-in-out infinite",
        "countdown": "countdown var(--countdown-duration) linear forwards",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideIn: {
          "0%": { opacity: "0", transform: "translateX(-10px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        pulseGlow: {
          "0%, 100%": { boxShadow: "0 0 20px rgba(58, 107, 255, 0.3)" },
          "50%": { boxShadow: "0 0 40px rgba(58, 107, 255, 0.6)" },
        },
        countdown: {
          "0%": { width: "100%" },
          "100%": { width: "0%" },
        },
      },
      backgroundImage: {
        "gradient-dark": "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
        "gradient-primary": "linear-gradient(135deg, #3a6bff 0%, #2549e6 100%)",
        "gradient-accent": "linear-gradient(135deg, #ff5252 0%, #e63939 100%)",
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};
