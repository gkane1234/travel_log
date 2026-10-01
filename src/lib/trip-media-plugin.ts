import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

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

function safeResolve(tripsRoot: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath);
  const parts = decoded.split("/").filter(Boolean);
  if (parts.length < 3) return null;
  const [slug, kind, ...rest] = parts;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  if (kind !== "photos" && kind !== "routes") return null;
  if (rest.some((p) => p === ".." || p.includes("\\") || p.includes("\0"))) {
    return null;
  }
  const file = path.resolve(tripsRoot, slug, kind, ...rest);
  const root = path.resolve(tripsRoot, slug, kind);
  if (!file.startsWith(root + path.sep) && file !== root) return null;
  return file;
}

/** Serve trip photos and routes at /trip-media/<slug>/{photos,routes}/... in dev.
 * Production uses the trip-media route, which reads trips/ on each request. */
export function tripMediaPlugin(projectRoot: string): Plugin {
  const tripsRoot = path.join(projectRoot, "trips");

  return {
    name: "trip-media",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/trip-media/")) return next();
        const urlPath = req.url.slice("/trip-media/".length).split("?")[0];
        const file = safeResolve(tripsRoot, urlPath);
        if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        const ext = path.extname(file).toLowerCase();
        res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
        res.setHeader("Cache-Control", "no-cache");
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}
