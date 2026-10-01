import fs from "node:fs";
import sharp from "sharp";

fs.mkdirSync("public/icons", { recursive: true });

function svg(size) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#2e4a3e"/><text x="50%" y="58%" text-anchor="middle" font-family="Georgia" font-size="${Math.round(size * 0.46)}" fill="#f3efe6">T</text></svg>`,
  );
}

await sharp(svg(192)).png().toFile("public/icons/icon-192.png");
await sharp(svg(512)).png().toFile("public/icons/icon-512.png");
await sharp(svg(180)).png().toFile("public/icons/apple-touch-icon.png");
console.log("icons ok");
