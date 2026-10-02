import { plannedMediaFilename, prepareDroppedFile } from "./media.ts";
import { hashesForMedia, mediaDuplicate, rememberMediaHash, sha256Hex, skippedNote } from "./duplicates.ts";
import { makePoster, posterObjectKey } from "./poster.ts";
import { uploadToBucket } from "./upload.ts";

export type GalleryUpload = {
  url: string;
  kind: "photo" | "video";
  filename: string;
  posterFailed?: boolean;
};

export type GalleryUploadResult = {
  added: GalleryUpload[];
  error: string;
  skipped: string[];
};

/** Upload photos and videos into a trip gallery. Day notes are left unchanged. */
export async function uploadGalleryFiles(
  slug: string,
  files: File[],
  existing: Set<string>,
  onStatus: (message: string) => void,
  onFile?: (index: number, phase: "queued" | "preparing" | "uploading" | "done" | "skipped" | "failed", ratio?: number, note?: string) => void,
): Promise<GalleryUploadResult> {
  const added: GalleryUpload[] = [];
  const problems: string[] = [];
  const skipped: string[] = [];
  const routes = new Set<string>();
  onStatus("Checking files already on this trip…");
  files.forEach((_, index) => onFile?.(index, "queued"));
  let hashes;
  try {
    hashes = await hashesForMedia(slug, existing);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not check files already on this trip.";
    files.forEach((_, index) => onFile?.(index, "failed", undefined, message));
    return { added, error: message, skipped };
  }
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const planned = plannedMediaFilename(file.name);
    if (planned && mediaDuplicate(planned, "", existing, hashes)) {
      skipped.push(file.name);
      onFile?.(index, "skipped", undefined, skippedNote(file.name));
      onStatus(skippedNote(file.name));
      continue;
    }
    onFile?.(index, "preparing");
    onStatus(`Preparing ${index + 1} of ${files.length}: ${file.name}`);
    let prepared;
    try {
      prepared = await prepareDroppedFile(file, slug, existing, routes);
    } catch (error) {
      const message = error instanceof Error ? error.message : `Could not add ${file.name}.`;
      problems.push(message);
      onFile?.(index, "failed", undefined, message);
      continue;
    }
    if (prepared.kind !== "photo" && prepared.kind !== "video") {
      const message = `${file.name} is not a photo or video.`;
      problems.push(message);
      onFile?.(index, "failed", undefined, message);
      continue;
    }
    if (!prepared.objectKey || !prepared.contentType) {
      const message = `Could not prepare ${file.name}.`;
      problems.push(message);
      onFile?.(index, "failed", undefined, message);
      continue;
    }
    const hash = await sha256Hex(prepared.bytes);
    if (mediaDuplicate("", hash, existing, hashes)) {
      existing.delete(prepared.filename);
      skipped.push(file.name);
      onFile?.(index, "skipped", undefined, skippedNote(file.name));
      onStatus(skippedNote(file.name));
      continue;
    }
    onFile?.(index, "uploading", 0);
    onStatus(`Uploading ${index + 1} of ${files.length}: ${prepared.filename}`);
    try {
      await uploadToBucket({
        workerUrl: location.origin,
        token: "",
        objectKey: prepared.objectKey,
        bytes: prepared.bytes,
        contentType: prepared.contentType,
        onProgress: (ratio) => onFile?.(index, "uploading", ratio),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : `Upload of ${file.name} failed.`;
      problems.push(message);
      onFile?.(index, "failed", undefined, message);
      continue;
    }
    let posterFailed = false;
    if (prepared.kind === "photo") {
      try {
        const posterBlob = await makePoster(new Blob([prepared.bytes], { type: "image/jpeg" }));
        await uploadToBucket({
          workerUrl: location.origin,
          token: "",
          objectKey: posterObjectKey(slug, prepared.filename),
          bytes: new Uint8Array(await posterBlob.arrayBuffer()),
          contentType: "image/jpeg",
        });
      } catch {
        posterFailed = true;
      }
    }
    added.push({
      url: `/travel-log/media/${slug}/photos/${prepared.filename}`,
      kind: prepared.kind,
      filename: prepared.filename,
      posterFailed,
    });
    hashes.set(hash, prepared.filename);
    rememberMediaHash(slug, prepared.filename, hash);
    onFile?.(index, "done", 1, posterFailed ? "Done. Login poster failed." : "Done");
  }
  return { added, error: problems[0] || "", skipped };
}

if (typeof window !== "undefined") {
  (window as Window & { travelLogUploadGallery?: typeof uploadGalleryFiles }).travelLogUploadGallery = uploadGalleryFiles;
}
