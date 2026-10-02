/** Small blurred JPEG for the public login background. No EXIF, because it is a canvas encode. */

export const POSTER_LONG_SIDE = 320;
export const POSTER_MAX_BYTES = 120 * 1024;

export function posterObjectKey(slug: string, filename: string): string {
  const base = filename.replace(/\.[^.]+$/i, "");
  return `posters/${slug}/${base}.jpg`;
}

export async function makePoster(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  try {
    const long = Math.max(bitmap.width, bitmap.height, 1);
    const scale = Math.min(1, POSTER_LONG_SIDE / long);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const tinyScale = 40 / Math.max(width, height);
    const tinyW = Math.max(1, Math.round(width * tinyScale));
    const tinyH = Math.max(1, Math.round(height * tinyScale));
    let quality = 0.45;
    let out = await paintPoster(bitmap, tinyW, tinyH, width, height, quality);
    while (out.size > 100 * 1024 && quality > 0.16) {
      quality = Math.round((quality - 0.08) * 100) / 100;
      out = await paintPoster(bitmap, tinyW, tinyH, width, height, quality);
    }
    if (out.size > POSTER_MAX_BYTES) throw new Error("Poster is too large.");
    return out;
  } finally {
    bitmap.close();
  }
}

async function paintPoster(
  bitmap: ImageBitmap,
  tinyW: number,
  tinyH: number,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  const tiny = makeCanvas(tinyW, tinyH);
  const tinyCtx = tiny.getContext("2d");
  if (!tinyCtx) throw new Error("Could not make a poster.");
  tinyCtx.drawImage(bitmap, 0, 0, tinyW, tinyH);
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not make a poster.");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tiny, 0, 0, width, height);
  return canvasBlob(canvas, quality);
}

function makeCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasBlob(canvas: OffscreenCanvas | HTMLCanvasElement, quality: number): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    const out = await canvas.convertToBlob({ type: "image/jpeg", quality });
    if (!out || out.size === 0) throw new Error("Could not make a poster.");
    return out;
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("Could not make a poster."))),
      "image/jpeg",
      quality,
    );
  });
}
