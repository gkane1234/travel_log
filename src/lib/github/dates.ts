export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseDateString(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function addDays(dateStr: string, delta: number): string {
  const date = parseDateString(dateStr);
  date.setUTCDate(date.getUTCDate() + delta);
  return toDateString(date);
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
