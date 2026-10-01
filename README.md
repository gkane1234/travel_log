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

Photos and videos are not part of that commit. The editor re-encodes each new photo in the browser so the original file, including EXIF and GPS, is not uploaded. It then stores the Worker media URL in the day note. HEIC becomes JPEG before that re-encode. JPEG, PNG, and WebP are re-encoded to a clean JPEG. Video bytes are uploaded unchanged, so location data in a video may remain. MP4, MOV, and WebM can be larger than 100 MB. A failed upload is shown in the editor and is not written into git. GPX files stay in `routes/` and are committed with the note. Nothing over 50 MB is committed.

Create a GitHub token at Settings → Developer settings → Personal access tokens. Classic tokens need the `repo` scope. Fine-grained tokens need read and write on Contents for this repository.

In the same settings screen, set **Media upload URL** to the Cloudflare Worker address from the section below. Leave **Upload token** blank to send the GitHub token, or paste a separate token that exists only on this device.

## Photos and videos (Cloudflare R2)

The default store is a private Cloudflare R2 bucket. The same Worker speaks S3, so Backblaze B2 is the same setup with different endpoint values. Bucket secrets and the photo password stay in Worker secrets. They are not in this repo and not in the static site.

Trip notes and GitHub Pages stay public. This repo was not made private, and the Pages workflow is unchanged. Anyone who can open github.com or `https://gkane1234.github.io/travel_log/` can read the notes. A photo login does not hide the notes. Make the GitHub repo private yourself if the notes should not be on github.com. GitHub Pages on a public repo stays public either way.

Photos and videos are not public. The bucket has no r2.dev URL in the notes. A day note stores a URL on your Cloudflare site, such as `https://gabriel-kane.com/travel_log/media/olympic-peninsula/shore.jpg`. The Worker returns that file only when the browser sends the photo-login cookie. A direct link without the cookie gets 401.

That cookie is first-party only. It is set when you sign in at `/travel_log/login` on gabriel-kane.com, with `Path=/travel_log` and `SameSite=Lax`. It is not sent when a github.io page loads images from a different host, so pictures on GitHub Pages stay locked. View photos on https://gabriel-kane.com, where the pages and `/travel_log/media` are the same site.

Create these, then deploy the Worker in `workers/media`:

1. In the Cloudflare dashboard, create an R2 bucket named `travel-log-media`. Leave public access off.
2. Create an R2 API token with Object Read & Write on that bucket. Copy the Access Key ID and Secret Access Key. The S3 endpoint is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. Do not put the bucket name in the endpoint.
3. Add a CORS policy on the bucket so the browser can `PUT` an upload. Allow your Cloudflare site origin and `http://localhost:4321`, method `PUT`, and header `content-type`. Do not allow public `GET`.
4. Put the Worker on gabriel-kane.com with these routes, and remove `gabriel-kane.com/media/*` and `gabriel-kane.com/login`:
   - `gabriel-kane.com/travel_log/media/*`
   - `gabriel-kane.com/travel_log/login`
   - `gabriel-kane.com/travel_log/sign`
   - `gabriel-kane.com/travel_log`
   Set `MEDIA_BASE_URL` to `https://gabriel-kane.com` with no path. The Worker adds `/travel_log` itself.

Cloudflare Workers Builds, with the Git repo connected, uses these fields:

- Root directory: `workers/media`
- Build command: `npm run build` (checks the Worker source only; it is not the Astro site build)
- Deploy command: `npx wrangler deploy`

`npm ci` in that directory needs the committed `workers/media/package-lock.json`. Leave the build command as `npm run build` after this repo is pushed. Clearing it is unnecessary.

Set these in the Worker’s dashboard secrets or variables. Do not put the values in the repo: `MEDIA_PASSWORD`, `MEDIA_BASE_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`, and `GITHUB_REPOSITORY`. `MEDIA_USERNAME` and `UPLOAD_TOKEN` are optional.

From `workers/media`, the same deploy by hand:

```bash
npm ci
npx wrangler login
npx wrangler secret put S3_ENDPOINT
npx wrangler secret put S3_BUCKET
npx wrangler secret put S3_ACCESS_KEY_ID
npx wrangler secret put S3_SECRET_ACCESS_KEY
npx wrangler secret put S3_REGION
npx wrangler secret put MEDIA_BASE_URL
npx wrangler secret put MEDIA_PASSWORD
npx wrangler secret put MEDIA_USERNAME
npx wrangler secret put GITHUB_REPOSITORY
npx wrangler secret put UPLOAD_TOKEN
npx wrangler deploy
```

Enter these values when prompted:

- `S3_ENDPOINT`: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
- `S3_BUCKET`: `travel-log-media`
- `S3_REGION`: `auto`
- `MEDIA_BASE_URL`: `https://gabriel-kane.com`, with no path and no trailing slash
- `MEDIA_PASSWORD`: the photo password. It is not stored in the repo.
- `MEDIA_USERNAME`: optional shared name. Leave it unset if the password alone is enough.
- `GITHUB_REPOSITORY`: `gkane1234/travel_log`
- `UPLOAD_TOKEN`: optional. If you set it, put the same value in the author page’s Upload token field. If you leave it empty, the editor sends the GitHub token and the Worker checks that token can read this repo.

Uploads still use that GitHub token or `UPLOAD_TOKEN`. Viewing uses `MEDIA_PASSWORD` only. Open https://gabriel-kane.com/travel_log/login and submit the password. `GET /travel_log` redirects there. The Worker sets an httpOnly Secure cookie for `/travel_log`. It does not check a password that ships in the page. Do not route the whole site to this Worker. Trip notes stay on the public site. Old `/login` and `/media` requests are not served as files.

`npx wrangler deploy` prints a workers.dev URL. Prefer https://gabriel-kane.com, and paste that origin into **Media upload URL** on the author page (no path, no trailing slash). The editor calls `/travel_log/sign`. The note will point at `https://gabriel-kane.com/travel_log/media/...`, which the Worker serves.

If any required secret is missing, the Worker refuses the upload and refuses to hand out the file. The editor then shows the error and does not add the image or video to the git commit.

### Backblaze B2

Use the same commands and change the secrets:

- `S3_ENDPOINT`: `https://s3.<region>.backblazeb2.com`
- `S3_REGION`: that region, such as `us-west-004`
- `S3_BUCKET`: the B2 bucket name
- `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`: a B2 application key that can write the bucket

Keep the bucket private. `MEDIA_BASE_URL` is still your Cloudflare site, not a public B2 URL. The bucket still needs a CORS rule that allows `PUT` from the author origin.

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
