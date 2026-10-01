import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import {
  createTrip,
  ensureDay,
  listDayDates,
  listTripSlugs,
  readDay,
  readTripMeta,
  saveGpx,
  saveMedia,
  writeDay,
} from "./author";
import { commitTripPaths } from "./git-backup";
import { addDays, clampDate, slugify } from "./trips";

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const buf = await readBody(req);
  if (!buf.length) return {};
  return JSON.parse(buf.toString("utf8"));
}

function send(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(body);
}

/** Parse multipart with a single file field named "file" (boundary form). */
function parseMultipart(
  buf: Buffer,
  contentType: string,
): { filename: string; data: Buffer } {
  const m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!m) throw new Error("Missing multipart boundary");
  const boundary = m[1] || m[2];
  const parts = buf.toString("binary").split(`--${boundary}`);
  for (const part of parts) {
    if (!part.includes("Content-Disposition")) continue;
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const headers = part.slice(0, headerEnd);
    if (!/name="file"/i.test(headers)) continue;
    const nameMatch = headers.match(/filename="([^"]+)"/i);
    const filename = nameMatch?.[1] || "upload.bin";
    let body = part.slice(headerEnd + 4);
    if (body.endsWith("\r\n")) body = body.slice(0, -2);
    return { filename, data: Buffer.from(body, "binary") };
  }
  throw new Error("Missing file");
}

export function authorApiPlugin(): Plugin {
  return {
    name: "author-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/author")) return next();

        try {
          const url = new URL(req.url, "http://localhost");
          const path = url.pathname;
          const method = (req.method || "GET").toUpperCase();

          if (path === "/api/author/trips" && method === "GET") {
            const slugs = await listTripSlugs();
            const trips = [];
            for (const slug of slugs) {
              try {
                trips.push(await readTripMeta(slug));
              } catch {
                /* skip */
              }
            }
            trips.sort((a, b) => b.date.localeCompare(a.date));
            return send(res, 200, { trips });
          }

          if (path === "/api/author/trips" && method === "POST") {
            const body = (await readJson(req)) as Record<string, string>;
            const title = String(body.title ?? "").trim();
            if (!title) throw new Error("Title is required");
            const slug = String(body.slug ?? slugify(title)).trim();
            const date = String(body.date ?? "").trim();
            if (!date) throw new Error("Start date is required");
            const endDate = body.endDate ? String(body.endDate).trim() : undefined;
            const trip = await createTrip({
              title,
              slug,
              date,
              endDate: endDate || undefined,
              location: body.location?.trim() || undefined,
              summary: body.summary?.trim() || undefined,
            });
            const backup = await commitTripPaths(
              [`trips/${slug}`],
              `Create ${title} trip starting ${date}`,
            );
            return send(res, 201, { trip, warning: backup.warning });
          }

          const tripMatch = path.match(/^\/api\/author\/trips\/([^/]+)$/);
          if (tripMatch && method === "GET") {
            const slug = decodeURIComponent(tripMatch[1]);
            const trip = await readTripMeta(slug);
            const days = await listDayDates(slug);
            return send(res, 200, { trip, days });
          }

          const dayMatch = path.match(
            /^\/api\/author\/trips\/([^/]+)\/days\/([^/]+)$/,
          );
          if (dayMatch) {
            const slug = decodeURIComponent(dayMatch[1]);
            let date = decodeURIComponent(dayMatch[2]);
            const trip = await readTripMeta(slug);
            date = clampDate(date, trip.date, trip.endDate);

            if (method === "GET") {
              if (url.searchParams.get("ensure") === "1") {
                await ensureDay(slug, date);
              }
              const day = await readDay(slug, date);
              const prev = clampDate(addDays(date, -1), trip.date, trip.endDate);
              const next = clampDate(addDays(date, 1), trip.date, trip.endDate);
              return send(res, 200, {
                trip,
                date,
                body: day.body,
                exists: day.exists,
                prev: prev !== date ? prev : null,
                next: next !== date ? next : null,
                canPrev: prev !== date,
                canNext: next !== date,
              });
            }

            if (method === "PUT") {
              const body = (await readJson(req)) as { body?: string };
              await writeDay(slug, date, String(body.body ?? ""));
              const backup = await commitTripPaths(
                [`trips/${slug}/days`],
                `Save ${trip.title} notes for ${date}`,
              );
              return send(res, 200, { ok: true, warning: backup.warning });
            }
          }

          const mediaMatch = path.match(
            /^\/api\/author\/trips\/([^/]+)\/media$/,
          );
          if (mediaMatch && method === "POST") {
            const slug = decodeURIComponent(mediaMatch[1]);
            const ct = String(req.headers["content-type"] || "");
            const buf = await readBody(req);
            const file = parseMultipart(buf, ct);
            const result = await saveMedia(slug, file.filename, file.data);
            const trip = await readTripMeta(slug);
            const kind = result.kind === "video" ? "video" : "photo";
            const backup = await commitTripPaths(
              [`trips/${slug}/photos/${result.filename}`],
              `Add ${kind} to ${trip.title}`,
            );
            return send(res, 200, { ...result, warning: backup.warning });
          }

          const gpxMatch = path.match(/^\/api\/author\/trips\/([^/]+)\/gpx$/);
          if (gpxMatch && method === "POST") {
            const slug = decodeURIComponent(gpxMatch[1]);
            const ct = String(req.headers["content-type"] || "");
            const buf = await readBody(req);
            const file = parseMultipart(buf, ct);
            const result = await saveGpx(slug, file.filename, file.data);
            const trip = await readTripMeta(slug);
            const backup = await commitTripPaths(
              [`trips/${slug}/routes/${result.filename}`],
              `Add route to ${trip.title}`,
            );
            return send(res, 200, { ...result, warning: backup.warning });
          }

          return send(res, 404, { error: "Not found" });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Error";
          return send(res, 400, { error: message });
        }
      });
    },
  };
}
