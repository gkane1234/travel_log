import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tripMediaPlugin } from "./src/lib/trip-media-plugin.ts";
import { authorApiPlugin } from "./src/lib/author-api-plugin.ts";

const root = path.dirname(fileURLToPath(import.meta.url));
const astroDir = path.join(root, ".astro");

function pagesBase() {
  if (process.env.GITHUB_PAGES !== "true") return "/";
  const name = (process.env.GITHUB_REPOSITORY || "").split("/")[1] || "";
  if (!name || name.endsWith(".github.io")) return "/";
  return `/${name}`;
}

const base = pagesBase();

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

function copyTripMedia() {
  return {
    name: "copy-trip-media",
    hooks: {
      "astro:build:done": async ({ dir }) => {
        const out = fileURLToPath(dir);
        const tripsDir = path.join(root, "trips");
        if (!fs.existsSync(tripsDir)) return;
        const maxBytes = 90 * 1024 * 1024;
        for (const slug of fs.readdirSync(tripsDir)) {
          for (const folder of ["photos", "routes"]) {
            const from = path.join(tripsDir, slug, folder);
            if (!fs.existsSync(from)) continue;
            const dest = path.join(out, "trip-media", slug, folder);
            fs.mkdirSync(dest, { recursive: true });
            for (const name of fs.readdirSync(from)) {
              const src = path.join(from, name);
              const stat = fs.statSync(src);
              if (!stat.isFile()) continue;
              if (stat.size > maxBytes) {
                console.warn(`Skipping ${slug}/${folder}/${name}: larger than GitHub's file limit`);
                continue;
              }
              fs.copyFileSync(src, path.join(dest, name));
            }
          }
        }
        const prefix = base === "/" ? "/" : `${base}/`;
        const manifest = {
          name: "Travel Log",
          short_name: "Travel Log",
          description: "Trips we've taken together.",
          start_url: `${prefix}author/`,
          scope: prefix,
          display: "standalone",
          background_color: "#f3efe6",
          theme_color: "#2e4a3e",
          icons: [
            { src: `${prefix}icons/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
            {
              src: `${prefix}icons/icon-512.png`,
              sizes: "512x512",
              type: "image/png",
              purpose: "any maskable",
            },
          ],
        };
        fs.writeFileSync(path.join(out, "manifest.webmanifest"), JSON.stringify(manifest, null, 2));
      },
    },
  };
}

export default defineConfig({
  output: "static",
  site:
    process.env.GITHUB_PAGES === "true" && process.env.GITHUB_REPOSITORY_OWNER
      ? `https://${process.env.GITHUB_REPOSITORY_OWNER}.github.io`
      : undefined,
  base: base === "/" ? undefined : base,
  trailingSlash: "always",
  integrations: [mdx(), copyTripMedia()],
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
