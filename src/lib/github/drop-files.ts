const MEDIA_EXT = /\.(heic|heif|jpe?g|png|webp|gif|mov|mp4|m4v|webm)$/i;

/** Photos and videos only. A uri-list entry is not a file. */
export function isDroppedMedia(file: File): boolean {
  const type = file.type || "";
  if (type.startsWith("image/") || type.startsWith("video/")) return true;
  return MEDIA_EXT.test(file.name || "");
}

type FileEntry = {
  isFile?: boolean;
  file?: (ok: (file: File) => void, err: () => void) => void;
};

function fileFromItem(item: DataTransferItem): Promise<File | null> {
  return new Promise((resolve) => {
    if (item.kind !== "file") {
      resolve(null);
      return;
    }
    const entry = item.webkitGetAsEntry?.() as FileEntry | null;
    if (entry?.isFile && entry.file) {
      entry.file(
        (file) => resolve(file),
        () => resolve(item.getAsFile()),
      );
      return;
    }
    resolve(item.getAsFile());
  });
}

/**
 * Windows Photos and iCloud often leave dataTransfer.files empty.
 * Read items, then getAsFile / webkitGetAsEntry. Do not turn a dropped path into an image address.
 */
export async function filesFromTransfer(transfer: DataTransfer | null): Promise<File[]> {
  if (!transfer) return [];
  const found: File[] = [];
  const items = transfer.items ? Array.from(transfer.items) : [];
  for (const item of items) {
    const file = await fileFromItem(item);
    if (file && isDroppedMedia(file)) found.push(file);
  }
  if (!found.length && transfer.files?.length) {
    for (const file of Array.from(transfer.files)) {
      if (isDroppedMedia(file)) found.push(file);
    }
  }
  return found;
}
