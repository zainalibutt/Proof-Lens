/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg:   { DEFAULT: "#0B0F14", card: "#11161D" },
        text: { DEFAULT: "#E5EDF5", soft: "#B9C5D1", subtle: "#93A1AE" },
        pri:  { DEFAULT: "#7C9CFF", hover: "#6A88E8", ring: "#9DB4FF" },
        acc:  { green: "#27D980", red: "#FF6B6B", amber: "#FFB020" }
      },
      borderRadius: { xl: "16px", "2xl": "24px" },
      boxShadow: { card: "0 6px 24px rgba(0,0,0,0.25)" }
    }
  },
  plugins: []
};
