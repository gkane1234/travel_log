export type UploadPhase = "queued" | "preparing" | "uploading" | "done" | "skipped" | "failed";

export type UploadRowUpdate = {
  ratio?: number;
  note?: string;
};

function previewUrl(file: File): string {
  try {
    return URL.createObjectURL(file);
  } catch {
    return "";
  }
}

function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mp4|m4v|webm|mov)$/i.test(file.name);
}

/** Show one row per file immediately. Later calls move that row's bar or mark it skipped or failed. */
export function beginUploadList(
  list: HTMLOListElement,
  template: HTMLTemplateElement,
  files: File[],
): { update(index: number, phase: UploadPhase, extra?: UploadRowUpdate): void } {
  const previous = list.querySelectorAll("img, video");
  previous.forEach((node) => {
    const src = node.getAttribute("src") || "";
    if (src.startsWith("blob:")) URL.revokeObjectURL(src);
  });
  list.replaceChildren();
  list.hidden = false;
  const rows = files.map((file) => {
    const row = template.content.firstElementChild?.cloneNode(true) as HTMLLIElement | null;
    if (!row) throw new Error("Missing upload row.");
    const name = row.querySelector(".upload-name");
    if (name) name.textContent = file.name;
    const preview = row.querySelector(".upload-preview");
    const url = previewUrl(file);
    if (preview && url) {
      if (isVideoFile(file)) {
        const video = document.createElement("video");
        video.src = url;
        video.muted = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.setAttribute("aria-label", file.name);
        preview.append(video);
      } else {
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        preview.append(img);
      }
    }
    list.append(row);
    return row;
  });
  return {
    update(index, phase, extra) {
      const row = rows[index];
      if (!row) return;
      row.dataset.phase = phase;
      const bar = row.querySelector("progress");
      const note = row.querySelector(".upload-note");
      if (phase === "skipped") {
        if (bar) bar.hidden = true;
        if (note) note.textContent = extra?.note || "Skipped because it is already there.";
        return;
      }
      if (phase === "failed") {
        if (bar) {
          bar.hidden = false;
          bar.value = 0;
        }
        if (note) note.textContent = extra?.note || "Failed";
        return;
      }
      if (bar) bar.hidden = false;
      if (phase === "done") {
        if (bar) bar.value = 1;
        if (note) note.textContent = extra?.note || "Done";
        return;
      }
      if (phase === "uploading") {
        if (bar) bar.value = extra?.ratio ?? 0;
        if (note) note.textContent = "Uploading";
        return;
      }
      if (phase === "preparing") {
        if (bar) bar.removeAttribute("value");
        if (note) note.textContent = "Preparing";
        return;
      }
      if (bar) bar.value = 0;
      if (note) note.textContent = "Queued";
    },
  };
}
