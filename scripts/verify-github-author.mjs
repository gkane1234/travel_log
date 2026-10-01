import assert from "node:assert/strict";
import { buildCommitRequest, buildTreeRequest, dayRepoPath, photoRepoPath } from "../src/lib/github/commit-plan.ts";
import { convertHeicFile } from "../src/lib/github/media.ts";

const day = dayRepoPath("olympic-peninsula", "2026-09-08");
const photo = photoRepoPath("olympic-peninsula", "img-5123.jpg");
const tree = buildTreeRequest("base-tree-sha", [
  { path: day, sha: "day-blob" },
  { path: photo, sha: "photo-blob" },
]);

assert.equal(tree.base_tree, "base-tree-sha");
assert.deepEqual(
  tree.tree.map((entry) => entry.path),
  [day, photo],
);
assert.equal(tree.tree[0].mode, "100644");
assert.equal(tree.tree[0].type, "blob");
assert.equal(tree.tree[1].sha, "photo-blob");

const commit = buildCommitRequest("Save Olympic Peninsula notes for 2026-09-08", "new-tree", "parent-sha");
assert.equal(commit.message, "Save Olympic Peninsula notes for 2026-09-08");
assert.deepEqual(commit.parents, ["parent-sha"]);
assert.equal(commit.tree, "new-tree");

let failed = false;
try {
  await convertHeicFile(new Blob(["not a heic file"], { type: "image/heic" }));
} catch (error) {
  failed = true;
  assert.match(String(error instanceof Error ? error.message : error), /Export a JPEG/);
}
assert.equal(failed, true);
console.log("github author checks ok");
