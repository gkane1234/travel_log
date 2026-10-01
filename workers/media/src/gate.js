export const MEDIA_COOKIE = "travel_log_media";

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sessionToken(password) {
  return sha256Hex(`travel-log-media-v1:${password}`);
}

export function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return "";
}

export function loginSetCookie(token) {
  return `${MEDIA_COOKIE}=${token}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=2592000`;
}

export async function mediaGate(request, env) {
  const password = String(env?.MEDIA_PASSWORD || "");
  if (!password) {
    return { ok: false, status: 503, error: "Media login is not configured (MEDIA_PASSWORD)." };
  }
  const expected = await sessionToken(password);
  const got = readCookie(request, MEDIA_COOKIE);
  if (!got || !safeEqual(got, expected)) {
    return { ok: false, status: 401, error: "Sign in to view this photo." };
  }
  return { ok: true };
}

export async function respondToMediaGet(request, env) {
  const gate = await mediaGate(request, env);
  if (!gate.ok) {
    return new Response(JSON.stringify({ error: gate.error }), {
      status: gate.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
    });
  }
  return null;
}

export async function checkLogin(body, env) {
  const password = String(env?.MEDIA_PASSWORD || "");
  if (!password) {
    return { ok: false, status: 503, error: "Media login is not configured (MEDIA_PASSWORD)." };
  }
  const requiredUser = String(env?.MEDIA_USERNAME || "").trim();
  if (requiredUser && String(body?.username || "") !== requiredUser) {
    return { ok: false, status: 401, error: "Wrong username or password." };
  }
  const givenHash = await sha256Hex(String(body?.password || ""));
  const realHash = await sha256Hex(password);
  if (!safeEqual(givenHash, realHash)) {
    return { ok: false, status: 401, error: "Wrong username or password." };
  }
  return { ok: true, cookie: loginSetCookie(await sessionToken(password)) };
}

export function loginPage() {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Photo login</title>
</head>
<body>
  <h1>Photo login</h1>
  <p>Trip notes stay readable without this. Photos and videos need this sign-in.</p>
  <form method="post" action="/login">
    <label>Username <input name="username" autocomplete="username" /></label>
    <label>Password <input name="password" type="password" autocomplete="current-password" required /></label>
    <button type="submit">Sign in</button>
  </form>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
