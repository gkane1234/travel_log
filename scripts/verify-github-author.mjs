import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applySiteBase,
  buildCommitRequest,
  buildTreeRequest,
  dayRepoPath,
  gitCommitPlan,
  imageMarkdownUrl,
  gatedMediaUrl,
  placedImageMarkdown,
  placedMediaInMarkdown,
  placedVideoMarkdown,
  mediaObjectKey,
  coverMediaUrl,
  photoPathsInMarkdown,
  routeRepoPath,
} from "../src/lib/github/commit-plan.ts";
import { convertHeicFile, plannedMediaFilename, prepareDroppedFile } from "../src/lib/github/media.ts";
import { reencodePhoto } from "../src/lib/github/strip-photo.ts";
import { POSTER_MAX_BYTES, isAllowedKey, isPosterKey, mediaPublicUrl, storageConfigError } from "../workers/media/src/config.js";
import { mediaWorkerOrigin, mediaUploadUrl } from "../src/lib/github/upload.ts";
import { isDroppedMedia } from "../src/lib/github/drop-files.ts";
import worker from "../workers/media/src/index.js";
import { checkLogin, loginPage, respondToMediaGet, safeNext } from "../workers/media/src/gate.js";
import { isTripCoverPath, publicTripCards, renderJournal, setCoverFrontmatter, streamLoginPosters } from "../workers/media/src/journal.js";
import { uploadGalleryFiles } from "../src/lib/github/gallery-client.ts";
import { UPLOAD_POOL_SIZE } from "../src/lib/github/upload-pool.ts";
import { mediaDuplicate, sha256Hex, skippedNote } from "../src/lib/github/duplicates.ts";
import { dateRangeRefusal, dayNotesOutsideRange } from "../src/lib/github/trip-details.ts";
import { parseFrontmatter, stringifyFrontmatter } from "../src/lib/github/frontmatter.ts";
import { putTripNotes, tripNoteKey } from "../workers/media/src/notes.js";
import sharp from "sharp";

const day = dayRepoPath("olympic-peninsula", "2026-09-08");
const gpx = routeRepoPath("olympic-peninsula", "shoreline.gpx");
const photoUrl = "https://media.example/media/olympic-peninsula/shore.jpg";
const note = `Morning swim.\n\n${imageMarkdownUrl(photoUrl, "shore")}`;
const noteBytes = new TextEncoder().encode(note);
const gpxBytes = new TextEncoder().encode("<gpx></gpx>");

const plan = gitCommitPlan([
  { path: day, bytes: noteBytes },
  { path: gpx, bytes: gpxBytes },
]);
assert.match(note, /https:\/\/media\.example\/media\/olympic-peninsula\/shore\.jpg/);
assert.deepEqual(plan.map((file) => file.path), [day, gpx]);
assert.equal(plan.some((file) => file.path.includes("photos") || file.path.endsWith(".jpg")), false);

const tree = buildTreeRequest("base-tree-sha", [
  { path: day, sha: "day-blob" },
  { path: gpx, sha: "gpx-blob" },
]);
assert.deepEqual(tree.tree.map((entry) => entry.path), [day, gpx]);
assert.equal(tree.tree.some((entry) => entry.sha === "photo-blob"), false);

const commit = buildCommitRequest("Save Olympic Peninsula notes for 2026-09-08", "new-tree", "parent-sha");
assert.equal(commit.message, "Save Olympic Peninsula notes for 2026-09-08");
assert.deepEqual(commit.parents, ["parent-sha"]);

assert.throws(
  () => gitCommitPlan([{ path: "trips/olympic-peninsula/photos/shore.jpg", bytes: new Uint8Array([1, 2, 3]) }]),
  /bucket/,
);

const rewritten = applySiteBase(
  `${note}\n\n<TripVideo src="https://media.example/clip.mp4" />\n\n![old](/trip-media/olympic-peninsula/photos/old.jpg)`,
  "/travel_log/",
);
assert.match(rewritten, /https:\/\/media\.example\/media\/olympic-peninsula\/shore\.jpg/);
assert.match(rewritten, /src="https:\/\/media\.example\/clip\.mp4"/);
assert.match(rewritten, /\/travel_log\/trip-media\/olympic-peninsula\/photos\/old\.jpg/);
assert.equal(rewritten.includes("travel_loghttps"), false);

assert.match(String(storageConfigError({})), /not configured/);
assert.equal(
  storageConfigError({
    S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
    S3_BUCKET: "travel-log-media",
    S3_ACCESS_KEY_ID: "example",
    S3_SECRET_ACCESS_KEY: "example",
    MEDIA_BASE_URL: "https://trips.example",
    MEDIA_PASSWORD: "not-a-real-secret",
    UPLOAD_TOKEN: "device-only",
  }),
  null,
);

class FakeCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.bitmap = null;
  }
  getContext() {
    const canvas = this;
    return {
      drawImage(bitmap) {
        canvas.bitmap = bitmap;
      },
    };
  }
  async convertToBlob() {
    const bitmap = this.bitmap;
    const out = await sharp(bitmap.raw, {
      raw: { width: bitmap.width, height: bitmap.height, channels: 4 },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
    return new Blob([out], { type: "image/jpeg" });
  }
}

globalThis.createImageBitmap = async (blob) => {
  const input = Buffer.from(await blob.arrayBuffer());
  const { data, info } = await sharp(input).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, raw: data, close() {} };
};
globalThis.OffscreenCanvas = FakeCanvas;

const marker = "GPSLatitude=47.6062N";
const plain = await sharp({
  create: { width: 8, height: 8, channels: 3, background: { r: 20, g: 80, b: 40 } },
})
  .jpeg()
  .toBuffer();
const payload = Buffer.from(marker);
const app1 = Buffer.concat([
  Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]),
  payload,
]);
const withGps = Buffer.concat([plain.subarray(0, 2), app1, plain.subarray(2)]);
assert.equal(withGps.includes(marker), true);
const stripped = Buffer.from(await (await reencodePhoto(new Blob([withGps], { type: "image/jpeg" }))).arrayBuffer());
assert.equal(stripped.includes(Buffer.from(marker)), false);
assert.equal(stripped[0], 0xff);
assert.equal(stripped[1], 0xd8);

const mediaEnv = { MEDIA_PASSWORD: "not-a-real-secret" };
const denied = await respondToMediaGet(
  new Request("https://trips.example/media/olympic-peninsula/shore.jpg"),
  mediaEnv,
);
assert.equal(denied?.status, 401);
const missingUser = await checkLogin({ password: "not-a-real-secret" }, mediaEnv);
assert.equal(missingUser.ok, false);
const wrongUser = await checkLogin({ username: "someone", password: "not-a-real-secret" }, mediaEnv);
assert.equal(wrongUser.ok, false);
const login = await checkLogin({ username: "Jumbo", password: "not-a-real-secret" }, mediaEnv);
assert.equal(login.ok, true);
const gumbo = await checkLogin({ username: "gumbo", password: "not-a-real-secret" }, mediaEnv);
assert.equal(gumbo.ok, true);
assert.match(login.cookie, /HttpOnly/);
assert.match(login.cookie, /Secure/);
assert.match(login.cookie, /Path=\/travel-log/);
assert.match(login.cookie, /SameSite=Lax/);
assert.equal(
  mediaPublicUrl("https://gabriel-kane.com", "media/olympic-peninsula/shore.jpg"),
  "https://gabriel-kane.com/travel-log/media/olympic-peninsula/shore.jpg",
);
assert.equal(mediaWorkerOrigin("https://gabriel-kane.com/travel-log"), "https://gabriel-kane.com");
assert.equal(mediaWorkerOrigin("https://gabriel-kane.com/travel_log"), "https://gabriel-kane.com");
assert.equal(`${mediaWorkerOrigin("https://gabriel-kane.com")}/travel-log/sign`, "https://gabriel-kane.com/travel-log/sign");
assert.equal(
  mediaUploadUrl("https://gabriel-kane.com", "media/olympic-peninsula/photos/shore.jpg"),
  "https://gabriel-kane.com/travel-log/media/olympic-peninsula/photos/shore.jpg",
);
const uploadSource = readFileSync(new URL("../src/lib/github/upload.ts", import.meta.url), "utf8");
assert.equal(uploadSource.includes("r2.cloudflarestorage.com"), false);
assert.equal(uploadSource.includes("/travel-log/sign"), false);
assert.match(uploadSource, /xhr\.open\("PUT"/);
assert.match(uploadSource, /\/travel-log\//);
assert.equal(isDroppedMedia(new File(["a"], "pic.jpg", { type: "image/jpeg" })), true);
assert.equal(isDroppedMedia(new File(["a"], "clip.mp4", { type: "video/mp4" })), true);
assert.equal(isDroppedMedia(new File(["a"], "IMG.HEIC", { type: "" })), true);
assert.equal(isDroppedMedia(new File(["a"], "note.txt", { type: "text/plain" })), false);
const storedUploads = new Map();
const uploadEnv = {
  MEDIA_PASSWORD: "not-a-real-secret",
  TRIPS: {
    async put(key, body, options) {
      const bytes = body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(await new Response(body).arrayBuffer());
      storedUploads.set(key, { bytes, type: options?.httpMetadata?.contentType || "" });
    },
  },
};
const uploadCookie = login.cookie.split(";")[0];
const putPhoto = await worker.fetch(
  new Request("https://gabriel-kane.com/travel-log/media/olympic-peninsula/photos/shore.jpg", {
    method: "PUT",
    headers: { Cookie: uploadCookie, "Content-Type": "image/jpeg" },
    body: new Uint8Array([1, 2, 3]),
  }),
  uploadEnv,
);
assert.equal(putPhoto.status, 200);
const putPhotoBody = await putPhoto.json();
assert.equal(putPhotoBody.publicUrl, "https://gabriel-kane.com/travel-log/media/olympic-peninsula/photos/shore.jpg");
assert.equal(storedUploads.get("media/olympic-peninsula/photos/shore.jpg").type, "image/jpeg");
assert.equal(storedUploads.get("media/olympic-peninsula/photos/shore.jpg").bytes.length, 3);
const deniedPut = await worker.fetch(
  new Request("https://gabriel-kane.com/travel-log/media/olympic-peninsula/photos/shore.jpg", {
    method: "PUT",
    headers: { "Content-Type": "image/jpeg" },
    body: new Uint8Array([1]),
  }),
  uploadEnv,
);
assert.equal(deniedPut.status, 401);
const allowed = await respondToMediaGet(
  new Request("https://trips.example/media/olympic-peninsula/shore.jpg", {
    headers: { Cookie: login.cookie.split(";")[0] },
  }),
  mediaEnv,
);
assert.equal(allowed, null);
assert.equal(safeNext("/travel-log/trips/olympic-peninsula/"), "/travel-log/trips/olympic-peninsula/");
assert.equal(safeNext("/travel-log/login"), "");
assert.equal(safeNext("https://evil.example"), "");

const heicNames = ["IMG_5407(1).HEIC", "notes.txt"];
const heicOutcomes = [];
for (const name of heicNames) {
  try {
    await prepareDroppedFile(new File(["not a heic file"], name, { type: "image/heic" }), "olympic-peninsula", new Set(), new Set());
    heicOutcomes.push("ok");
  } catch (error) {
    heicOutcomes.push(error instanceof Error ? error.message : String(error));
  }
}
assert.equal(heicOutcomes.length, 2);
assert.match(heicOutcomes[0], /Could not convert IMG_5407\(1\)\.HEIC/);
assert.match(heicOutcomes[0], /not a HEIC photo/);
assert.equal(heicOutcomes[0].includes("Export a JPEG"), false);
assert.match(heicOutcomes[1], /Unsupported file: notes\.txt/);
assert.equal(typeof convertHeicFile, "function");
assert.equal(plannedMediaFilename("IMG_5407(1).HEIC"), "img-5407-1.jpg");
assert.equal(plannedMediaFilename("IMG_5336(2).HEIC"), "img-5336-2.jpg");
assert.equal(
  isAllowedKey(mediaObjectKey("olympic-peninsula", plannedMediaFilename("IMG_5407(1).HEIC"))),
  true,
);

assert.equal(
  mediaObjectKey("olympic-peninsula", "img-5123-2.jpg"),
  "media/olympic-peninsula/photos/img-5123-2.jpg",
);
const thumb = "/trip-media/olympic-peninsula/photos/img-5123-2.jpg";
assert.equal(coverMediaUrl(thumb), "/travel-log/media/olympic-peninsula/photos/img-5123-2.jpg");
assert.equal(coverMediaUrl("https://pub.r2.dev/img-5123-2.jpg"), "");
const picker = `<button class="cover-choice"><img src="${coverMediaUrl(thumb)}" alt="img-5123-2.jpg" /><span>img-5123-2.jpg</span></button>`;
assert.match(picker, /<img src="\/travel-log\/media\/olympic-peninsula\/photos\/img-5123-2\.jpg"/);
assert.equal(picker.includes("r2.dev"), false);

assert.deepEqual(
  photoPathsInMarkdown(
    "olympic-peninsula",
    "![img-5123](/trip-media/olympic-peninsula/photos/img-5123-2.jpg)\n\n![later](https://gabriel-kane.com/travel-log/media/olympic-peninsula/photos/later.jpg)",
  ),
  [
    "/trip-media/olympic-peninsula/photos/img-5123-2.jpg",
    "/trip-media/olympic-peninsula/photos/later.jpg",
  ],
);
assert.equal(isTripCoverPath("olympic-peninsula", "/trip-media/olympic-peninsula/photos/img-5123-2.jpg"), true);
assert.equal(isTripCoverPath("olympic-peninsula", "/trip-media/other/photos/img-5123-2.jpg"), false);
assert.equal(isTripCoverPath("olympic-peninsula", "https://evil.example/photo.jpg"), false);

const indexRaw = "---\ntitle: Olympic Peninsula\ndate: 2026-09-05\ndraft: false\n---\n\nIntro\n";
const withCover = setCoverFrontmatter(indexRaw, "/trip-media/olympic-peninsula/photos/picked.jpg");
assert.match(withCover, /title: Olympic Peninsula/);
assert.match(withCover, /cover: \/trip-media\/olympic-peninsula\/photos\/picked.jpg/);
assert.match(withCover, /Intro/);
assert.equal(setCoverFrontmatter(withCover, "").includes("cover:"), false);

const files = new Map([
  [
    "trips/olympic-peninsula/index.md",
    "---\ntitle: Olympic Peninsula\ndate: 2026-09-05\nendDate: 2026-09-12\nlocation: Washington\ndraft: false\n---\n",
  ],
  [
    "trips/olympic-peninsula/days/2026-09-05.mdx",
    "![img-5123](/trip-media/olympic-peninsula/photos/img-5123-2.jpg)\n",
  ],
  [
    "trips/example-trip/index.md",
    "---\ntitle: Example Trip\ndate: 2024-08-12\ndraft: false\n---\n",
  ],
  [
    "trips/cabin-weekend/index.md",
    "---\ntitle: Cabin Weekend\ndate: 2026-10-02\nendDate: 2026-10-04\ndraft: false\n---\n",
  ],
  [
    "trips/ferry-ride/index.md",
    "---\ntitle: Ferry Ride\ndate: 2026-07-04\nkind: outing\ndraft: false\n---\n",
  ],
  [
    "trips/secret-draft/index.md",
    "---\ntitle: Secret Draft\ndate: 2026-11-01\ndraft: true\n---\n",
  ],
  ["media/olympic-peninsula/photos/clip.mp4", ""],
  ["media/olympic-peninsula/photos/gallery-only.jpg", ""],
  ["media/olympic-peninsula/photos/shore.gpx", ""],
  ["media/olympic-peninsula/routes/shoreline.gpx", ""],
  ["media/example-trip/photos/pier.jpg", ""],
  ["media/example-trip/photos/clip.mp4", ""],
  ["media/secret-draft/photos/hidden.jpg", ""],
]);
const bucket = {
  async list({ prefix }) {
    return {
      objects: [...files.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })),
      truncated: false,
    };
  },
  async get(key) {
    const text = files.get(key);
    if (text == null) return null;
    return { text: async () => text };
  },
};
let homeLists = 0;
const originalList = bucket.list.bind(bucket);
bucket.list = async (options) => {
  homeLists += 1;
  return originalList(options);
};
const home = await renderJournal(bucket, new URL("https://gabriel-kane.com/travel-log/"));
const homeHtml = await home.text();
assert.equal(homeLists, 0);
bucket.list = originalList;
assert.match(homeHtml, /id="motion-layer"/);
assert.match(homeHtml, /id="motion-debug"/);
assert.match(homeHtml, /Photo style/);
assert.match(homeHtml, /Card size \(px\)/);
assert.match(homeHtml, /name="look"/);
assert.match(homeHtml, /<option value="current">Current<\/option>/);
assert.match(homeHtml, /<option value="cards">Cards<\/option>/);
assert.match(homeHtml, /"look":"current"/);
assert.match(homeHtml, /background: #1c241e/);
assert.match(homeHtml, /main:has\(#log-panel\) \{ background: transparent; color: #f3efe6; \}/);
assert.match(homeHtml, /header a, \.header-actions button \{ color: #f3efe6; \}/);
assert.match(homeHtml, /Peak opacity/);
assert.match(homeHtml, /Travel distance \(% of screen\)/);
assert.match(homeHtml, /pointer-events: none/);
assert.equal(homeHtml.includes("Olympic Peninsula"), false);
assert.equal(homeHtml.includes("gallery-only.jpg"), false);
assert.equal(homeHtml.includes("hidden.jpg"), false);
assert.match(homeHtml, /fetch\("\/travel-log\/home-trips"/);
assert.ok(homeHtml.indexOf('fetch("/travel-log/home-trips"') < homeHtml.indexOf('fetch("/travel-log/home-photos"'));
assert.equal(/<img[^>]*gallery-only\.jpg/.test(homeHtml), false);
assert.equal(homeHtml.includes('class="float-photo"'), false);
const tripsHeading = homeHtml.indexOf("<h2>Trips</h2>");
const loaderAt = homeHtml.indexOf("FLOAT_LOADERS = 3");
assert.ok(tripsHeading !== -1 && loaderAt > tripsHeading);
assert.match(homeHtml, /activeLoads < FLOAT_LOADERS/);
assert.match(homeHtml, /addEventListener\("load", \(\) => \{/);
assert.match(homeHtml, /job\.img\.decode\(\)/);
assert.match(homeHtml, /if \(job\.show\) job\.show\(\)/);
assert.match(homeHtml, /Appear delay \(seconds\)/);
assert.match(homeHtml, /appearDelay/);
assert.match(homeHtml, /Recent photos/);
assert.match(homeHtml, /name="recentLimit"/);
assert.match(homeHtml, /id="recent-photos"/);
assert.match(homeHtml, /function pickPhotoUrl/);
assert.match(homeHtml, /if \(!blocked\[photoName\(url\)\]\) choices\.push\(url\)/);
assert.match(homeHtml, /remember\(fileName\)/);
assert.match(homeHtml, /failed\(\) \{\s*floatPending -= 1;\s*remember\(fileName\);\s*queueFloat\(\);/s);
assert.match(homeHtml, /Math\.random\(\) \* maxWait \* 1000/);
assert.match(homeHtml, /window\.setTimeout\(/);
const loadAt = homeHtml.indexOf('addEventListener("load"');
const showAt = homeHtml.indexOf("layer.append(img)");
const errorAt = homeHtml.indexOf('addEventListener("error"');
assert.ok(errorAt !== -1 && loadAt > errorAt && showAt > loadAt);
assert.match(homeHtml, /<h2>Trips<\/h2>/);
assert.match(homeHtml, /<h2>Day trips<\/h2>/);
assert.match(homeHtml, /<a href="\/travel-log\/author\/">Author<\/a>\s*<form method="post" action="\/travel-log\/logout"><button type="submit">Log out<\/button><\/form>/);
assert.match(homeHtml, /id="log-toggle"[^>]*>Travel log</);
assert.match(homeHtml, /id="log-panel" hidden/);
assert.match(homeHtml, /#log-panel\[hidden\] \{ display: none !important; \}/);
assert.match(homeHtml, /setOpen\(panel\.hasAttribute\("hidden"\)\)/);
const logToggleAt = homeHtml.indexOf('id="log-toggle"');
const logPanelAt = homeHtml.indexOf('id="log-panel"');
assert.ok(logToggleAt !== -1 && logPanelAt > logToggleAt && logPanelAt < tripsHeading);
assert.match(homeHtml, /id="motion-toggle"[^>]*>Motion</);
assert.match(homeHtml, /id="motion-debug" hidden/);
assert.match(homeHtml, /#motion-debug\[hidden\] \{ display: none !important; \}/);
assert.equal(homeHtml.includes(">Hide<"), false);
const listHtml = homeHtml.slice(homeHtml.indexOf("<h1>Travel Log</h1>"));
const tripsHead = listHtml.indexOf("<h2>Trips</h2>");
const dayHead = listHtml.indexOf("<h2>Day trips</h2>");
const tripListAt = listHtml.indexOf('id="trip-list"');
const outingListAt = listHtml.indexOf('id="outing-list"');
assert.ok(tripsHead !== -1 && dayHead !== -1 && tripsHead < tripListAt && tripListAt < dayHead && dayHead < outingListAt);
assert.equal(homeHtml.includes("Secret Draft"), false);
const tripFeed = await (await renderJournal(bucket, new URL("https://gabriel-kane.com/travel-log/home-trips"))).text();
assert.match(tripFeed, /Olympic Peninsula/);
assert.match(tripFeed, /Cabin Weekend/);
assert.match(tripFeed, /Ferry Ride/);
assert.match(tripFeed, /Oct 2, 2026/);
assert.match(tripFeed, /Jul 4, 2026/);
assert.equal(tripFeed.includes("Secret Draft"), false);
assert.equal(tripFeed.includes("gallery-only.jpg"), false);
assert.equal(tripFeed.includes("/photos/"), false);
const photoFeed = await (await renderJournal(bucket, new URL("https://gabriel-kane.com/travel-log/home-photos"))).text();
assert.match(photoFeed, /gallery-only\.jpg/);
assert.match(photoFeed, /\/travel-log\/media\/example-trip\/photos\/pier\.jpg/);
assert.match(photoFeed, /"title":"Olympic Peninsula"/);
assert.match(photoFeed, /"title":"Example Trip"/);
assert.equal(photoFeed.includes("/posters/"), false);
assert.equal(photoFeed.includes("clip.mp4"), false);
assert.equal(photoFeed.includes("hidden.jpg"), false);
const ferryParsed = parseFrontmatter("---\ntitle: Ferry Ride\ndate: 2026-07-04\nkind: outing\ndraft: false\n---\n");
ferryParsed.data.draft = true;
const hiddenFerry = stringifyFrontmatter(ferryParsed.data, ferryParsed.body);
assert.match(hiddenFerry, /draft: true/);
files.set("trips/ferry-ride/index.md", hiddenFerry);
const hiddenHome = await (await renderJournal(bucket, new URL("https://gabriel-kane.com/travel-log/home-trips"))).text();
assert.equal(hiddenHome.includes("Ferry Ride"), false);
assert.match(hiddenHome, /Cabin Weekend/);
ferryParsed.data.draft = false;
const shownFerry = stringifyFrontmatter(ferryParsed.data, ferryParsed.body);
assert.match(shownFerry, /draft: false/);
files.set("trips/ferry-ride/index.md", shownFerry);
assert.match(tripFeed, /"title":"Ferry Ride".*"when":"Jul 4, 2026","thumb":""/);
assert.match(tripFeed, /"title":"Example Trip".*"when":"Aug 12, 2024","thumb":""/);
assert.match(tripFeed, /"title":"Cabin Weekend".*"when":"Oct 2, 2026 – Oct 4, 2026","thumb":""/);
assert.match(tripFeed, /Sep 5, 2026/);
assert.match(tripFeed, /Sep 12, 2026/);
assert.match(homeHtml, /id="motion-layer"/);
assert.equal(homeHtml.includes("r2.dev"), false);
assert.equal(homeHtml.includes("example-trip"), false);
const tripPage = await renderJournal(bucket, new URL("https://gabriel-kane.com/travel-log/trips/olympic-peninsula"));
const tripHtml = await tripPage.text();
const galleryAt = tripHtml.indexOf('class="gallery"');
const dayAt = tripHtml.indexOf('class="day"');
assert.ok(galleryAt !== -1 && dayAt !== -1 && galleryAt < dayAt);
assert.match(tripHtml, /class="gallery-item" data-kind="photo" data-src="\/travel-log\/media\/olympic-peninsula\/photos\/img-5123-2\.jpg"/);
assert.match(tripHtml, /class="gallery-item" data-kind="video" data-src="\/travel-log\/media\/olympic-peninsula\/photos\/clip\.mp4"/);
assert.match(tripHtml, /class="note-media" data-kind="photo" data-src="\/travel-log\/media\/olympic-peninsula\/photos\/img-5123-2\.jpg"/);
assert.match(tripHtml, /<a href="\/travel-log\/author\/">Author<\/a>\s*<form method="post" action="\/travel-log\/logout"><button type="submit">Log out<\/button><\/form>/);
assert.match(tripHtml, /href="\/travel-log\/author\/\?trip=olympic-peninsula"/);
assert.equal(tripHtml.includes('id="gallery-add"'), false);
assert.equal(tripHtml.includes('id="gallery-drop"'), false);
assert.equal(tripHtml.includes('id="gallery-progress"'), false);
assert.equal(tripHtml.includes("Choose photos and videos"), false);
assert.equal(tripHtml.includes("Drop photos and videos here"), false);
assert.equal(tripHtml.includes("travelLogUploadGallery"), false);
assert.equal(tripHtml.includes("function showUpload"), false);
assert.match(tripHtml, /id="lightbox-close"/);
assert.match(tripHtml, /closest\("\.gallery-item, \.note-media"\)/);
assert.match(tripHtml, /event\.target === box \|\| event\.target === frame/);
assert.equal(tripHtml.includes("shore.gpx"), false);
assert.equal(tripHtml.includes("shoreline.gpx"), false);
assert.match(tripHtml, /id="lightbox"/);
assert.equal(tripHtml.includes('id="motion-layer"'), false);
assert.equal(tripHtml.includes("FLOAT_LOADERS"), false);
assert.equal(tripHtml.includes('id="motion-debug"'), false);
assert.equal(tripHtml.includes('id="log-toggle"'), false);
assert.equal(homeHtml.includes('id="gallery-add"'), false);

files.set(
  "trips/olympic-peninsula/index.md",
  "---\ntitle: Olympic Peninsula\ndate: 2026-09-05\ncover: /trip-media/olympic-peninsula/photos/picked.jpg\ndraft: false\n---\n",
);
const picked = await renderJournal(bucket, new URL("https://gabriel-kane.com/travel-log/home-trips"));
assert.match(await picked.text(), /\/travel-log\/media\/olympic-peninsula\/photos\/picked\.jpg/);

assert.equal(tripNoteKey("trips/coast/index.md"), "trips/coast/index.md");
assert.equal(tripNoteKey("trips/coast/days/2026-04-01.mdx"), "trips/coast/days/2026-04-01.mdx");
assert.equal(tripNoteKey("trips/coast/photos/a.jpg"), "");
assert.equal(tripNoteKey("../trips/coast/index.md"), "");

const saved = new Map();
const writable = {
  async put(key, text) {
    saved.set(key, text);
  },
  async get(key) {
    const text = saved.get(key);
    if (text == null) return null;
    return { text: async () => text };
  },
  async list({ prefix }) {
    return {
      objects: [...saved.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })),
      truncated: false,
    };
  },
};
await putTripNotes(writable, [
  { path: "trips/coast/index.md", text: "---\ntitle: Coast Walk\ndate: 2026-04-01\ndraft: false\n---\n" },
  { path: "trips/coast/days/2026-04-01.mdx", text: "Saw a heron.\n" },
]);
await assert.rejects(() => putTripNotes(writable, [{ path: "trips/coast/photos/a.jpg", text: "no" }]));
const coastHome = await renderJournal(writable, new URL("https://gabriel-kane.com/travel-log/home-trips"));
assert.match(await coastHome.text(), /Coast Walk/);
const coastShell = await renderJournal(writable, new URL("https://gabriel-kane.com/travel-log/"));
assert.equal((await coastShell.text()).includes("Coast Walk"), false);
const coastPage = await renderJournal(writable, new URL("https://gabriel-kane.com/travel-log/trips/coast"));
const coastHtml = await coastPage.text();
assert.match(coastHtml, /Saw a heron/);
assert.equal(coastHtml.includes('id="gallery-add"'), false);
assert.equal(coastHtml.includes("Drop photos and videos here"), false);
assert.match(coastHtml, /href="\/travel-log\/author\/\?trip=coast"/);
assert.equal(coastHtml.includes('class="gallery-item"'), false);
assert.equal(coastHtml.includes('id="motion-layer"'), false);

assert.equal(isPosterKey("posters/olympic-peninsula/img-5123-2.jpg"), true);
assert.equal(isPosterKey("media/olympic-peninsula/photos/img-5123-2.jpg"), false);
assert.equal(isPosterKey("posters/../media/secret.jpg"), false);
assert.equal(POSTER_MAX_BYTES, 120 * 1024);

files.set("posters/olympic-peninsula/img-5123-2.jpg", "");
files.set("posters/olympic-peninsula/notes.txt", "private day text");
const cards = await publicTripCards(bucket);
const olympicCard = cards.find((card) => card.title === "Olympic Peninsula");
const exampleCard = cards.find((card) => card.title === "Example Trip");
assert.ok(olympicCard);
assert.deepEqual(olympicCard.posters, ["/travel-log/posters/olympic-peninsula/img-5123-2.jpg"]);
assert.ok(exampleCard);
assert.deepEqual(exampleCard.posters, []);
assert.match(exampleCard.when, /Aug 12, 2024/);
assert.equal(JSON.stringify(cards).includes("/travel-log/media/"), false);
assert.equal(JSON.stringify(cards).includes("private day text"), false);
const loginHtml = await (await loginPage("", "Wrong username or password.")).text();
assert.match(loginHtml, /Gabe and Julia's Travel Log/);
assert.match(loginHtml, /id="login-toggle"[^>]*>Posters</);
assert.match(loginHtml, /id="login-panel" hidden/);
assert.match(loginHtml, /#login-panel\[hidden\] \{ display: none !important; \}/);
assert.match(loginHtml, /Drawn size \(px\)/);
assert.match(loginHtml, /name="size"/);
assert.match(loginHtml, /Blur \(px\)/);
assert.match(loginHtml, /name="blur"/);
assert.match(loginHtml, /Opacity/);
assert.match(loginHtml, /name="speed"/);
assert.match(loginHtml, /Appear delay \(seconds\)/);
assert.match(loginHtml, /travel-log-login/);
assert.equal(loginHtml.includes("travel-log-motion"), false);
assert.match(loginHtml, /width: 80px/);
assert.match(loginHtml, /size: 80, blur: 0/);
assert.match(loginHtml, /const showPosters = false/);
assert.match(loginHtml, /if \(!showPosters\)/);
assert.match(loginHtml, /toggle\.hidden = true/);
assert.match(loginHtml, /fetch\("\/travel-log\/login-posters"/);
assert.match(loginHtml, /LOADERS = 3/);
assert.match(loginHtml, /img\.decode\(\)/);
assert.match(loginHtml, /Math\.random\(\) \* maxWait \* 1000/);
assert.match(loginHtml, /window\.setTimeout\(/);
assert.match(loginHtml, /Wrong username or password/);
assert.equal(loginHtml.includes("img-5123-2.jpg"), false);
assert.equal(loginHtml.includes("<img"), false);
assert.equal(loginHtml.includes("/travel-log/media/"), false);
assert.equal(loginHtml.includes("private day text"), false);
assert.equal(homeHtml.includes("Login poster size"), false);
files.set("posters/secret-draft/hidden.jpg", "");
const posterFeed = await (await streamLoginPosters(bucket)).text();
assert.match(posterFeed, /\/travel-log\/posters\/olympic-peninsula\/img-5123-2\.jpg/);
assert.match(posterFeed, /Olympic Peninsula/);
assert.match(posterFeed, /Sep 5, 2026/);
assert.equal(posterFeed.includes("/travel-log/media/"), false);
assert.equal(posterFeed.includes("private day text"), false);
assert.equal(posterFeed.includes("Secret Draft"), false);
assert.equal(posterFeed.includes("hidden.jpg"), false);
let loginLists = 0;
const loginBucket = {
  async list() {
    loginLists += 1;
    return { objects: [], truncated: false };
  },
  async get() {
    return null;
  },
};
const loginResponse = await worker.fetch(new Request("https://gabriel-kane.com/travel-log/login"), { TRIPS: loginBucket });
assert.equal(loginLists, 0);
assert.match(await loginResponse.text(), /Gabe and Julia's Travel Log/);

assert.equal(
  placedImageMarkdown("olympic-peninsula", "img-5123-2.jpg", "img-5123-2"),
  "![img-5123-2](/trip-media/olympic-peninsula/photos/img-5123-2.jpg)",
);
assert.equal(
  placedVideoMarkdown("olympic-peninsula", "img-5131.mp4"),
  '<TripVideo src="/trip-media/olympic-peninsula/photos/img-5131.mp4" />',
);
assert.equal(gatedMediaUrl("olympic-peninsula", "img-5123-2.jpg"), "/travel-log/media/olympic-peninsula/photos/img-5123-2.jpg");
assert.equal(gatedMediaUrl("olympic-peninsula", "img-5131.mp4"), "/travel-log/media/olympic-peninsula/photos/img-5131.mp4");
assert.deepEqual(
  placedMediaInMarkdown(
    "olympic-peninsula",
    '![img-5123](/trip-media/olympic-peninsula/photos/img-5123-2.jpg)\n\n<TripVideo src="/trip-media/olympic-peninsula/photos/img-5131.mp4" />',
  ).map((item) => item.filename),
  ["img-5123-2.jpg", "img-5131.mp4"],
);

const authorMarkup = readFileSync(new URL("../src/components/AuthorApp.astro", import.meta.url), "utf8");
assert.match(authorMarkup, /id="media-input"[^>]*multiple/);
assert.match(authorMarkup, /id="create-media"[^>]*multiple/);
assert.match(authorMarkup, /id="add-drop"/);
assert.equal(authorMarkup.includes('id="add-photos-toggle"'), false);
assert.equal(authorMarkup.includes('id="add-photos-panel" hidden'), false);
assert.match(authorMarkup, /Drop photos and videos here/);
assert.match(authorMarkup, /Choose photos and videos/);
assert.match(authorMarkup, /id="cover-toggle"/);
assert.match(authorMarkup, /Change thumbnail/);
assert.match(authorMarkup, /id="cover-panel" hidden/);
assert.match(authorMarkup, /id="added-photos-toggle"/);
assert.match(authorMarkup, />View uploaded media</);
assert.match(authorMarkup, /id="added-photos" hidden/);
assert.match(authorMarkup, /class="note-layout"/);
assert.match(authorMarkup, /grid-template-columns: minmax\(0, 1fr\) 17\.5rem/);
assert.match(authorMarkup, /#added-photos:not\(\[hidden\]\)/);
assert.match(authorMarkup, /height: calc\(18 \* 1\.5 \* 16px \+ 1\.8rem\)/);
assert.match(authorMarkup, /#added-photos #media-pool/);
assert.match(authorMarkup, /overflow-y: auto/);
assert.match(authorMarkup, /\.upload-count/);
assert.match(authorMarkup, /id="photo-preview" hidden/);
assert.match(authorMarkup, /id="publish-trip"/);
assert.match(authorMarkup, /Hide from the public site/);
const publishAt = authorMarkup.indexOf('id="publish-trip"');
const addedAt = authorMarkup.indexOf('id="added-photos-toggle"');
const dropAt = authorMarkup.indexOf('id="add-drop"');
const noteAt = authorMarkup.indexOf('id="day-body"');
const poolAt = authorMarkup.indexOf('id="media-pool"');
const coverAt = authorMarkup.indexOf('id="cover-toggle"');
assert.ok(coverAt !== -1 && dropAt > coverAt && noteAt > dropAt && poolAt > noteAt && publishAt > poolAt);
assert.match(authorMarkup, /name="kind" value="trip"/);
assert.match(authorMarkup, /name="kind" value="outing"/);
assert.match(authorMarkup, /Day trip/);
assert.match(authorMarkup, /id="media-pool"/);
assert.match(authorMarkup, /class="upload-file"/);
assert.match(authorMarkup, /<progress/);
assert.match(authorMarkup, /button\.pool-thumb/);
assert.match(authorMarkup, /width: 7\.5rem/);
assert.match(authorMarkup, /object-fit: cover/);
assert.match(authorMarkup, /id="details-form"/);
assert.match(authorMarkup, /id="details-title"/);
assert.match(authorMarkup, /id="details-location"/);
assert.match(authorMarkup, /id="details-date"/);
assert.match(authorMarkup, /id="details-end"/);
assert.match(authorMarkup, /Save details/);
const authorUi = readFileSync(new URL("../src/lib/github/author-ui.ts", import.meta.url), "utf8");
assert.match(authorUi, /gatedMediaUrl\(trip\.slug, item\.filename\)/);
assert.match(authorUi, /img\.src = src/);
assert.match(authorUi, /video\.src = src/);
assert.match(authorUi, /placedImageMarkdown/);
assert.match(authorUi, /placedVideoMarkdown/);
assert.match(authorUi, /draft: false/);
assert.match(authorUi, /kind: kind \|\| undefined/);
assert.match(authorUi, /dayNotesOutsideRange/);
assert.match(authorUi, /dateRangeRefusal/);
assert.match(authorUi, /path: trip\.indexPath/);
assert.equal(authorUi.includes("setAddOpen"), false);
assert.match(authorUi, /bindFileDrop\(addDrop/);
assert.match(authorUi, /dblclick/);
assert.match(authorUi, /filesFromTransfer/);
assert.match(authorUi, /media-input/);
assert.match(authorUi, /openPhotoPreview/);
const dropSource = readFileSync(new URL("../src/lib/github/drop-files.ts", import.meta.url), "utf8");
assert.match(dropSource, /getAsFile/);
assert.match(dropSource, /webkitGetAsEntry/);
assert.match(dropSource, /transfer\.items/);
assert.equal(dropSource.includes("file://"), false);
assert.match(authorUi, /className = "pool-thumb"/);
assert.match(authorUi, /beginUploadList/);
assert.match(authorUi, /createUploadQueue/);
assert.match(authorUi, /acceptMore/);
assert.match(authorUi, /progress\.addFiles/);
assert.match(authorUi, /progress\.setPreview/);
assert.equal(authorUi.includes("An upload is already running."), false);
assert.equal(UPLOAD_POOL_SIZE, 3);
const progressUi = readFileSync(new URL("../src/lib/github/upload-progress.ts", import.meta.url), "utf8");
assert.match(progressUi, /function isHeicFile/);
assert.match(progressUi, /addFiles\(more\)/);
assert.match(progressUi, /upload-count/);
assert.match(progressUi, /!isHeicFile\(file\)/);
const galleryUi = readFileSync(new URL("../src/lib/github/gallery-client.ts", import.meta.url), "utf8");
assert.match(galleryUi, /createUploadQueue/);
assert.match(galleryUi, /onReady/);
assert.match(galleryUi, /"preview"/);
assert.match(galleryUi, /"remote"/);
assert.match(authorUi, /setTimeout\(\(\) => \{/);
assert.match(authorUi, /700/);
assert.equal(authorUi.includes("name.textContent = item.filename"), false);
assert.match(authorUi, /classList\.toggle\("is-danger", !trip\.draft\)/);
assert.match(authorUi, /parsed\.data\.draft = nextDraft/);
assert.match(authorUi, /saveNotes\(\[\{ path: trip\.indexPath, text: index \}\]\)/);
assert.match(authorUi, /Open a trip before changing whether it is on the public site/);
assert.equal(authorUi.includes('bodyEl.addEventListener("click"'), false);
assert.equal(typeof uploadGalleryFiles, "function");
assert.equal(plannedMediaFilename("Clip.MP4"), "clip.mp4");
assert.equal(plannedMediaFilename("Photo.JPEG"), "photo.jpg");
assert.equal(plannedMediaFilename("Walk.mov"), "walk.mov");
const names = new Set(["clip.mp4", "shore.jpg"]);
const hashes = new Map([
  ["abc", "shore.jpg"],
  ["vid", "clip.mp4"],
]);
assert.equal(mediaDuplicate("clip.mp4", "different", names, hashes), true);
assert.equal(mediaDuplicate("other.mp4", "vid", names, hashes), true);
assert.equal(mediaDuplicate("shore.jpg", "fresh", names, hashes), true);
assert.equal(mediaDuplicate("other.mp4", "fresh", names, hashes), false);
assert.equal(mediaDuplicate("second.jpg", "abc", names, hashes), true);
assert.equal(skippedNote("clip.mp4"), "Skipped clip.mp4 because it is already there.");
assert.equal(skippedNote("shore.jpg"), "Skipped shore.jpg because it is already there.");
const sameVideo = await sha256Hex(new TextEncoder().encode("same-video-bytes"));
const otherVideo = await sha256Hex(new TextEncoder().encode("other-video-bytes"));
assert.notEqual(sameVideo, otherVideo);
assert.equal(mediaDuplicate("new.mp4", sameVideo, new Set(), new Map([[sameVideo, "clip.mp4"]])), true);
assert.equal(mediaDuplicate("new.mp4", otherVideo, new Set(), new Map([[sameVideo, "clip.mp4"]])), false);

const kept = [
  { date: "2026-09-05", text: "Ferry at dawn.\n" },
  { date: "2026-09-06", text: "\n" },
  { date: "2026-09-08", text: "Rain in the Hoh.\n" },
];
assert.deepEqual(dayNotesOutsideRange(kept, "2026-09-04", "2026-09-09"), []);
assert.deepEqual(dayNotesOutsideRange(kept, "2026-09-05", "2026-09-08"), []);
assert.deepEqual(dayNotesOutsideRange(kept, "2026-09-06", "2026-09-08"), ["2026-09-05"]);
assert.deepEqual(dayNotesOutsideRange(kept, "2026-09-05", "2026-09-07"), ["2026-09-08"]);
assert.deepEqual(dayNotesOutsideRange(kept, "2026-09-05", ""), ["2026-09-08"]);
assert.deepEqual(
  dayNotesOutsideRange(
    [
      { date: "2026-07-04", text: "   \n" },
      { date: "2026-07-05", text: "" },
    ],
    "2026-07-04",
    "",
  ),
  [],
);
const dropped = dayNotesOutsideRange(kept, "2026-09-06", "2026-09-07");
assert.deepEqual(dropped, ["2026-09-05", "2026-09-08"]);
assert.equal(
  dateRangeRefusal(dropped),
  "Cannot save these dates. These day notes would no longer be in the trip: 2026-09-05, 2026-09-08. The notes were left in place.",
);
const preview = `<img src="${gatedMediaUrl("olympic-peninsula", "img-5123-2.jpg")}" alt="img-5123-2.jpg" />`;
assert.match(preview, /src="\/travel-log\/media\/olympic-peninsula\/photos\/img-5123-2\.jpg"/);
assert.equal(preview.includes("r2.dev"), false);

console.log("github author checks ok");
