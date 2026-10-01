import assert from "node:assert/strict";
import {
  applySiteBase,
  buildCommitRequest,
  buildTreeRequest,
  dayRepoPath,
  gitCommitPlan,
  imageMarkdownUrl,
  routeRepoPath,
} from "../src/lib/github/commit-plan.ts";
import { convertHeicFile } from "../src/lib/github/media.ts";
import { storageConfigError } from "../workers/media/src/config.js";

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
    PUBLIC_BASE_URL: "https://media.example",
    UPLOAD_TOKEN: "device-only",
  }),
  null,
);

let failed = false;
try {
  await convertHeicFile(new Blob(["not a heic file"], { type: "image/heic" }));
} catch (error) {
  failed = true;
  assert.match(String(error instanceof Error ? error.message : error), /Export a JPEG/);
}
assert.equal(failed, true);
console.log("github author checks ok");
