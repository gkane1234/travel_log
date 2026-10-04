import { AwsClient } from "aws4fetch";
import { POSTER_MAX_BYTES, PUBLIC_PREFIX, isAllowedKey, isAllowedType, isPosterKey, mediaPublicUrl, storageConfigError } from "./config.js";
import { isTripCoverPath, renderJournal, setCoverFrontmatter, streamLoginPosters } from "./journal.js";
import { listTripGalleryKeys, listTripNoteKeys, putTripNotes, readTripNotes } from "./notes.js";
import { checkLogin, loginPage, logoutSetCookie, mediaGate, safeNext } from "./gate.js";

function json(body, status, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

function cors(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(response.body, { status: response.status, headers });
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bearer(request) {
  const header = request.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function authorize(request, env) {
  const token = bearer(request);
  if (!token) return { ok: false, error: "Missing upload token." };
  if (env.UPLOAD_TOKEN && safeEqual(token, env.UPLOAD_TOKEN)) return { ok: true };
  if (!env.GITHUB_REPOSITORY) {
    return { ok: false, error: "Media storage is not configured (GITHUB_REPOSITORY)." };
  }
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "travel-log-media",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (response.ok) return { ok: true };
  return { ok: false, error: "GitHub rejected that token for this repository." };
}

async function canEditNotes(request, env) {
  const session = await mediaGate(request, env);
  if (session.ok) return { ok: true };
  if (bearer(request)) {
    const auth = await authorize(request, env);
    if (auth.ok) return { ok: true };
    return { ok: false, status: 401, error: auth.error };
  }
  if (session.status === 503) return { ok: false, status: 503, error: session.error };
  return { ok: false, status: 401, error: "Sign in to edit the travel log." };
}

async function presign(env, key, contentType, contentLength) {
  const aws = new AwsClient({
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    service: "s3",
    region: (env.S3_REGION || "auto").trim(),
  });
  const endpoint = env.S3_ENDPOINT.replace(/\/$/, "");
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const url = `${endpoint}/${env.S3_BUCKET}/${encodedKey}`;
  const headers = { "content-type": contentType };
  if (contentLength) headers["content-length"] = String(contentLength);
  const signed = await aws.sign(
    new Request(url, { method: "PUT", headers }),
    { aws: { signQuery: true } },
  );
  const responseHeaders = { "content-type": contentType };
  if (contentLength) responseHeaders["content-length"] = String(contentLength);
  return {
    uploadUrl: signed.url,
    publicUrl: mediaPublicUrl(env.MEDIA_BASE_URL, key),
    headers: responseHeaders,
  };
}

async function readPrivateObject(env, key) {
  const aws = new AwsClient({
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    service: "s3",
    region: (env.S3_REGION || "auto").trim(),
  });
  const endpoint = env.S3_ENDPOINT.replace(/\/$/, "");
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const url = `${endpoint}/${env.S3_BUCKET}/${encodedKey}`;
  const signed = await aws.sign(url, { method: "GET" });
  const upstream = await fetch(signed);
  if (!upstream.ok) {
    return json({ error: "Not found" }, upstream.status === 404 ? 404 : 502);
  }
  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(upstream.body, { status: 200, headers });
}

async function readLoginBody(request) {
  const type = request.headers.get("Content-Type") || "";
  if (type.includes("application/json")) return request.json();
  const form = await request.formData();
  return { username: String(form.get("username") || ""), password: String(form.get("password") || "") };
}

function redirect(location) {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}

function requestPath(url) {
  return url.pathname.replace(/\/+$/, "") || "/";
}

function showLogin(env, next, error) {
  return loginPage(next, error);
}

function objectKeyFromPath(path) {
  const raw = path.slice(`${PUBLIC_PREFIX}/`.length);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function putMediaObject(request, env, url, path) {
  const auth = await canEditNotes(request, env);
  if (!auth.ok) return cors(json({ error: auth.error }, auth.status || 401));
  if (!env.TRIPS) return cors(json({ error: "Trip storage is not configured." }, 503));
  const key = objectKeyFromPath(path);
  const contentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const poster = isPosterKey(key);
  if (!poster && !isAllowedKey(key)) return cors(json({ error: "Invalid object key." }, 400));
  if (poster) {
    if (contentType !== "image/jpeg") return cors(json({ error: "Posters must be JPEG." }, 400));
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength < 1 || bytes.byteLength > POSTER_MAX_BYTES) {
      return cors(json({ error: "Poster is too large." }, 400));
    }
    await env.TRIPS.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
  } else {
    if (!isAllowedType(contentType)) return cors(json({ error: "Unsupported media type." }, 400));
    await env.TRIPS.put(key, request.body, { httpMetadata: { contentType } });
  }
  return cors(json({ ok: true, publicUrl: `${url.origin}${PUBLIC_PREFIX}/${key}` }, 200));
}

async function servePoster(env, key) {
  if (!isPosterKey(key) || !env.TRIPS) return json({ error: "Not found" }, 404);
  const object = await env.TRIPS.get(key);
  if (!object || (typeof object.size === "number" && object.size > POSTER_MAX_BYTES)) {
    return json({ error: "Not found" }, 404);
  }
  const headers = new Headers();
  headers.set("Content-Type", "image/jpeg");
  headers.set("Cache-Control", "public, max-age=3600");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { status: 200, headers });
}

function loginRedirect(url) {
  const next = `${url.pathname}${url.search}`;
  return redirect(`${PUBLIC_PREFIX}/login?next=${encodeURIComponent(next)}`);
}

function posterKeyForMedia(key) {
  const match = /^media\/([a-z0-9]+(?:-[a-z0-9]+)*)\/photos\/([a-z0-9][a-z0-9._-]{0,160})$/.exec(key);
  if (!match) return "";
  const base = match[2].replace(/\.[^.]+$/i, "");
  const poster = `posters/${match[1]}/${base}.jpg`;
  return isPosterKey(poster) ? poster : "";
}

function pagesTarget(env, pathname, search) {
  const repo = String(env.GITHUB_REPOSITORY || "gkane1234/travel_log");
  const [owner, name] = repo.split("/");
  let rest = pathname.slice(PUBLIC_PREFIX.length);
  if (!rest) rest = "/";
  return `https://${owner}.github.io/${name}${rest}${search}`;
}

function rewritePublished(body, origin, owner, repoName) {
  const pagesRoot = `https://${owner}.github.io/${repoName}/`;
  return body
    .replaceAll(pagesRoot, `${origin}${PUBLIC_PREFIX}/`)
    .replaceAll(`/${repoName}/`, `${PUBLIC_PREFIX}/`);
}

async function proxyTravelLog(request, env, url) {
  const [owner, repoName] = String(env.GITHUB_REPOSITORY || "gkane1234/travel_log").split("/");
  const upstream = await fetch(pagesTarget(env, url.pathname, url.search), {
    method: "GET",
    redirect: "follow",
    headers: { Accept: request.headers.get("Accept") || "*/*", "User-Agent": "travel-log-media" },
  });
  const type = upstream.headers.get("content-type") || "";
  const textLike = /text\/|javascript|json|xml|manifest/.test(type);
  if (!textLike) {
    const headers = new Headers(upstream.headers);
    headers.set("Cache-Control", "private, no-store");
    headers.delete("set-cookie");
    return new Response(upstream.body, { status: upstream.status, headers });
  }
  const body = rewritePublished(await upstream.text(), url.origin, owner, repoName || "travel_log");
  const headers = new Headers();
  headers.set("Content-Type", type);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(body, { status: upstream.status, headers });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    const url = new URL(request.url);
    const path = requestPath(url);

    if (request.method === "GET" && (path === "/" || path === "/login")) {
      return redirect(`${PUBLIC_PREFIX}/login`);
    }
    if (request.method === "GET" && url.pathname.startsWith("/media/")) {
      return redirect(`${PUBLIC_PREFIX}${url.pathname}${url.search}`);
    }
    if (request.method === "POST" && path === "/login") {
      return json({ error: `Sign in with POST ${PUBLIC_PREFIX}/login.` }, 404);
    }
    if (request.method === "POST" && path === "/sign") {
      return cors(json({ error: `Upload signing moved to POST ${PUBLIC_PREFIX}/sign.` }, 404));
    }
    if (request.method === "GET" && (path === "/travel_log" || path.startsWith("/travel_log/"))) {
      const next = `${PUBLIC_PREFIX}${path.slice("/travel_log".length)}${url.search}`;
      return redirect(next === PUBLIC_PREFIX ? `${PUBLIC_PREFIX}/login` : next);
    }
    if (request.method === "POST" && (path === "/travel_log/login" || path === "/travel_log/sign")) {
      const message = path.endsWith("/sign")
        ? `Upload signing moved to POST ${PUBLIC_PREFIX}/sign.`
        : `Sign in with POST ${PUBLIC_PREFIX}/login.`;
      return path.endsWith("/sign") ? cors(json({ error: message }, 404)) : json({ error: message }, 404);
    }

    const underLog = path === PUBLIC_PREFIX || path.startsWith(`${PUBLIC_PREFIX}/`);
    if (underLog && request.method === "DELETE" && path.startsWith(`${PUBLIC_PREFIX}/media/`)) {
      const auth = await canEditNotes(request, env);
      if (!auth.ok) return json({ error: auth.error }, auth.status || 401);
      let key = "";
      try {
        key = decodeURIComponent(path.slice(`${PUBLIC_PREFIX}/`.length));
      } catch {
        return json({ error: "Not found" }, 404);
      }
      if (!isAllowedKey(key) || !key.includes("/photos/")) return json({ error: "Not found" }, 404);
      if (!env.TRIPS) return json({ error: "Trip storage is not configured." }, 503);
      await env.TRIPS.delete(key);
      const poster = posterKeyForMedia(key);
      if (poster) await env.TRIPS.delete(poster);
      return json({ ok: true });
    }
    if (underLog && request.method === "GET" && path.startsWith(`${PUBLIC_PREFIX}/posters/`)) {
      const key = decodeURIComponent(path.slice(`${PUBLIC_PREFIX}/`.length));
      return servePoster(env, key);
    }
    if (underLog && request.method === "GET" && path === `${PUBLIC_PREFIX}/login-posters`) {
      if (!env.TRIPS) {
        return new Response("", {
          headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "private, no-store" },
        });
      }
      return streamLoginPosters(env.TRIPS);
    }
    if (underLog && request.method === "GET" && path !== `${PUBLIC_PREFIX}/sign`) {
      const session = await mediaGate(request, env);
      const destination = safeNext(url.searchParams.get("next")) || `${PUBLIC_PREFIX}/`;
      if (path === `${PUBLIC_PREFIX}/login`) {
        if (session.ok) return redirect(destination);
        return showLogin(env, url.searchParams.get("next"));
      }
      if (!session.ok) return loginRedirect(url);
      if (url.pathname.startsWith(`${PUBLIC_PREFIX}/media/`)) {
        const key = decodeURIComponent(url.pathname.slice(`${PUBLIC_PREFIX}/`.length));
        if (!isAllowedKey(key)) return json({ error: "Not found" }, 404);
        if (env.TRIPS) {
          const object = await env.TRIPS.get(key);
          if (!object) return json({ error: "Not found" }, 404);
          const headers = new Headers();
          headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
          headers.set("Cache-Control", "private, no-store");
          headers.set("X-Content-Type-Options", "nosniff");
          return new Response(object.body, { status: 200, headers });
        }
        const configError = storageConfigError(env);
        if (configError) return json({ error: configError }, 503);
        try {
          return await readPrivateObject(env, key);
        } catch {
          return json({ error: "Could not read that file." }, 502);
        }
      }
      if (env.TRIPS) {
        try {
          const journal = await renderJournal(env.TRIPS, url);
          if (journal) return journal;
        } catch {
          /* Fall back to the published site if the bucket read fails. */
        }
      }
      return proxyTravelLog(request, env, url);
    }

    if (request.method === "POST" && path === `${PUBLIC_PREFIX}/logout`) {
      return new Response(null, {
        status: 303,
        headers: {
          Location: `${PUBLIC_PREFIX}/login`,
          "Set-Cookie": logoutSetCookie(),
          "Cache-Control": "no-store",
        },
      });
    }

    if (request.method === "POST" && path === `${PUBLIC_PREFIX}/login`) {
      let body;
      try {
        body = await readLoginBody(request);
      } catch {
        return json({ error: "Expected a login form." }, 400);
      }
      const result = await checkLogin(body, env);
      if (!result.ok) return showLogin(env, url.searchParams.get("next"), result.error);
      const type = request.headers.get("Content-Type") || "";
      const destination = safeNext(url.searchParams.get("next")) || `${PUBLIC_PREFIX}/`;
      if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
        return new Response(null, {
          status: 303,
          headers: {
            Location: destination,
            "Set-Cookie": result.cookie,
          },
        });
      }
      return json({ ok: true }, 200, { "Set-Cookie": result.cookie });
    }

    if (request.method === "POST" && path === `${PUBLIC_PREFIX}/gallery/list`) {
      const allowed = await canEditNotes(request, env);
      if (!allowed.ok) return cors(json({ error: allowed.error }, allowed.status));
      if (!env.TRIPS) return cors(json({ error: "Trip storage is not configured." }, 503));
      let galleryBody;
      try {
        galleryBody = await request.json();
      } catch {
        return cors(json({ error: "Expected a JSON body." }, 400));
      }
      try {
        const keys = await listTripGalleryKeys(env.TRIPS, galleryBody.slug);
        return cors(json({ keys }, 200));
      } catch (error) {
        const status = Number(error.status) || 400;
        return cors(json({ error: error.message || "Could not list photos." }, status));
      }
    }

    if (
      request.method === "POST" &&
      (path === `${PUBLIC_PREFIX}/notes` ||
        path === `${PUBLIC_PREFIX}/notes/read` ||
        path === `${PUBLIC_PREFIX}/notes/list`)
    ) {
      const allowed = await canEditNotes(request, env);
      if (!allowed.ok) return cors(json({ error: allowed.error }, allowed.status));
      if (!env.TRIPS) return cors(json({ error: "Trip storage is not configured." }, 503));
      if (path.endsWith("/list")) {
        try {
          const keys = await listTripNoteKeys(env.TRIPS);
          return cors(json({ keys }, 200));
        } catch {
          return cors(json({ error: "Could not list trips." }, 502));
        }
      }
      let noteBody;
      try {
        noteBody = await request.json();
      } catch {
        return cors(json({ error: "Expected a JSON body." }, 400));
      }
      try {
        if (path.endsWith("/read")) {
          const files = await readTripNotes(env.TRIPS, noteBody.paths || []);
          return cors(json({ files }, 200));
        }
        const keys = await putTripNotes(env.TRIPS, noteBody.files || []);
        return cors(json({ ok: true, keys }, 200));
      } catch (error) {
        const status = Number(error.status) || 400;
        return cors(json({ error: error.message || "Could not save that note." }, status));
      }
    }

    if (request.method === "POST" && path === `${PUBLIC_PREFIX}/cover`) {
      const auth = await canEditNotes(request, env);
      if (!auth.ok) return cors(json({ error: auth.error }, auth.status || 401));
      let body;
      try {
        body = await request.json();
      } catch {
        return cors(json({ error: "Expected a JSON body." }, 400));
      }
      const slug = String(body.slug || "");
      const cover = String(body.cover || "");
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return cors(json({ error: "Invalid trip." }, 400));
      if (cover && !isTripCoverPath(slug, cover)) {
        return cors(json({ error: "Cover must be a photo already used in this trip." }, 400));
      }
      if (!env.TRIPS) return cors(json({ error: "Trip storage is not configured." }, 503));
      const object = await env.TRIPS.get(`trips/${slug}/index.md`);
      if (!object) return cors(json({ error: "Trip not found." }, 404));
      const next = setCoverFrontmatter(await object.text(), cover);
      await env.TRIPS.put(`trips/${slug}/index.md`, next, {
        httpMetadata: { contentType: "text/markdown; charset=utf-8" },
      });
      return cors(json({ ok: true, cover }, 200));
    }

    if (request.method === "PUT" && path.startsWith(`${PUBLIC_PREFIX}/`)) {
      return putMediaObject(request, env, url, path);
    }

    if (request.method !== "POST" || path !== `${PUBLIC_PREFIX}/sign`) {
      return cors(json({ error: "Not found" }, 404));
    }

    const configError = storageConfigError(env);
    if (configError) return cors(json({ error: configError }, 503));

    const auth = await canEditNotes(request, env);
    if (!auth.ok) return cors(json({ error: auth.error }, auth.status || 401));

    let body;
    try {
      body = await request.json();
    } catch {
      return cors(json({ error: "Expected a JSON body." }, 400));
    }
    const poster = isPosterKey(body.key);
    let posterBytes = 0;
    if (poster) {
      if (body.contentType !== "image/jpeg") {
        return cors(json({ error: "Posters must be JPEG." }, 400));
      }
      posterBytes = Number(body.contentLength);
      if (!Number.isInteger(posterBytes) || posterBytes < 1 || posterBytes > POSTER_MAX_BYTES) {
        return cors(json({ error: "Poster is too large." }, 400));
      }
    } else {
      if (!isAllowedType(body.contentType)) {
        return cors(json({ error: "Unsupported media type." }, 400));
      }
      if (!isAllowedKey(body.key)) {
        return cors(json({ error: "Invalid object key." }, 400));
      }
    }

    try {
      const signed = await presign(env, body.key, body.contentType, poster ? posterBytes : 0);
      return cors(json(signed, 200));
    } catch {
      return cors(json({ error: "Could not sign the upload. Check the S3 endpoint and keys." }, 502));
    }
  },
};
