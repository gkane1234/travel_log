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

Open `/author/`. The first time, enter a GitHub personal access token and the repo (`gkane1234` / `travel_log`, branch `master`). Those stay in this browser’s localStorage only.

Saving a day commits the markdown to GitHub through the Git Data API. GitHub Actions then publishes the site to GitHub Pages. That workflow is `.github/workflows/pages.yml` and still runs on every push to `master`.

Photos and videos are not part of that commit. The editor uploads them to object storage first and writes the public `http(s)` URL into the day note. HEIC photos become JPEG in the browser before upload. JPEG, PNG, and WebP upload as-is. MP4, MOV, and WebM upload as-is, including files larger than 100 MB. A failed upload is shown in the editor and is not written into git. GPX files stay in `routes/` and are committed with the note. Nothing over 50 MB is committed.

Create a GitHub token at Settings → Developer settings → Personal access tokens. Classic tokens need the `repo` scope. Fine-grained tokens need read and write on Contents for this repository.

In the same settings screen, set **Media upload URL** to the Cloudflare Worker address from the section below. Leave **Upload token** blank to send the GitHub token, or paste a separate token that exists only on this device.

## Photos and videos (Cloudflare R2)

The default store is Cloudflare R2. The same Worker speaks S3, so Backblaze B2 is the same setup with different endpoint values. Bucket secrets stay in Worker secrets. They are not in this repo and not in the static site.

Create these, then deploy the Worker in `workers/media`:

1. In the Cloudflare dashboard, create an R2 bucket named `travel-log-media`.
2. Turn on public access for that bucket (an `r2.dev` subdomain or a custom domain). Copy the public base URL with no trailing slash, for example `https://pub-xxxx.r2.dev`.
3. Create an R2 API token with Object Read & Write on that bucket. Copy the Access Key ID and Secret Access Key. The S3 endpoint is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` (account id is on the R2 overview). Do not put the bucket name in the endpoint.
4. Add a CORS policy on the bucket so the browser can `PUT` the file. Allow origins `https://gkane1234.github.io` and `http://localhost:4321`, method `PUT`, and header `content-type`.

From `workers/media`:

```bash
npm install
npx wrangler login
npx wrangler secret put S3_ENDPOINT
npx wrangler secret put S3_BUCKET
npx wrangler secret put S3_ACCESS_KEY_ID
npx wrangler secret put S3_SECRET_ACCESS_KEY
npx wrangler secret put S3_REGION
npx wrangler secret put PUBLIC_BASE_URL
npx wrangler secret put GITHUB_REPOSITORY
npx wrangler secret put UPLOAD_TOKEN
npx wrangler deploy
```

Enter these values when prompted:

- `S3_ENDPOINT`: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
- `S3_BUCKET`: `travel-log-media`
- `S3_REGION`: `auto`
- `PUBLIC_BASE_URL`: the public base from step 2
- `GITHUB_REPOSITORY`: `gkane1234/travel_log`
- `UPLOAD_TOKEN`: optional. If you set it, put the same value in the author page’s Upload token field. If you leave it empty, the editor sends the GitHub token and the Worker checks that token can read this repo.

`npx wrangler deploy` prints the Worker URL. Paste that into **Media upload URL** on the author page (no path, no trailing slash).

If any of those secrets are missing, the Worker refuses the upload. The editor then shows the error and does not add the image or video to the git commit.

### Backblaze B2

Use the same commands and change the secrets:

- `S3_ENDPOINT`: `https://s3.<region>.backblazeb2.com`
- `S3_REGION`: that region, such as `us-west-004`
- `S3_BUCKET`: the B2 bucket name
- `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`: a B2 application key that can write the bucket
- `PUBLIC_BASE_URL`: the public URL prefix where objects are readable, with no trailing slash

The bucket still needs a CORS rule that allows `PUT` from the Pages origin.

## Install

- Windows: `powershell -File scripts/author-shortcut.ps1 -Url "https://gkane1234.github.io/travel_log/author/"`. That puts a shortcut on the desktop. With no `-Url`, it opens the local author page.
- Mac: `scripts/open-author.command https://gkane1234.github.io/travel_log/author/` then drag that file to the Dock. It is a launcher script, not a signed app.
- iPhone: open the author URL in Safari → Share → Add to Home Screen. The in-app GitHub settings show the URL to use.

## Trip folder layout

```
trips/<slug>/
  index.md              # title, dates, location, summary
  days/YYYY-MM-DD.mdx   # one file per day
  photos/               # older pictures already in git; new ones are not added here
  routes/               # GPX files, still committed
```

Your raw “Olympic Peninsula” source folder is left alone; copy media into a trip through Author when you are ready.
