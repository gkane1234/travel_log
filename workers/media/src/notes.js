const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const NOTE_KEY = new RegExp(
  `^trips/${SLUG}/(?:index\\.md|days/\\d{4}-\\d{2}-\\d{2}\\.(?:md|mdx)|routes/[a-z0-9][a-z0-9._-]{0,160}\\.gpx)$`,
);

function noteError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function tripNoteKey(path) {
  const key = String(path || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (key.includes("..") || !NOTE_KEY.test(key)) return "";
  return key;
}

export async function putTripNotes(bucket, files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 20) {
    throw noteError("Send one or more trip notes.", 400);
  }
  const written = [];
  for (const file of files) {
    const key = tripNoteKey(file && file.path);
    if (!key) throw noteError("That file is not a trip note.", 400);
    if (file.text != null && typeof file.text !== "string") throw noteError("Trip notes must be text.", 400);
    const text = typeof file.text === "string" ? file.text : "";
    if (text.length > 500000) throw noteError("That note is too large.", 400);
    const type = key.endsWith(".gpx") ? "application/gpx+xml" : "text/markdown; charset=utf-8";
    await bucket.put(key, text, { httpMetadata: { contentType: type } });
    written.push(key);
  }
  return written;
}

export async function readTripNotes(bucket, paths) {
  if (!Array.isArray(paths) || paths.length > 40) throw noteError("Too many notes.", 400);
  const files = [];
  for (const path of paths) {
    const key = tripNoteKey(path);
    if (!key) throw noteError("That file is not a trip note.", 400);
    const object = await bucket.get(key);
    files.push({ path: key, text: object ? await object.text() : null });
  }
  return files;
}

export async function listTripNoteKeys(bucket) {
  const keys = [];
  let cursor;
  do {
    const listed = await bucket.list({ prefix: "trips/", cursor });
    for (const object of listed.objects) {
      if (tripNoteKey(object.key)) keys.push(object.key);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return keys;
}
