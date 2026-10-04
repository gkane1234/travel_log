const SETTINGS_KEY = "travel-log-motion";

const DEFAULTS = {
  peakOpacity: 0.8,
  travelPercent: 10,
  fadeIn: 1.4,
  fadeOut: 1.6,
  hold: 0.8,
  spawn: 2.2,
  appearDelay: 2,
  recentLimit: 20,
  maxPhotos: 5,
  nameSpeed: 24,
  nameCards: 4,
  photoWidth: 280,
  cardSize: 80,
  look: "current",
};

function field(name, label, min, max, step) {
  return `<label>${label}<input name="${name}" type="number" min="${min}" max="${max}" step="${step}" /></label>`;
}

function choice(name, label, options) {
  const items = options.map(([value, text]) => `<option value="${value}">${text}</option>`).join("");
  return `<label>${label}<select name="${name}">${items}</select></label>`;
}

export function motionMarkup(model) {
  const payload = JSON.stringify(model).replace(/</g, "\\u003c");
  const chrome = `<div id="motion-names" aria-hidden="true"></div>
<div id="motion-layer" aria-hidden="true"></div>
<button type="button" id="motion-toggle" aria-expanded="false" aria-controls="motion-debug">Motion</button>
<aside id="motion-debug" hidden>
  <form id="motion-form">
    ${choice("look", "Photo style", [["current", "Current"], ["cards", "Cards"]])}
    ${field("peakOpacity", "Peak opacity", 0.05, 1, 0.05)}
    ${field("travelPercent", "Travel distance (% of screen)", 1, 80, 1)}
    ${field("fadeIn", "Fade in (seconds)", 0.1, 12, 0.1)}
    ${field("hold", "Hold (seconds)", 0, 12, 0.1)}
    ${field("fadeOut", "Fade out (seconds)", 0.1, 12, 0.1)}
    ${field("spawn", "New photo every (seconds)", 0.3, 20, 0.1)}
    ${field("appearDelay", "Appear delay (seconds)", 0, 8, 0.1)}
    ${field("recentLimit", "Recent photos", 1, 80, 1)}
    ${field("maxPhotos", "Photos on screen", 1, 20, 1)}
    ${field("photoWidth", "Photo width (px)", 80, 640, 10)}
    ${field("cardSize", "Card size (px)", 40, 320, 4)}
    ${field("nameSpeed", "Name card speed", 4, 120, 1)}
    ${field("nameCards", "Name cards", 0, 12, 1)}
  </form>
  <ol id="recent-photos"></ol>
  <p class="debug-note">These values stay in this browser.</p>
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
  if (settings.look !== "cards") settings.look = "current";
  let spawnAt = 0;
  let cards = [];
  let floats = [];
  const driftCards = [];
  const photoMeta = {};

  for (const input of form.elements) {
    if (!input.name || !(input.name in settings)) continue;
    input.value = String(settings[input.name]);
    input.addEventListener("input", () => {
      if (input.name === "look") {
        settings.look = input.value === "cards" ? "cards" : "current";
        localStorage.setItem(KEY, JSON.stringify(settings));
        applyStyle();
        return;
      }
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      settings[input.name] = value;
      localStorage.setItem(KEY, JSON.stringify(settings));
      if (input.name === "nameCards" || input.name === "nameSpeed") syncCards();
      if (input.name === "recentLimit") paintRecent();
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
  function cardMode() {
    return settings.look === "cards";
  }
  function applyStyle() {
    if (cardMode()) {
      floats.forEach((photo) => photo.el.remove());
      floats = [];
      while (cards.length) cards.pop().el.remove();
    } else {
      driftCards.forEach((card) => card.remove());
      driftCards.length = 0;
      syncCards();
    }
    spawnAt = 0;
  }
  function syncCards() {
    if (cardMode()) return;
    const count = Math.max(0, Math.round(settings.nameCards));
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
  const recent = [];
  function photoName(url) {
    const clean = String(url || "").split("?")[0].split("#")[0];
    const parts = clean.split("/");
    const base = parts[parts.length - 1] || "";
    try { return decodeURIComponent(base); } catch (error) { return base; }
  }
  function recentCap() {
    return Math.max(1, Math.round(Number(settings.recentLimit) || defaults.recentLimit));
  }
  function paintRecent() {
    const cap = recentCap();
    while (recent.length > cap) recent.shift();
    const list = document.getElementById("recent-photos");
    if (!list) return;
    list.replaceChildren();
    recent.forEach((name) => {
      const item = document.createElement("li");
      item.textContent = name;
      list.append(item);
    });
  }
  function remember(name) {
    if (!name) return;
    const existing = recent.indexOf(name);
    if (existing !== -1) recent.splice(existing, 1);
    recent.push(name);
    paintRecent();
  }
  function pickPhotoUrl() {
    if (!photos.length) return "";
    const cap = recentCap();
    while (recent.length > cap) recent.shift();
    const blocked = {};
    recent.forEach((name) => { blocked[name] = true; });
    const choices = [];
    photos.forEach((url) => {
      if (!blocked[photoName(url)]) choices.push(url);
    });
    if (choices.length) return choices[Math.floor(Math.random() * choices.length)];
    if (!recent.length) return photos[Math.floor(Math.random() * photos.length)];
    recent.shift();
    paintRecent();
    return pickPhotoUrl();
  }
  function queueDrift() {
    const maxPhotos = Math.max(1, Math.round(settings.maxPhotos));
    if (!photos.length || driftCards.length + floatPending >= maxPhotos) return;
    const url = pickPhotoUrl();
    if (!url || url.indexOf("/travel-log/posters/") !== -1) return;
    const fileName = photoName(url);
    const meta = photoMeta[url] || {};
    remember(fileName);
    floatPending += 1;
    const img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    loadQueue.unshift({
      img,
      url,
      show() {
        const maxWait = Math.max(0, Number(settings.appearDelay) || 0);
        const wait = Math.random() * maxWait * 1000;
        window.setTimeout(() => {
          floatPending -= 1;
          if (!cardMode()) return;
          if (driftCards.length >= Math.max(1, Math.round(settings.maxPhotos))) return;
          const card = document.createElement("figure");
          card.className = "photo-card";
          const caption = document.createElement("figcaption");
          const title = document.createElement("strong");
          title.textContent = meta.title || "";
          const when = document.createElement("span");
          const bits = [];
          if (meta.location) bits.push(meta.location);
          if (meta.when) bits.push(meta.when);
          when.textContent = bits.join(" · ");
          caption.append(title, when);
          card.append(img, caption);
          const size = Math.max(40, Number(settings.cardSize) || 80);
          const angle = Math.random() * Math.PI * 2;
          card.style.width = size + "px";
          card.style.opacity = String(Math.min(1, Math.max(0, Number(settings.peakOpacity) || 0)));
          img.style.height = Math.round(size * 0.66) + "px";
          card.dataset.angle = String(angle);
          card.dataset.x = String(Math.random() * Math.max(1, window.innerWidth - size));
          card.dataset.y = String(Math.random() * Math.max(1, window.innerHeight - size));
          layer.append(card);
          driftCards.push(card);
        }, wait);
      },
      failed() {
        floatPending -= 1;
        remember(fileName);
        queueFloat();
      },
    });
    pumpLoads();
  }
  function queueFloat() {
    if (cardMode()) {
      queueDrift();
      return;
    }
    const maxPhotos = Math.max(1, Math.round(settings.maxPhotos));
    if (!photos.length || floats.length + floatPending >= maxPhotos) return;
    const url = pickPhotoUrl();
    if (!url) return;
    const fileName = photoName(url);
    remember(fileName);
    floatPending += 1;
    const img = document.createElement("img");
    img.className = "float-photo";
    img.alt = "";
    img.decoding = "async";
    img.style.opacity = "0";
    const angle = Math.random() * Math.PI * 2;
    img.style.left = (8 + Math.random() * 70) + "%";
    img.style.top = (8 + Math.random() * 70) + "%";
    loadQueue.unshift({
      img,
      url,
      show() {
        const maxWait = Math.max(0, Number(settings.appearDelay) || 0);
        const wait = Math.random() * maxWait * 1000;
        window.setTimeout(() => {
          floatPending -= 1;
          if (cardMode()) return;
          if (floats.length >= Math.max(1, Math.round(settings.maxPhotos))) return;
          layer.append(img);
          floats.push({ el: img, born: performance.now(), angle });
        }, wait);
      },
      failed() {
        floatPending -= 1;
        remember(fileName);
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
    if (cardMode()) {
      const speed = Math.max(0, Number(settings.nameSpeed) || 0);
      const size = Math.max(40, Number(settings.cardSize) || 80);
      const opacity = Math.min(1, Math.max(0, Number(settings.peakOpacity) || 0));
      for (const card of driftCards) {
        let x = Number(card.dataset.x) + Math.cos(Number(card.dataset.angle)) * speed * dt;
        let y = Number(card.dataset.y) + Math.sin(Number(card.dataset.angle)) * speed * dt;
        const w = card.offsetWidth || size;
        const h = card.offsetHeight || size;
        if (x < -w) x = window.innerWidth;
        if (x > window.innerWidth) x = -w;
        if (y < -h) y = window.innerHeight;
        if (y > window.innerHeight) y = -h;
        card.dataset.x = String(x);
        card.dataset.y = String(y);
        card.style.width = size + "px";
        card.style.opacity = String(opacity);
        card.style.transform = "translate(" + x + "px," + y + "px)";
        const img = card.querySelector("img");
        if (img) img.style.height = Math.round(size * 0.66) + "px";
      }
      if (now >= spawnAt) spawn(now);
      requestAnimationFrame(tick);
      return;
    }
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
  function addListedTrip(trip) {
    const list = document.getElementById(trip.kind === "outing" ? "outing-list" : "trip-list");
    if (!list) return;
    const li = document.createElement("li");
    li.dataset.date = trip.date || "";
    const link = document.createElement("a");
    link.href = "/travel-log/trips/" + encodeURIComponent(trip.slug) + "/";
    if (trip.thumb) {
      const img = document.createElement("img");
      img.className = "thumb";
      img.alt = "";
      img.decoding = "async";
      img.src = trip.thumb;
      link.append(img);
    }
    const span = document.createElement("span");
    const title = document.createElement("h2");
    title.textContent = trip.title || trip.slug || "Trip";
    span.append(title);
    const where = [trip.location, trip.when].filter(Boolean).join(" · ");
    if (where) {
      const meta = document.createElement("p");
      meta.className = "meta";
      meta.textContent = where;
      span.append(meta);
    }
    if (trip.summary) {
      const summary = document.createElement("p");
      summary.textContent = trip.summary;
      span.append(summary);
    }
    link.append(span);
    li.append(link);
    let placed = false;
    for (const child of Array.from(list.children)) {
      if ((child.dataset.date || "") < (li.dataset.date || "")) {
        list.insertBefore(li, child);
        placed = true;
        break;
      }
    }
    if (!placed) list.append(li);
    trips.push({ title: trip.title || "", when: trip.when || "", thumb: trip.thumb || "" });
    if (!cardMode()) syncCards();
  }
  function addListedPhoto(item) {
    const url = item && item.url ? item.url : "";
    if (!url || url.indexOf("/travel-log/media/") !== 0 || url.indexOf("/posters/") !== -1) return;
    if (photos.indexOf(url) !== -1 || photos.length >= 240) return;
    photos.push(url);
    photoMeta[url] = { title: item.title || "", location: item.location || "", when: item.when || "" };
  }
  async function readNdjson(response, onItem) {
    if (!response || !response.ok || !response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const nl = String.fromCharCode(10);
    let buf = "";
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      buf += decoder.decode(step.value, { stream: true });
      let cut = buf.indexOf(nl);
      while (cut !== -1) {
        const line = buf.slice(0, cut).trim();
        buf = buf.slice(cut + 1);
        if (line) onItem(JSON.parse(line));
        cut = buf.indexOf(nl);
      }
    }
    const last = buf.trim();
    if (last) onItem(JSON.parse(last));
  }
  async function loadHome() {
    if (!document.getElementById("log-panel")) return;
    const tripResponse = await fetch("/travel-log/home-trips", { credentials: "same-origin" });
    const photoResponse = fetch("/travel-log/home-photos", { credentials: "same-origin" });
    await readNdjson(tripResponse, addListedTrip);
    await readNdjson(await photoResponse, addListedPhoto);
  }
  void loadHome();
  if (!document.querySelector(".trip-list")) return;
  if (!cardMode()) syncCards();
  requestAnimationFrame(tick);
})();
</script>`;
  return { chrome, script };
}
