/** Re-encode a photo so the uploaded bytes are not the original file. */
export async function reencodePhoto(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not re-encode this photo.");
      ctx.drawImage(bitmap, 0, 0);
      const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
      if (!out || out.size === 0) throw new Error("Could not re-encode this photo.");
      return out;
    }
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not re-encode this photo.");
    ctx.drawImage(bitmap, 0, 0);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("Could not re-encode this photo."))),
        "image/jpeg",
        0.9,
      );
    });
  } finally {
    bitmap.close();
  }
}
