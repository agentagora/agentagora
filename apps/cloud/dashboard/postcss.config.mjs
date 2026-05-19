// Next.js picks up postcss.config.* automatically. Tailwind 3 + Autoprefixer
// is the standard pipeline. Order matters — Tailwind expands @tailwind
// directives first, autoprefixer adds vendor prefixes second.
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
