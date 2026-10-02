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
    :root { color: #1c241e; background: #f3efe6; font-family: Georgia, "Times New Roman", serif; }
    body { margin: 0; }
    a { color: #2e4a3e; }
    #motion-names, #motion-layer { position: fixed; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }
    .name-card { position: absolute; top: 0; left: 0; display: flex; gap: 0.55rem; align-items: center; width: max-content; max-width: 16rem; padding: 0.35rem 0.7rem 0.35rem 0.35rem; background: rgba(243, 239, 230, 0.72); border-radius: 999px; font-family: "Segoe UI", sans-serif; font-size: 0.92rem; }
    .name-card img { width: 3.2rem; height: 2.4rem; object-fit: cover; border-radius: 999px; margin: 0; }
    .name-card span { display: grid; line-height: 1.2; }
    .name-card em { font-style: normal; font-size: 0.75rem; opacity: 0.8; }
    .float-photo { position: absolute; height: auto; margin: 0; border-radius: 8px; box-shadow: 0 8px 24px rgba(28, 36, 30, 0.18); }
    #motion-debug { position: fixed; right: 0.8rem; bottom: 0.8rem; z-index: 5; width: min(18rem, calc(100% - 1.6rem)); padding: 0.7rem 0.8rem; background: rgba(28, 36, 30, 0.92); color: #f3efe6; font-family: "Segoe UI", sans-serif; font-size: 0.82rem; border-radius: 8px; }
    #motion-debug .debug-bar { display: flex; justify-content: space-between; align-items: center; }
    #motion-debug button { font: inherit; background: transparent; color: inherit; border: 0; cursor: pointer; }
    #motion-form { display: grid; gap: 0.35rem; margin-top: 0.45rem; }
    #motion-form label { display: grid; gap: 0.1rem; }
    #motion-form input { font: inherit; width: 100%; }
    #motion-debug .debug-note { margin: 0.45rem 0 0; opacity: 0.8; }
    header, main { position: relative; z-index: 1; max-width: 42rem; margin: 0 auto; padding: 1.25rem; }
    main { background: rgba(243, 239, 230, 0.88); }
    header { display: flex; justify-content: space-between; align-items: baseline; }
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
    .add-media, a.edit-trip { font-family: "Segoe UI", sans-serif; font-size: 0.9rem; text-decoration: none; border: 1px solid #2e4a3e; color: #2e4a3e; background: transparent; padding: 0.3rem 0.65rem; cursor: pointer; }
    .add-media { position: relative; background: #2e4a3e; color: #fff; }
    .add-media input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
    .file-drop { border: 1px dashed #8a8175; padding: 0.8rem; margin: 0.4rem 0 0.6rem; display: grid; gap: 0.55rem; justify-items: start; }
    .file-drop.dragover { outline: 2px solid #2e4a3e; }
    .upload-progress { list-style: none; padding: 0; margin: 0.4rem 0 0.7rem; display: grid; gap: 0.45rem; }
    .upload-file { display: grid; grid-template-columns: 6rem 1fr; gap: 0.55rem; align-items: center; }
    .upload-preview { width: 6rem; height: 4.5rem; overflow: hidden; background: #e4ddd0; }
    .upload-preview img, .upload-preview video { width: 6rem; height: 4.5rem; max-width: 6rem; max-height: 4.5rem; object-fit: cover; margin: 0; display: block; }
    .upload-body { display: grid; gap: 0.15rem; min-width: 0; }
    .upload-name { font-family: "Segoe UI", sans-serif; font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .upload-note { font-family: "Segoe UI", sans-serif; font-size: 0.75rem; }
    .upload-file[data-phase="failed"] .upload-note { color: #8a2f2f; }
    .upload-count { margin: 0.15rem 0 0.6rem; font-family: "Segoe UI", sans-serif; font-size: 0.9rem; }
    progress { width: 100%; }
    .file-drop p { margin: 0; font-family: "Segoe UI", sans-serif; font-size: 0.9rem; }
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
    <a href="${PREFIX}/author/">Author</a>
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
  return `<section class="gallery" aria-label="Photos and videos"><div class="gallery-bar"><h2>Photos and videos</h2></div><div id="gallery-drop" class="file-drop"><p>Drop photos and videos here</p><label class="add-media">Choose photos and videos<input id="gallery-add" type="file" multiple accept=".heic,.heif,.jpg,.jpeg,.png,.webp,.gif,.mov,.mp4,.m4v,.webm" /></label></div><ol id="gallery-progress" class="upload-progress" hidden></ol><p id="gallery-status" class="meta"></p>${grid}</section>`;
}

function tripViewer(slug) {
  const slugLiteral = JSON.stringify(slug);
  return `<div id="lightbox" hidden><button type="button" id="lightbox-close">Close</button><div id="lightbox-frame"></div></div>
<script>
(() => {
  const slug = ${slugLiteral};
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
  const input = document.getElementById("gallery-add");
  const drop = document.getElementById("gallery-drop");
  const status = document.getElementById("gallery-status");
  let busy = false;
  let acceptMore = null;
  function say(message) { if (status) status.textContent = message; }
  function names() {
    const found = new Set();
    document.querySelectorAll(".gallery-item, .note-media").forEach((node) => {
      const name = (node.dataset.src || "").split("/").pop();
      if (name) found.add(decodeURIComponent(name));
    });
    return found;
  }
  function tile(item) {
    let grid = document.querySelector(".gallery-grid");
    if (!grid) {
      grid = document.createElement("div");
      grid.className = "gallery-grid";
      const section = document.querySelector(".gallery");
      if (!section) return;
      section.append(grid);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gallery-item";
    button.dataset.kind = item.kind;
    button.dataset.src = item.url;
    if (item.kind === "video") {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.src = item.url;
      button.append(video);
    } else {
      const img = document.createElement("img");
      img.alt = "";
      img.src = item.url;
      button.append(img);
    }
    grid.append(button);
  }
  async function uploader() {
    if (window.travelLogUploadGallery) return window.travelLogUploadGallery;
    const response = await fetch("/travel-log/gallery-client/", { credentials: "same-origin" });
    if (!response.ok) throw new Error("Could not load the photo uploader.");
    const html = await response.text();
    const named = html.match(/src="([^"]*gallery-client[^"]*\\.js)"/);
    const any = html.match(/<script type="module" src="([^"]+)"/);
    const src = (named || any || [])[1];
    if (!src) throw new Error("Could not load the photo uploader.");
    await import(new URL(src, location.origin).href);
    if (!window.travelLogUploadGallery) throw new Error("Could not load the photo uploader.");
    return window.travelLogUploadGallery;
  }
  function showUpload(files) {
    const list = document.getElementById("gallery-progress");
    if (!list) return { update() {}, addFiles() { return 0; } };
    const previous = list.nextElementSibling;
    if (previous && previous.classList.contains("upload-count")) previous.remove();
    list.querySelectorAll("img, video").forEach((node) => {
      const src = node.getAttribute("src") || "";
      if (src.indexOf("blob:") === 0) URL.revokeObjectURL(src);
    });
    list.replaceChildren();
    const count = document.createElement("p");
    count.className = "upload-count meta";
    list.insertAdjacentElement("afterend", count);
    const batch = files.slice();
    const rows = [];
    const settled = new Set();
    let finished = 0;
    let failures = 0;
    function lowerName(file) {
      return String(file && file.name || "").toLowerCase();
    }
    function heicFile(file) {
      const type = file && file.type || "";
      const name = lowerName(file);
      return name.endsWith(".heic") || name.endsWith(".heif") || type === "image/heic" || type === "image/heif";
    }
    function videoFile(file) {
      const type = file && file.type || "";
      const name = lowerName(file);
      return type.indexOf("video/") === 0 || name.endsWith(".mp4") || name.endsWith(".m4v") || name.endsWith(".webm") || name.endsWith(".mov");
    }
    function revokeRow(row) {
      row.querySelectorAll("img, video").forEach((node) => {
        const src = node.getAttribute("src") || "";
        if (src.indexOf("blob:") === 0) URL.revokeObjectURL(src);
      });
    }
    function paintCount() {
      const active = rows.some((row) => row && row.dataset.phase !== "failed");
      const failed = rows.some((row) => row && row.dataset.phase === "failed");
      if (settled.size === batch.length) {
        count.hidden = true;
        count.textContent = "";
        if (!failures) {
          rows.forEach((row) => { if (row) revokeRow(row); });
          list.replaceChildren();
          list.hidden = true;
        } else {
          list.hidden = !failed;
        }
        return;
      }
      count.hidden = false;
      count.textContent = finished + "/" + batch.length;
      list.hidden = !active && !failed;
    }
    function ensureRow(index) {
      if (rows[index]) return rows[index];
      const file = batch[index];
      if (!file) return null;
      const row = document.createElement("li");
      row.className = "upload-file";
      const preview = document.createElement("span");
      preview.className = "upload-preview";
      if (videoFile(file)) {
        const url = URL.createObjectURL(file);
        if (String(url).indexOf("blob:") === 0) {
          const node = document.createElement("video");
          node.src = url;
          node.muted = true;
          node.playsInline = true;
          node.preload = "metadata";
          node.width = 96;
          node.height = 72;
          node.addEventListener("loadeddata", () => {
            try { if (node.currentTime < 0.01) node.currentTime = 0.1; } catch (error) { /* keep the tile */ }
          });
          preview.append(node);
        }
      } else if (!heicFile(file)) {
        const url = URL.createObjectURL(file);
        if (String(url).indexOf("blob:") === 0) {
          const node = document.createElement("img");
          node.src = url;
          node.alt = "";
          node.width = 96;
          node.height = 72;
          preview.append(node);
        }
      }
      const body = document.createElement("span");
      body.className = "upload-body";
      const name = document.createElement("span");
      name.className = "upload-name";
      name.textContent = file.name;
      const bar = document.createElement("progress");
      bar.max = 1;
      bar.value = 0;
      const note = document.createElement("span");
      note.className = "upload-note";
      body.append(name, bar, note);
      row.append(preview, body);
      rows[index] = row;
      list.append(row);
      list.hidden = false;
      return row;
    }
    function setPreview(index, source) {
      if (settled.has(index)) return;
      const row = ensureRow(index);
      const preview = row && row.querySelector(".upload-preview");
      if (!row || !preview) return;
      const previous = preview.querySelector("img");
      if (previous) {
        const owned = previous.getAttribute("src") || "";
        if (owned.indexOf("blob:") === 0) URL.revokeObjectURL(owned);
        previous.remove();
      }
      let url = "";
      if (source instanceof Blob) url = URL.createObjectURL(source);
      else if (typeof source === "string") url = source;
      if (!url || url.indexOf("file:") === 0) return;
      const img = document.createElement("img");
      img.alt = "";
      img.width = 96;
      img.height = 72;
      img.dataset.painted = "0";
      img.addEventListener("load", () => { img.dataset.painted = "1"; });
      img.src = url;
      preview.append(img);
    }
    function fillIfBlank(index, url) {
      const row = rows[index];
      if (!row || !url || settled.has(index)) return;
      const img = row.querySelector(".upload-preview img");
      if (img && (img.dataset.painted === "1" || (img.complete && img.naturalWidth > 0))) return;
      if (!img || !img.getAttribute("src") || (img.complete && img.naturalWidth === 0)) {
        setPreview(index, url);
        return;
      }
      img.addEventListener("error", () => {
        if (img.dataset.painted !== "1") setPreview(index, url);
      }, { once: true });
    }
    function settle(index, phase, message) {
      if (settled.has(index)) return;
      settled.add(index);
      if (phase === "failed") {
        failures += 1;
        const row = ensureRow(index);
        if (row) {
          row.dataset.phase = "failed";
          const bar = row.querySelector("progress");
          const note = row.querySelector(".upload-note");
          if (bar) bar.hidden = true;
          if (note) note.textContent = message || "Failed";
        }
      } else {
        finished += 1;
        const row = rows[index];
        if (row) {
          revokeRow(row);
          row.remove();
          rows[index] = null;
        }
      }
      paintCount();
    }
    paintCount();
    return {
      addFiles(more) {
        const start = batch.length;
        more.forEach((file) => {
          batch.push(file);
          rows.push(null);
        });
        paintCount();
        return start;
      },
      update(index, phase, ratio, message, preview) {
        if (settled.has(index)) return;
        if (phase === "queued") return;
        if (phase === "preview") {
          if (preview) setPreview(index, preview);
          return;
        }
        if (phase === "remote") {
          if (message) fillIfBlank(index, message);
          return;
        }
        if (phase === "done" || phase === "skipped") {
          settle(index, phase, message);
          return;
        }
        if (phase === "failed") {
          settle(index, "failed", message);
          return;
        }
        const row = ensureRow(index);
        if (!row || settled.has(index)) return;
        row.dataset.phase = phase;
        const bar = row.querySelector("progress");
        const note = row.querySelector(".upload-note");
        if (bar) bar.hidden = false;
        if (phase === "uploading") {
          if (bar && typeof ratio === "number") bar.value = ratio;
          if (note) note.textContent = "Uploading";
          return;
        }
        if (bar) bar.removeAttribute("value");
        if (note) note.textContent = "Preparing";
      },
    };
  }
  function wantedFile(file) {
    if (!file) return false;
    const type = file.type || "";
    if (type.indexOf("image/") === 0 || type.indexOf("video/") === 0) return true;
    return /\\.(heic|heif|jpe?g|png|webp|gif|mov|mp4|m4v|webm)$/i.test(file.name || "");
  }
  function fileFromItem(item) {
    return new Promise((resolve) => {
      if (!item || item.kind !== "file") {
        resolve(null);
        return;
      }
      const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
      if (entry && entry.isFile && entry.file) {
        entry.file((file) => resolve(file), () => resolve(item.getAsFile ? item.getAsFile() : null));
        return;
      }
      resolve(item.getAsFile ? item.getAsFile() : null);
    });
  }
  async function filesFromDrop(transfer) {
    const found = [];
    const items = transfer && transfer.items ? Array.from(transfer.items) : [];
    for (const item of items) {
      const file = await fileFromItem(item);
      if (wantedFile(file)) found.push(file);
    }
    if (!found.length && transfer && transfer.files && transfer.files.length) {
      Array.from(transfer.files).forEach((file) => {
        if (wantedFile(file)) found.push(file);
      });
    }
    return found;
  }
  async function send(files) {
    if (!files.length) return;
    if (acceptMore) {
      acceptMore(files);
      return;
    }
    busy = true;
    const rows = showUpload(files);
    const extra = [];
    let enqueue = null;
    acceptMore = (more) => {
      rows.addFiles(more);
      if (enqueue) enqueue(more);
      else extra.push(more);
    };
    try {
      const upload = await uploader();
      const result = await upload(slug, files, names(), say, rows.update, (append) => {
        enqueue = append;
        extra.splice(0).forEach((group) => append(group));
      });
      result.added.forEach(tile);
      const skipped = result.skipped || [];
      const skipNote = skipped.map((name) => "Skipped " + name + " because it is already there.").join(" ");
      if (result.error) say(skipNote ? result.error + " " + skipNote : result.error);
      else if (skipNote && result.added.length) say("Added to the gallery. " + skipNote);
      else if (skipNote) say(skipNote);
      else if (result.added.some((item) => item.posterFailed)) say("Added to the gallery. Login poster failed.");
      else say(result.added.length ? "Added to the gallery." : "Nothing was added.");
    } catch (error) {
      say(error && error.message ? error.message : "Could not add those files.");
    } finally {
      acceptMore = null;
      busy = false;
    }
  }
  if (input) {
    input.addEventListener("change", () => {
      const files = input.files ? Array.from(input.files) : [];
      input.value = "";
      void send(files);
    });
  }
  if (drop) {
    ["dragenter", "dragover"].forEach((name) => {
      drop.addEventListener(name, (event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        drop.classList.add("dragover");
      });
    });
    drop.addEventListener("dragleave", (event) => {
      event.preventDefault();
      drop.classList.remove("dragover");
    });
    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      drop.classList.remove("dragover");
      void filesFromDrop(event.dataTransfer).then((list) => send(list));
    });
  }
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

export async function renderJournal(bucket, url) {
  if (!bucket) return null;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/trips/`)) return null;

  if (path === PREFIX) {
    const keys = await listKeys(bucket, "trips/");
    const indexes = keys.filter((key) => key.endsWith("/index.md"));
    const trips = [];
    const outings = [];
    for (const key of indexes) {
      const raw = await readText(bucket, key);
      if (!raw) continue;
      const { data } = parseFrontmatter(raw);
      if (String(data.draft) === "true") continue;
      const slug = key.split("/")[1];
      const trip = {
        slug,
        title: data.title || slug,
        location: data.location || "",
        date: data.date || "",
        endDate: data.endDate || "",
        summary: data.summary || "",
        kind: data.kind || "",
        thumb: await tripThumbnail(bucket, slug, data),
      };
      if (trip.kind === "outing") outings.push(trip);
      else trips.push(trip);
    }
    const byDate = (a, b) => String(b.date).localeCompare(String(a.date));
    trips.sort(byDate);
    outings.sort(byDate);
    if (!trips.length && !outings.length) return null;
    const listMarkup = (list) => {
      if (!list.length) return `<p class="meta">None yet.</p>`;
      const items = list
        .map((trip) => {
          const when = formatRange(trip.date, trip.endDate);
          const where = [trip.location, when].filter(Boolean).join(" · ");
          const thumb = trip.thumb ? `<img class="thumb" src="${escapeHtml(trip.thumb)}" alt="" decoding="async" />` : "";
          return `<li><a href="${PREFIX}/trips/${encodeURIComponent(trip.slug)}/">${thumb}<span><h2>${escapeHtml(trip.title)}</h2><p class="meta">${escapeHtml(where)}</p>${trip.summary ? `<p>${escapeHtml(trip.summary)}</p>` : ""}</span></a></li>`;
        })
        .join("");
      return `<ul class="trip-list">${items}</ul>`;
    };
    const motion = motionModel(await tripCatalog(bucket));
    return page(
      "Travel Log",
      `<h1>Travel Log</h1><h2>Trips</h2>${listMarkup(trips)}<h2>Day trips</h2>${listMarkup(outings)}`,
      motion,
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
    `<p class="meta"><a href="${PREFIX}/">Trips</a> · <a class="edit-trip" href="${edit}">Edit</a></p><h1>${escapeHtml(data.title || slug)}</h1><p class="meta">${escapeHtml(where)}</p>${gallery}${renderBody(body)}${days.join("")}${tripViewer(slug)}`,
  );
}
