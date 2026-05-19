import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Astro 6 collections require an explicit `loader`. `glob` reads
// front-matter Markdown from `src/content/blog/`. Schema unchanged
// from the legacy `src/content/config.ts`.
const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string().max(160),
    pubDate: z.string(),
    author: z.string(),
    tags: z.array(z.string()).default([]),
    canonicalUrl: z.string().optional(),
  }),
});

export const collections = { blog };
