/** Pure Git Data API payloads. No network, no token, no filesystem. */

export const GITHUB_MAX_BYTES = 90 * 1024 * 1024;

export type TreeEntry = {
  path: string;
  mode: "100644";
  type: "blob";
  sha: string;
};

export function buildTreeRequest(
  baseTreeSha: string,
  files: { path: string; sha: string }[],
): { base_tree: string; tree: TreeEntry[] } {
  return {
    base_tree: baseTreeSha,
    tree: files.map((file) => ({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: file.sha,
    })),
  };
}

export function buildCommitRequest(
  message: string,
  treeSha: string,
  parentSha: string,
): { message: string; tree: string; parents: string[] } {
  return {
    message,
    tree: treeSha,
    parents: [parentSha],
  };
}

export function dayRepoPath(slug: string, date: string): string {
  return `trips/${slug}/days/${date}.mdx`;
}

export function photoRepoPath(slug: string, filename: string): string {
  return `trips/${slug}/photos/${filename}`;
}

export function routeRepoPath(slug: string, filename: string): string {
  return `trips/${slug}/routes/${filename}`;
}

export function indexRepoPath(slug: string): string {
  return `trips/${slug}/index.md`;
}

export function imageMarkdown(slug: string, filename: string, alt: string): string {
  return `![${alt}](/trip-media/${slug}/photos/${filename})`;
}

export function videoMarkdown(slug: string, filename: string): string {
  return `<TripVideo src="/trip-media/${slug}/photos/${filename}" />`;
}

export function mapMarkdown(slug: string, filename: string, title: string): string {
  const safe = title.replace(/"/g, "");
  return `<TripMap src="/trip-media/${slug}/routes/${filename}" title="${safe}" />`;
}

export function saveDayMessage(title: string, date: string): string {
  return `Save ${oneLine(title)} notes for ${date}`;
}

export function createTripMessage(title: string, date: string): string {
  return `Create ${oneLine(title)} trip starting ${date}`;
}

export function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export type TripPaths = {
  slug: string;
  indexPath: string;
  days: string[];
};

/** Group a recursive git tree into trip folders. */
export function indexTrips(paths: string[]): TripPaths[] {
  const map = new Map<string, TripPaths>();
  for (const filePath of paths) {
    const index = filePath.match(/^trips\/([a-z0-9]+(?:-[a-z0-9]+)*)\/index\.mdx?$/);
    if (index) {
      const slug = index[1];
      const current = map.get(slug) ?? { slug, indexPath: filePath, days: [] };
      current.indexPath = filePath;
      map.set(slug, current);
      continue;
    }
    const day = filePath.match(
      /^trips\/([a-z0-9]+(?:-[a-z0-9]+)*)\/days\/(\d{4}-\d{2}-\d{2})\.mdx?$/,
    );
    if (day) {
      const slug = day[1];
      const current = map.get(slug) ?? {
        slug,
        indexPath: indexRepoPath(slug),
        days: [],
      };
      current.days.push(day[2]);
      map.set(slug, current);
    }
  }
  for (const trip of map.values()) trip.days.sort();
  return [...map.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

export function filenamesIn(paths: string[], slug: string, folder: "photos" | "routes"): Set<string> {
  const prefix = `trips/${slug}/${folder}/`;
  const names = new Set<string>();
  for (const filePath of paths) {
    if (!filePath.startsWith(prefix)) continue;
    const name = filePath.slice(prefix.length);
    if (name && !name.includes("/")) names.add(name);
  }
  return names;
}

export function sanitizeBasename(name: string): string {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "media"
  );
}

export function uniqueFilename(existing: Set<string>, base: string, ext: string): string {
  let name = `${base}${ext}`;
  let i = 2;
  while (existing.has(name)) {
    name = `${base}-${i}${ext}`;
    i += 1;
  }
  existing.add(name);
  return name;
}

export function uploadTooLargeMessage(name: string): string {
  return `${name} is too large for GitHub (limit is about 100 MB). Export a smaller MP4 or photo and try again.`;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
