# Travel Log

Astro site for trip journals. Public pages (`/` and `/trips/<slug>/`) are built from the markdown in `trips/`. The author page is a browser app. Save commits that same markdown to GitHub, and GitHub Actions publishes the site to GitHub Pages. PC, Mac, and iPhone all use that one page.

## Run locally

```bash
npm install
npm run dev
```

`npm run dev` stops any stale process on port 4321 first.

- Site: http://localhost:4321/
- Author: http://localhost:4321/author/

`npm run build` writes the static site to `dist/`. `npm start` previews that build on port 4322. The live site is GitHub Pages, not a personal server.

## Author

Open `/author/`. The first time, enter a GitHub personal access token and the repo (`owner` / `travel_log`). Those stay in this browser’s localStorage only. They are not in the repo.

Save day, or drop a photo, video, or GPX, and the page creates one Git commit through the Git Data API. The commit includes the day note and any new files. HEIC photos become JPEG in the browser. JPEG, PNG, and WebP upload as-is. MP4 and smaller MOV files upload as-is. Files over about 100 MB are refused. A failed save leaves the text in the editor.

After the commit, the Pages workflow rebuilds the public site.

Create a token at GitHub → Settings → Developer settings → Personal access tokens. Classic tokens need the `repo` scope. Fine-grained tokens need read and write on Contents for this repository.

## Install

- Windows: `powershell -File scripts/author-shortcut.ps1 -Url "https://gkane1234.github.io/travel_log/author/"`. That puts a shortcut on the desktop. With no `-Url`, it opens the local author page.
- Mac: `scripts/open-author.command https://gkane1234.github.io/travel_log/author/` then drag that file to the Dock. It is a launcher script, not a signed app.
- iPhone: open the author URL in Safari → Share → Add to Home Screen. The in-app GitHub settings show the URL to use.

## Trip folder layout

```
trips/<slug>/
  index.md              # title, dates, location, summary
  days/YYYY-MM-DD.mdx   # one file per day
  photos/
  routes/
```

Your raw “Olympic Peninsula” source folder is left alone; copy media into a trip through Author when you are ready.
