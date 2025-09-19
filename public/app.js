// BettyQuotes frontend logic
const $ = (s) => document.querySelector(s);
const list = $("#list");
const statusEl = $("#status");
const y = $("#y");
y.textContent = new Date().getFullYear();

const i18n = {
  lang: localStorage.getItem("bq_lang") || (navigator.language || "en").slice(0,2),
  t(key){ const dict = this.lang.startsWith("it") ? it : en; return (dict[key]||key); }
};

let it, en;
async function loadLang(){
  it = await fetch('/i18n/it.json').then(r=>r.json());
  en = await fetch('/i18n/en.json').then(r=>r.json());
}
await loadLang();

// Theme toggle
const themeBtn = $("#themeBtn");
const langBtn = $("#langBtn");
function applyTheme(){
  const m = localStorage.getItem("theme") || (window.matchMedia('(prefers-color-scheme: dark)').matches ? "dark":"light");
  document.documentElement.classList.toggle("dark", m==="dark");
}
applyTheme();
themeBtn?.addEventListener("click", ()=>{
  const cur = document.documentElement.classList.contains("dark") ? "dark":"light";
  const nxt = cur==="dark"?"light":"dark";
  localStorage.setItem("theme", nxt);
  applyTheme();
});

langBtn?.addEventListener("click", ()=>{
  i18n.lang = i18n.lang.startsWith("it") ? "en" : "it";
  localStorage.setItem("bq_lang", i18n.lang);
  location.reload();
});

// Load config + sports
const sports = await fetch('/config.json').then(r=>r.json()).catch(()=>({sports:[]}));
const sportSelect = $("#sportSelect");
sports.sports.forEach(s => {
  const opt = document.createElement('option');
  opt.value = s.key;
  opt.textContent = s.name;
  sportSelect.appendChild(opt);
});
sportSelect.value = sports.sports[0]?.key || "";

// Buttons
$("#btnAll").addEventListener("click", loadAndRender);
$("#btnValue").addEventListener("click", ()=>loadAndRender('value'));
$("#btnSure").addEventListener("click", ()=>loadAndRender('sure'));
$("#btnExport").addEventListener("click", async ()=>{
  const sp = sportSelect.value;
  const url = `/api/export_csv?sport=${encodeURIComponent(sp)}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = `bettyquotes_${sp}_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
});

async function beacon(endpoint, payload){
  try {
    const blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
    navigator.sendBeacon(endpoint, blob);
  } catch(e){}
}

async function loadAndRender(mode='all'){
  const sp = sportSelect.value;
  statusEl.textContent = 'Loading…';
  let data = [];
  try{
    const url = mode==='value' ? `/api/valuebets?sport=${sp}` :
                mode==='sure' ? `/api/surebets?sport=${sp}` :
                                 `/api/odds?sport=${sp}`;
    const res = await fetch(url);
    data = await res.json();
  }catch(e){ console.error(e); }
  statusEl.textContent = `${data.length} eventi`;

  list.innerHTML = "";
  data.forEach(ev => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="row">
        <div class="col-span-3">
          <div class="font-semibold">${ev.home} vs ${ev.away || ''}</div>
          <div class="text-xs opacity-70">${new Date(ev.commence_time).toLocaleString()}</div>
          <div class="text-xs opacity-70">${ev.sport_key || ''}</div>
        </div>
        <div class="col-span-3 flex gap-2 flex-wrap">
          ${(ev.odds || []).map(o => `
            <button data-book="${o.bookmaker}" data-outcome="${o.outcome}" data-odd="${o.price}" class="px-2 py-1 rounded-lg border text-sm hover:bg-slate-50 dark:hover:bg-white/5">
              ${o.bookmaker}: <span class="font-mono">${o.outcome}</span> @ <span class="font-semibold">${o.price}</span>
            </button>
          `).join('')}
        </div>
        <div class="col-span-2 text-right">
          ${(ev.edge!=null) ? `<span class="badge ${ev.edge>=0? 'badge-green':'badge-red'}">edge ${(ev.edge*100).toFixed(1)}%</span>`:''}
          ${(ev.sure!=null) ? `<span class="badge ${ev.sure? 'badge-green':'badge-red'} ml-2">${ev.sure?'SUREBET':'NO-ARB'}</span>`:''}
        </div>
      </div>
    `;
    card.querySelectorAll('button').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const bookmaker = btn.dataset.book;
        const outcome = btn.dataset.outcome;
        const price = btn.dataset.odd;
        await beacon('/api/track', {bookmaker, outcome, price, sport: ev.sport_key, event_id: ev.id});
        location.href = `/go/${encodeURIComponent(bookmaker)}?e=${encodeURIComponent(ev.id)}&o=${encodeURIComponent(outcome)}&p=${encodeURIComponent(price)}`;
      });
    });
    list.appendChild(card);
  });

  // banners / partners
  const banners = await (await fetch('/components/ReferralBanner.js')).text(); // ping for cache
}
loadAndRender();

// Render referral banners
import('/components/ReferralBanner.js').then(m => m.mount('#refBanners'));


// SmartYield monetization mount
import('/components/SmartYield.js').then(m => {
  const lang = (localStorage.getItem('bq_lang') || (navigator.language||'en').slice(0,2));
  const device = /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
  const country = (window.__COUNTRY__ || 'IT');
  m.mountSmartYield('#yieldSidebar', { slot:'sidebar', lang, device, country, sport: (document.querySelector('#sportSelect')||{}).value || 'soccer_epl' });
});
