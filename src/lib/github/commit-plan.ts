/** Pure Git Data API payloads. No network, no token, no filesystem. */

/** GitHub warns above 50 MB and rejects above 100 MB. Never commit a file over this. */
export const GIT_MAX_BYTES = 50 * 1024 * 1024;

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

export function imageMarkdownUrl(url: string, alt: string): string {
  assertPublicUrl(url);
  const safeAlt = alt.replace(/[\[\]]/g, "");
  return `![${safeAlt}](${url})`;
}

export function videoMarkdownUrl(url: string): string {
  assertPublicUrl(url);
  return `<TripVideo src="${url}" />`;
}

export function mediaObjectKey(slug: string, filename: string): string {
  return `media/${slug}/photos/${filename}`;
}

function isImageFilename(name: string): boolean {
  return /\.(jpe?g|png|gif|webp)$/i.test(name);
}

/** Site path stored in trip frontmatter. The journal rewrites this to the login-gated media URL. */
export function coverPathFromUrl(slug: string, url: string): string {
  const value = url.trim().split(/[?#]/)[0];
  const tripMedia = value.match(
    /\/trip-media\/([a-z0-9]+(?:-[a-z0-9]+)*)\/photos\/([a-z0-9][a-z0-9._-]{0,160})$/,
  );
  if (tripMedia && tripMedia[1] === slug && isImageFilename(tripMedia[2])) {
    return `/trip-media/${slug}/photos/${tripMedia[2]}`;
  }
  const media = value.match(
    /\/media\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(?:photos\/)?([a-z0-9][a-z0-9._-]{0,160})$/,
  );
  if (media && media[1] === slug && isImageFilename(media[2])) {
    return `/trip-media/${slug}/photos/${media[2]}`;
  }
  return "";
}

export function photoPathsInMarkdown(slug: string, markdown: string): string[] {
  const found: string[] = [];
  for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const path = coverPathFromUrl(slug, match[1]);
    if (path && !found.includes(path)) found.push(path);
  }
  return found;
}

function assertPublicUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Media URL must be an absolute http(s) address.");
  }
}

const MEDIA_IN_GIT = /(?:^|\/)photos\/|\.(?:jpe?g|png|gif|webp|heic|heif|mp4|mov|m4v|webm)$/i;

/** Refuse image and video blobs, and anything over 50 MB, before a git commit is built. */
export function assertGitCommitFiles(files: { path: string; bytes: Uint8Array }[]): void {
  for (const file of files) {
    const filePath = file.path.replace(/\\/g, "/");
    if (MEDIA_IN_GIT.test(filePath)) {
      throw new Error("Images and videos are stored in the bucket, not in git.");
    }
    if (file.bytes.byteLength > GIT_MAX_BYTES) {
      throw new Error(gitTooLargeMessage(filePath));
    }
  }
}

export function gitCommitPlan(files: { path: string; bytes: Uint8Array }[]): { path: string }[] {
  assertGitCommitFiles(files);
  return files.map((file) => ({ path: file.path.replace(/\\/g, "/") }));
}

/** Keep absolute media URLs intact and prefix only old /trip-media paths. */
export function applySiteBase(markdown: string, base = "/"): string {
  const prefix = base.endsWith("/") ? base.slice(0, -1) : base;
  if (!prefix) return markdown;
  return markdown
    .replaceAll("(/trip-media/", `(${prefix}/trip-media/`)
    .replaceAll('src="/trip-media/', `src="${prefix}/trip-media/`);
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

export function gitTooLargeMessage(name: string): string {
  return `${name} is over 50 MB, so it cannot be committed to GitHub.`;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
