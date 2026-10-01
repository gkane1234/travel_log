import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const base = "http://localhost:4321";

async function j(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

function multipart(filename, data, type) {
  const boundary = "----VerifyBoundary7";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
  );
  const mid = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([head, data, mid]),
    type: `multipart/form-data; boundary=${boundary}`,
  };
}

const trip = (
  await j(`${base}/api/author/trips`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Verify Loop",
      slug: "verify-loop",
      date: "2025-06-01",
      endDate: "2025-06-03",
      location: "Test Range",
      summary: "Automated verification trip",
    }),
  })
).trip;
console.log("created", trip.slug, trip.date, "->", trip.endDate);

let day = await j(
  `${base}/api/author/trips/verify-loop/days/2025-06-01?ensure=1`,
);
console.log("day1", day.date, "next", day.next, "canNext", day.canNext);
if (!day.canNext || day.next !== "2025-06-02") {
  throw new Error("expected next day 2025-06-02");
}
day = await j(
  `${base}/api/author/trips/verify-loop/days/${day.next}?ensure=1`,
);
console.log("day2", day.date, "exists", day.exists);

const jpg = await sharp({
  create: {
    width: 32,
    height: 24,
    channels: 3,
    background: { r: 40, g: 90, b: 60 },
  },
}).jpeg().toBuffer();

const mediaPart = multipart("trail.jpg", jpg, "image/jpeg");
const mediaRes = await fetch(`${base}/api/author/trips/verify-loop/media`, {
  method: "POST",
  headers: { "Content-Type": mediaPart.type },
  body: mediaPart.body,
});
const media = await mediaRes.json();
console.log("media", mediaRes.status, media);
if (!mediaRes.ok) throw new Error("media upload failed");

const gpx = Buffer.from(
  '<?xml version="1.0"?><gpx version="1.1"><trk><name>t</name><trkseg><trkpt lat="1" lon="2"/></trkseg></trk></gpx>',
);
const gpxPart = multipart("ridge.gpx", gpx, "application/gpx+xml");
const gpxRes = await fetch(`${base}/api/author/trips/verify-loop/gpx`, {
  method: "POST",
  headers: { "Content-Type": gpxPart.type },
  body: gpxPart.body,
});
const gpxJson = await gpxRes.json();
console.log("gpx", gpxRes.status, gpxJson);
if (!gpxRes.ok) throw new Error("gpx upload failed");

const body = [
  "Morning notes before media.",
  "",
  media.markdown,
  "",
  gpxJson.markdown,
  "",
].join("\n");
await j(`${base}/api/author/trips/verify-loop/days/2025-06-02`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ body }),
});
console.log("saved day with media + gpx");

const heicPath = path.join("Olympic Peninsula", "sept 5", "IMG_5123.HEIC");
if (fs.existsSync(heicPath)) {
  const heic = fs.readFileSync(heicPath);
  const heicPart = multipart("IMG_5123.HEIC", heic, "image/heic");
  const heicRes = await fetch(`${base}/api/author/trips/verify-loop/media`, {
    method: "POST",
    headers: { "Content-Type": heicPart.type },
    body: heicPart.body,
  });
  const heicJson = await heicRes.json();
  console.log("heic", heicRes.status, heicJson);
  if (!heicRes.ok) throw new Error("heic convert failed");
} else {
  console.log("heic skipped");
}

const home = await fetch(`${base}/`);
const tripPage = await fetch(`${base}/trips/example-trip/`);
const author = await fetch(`${base}/author`);
console.log(
  "pages",
  "home",
  home.status,
  "example",
  tripPage.status,
  "author",
  author.status,
);
const exampleHtml = await tripPage.text();
if (!exampleHtml.includes("Interactive map coming later")) {
  throw new Error("example trip missing map placeholder");
}
if (!exampleHtml.includes("2024-08-12") || !exampleHtml.includes("2024-08-13")) {
  throw new Error("example trip missing days");
}

const photoExists = fs.existsSync(
  path.join("trips", "verify-loop", "photos", media.filename),
);
const routeExists = fs.existsSync(
  path.join("trips", "verify-loop", "routes", gpxJson.filename),
);
console.log("files on disk", { photoExists, routeExists });
if (!photoExists || !routeExists) throw new Error("uploaded files missing");

console.log("VERIFY OK");
