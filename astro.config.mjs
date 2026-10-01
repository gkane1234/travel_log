import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import node from "@astrojs/node";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tripMediaPlugin } from "./src/lib/trip-media-plugin.ts";
import { authorApiPlugin } from "./src/lib/author-api-plugin.ts";

const root = path.dirname(fileURLToPath(import.meta.url));
const astroDir = path.join(root, ".astro");

/** Keep .astro present and out of Vite's watch loop (Windows rename races). */
function stabilizeAstroCache() {
  return {
    name: "stabilize-astro-cache",
    configResolved() {
      fs.mkdirSync(astroDir, { recursive: true });
    },
    configureServer() {
      fs.mkdirSync(astroDir, { recursive: true });
    },
  };
}

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [mdx()],
  vite: {
    plugins: [stabilizeAstroCache(), tripMediaPlugin(root), authorApiPlugin()],
    resolve: {
      alias: {
        "@components": path.join(root, "src/components"),
        "@layouts": path.join(root, "src/layouts"),
        "@lib": path.join(root, "src/lib"),
      },
    },
    server: {
      fs: {
        allow: [root],
      },
      watch: {
        // Vite watching Astro's data-store write/rename on Windows causes ENOENT
        // races (UnknownFilesystemError). Media folders only change via Author.
        ignored: [
          "**/.astro/**",
          "**/trips/**/photos/**",
          "**/trips/**/routes/**",
          "**/Olympic Peninsula/**",
          "**/dist/**",
        ],
      },
    },
  },
});
