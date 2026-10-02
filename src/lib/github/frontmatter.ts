export type Frontmatter = Record<string, string | boolean>;

export function parseFrontmatter(raw: string): { data: Frontmatter; body: string } {
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) return { data: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: text };
  const block = text.slice(4, end).trim();
  const body = text.slice(end + 4).replace(/^\r?\n/, "");
  const data: Frontmatter = {};
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (value === "true") data[match[1]] = true;
    else if (value === "false") data[match[1]] = false;
    else {
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      data[match[1]] = value;
    }
  }
  return { data, body };
}

function formatValue(value: string | boolean): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (/[:#\n]/.test(value) || /^\s|\s$/.test(value)) return JSON.stringify(value);
  return value;
}

export function stringifyFrontmatter(
  data: Record<string, string | boolean | undefined>,
  body: string,
): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === "") continue;
    lines.push(`${key}: ${formatValue(value)}`);
  }
  lines.push("---", "");
  return `${lines.join("\n")}${body.replace(/^\r?\n/, "")}`;
}

export type RemoteTrip = {
  slug: string;
  title: string;
  date: string;
  endDate?: string;
  location?: string;
  summary?: string;
  cover?: string;
  kind?: string;
  draft: boolean;
  indexPath: string;
  dayDates: string[];
};

export function tripFromIndex(slug: string, indexPath: string, raw: string, dayDates: string[]): RemoteTrip {
  const { data } = parseFrontmatter(raw);
  return {
    slug,
    title: String(data.title ?? slug),
    date: String(data.date ?? ""),
    endDate: data.endDate ? String(data.endDate) : undefined,
    location: data.location ? String(data.location) : undefined,
    summary: data.summary ? String(data.summary) : undefined,
    cover: data.cover ? String(data.cover) : undefined,
    kind: data.kind ? String(data.kind) : undefined,
    draft: data.draft !== false,
    indexPath,
    dayDates,
  };
}
