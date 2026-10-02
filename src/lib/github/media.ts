import {
  GIT_MAX_BYTES,
  gitTooLargeMessage,
  mapMarkdown,
  mediaObjectKey,
  routeRepoPath,
  sanitizeBasename,
  uniqueFilename,
} from "./commit-plan.ts";
import { reencodePhoto } from "./strip-photo.ts";

export type PreparedFile = {
  filename: string;
  markdown: string;
  bytes: Uint8Array;
  kind: "photo" | "video" | "route";
  repoPath?: string;
  objectKey?: string;
  contentType?: string;
};

const HEIC_ERROR =
  "Could not convert this HEIC photo in the browser. Export a JPEG and drop that instead.";

export async function convertHeicFile(file: Blob): Promise<Blob> {
  try {
    const mod = await import("heic2any");
    const heic2any = mod.default as (opts: {
      blob: Blob;
      toType: string;
      quality: number;
    }) => Promise<Blob | Blob[]>;
    const result = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    const blob = Array.isArray(result) ? result[0] : result;
    if (!blob || blob.size === 0) throw new Error("empty");
    return blob;
  } catch (error) {
    if (error instanceof Error && error.message === HEIC_ERROR) throw error;
    throw new Error(HEIC_ERROR);
  }
}

async function gpxFromZip(bytes: ArrayBuffer): Promise<{ name: string; data: Uint8Array }> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter(
    (name) => name.toLowerCase().endsWith(".gpx") && !zip.files[name].dir,
  );
  if (names.length === 0) throw new Error("No .gpx found inside that zip.");
  const name = names[0].split("/").pop() || "route.gpx";
  const data = await zip.files[names[0]].async("uint8array");
  return { name, data };
}

function extOf(name: string): string {
  const match = name.toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : "";
}

function contentTypeFor(ext: string): string {
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mp4" || ext === ".m4v") return "video/mp4";
  return "image/jpeg";
}

/** Name this file would be stored under, before a numeric suffix is added. */
export function plannedMediaFilename(filename: string): string {
  const ext = extOf(filename);
  const base = sanitizeBasename(filename);
  if (ext === ".heic" || ext === ".heif" || ext === ".jpg" || ext === ".jpeg" || ext === ".png" || ext === ".webp") {
    return `${base}.jpg`;
  }
  if (ext === ".gif") return `${base}.gif`;
  if (ext === ".mp4" || ext === ".m4v" || ext === ".webm" || ext === ".mov") return `${base}${ext}`;
  return "";
}

export async function prepareDroppedFile(
  file: File,
  slug: string,
  photos: Set<string>,
  routes: Set<string>,
): Promise<PreparedFile> {
  const ext = extOf(file.name);

  if (ext === ".gpx" || ext === ".zip") {
    let gpxName = file.name;
    let data: Uint8Array;
    if (ext === ".zip") {
      const extracted = await gpxFromZip(await file.arrayBuffer());
      gpxName = extracted.name;
      data = extracted.data;
    } else {
      data = new Uint8Array(await file.arrayBuffer());
    }
    if (data.byteLength > GIT_MAX_BYTES) throw new Error(gitTooLargeMessage(gpxName));
    const base = sanitizeBasename(gpxName);
    const filename = uniqueFilename(routes, base, ".gpx");
    const title = base.replace(/-/g, " ");
    return {
      filename,
      repoPath: routeRepoPath(slug, filename),
      markdown: mapMarkdown(slug, filename, title),
      bytes: data,
      kind: "route",
    };
  }

  if (ext === ".heic" || ext === ".heif") {
    const jpeg = await convertHeicFile(file);
    const clean = await reencodePhoto(jpeg);
    const base = sanitizeBasename(file.name);
    const filename = uniqueFilename(photos, base, ".jpg");
    return {
      filename,
      markdown: "",
      bytes: new Uint8Array(await clean.arrayBuffer()),
      kind: "photo",
      objectKey: mediaObjectKey(slug, filename),
      contentType: "image/jpeg",
    };
  }

  if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
    const clean = await reencodePhoto(file);
    const base = sanitizeBasename(file.name);
    const filename = uniqueFilename(photos, base, ".jpg");
    return {
      filename,
      markdown: "",
      bytes: new Uint8Array(await clean.arrayBuffer()),
      kind: "photo",
      objectKey: mediaObjectKey(slug, filename),
      contentType: "image/jpeg",
    };
  }

  if (ext === ".gif") {
    const outExt = ext === ".jpeg" ? ".jpg" : ext;
    const base = sanitizeBasename(file.name);
    const filename = uniqueFilename(photos, base, outExt);
    return {
      filename,
      markdown: "",
      bytes: new Uint8Array(await file.arrayBuffer()),
      kind: "photo",
      objectKey: mediaObjectKey(slug, filename),
      contentType: contentTypeFor(outExt),
    };
  }

  if ([".mp4", ".m4v", ".webm", ".mov"].includes(ext)) {
    const base = sanitizeBasename(file.name);
    const filename = uniqueFilename(photos, base, ext);
    return {
      filename,
      markdown: "",
      bytes: new Uint8Array(await file.arrayBuffer()),
      kind: "video",
      objectKey: mediaObjectKey(slug, filename),
      contentType: contentTypeFor(ext),
    };
  }

  throw new Error(`Unsupported file: ${file.name}`);
}
