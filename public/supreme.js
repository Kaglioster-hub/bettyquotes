(()=>{ if(window.__BQS_SUPREME_FIX__) return; window.__BQS_SUPREME_FIX__=true;

  // THEME robusto (rispetta prefers-color-scheme) + toggle #themeBtn
  const btn = document.getElementById("themeBtn");
  function pref(){ const s=localStorage.getItem("theme"); if(s==="light"||s==="dark") return s;
    return (matchMedia && matchMedia("(prefers-color-scheme: light)").matches) ? "light" : "dark"; }
  function apply(t){ document.documentElement.setAttribute("data-theme",t);
    document.documentElement.classList.toggle("dark", t==="dark");
    localStorage.setItem("theme",t); if(btn){ btn.setAttribute("aria-pressed", String(t==="dark")); btn.textContent = t==="dark" ? "☾" : "☀︎"; btn.title = t==="dark"?"Tema scuro attivo":"Tema chiaro attivo"; } }
  apply(pref()); btn?.addEventListener("click", ()=>{ const cur=document.documentElement.getAttribute("data-theme")||"dark"; apply(cur==="dark"?"light":"dark"); });

  // PV beacon
  try{ const b=new Blob([JSON.stringify({path:location.pathname,ts:Date.now()})],{type:"application/json"}); navigator.sendBeacon("/api/pv",b);}catch(e){}

  // CHIPS <-> SELECT sync + build da config se mancano
  const chips = document.getElementById("chips");
  const select = document.getElementById("sportSelect");
  function setSport(key,from){
    if(!key) return;
    if(from!=="select" && select && select.value!==key) select.value=key;
    if(from!=="chip" && chips){ chips.querySelectorAll(".chip").forEach(c=>c.classList.toggle("active", c.dataset.key===key)); }
    try{ localStorage.setItem("bq_sport", key); }catch(_){}
    const top=document.getElementById("btnTop")?.dataset.active==="1";
    if(top && typeof window.loadTop==="function") window.loadTop(); else if(typeof window.loadAndRender==="function") window.loadAndRender("all");
  }
  async function buildChipsIfNeeded(){
    if(!chips) return;
    if(chips.querySelector(".chip")) return;
    try{
      const r=await fetch("/public/config.json"); const d=await r.json(); if(!d?.sports) return;
      chips.innerHTML = d.sports.slice(0,12).map((s,i)=>`<span class="chip ${(select?.value===s.key||(!select?.value&&i===0))?'active':''}" data-key="${s.key}">${(s.name||"").split("•")[1]?.trim()||s.name}</span>`).join("");
    }catch(e){}
  }
  buildChipsIfNeeded().then(()=>{
    chips?.addEventListener("click", e=>{ const ch=e.target.closest(".chip"); if(!ch) return; setSport(ch.dataset.key,"chip"); });
    select?.addEventListener("change", e=> setSport(e.target.value,"select"));
    const saved=(()=>{ try{ return localStorage.getItem("bq_sport"); }catch(e){ return null; } })();
    if(saved) setSport(saved); else if(select?.value) setSport(select.value);
  });

  // RICERCA live su #searchBar (filtra le card in #list)
  (function(){
    const q=document.getElementById("searchBar"), list=document.getElementById("list"); if(!q||!list) return;
    const norm=s=>String(s||"").toLowerCase();
    const apply=()=>{const v=norm(q.value); let vis=0; [...list.children].forEach(c=>{const ok=!v||norm(c.textContent).includes(v); c.style.display=ok?"":"none"; if(ok) vis++;}); const st=document.getElementById("status"); if(st) st.textContent=vis+" eventi";};
    q.addEventListener("input",()=>{ clearTimeout(q._d); q._d=setTimeout(apply,140); });
    const hook=n=>{ const o=window[n]; if(typeof o!=="function") return; window[n]=async(...a)=>{ await o(...a); apply(); }; };
    hook("loadTop"); hook("loadAndRender");
  })();

  // Tracking click quote (delegation)
  document.addEventListener("click", e=>{
    const b=e.target.closest(".oddbtn"); if(!b) return;
    try{ const blob=new Blob([JSON.stringify({bookmaker:b.dataset.book,outcome:b.dataset.outcome,price:b.dataset.odd,ts:Date.now()})],{type:"application/json"}); navigator.sendBeacon("/api/track",blob);}catch(_){}
  });

})();
