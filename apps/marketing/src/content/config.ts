import { defineCollection, z } from "astro:content";

const blog = defineCollection({
  type: "content",
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
