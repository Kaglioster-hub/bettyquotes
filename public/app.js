const $ = (s) => document.querySelector(s);
const list = $("#list");
const statusEl = $("#status");
const sel = $("#sportSelect");

async function fetchJSON(url, ms = 10000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } catch (e) {
    clearTimeout(t);
    console.error("fetchJSON error:", e);
    return null;
  }
}

function renderEvents(evts) {
  list.innerHTML = "";
  if (!Array.isArray(evts) || evts.length === 0) {
    list.innerHTML = `<div class="card">Nessun evento disponibile. Prova un altro sport o più tardi.</div>`;
    if (statusEl) statusEl.textContent = "0 eventi";
    return;
  }
  if (statusEl) statusEl.textContent = `${evts.length} eventi`;
  const frag = document.createDocumentFragment();
  evts.forEach((e) => {
    const row = document.createElement("div");
    row.className = "card";
    const odds = (e.odds || []).slice(0, 6).map(o => {
      const odd = Number(o.price || 0).toFixed(2);
      const bk = (o.bookmaker || "").toUpperCase();
      return `<button class="oddbtn" data-book="${o.bookmaker}" data-outcome="${o.outcome}" data-odd="${odd}">${bk} • ${o.outcome} ${odd}</button>`;
    }).join(" ");
    row.innerHTML = `
      <div class="row">
        <div>
          <div class="text-sm opacity-80">${e.sport_key || ""}</div>
          <div class="font-semibold">${e.home || ""} vs ${e.away || ""}</div>
          <div class="text-xs opacity-70">${e.commence_time || ""}</div>
        </div>
        <div class="odds-wrap">${odds || '<span class="text-sm opacity-70">Quote non disponibili</span>'}</div>
      </div>`;
    frag.appendChild(row);
  });
  list.appendChild(frag);
}

// tracking/monetization redirect soft
document.addEventListener("click", (e) => {
  const b = e.target.closest(".oddbtn");
  if (!b) return;
  try {
    navigator.sendBeacon("/api/track", new Blob([JSON.stringify({
      bookmaker: b.dataset.book, outcome: b.dataset.outcome, price: b.dataset.odd, ts: Date.now()
    })], { type: "application/json" }));
  } catch (_) {}
  setTimeout(() => {
    window.open("https://www.bet365.com/", "_blank", "noopener");
  }, 80);
});

async function loadAndRender() {
  const sport = (sel && sel.value) || localStorage.getItem("bq_sport") || "soccer_epl";
  const url = `/api/odds?sport=${encodeURIComponent(sport)}`;
  console.log("Loading odds:", url);
  const data = await fetchJSON(url);
  console.log("Odds result:", data);
  if (!data || (Array.isArray(data) && data.length === 0)) {
    await fetchJSON("/api/reseed_demo");
    const retry = await fetchJSON(url);
    renderEvents(retry || []);
  } else {
    renderEvents(data);
  }
}

(async function init() {
  const cfg = await fetchJSON("/config.json");
  const sp = cfg?.sports || [];
  if (sel && sp.length) {
    sel.innerHTML = sp.map(s => `<option value="${s.key}">${s.name}</option>`).join("");
    const saved = localStorage.getItem("bq_sport");
    if (saved && sp.some(x => x.key === saved)) sel.value = saved;
    sel.addEventListener("change", () => {
      localStorage.setItem("bq_sport", sel.value);
      loadAndRender();
    });
  }
  await loadAndRender();
})();
