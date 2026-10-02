/** Origin only. A pasted /travel-log suffix is removed so the sign path is not doubled. */
export function mediaWorkerOrigin(workerUrl: string): string {
  let base = workerUrl.trim().replace(/\/$/, "");
  if (base.endsWith("/travel-log")) base = base.slice(0, -"/travel-log".length);
  else if (base.endsWith("/travel_log")) base = base.slice(0, -"/travel_log".length);
  return base;
}

export type SignedUpload = {
  uploadUrl: string;
  publicUrl: string;
  headers?: Record<string, string>;
};

export async function uploadToBucket(options: {
  workerUrl: string;
  token: string;
  objectKey: string;
  bytes: Uint8Array;
  contentType: string;
  onProgress?: (ratio: number) => void;
}): Promise<string> {
  const workerUrl = mediaWorkerOrigin(options.workerUrl);
  if (!workerUrl) {
    throw new Error(
      "Media upload URL is not set. Add it in GitHub settings. Photos and videos are not saved in the git repo.",
    );
  }
  const same = typeof location !== "undefined" && workerUrl === location.origin;
  if (!options.token && !same) {
    throw new Error("Sign in to the travel log before adding photos.");
  }

  let signed: SignedUpload;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const response = await fetch(`${workerUrl}/travel-log/sign`, {
      method: "POST",
      credentials: same ? "include" : "omit",
      headers,
      body: JSON.stringify({
        key: options.objectKey,
        contentType: options.contentType,
        contentLength: options.bytes.byteLength,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; uploadUrl?: string; publicUrl?: string; headers?: Record<string, string> };
    if (!response.ok) {
      throw new Error(data.error || "Media storage refused the upload.");
    }
    if (!data.uploadUrl || !data.publicUrl) {
      throw new Error("Media storage did not return an upload address.");
    }
    signed = { uploadUrl: data.uploadUrl, publicUrl: data.publicUrl, headers: data.headers };
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Could not reach media storage.");
  }

  const headers = { ...(signed.headers ?? { "content-type": options.contentType }) };
  delete headers["content-length"];
  if (options.onProgress) {
    await putWithProgress(signed.uploadUrl, headers, options.bytes, options.onProgress, options.objectKey);
  } else {
    const put = await fetch(signed.uploadUrl, {
      method: "PUT",
      headers,
      body: options.bytes,
    });
    if (!put.ok) {
      throw new Error(`Upload of ${options.objectKey.split("/").pop()} failed (${put.status}). The note was not saved.`);
    }
  }
  if (!/^https?:\/\//i.test(signed.publicUrl)) {
    throw new Error("Media storage did not return a public http(s) URL.");
  }
  return signed.publicUrl;
}

function putWithProgress(
  url: string,
  headers: Record<string, string>,
  bytes: Uint8Array,
  onProgress: (ratio: number) => void,
  objectKey: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload of ${objectKey.split("/").pop()} failed (${xhr.status}). The note was not saved.`));
    };
    xhr.onerror = () => reject(new Error(`Upload of ${objectKey.split("/").pop()} failed. The note was not saved.`));
    xhr.send(bytes);
  });
}

export type TripNote = { path: string; text: string | null };

function notesEndpoint(workerUrl: string): { origin: string; same: boolean } {
  const origin = mediaWorkerOrigin(workerUrl) || (typeof location !== "undefined" ? location.origin : "");
  const same = typeof location !== "undefined" && origin === location.origin;
  return { origin, same };
}

async function postTravelLog(
  path: string,
  options: { workerUrl: string; token: string },
  body: unknown,
): Promise<Record<string, unknown>> {
  const { origin, same } = notesEndpoint(options.workerUrl);
  if (!origin) {
    throw new Error("Open the author at https://gabriel-kane.com/travel-log/author and sign in.");
  }
  if (!options.token && !same) {
    throw new Error("Sign in to the travel log before saving.");
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const response = await fetch(`${origin}/travel-log/${path}`, {
    method: "POST",
    credentials: same ? "include" : "omit",
    headers,
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error || "The travel log could not save that.");
  return data;
}

export async function writeTripNotes(options: {
  workerUrl: string;
  token: string;
  files: { path: string; text: string }[];
}): Promise<void> {
  await postTravelLog("notes", options, { files: options.files });
}

export async function readTripNotes(options: {
  workerUrl: string;
  token: string;
  paths: string[];
}): Promise<TripNote[]> {
  const data = await postTravelLog("notes/read", options, { paths: options.paths });
  const files = data.files;
  return Array.isArray(files) ? (files as TripNote[]) : [];
}

export async function listTripNoteKeys(options: { workerUrl: string; token: string }): Promise<string[]> {
  const data = await postTravelLog("notes/list", options, {});
  const keys = data.keys;
  return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string") : [];
}

export async function saveTripCover(options: {
  workerUrl: string;
  token: string;
  slug: string;
  cover: string;
}): Promise<void> {
  const workerUrl = mediaWorkerOrigin(options.workerUrl);
  if (!workerUrl) return;
  if (!options.token) {
    throw new Error("Sign in with a GitHub token, or set an upload token, before setting a thumbnail.");
  }
  const response = await fetch(`${workerUrl}/travel-log/cover`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ slug: options.slug, cover: options.cover }),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (response.status === 404) return;
  if (!response.ok) throw new Error(data.error || "Could not update the thumbnail on the site.");
}
