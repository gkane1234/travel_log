import fs from "node:fs";
import path from "node:path";
import type { APIRoute } from "astro";

export const prerender = false;

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".gpx": "application/gpx+xml",
};

export const GET: APIRoute = ({ params }) => {
  const raw = params.path;
  const urlPath = Array.isArray(raw) ? raw.join("/") : String(raw || "");
  const parts = decodeURIComponent(urlPath).split("/").filter(Boolean);
  if (parts.length < 3) return new Response("Not found", { status: 404 });
  const [slug, kind, ...rest] = parts;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return new Response("Not found", { status: 404 });
  }
  if (kind !== "photos" && kind !== "routes") {
    return new Response("Not found", { status: 404 });
  }
  if (rest.some((part) => part === ".." || part.includes("\0"))) {
    return new Response("Not found", { status: 404 });
  }

  const tripsRoot = path.resolve(process.cwd(), "trips");
  const root = path.resolve(tripsRoot, slug, kind);
  const file = path.resolve(root, ...rest);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return new Response("Not found", { status: 404 });
  }
  const ext = path.extname(file).toLowerCase();
  const data = fs.readFileSync(file);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
