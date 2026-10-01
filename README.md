# Travel Log

Astro site for trip journals. Content lives in `trips/`; open `/author` while developing to create trips and drop in photos or GPX.

## Run

```bash
npm install
npm run dev
```

`npm run dev` stops any stale process on port 4321 first (a second Astro instance
racing on `.astro/data-store.json.tmp` crashes on Windows). Then:

- Site: http://localhost:4321/
- Author (dev only): http://localhost:4321/author

```bash
npm run build
npm run preview
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

1. Open `/author` and create a trip (start date, optional end date).
2. Write the current day in the editor.
3. Use **Next day** / **Previous day**, or jump to a date. Days stay inside the trip’s date range when an end date is set; missing day files are created as you go.
4. Drop `.heic`, `.jpg`, `.mov`, or `.gpx` (or a `.zip` that contains a `.gpx`) onto the text. HEIC becomes JPEG; MOV is transcoded to MP4 when possible. Markdown (or a `TripMap` / `TripVideo` tag) is inserted at the cursor.
5. Preview the public page at `/trips/<slug>/`.

Each successful create, day save, photo, video, or GPX upload is committed locally in this folder. Nothing is pushed. If the backup commit fails, the save still sticks and Author shows a short warning. See history with `git log`.

Your raw “Olympic Peninsula” source folder is left alone; copy media into a trip through Author when you are ready.
