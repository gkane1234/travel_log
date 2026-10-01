import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import convert from "heic-convert";
import sharp from "sharp";
import JSZip from "jszip";
import ffmpegPath from "ffmpeg-static";
import { photoPathsInMarkdown } from "./github/commit-plan.ts";

function projectRoot(): string {
  const cwd = process.cwd();
  if (
    fsSync.existsSync(path.join(cwd, "trips")) &&
    fsSync.existsSync(path.join(cwd, "astro.config.mjs"))
  ) {
    return cwd;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

const root = projectRoot();

export function tripsRoot(): string {
  return path.join(root, "trips");
}

export function tripDir(slug: string): string {
  return path.join(tripsRoot(), slug);
}

export function assertSafeSlug(slug: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error("Invalid trip slug");
  }
}

export function assertSafeDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid date");
  }
}

export function authoringEnabled(): boolean {
  return import.meta.env.DEV === true;
}

export async function ensureTripFolders(slug: string): Promise<void> {
  const base = tripDir(slug);
  await fs.mkdir(path.join(base, "days"), { recursive: true });
  await fs.mkdir(path.join(base, "photos"), { recursive: true });
  await fs.mkdir(path.join(base, "routes"), { recursive: true });
}

export type TripMeta = {
  slug: string;
  title: string;
  date: string;
  endDate?: string;
  location?: string;
  summary?: string;
  cover?: string;
  draft: boolean;
};

function parseFrontmatter(raw: string): {
  data: Record<string, string | boolean>;
  body: string;
} {
  if (!raw.startsWith("---")) {
    return { data: {}, body: raw };
  }
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: raw };
  const block = raw.slice(4, end).trim();
  const body = raw.slice(end + 4).replace(/^\r?\n/, "");
  const data: Record<string, string | boolean> = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (val === "true") data[key] = true;
    else if (val === "false") data[key] = false;
    else {
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      data[key] = val;
    }
  }
  return { data, body };
}

function stringifyFrontmatter(
  data: Record<string, string | boolean | undefined>,
  body: string,
): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === "") continue;
    lines.push(`${k}: ${v}`);
  }
  lines.push("---", "");
  return lines.join("\n") + body.replace(/^\r?\n/, "");
}

export async function readTripMeta(slug: string): Promise<TripMeta> {
  assertSafeSlug(slug);
  const indexPath = path.join(tripDir(slug), "index.md");
  const indexMdx = path.join(tripDir(slug), "index.mdx");
  let raw: string;
  try {
    raw = await fs.readFile(indexPath, "utf8");
  } catch {
    raw = await fs.readFile(indexMdx, "utf8");
  }
  const { data } = parseFrontmatter(raw);
  return {
    slug,
    title: String(data.title ?? slug),
    date: String(data.date ?? ""),
    endDate: data.endDate ? String(data.endDate) : undefined,
    location: data.location ? String(data.location) : undefined,
    summary: data.summary ? String(data.summary) : undefined,
    cover: data.cover ? String(data.cover) : undefined,
    draft: data.draft !== false,
  };
}

/** First photo in the earliest day note, or the first image file in photos/. */
export async function firstTripPhoto(slug: string): Promise<string | undefined> {
  assertSafeSlug(slug);
  const dates = await listDayDates(slug);
  for (const date of dates) {
    const day = await readDay(slug, date);
    const found = photoPathsInMarkdown(slug, day.body)[0];
    if (found) return found;
  }
  try {
    const names = (await fs.readdir(path.join(tripDir(slug), "photos")))
      .filter((name) => /\.(jpe?g|png|gif|webp)$/i.test(name))
      .sort();
    if (names[0]) return `/trip-media/${slug}/photos/${names[0]}`;
  } catch {
    /* no photos folder */
  }
  return undefined;
}

export async function listTripSlugs(): Promise<string[]> {
  try {
    const entries = await fs.readdir(tripsRoot(), { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((n) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(n))
      .sort();
  } catch {
    return [];
  }
}

export async function createTrip(input: {
  title: string;
  slug: string;
  date: string;
  endDate?: string;
  location?: string;
  summary?: string;
}): Promise<TripMeta> {
  assertSafeSlug(input.slug);
  assertSafeDate(input.date);
  if (input.endDate) assertSafeDate(input.endDate);

  const base = tripDir(input.slug);
  try {
    await fs.access(base);
    throw new Error("Trip already exists");
  } catch (e) {
    if (e instanceof Error && e.message === "Trip already exists") throw e;
  }

  await ensureTripFolders(input.slug);

  const index = stringifyFrontmatter(
    {
      title: input.title,
      date: input.date,
      endDate: input.endDate,
      location: input.location,
      summary: input.summary,
      draft: true,
    },
    "",
  );
  await fs.writeFile(path.join(base, "index.md"), index, "utf8");

  await fs.writeFile(path.join(base, "days", `${input.date}.mdx`), "", "utf8");

  return {
    slug: input.slug,
    title: input.title,
    date: input.date,
    endDate: input.endDate,
    location: input.location,
    summary: input.summary,
    draft: true,
  };
}

export async function listDayDates(slug: string): Promise<string[]> {
  assertSafeSlug(slug);
  const dir = path.join(tripDir(slug), "days");
  try {
    const files = await fs.readdir(dir);
    return files
      .map((f) => f.replace(/\.(md|mdx)$/, ""))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();
  } catch {
    return [];
  }
}

async function dayFilePath(slug: string, date: string): Promise<string> {
  const dir = path.join(tripDir(slug), "days");
  const mdx = path.join(dir, `${date}.mdx`);
  const md = path.join(dir, `${date}.md`);
  try {
    await fs.access(mdx);
    return mdx;
  } catch {
    /* continue */
  }
  try {
    await fs.access(md);
    return md;
  } catch {
    return mdx;
  }
}

export async function readDay(
  slug: string,
  date: string,
): Promise<{ body: string; exists: boolean }> {
  assertSafeSlug(slug);
  assertSafeDate(date);
  const file = await dayFilePath(slug, date);
  try {
    const body = await fs.readFile(file, "utf8");
    return { body, exists: true };
  } catch {
    return { body: "", exists: false };
  }
}

export async function writeDay(
  slug: string,
  date: string,
  body: string,
): Promise<void> {
  assertSafeSlug(slug);
  assertSafeDate(date);
  await ensureTripFolders(slug);
  const dir = path.join(tripDir(slug), "days");
  const mdx = path.join(dir, `${date}.mdx`);
  const md = path.join(dir, `${date}.md`);
  try {
    await fs.access(md);
    await fs.unlink(md);
  } catch {
    /* no .md */
  }
  const tmp = path.join(dir, `.${date}.mdx.tmp`);
  await fs.writeFile(tmp, body, "utf8");
  await fs.rename(tmp, mdx);
}

export async function ensureDay(slug: string, date: string): Promise<void> {
  const { exists } = await readDay(slug, date);
  if (!exists) await writeDay(slug, date, "");
}

function sanitizeBasename(name: string): string {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "media"
  );
}

async function uniquePath(
  dir: string,
  base: string,
  ext: string,
): Promise<string> {
  let candidate = path.join(dir, `${base}${ext}`);
  let i = 2;
  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(dir, `${base}-${i}${ext}`);
      i += 1;
    } catch {
      return candidate;
    }
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error("ffmpeg-static binary missing"));
      return;
    }
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr?.on("data", (d) => {
      err += String(d);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.slice(-500) || `ffmpeg exited ${code}`));
    });
  });
}

export type MediaResult = {
  markdown: string;
  filename: string;
  kind: "image" | "video";
};

export async function saveMedia(
  slug: string,
  originalName: string,
  bytes: Buffer,
): Promise<MediaResult> {
  assertSafeSlug(slug);
  await ensureTripFolders(slug);
  const photosDir = path.join(tripDir(slug), "photos");
  const ext = path.extname(originalName).toLowerCase();
  const base = sanitizeBasename(originalName);

  if ([".heic", ".heif"].includes(ext)) {
    const converted = await convert({
      buffer: bytes,
      format: "JPEG",
      quality: 0.9,
    });
    const jpegBuf = Buffer.from(converted);
    const out = await uniquePath(photosDir, base, ".jpg");
    const optimized = await sharp(jpegBuf)
      .rotate()
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    await fs.writeFile(out, optimized);
    const filename = path.basename(out);
    return {
      kind: "image",
      filename,
      markdown: `![${base}](/trip-media/${slug}/photos/${filename})`,
    };
  }

  if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) {
    const outExt = ext === ".png" || ext === ".gif" ? ext : ".jpg";
    const out = await uniquePath(photosDir, base, outExt);
    let pipeline = sharp(bytes).rotate();
    if (outExt === ".jpg") pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true });
    else if (outExt === ".webp") pipeline = pipeline.webp({ quality: 85 });
    else if (outExt === ".png") pipeline = pipeline.png();
    await fs.writeFile(out, await pipeline.toBuffer());
    const filename = path.basename(out);
    return {
      kind: "image",
      filename,
      markdown: `![${base}](/trip-media/${slug}/photos/${filename})`,
    };
  }

  if ([".mov", ".mp4", ".m4v", ".webm"].includes(ext)) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "travel-log-"));
    const tmpIn = path.join(tmpDir, `input${ext}`);
    await fs.writeFile(tmpIn, bytes);
    const out = await uniquePath(photosDir, base, ".mp4");
    try {
      await runFfmpeg([
        "-y",
        "-i",
        tmpIn,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        out,
      ]);
    } catch {
      const fallbackExt = ext === ".mov" ? ".mov" : ext;
      const fallback = await uniquePath(photosDir, base, fallbackExt);
      await fs.copyFile(tmpIn, fallback);
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      const filename = path.basename(fallback);
      return {
        kind: "video",
        filename,
        markdown: `<TripVideo src="/trip-media/${slug}/photos/${filename}" />`,
      };
    }
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    const filename = path.basename(out);
    return {
      kind: "video",
      filename,
      markdown: `<TripVideo src="/trip-media/${slug}/photos/${filename}" />`,
    };
  }

  throw new Error(`Unsupported media type: ${ext || "unknown"}`);
}

export type GpxResult = {
  markdown: string;
  filename: string;
};

async function extractGpxFromZip(
  bytes: Buffer,
): Promise<{ name: string; data: Buffer }> {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter(
    (n) => n.toLowerCase().endsWith(".gpx") && !zip.files[n].dir,
  );
  if (names.length === 0) throw new Error("No .gpx found inside zip");
  const name = names[0];
  const data = Buffer.from(await zip.files[name].async("uint8array"));
  return { name: path.basename(name), data };
}

export async function saveGpx(
  slug: string,
  originalName: string,
  bytes: Buffer,
): Promise<GpxResult> {
  assertSafeSlug(slug);
  await ensureTripFolders(slug);
  const routesDir = path.join(tripDir(slug), "routes");
  const ext = path.extname(originalName).toLowerCase();

  let gpxName = originalName;
  let gpxBytes = bytes;

  if (ext === ".zip") {
    const extracted = await extractGpxFromZip(bytes);
    gpxName = extracted.name;
    gpxBytes = extracted.data;
  } else if (ext !== ".gpx") {
    throw new Error("Expected a .gpx or .zip file");
  }

  const base = sanitizeBasename(gpxName);
  const out = await uniquePath(routesDir, base, ".gpx");
  await fs.writeFile(out, gpxBytes);
  const filename = path.basename(out);
  const title = base.replace(/-/g, " ");
  return {
    filename,
    markdown: `<TripMap src="/trip-media/${slug}/routes/${filename}" title="${title}" />`,
  };
}
