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

export function loginPage(next, error) {
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
    .poster { position: absolute; top: 0; left: 0; margin: 0; width: 80px; opacity: 0.9; background: rgba(28, 36, 30, 0.55); border-radius: 6px; overflow: hidden; }
    .poster img { width: 100%; height: 53px; object-fit: cover; display: block; filter: none; }
    .poster figcaption { padding: 0.25rem 0.35rem 0.35rem; font-family: "Segoe UI", sans-serif; font-size: 0.68rem; }
    .poster strong, .poster span { display: block; }
    .poster span { opacity: 0.85; }
    main { position: relative; z-index: 1; width: min(24rem, calc(100% - 2rem)); margin: 14vh auto; padding: 1.4rem 1.5rem 1.6rem; background: rgba(243, 239, 230, 0.94); color: #1c241e; border-radius: 10px; }
    h1 { font-weight: 600; letter-spacing: -0.02em; font-size: 1.7rem; }
    main form { display: grid; gap: 0.75rem; }
    label { display: grid; gap: 0.25rem; font-family: "Segoe UI", sans-serif; font-size: 0.92rem; }
    input { font: inherit; padding: 0.45rem 0.55rem; }
    main button { font: inherit; padding: 0.5rem 0.8rem; background: #2e4a3e; color: #f3efe6; border: 0; cursor: pointer; }
    .error { color: #8a2e24; }
    #login-toggle { position: fixed; right: 0.8rem; bottom: 0.8rem; z-index: 6; font-family: "Segoe UI", sans-serif; font-size: 0.9rem; padding: 0.45rem 0.75rem; border: 0; border-radius: 999px; background: #2e4a3e; color: #f3efe6; cursor: pointer; }
    #login-panel { position: fixed; right: 0.8rem; bottom: 3.4rem; z-index: 6; width: min(18rem, calc(100% - 1.6rem)); padding: 0.7rem 0.8rem; background: rgba(28, 36, 30, 0.92); color: #f3efe6; font-family: "Segoe UI", sans-serif; font-size: 0.82rem; border-radius: 8px; }
    #login-panel[hidden] { display: none !important; }
    #login-form { display: grid; gap: 0.35rem; }
    #login-form label { display: grid; gap: 0.1rem; }
    #login-form input { font: inherit; width: 100%; }
  </style>
</head>
<body>
  <div class="stage" id="poster-stage"></div>
  <button type="button" id="login-toggle" aria-expanded="false" aria-controls="login-panel">Posters</button>
  <aside id="login-panel" hidden>
    <form id="login-form">
      <label>Drawn size (px)<input name="size" type="number" min="40" max="240" step="4" /></label>
      <label>Blur (px)<input name="blur" type="number" min="0" max="8" step="0.5" /></label>
      <label>Opacity<input name="opacity" type="number" min="0.05" max="1" step="0.05" /></label>
      <label>Speed<input name="speed" type="number" min="0" max="80" step="1" /></label>
      <label>Appear delay (seconds)<input name="appearDelay" type="number" min="0" max="8" step="0.1" /></label>
    </form>
  </aside>
  <main>
    <h1>Gabe and Julia's Travel Log</h1>
    ${message}
    <form method="post" action="${action}">
      <label>Username <input name="username" autocomplete="username" required /></label>
      <label>Password <input name="password" type="password" autocomplete="current-password" required /></label>
      <button type="submit">Sign in</button>
    </form>
  </main>
  <script>
(() => {
  const KEY = "travel-log-login";
  const defaults = { size: 80, blur: 0, opacity: 0.9, speed: 18, appearDelay: 2 };
  const stage = document.getElementById("poster-stage");
  const form = document.getElementById("login-form");
  const panel = document.getElementById("login-panel");
  const toggle = document.getElementById("login-toggle");
  const showPosters = false;
  if (!showPosters) {
    if (toggle) toggle.hidden = true;
    if (panel) panel.setAttribute("hidden", "");
    if (stage) stage.replaceChildren();
  }
  const settings = Object.assign({}, defaults, read());
  const LOADERS = 3;
  let active = 0;
  const waiting = [];
  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (error) { return {}; }
  }
  function applyLook() {
    const size = Math.max(40, Math.round(Number(settings.size) || defaults.size));
    const blur = Math.max(0, Number(settings.blur) || 0);
    const opacity = Number(settings.opacity);
    const speed = Math.max(0, Number(settings.speed) || 0);
    if (!stage) return;
    for (const card of stage.querySelectorAll(".poster")) {
      card.style.width = size + "px";
      card.style.opacity = Number.isFinite(opacity) ? String(opacity) : String(defaults.opacity);
      const img = card.querySelector("img");
      if (img) {
        img.style.height = Math.round(size * 0.66) + "px";
        img.style.filter = blur > 0 ? "blur(" + blur + "px)" : "none";
      }
      const angle = Number(card.dataset.angle) || 0;
      card.dataset.vx = String(Math.cos(angle) * speed);
      card.dataset.vy = String(Math.sin(angle) * speed);
    }
  }
  if (form) {
    for (const input of form.elements) {
      if (!input.name || !(input.name in settings)) continue;
      input.value = String(settings[input.name]);
      input.addEventListener("input", () => {
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        settings[input.name] = value;
        localStorage.setItem(KEY, JSON.stringify(settings));
        applyLook();
      });
    }
  }
  if (toggle && panel) {
    function setOpen(open) {
      if (open) panel.removeAttribute("hidden");
      else panel.setAttribute("hidden", "");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      setOpen(panel.hasAttribute("hidden"));
    });
    document.addEventListener("click", (event) => {
      if (panel.hasAttribute("hidden")) return;
      if (panel.contains(event.target) || event.target === toggle) return;
      setOpen(false);
    });
  }
  function posterUrl(value) {
    const url = String(value || "");
    if (url.indexOf("/travel-log/posters/") !== 0) return "";
    if (url.indexOf("/media/") !== -1) return "";
    return url;
  }
  function showCard(item, img) {
    if (!stage) return;
    const card = document.createElement("figure");
    card.className = "poster";
    const caption = document.createElement("figcaption");
    const title = document.createElement("strong");
    title.textContent = item.title || "";
    const when = document.createElement("span");
    const bits = [];
    if (item.location) bits.push(item.location);
    if (item.when) bits.push(item.when);
    when.textContent = bits.join(" · ");
    caption.append(title, when);
    card.append(img, caption);
    const size = Math.max(40, Math.round(Number(settings.size) || defaults.size));
    const angle = Math.random() * Math.PI * 2;
    card.dataset.angle = String(angle);
    card.dataset.x = String(Math.random() * Math.max(1, window.innerWidth - size));
    card.dataset.y = String(Math.random() * Math.max(1, window.innerHeight - size));
    stage.append(card);
    applyLook();
  }
  function pump() {
    while (active < LOADERS && waiting.length) {
      const item = waiting.shift();
      active += 1;
      const img = document.createElement("img");
      img.alt = "";
      img.decoding = "async";
      function skip() {
        active -= 1;
        pump();
      }
      img.addEventListener("error", skip);
      img.addEventListener("load", () => {
        img.decode().then(() => {
          if (!(img.naturalWidth > 0)) {
            skip();
            return;
          }
          const maxWait = Math.max(0, Number(settings.appearDelay) || 0);
          const wait = Math.random() * maxWait * 1000;
          window.setTimeout(() => {
            active -= 1;
            showCard(item, img);
            pump();
          }, wait);
        }).catch(skip);
      });
      img.src = item.url;
    }
  }
  function takeLine(item) {
    const url = posterUrl(item && item.url);
    if (!url) return;
    waiting.push({ title: item.title || "", location: item.location || "", when: item.when || "", url: url });
    pump();
  }
  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (stage) {
      for (const card of stage.querySelectorAll(".poster")) {
        let x = Number(card.dataset.x) + Number(card.dataset.vx) * dt;
        let y = Number(card.dataset.y) + Number(card.dataset.vy) * dt;
        const w = card.offsetWidth || 80;
        const h = card.offsetHeight || 80;
        if (x < -w) x = window.innerWidth;
        if (x > window.innerWidth) x = -w;
        if (y < -h) y = window.innerHeight;
        if (y > window.innerHeight) y = -h;
        card.dataset.x = String(x);
        card.dataset.y = String(y);
        card.style.transform = "translate(" + x + "px," + y + "px)";
      }
    }
    requestAnimationFrame(tick);
  }
  if (showPosters) {
  requestAnimationFrame(tick);
  fetch("/travel-log/login-posters", { credentials: "same-origin" }).then((response) => {
    if (!response.ok || !response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const nl = String.fromCharCode(10);
    function pull() {
      return reader.read().then((chunk) => {
        if (chunk.done) {
          const rest = buf.trim();
          if (rest) {
            try { takeLine(JSON.parse(rest)); } catch (error) { /* skip a bad line */ }
          }
          return;
        }
        buf += decoder.decode(chunk.value, { stream: true });
        let cut = buf.indexOf(nl);
        while (cut !== -1) {
          const line = buf.slice(0, cut).trim();
          buf = buf.slice(cut + 1);
          if (line) {
            try { takeLine(JSON.parse(line)); } catch (error) { /* skip a bad line */ }
          }
          cut = buf.indexOf(nl);
        }
        return pull();
      });
    }
    return pull();
  }).catch(() => {});
  }
})();
  </script>
</body>
</html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
