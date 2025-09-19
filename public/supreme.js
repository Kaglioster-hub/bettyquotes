
/* SUPREME_CORE (tema + sync + search + tracking + fallback + diag) */
(()=>{ if(window.__BQS_SUPREME_CORE__) return; window.__BQS_SUPREME_CORE__=true;
  const $=s=>document.querySelector(s), chips=$('#chips'), sel=$('#sportSelect'), themeBtn=$('#themeBtn');

  // THEME
  const pref=()=>{try{const s=localStorage.getItem("theme"); if(s==="light"||s==="dark")return s;}catch(_){ } return (matchMedia&&matchMedia("(prefers-color-scheme: light)").matches)?"light":"dark";}
  const apply=t=>{document.documentElement.setAttribute("data-theme",t); document.documentElement.classList.toggle("dark",t==="dark"); try{localStorage.setItem("theme",t);}catch(_){ } if(themeBtn){themeBtn.setAttribute("aria-pressed",String(t==="dark")); themeBtn.textContent=t==="dark"?"☾":"☀︎";}}
  apply(pref()); themeBtn?.addEventListener("click",()=>{const cur=document.documentElement.getAttribute("data-theme")||"dark"; apply(cur==="dark"?"light":"dark");});

  // DIAG PV
  try{ const b=new Blob([JSON.stringify({path:location.pathname,ts:Date.now()})],{type:"application/json"}); navigator.sendBeacon("/api/pv",b);}catch(_){}

  const safeJSON=async(u,ms=7000)=>{const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);try{const r=await fetch(u,{signal:c.signal});clearTimeout(t);if(!r.ok)throw new Error(r.status);return await r.json();}catch(e){clearTimeout(t);return null;}};

  // Populate sports from config.json
  (async function initSports(){
    const cfg=await safeJSON("/config.json"); const sp=cfg?.sports||[];
    if(sel && sp.length){ sel.innerHTML=sp.map(s=>`<option value="${s.key}">${s.name}</option>`).join(""); }
    if(chips && sp.length){ const val=sel?.value || sp[0]?.key || ""; chips.innerHTML=sp.slice(0,12).map(s=>{const lab=(s.name||"").split("•")[1]?.trim()||s.name; const act=s.key===val?'active':''; return `<span class="chip ${act}" data-key="${s.key}">${lab}</span>`}).join(""); }

    function syncChips(){ if(!chips||!sel)return; const v=String(sel.value||"").trim(); chips.querySelectorAll(".chip").forEach(ch=> ch.classList.toggle("active", String(ch.dataset.key).trim()===v)); }
    function reload(){ if(typeof window.loadAndRender==="function") window.loadAndRender("all"); }
    function setSport(key,from){ if(!key) return; if(from!=="select"&&sel&&sel.value!==key) sel.value=key; if(from!=="chip") syncChips(); try{localStorage.setItem("bq_sport",key);}catch(_){ } reload(); }
    chips?.addEventListener("click",e=>{const ch=e.target.closest(".chip"); if(!ch)return; setSport(ch.dataset.key,"chip");});
    sel?.addEventListener("change",e=> setSport(e.target.value,"select"));
    const saved=(()=>{try{return localStorage.getItem("bq_sport");}catch(_){return null;}})(); if(saved) setSport(saved); else if(sel?.value) setSport(sel.value); syncChips();

    // harden loaders with reseed demo fallback
    const harden=fn=>typeof fn!=="function"?fn:async function(...a){const out=await fn.apply(window,a); try{syncChips(); const list=$("#list"); if(list&&!list.children.length){ await safeJSON("/api/reseed_demo",4000); await fn.apply(window,a); syncChips(); }}catch(_){ } return out;};
    if(window.loadAndRender) window.loadAndRender=harden(window.loadAndRender);
  })();

  // Ricerca live su #list
  (function(){ const q=$("#searchBar"), list=$("#list"); if(!q||!list)return; const norm=s=>String(s||"").toLowerCase();
    const apply=()=>{const v=norm(q.value); let n=0; [...list.children].forEach(c=>{const ok=!v||norm(c.textContent).includes(v); c.style.display=ok?"":"none"; if(ok)n++;}); const st=$("#status"); if(st) st.textContent=n+" eventi"; };
    q.addEventListener("input",()=>{ clearTimeout(q._d); q._d=setTimeout(apply,140); });
  })();

  // Tracking click quote
  document.addEventListener("click",async e=>{ const b=e.target.closest(".oddbtn"); if(!b)return;
    try{ const blob=new Blob([JSON.stringify({bookmaker:b.dataset.book,outcome:b.dataset.outcome,price:b.dataset.odd,ts:Date.now()})],{type:"application/json"}); navigator.sendBeacon("/api/track",blob);}catch(_){}
  });

  // Pulsante diagnostica API
  document.getElementById("apiTestBtn")?.addEventListener("click",()=>{ window.open("/api/ping_odds","_blank"); });

  // Minimal list renderer (client-side fetch)
  window.loadAndRender = async function(mode="all"){
    const sel = document.getElementById("sportSelect"); const sport = sel?.value || "soccer_epl";
    const list = document.getElementById("list"); if(!list) return;
    list.innerHTML = `<div class="card skel" style="height:64px"></div><div class="card skel" style="height:64px"></div>`;
    const ev = await safeJSON(`/api/odds?sport=${encodeURIComponent(sport)}`);
    list.innerHTML = "";
    if(!ev || !Array.isArray(ev) || !ev.length){
      list.innerHTML = `<div class="card">Nessun evento disponibile.</div>`; return;
    }
    ev.forEach(e => {
      const when = (e.commence_time||"").replace("Z","").replace("T"," ");
      const odds = (e.odds||[]).slice(0,6).map(o => 
        `<button class="oddbtn" data-book="${o.bookmaker}" data-outcome="${o.outcome}" data-odd="${o.price}">${o.bookmaker}: <b>${o.outcome}</b> @ ${o.price}</button>`
      ).join(" ");
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `<div class="row">
        <div><div class="text-xs">${e.sport_key||""}</div><div class="font-semibold">${e.home||""} — ${e.away||""}</div></div>
        <div class="text-sm opacity-80">${when}</div>
        <div class="odds-wrap">${odds}</div>
      </div>`;
      list.appendChild(card);
    });
    const st=$("#status"); if(st) st.textContent = `${ev.length} eventi`;
  };

  // First load
  window.addEventListener("DOMContentLoaded", ()=> {
    setTimeout(()=> window.loadAndRender("all"), 50);
    const y = document.getElementById("y"); if(y) y.textContent = new Date().getFullYear();
  });

})();
