import { marked } from "marked";
import { listDayDates, listTripSlugs, readDay, readTripMeta, type TripMeta } from "./author";

marked.use({ gfm: true, breaks: true });

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripFrontmatter(raw: string): string {
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) return text;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return text;
  return text.slice(end + 4).replace(/^\r?\n/, "");
}

/** Prefix site-root media paths when GitHub Pages serves the site from a subpath. */
export function publicAsset(url: string | undefined, base = "/"): string | undefined {
  if (!url || !url.startsWith("/")) return url;
  const prefix = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${prefix}${url}`;
}

/** Turn a day note into HTML, including TripMap and TripVideo tags. */
export function renderMarkdown(raw: string, base = "/"): string {
  const prefix = base.endsWith("/") ? base.slice(0, -1) : base;
  let text = stripFrontmatter(raw);
  if (prefix) {
    text = text.replaceAll("(/trip-media/", `(${prefix}/trip-media/`);
    text = text.replaceAll('src="/trip-media/', `src="${prefix}/trip-media/`);
  }
  text = text.replace(/<TripVideo\s+src="([^"]+)"\s*\/?\s*>/g, (_, src: string) => {
    const safe = escapeHtml(src);
    return `<figure class="trip-video"><video controls playsinline preload="metadata" src="${safe}"></video></figure>`;
  });
  text = text.replace(/<TripMap\s+([^>]*?)\/>/g, (_, attrs: string) => {
    const src = attrs.match(/src="([^"]*)"/)?.[1] ?? "";
    const title = attrs.match(/title="([^"]*)"/)?.[1] ?? "Route";
    const filename = src.split("/").pop() || src;
    return `<figure class="trip-map"><div class="trip-map__canvas" aria-hidden="true"><span class="trip-map__mark">map</span></div><figcaption><strong>${escapeHtml(title)}</strong><span>${escapeHtml(filename)}</span><em>Interactive map coming later</em></figcaption></figure>`;
  });
  return marked.parse(text, { async: false }) as string;
}

export async function listPublicTrips(): Promise<TripMeta[]> {
  const slugs = await listTripSlugs();
  const trips: TripMeta[] = [];
  for (const slug of slugs) {
    try {
      const meta = await readTripMeta(slug);
      if (!meta.draft) trips.push(meta);
    } catch {
      /* skip */
    }
  }
  trips.sort((a, b) => b.date.localeCompare(a.date));
  return trips;
}

export async function loadPublicTrip(slug: string, base = "/"): Promise<{
  meta: TripMeta;
  introHtml: string;
  days: { date: string; html: string }[];
} | null> {
  let meta: TripMeta;
  try {
    meta = await readTripMeta(slug);
  } catch {
    return null;
  }
  if (meta.draft) return null;
  const indexRaw = await readIndexBody(slug);
  const dates = await listDayDates(slug);
  const days = [];
  for (const date of dates) {
    const day = await readDay(slug, date);
    days.push({ date, html: renderMarkdown(day.body, base) });
  }
  return { meta, introHtml: renderMarkdown(indexRaw, base), days };
}

async function readIndexBody(slug: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const { tripDir } = await import("./author");
  const dir = tripDir(slug);
  for (const name of ["index.md", "index.mdx"]) {
    try {
      return await readFile(path.join(dir, name), "utf8");
    } catch {
      /* next */
    }
  }
  return "";
}
