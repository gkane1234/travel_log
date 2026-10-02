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
  return `${MEDIA_COOKIE}=${token}; HttpOnly; Secure; Path=/travel-log; SameSite=Lax; Max-Age=2592000`;
}

export function logoutSetCookie() {
  return `${MEDIA_COOKIE}=; HttpOnly; Secure; Path=/travel-log; SameSite=Lax; Max-Age=0`;
}

export function safeNext(value) {
  const next = String(value || "");
  if (!next.startsWith("/travel-log")) return "";
  if (next.startsWith("//") || next.includes("\\") || next.includes("://")) return "";
  if (next === "/travel-log/login" || next.startsWith("/travel-log/login?")) return "";
  return next;
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

const USERNAMES = new Set(["jumbo", "gumbo"]);

export async function checkLogin(body, env) {
  const password = String(env?.MEDIA_PASSWORD || "");
  if (!password) {
    return { ok: false, status: 503, error: "Media login is not configured (MEDIA_PASSWORD)." };
  }
  const username = String(body?.username || "").trim().toLowerCase();
  if (!USERNAMES.has(username)) {
    return { ok: false, status: 401, error: "Wrong username or password." };
  }
  const givenHash = await sha256Hex(String(body?.password || ""));
  const realHash = await sha256Hex(password);
  if (!safeEqual(givenHash, realHash)) {
    return { ok: false, status: 401, error: "Wrong username or password." };
  }
  return { ok: true, cookie: loginSetCookie(await sessionToken(password)) };
}

export function loginPage(next, error, postersHtml = "") {
  const safe = safeNext(next);
  const action = safe ? `/travel-log/login?next=${encodeURIComponent(safe)}` : "/travel-log/login";
  const message = error ? `<p class="error">${String(error).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>` : "";
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Gabe and Julia's Travel Log</title>
  <style>
    body { margin: 0; min-height: 100vh; background: #1c241e; color: #f3efe6; font-family: Georgia, "Times New Roman", serif; }
    .stage { position: fixed; inset: 0; overflow: hidden; pointer-events: none; }
    .poster { position: absolute; top: 0; left: 0; margin: 0; width: 220px; background: rgba(28, 36, 30, 0.55); border-radius: 8px; overflow: hidden; }
    .poster img { width: 100%; height: 140px; object-fit: cover; display: block; }
    .poster figcaption { padding: 0.45rem 0.6rem 0.6rem; font-family: "Segoe UI", sans-serif; font-size: 0.82rem; }
    .poster strong, .poster span { display: block; }
    .poster span { opacity: 0.85; }
    main { position: relative; z-index: 1; width: min(24rem, calc(100% - 2rem)); margin: 14vh auto; padding: 1.4rem 1.5rem 1.6rem; background: rgba(243, 239, 230, 0.94); color: #1c241e; border-radius: 10px; }
    h1 { font-weight: 600; letter-spacing: -0.02em; font-size: 1.7rem; }
    form { display: grid; gap: 0.75rem; }
    label { display: grid; gap: 0.25rem; font-family: "Segoe UI", sans-serif; font-size: 0.92rem; }
    input { font: inherit; padding: 0.45rem 0.55rem; }
    button { font: inherit; padding: 0.5rem 0.8rem; background: #2e4a3e; color: #f3efe6; border: 0; cursor: pointer; }
    .error { color: #8a2e24; }
  </style>
</head>
<body>
  ${postersHtml}
  <main>
    <h1>Gabe and Julia's Travel Log</h1>
    ${message}
    <form method="post" action="${action}">
      <label>Username <input name="username" autocomplete="username" required /></label>
      <label>Password <input name="password" type="password" autocomplete="current-password" required /></label>
      <button type="submit">Sign in</button>
    </form>
  </main>
</body>
</html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
