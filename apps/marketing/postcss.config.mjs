// Tailwind 3 + Autoprefixer pipeline. The Astro 6 upgrade dropped the
// `@astrojs/tailwind` integration (its peerDependencies don't include
// Astro 6 and the package appears to be effectively frozen at 6.0.2 for
// the Astro 5 line). PostCSS is Astro's native CSS pipeline, so feeding
// Tailwind through it gets the same `@tailwind base/components/utilities`
// directives picked up — no markup or class changes needed.
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
