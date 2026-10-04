import { plannedMediaFilename, prepareDroppedFile } from "./media.ts";
import { hashesForMedia, mediaDuplicate, rememberMediaHash, sha256Hex, skippedNote } from "./duplicates.ts";
import { makePoster, posterObjectKey } from "./poster.ts";
import { createGate, createUploadQueue } from "./upload-pool.ts";
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

type FileNotice = (
  index: number,
  phase: "queued" | "preparing" | "uploading" | "done" | "skipped" | "failed" | "preview" | "remote",
  ratio?: number,
  note?: string,
  preview?: Blob | string,
) => void;

/** Upload photos and videos into a trip gallery. Later calls while one batch is running append to it. */
export async function uploadGalleryFiles(
  slug: string,
  files: File[],
  existing: Set<string>,
  onStatus: (message: string) => void,
  onFile?: FileNotice,
  onReady?: (append: (more: File[]) => void) => void,
): Promise<GalleryUploadResult> {
  const added: GalleryUpload[] = [];
  const problems: string[] = [];
  const skipped: string[] = [];
  const routes = new Set<string>();
  const claimed = new Set<string>();
  const pendingHashes = new Set<string>();
  const gate = createGate();
  const buffered: File[][] = [];
  let nextIndex = 0;
  let ingest = (batch: File[]) => {
    buffered.push(batch);
  };
  ingest(files);
  onReady?.((batch) => ingest(batch));
  onStatus("Checking files already on this trip…");
  let hashes;
  try {
    hashes = await hashesForMedia(slug, existing);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not check files already on this trip.";
    buffered.flat().forEach((file, index) => onFile?.(index, "failed", undefined, message));
    return { added, error: message, skipped };
  }
  const queue = createUploadQueue(async (job: { file: File; index: number }) => {
    const { file, index } = job;
    const planned = plannedMediaFilename(file.name);
    onFile?.(index, "preparing");
    let prepared;
    try {
      prepared = await prepareDroppedFile(file, slug, existing, routes);
    } catch (error) {
      if (planned) claimed.delete(planned);
      const message = error instanceof Error ? error.message : `Could not add ${file.name}.`;
      problems.push(message);
      onFile?.(index, "failed", undefined, message);
      return;
    }
    if (prepared.kind !== "photo" && prepared.kind !== "video") {
      if (planned) claimed.delete(planned);
      const message = `${file.name} is not a photo or video.`;
      problems.push(message);
      onFile?.(index, "failed", undefined, message);
      return;
    }
    if (!prepared.objectKey || !prepared.contentType) {
      if (planned) claimed.delete(planned);
      const message = `Could not prepare ${file.name}.`;
      problems.push(message);
      onFile?.(index, "failed", undefined, message);
      return;
    }
    let hash = "";
    if (prepared.kind === "photo") {
      await new Promise((resolve) => setTimeout(resolve, 0));
      hash = await sha256Hex(prepared.bytes);
      const duplicate = await gate(() => {
        if (mediaDuplicate("", hash, existing, hashes) || pendingHashes.has(hash)) {
          existing.delete(prepared.filename);
          return true;
        }
        pendingHashes.add(hash);
        hashes.set(hash, prepared.filename);
        return false;
      });
      if (duplicate) {
        skipped.push(file.name);
        onFile?.(index, "skipped", undefined, skippedNote(file.name));
        return;
      }
    }
    if (prepared.kind === "photo") {
      onFile?.(index, "preview", undefined, undefined, new Blob([prepared.bytes], { type: prepared.contentType }));
    }
    onFile?.(index, "uploading", 0);
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
      hashes.delete(hash);
      pendingHashes.delete(hash);
      existing.delete(prepared.filename);
      if (planned) claimed.delete(planned);
      const message = error instanceof Error ? error.message : `Upload of ${file.name} failed.`;
      problems.push(message);
      onFile?.(index, "failed", undefined, message);
      return;
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
    rememberMediaHash(slug, prepared.filename, hash);
    onFile?.(index, "remote", undefined, `/travel-log/media/${slug}/photos/${prepared.filename}`);
    onFile?.(index, "done", 1, posterFailed ? "Done. Login poster failed." : "Done");
  });
  const take = (batch: File[]) => {
    const jobs: { file: File; index: number }[] = [];
    for (const file of batch) {
      const index = nextIndex;
      nextIndex += 1;
      const planned = plannedMediaFilename(file.name);
      if (planned && (claimed.has(planned) || mediaDuplicate(planned, "", existing, hashes))) {
        skipped.push(file.name);
        onFile?.(index, "skipped", undefined, skippedNote(file.name));
        continue;
      }
      if (planned) claimed.add(planned);
      jobs.push({ file, index });
    }
    queue.append(jobs);
  };
  ingest = take;
  const waiting = buffered.splice(0);
  waiting.forEach((batch) => take(batch));
  for (;;) {
    await queue.drained();
    if (queue.isIdle()) break;
  }
  return { added, error: problems[0] || "", skipped };
}

if (typeof window !== "undefined") {
  (window as Window & { travelLogUploadGallery?: typeof uploadGalleryFiles }).travelLogUploadGallery = uploadGalleryFiles;
}
