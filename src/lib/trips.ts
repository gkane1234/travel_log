import type { CollectionEntry } from "astro:content";

/** Folder name from a trip overview entry id, e.g. "olympic-peninsula/index" → "olympic-peninsula" */
export function tripSlugFromId(id: string): string {
  return id.replace(/\/index$/, "").split("/")[0] ?? id;
}

/** Trip folder from a day entry id, e.g. "olympic-peninsula/days/2024-08-12" → "olympic-peninsula" */
export function tripSlugFromDayId(id: string): string {
  return id.replace(/\\/g, "/").split("/")[0] ?? id;
}

/** Calendar date from day id */
export function dateFromDayId(id: string): string {
  const base = id.replace(/\\/g, "/").split("/").pop() ?? "";
  return base.replace(/\.(md|mdx)$/, "");
}

export function formatTripDates(start: Date, end?: Date): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  };
  const startStr = start.toLocaleDateString("en-US", opts);
  if (!end || end.getTime() === start.getTime()) return startStr;
  return `${startStr} – ${end.toLocaleDateString("en-US", opts)}`;
}

export function isPublished(
  trip: CollectionEntry<"trips">,
  isDev: boolean,
): boolean {
  return isDev || !trip.data.draft;
}

export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseDateString(s: string): Date {
  const [y, m, day] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function addDays(dateStr: string, delta: number): string {
  const d = parseDateString(dateStr);
  d.setUTCDate(d.getUTCDate() + delta);
  return toDateString(d);
}

export function clampDate(
  dateStr: string,
  start: string,
  end?: string | null,
): string {
  if (dateStr < start) return start;
  if (end && dateStr > end) return end;
  return dateStr;
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
