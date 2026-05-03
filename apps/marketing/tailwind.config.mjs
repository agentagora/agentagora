/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Accent: graphite (neutral, infrastructure feel — no gradients).
        accent: {
          50: "#f5f6f8",
          100: "#e8eaee",
          200: "#cdd1d9",
          300: "#a6acb9",
          400: "#7a8294",
          500: "#5a6172",
          600: "#454b5a",
          700: "#363b48",
          800: "#23272f",
          900: "#15181d",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};
