/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        heading: ["Orbitron", "sans-serif"],
        body: ["Space Grotesk", "sans-serif"],
      },
      colors: {
        oceanic: {
          100: "#d6f4ff",
          200: "#8fddee",
          300: "#51c2d8",
          400: "#1f8ea8",
          500: "#125f78",
        },
        solar: {
          100: "#fff2d9",
          200: "#ffd28a",
          300: "#ffb05b",
          400: "#e8861f",
        },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(118,243,255,0.35), 0 12px 30px rgba(0,0,0,0.35)",
      },
    },
  },
  plugins: [],
};