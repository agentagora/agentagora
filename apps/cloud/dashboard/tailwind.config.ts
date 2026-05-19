import type { Config } from "tailwindcss";

// Mirrors apps/marketing/tailwind.config.mjs — graphite accent palette
// + Inter sans + system mono. Keep these two configs aligned so the
// dashboard and marketing site read as one product.
export default {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
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
          "'Inter Variable'",
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
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
} satisfies Config;
