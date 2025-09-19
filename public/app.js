// BettyQuotes frontend logic
const $ = (s) => document.querySelector(s);
const list = $("#list");
const statusEl = $("#status");
const y = $("#y");
y.textContent = new Date().getFullYear();

// UI helpers
function toast(msg){
  const t = document.createElement('div');
  t.className = 'fixed bottom-5 right-5 z-50 card px-4 py-3 text-sm';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 2500);
}

function renderSkeleton(n=5){
  list.innerHTML = Array.from({length:n}).map(()=>`
    <div class="card">
      <div class="grid grid-cols-8 gap-3 items-center">
        <div class="col-span-3">
          <div class="skel h-5 w-40 mb-2"></div>
          <div class="skel h-3 w-28"></div>
        </div>
        <div class="col-span-3 odds-wrap">
          <div class="skel h-8 w-28"></div>
          <div class="skel h-8 w-28"></div>
          <div class="skel h-8 w-28"></div>
        </div>
        <div class="col-span-2 text-right">${best ? `<div class='text-xs opacity-70 mb-1'>BEST: <b>${best.outcome}</b> @ <b>${best.price}</b> (${best.bookmaker})</div>`:''}
          <div class="skel h-6 w-24 ml-auto"></div>
        </div>
      </div>
    </div>`).join('');
}


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
  statusEl.textContent = 'Loading…'; renderSkeleton(6);
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
    // compute best price inside frontend for quick highlight
    let best = null;
    (ev.odds||[]).forEach(o=>{ if(!best || o.price>best.price) best = o; });

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="row">
        <div class="col-span-3">
          <div class="font-semibold">${ev.home} vs ${ev.away || ''}</div>
          <div class="text-xs opacity-70">${new Date(ev.commence_time).toLocaleString()}</div>
          <div class="text-xs opacity-70">${ev.sport_key || ''}</div>
        </div>
        <div class="col-span-3 odds-wrap">
          ${(ev.odds || []).map(o => `
            <button data-book="${o.bookmaker}" data-outcome="${o.outcome}" data-odd="${o.price}" class="oddbtn text-sm hover:bg-slate-50 dark:hover:bg-white/5">
              ${o.bookmaker}: <span class="font-mono">${o.outcome}</span> @ <span class="font-semibold">${o.price}</span>
            </button>
          `).join('')}
        </div>
        <div class="col-span-2 text-right">${best ? `<div class='text-xs opacity-70 mb-1'>BEST: <b>${best.outcome}</b> @ <b>${best.price}</b> (${best.bookmaker})</div>`:''}
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
loadTop();

// Render referral banners
import('/components/ReferralBanner.js').then(m => m.mount('#refBanners'));


// SmartYield monetization mount
import('/components/SmartYield.js').then(m => {
  const lang = (localStorage.getItem('bq_lang') || (navigator.language||'en').slice(0,2));
  const device = /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
  const country = (window.__COUNTRY__ || 'IT');
  m.mountSmartYield('#yieldSidebar', { slot:'sidebar', lang, device, country, sport: (document.querySelector('#sportSelect')||{}).value || 'soccer_epl' });
});

document.getElementById("btnTop").addEventListener("click", ()=>loadTop());

async function loadTop(){
  statusEl.textContent = 'Top loading…';
  let data = [];
  try{
    const res = await fetch(`/api/top?limit=100`);
    data = await res.json();
  }catch(e){ console.error(e); }
  statusEl.textContent = `${data.length} top eventi`;
  list.innerHTML = "";
  data.forEach(ev => {
    // compute best price inside frontend for quick highlight
    let best = null;
    (ev.odds||[]).forEach(o=>{ if(!best || o.price>best.price) best = o; });

    const card = document.createElement('div');
    card.className = 'card';
    const tagSure = ev.sure ? `<span class="badge badge-green ml-2">SUREBET</span>` : ``;
    const tagVal = (ev.value_score!=null) ? `<span class="badge ${ev.value_score>=0?'badge-green':'badge-red'} ml-2">value ${(ev.value_score*100).toFixed(1)}%</span>` : '';
    card.innerHTML = `
      <div class="row">
        <div class="col-span-3">
          <div class="font-semibold">${ev.home} vs ${ev.away || ''}</div>
          <div class="text-xs opacity-70">${new Date(ev.commence_time).toLocaleString()}</div>
          <div class="text-xs opacity-70">${ev.sport_key || ''}</div>
        </div>
        <div class="col-span-3 odds-wrap">
          ${(ev.odds || []).slice(0,8).map(o => `
            <button data-book="${o.bookmaker}" data-outcome="${o.outcome}" data-odd="${o.price}" class="oddbtn text-sm hover:bg-slate-50 dark:hover:bg-white/5">
              ${o.bookmaker}: <span class="font-mono">${o.outcome}</span> @ <span class="font-semibold">${o.price}</span>
            </button>
          `).join('')}
        </div>
        <div class="col-span-2 text-right">${best ? `<div class='text-xs opacity-70 mb-1'>BEST: <b>${best.outcome}</b> @ <b>${best.price}</b> (${best.bookmaker})</div>`:''}${tagVal}${tagSure}</div>
      </div>
    `;
    card.querySelectorAll('button').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const bookmaker = btn.dataset.book;
        const outcome = btn.dataset.outcome;
        const price = btn.dataset.odd;
        await (async ()=>{
          try{
            const blob = new Blob([JSON.stringify({bookmaker, outcome, price, sport: ev.sport_key, event_id: ev.id})], {type:'application/json'});
            navigator.sendBeacon('/api/track', blob);
          }catch(e){}
        })();
        location.href = `/go/${encodeURIComponent(bookmaker)}?e=${encodeURIComponent(ev.id)}&o=${encodeURIComponent(outcome)}&p=${encodeURIComponent(price)}`;
      });
    });
    list.appendChild(card);
  });
}

// Create chips from sports config
const chips = $("#chips");
if (chips && sports.sports?.length){
  chips.innerHTML = sports.sports.slice(0,8).map((s,i)=>`<span class="chip ${i===0?'active':''}" data-key="${s.key}">${s.name.split('•')[1]?.trim()||s.name}</span>`).join('');
  chips.querySelectorAll('.chip').forEach(ch=>{
    ch.addEventListener('click', ()=>{
      chips.querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));
      ch.classList.add('active');
      sportSelect.value = ch.dataset.key;
      loadAndRender('all');
    });
  });
}

// search by team/league locally
const searchBar = $("#searchBar");
searchBar?.addEventListener('input', ()=>{
  const q = searchBar.value.trim().toLowerCase();
  document.querySelectorAll('#list .card').forEach(card=>{
    const txt = card.textContent.toLowerCase();
    card.style.display = txt.includes(q) ? '' : 'none';
  });
});

// === THEME ENGINE (data-theme) ===
const themeBtnEl = document.getElementById('themeBtn');
function preferredTheme(){
  const saved = localStorage.getItem('theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function applyThemeData(t){
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
  if (themeBtnEl) themeBtnEl.textContent = (t==='dark' ? '☾' : '☀︎');
}
applyThemeData(preferredTheme());
themeBtnEl?.addEventListener('click', ()=>{
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  applyThemeData(cur==='dark' ? 'light' : 'dark');
});




