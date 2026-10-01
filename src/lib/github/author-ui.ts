import { commitFiles, getBranchTip, listTreePaths, readTextFile } from "./api.ts";
import {
  createTripMessage,
  dayRepoPath,
  filenamesIn,
  imageMarkdownUrl,
  indexRepoPath,
  indexTrips,
  photoPathsInMarkdown,
  saveDayMessage,
  videoMarkdownUrl,
} from "./commit-plan.ts";
import { addDays, slugify } from "./dates.ts";
import { parseFrontmatter, stringifyFrontmatter, tripFromIndex, type RemoteTrip } from "./frontmatter.ts";
import { prepareDroppedFile } from "./media.ts";
import { clearSettings, loadSettings, saveSettings, type GithubSettings } from "./settings.ts";
import { saveTripCover, uploadToBucket } from "./upload.ts";

type Tip = { commitSha: string; treeSha: string };
type PreparedRoute = { repoPath: string; bytes: Uint8Array };

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

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
  let tip: Tip | null = null;
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
  const coverSelect = must<HTMLSelectElement>(root, "cover-select");
  const saveCoverBtn = must<HTMLButtonElement>(root, "save-cover");

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

  function setStatus(message: string): void {
    statusEl.textContent = message;
  }

  function showSettingsError(message: string): void {
    settingsError.textContent = message;
    settingsError.hidden = !message;
  }

  async function refreshTip(): Promise<void> {
    if (!settings) throw new Error("GitHub is not set up in this browser.");
    tip = await getBranchTip(settings);
    paths = await listTreePaths(settings, tip.treeSha);
  }

  async function ensureTip(): Promise<Tip> {
    if (!settings) throw new Error("GitHub is not set up in this browser.");
    if (!tip) await refreshTip();
    if (!tip) throw new Error("Could not read the repository.");
    return tip;
  }

  function rememberFiles(filePaths: string[]): void {
    for (const filePath of filePaths) {
      if (!paths.includes(filePath)) paths.push(filePath);
    }
  }

  async function commit(message: string, files: { path: string; bytes: Uint8Array }[]): Promise<void> {
    if (!settings) throw new Error("GitHub is not set up in this browser.");
    const current = await ensureTip();
    tip = await commitFiles(settings, message, files, current);
    rememberFiles(files.map((file) => file.path));
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
    if (trip.cover && ![...coverSelect.options].some((option) => option.value === trip.cover)) {
      const option = document.createElement("option");
      option.value = trip.cover;
      option.textContent = trip.cover.split("/").pop() || trip.cover;
      coverSelect.append(option);
    }
    coverSelect.value = trip.cover || "";
  }

  function fillCoverSelect(paths: string[]): void {
    const current = trip?.cover || "";
    coverSelect.replaceChildren();
    const automatic = document.createElement("option");
    automatic.value = "";
    automatic.textContent = "First photo in the trip";
    coverSelect.append(automatic);
    for (const path of paths) {
      const option = document.createElement("option");
      option.value = path;
      option.textContent = path.split("/").pop() || path;
      coverSelect.append(option);
    }
    if (current && !paths.includes(current)) {
      const option = document.createElement("option");
      option.value = current;
      option.textContent = current.split("/").pop() || current;
      coverSelect.append(option);
    }
    coverSelect.value = current;
  }

  async function refreshCoverChoices(): Promise<void> {
    if (!settings || !trip) return;
    const found: string[] = [];
    const add = (markdown: string) => {
      for (const path of photoPathsInMarkdown(trip!.slug, markdown)) {
        if (!found.includes(path)) found.push(path);
      }
    };
    for (const date of [...trip.dayDates].sort()) {
      if (date === currentDate) continue;
      const raw = await readTextFile(settings, dayPath(trip.slug, date));
      add(raw ?? "");
    }
    add(bodyEl.value);
    fillCoverSelect(found);
  }

  async function persistCover(cover: string): Promise<string> {
    if (!settings || !trip) throw new Error("Open a trip first.");
    const raw = await readTextFile(settings, trip.indexPath);
    if (raw == null) throw new Error("Could not read the trip index.");
    const parsed = parseFrontmatter(raw);
    if (cover) parsed.data.cover = cover;
    else delete parsed.data.cover;
    await commit(`Set thumbnail for ${trip.title}`, [
      { path: trip.indexPath, bytes: textBytes(stringifyFrontmatter(parsed.data, parsed.body)) },
    ]);
    trip = { ...trip, cover: cover || undefined };
    renderTripMeta();
    if (!settings.mediaWorkerUrl) return "";
    await saveTripCover({
      workerUrl: settings.mediaWorkerUrl,
      token: settings.uploadToken || settings.token,
      slug: trip.slug,
      cover,
    });
    return "";
  }

  async function loadDay(date: string, options: { saveFirst?: boolean } = {}): Promise<void> {
    if (!settings || !trip) return;
    if (options.saveFirst !== false && dirty) {
      const ok = await saveDay();
      if (!ok) return;
    }
    setStatus("Loading…");
    const raw = await readTextFile(settings, dayPath(trip.slug, date));
    currentDate = date;
    bodyEl.value = raw ?? "";
    dirty = false;
    renderNav();
    const url = new URL(location.href);
    url.searchParams.set("trip", trip.slug);
    url.searchParams.set("date", date);
    history.replaceState({}, "", url);
    await refreshCoverChoices();
    setStatus(`Editing ${date}. Save sends this day to GitHub.`);
  }

  async function openTrip(slug: string, date?: string): Promise<void> {
    if (!settings) {
      show("settings");
      return;
    }
    show("editor");
    setStatus("Loading…");
    try {
      await ensureTip();
      const found = indexTrips(paths).find((item) => item.slug === slug);
      if (!found) {
        titleEl.textContent = "Trip not found";
        setStatus("That trip is not on GitHub yet.");
        return;
      }
      const raw = await readTextFile(settings, found.indexPath);
      if (raw == null) {
        setStatus("Could not read the trip index.");
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
    if (!trip || !currentDate || !settings) return false;
    if (saving) return false;
    saving = true;
    const body = bodyEl.value;
    const date = currentDate;
    const slug = trip.slug;
    const title = trip.title;
    setStatus("Saving…");
    try {
      await commit(saveDayMessage(title, date), [
        { path: dayPath(slug, date), bytes: textBytes(body) },
      ]);
      if (!trip.dayDates.includes(date)) trip.dayDates.push(date);
      if (bodyEl.value === body && currentDate === date) dirty = false;
      setStatus("Saved to GitHub");
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed");
      return false;
    } finally {
      saving = false;
    }
  }

  async function saveWithFiles(routes: PreparedRoute[], cover?: string): Promise<void> {
    if (!trip || !currentDate || !settings) return;
    if (saving) return;
    saving = true;
    const body = bodyEl.value;
    const date = currentDate;
    setStatus("Saving…");
    try {
      const files = [
        ...routes.map((file) => ({ path: file.repoPath, bytes: file.bytes })),
        { path: dayPath(trip.slug, date), bytes: textBytes(body) },
      ];
      if (cover && !trip.cover) {
        const raw = await readTextFile(settings, trip.indexPath);
        if (raw != null) {
          const parsed = parseFrontmatter(raw);
          if (!parsed.data.cover) {
            parsed.data.cover = cover;
            files.push({ path: trip.indexPath, bytes: textBytes(stringifyFrontmatter(parsed.data, parsed.body)) });
          }
        }
      }
      await commit(saveDayMessage(trip.title, date), files);
      if (!trip.dayDates.includes(date)) trip.dayDates.push(date);
      if (cover && !trip.cover) {
        trip = { ...trip, cover };
        if (settings.mediaWorkerUrl) {
          await saveTripCover({
            workerUrl: settings.mediaWorkerUrl,
            token: settings.uploadToken || settings.token,
            slug: trip.slug,
            cover,
          });
        }
      }
      dirty = false;
      const usedCover = Boolean(cover && trip.cover === cover);
      await refreshCoverChoices();
      const saved = routes.length ? "Saved the note and route to GitHub" : "Saved the note to GitHub";
      setStatus(usedCover ? "Saved. That photo is the trip thumbnail." : saved);
    } catch (error) {
      dirty = true;
      setStatus(error instanceof Error ? error.message : "Save failed");
    } finally {
      saving = false;
    }
  }

  async function handleFiles(files: File[]): Promise<void> {
    if (!trip || !files.length || !settings) return;
    const photos = filenamesIn(paths, trip.slug, "photos");
    const routes = filenamesIn(paths, trip.slug, "routes");
    const prepared = [];
    for (const file of files) {
      setStatus(`Preparing ${file.name}…`);
      try {
        prepared.push(await prepareDroppedFile(file, trip.slug, photos, routes));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not add that file.");
        return;
      }
    }

    const ready: { markdown: string; route?: PreparedRoute; cover?: string }[] = [];
    for (const item of prepared) {
      if (item.kind === "route" && item.repoPath) {
        ready.push({
          markdown: item.markdown,
          route: { repoPath: item.repoPath, bytes: item.bytes },
        });
        continue;
      }
      if (!item.objectKey || !item.contentType) {
        setStatus("Could not prepare that file.");
        return;
      }
      setStatus(`Uploading ${item.filename}…`);
      try {
        const url = await uploadToBucket({
          workerUrl: settings.mediaWorkerUrl,
          token: settings.uploadToken || settings.token,
          objectKey: item.objectKey,
          bytes: item.bytes,
          contentType: item.contentType,
        });
        const alt = item.filename.replace(/\.[^.]+$/, "");
        ready.push({
          markdown: item.kind === "video" ? videoMarkdownUrl(url) : imageMarkdownUrl(url, alt),
          cover: item.kind === "photo" ? `/trip-media/${trip.slug}/photos/${item.filename}` : undefined,
        });
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Upload failed");
        return;
      }
    }

    for (const item of ready) insertAtCursor(bodyEl, item.markdown);
    const cover = trip.cover ? "" : ready.find((item) => item.cover)?.cover || "";
    await saveWithFiles(ready.flatMap((item) => (item.route ? [item.route] : [])), cover || undefined);
  }

  function renderList(trips: RemoteTrip[]): void {
    tripList.replaceChildren();
    if (!trips.length) {
      const empty = document.createElement("li");
      empty.className = "meta";
      empty.textContent = "No trips on GitHub yet.";
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
    listStatus.textContent = "Loading trips from GitHub…";
    trip = null;
    try {
      await refreshTip();
      if (!settings) return;
      const indexed = indexTrips(paths);
      const trips: RemoteTrip[] = [];
      for (const item of indexed) {
        const raw = await readTextFile(settings, item.indexPath);
        if (raw == null) continue;
        trips.push(tripFromIndex(item.slug, item.indexPath, raw, item.days));
      }
      renderList(trips);
      listStatus.textContent = "Save on this page commits straight to GitHub.";
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
    tip = null;
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
    tip = null;
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
    if (!settings) {
      show("settings");
      return;
    }
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
    listStatus.textContent = "Creating trip on GitHub…";
    try {
      await ensureTip();
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
      await commit(createTripMessage(title, date), [
        { path: indexRepoPath(slug), bytes: textBytes(index) },
        { path: dayRepoPath(slug, date), bytes: textBytes("\n") },
      ]);
      location.assign(`${base}author/?trip=${encodeURIComponent(slug)}&date=${encodeURIComponent(date)}`);
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
    setStatus("Unsaved. Save sends this day to GitHub.");
  });

  saveCoverBtn.addEventListener("click", async () => {
    if (!trip) return;
    setStatus("Saving thumbnail…");
    try {
      const live = await persistCover(coverSelect.value);
      setStatus(live || (coverSelect.value ? "Thumbnail saved." : "Thumbnail will be the first photo in the trip."));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save the thumbnail.");
    }
  });

  publishBtn.addEventListener("click", async () => {
    if (!settings || !trip) return;
    setStatus("Saving…");
    try {
      const raw = await readTextFile(settings, trip.indexPath);
      if (raw == null) throw new Error("Could not read the trip index.");
      const nextDraft = !trip.draft;
      const parsed = parseFrontmatter(raw);
      parsed.data.draft = nextDraft;
      const index = stringifyFrontmatter(parsed.data, parsed.body);
      await commit(`${nextDraft ? "Unpublish" : "Publish"} ${trip.title}`, [
        { path: trip.indexPath, bytes: textBytes(index) },
      ]);
      trip = { ...trip, draft: nextDraft };
      renderTripMeta();
      setStatus(nextDraft ? "Hidden. The next site build will drop this trip." : "Published. The next site build will show this trip.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update the trip.");
    }
  });

  mediaInput.addEventListener("change", () => {
    const files = mediaInput.files ? [...mediaInput.files] : [];
    mediaInput.value = "";
    void handleFiles(files);
  });
  gpxInput.addEventListener("change", () => {
    const files = gpxInput.files ? [...gpxInput.files] : [];
    gpxInput.value = "";
    void handleFiles(files);
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
    const files = event.dataTransfer?.files;
    if (files?.length) void handleFiles([...files]);
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
  if (!settings) show("settings");
  else if (initialTrip) void openTrip(initialTrip, params.get("date") || undefined);
  else void showList();
}
