import typography from "@tailwindcss/typography";

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
      typography: ({ theme }) => ({
        // Map the `prose-accent` modifier onto our graphite palette so the
        // post body inherits the marketing site's accent colors.
        accent: {
          css: {
            "--tw-prose-body": theme("colors.accent.700"),
            "--tw-prose-headings": theme("colors.accent.900"),
            "--tw-prose-lead": theme("colors.accent.600"),
            "--tw-prose-links": theme("colors.accent.900"),
            "--tw-prose-bold": theme("colors.accent.900"),
            "--tw-prose-counters": theme("colors.accent.500"),
            "--tw-prose-bullets": theme("colors.accent.300"),
            "--tw-prose-hr": theme("colors.accent.200"),
            "--tw-prose-quotes": theme("colors.accent.900"),
            "--tw-prose-quote-borders": theme("colors.accent.200"),
            "--tw-prose-captions": theme("colors.accent.500"),
            "--tw-prose-code": theme("colors.accent.900"),
            "--tw-prose-pre-code": theme("colors.accent.800"),
            "--tw-prose-pre-bg": theme("colors.accent.50"),
            "--tw-prose-th-borders": theme("colors.accent.300"),
            "--tw-prose-td-borders": theme("colors.accent.200"),
          },
        },
      }),
    },
  },
  plugins: [typography],
};
