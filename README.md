# Travel Log

Astro site for trip journals. Public pages are readable without a login. Author mode, on the same site, requires a password and writes the markdown in `trips/`.

## Run

```bash
npm install
copy .env.example .env
```

Set these in `.env` (author mode refuses to open if any are missing):

- `AUTHOR_USERNAME`
- `AUTHOR_PASSWORD`
- `AUTHOR_SECRET`

Development:

```bash
npm run dev
```

`npm run dev` stops any stale process on port 4321 first. Then:

- Site: http://localhost:4321/
- Author: http://localhost:4321/author (redirects to `/author/login`)

Production (one Node process serves the site and accepts author writes):

```bash
npm run build
npm start
```

## Trip folder layout

```
trips/<slug>/
  index.md              # title, dates, location, summary
  days/YYYY-MM-DD.mdx   # one file per day
  photos/               # converted images and videos
  routes/               # .gpx files
```

## Author workflow

1. Log in at `/author/login`, then create a trip (start date, optional end date).
2. Write the current day. The editor saves on its own while you type, and immediately after a photo, video, or GPX drop.
3. Use **Next day** / **Previous day**, or jump to a date. Days stay inside the trip’s date range when an end date is set; missing day files are created as you go.
4. Drop `.heic`, `.jpg`, `.mov`, or `.gpx` (or a `.zip` that contains a `.gpx`) onto the text. HEIC becomes JPEG; MOV is transcoded to MP4 when possible. Markdown (or a `TripMap` / `TripVideo` tag) is inserted at the cursor.
5. The public page is `/trips/<slug>/`.

Each successful create, day save, photo, video, or GPX upload is committed locally in this folder. Nothing is pushed. If the backup commit fails, the save still sticks and Author shows a short warning. See history with `git log`.

Your raw “Olympic Peninsula” source folder is left alone; copy media into a trip through Author when you are ready.
