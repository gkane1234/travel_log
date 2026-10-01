/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare module "heic-convert" {
  export default function convert(options: {
    buffer: Buffer;
    format: "JPEG" | "PNG";
    quality?: number;
  }): Promise<ArrayBuffer>;
}

declare module "heic2any" {
  export default function heic2any(options: {
    blob: Blob;
    toType?: string;
    quality?: number;
  }): Promise<Blob | Blob[]>;
}

declare module "ffmpeg-static" {
  const path: string | null;
  export default path;
}
