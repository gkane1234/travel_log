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
}): Promise<string> {
  const workerUrl = mediaWorkerOrigin(options.workerUrl);
  if (!workerUrl) {
    throw new Error(
      "Media upload URL is not set. Add it in GitHub settings. Photos and videos are not saved in the git repo.",
    );
  }
  if (!options.token) {
    throw new Error("Sign in with a GitHub token, or set an upload token, before adding photos.");
  }

  let signed: SignedUpload;
  try {
    const response = await fetch(`${workerUrl}/travel-log/sign`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key: options.objectKey,
        contentType: options.contentType,
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

  const put = await fetch(signed.uploadUrl, {
    method: "PUT",
    headers: signed.headers ?? { "content-type": options.contentType },
    body: options.bytes,
  });
  if (!put.ok) {
    throw new Error(`Upload of ${options.objectKey.split("/").pop()} failed (${put.status}). The note was not committed.`);
  }
  if (!/^https?:\/\//i.test(signed.publicUrl)) {
    throw new Error("Media storage did not return a public http(s) URL.");
  }
  return signed.publicUrl;
}
