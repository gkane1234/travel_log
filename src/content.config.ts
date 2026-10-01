import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/** Stable slug from path; avoid Windows backslash ids. */
function tripId({ entry }: { entry: string }) {
  return entry.replace(/\\/g, "/").replace(/\/index\.mdx?$/, "");
}

function dayId({ entry }: { entry: string }) {
  return entry.replace(/\\/g, "/").replace(/\.mdx?$/, "");
}

const trips = defineCollection({
  loader: glob({
    base: "./trips",
    // Separate patterns avoid brace-expansion oddities on Windows.
    pattern: ["*/index.md", "*/index.mdx"],
    generateId: tripId,
  }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    endDate: z.coerce.date().optional(),
    location: z.string().optional(),
    summary: z.string().optional(),
    // Public URL (e.g. /trip-media/slug/photos/cover.jpg), not Astro image().
    // image() broke the content layer when the file was missing and raced the
    // data-store write on Windows.
    cover: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

const days = defineCollection({
  loader: glob({
    base: "./trips",
    pattern: ["*/days/*.md", "*/days/*.mdx"],
    generateId: dayId,
  }),
  schema: z.object({
    title: z.string().optional(),
  }),
});

export const collections = { trips, days };
