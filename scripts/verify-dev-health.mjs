import fs from "node:fs";
import path from "path";
import sharp from "sharp";

const base = "http://localhost:4321";

async function check(url) {
  const res = await fetch(base + url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  console.log("ok", url, res.status);
}

await check("/");
await check("/trips/example-trip/");
await check("/trips/olympic-peninsula/");
await check("/author");

const day = path.join("trips", "olympic-peninsula", "days", "2026-09-05.mdx");
const orig = fs.readFileSync(day, "utf8");
for (let i = 0; i < 8; i++) {
  fs.writeFileSync(day, `${orig}\n<!-- churn ${i} -->\n`);
  await new Promise((r) => setTimeout(r, 80));
  await check("/");
}
fs.writeFileSync(day, orig);

const jpg = await sharp({
  create: {
    width: 16,
    height: 16,
    channels: 3,
    background: { r: 10, g: 20, b: 30 },
  },
}).jpeg().toBuffer();
const boundary = "----FixBound";
const head = Buffer.from(
  `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="probe.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
);
const mid = Buffer.from(`\r\n--${boundary}--\r\n`);
const mediaRes = await fetch(`${base}/api/author/trips/olympic-peninsula/media`, {
  method: "POST",
  headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
  body: Buffer.concat([head, jpg, mid]),
});
const media = await mediaRes.json();
console.log("media", mediaRes.status, media.filename);
if (!mediaRes.ok) throw new Error("media failed");

await fetch(`${base}/api/author/trips/olympic-peninsula/days/2026-09-05`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    body: `${orig}\n\n${media.markdown}\n`,
  }),
});
await new Promise((r) => setTimeout(r, 800));
await check("/trips/olympic-peninsula/");
fs.writeFileSync(day, orig);

console.log("DEV CHECKS OK");
