# Travel Log

Astro site for the travel log. The live journal at https://gabriel-kane.com/travel-log is rendered by the Cloudflare Worker from the private R2 bucket. The author page writes trip notes, day files, and covers to that bucket. GitHub holds the website code. PC, Mac, and iPhone all use that one author page.

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

Open https://gabriel-kane.com/travel-log/author after signing in as jumbo or gumbo. Click **Save day** to write that day's note to the bucket. **Save thumbnail** writes the cover into the trip index. **Show on the public site** publishes a new trip. None of those saves commit trip files to GitHub.

The editor re-encodes each new photo in the browser so the original file, including EXIF and GPS, is not uploaded. It then stores the photo address in the day note. HEIC becomes JPEG before that re-encode. JPEG, PNG, and WebP are re-encoded to a clean JPEG. Video bytes are uploaded unchanged, so location data in a video may remain. A failed save is shown in the editor. GPX files are stored with the trip in the bucket.

On gabriel-kane.com the login cookie is enough to save. The author settings can still hold a GitHub token or upload token, and a media upload URL, if you add photos from a browser that is not already signed in.

## Photos and videos (Cloudflare R2)

The default store is a private Cloudflare R2 bucket. The same Worker speaks S3, so Backblaze B2 is the same setup with different endpoint values. Bucket secrets and the photo password stay in Worker secrets. They are not in this repo and not in the static site.

Trip notes live in the private R2 bucket. The journal is shown only after the photo login. GitHub Pages still publishes the website code, including the author page.

Photos and videos are not public. The bucket has no r2.dev URL in the notes. A day note stores a URL on your Cloudflare site, such as `https://gabriel-kane.com/travel-log/media/olympic-peninsula/shore.jpg`. The Worker returns that file only when the browser sends the photo-login cookie. A direct link without the cookie gets 401. The login page may show separate tiny blurred posters at `/travel-log/posters/...`. Those are the only images served without the cookie.

That cookie is first-party only. It is set when you sign in at `/travel-log/login` on gabriel-kane.com, with `Path=/travel-log` and `SameSite=Lax`. It is not sent when a github.io page loads images from a different host, so pictures on GitHub Pages stay locked. View photos on https://gabriel-kane.com, where the pages and `/travel-log/media` are the same site.

Create these, then deploy the Worker in `workers/media`:

1. In the Cloudflare dashboard, create an R2 bucket named `travel-log-media`. Leave public access off.
2. Create an R2 API token with Object Read & Write on that bucket. Copy the Access Key ID and Secret Access Key. The S3 endpoint is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. Do not put the bucket name in the endpoint.
3. Add a CORS policy on the bucket so the browser can `PUT` an upload. Allow your Cloudflare site origin and `http://localhost:4321`, method `PUT`, and header `content-type`. Do not allow public `GET`.
4. Put the Worker on gabriel-kane.com with one route: `gabriel-kane.com/travel-log*`. Remove the older separate `/media`, `/login`, and `/travel_log` routes. This route covers the login page, the photos, and the trip pages. Set `MEDIA_BASE_URL` to `https://gabriel-kane.com` with no path. The Worker adds `/travel-log` itself.

Cloudflare Workers Builds, with the Git repo connected, uses these fields:

- Root directory: `workers/media`
- Build command: `npm run build` (checks the Worker source only; it is not the Astro site build)
- Deploy command: `npx wrangler deploy`

`npm ci` in that directory needs the committed `workers/media/package-lock.json`. Leave the build command as `npm run build` after this repo is pushed. Clearing it is unnecessary.

Set these in the Worker’s dashboard secrets or variables. Do not put the values in the repo: `MEDIA_PASSWORD`, `MEDIA_BASE_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`, and `GITHUB_REPOSITORY`. `UPLOAD_TOKEN` is optional. Photo login accepts only the usernames `jumbo` and `gumbo`, both with `MEDIA_PASSWORD`.

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
npx wrangler secret put GITHUB_REPOSITORY
npx wrangler secret put UPLOAD_TOKEN
npx wrangler deploy
```

Enter these values when prompted:

- `S3_ENDPOINT`: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
- `S3_BUCKET`: `travel-log-media`
- `S3_REGION`: `auto`
- `MEDIA_BASE_URL`: `https://gabriel-kane.com`, with no path and no trailing slash
- `MEDIA_PASSWORD`: the photo password. It is not stored in the repo. Both `jumbo` and `gumbo` use this password.
- `GITHUB_REPOSITORY`: `gkane1234/travel_log`
- `UPLOAD_TOKEN`: optional. If you set it, put the same value in the author page’s Upload token field. If you leave it empty, the editor sends the GitHub token and the Worker checks that token can read this repo.

Uploads still use that GitHub token or `UPLOAD_TOKEN`. Opening any `https://gabriel-kane.com/travel-log` address without a sign-in shows the login screen. Sign in as `jumbo` or `gumbo` with `MEDIA_PASSWORD`. After that, the Worker serves the trip pages and the private photos. The cookie is httpOnly, Secure, and limited to `/travel-log`. Do not route the rest of gabriel-kane.com to this Worker. Old `/login`, `/media`, and `/travel_log` requests are not served as files.

`npx wrangler deploy` prints a workers.dev URL. Prefer https://gabriel-kane.com, and paste that origin into **Media upload URL** on the author page (no path, no trailing slash). The editor calls `/travel-log/sign`. The note will point at `https://gabriel-kane.com/travel-log/media/...`, which the Worker serves.

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
trips/<slug>/index.md
trips/<slug>/days/YYYY-MM-DD.mdx
media/<slug>/photos/<file>
posters/<slug>/<file>.jpg
trips/<slug>/routes/<file>.gpx
```

Those objects are in the `travel-log-media` bucket. They are not committed to this repo.

Your raw “Olympic Peninsula” source folder is left alone; copy media into a trip through Author when you are ready.
