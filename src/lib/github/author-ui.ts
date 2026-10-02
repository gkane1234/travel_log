import {
  dayRepoPath,
  filenamesIn,
  indexRepoPath,
  coverMediaUrl,
  gatedMediaUrl,
  indexTrips,
  placedImageMarkdown,
  placedMediaInMarkdown,
  placedVideoMarkdown,
  type PlacedMedia,
} from "./commit-plan.ts";
import { addDays, slugify } from "./dates.ts";
import { parseFrontmatter, stringifyFrontmatter, tripFromIndex, type RemoteTrip } from "./frontmatter.ts";
import { prepareDroppedFile } from "./media.ts";
import { makePoster, posterObjectKey } from "./poster.ts";
import { clearSettings, loadSettings, saveSettings } from "./settings.ts";
import { listTripNoteKeys, mediaWorkerOrigin, readTripNotes, uploadToBucket, writeTripNotes } from "./upload.ts";

type PreparedRoute = { repoPath: string; bytes: Uint8Array };

type PoolItem = {
  kind: "photo" | "video";
  filename: string;
  path: string;
  markdown: string;
};

function insertAtCursor(textarea: HTMLTextAreaElement, text: string): void {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  const padBefore = before.length && !before.endsWith("\n") ? "\n\n" : before.endsWith("\n") ? "\n" : "";
  const padAfter = after.length && !after.startsWith("\n") ? "\n\n" : "\n";
  const snippet = `${padBefore}${text}${padAfter}`;
  textarea.value = before + snippet + after;
  const pos = (before + snippet).length;
  textarea.focus();
  textarea.setSelectionRange(pos, pos);
}

function must<T extends Element>(root: ParentNode, id: string): T {
  const node = root.querySelector(`#${id}`);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

export function mountAuthor(root: HTMLElement): void {
  const base = import.meta.env.BASE_URL || "/";
  const pathSlug = root.dataset.slug || "";
  const params = new URLSearchParams(location.search);
  let settings = loadSettings();
  let paths: string[] = [];
  let trip: RemoteTrip | null = null;
  let currentDate = params.get("date") || "";
  let dirty = false;
  let saving = false;

  const screens = {
    settings: must<HTMLElement>(root, "screen-settings"),
    list: must<HTMLElement>(root, "screen-list"),
    editor: must<HTMLElement>(root, "screen-editor"),
  };
  const settingsForm = must<HTMLFormElement>(root, "settings-form");
  const settingsError = must<HTMLElement>(root, "settings-error");
  const homeUrl = must<HTMLInputElement>(root, "home-screen-url");
  const tripList = must<HTMLElement>(root, "trip-list");
  const listStatus = must<HTMLElement>(root, "list-status");
  const createForm = must<HTMLFormElement>(root, "create-form");
  const createError = must<HTMLElement>(root, "create-error");
  const titleEl = must<HTMLElement>(root, "trip-title");
  const metaEl = must<HTMLElement>(root, "trip-meta");
  const bodyEl = must<HTMLTextAreaElement>(root, "day-body");
  const jumpEl = must<HTMLInputElement>(root, "jump-date");
  const prevBtn = must<HTMLButtonElement>(root, "prev-day");
  const nextBtn = must<HTMLButtonElement>(root, "next-day");
  const saveBtn = must<HTMLButtonElement>(root, "save-day");
  const statusEl = must<HTMLElement>(root, "status");
  const dropzone = must<HTMLElement>(root, "dropzone");
  const mediaInput = must<HTMLInputElement>(root, "media-input");
  const gpxInput = must<HTMLInputElement>(root, "gpx-input");
  const viewLink = must<HTMLAnchorElement>(root, "view-link");
  const publishBtn = must<HTMLButtonElement>(root, "publish-trip");
  const coverChoices = must<HTMLElement>(root, "cover-choices");
  const saveCoverBtn = must<HTMLButtonElement>(root, "save-cover");
  const mediaPool = must<HTMLElement>(root, "media-pool");
  const poolHint = must<HTMLElement>(root, "pool-hint");
  const createMedia = must<HTMLInputElement>(root, "create-media");
  let selectedCover = "";
  let poolItems: PoolItem[] = [];
  let selectedPath = "";

  function show(name: keyof typeof screens): void {
    for (const [key, el] of Object.entries(screens)) {
      el.hidden = key !== name;
    }
  }

  function authorUrl(): string {
    if (settings?.pagesUrl) return settings.pagesUrl;
    return new URL(`${base}author/`, location.origin).href;
  }

  function fillSettingsForm(): void {
    const owner = settingsForm.querySelector<HTMLInputElement>('[name="owner"]');
    const repo = settingsForm.querySelector<HTMLInputElement>('[name="repo"]');
    const branch = settingsForm.querySelector<HTMLInputElement>('[name="branch"]');
    const pages = settingsForm.querySelector<HTMLInputElement>('[name="pagesUrl"]');
    const token = settingsForm.querySelector<HTMLInputElement>('[name="token"]');
    if (owner) owner.value = settings?.owner ?? "";
    if (repo) repo.value = settings?.repo ?? "";
    if (branch) branch.value = settings?.branch ?? "master";
    if (pages) pages.value = settings?.pagesUrl ?? "";
    const worker = settingsForm.querySelector<HTMLInputElement>('[name="mediaWorkerUrl"]');
    const uploadToken = settingsForm.querySelector<HTMLInputElement>('[name="uploadToken"]');
    if (worker) worker.value = settings?.mediaWorkerUrl ?? "";
    if (uploadToken) {
      uploadToken.value = "";
      uploadToken.placeholder = settings?.uploadToken ? "Saved in this browser" : "Optional";
    }
    if (token) {
      token.value = "";
      token.placeholder = settings?.token ? "Saved in this browser" : "github_pat_… or ghp_…";
    }
    homeUrl.value = authorUrl();
  }

  function setStatus(message: string, isError = false): void {
    statusEl.textContent = message;
    statusEl.classList.toggle("error", isError);
  }

  function showSettingsError(message: string): void {
    settingsError.textContent = message;
    settingsError.hidden = !message;
  }

  function notesTarget(): { workerUrl: string; token: string } {
    const configured = settings?.mediaWorkerUrl ? mediaWorkerOrigin(settings.mediaWorkerUrl) : "";
    return {
      workerUrl: configured || location.origin,
      token: settings?.uploadToken || settings?.token || "",
    };
  }

  async function loadBucketPaths(): Promise<void> {
    paths = await listTripNoteKeys(notesTarget());
  }

  async function readNote(path: string): Promise<string | null> {
    const files = await readTripNotes({ ...notesTarget(), paths: [path] });
    return files[0]?.text ?? null;
  }

  async function saveNotes(files: { path: string; text: string }[]): Promise<void> {
    await writeTripNotes({ ...notesTarget(), files });
    for (const file of files) {
      if (!paths.includes(file.path)) paths.push(file.path);
    }
  }

  function dayPath(slug: string, date: string): string {
    const mdx = dayRepoPath(slug, date);
    const md = `trips/${slug}/days/${date}.md`;
    if (paths.includes(md) && !paths.includes(mdx)) return md;
    return mdx;
  }

  function renderNav(): void {
    if (!trip || !currentDate) return;
    const start = trip.date;
    const end = trip.endDate;
    const prev = currentDate > start ? addDays(currentDate, -1) : "";
    const next = !end || currentDate < end ? addDays(currentDate, 1) : "";
    if (end && next && next > end) {
      nextBtn.disabled = true;
      nextBtn.dataset.date = "";
    } else {
      nextBtn.disabled = !next;
      nextBtn.dataset.date = next;
    }
    prevBtn.disabled = !prev;
    prevBtn.dataset.date = prev;
    jumpEl.value = currentDate;
    jumpEl.min = start;
    if (end) jumpEl.max = end;
    else jumpEl.removeAttribute("max");
  }

  function renderTripMeta(): void {
    if (!trip) return;
    titleEl.textContent = trip.title;
    metaEl.textContent = [
      trip.location,
      trip.endDate ? `${trip.date} – ${trip.endDate}` : trip.date,
      trip.draft ? "draft" : "on the public site",
    ]
      .filter(Boolean)
      .join(" · ");
    viewLink.href = `${base}trips/${trip.slug}/`;
    publishBtn.textContent = trip.draft ? "Show on the public site" : "Hide from the public site";
    selectedCover = trip.cover || "";
  }

  function markCoverSelection(): void {
    coverChoices.querySelectorAll<HTMLButtonElement>("[data-cover]").forEach((button) => {
      const on = (button.dataset.cover || "") === selectedCover;
      button.classList.toggle("is-selected", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function coverTile(coverPath: string, label: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cover-choice";
    button.dataset.cover = coverPath;
    if (coverPath) {
      const src = coverMediaUrl(coverPath);
      if (src) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = label;
        img.addEventListener("error", () => {
          img.hidden = true;
        });
        button.append(img);
      }
    }
    const name = document.createElement("span");
    name.textContent = label;
    button.append(name);
    button.addEventListener("click", () => {
      selectedCover = coverPath;
      markCoverSelection();
    });
    return button;
  }

  function fillCoverGrid(photoPaths: string[]): void {
    const choices = [...photoPaths];
    if (selectedCover && !choices.includes(selectedCover)) choices.push(selectedCover);
    coverChoices.replaceChildren();
    coverChoices.append(coverTile("", "First photo in the trip"));
    for (const path of choices) {
      coverChoices.append(coverTile(path, path.split("/").pop() || path));
    }
    markCoverSelection();
  }

  function poolItemFrom(item: PlacedMedia): PoolItem {
    if (!trip) throw new Error("Open a trip first.");
    const alt = item.filename.replace(/\.[^.]+$/, "");
    return {
      kind: item.kind,
      filename: item.filename,
      path: item.path,
      markdown: item.kind === "video" ? placedVideoMarkdown(trip.slug, item.filename) : placedImageMarkdown(trip.slug, item.filename, alt),
    };
  }

  function renderPool(): void {
    poolHint.textContent = selectedPath
      ? "Click in the day where this should go, or drag it into the note."
      : "Add many at once. Click a photo or video, then click in the day where it should go. Or drag it into the note.";
    mediaPool.replaceChildren();
    if (!trip || !poolItems.length) {
      const empty = document.createElement("p");
      empty.className = "meta";
      empty.textContent = "No photos or videos yet.";
      mediaPool.append(empty);
      return;
    }
    for (const item of poolItems) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cover-choice";
      button.draggable = true;
      button.dataset.path = item.path;
      const selected = item.path === selectedPath;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      const src = gatedMediaUrl(trip.slug, item.filename);
      if (item.kind === "video") {
        const video = document.createElement("video");
        video.src = src;
        video.muted = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.setAttribute("aria-label", item.filename);
        video.addEventListener("loadeddata", () => {
          try {
            if (video.currentTime < 0.01) video.currentTime = 0.1;
          } catch {
            /* A missing frame still leaves the video preview. */
          }
        });
        button.append(video);
      } else if (src) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = item.filename;
        button.append(img);
      }
      const name = document.createElement("span");
      name.textContent = item.filename;
      button.append(name);
      button.addEventListener("click", () => {
        selectedPath = selectedPath === item.path ? "" : item.path;
        renderPool();
      });
      button.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("application/x-travel-log", item.markdown);
        event.dataTransfer?.setData("text/plain", item.markdown);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
      });
      mediaPool.append(button);
    }
  }

  async function refreshLibrary(): Promise<void> {
    if (!trip) return;
    const fromNotes: PoolItem[] = [];
    const photoPaths: string[] = [];
    const add = (markdown: string) => {
      for (const item of placedMediaInMarkdown(trip!.slug, markdown)) {
        if (!fromNotes.some((entry) => entry.path === item.path)) fromNotes.push(poolItemFrom(item));
        if (item.kind === "photo" && !photoPaths.includes(item.path)) photoPaths.push(item.path);
      }
    };
    for (const date of [...trip.dayDates].sort()) {
      if (date === currentDate) continue;
      const raw = await readNote(dayPath(trip.slug, date));
      add(raw ?? "");
    }
    add(bodyEl.value);
    const sessionOnly = poolItems.filter((item) => !fromNotes.some((entry) => entry.path === item.path));
    poolItems = [...fromNotes, ...sessionOnly];
    for (const item of sessionOnly) {
      if (item.kind === "photo" && !photoPaths.includes(item.path)) photoPaths.push(item.path);
    }
    renderPool();
    fillCoverGrid(photoPaths);
  }

  async function persistCover(cover: string): Promise<void> {
    if (!trip) throw new Error("Open a trip first.");
    const raw = await readNote(trip.indexPath);
    if (raw == null) throw new Error("Could not read the trip index.");
    const parsed = parseFrontmatter(raw);
    if (cover) parsed.data.cover = cover;
    else delete parsed.data.cover;
    await saveNotes([{ path: trip.indexPath, text: stringifyFrontmatter(parsed.data, parsed.body) }]);
    trip = { ...trip, cover: cover || undefined };
    renderTripMeta();
  }

  async function loadDay(date: string, options: { saveFirst?: boolean } = {}): Promise<void> {
    if (!trip) return;
    if (options.saveFirst !== false && dirty) {
      const ok = await saveDay();
      if (!ok) return;
    }
    setStatus("Loading…");
    const raw = await readNote(dayPath(trip.slug, date));
    currentDate = date;
    bodyEl.value = raw ?? "";
    dirty = false;
    renderNav();
    const url = new URL(location.href);
    url.searchParams.set("trip", trip.slug);
    url.searchParams.set("date", date);
    history.replaceState({}, "", url);
    await refreshLibrary();
    setStatus(`Editing ${date}. Save updates the travel log.`);
  }

  async function openTrip(slug: string, date?: string): Promise<void> {
    show("editor");
    poolItems = [];
    selectedPath = "";
    renderPool();
    setStatus("Loading…");
    try {
      await loadBucketPaths();
      const found = indexTrips(paths).find((item) => item.slug === slug);
      if (!found) {
        titleEl.textContent = "Trip not found";
        setStatus("That trip is not on the site yet.");
        return;
      }
      const raw = await readNote(found.indexPath);
      if (raw == null) {
        setStatus("Could not read the trip.");
        return;
      }
      trip = tripFromIndex(slug, found.indexPath, raw, found.days);
      renderTripMeta();
      const start = date || currentDate || trip.date;
      const clamped = trip.endDate && start > trip.endDate ? trip.endDate : start < trip.date ? trip.date : start;
      await loadDay(clamped || trip.date, { saveFirst: false });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load the trip.");
    }
  }

  async function saveDay(): Promise<boolean> {
    if (!trip || !currentDate) return false;
    if (saving) return false;
    saving = true;
    const body = bodyEl.value;
    const date = currentDate;
    const slug = trip.slug;
    setStatus("Saving…");
    try {
      await saveNotes([{ path: dayPath(slug, date), text: body }]);
      if (!trip.dayDates.includes(date)) trip.dayDates.push(date);
      if (bodyEl.value === body && currentDate === date) dirty = false;
      setStatus("Saved to the travel log.");
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed", true);
      return false;
    } finally {
      saving = false;
    }
  }

  async function saveWithFiles(routes: PreparedRoute[], cover?: string): Promise<void> {
    if (!trip || !currentDate) return;
    if (saving) return;
    saving = true;
    const body = bodyEl.value;
    const date = currentDate;
    setStatus("Saving…");
    try {
      const files = [
        ...routes.map((file) => ({ path: file.repoPath, text: new TextDecoder().decode(file.bytes) })),
        { path: dayPath(trip.slug, date), text: body },
      ];
      if (cover && !trip.cover) {
        const raw = await readNote(trip.indexPath);
        if (raw != null) {
          const parsed = parseFrontmatter(raw);
          if (!parsed.data.cover) {
            parsed.data.cover = cover;
            files.push({ path: trip.indexPath, text: stringifyFrontmatter(parsed.data, parsed.body) });
          }
        }
      }
      await saveNotes(files);
      if (!trip.dayDates.includes(date)) trip.dayDates.push(date);
      if (cover && !trip.cover) trip = { ...trip, cover };
      dirty = false;
      const usedCover = Boolean(cover && trip.cover === cover);
      await refreshLibrary();
      setStatus(usedCover ? "Saved. That photo is the trip thumbnail." : "Saved to the travel log.");
    } catch (error) {
      dirty = true;
      setStatus(error instanceof Error ? error.message : "Save failed", true);
    } finally {
      saving = false;
    }
  }

  function knownMediaNames(): Set<string> {
    const names = filenamesIn(paths, trip?.slug || "", "photos");
    for (const item of poolItems) names.add(item.filename);
    if (trip) {
      for (const item of placedMediaInMarkdown(trip.slug, bodyEl.value)) names.add(item.filename);
    }
    return names;
  }

  function placeMarkdown(markdown: string, offset?: number): void {
    if (offset != null) {
      bodyEl.focus();
      const pos = Math.max(0, Math.min(offset, bodyEl.value.length));
      bodyEl.setSelectionRange(pos, pos);
    }
    insertAtCursor(bodyEl, markdown);
    selectedPath = "";
    dirty = true;
    renderPool();
    setStatus("Placed in this day. Save day to keep it.");
  }

  function dropCaret(x: number, y: number): number {
    const doc = document as Document & {
      caretPositionFromPoint?: (clientX: number, clientY: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (clientX: number, clientY: number) => Range | null;
    };
    const pos = doc.caretPositionFromPoint?.(x, y);
    if (pos?.offsetNode === bodyEl) return pos.offset;
    const range = doc.caretRangeFromPoint?.(x, y);
    if (range?.startContainer === bodyEl) return range.startOffset;
    return bodyEl.selectionStart ?? bodyEl.value.length;
  }

  let uploading = false;

  async function uploadMedia(files: File[]): Promise<void> {
    if (!trip || !files.length) return;
    if (uploading) {
      setStatus("An upload is already running.", true);
      return;
    }
    uploading = true;
    try {
    const photos = knownMediaNames();
    const routes = filenamesIn(paths, trip.slug, "routes");
    let posterWarning = "";
    let uploaded = 0;
    const problems: string[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      setStatus(`Preparing ${index + 1} of ${files.length}: ${file.name}`);
      let prepared;
      try {
        prepared = await prepareDroppedFile(file, trip.slug, photos, routes);
      } catch (error) {
        problems.push(error instanceof Error ? error.message : `Could not add ${file.name}.`);
        continue;
      }
      if (prepared.kind === "route" && prepared.repoPath) {
        insertAtCursor(bodyEl, prepared.markdown);
        dirty = true;
        await saveWithFiles([{ repoPath: prepared.repoPath, bytes: prepared.bytes }]);
        continue;
      }
      if (prepared.kind !== "photo" && prepared.kind !== "video") continue;
      if (!prepared.objectKey || !prepared.contentType) {
        problems.push(`Could not prepare ${file.name}.`);
        continue;
      }
      setStatus(`Uploading ${index + 1} of ${files.length}: ${prepared.filename}`);
      try {
        await uploadToBucket({
          workerUrl: notesTarget().workerUrl,
          token: notesTarget().token,
          objectKey: prepared.objectKey,
          bytes: prepared.bytes,
          contentType: prepared.contentType,
        });
        if (prepared.kind === "photo") {
          try {
            const posterBlob = await makePoster(new Blob([prepared.bytes], { type: "image/jpeg" }));
            await uploadToBucket({
              workerUrl: notesTarget().workerUrl,
              token: notesTarget().token,
              objectKey: posterObjectKey(trip.slug, prepared.filename),
              bytes: new Uint8Array(await posterBlob.arrayBuffer()),
              contentType: "image/jpeg",
            });
          } catch (error) {
            posterWarning = error instanceof Error ? error.message : "Could not make the login poster.";
          }
          if (!trip.cover) {
            try {
              await persistCover(`/trip-media/${trip.slug}/photos/${prepared.filename}`);
            } catch {
              problems.push("The photo uploaded, but the thumbnail was not saved.");
            }
          }
        }
        const placed = poolItemFrom({
          kind: prepared.kind,
          filename: prepared.filename,
          path: `/trip-media/${trip.slug}/photos/${prepared.filename}`,
        });
        if (!poolItems.some((item) => item.path === placed.path)) poolItems.push(placed);
        uploaded += 1;
        renderPool();
      } catch (error) {
        problems.push(error instanceof Error ? error.message : `Upload of ${file.name} failed.`);
      }
    }
    try {
      await refreshLibrary();
    } catch {
      renderPool();
    }
    if (problems.length) {
      setStatus(problems[0], true);
    } else if (uploaded) {
      const noun = uploaded === 1 ? "file" : "files";
      const poster = posterWarning ? ` Login poster failed: ${posterWarning}` : "";
      setStatus(`Uploaded ${uploaded} ${noun}. Click one, then click in the day to place it.${poster}`);
    }
    } finally {
      uploading = false;
    }
  }

  function renderList(trips: RemoteTrip[]): void {
    tripList.replaceChildren();
    if (!trips.length) {
      const empty = document.createElement("li");
      empty.className = "meta";
      empty.textContent = "No trips yet.";
      tripList.appendChild(empty);
      return;
    }
    const sorted = [...trips].sort((a, b) => b.date.localeCompare(a.date));
    for (const item of sorted) {
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.href = `${base}author/?trip=${encodeURIComponent(item.slug)}&date=${encodeURIComponent(item.date)}`;
      link.textContent = `${item.title} (${item.date}${item.endDate ? ` – ${item.endDate}` : ""})`;
      li.appendChild(link);
      tripList.appendChild(li);
    }
  }

  async function showList(): Promise<void> {
    show("list");
    listStatus.textContent = "Loading trips…";
    trip = null;
    try {
      await loadBucketPaths();
      const indexed = indexTrips(paths);
      const trips: RemoteTrip[] = [];
      for (const item of indexed) {
        const raw = await readNote(item.indexPath);
        if (raw == null) continue;
        trips.push(tripFromIndex(item.slug, item.indexPath, raw, item.days));
      }
      renderList(trips);
      listStatus.textContent = "Save updates the travel log.";
    } catch (error) {
      listStatus.textContent = error instanceof Error ? error.message : "Could not load trips.";
    }
  }

  settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(settingsForm);
    const token = String(data.get("token") || "").trim() || settings?.token || "";
    const owner = String(data.get("owner") || "").trim();
    const repo = String(data.get("repo") || "").trim();
    const branch = String(data.get("branch") || "master").trim() || "master";
    const pagesUrl = String(data.get("pagesUrl") || "").trim();
    const mediaWorkerUrl = String(data.get("mediaWorkerUrl") || "").trim();
    const uploadToken = String(data.get("uploadToken") || "").trim() || settings?.uploadToken || "";
    if (!token || !owner || !repo) {
      showSettingsError("A token, owner, and repository name are required.");
      return;
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
      showSettingsError("Owner and repository should look like owner/name, without spaces.");
      return;
    }
    settings = { token, owner, repo, branch, pagesUrl, mediaWorkerUrl, uploadToken };
    saveSettings(settings);
    paths = [];
    showSettingsError("");
    fillSettingsForm();
    const tripSlug = new URLSearchParams(location.search).get("trip") || pathSlug;
    if (tripSlug) void openTrip(tripSlug, new URLSearchParams(location.search).get("date") || undefined);
    else void showList();
  });

  root.querySelectorAll("[data-open-settings]").forEach((button) => {
    button.addEventListener("click", () => {
      fillSettingsForm();
      show("settings");
    });
  });

  must<HTMLButtonElement>(root, "forget-token").addEventListener("click", () => {
    clearSettings();
    settings = null;
    paths = [];
    fillSettingsForm();
    show("settings");
    showSettingsError("This browser forgot the token.");
  });

  const titleInput = createForm.querySelector<HTMLInputElement>('[name="title"]');
  const slugInput = createForm.querySelector<HTMLInputElement>('[name="slug"]');
  titleInput?.addEventListener("input", () => {
    if (slugInput && !slugInput.dataset.touched) slugInput.value = slugify(titleInput.value);
  });
  slugInput?.addEventListener("input", () => {
    slugInput.dataset.touched = "1";
  });

  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    createError.hidden = true;
    const data = new FormData(createForm);
    const title = String(data.get("title") || "").trim();
    const slug = slugify(String(data.get("slug") || title));
    const date = String(data.get("date") || "");
    const endDate = String(data.get("endDate") || "");
    const locationName = String(data.get("location") || "").trim();
    const summary = String(data.get("summary") || "").trim();
    if (!title || !slug || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      createError.textContent = "Title and start date are required.";
      createError.hidden = false;
      return;
    }
    if (endDate && endDate < date) {
      createError.textContent = "End date is before the start date.";
      createError.hidden = false;
      return;
    }
    listStatus.textContent = "Creating trip…";
    try {
      await loadBucketPaths();
      if (indexTrips(paths).some((item) => item.slug === slug)) {
        throw new Error("A trip with that slug already exists.");
      }
      const index = stringifyFrontmatter(
        {
          title,
          date,
          endDate: endDate || undefined,
          location: locationName || undefined,
          summary: summary || undefined,
          draft: true,
        },
        "",
      );
      const picked = createMedia.files ? [...createMedia.files] : [];
      await saveNotes([
        { path: indexRepoPath(slug), text: index },
        { path: dayRepoPath(slug, date), text: "\n" },
      ]);
      createForm.reset();
      if (slugInput) delete slugInput.dataset.touched;
      const next = new URL(`${base}author/`, location.origin);
      next.searchParams.set("trip", slug);
      next.searchParams.set("date", date);
      history.pushState({}, "", next);
      await openTrip(slug, date);
      if (picked.length) await uploadMedia(picked);
    } catch (error) {
      createError.textContent = error instanceof Error ? error.message : "Could not create the trip.";
      createError.hidden = false;
    }
  });

  prevBtn.addEventListener("click", () => {
    if (prevBtn.dataset.date) void loadDay(prevBtn.dataset.date);
  });
  nextBtn.addEventListener("click", () => {
    if (nextBtn.dataset.date) void loadDay(nextBtn.dataset.date);
  });
  jumpEl.addEventListener("change", () => {
    if (!trip || !jumpEl.value) return;
    let date = jumpEl.value;
    if (date < trip.date) date = trip.date;
    if (trip.endDate && date > trip.endDate) date = trip.endDate;
    void loadDay(date);
  });
  saveBtn.addEventListener("click", () => void saveDay());
  bodyEl.addEventListener("input", () => {
    dirty = true;
    setStatus("Unsaved. Save updates the travel log.");
  });

  saveCoverBtn.addEventListener("click", async () => {
    if (!trip) return;
    setStatus("Saving thumbnail…");
    try {
      await persistCover(selectedCover);
      setStatus(selectedCover ? "Thumbnail saved." : "Thumbnail will be the first photo in the trip.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save the thumbnail.");
    }
  });

  publishBtn.addEventListener("click", async () => {
    if (!trip) return;
    setStatus("Saving…");
    try {
      const raw = await readNote(trip.indexPath);
      if (raw == null) throw new Error("Could not read the trip index.");
      const nextDraft = !trip.draft;
      const parsed = parseFrontmatter(raw);
      parsed.data.draft = nextDraft;
      const index = stringifyFrontmatter(parsed.data, parsed.body);
      await saveNotes([{ path: trip.indexPath, text: index }]);
      trip = { ...trip, draft: nextDraft };
      renderTripMeta();
      setStatus(nextDraft ? "Hidden from the travel log." : "Showing on the travel log.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update the trip.");
    }
  });

  mediaInput.addEventListener("change", () => {
    const files = mediaInput.files ? [...mediaInput.files] : [];
    mediaInput.value = "";
    void uploadMedia(files);
  });
  gpxInput.addEventListener("change", () => {
    const files = gpxInput.files ? [...gpxInput.files] : [];
    gpxInput.value = "";
    void uploadMedia(files);
  });
  bodyEl.addEventListener("click", () => {
    if (!selectedPath || bodyEl.selectionStart !== bodyEl.selectionEnd) return;
    const item = poolItems.find((entry) => entry.path === selectedPath);
    if (!item) return;
    placeMarkdown(item.markdown);
  });

  for (const eventName of ["dragenter", "dragover"]) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add("dragover");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove("dragover");
    });
  }
  dropzone.addEventListener("drop", (event) => {
    const custom = event.dataTransfer?.getData("application/x-travel-log") || "";
    const plain = event.dataTransfer?.getData("text/plain") || "";
    const markdown = custom || (plain.startsWith("![") || plain.startsWith("<TripVideo") ? plain : "");
    if (markdown) {
      placeMarkdown(markdown, dropCaret(event.clientX, event.clientY));
      return;
    }
    const files = event.dataTransfer?.files;
    if (files?.length) void uploadMedia([...files]);
  });

  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "s" && !screens.editor.hidden) {
      event.preventDefault();
      void saveDay();
    }
  });

  must<HTMLButtonElement>(root, "back-to-list").addEventListener("click", () => {
    void (async () => {
      if (dirty) {
        const ok = await saveDay();
        if (!ok) return;
      }
      const url = new URL(`${base}author/`, location.origin);
      history.pushState({}, "", url);
      await showList();
    })();
  });

  fillSettingsForm();
  const initialTrip = params.get("trip") || pathSlug;
  if (initialTrip) void openTrip(initialTrip, params.get("date") || undefined);
  else void showList();
}
