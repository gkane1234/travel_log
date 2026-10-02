import { isPosterKey } from "./config.js";
import { motionMarkup } from "./motion.js";

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

function isImageFile(name) {
  return /\.(jpe?g|png|gif|webp)$/i.test(name);
}

/** Login-gated photo URL. Empty when the value is not a trip photo. */
export function gatedPhotoUrl(src) {
  const value = String(src || "").trim().split(/[?#]/)[0];
  const tripMedia = value.match(/\/trip-media\/([a-z0-9]+(?:-[a-z0-9]+)*)\/photos\/([a-z0-9][a-z0-9._-]{0,160})$/);
  if (tripMedia && isImageFile(tripMedia[2])) {
    return `${PREFIX}/media/${tripMedia[1]}/photos/${tripMedia[2]}`;
  }
  const direct = value.match(/\/travel-log\/(media\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:photos\/)?[a-z0-9][a-z0-9._-]{0,160})$/);
  if (direct && isImageFile(direct[1])) return `${PREFIX}/${direct[1]}`;
  return "";
}

export function isTripCoverPath(slug, cover) {
  return gatedPhotoUrl(cover) === `${PREFIX}/media/${slug}/photos/${String(cover).split("/").pop()}`;
}

export function setCoverFrontmatter(raw, cover) {
  const text = String(raw || "").replace(/^\uFEFF/, "");
  const coverLine = cover ? `cover: ${cover}` : "";
  if (!text.startsWith("---")) {
    return coverLine ? `---\n${coverLine}\n---\n\n${text}` : text;
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) return text;
  const lines = text.slice(4, end).split(/\r?\n/).filter((line) => !/^cover\s*:/.test(line));
  if (coverLine) lines.push(coverLine);
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const body = text.slice(end + 4);
  const sep = body.startsWith("\n") || body === "" ? "" : "\n";
  return `---\n${lines.join("\n")}\n---${sep}${body}`;
}

function firstPhotoInMarkdown(raw) {
  const body = parseFrontmatter(raw).body;
  for (const match of body.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const href = gatedPhotoUrl(match[1]);
    if (href) return href;
  }
  return "";
}

function noteMediaButton(kind, href, inner) {
  const safe = escapeHtml(href);
  return `<button type="button" class="note-media" data-kind="${kind}" data-src="${safe}">${inner}</button>`;
}

function renderBody(raw) {
  let text = parseFrontmatter(raw).body;
  text = text.replace(/<TripVideo\s+src="([^"]+)"\s*\/?\s*>/g, (_, src) => {
    const href = mediaUrl(src);
    const safe = escapeHtml(href);
    return noteMediaButton("video", href, `<video muted playsinline preload="metadata" src="${safe}"></video>`);
  });
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
    const href = mediaUrl(src.trim());
    const safe = escapeHtml(href);
    if (/\.(mp4|m4v|webm|mov)($|\?)/i.test(src)) {
      return noteMediaButton("video", href, `<video muted playsinline preload="metadata" src="${safe}"></video>`);
    }
    return noteMediaButton("photo", href, `<img src="${safe}" alt="${escapeHtml(alt)}" />`);
  });
  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return blocks
    .map((block) => {
      if (block.startsWith("<button") || block.startsWith("<figure") || block.startsWith("<img")) return block;
      return `<p>${escapeHtml(block).replace(/\n/g, "<br />")}</p>`;
    })
    .join("\n");
}

function page(title, main, motion) {
  const motionHtml = motion ? motionMarkup(motion) : null;
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color: #f3efe6; background: #1c241e; font-family: Georgia, "Times New Roman", serif; }
    body { margin: 0; background: #1c241e; }
    header a, .header-actions button { color: #f3efe6; }
    #motion-names, #motion-layer { position: fixed; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }
    .name-card { position: absolute; top: 0; left: 0; display: flex; gap: 0.55rem; align-items: center; width: max-content; max-width: 16rem; padding: 0.35rem 0.7rem 0.35rem 0.35rem; background: rgba(243, 239, 230, 0.72); border-radius: 999px; font-family: "Segoe UI", sans-serif; font-size: 0.92rem; }
    .name-card img { width: 3.2rem; height: 2.4rem; object-fit: cover; border-radius: 999px; margin: 0; }
    .name-card span { display: grid; line-height: 1.2; }
    .name-card em { font-style: normal; font-size: 0.75rem; opacity: 0.8; }
    .float-photo { position: absolute; height: auto; margin: 0; border-radius: 8px; box-shadow: 0 8px 24px rgba(28, 36, 30, 0.18); }
    .photo-card { position: absolute; top: 0; left: 0; margin: 0; background: rgba(28, 36, 30, 0.72); color: #f3efe6; border-radius: 6px; overflow: hidden; }
    .photo-card img { display: block; width: 100%; margin: 0; object-fit: cover; }
    .photo-card figcaption { padding: 0.25rem 0.35rem 0.35rem; font-family: "Segoe UI", sans-serif; font-size: 0.68rem; }
    .photo-card strong, .photo-card span { display: block; }
    #motion-toggle { position: fixed; right: 0.8rem; bottom: 0.8rem; z-index: 6; font-family: "Segoe UI", sans-serif; font-size: 0.9rem; padding: 0.45rem 0.75rem; border: 0; border-radius: 999px; background: #2e4a3e; color: #f3efe6; cursor: pointer; }
    #motion-debug { position: fixed; right: 0.8rem; bottom: 3.4rem; z-index: 6; width: min(18rem, calc(100% - 1.6rem)); padding: 0.7rem 0.8rem; background: rgba(28, 36, 30, 0.92); color: #f3efe6; font-family: "Segoe UI", sans-serif; font-size: 0.82rem; border-radius: 8px; }
    #motion-debug[hidden] { display: none !important; }
    #motion-form { display: grid; gap: 0.35rem; }
    #motion-form label { display: grid; gap: 0.1rem; }
    #motion-form input, #motion-form select { font: inherit; width: 100%; }
    #motion-debug .debug-note { margin: 0.45rem 0 0; opacity: 0.8; }
    #recent-photos { list-style: disc; margin: 0.45rem 0 0; padding-left: 1.1rem; max-height: 7.5rem; overflow: auto; }
    #recent-photos:empty { display: none; }
    #recent-photos li { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    header, main { position: relative; z-index: 1; max-width: 42rem; margin: 0 auto; padding: 1.25rem; }
    main { background: #f3efe6; color: #1c241e; }
    main a { color: #2e4a3e; }
    main:has(#log-panel) { background: transparent; color: #f3efe6; }
    #log-panel { color: #1c241e; }
    .log-menu { position: relative; display: inline-block; }
    #log-toggle { font-family: "Segoe UI", sans-serif; font-size: 1rem; padding: 0.45rem 0.8rem; border: 1px solid #2e4a3e; border-radius: 999px; background: rgba(243, 239, 230, 0.92); color: #1c241e; cursor: pointer; }
    #log-panel { position: absolute; top: calc(100% + 0.45rem); left: 0; width: min(36rem, calc(100vw - 2.5rem)); max-height: min(70vh, 34rem); overflow: auto; padding: 0.4rem 1rem 1rem; background: rgba(243, 239, 230, 0.94); border-radius: 10px; box-shadow: 0 10px 28px rgba(28, 36, 30, 0.16); }
    #log-panel[hidden] { display: none !important; }
    header { display: flex; justify-content: space-between; align-items: baseline; }
    .header-actions { display: flex; align-items: center; gap: 0.85rem; }
    .header-actions form { margin: 0; }
    .header-actions button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; }
    h1, h2 { font-weight: 600; letter-spacing: -0.02em; }
    .meta { color: #5c675f; font-family: "Segoe UI", sans-serif; font-size: 0.92rem; }
    img, video { max-width: 100%; height: auto; display: block; margin: 1rem 0; }
    img.thumb { width: 7.5rem; height: 5.6rem; object-fit: cover; margin: 0; flex: none; }
    img.cover { width: 100%; max-height: 22rem; object-fit: cover; margin: 0.4rem 0 1rem; }
    .trip-list { list-style: none; padding: 0; }
    .trip-list a { display: flex; gap: 0.9rem; align-items: center; padding: 0.8rem 0; border-top: 1px solid #cfc5b4; text-decoration: none; color: inherit; }
    .trip-list h2, .trip-list p { margin: 0.15rem 0; }
    .day { margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid #cfc5b4; }
    .gallery { margin: 0.4rem 0 1.4rem; }
    .gallery-bar { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
    .gallery h2 { font-size: 1.05rem; margin: 0.6rem 0; }
    .gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr)); gap: 0.45rem; }
    .gallery-item, .note-media { cursor: zoom-in; }
    .gallery-item { display: block; width: 100%; margin: 0; padding: 0; border: 0; background: #e4ddd0; aspect-ratio: 4 / 3; overflow: hidden; }
    .gallery-item img, .gallery-item video { width: 100%; height: 100%; object-fit: cover; margin: 0; pointer-events: none; }
    button.note-media { display: block; width: 100%; margin: 1rem 0; padding: 0; border: 0; background: transparent; text-align: left; }
    button.note-media img, button.note-media video { margin: 0; width: 100%; pointer-events: none; }
    a.edit-trip { font-family: "Segoe UI", sans-serif; font-size: 0.9rem; text-decoration: none; border: 1px solid #2e4a3e; color: #2e4a3e; background: transparent; padding: 0.3rem 0.65rem; cursor: pointer; }
    #lightbox { position: fixed; inset: 0; z-index: 6; display: grid; place-items: center; background: rgba(28, 36, 30, 0.9); }
    #lightbox[hidden] { display: none; }
    #lightbox img, #lightbox video { max-width: min(92vw, 64rem); max-height: 86vh; margin: 0; }
    #lightbox-close { position: absolute; top: 0.8rem; right: 0.8rem; font: inherit; padding: 0.35rem 0.7rem; background: #f3efe6; color: #1c241e; border: 0; cursor: pointer; }
  </style>
</head>
<body>
  ${motionHtml ? motionHtml.chrome : ""}
  <header>
    <a href="${PREFIX}/">Travel Log</a>
    <nav class="header-actions">
      <a href="${PREFIX}/author/">Author</a>
      <form method="post" action="${PREFIX}/logout"><button type="submit">Log out</button></form>
    </nav>
  </header>
  <main>${main}</main>
  ${motionHtml ? motionHtml.script : ""}
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

async function tripThumbnail(bucket, slug, data) {
  const fromCover = gatedPhotoUrl(data.cover || "");
  if (fromCover) return fromCover;
  const dayKeys = (await listKeys(bucket, `trips/${slug}/days/`)).filter((key) => /\.(md|mdx)$/.test(key)).sort();
  for (const key of dayKeys) {
    const raw = await readText(bucket, key);
    if (!raw) continue;
    const found = firstPhotoInMarkdown(raw);
    if (found) return found;
  }
  const mediaKeys = (await listKeys(bucket, `media/${slug}/`))
    .filter((key) => isImageFile(key))
    .sort();
  return mediaKeys[0] ? `${PREFIX}/${mediaKeys[0]}` : "";
}

function photosInMarkdown(raw) {
  const urls = [];
  const body = parseFrontmatter(raw).body;
  for (const match of body.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const href = gatedPhotoUrl(match[1]);
    if (href && !urls.includes(href)) urls.push(href);
  }
  return urls;
}

const MOTION_PHOTO_CAP = 240;

function rememberPhoto(list, href) {
  if (href && !list.includes(href)) list.push(href);
}

async function motionPhotosForTrip(bucket, slug) {
  const found = [];
  const dayKeys = (await listKeys(bucket, `trips/${slug}/days/`)).filter((item) => /\.(md|mdx)$/.test(item)).sort();
  for (const dayKey of dayKeys) {
    const day = await readText(bucket, dayKey);
    if (!day) continue;
    for (const href of photosInMarkdown(day)) rememberPhoto(found, href);
  }
  const keys = (await listKeys(bucket, `media/${slug}/photos/`)).filter((key) => isImageFile(key)).sort();
  for (const key of keys) rememberPhoto(found, `${PREFIX}/${key}`);
  return found;
}

function interleavePhotos(groups) {
  const photos = [];
  let index = 0;
  while (photos.length < MOTION_PHOTO_CAP) {
    let added = false;
    for (const group of groups) {
      const href = group[index];
      if (!href) continue;
      rememberPhoto(photos, href);
      added = true;
      if (photos.length >= MOTION_PHOTO_CAP) break;
    }
    if (!added) break;
    index += 1;
  }
  return photos;
}

async function tripCatalog(bucket) {
  const keys = await listKeys(bucket, "trips/");
  const trips = [];
  const groups = [];
  for (const key of keys.filter((item) => item.endsWith("/index.md"))) {
    const raw = await readText(bucket, key);
    if (!raw) continue;
    const { data } = parseFrontmatter(raw);
    if (String(data.draft) === "true") continue;
    const slug = key.split("/")[1];
    groups.push(await motionPhotosForTrip(bucket, slug));
    trips.push({
      title: data.title || slug,
      location: data.location || "",
      when: formatRange(data.date || "", data.endDate || ""),
      thumb: await tripThumbnail(bucket, slug, data),
      slug,
    });
  }
  return { trips, photos: interleavePhotos(groups) };
}

export async function publicTripCards(bucket) {
  const { trips } = await tripCatalog(bucket);
  const cards = [];
  for (const trip of trips) {
    const posterKeys = (await listKeys(bucket, `posters/${trip.slug}/`)).filter((key) => isPosterKey(key)).slice(0, 16);
    cards.push({
      title: trip.title,
      location: trip.location,
      when: trip.when,
      posters: posterKeys.map((key) => `${PREFIX}/${key}`),
    });
  }
  return cards;
}

function motionModel(catalog) {
  return {
    trips: catalog.trips.map((trip) => ({ title: trip.title, when: trip.when, thumb: trip.thumb || "" })),
    photos: catalog.photos,
  };
}

const GALLERY_FILE = /\.(jpe?g|png|gif|webp|mp4|m4v|webm|mov)$/i;
const VIDEO_FILE = /\.(mp4|m4v|webm|mov)$/i;

function galleryItemFromSrc(src) {
  const value = String(src || "").trim().split(/[?#]/)[0];
  const tripMedia = value.match(/\/trip-media\/([a-z0-9]+(?:-[a-z0-9]+)*)\/photos\/([a-z0-9][a-z0-9._-]{0,160})$/);
  const direct = value.match(/\/media\/([a-z0-9]+(?:-[a-z0-9]+)*)\/photos\/([a-z0-9][a-z0-9._-]{0,160})$/);
  const slug = tripMedia?.[1] || direct?.[1] || "";
  const filename = tripMedia?.[2] || direct?.[2] || "";
  if (!slug || !filename || !GALLERY_FILE.test(filename)) return null;
  return {
    url: `${PREFIX}/media/${slug}/photos/${filename}`,
    kind: VIDEO_FILE.test(filename) ? "video" : "photo",
  };
}

function mediaInMarkdown(raw) {
  const body = parseFrontmatter(raw).body;
  const items = [];
  for (const match of body.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const item = galleryItemFromSrc(match[1]);
    if (item) items.push(item);
  }
  for (const match of body.matchAll(/<TripVideo\s+src="([^"]+)"\s*\/?\s*>/g)) {
    const item = galleryItemFromSrc(match[1]);
    if (item) items.push(item);
  }
  return items;
}

async function tripGallery(bucket, slug, notes) {
  const items = [];
  const seen = new Set();
  const add = (item) => {
    if (!item || seen.has(item.url)) return;
    seen.add(item.url);
    items.push(item);
  };
  for (const raw of notes) {
    for (const item of mediaInMarkdown(raw)) add(item);
  }
  const keys = (await listKeys(bucket, `media/${slug}/photos/`)).filter((key) => GALLERY_FILE.test(key)).sort();
  for (const key of keys) {
    const filename = key.split("/").pop();
    add({
      url: `${PREFIX}/${key}`,
      kind: VIDEO_FILE.test(filename) ? "video" : "photo",
    });
  }
  return items;
}

function galleryMarkup(items) {
  const tiles = items
    .map((item) => {
      const src = escapeHtml(item.url);
      if (item.kind === "video") {
        return `<button type="button" class="gallery-item" data-kind="video" data-src="${src}"><video src="${src}" muted playsinline preload="metadata"></video></button>`;
      }
      return `<button type="button" class="gallery-item" data-kind="photo" data-src="${src}"><img src="${src}" alt="" /></button>`;
    })
    .join("");
  const grid = tiles ? `<div class="gallery-grid">${tiles}</div>` : "";
  return `<section class="gallery" aria-label="Photos and videos"><div class="gallery-bar"><h2>Photos and videos</h2></div>${grid}</section>`;
}

function tripViewer() {
  return `<div id="lightbox" hidden><button type="button" id="lightbox-close">Close</button><div id="lightbox-frame"></div></div>
<script>
(() => {
  const box = document.getElementById("lightbox");
  const frame = document.getElementById("lightbox-frame");
  const close = document.getElementById("lightbox-close");
  function shut() { box.hidden = true; frame.replaceChildren(); }
  function openViewer(kind, src) {
    frame.replaceChildren();
    if (kind === "video") {
      const video = document.createElement("video");
      video.controls = true;
      video.playsInline = true;
      video.autoplay = true;
      video.src = src;
      frame.append(video);
    } else {
      const img = document.createElement("img");
      img.alt = "";
      img.src = src;
      frame.append(img);
    }
    box.hidden = false;
  }
  close.addEventListener("click", shut);
  box.addEventListener("click", (event) => {
    if (event.target === box || event.target === frame) shut();
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".gallery-item, .note-media");
    if (!button || !button.dataset.src) return;
    openViewer(button.dataset.kind, button.dataset.src);
  });
})();
</script>`;
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

function ndjsonResponse(start) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (value) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      };
      try {
        await start(send);
        controller.close();
      } catch (error) {
        try {
          controller.error(error);
        } catch {
          /* The stream is already closed. */
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}

/** Trip names from index files only. Each line is sent as soon as that index is read. */
export function streamHomeTrips(bucket) {
  return ndjsonResponse(async (send) => {
    const keys = (await listKeys(bucket, "trips/")).filter((key) => key.endsWith("/index.md"));
    await Promise.all(
      keys.map(async (key) => {
        const raw = await readText(bucket, key);
        if (!raw) return;
        const { data } = parseFrontmatter(raw);
        if (String(data.draft) === "true") return;
        const slug = key.split("/")[1];
        send({
          slug,
          title: data.title || slug,
          location: data.location || "",
          date: data.date || "",
          endDate: data.endDate || "",
          summary: data.summary || "",
          kind: data.kind || "",
          when: formatRange(data.date || "", data.endDate || ""),
          thumb: gatedPhotoUrl(data.cover || ""),
        });
      }),
    );
  });
}

/** Photo addresses for the floating layer. Videos and draft trips are skipped. Lines are sent as each page of keys is listed. */
export function streamHomePhotos(bucket) {
  return ndjsonResponse(async (send) => {
    const publicSlugs = new Set();
    const tripInfo = new Map();
    const indexes = (await listKeys(bucket, "trips/")).filter((key) => key.endsWith("/index.md"));
    await Promise.all(
      indexes.map(async (key) => {
        const raw = await readText(bucket, key);
        if (!raw) return;
        const { data } = parseFrontmatter(raw);
        if (String(data.draft) === "true") return;
        const slug = key.split("/")[1];
        publicSlugs.add(slug);
        tripInfo.set(slug, {
          title: data.title || slug,
          location: data.location || "",
          when: formatRange(data.date || "", data.endDate || ""),
        });
      }),
    );
    let sent = 0;
    let cursor;
    do {
      const listed = await bucket.list({ prefix: "media/", cursor });
      for (const object of listed.objects) {
        const key = object.key;
        const slug = key.split("/")[1];
        if (!publicSlugs.has(slug) || !key.includes("/photos/") || !isImageFile(key)) continue;
        if (sent >= MOTION_PHOTO_CAP) return;
        sent += 1;
        const info = tripInfo.get(slug) || { title: "", location: "", when: "" };
        send({ url: `${PREFIX}/${key}`, title: info.title, location: info.location, when: info.when });
      }
      cursor = listed.truncated && sent < MOTION_PHOTO_CAP ? listed.cursor : undefined;
    } while (cursor);
  });
}

/** Public login cards. Indexes first, then poster JPEGs only. No full-size media. */
export function streamLoginPosters(bucket) {
  return ndjsonResponse(async (send) => {
    const keys = (await listKeys(bucket, "trips/")).filter((key) => key.endsWith("/index.md"));
    await Promise.all(
      keys.map(async (key) => {
        const raw = await readText(bucket, key);
        if (!raw) return;
        const { data } = parseFrontmatter(raw);
        if (String(data.draft) === "true") return;
        const slug = key.split("/")[1];
        const posterKeys = (await listKeys(bucket, `posters/${slug}/`)).filter((item) => isPosterKey(item)).slice(0, 16);
        const title = data.title || slug;
        const location = data.location || "";
        const when = formatRange(data.date || "", data.endDate || "");
        for (const posterKey of posterKeys) {
          send({ title, location, when, url: `${PREFIX}/${posterKey}` });
        }
      }),
    );
  });
}

export async function renderJournal(bucket, url) {
  if (!bucket) return null;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === `${PREFIX}/home-trips`) return streamHomeTrips(bucket);
  if (path === `${PREFIX}/home-photos`) return streamHomePhotos(bucket);
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/trips/`)) return null;

  if (path === PREFIX) {
    return page(
      "Travel Log",
      `<h1>Travel Log</h1><div class="log-menu"><button type="button" id="log-toggle" aria-expanded="false" aria-controls="log-panel">Travel log</button><div id="log-panel" hidden><h2>Trips</h2><ul id="trip-list" class="trip-list"></ul><h2>Day trips</h2><ul id="outing-list" class="trip-list"></ul></div></div><script>
(() => {
  const button = document.getElementById("log-toggle");
  const panel = document.getElementById("log-panel");
  if (!button || !panel) return;
  function setOpen(open) {
    if (open) panel.removeAttribute("hidden");
    else panel.setAttribute("hidden", "");
    button.setAttribute("aria-expanded", open ? "true" : "false");
  }
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(panel.hasAttribute("hidden"));
  });
  document.addEventListener("click", (event) => {
    if (panel.hasAttribute("hidden")) return;
    const target = event.target;
    if (target && (panel.contains(target) || button.contains(target))) return;
    setOpen(false);
  });
})();
</script>`,
      { trips: [], photos: [] },
    );
  }

  const slug = path.slice(`${PREFIX}/trips/`.length).split("/")[0];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  const indexRaw = await readText(bucket, `trips/${slug}/index.md`);
  if (!indexRaw) return null;
  const { data, body } = parseFrontmatter(indexRaw);
  const keys = await listKeys(bucket, `trips/${slug}/days/`);
  const dayNotes = [];
  const days = [];
  for (const key of keys.filter((item) => /\.(md|mdx)$/.test(item)).sort()) {
    const raw = await readText(bucket, key);
    if (!raw) continue;
    dayNotes.push(raw);
    const date = key.split("/").pop().replace(/\.(md|mdx)$/, "");
    days.push(`<section class="day"><h2>${escapeHtml(date)}</h2>${renderBody(raw)}</section>`);
  }
  const when = formatRange(data.date, data.endDate);
  const where = [data.location, when].filter(Boolean).join(" · ");
  const gallery = galleryMarkup(await tripGallery(bucket, slug, [body, ...dayNotes]));
  const edit = `${PREFIX}/author/?trip=${encodeURIComponent(slug)}`;
  return page(
    data.title || slug,
    `<p class="meta"><a href="${PREFIX}/">Trips</a> · <a class="edit-trip" href="${edit}">Edit</a></p><h1>${escapeHtml(data.title || slug)}</h1><p class="meta">${escapeHtml(where)}</p>${gallery}${renderBody(body)}${days.join("")}${tripViewer()}`,
  );
}
