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

const HEIC_BRAND = /heic|heix|hevc|hevx|heim|heis|mif1|msf1/;

function heicReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  const line = raw.split("\n")[0].trim();
  if (!line) return "It is not a HEIC photo.";
  return line.length > 180 ? `${line.slice(0, 177)}...` : line;
}

async function looksLikeHeic(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (head.length < 12) return false;
  const box = String.fromCharCode(...head.subarray(4, 8));
  if (box !== "ftyp") return false;
  const brand = String.fromCharCode(...head.subarray(8, 12)).toLowerCase();
  return HEIC_BRAND.test(brand);
}

async function jpegFromBitmap(bitmap: ImageBitmap): Promise<Blob> {
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not encode this photo as JPEG.");
      ctx.drawImage(bitmap, 0, 0);
      const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
      if (!out || out.size === 0) throw new Error("Could not encode this photo as JPEG.");
      return out;
    }
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not encode this photo as JPEG.");
    ctx.drawImage(bitmap, 0, 0);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("Could not encode this photo as JPEG."))),
        "image/jpeg",
        0.9,
      );
    });
  } finally {
    bitmap.close();
  }
}

/** Decode a HEIC photo with libheif, then encode a JPEG that has no EXIF. */
export async function convertHeicFile(file: Blob): Promise<Blob> {
  if (!(await looksLikeHeic(file))) {
    throw new Error("It is not a HEIC photo.");
  }
  const { heicTo } = await import("heic-to");
  let bitmap: ImageBitmap;
  try {
    bitmap = await heicTo({
      blob: file,
      type: "bitmap",
      options: { imageOrientation: "from-image" },
    });
  } catch (error) {
    throw new Error(heicReason(error));
  }
  if (!bitmap || bitmap.width < 1 || bitmap.height < 1) {
    bitmap?.close();
    throw new Error("It is not a HEIC photo.");
  }
  return jpegFromBitmap(bitmap);
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
    let jpeg: Blob;
    try {
      jpeg = await convertHeicFile(file);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "It is not a HEIC photo.";
      throw new Error(`Could not convert ${file.name}. ${reason}`);
    }
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
