import assert from "node:assert/strict";
import {
  applySiteBase,
  buildCommitRequest,
  buildTreeRequest,
  dayRepoPath,
  gitCommitPlan,
  imageMarkdownUrl,
  mediaObjectKey,
  photoPathsInMarkdown,
  routeRepoPath,
} from "../src/lib/github/commit-plan.ts";
import { convertHeicFile } from "../src/lib/github/media.ts";
import { reencodePhoto } from "../src/lib/github/strip-photo.ts";
import { mediaPublicUrl, storageConfigError } from "../workers/media/src/config.js";
import { mediaWorkerOrigin } from "../src/lib/github/upload.ts";
import { checkLogin, respondToMediaGet, safeNext } from "../workers/media/src/gate.js";
import { isTripCoverPath, renderJournal, setCoverFrontmatter } from "../workers/media/src/journal.js";
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

console.log("github author checks ok");
