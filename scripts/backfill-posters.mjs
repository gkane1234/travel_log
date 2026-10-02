import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const root = join(import.meta.dirname, "..");
const commit = "4da184b^";
const slug = "olympic-peninsula";
const prefix = `trips/${slug}/photos`;
const list = execFileSync("git", ["ls-tree", "-r", "--name-only", commit, prefix], {
  cwd: root,
  encoding: "utf8",
});
const files = list.split(/\r?\n/).filter(Boolean);
const dir = mkdtempSync(join(tmpdir(), "travel-posters-"));
const wrangler = join(root, "workers", "media", "node_modules", "wrangler", "bin", "wrangler.js");
const wrote = [];
const skipped = [];

async function render(bytes, quality) {
  let image = sharp(bytes).rotate().resize(320, 320, { fit: "inside", withoutEnlargement: true });
  try {
    image = image.blur(8);
    return await image.jpeg({ quality, mozjpeg: true }).toBuffer();
  } catch {
    return sharp(bytes).rotate().resize(320, 320, { fit: "inside", withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer();
  }
}

for (const path of files) {
  const name = path.split("/").pop() || path;
  if (!/\.(jpe?g|png|webp|gif)$/i.test(name)) {
    skipped.push(`${name} (not a still photo)`);
    continue;
  }
  let bytes;
  try {
    bytes = execFileSync("git", ["cat-file", "blob", `${commit}:${path}`], {
      cwd: root,
      maxBuffer: 80 * 1024 * 1024,
    });
  } catch {
    skipped.push(`${name} (could not read the file)`);
    continue;
  }
  const base = name.replace(/\.[^.]+$/, "");
  const key = `posters/${slug}/${base}.jpg`;
  try {
    let quality = 45;
    let out = await render(bytes, quality);
    while (out.length > 100 * 1024 && quality > 20) {
      quality -= 8;
      out = await render(bytes, quality);
    }
    if (out.length > 120 * 1024) {
      skipped.push(`${name} (poster stayed over 120KB)`);
      continue;
    }
    const file = join(dir, `${base}.jpg`);
    writeFileSync(file, out);
    execFileSync(process.execPath, [
      wrangler,
      "r2",
      "object",
      "put",
      `travel-log-media/${key}`,
      "--remote",
      "--file",
      file,
      "--content-type",
      "image/jpeg",
    ], {
      cwd: join(root, "workers", "media"),
      stdio: "inherit",
    });
    wrote.push(`${key} (${out.length} bytes)`);
  } catch (error) {
    skipped.push(`${name} (${error instanceof Error ? error.message : "could not make a poster"})`);
  }
}

rmSync(dir, { recursive: true, force: true });
console.log(`\nWrote ${wrote.length} posters.`);
for (const line of wrote) console.log(`  ${line}`);
if (skipped.length) {
  console.log(`Skipped ${skipped.length}:`);
  for (const line of skipped) console.log(`  ${line}`);
}
