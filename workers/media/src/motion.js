const SETTINGS_KEY = "travel-log-motion";

const DEFAULTS = {
  peakOpacity: 0.8,
  travelPercent: 10,
  fadeIn: 1.4,
  fadeOut: 1.6,
  hold: 0.8,
  spawn: 2.2,
  maxPhotos: 5,
  nameSpeed: 24,
  nameCards: 4,
  photoWidth: 280,
  posterSize: 220,
  posterOpacity: 0.42,
};

function field(name, label, min, max, step) {
  return `<label>${label}<input name="${name}" type="number" min="${min}" max="${max}" step="${step}" /></label>`;
}

export function posterStage(cards) {
  const tiles = [];
  for (const card of cards) {
    const caption = [card.location, card.when].filter(Boolean).join(" · ");
    const sources = card.posters?.length ? card.posters : [""];
    for (const src of sources) {
      const image = src ? `<img src="${escapeAttr(src)}" alt="" />` : "";
      tiles.push(
        `<figure class="poster">${image}<figcaption><strong>${escapeAttr(card.title || "")}</strong><span>${escapeAttr(caption)}</span></figcaption></figure>`,
      );
    }
  }
  if (!tiles.length) return "";
  return `<div class="stage" id="poster-stage">${tiles.join("")}</div>
<script>
(() => {
  const KEY = ${JSON.stringify(SETTINGS_KEY)};
  const saved = read();
  const stage = document.getElementById("poster-stage");
  if (!stage) return;
  const size = Number(saved.posterSize) || ${DEFAULTS.posterSize};
  const opacity = Number(saved.posterOpacity);
  for (const card of stage.querySelectorAll(".poster")) {
    card.style.width = size + "px";
    card.style.opacity = Number.isFinite(opacity) ? String(opacity) : "${DEFAULTS.posterOpacity}";
    const x = Math.random() * Math.max(1, window.innerWidth - size);
    const y = Math.random() * Math.max(1, window.innerHeight - 180);
    const angle = Math.random() * Math.PI * 2;
    const speed = 12 + Math.random() * 18;
    card.dataset.x = String(x);
    card.dataset.y = String(y);
    card.dataset.vx = String(Math.cos(angle) * speed);
    card.dataset.vy = String(Math.sin(angle) * speed);
  }
  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    for (const card of stage.querySelectorAll(".poster")) {
      let x = Number(card.dataset.x) + Number(card.dataset.vx) * dt;
      let y = Number(card.dataset.y) + Number(card.dataset.vy) * dt;
      const w = card.offsetWidth || size;
      const h = card.offsetHeight || 180;
      if (x < -w) x = window.innerWidth;
      if (x > window.innerWidth) x = -w;
      if (y < -h) y = window.innerHeight;
      if (y > window.innerHeight) y = -h;
      card.dataset.x = String(x);
      card.dataset.y = String(y);
      card.style.transform = "translate(" + x + "px," + y + "px)";
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
  }
})();
</script>`;
}

export function motionMarkup(model) {
  const payload = JSON.stringify(model).replace(/</g, "\\u003c");
  const chrome = `<div id="motion-names" aria-hidden="true"></div>
<div id="motion-layer" aria-hidden="true"></div>
<button type="button" id="motion-toggle" aria-expanded="false" aria-controls="motion-debug">Motion</button>
<aside id="motion-debug" hidden>
  <form id="motion-form">
    ${field("peakOpacity", "Peak opacity", 0.05, 1, 0.05)}
    ${field("travelPercent", "Travel distance (% of screen)", 1, 80, 1)}
    ${field("fadeIn", "Fade in (seconds)", 0.1, 12, 0.1)}
    ${field("hold", "Hold (seconds)", 0, 12, 0.1)}
    ${field("fadeOut", "Fade out (seconds)", 0.1, 12, 0.1)}
    ${field("spawn", "New photo every (seconds)", 0.3, 20, 0.1)}
    ${field("maxPhotos", "Photos on screen", 1, 20, 1)}
    ${field("photoWidth", "Photo width (px)", 80, 640, 10)}
    ${field("nameSpeed", "Name card speed", 4, 120, 1)}
    ${field("nameCards", "Name cards", 1, 12, 1)}
    ${field("posterSize", "Login poster size (px)", 80, 480, 10)}
    ${field("posterOpacity", "Login poster opacity", 0.05, 1, 0.05)}
  </form>
  <p class="debug-note">Poster size and opacity show on the login page after a refresh. These values stay in this browser.</p>
</aside>`;
  const script = `<script type="application/json" id="motion-data">${payload}</script>
<script>
(() => {
  const KEY = ${JSON.stringify(SETTINGS_KEY)};
  const defaults = ${JSON.stringify(DEFAULTS)};
  const data = JSON.parse(document.getElementById("motion-data").textContent || "{}");
  const photos = Array.isArray(data.photos) ? data.photos : [];
  const trips = Array.isArray(data.trips) ? data.trips : [];
  const FLOAT_LOADERS = 3;
  let activeLoads = 0;
  let floatPending = 0;
  const loadQueue = [];
  const names = document.getElementById("motion-names");
  const layer = document.getElementById("motion-layer");
  const form = document.getElementById("motion-form");
  const panel = document.getElementById("motion-debug");
  const toggle = document.getElementById("motion-toggle");
  const settings = Object.assign({}, defaults, read());
  let spawnAt = 0;
  let cards = [];
  let floats = [];

  for (const input of form.elements) {
    if (!input.name || !(input.name in settings)) continue;
    input.value = String(settings[input.name]);
    input.addEventListener("input", () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      settings[input.name] = value;
      localStorage.setItem(KEY, JSON.stringify(settings));
      if (input.name === "nameCards" || input.name === "nameSpeed") syncCards();
    });
  }
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = panel.hasAttribute("hidden");
    if (open) panel.removeAttribute("hidden");
    else panel.setAttribute("hidden", "");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
  }
  function syncCards() {
    const count = Math.max(1, Math.round(settings.nameCards));
    while (cards.length < count && trips.length) {
      const trip = trips[cards.length % trips.length];
      const card = document.createElement("div");
      card.className = "name-card";
      if (trip.thumb) {
        const img = document.createElement("img");
        img.alt = "";
        img.decoding = "async";
        card.append(img);
        enqueueLoad(img, trip.thumb);
      }
      const label = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = trip.title || "Trip";
      label.append(title);
      if (trip.when) {
        const dates = document.createElement("em");
        dates.textContent = trip.when;
        label.append(dates);
      }
      card.append(label);
      names.append(card);
      const angle = Math.random() * Math.PI * 2;
      cards.push({
        el: card,
        x: Math.random() * Math.max(1, window.innerWidth - 220),
        y: Math.random() * Math.max(1, window.innerHeight - 80),
        angle,
      });
    }
    while (cards.length > count) {
      const gone = cards.pop();
      gone.el.remove();
    }
  }
  function pumpLoads() {
    while (activeLoads < FLOAT_LOADERS && loadQueue.length) {
      const job = loadQueue.shift();
      activeLoads += 1;
      let settled = false;
      const release = () => {
        if (settled) return;
        settled = true;
        activeLoads -= 1;
        pumpLoads();
      };
      job.img.addEventListener("error", () => {
        if (job.failed) job.failed();
        release();
      });
      job.img.addEventListener("load", () => {
        const decoded = typeof job.img.decode === "function" ? job.img.decode() : Promise.resolve();
        decoded.then(() => {
          if (!(job.img.naturalWidth > 0)) {
            if (job.failed) job.failed();
            release();
            return;
          }
          if (job.show) job.show();
          release();
        }, () => {
          if (job.failed) job.failed();
          release();
        });
      });
      job.img.src = job.url;
    }
  }
  function enqueueLoad(img, url) {
    loadQueue.push({ img, url });
    pumpLoads();
  }
  function queueFloat() {
    const maxPhotos = Math.max(1, Math.round(settings.maxPhotos));
    if (!photos.length || floats.length + floatPending >= maxPhotos) return;
    floatPending += 1;
    const img = document.createElement("img");
    img.className = "float-photo";
    img.alt = "";
    img.decoding = "async";
    img.style.opacity = "0";
    const angle = Math.random() * Math.PI * 2;
    img.style.left = (8 + Math.random() * 70) + "%";
    img.style.top = (8 + Math.random() * 70) + "%";
    const url = photos[Math.floor(Math.random() * photos.length)];
    loadQueue.unshift({
      img,
      url,
      show() {
        floatPending -= 1;
        if (floats.length >= Math.max(1, Math.round(settings.maxPhotos))) return;
        layer.append(img);
        floats.push({ el: img, born: performance.now(), angle });
      },
      failed() {
        floatPending -= 1;
        queueFloat();
      },
    });
    pumpLoads();
  }
  function spawn(now) {
    spawnAt = now + Math.max(0.3, settings.spawn) * 1000;
    queueFloat();
  }
  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const speed = Math.max(1, settings.nameSpeed);
    for (const card of cards) {
      card.x += Math.cos(card.angle) * speed * dt;
      card.y += Math.sin(card.angle) * speed * dt;
      const w = card.el.offsetWidth || 180;
      const h = card.el.offsetHeight || 56;
      if (card.x < -w) card.x = window.innerWidth;
      if (card.x > window.innerWidth) card.x = -w;
      if (card.y < -h) card.y = window.innerHeight;
      if (card.y > window.innerHeight) card.y = -h;
      card.el.style.transform = "translate(" + card.x + "px," + card.y + "px)";
    }
    const fadeIn = Math.max(0.05, settings.fadeIn) * 1000;
    const hold = Math.max(0, settings.hold) * 1000;
    const fadeOut = Math.max(0.05, settings.fadeOut) * 1000;
    const total = fadeIn + hold + fadeOut;
    const dist = (Math.max(1, settings.travelPercent) / 100) * Math.min(window.innerWidth, window.innerHeight);
    const peak = Math.min(1, Math.max(0, settings.peakOpacity));
    const width = Math.max(40, settings.photoWidth);
    floats = floats.filter((photo) => {
      const age = now - photo.born;
      const t = Math.min(1, age / total);
      let opacity = peak;
      if (age < fadeIn) opacity = peak * (age / fadeIn);
      else if (age > fadeIn + hold) opacity = peak * (1 - Math.min(1, (age - fadeIn - hold) / fadeOut));
      photo.el.style.opacity = String(Math.max(0, opacity));
      photo.el.style.width = width + "px";
      photo.el.style.transform = "translate(" + (Math.cos(photo.angle) * dist * t) + "px," + (Math.sin(photo.angle) * dist * t) + "px)";
      if (age < total) return true;
      photo.el.remove();
      return false;
    });
    if (now >= spawnAt) spawn(now);
    requestAnimationFrame(tick);
  }
  if (!document.querySelector(".trip-list")) return;
  syncCards();
  requestAnimationFrame(tick);
})();
</script>`;
  return { chrome, script };
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}
