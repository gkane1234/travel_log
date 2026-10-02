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
import { convertHeicFile } from "../src/lib/github/media.ts";
import { reencodePhoto } from "../src/lib/github/strip-photo.ts";
import { POSTER_MAX_BYTES, isPosterKey, mediaPublicUrl, storageConfigError } from "../workers/media/src/config.js";
import { mediaWorkerOrigin } from "../src/lib/github/upload.ts";
import { checkLogin, loginPage, respondToMediaGet, safeNext } from "../workers/media/src/gate.js";
import { isTripCoverPath, publicTripCards, renderJournal, setCoverFrontmatter } from "../workers/media/src/journal.js";
import { posterStage } from "../workers/media/src/motion.js";
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

let failed = false;
try {
  await convertHeicFile(new Blob(["not a heic file"], { type: "image/heic" }));
} catch (error) {
  failed = true;
  assert.match(String(error instanceof Error ? error.message : error), /Export a JPEG/);
}
assert.equal(failed, true);

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
const home = await renderJournal(bucket, new URL("https://gabriel-kane.com/travel-log/"));
const homeHtml = await home.text();
assert.match(homeHtml, /id="motion-layer"/);
assert.match(homeHtml, /id="motion-debug"/);
assert.match(homeHtml, /Peak opacity/);
assert.match(homeHtml, /Travel distance \(% of screen\)/);
assert.match(homeHtml, /pointer-events: none/);
assert.match(homeHtml, /\/travel-log\/media\/olympic-peninsula\/photos\/img-5123-2\.jpg/);
assert.match(homeHtml, /<img class="thumb" src="\/travel-log\/media\/olympic-peninsula\/photos\/img-5123-2\.jpg" alt="" \/>/);
assert.equal(homeHtml.includes("r2.dev"), false);
assert.equal(homeHtml.includes("example-trip") && homeHtml.includes("<img"), true);
const tripPage = await renderJournal(bucket, new URL("https://gabriel-kane.com/travel-log/trips/olympic-peninsula"));
const tripHtml = await tripPage.text();
assert.match(tripHtml, /<img class="cover" src="\/travel-log\/media\/olympic-peninsula\/photos\/img-5123-2\.jpg"/);

files.set(
  "trips/olympic-peninsula/index.md",
  "---\ntitle: Olympic Peninsula\ndate: 2026-09-05\ncover: /trip-media/olympic-peninsula/photos/picked.jpg\ndraft: false\n---\n",
);
const picked = await renderJournal(bucket, new URL("https://gabriel-kane.com/travel-log/"));
assert.match(await picked.text(), /src="\/travel-log\/media\/olympic-peninsula\/photos\/picked\.jpg"/);

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
const coastHome = await renderJournal(writable, new URL("https://gabriel-kane.com/travel-log/"));
assert.match(await coastHome.text(), /Coast Walk/);
const coastPage = await renderJournal(writable, new URL("https://gabriel-kane.com/travel-log/trips/coast"));
assert.match(await coastPage.text(), /Saw a heron/);

assert.equal(isPosterKey("posters/olympic-peninsula/img-5123-2.jpg"), true);
assert.equal(isPosterKey("media/olympic-peninsula/photos/img-5123-2.jpg"), false);
assert.equal(isPosterKey("posters/../media/secret.jpg"), false);
assert.equal(POSTER_MAX_BYTES, 120 * 1024);

files.set("posters/olympic-peninsula/img-5123-2.jpg", "");
files.set("posters/olympic-peninsula/notes.txt", "private day text");
const cards = await publicTripCards(bucket);
assert.equal(cards.length, 1);
assert.deepEqual(cards[0].posters, ["/travel-log/posters/olympic-peninsula/img-5123-2.jpg"]);
assert.equal(JSON.stringify(cards).includes("/travel-log/media/"), false);
assert.equal(JSON.stringify(cards).includes("private day text"), false);
const loginHtml = await (await loginPage("", "Wrong username or password.", posterStage(cards))).text();
assert.match(loginHtml, /Gabe and Julia's Travel Log/);
assert.match(loginHtml, /\/travel-log\/posters\/olympic-peninsula\/img-5123-2\.jpg/);
assert.match(loginHtml, /Sep 5, 2026/);
assert.match(loginHtml, /Wrong username or password/);
assert.equal(loginHtml.includes("/travel-log/media/"), false);
assert.equal(loginHtml.includes("private day text"), false);

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
assert.match(authorMarkup, /id="media-pool"/);
const authorUi = readFileSync(new URL("../src/lib/github/author-ui.ts", import.meta.url), "utf8");
assert.match(authorUi, /gatedMediaUrl\(trip\.slug, item\.filename\)/);
assert.match(authorUi, /img\.src = src/);
assert.match(authorUi, /video\.src = src/);
assert.match(authorUi, /placedImageMarkdown/);
assert.match(authorUi, /placedVideoMarkdown/);
const preview = `<img src="${gatedMediaUrl("olympic-peninsula", "img-5123-2.jpg")}" alt="img-5123-2.jpg" />`;
assert.match(preview, /src="\/travel-log\/media\/olympic-peninsula\/photos\/img-5123-2\.jpg"/);
assert.equal(preview.includes("r2.dev"), false);

console.log("github author checks ok");
