import { AwsClient } from "aws4fetch";
import { PUBLIC_PREFIX, isAllowedKey, isAllowedType, mediaPublicUrl, storageConfigError } from "./config.js";
import { renderJournal } from "./journal.js";
import { checkLogin, loginPage, mediaGate, safeNext } from "./gate.js";

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

async function presign(env, key, contentType) {
  const aws = new AwsClient({
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    service: "s3",
    region: (env.S3_REGION || "auto").trim(),
  });
  const endpoint = env.S3_ENDPOINT.replace(/\/$/, "");
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const url = `${endpoint}/${env.S3_BUCKET}/${encodedKey}`;
  const signed = await aws.sign(
    new Request(url, { method: "PUT", headers: { "content-type": contentType } }),
    { aws: { signQuery: true } },
  );
  return {
    uploadUrl: signed.url,
    publicUrl: mediaPublicUrl(env.MEDIA_BASE_URL, key),
    headers: { "content-type": contentType },
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

function loginRedirect(url) {
  const next = `${url.pathname}${url.search}`;
  return redirect(`${PUBLIC_PREFIX}/login?next=${encodeURIComponent(next)}`);
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
    if (underLog && request.method === "GET" && path !== `${PUBLIC_PREFIX}/sign`) {
      const session = await mediaGate(request, env);
      const destination = safeNext(url.searchParams.get("next")) || `${PUBLIC_PREFIX}/`;
      if (path === `${PUBLIC_PREFIX}/login`) {
        if (session.ok) return redirect(destination);
        return loginPage(url.searchParams.get("next"));
      }
      if (!session.ok) {
        if (session.status === 503) return json({ error: session.error }, 503);
        return loginRedirect(url);
      }
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

    if (request.method === "POST" && path === `${PUBLIC_PREFIX}/login`) {
      let body;
      try {
        body = await readLoginBody(request);
      } catch {
        return json({ error: "Expected a login form." }, 400);
      }
      const result = await checkLogin(body, env);
      if (!result.ok) return json({ error: result.error }, result.status);
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

    if (request.method !== "POST" || path !== `${PUBLIC_PREFIX}/sign`) {
      return cors(json({ error: "Not found" }, 404));
    }

    const configError = storageConfigError(env);
    if (configError) return cors(json({ error: configError }, 503));

    const auth = await authorize(request, env);
    if (!auth.ok) return cors(json({ error: auth.error }, 401));

    let body;
    try {
      body = await request.json();
    } catch {
      return cors(json({ error: "Expected a JSON body." }, 400));
    }
    if (!isAllowedType(body.contentType)) {
      return cors(json({ error: "Unsupported media type." }, 400));
    }
    if (!isAllowedKey(body.key)) {
      return cors(json({ error: "Invalid object key." }, 400));
    }

    try {
      const signed = await presign(env, body.key, body.contentType);
      return cors(json(signed, 200));
    } catch {
      return cors(json({ error: "Could not sign the upload. Check the S3 endpoint and keys." }, 502));
    }
  },
};
