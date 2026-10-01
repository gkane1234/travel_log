/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare module "heic-convert" {
  export default function convert(options: {
    buffer: Buffer;
    format: "JPEG" | "PNG";
    quality?: number;
  }): Promise<ArrayBuffer>;
}

declare module "ffmpeg-static" {
  const path: string | null;
  export default path;
}
