import {
  authorConfigured,
  clearSessionCookie,
  createSessionToken,
  credentialsMatch,
  isRequestAuthed,
  sessionCookie,
} from "./auth";
import {
  createTrip,
  listDayDates,
  listTripSlugs,
  readDay,
  readTripMeta,
  saveGpx,
  saveMedia,
  writeDay,
  ensureDay,
} from "./author";
import { commitTripPaths } from "./git-backup";
import { addDays, clampDate, slugify } from "./trips";

function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { status, headers });
}

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ Location: location });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

export async function handleAuthorRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === "/api/author/login" && method === "POST") {
    return login(request);
  }
  if (path === "/api/author/logout" && method === "POST") {
    return redirect("/author/login", clearSessionCookie(request));
  }

  if (!authorConfigured()) {
    return json({ error: "Author mode is not configured" }, 403);
  }
  if (!isRequestAuthed(request)) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
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
      return json({ trips });
    }

    if (path === "/api/author/trips" && method === "POST") {
      const body = (await request.json()) as Record<string, string>;
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
      return json({ trip, warning: backup.warning }, 201);
    }

    const tripMatch = path.match(/^\/api\/author\/trips\/([^/]+)$/);
    if (tripMatch && method === "GET") {
      const slug = decodeURIComponent(tripMatch[1]);
      const trip = await readTripMeta(slug);
      const days = await listDayDates(slug);
      return json({ trip, days });
    }

    const dayMatch = path.match(/^\/api\/author\/trips\/([^/]+)\/days\/([^/]+)$/);
    if (dayMatch) {
      const slug = decodeURIComponent(dayMatch[1]);
      let date = decodeURIComponent(dayMatch[2]);
      const trip = await readTripMeta(slug);
      date = clampDate(date, trip.date, trip.endDate);

      if (method === "GET") {
        if (url.searchParams.get("ensure") === "1") await ensureDay(slug, date);
        const day = await readDay(slug, date);
        const prev = clampDate(addDays(date, -1), trip.date, trip.endDate);
        const next = clampDate(addDays(date, 1), trip.date, trip.endDate);
        return json({
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
        const body = (await request.json()) as { body?: string };
        await writeDay(slug, date, String(body.body ?? ""));
        const backup = await commitTripPaths(
          [`trips/${slug}/days`],
          `Save ${trip.title} notes for ${date}`,
        );
        return json({ ok: true, warning: backup.warning });
      }
    }

    const mediaMatch = path.match(/^\/api\/author\/trips\/([^/]+)\/media$/);
    if (mediaMatch && method === "POST") {
      const slug = decodeURIComponent(mediaMatch[1]);
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new Error("Missing file");
      const result = await saveMedia(slug, file.name, Buffer.from(await file.arrayBuffer()));
      const trip = await readTripMeta(slug);
      const kind = result.kind === "video" ? "video" : "photo";
      const backup = await commitTripPaths(
        [`trips/${slug}/photos/${result.filename}`],
        `Add ${kind} to ${trip.title}`,
      );
      return json({ ...result, warning: backup.warning });
    }

    const gpxMatch = path.match(/^\/api\/author\/trips\/([^/]+)\/gpx$/);
    if (gpxMatch && method === "POST") {
      const slug = decodeURIComponent(gpxMatch[1]);
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new Error("Missing file");
      const result = await saveGpx(slug, file.name, Buffer.from(await file.arrayBuffer()));
      const trip = await readTripMeta(slug);
      const backup = await commitTripPaths(
        [`trips/${slug}/routes/${result.filename}`],
        `Add route to ${trip.title}`,
      );
      return json({ ...result, warning: backup.warning });
    }

    return json({ error: "Not found" }, 404);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error";
    return json({ error: message }, 400);
  }
}

async function login(request: Request): Promise<Response> {
  if (!authorConfigured()) {
    return redirect("/author/login?error=config");
  }
  const form = await request.formData();
  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");
  if (!credentialsMatch(username, password)) {
    return redirect("/author/login?error=1");
  }
  const token = createSessionToken(username);
  return redirect("/author", sessionCookie(token, request));
}
