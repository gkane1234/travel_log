export type UploadPhase = "queued" | "preparing" | "uploading" | "done" | "skipped" | "failed" | "preview" | "remote";

export type UploadRowUpdate = {
  ratio?: number;
  note?: string;
};

function previewUrl(file: File): string {
  try {
    const url = URL.createObjectURL(file);
    return url.startsWith("blob:") ? url : "";
  } catch {
    return "";
  }
}

function blobUrl(file: Blob): string {
  try {
    const url = URL.createObjectURL(file);
    return url.startsWith("blob:") ? url : "";
  } catch {
    return "";
  }
}

function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mp4|m4v|webm|mov)$/i.test(file.name);
}

function isHeicFile(file: File): boolean {
  return /\.(heic|heif)$/i.test(file.name) || file.type === "image/heic" || file.type === "image/heif";
}

function rowImage(row: HTMLLIElement): HTMLImageElement | null {
  return row.querySelector(".upload-preview img");
}

function imagePainted(img: HTMLImageElement | null): boolean {
  if (!img) return false;
  if (img.dataset.painted === "1") return true;
  return img.complete && img.naturalWidth > 0;
}

function revokeRow(row: HTMLElement): void {
  row.querySelectorAll("img, video").forEach((node) => {
    const owned = node instanceof HTMLImageElement ? node.dataset.owned || "" : "";
    const src = owned || node.getAttribute("src") || "";
    if (src.startsWith("blob:")) URL.revokeObjectURL(src);
  });
}

/**
 * Progress for one batch. Only the files in flight are listed.
 * A counter under the list is finished/total. Finished means done or skipped.
 */
export function beginUploadList(
  list: HTMLOListElement,
  template: HTMLTemplateElement,
  files: File[],
): {
  update(index: number, phase: UploadPhase, extra?: UploadRowUpdate): void;
  setPreview(index: number, source: Blob | string): void;
  fillIfBlank(index: number, url: string): void;
  addFiles(more: File[]): number;
} {
  const previousCount = list.nextElementSibling;
  if (previousCount instanceof HTMLElement && previousCount.classList.contains("upload-count")) {
    previousCount.remove();
  }
  list.querySelectorAll("img, video").forEach((node) => {
    const src = node.getAttribute("src") || "";
    if (src.startsWith("blob:")) URL.revokeObjectURL(src);
  });
  list.replaceChildren();

  const batch = [...files];
  const rows: Array<HTMLLIElement | null> = batch.map(() => null);
  const settled = new Set<number>();
  let finished = 0;
  let failures = 0;

  const count = document.createElement("p");
  count.className = "upload-count meta";
  list.insertAdjacentElement("afterend", count);

  function paintCount(): void {
    count.textContent = `${finished}/${batch.length}`;
    count.hidden = false;
    const active = rows.some((row) => row && row.dataset.phase !== "failed");
    const failedVisible = rows.some((row) => row && row.dataset.phase === "failed");
    list.hidden = !active && !failedVisible;
  }

  function finishBatch(): void {
    count.hidden = true;
    count.textContent = "";
    if (failures === 0) {
      rows.forEach((row) => {
        if (row) revokeRow(row);
      });
      list.replaceChildren();
      list.hidden = true;
    } else {
      list.hidden = false;
    }
  }

  function paintedImage(url: string, owned = ""): HTMLImageElement {
    const img = document.createElement("img");
    img.alt = "";
    img.dataset.painted = "0";
    if (owned) img.dataset.owned = owned;
    img.addEventListener("load", () => {
      img.dataset.painted = "1";
    });
    img.src = url;
    return img;
  }

  function ensureRow(index: number): HTMLLIElement | null {
    const existing = rows[index];
    if (existing) return existing;
    const file = batch[index];
    const row = template.content.firstElementChild?.cloneNode(true) as HTMLLIElement | null;
    if (!row || !file) return null;
    const name = row.querySelector(".upload-name");
    if (name) name.textContent = file.name;
    const preview = row.querySelector(".upload-preview");
    if (preview && isVideoFile(file)) {
      const url = previewUrl(file);
      if (url) {
        const video = document.createElement("video");
        video.src = url;
        video.muted = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.setAttribute("aria-label", file.name);
        video.addEventListener("loadeddata", () => {
          try {
            if (video.currentTime < 0.01) video.currentTime = 0.1;
          } catch {
            /* A missing frame still leaves the video tile. */
          }
        });
        preview.append(video);
      }
    } else if (preview && !isHeicFile(file)) {
      const url = previewUrl(file);
      if (url) preview.append(paintedImage(url));
    }
    rows[index] = row;
    list.append(row);
    list.hidden = false;
    return row;
  }

  function setPreview(index: number, source: Blob | string): void {
    if (settled.has(index)) return;
    const row = ensureRow(index);
    const preview = row?.querySelector(".upload-preview");
    if (!row || !preview || settled.has(index)) return;
    const previous = rowImage(row);
    const owned = previous?.dataset.owned || "";
    if (owned.startsWith("blob:")) URL.revokeObjectURL(owned);
    previous?.remove();
    const created = source instanceof Blob ? blobUrl(source) : "";
    const url = created || (typeof source === "string" ? source : "");
    if (!url || url.startsWith("file:")) return;
    preview.append(paintedImage(url, created));
  }

  function fillIfBlank(index: number, url: string): void {
    const row = rows[index];
    if (!row || !url || settled.has(index)) return;
    const img = rowImage(row);
    if (imagePainted(img)) return;
    if (!img || !img.getAttribute("src") || (img.complete && img.naturalWidth === 0)) {
      setPreview(index, url);
      return;
    }
    img.addEventListener(
      "error",
      () => {
        if (!imagePainted(img)) setPreview(index, url);
      },
      { once: true },
    );
  }

  function settle(index: number, phase: "done" | "skipped" | "failed"): void {
    if (settled.has(index)) return;
    settled.add(index);
    if (phase === "failed") failures += 1;
    else finished += 1;
    if (phase !== "failed") {
      const row = rows[index];
      if (row) {
        revokeRow(row);
        row.remove();
        rows[index] = null;
      }
    }
    if (settled.size === batch.length) finishBatch();
    else paintCount();
  }

  paintCount();

  return {
    addFiles(more) {
      const start = batch.length;
      for (const file of more) {
        batch.push(file);
        rows.push(null);
      }
      paintCount();
      return start;
    },
    setPreview,
    fillIfBlank,
    update(index, phase, extra) {
      if (settled.has(index)) return;
      if (phase === "queued" || phase === "preview") return;
      if (phase === "remote") {
        if (extra?.note) fillIfBlank(index, extra.note);
        return;
      }
      if (phase === "done" || phase === "skipped") {
        settle(index, phase);
        return;
      }
      if (phase === "failed") {
        const row = ensureRow(index);
        if (row) {
          row.dataset.phase = "failed";
          const bar = row.querySelector("progress");
          const note = row.querySelector(".upload-note");
          if (bar) bar.hidden = true;
          if (note) note.textContent = extra?.note || "Failed";
        }
        settle(index, "failed");
        return;
      }
      const row = ensureRow(index);
      if (!row || settled.has(index)) return;
      row.dataset.phase = phase;
      const bar = row.querySelector("progress");
      const note = row.querySelector(".upload-note");
      if (bar) bar.hidden = false;
      if (phase === "uploading") {
        if (bar) bar.value = extra?.ratio ?? 0;
        if (note) note.textContent = "Uploading";
        return;
      }
      if (bar) bar.removeAttribute("value");
      if (note) note.textContent = "Preparing";
    },
  };
}
