/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        observatory: {
          bg: '#0a0a1a',
          dome: '#0a0a2e',
          floor: '#3a4a4a',
          panel: '#2a1a0a',
          panelHover: '#4a3a2a',
          paper: '#f5e6c8',
          ink: '#3a2a1a',
          gold: '#c0a030',
          goldBright: '#d4a030',
          bronze: '#8a7020',
          textLight: '#f0e0c0',
          eclipse