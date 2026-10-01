import { AwsClient } from "aws4fetch";
import { isAllowedKey, isAllowedType, storageConfigError } from "./config.js";
import { checkLogin, loginPage, respondToMediaGet } from "./gate.js";

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
  const base = env.MEDIA_BASE_URL.replace(/\/$/, "");
  return {
    uploadUrl: signed.url,
    publicUrl: `${base}/${key}`,
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

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    const url = new URL(request.url);

    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (request.method === "GET" && (path === "/" || path === "/login")) {
      return loginPage();
    }

    if (request.method === "POST" && url.pathname === "/login") {
      let body;
      try {
        body = await readLoginBody(request);
      } catch {
        return json({ error: "Expected a login form." }, 400);
      }
      const result = await checkLogin(body, env);
      if (!result.ok) return json({ error: result.error }, result.status);
      const type = request.headers.get("Content-Type") || "";
      if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
        return new Response(null, {
          status: 303,
          headers: {
            Location: `${env.MEDIA_BASE_URL || "/"}`.replace(/\/$/, "/") || "/",
            "Set-Cookie": result.cookie,
          },
        });
      }
      return json({ ok: true }, 200, { "Set-Cookie": result.cookie });
    }

    if (request.method === "GET" && url.pathname.startsWith("/media/")) {
      const denied = await respondToMediaGet(request, env);
      if (denied) return denied;
      const configError = storageConfigError(env);
      if (configError) return json({ error: configError }, 503);
      const key = decodeURIComponent(url.pathname.slice(1));
      if (!isAllowedKey(key)) return json({ error: "Not found" }, 404);
      try {
        return await readPrivateObject(env, key);
      } catch {
        return json({ error: "Could not read that file." }, 502);
      }
    }

    if (request.method !== "POST" || url.pathname !== "/sign") {
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
