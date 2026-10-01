const PREFIX = "/travel-log";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseFrontmatter(raw) {
  const text = String(raw || "").replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) return { data: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: text };
  const data = {};
  for (const line of text.slice(3, end).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    data[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return { data, body: text.slice(end + 4).replace(/^\r?\n/, "") };
}

function mediaUrl(src) {
  const tripMedia = src.match(/^\/trip-media\/([^/]+)\/photos\/([^?#]+)/);
  if (tripMedia) return `${PREFIX}/media/${tripMedia[1]}/photos/${tripMedia[2]}`;
  return src;
}

function renderBody(raw) {
  let text = parseFrontmatter(raw).body;
  text = text.replace(/<TripVideo\s+src="([^"]+)"\s*\/?\s*>/g, (_, src) => {
    const href = escapeHtml(mediaUrl(src));
    return `<figure class="trip-video"><video controls playsinline preload="metadata" src="${href}"></video></figure>`;
  });
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
    const href = escapeHtml(mediaUrl(src.trim()));
    if (/\.mp4($|\?)/i.test(src)) {
      return `<figure class="trip-video"><video controls playsinline preload="metadata" src="${href}"></video></figure>`;
    }
    return `<img src="${href}" alt="${escapeHtml(alt)}" />`;
  });
  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return blocks
    .map((block) => {
      if (block.startsWith("<figure") || block.startsWith("<img")) return block;
      return `<p>${escapeHtml(block).replace(/\n/g, "<br />")}</p>`;
    })
    .join("\n");
}

function page(title, main) {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color: #1c241e; background: #f3efe6; font-family: Georgia, "Times New Roman", serif; }
    body { margin: 0; }
    a { color: #2e4a3e; }
    header, main { max-width: 42rem; margin: 0 auto; padding: 1.25rem; }
    header { display: flex; justify-content: space-between; align-items: baseline; }
    h1, h2 { font-weight: 600; letter-spacing: -0.02em; }
    .meta { color: #5c675f; font-family: "Segoe UI", sans-serif; font-size: 0.92rem; }
    img, video { max-width: 100%; height: auto; display: block; margin: 1rem 0; }
    .trip-list { list-style: none; padding: 0; }
    .trip-list a { display: block; padding: 0.8rem 0; border-top: 1px solid #cfc5b4; text-decoration: none; color: inherit; }
    .day { margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid #cfc5b4; }
  </style>
</head>
<body>
  <header>
    <a href="${PREFIX}/">Travel Log</a>
    <a href="${PREFIX}/author/">Author</a>
  </header>
  <main>${main}</main>
</body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } },
  );
}

async function listKeys(bucket, prefix) {
  const keys = [];
  let cursor;
  do {
    const listed = await bucket.list({ prefix, cursor });
    for (const object of listed.objects) keys.push(object.key);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return keys;
}

async function readText(bucket, key) {
  const object = await bucket.get(key);
  if (!object) return null;
  return object.text();
}

function formatRange(start, end) {
  const opts = { month: "short", day: "numeric", year: "numeric" };
  const from = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(from.getTime())) return start || "";
  const startText = from.toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
  if (!end || end === start) return startText;
  const to = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(to.getTime())) return startText;
  return `${startText} – ${to.toLocaleDateString("en-US", { ...opts, timeZone: "UTC" })}`;
}

export async function renderJournal(bucket, url) {
  if (!bucket) return null;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/trips/`)) return null;

  if (path === PREFIX) {
    const keys = await listKeys(bucket, "trips/");
    const indexes = keys.filter((key) => key.endsWith("/index.md"));
    const trips = [];
    for (const key of indexes) {
      const raw = await readText(bucket, key);
      if (!raw) continue;
      const { data } = parseFrontmatter(raw);
      if (String(data.draft) === "true") continue;
      const slug = key.split("/")[1];
      trips.push({
        slug,
        title: data.title || slug,
        location: data.location || "",
        date: data.date || "",
        endDate: data.endDate || "",
        summary: data.summary || "",
      });
    }
    trips.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (!trips.length) return null;
    const items = trips
      .map((trip) => {
        const when = formatRange(trip.date, trip.endDate);
        const where = [trip.location, when].filter(Boolean).join(" · ");
        return `<li><a href="${PREFIX}/trips/${encodeURIComponent(trip.slug)}/"><h2>${escapeHtml(trip.title)}</h2><p class="meta">${escapeHtml(where)}</p>${trip.summary ? `<p>${escapeHtml(trip.summary)}</p>` : ""}</a></li>`;
      })
      .join("");
    return page("Travel Log", `<h1>Travel Log</h1><p class="meta">Trips we've taken together.</p><ul class="trip-list">${items}</ul>`);
  }

  const slug = path.slice(`${PREFIX}/trips/`.length).split("/")[0];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  const indexRaw = await readText(bucket, `trips/${slug}/index.md`);
  if (!indexRaw) return null;
  const { data, body } = parseFrontmatter(indexRaw);
  const keys = await listKeys(bucket, `trips/${slug}/days/`);
  const days = [];
  for (const key of keys.filter((item) => /\.(md|mdx)$/.test(item)).sort()) {
    const raw = await readText(bucket, key);
    if (!raw) continue;
    const date = key.split("/").pop().replace(/\.(md|mdx)$/, "");
    days.push(`<section class="day"><h2>${escapeHtml(date)}</h2>${renderBody(raw)}</section>`);
  }
  const when = formatRange(data.date, data.endDate);
  const where = [data.location, when].filter(Boolean).join(" · ");
  return page(data.title || slug, `<p class="meta"><a href="${PREFIX}/">Trips</a></p><h1>${escapeHtml(data.title || slug)}</h1><p class="meta">${escapeHtml(where)}</p>${renderBody(body)}${days.join("")}`);
}
