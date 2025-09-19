/* SUPREME_CORE (tema + sync + search + tracking + fallback + diag) */
(()=>{
  if(window.__BQS_SUPREME_CORE__) return;
  window.__BQS_SUPREME_CORE__=true;

  const $=s=>document.querySelector(s),
        chips=$('#chips'),
        sel=$('#sportSelect'),
        themeBtn=$('#themeBtn'),
        statusEl=$('#status');

  // === THEME ===
  const pref=()=>{
    const s=localStorage.getItem("theme");
    if(s==="light"||s==="dark") return s;
    return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  };
  const apply=t=>{
    document.documentElement.classList.toggle("dark",t==="dark");
    document.documentElement.setAttribute("data-theme",t);
    localStorage.setItem("theme",t);
    if(themeBtn){
      themeBtn.setAttribute("aria-pressed",String(t==="dark"));
      themeBtn.textContent=t==="dark"?"☾":"☀︎";
    }
  };
  apply(pref());
  themeBtn?.addEventListener("click",()=>{
    const cur=document.documentElement.getAttribute("data-theme")||"dark";
    apply(cur==="dark"?"light":"dark");
  });

  // === HELPERS ===
  const safeJSON=async(u,ms=7000)=>{
    const c=new AbortController(); const t=setTimeout(()=>c.abort(),ms);
    try{
      const r=await fetch(u,{signal:c.signal});
      clearTimeout(t);
      return r.ok?await r.json():null;
    }catch{ clearTimeout(t); return null; }
  };
  let configCache=null;
  const getConfig=()=>configCache||(configCache=safeJSON("/config.json"));

  const send=(url,payload)=>{
    try{
      const blob=new Blob([JSON.stringify(payload)],{type:"application/json"});
      if(!navigator.sendBeacon(url,blob)) throw 1;
    }catch(_){
      fetch(url,{method:"POST",headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    }
  };

  // === PAGEVIEW DIAG ===
  send("/api/pv",{path:location.pathname,ts:Date.now()});

  // === INIT SPORTS (chips + select) ===
  (async function initSports(){
    const cfg=await getConfig();
    const sp=cfg?.sports||[];

    // select
    if(sel && sp.length && ![...sel.options].some(o=>o.value)){
      sel.innerHTML=sp.map(s=>`<option value="${s.key}">${s.name}</option>`).join("");
    }

    // chips
    if(chips && !chips.querySelector(".chip")){
      const val=sel?.value || (sp[0]?.key||"");
      chips.innerHTML=sp.slice(0,12).map(s=>{
        const lab=(s.name||"").split("•")[1]?.trim()||s.name;
        const act=s.key===val?'active':'';
        return `<span class="chip ${act}" data-key="${s.key}">${lab}</span>`;
      }).join("");
    }

    // wiring
    function syncChips(){
      if(!chips||!sel) return;
      const v=String(sel.value||"").trim();
      chips.querySelectorAll(".chip").forEach(ch=>
        ch.classList.toggle("active",String(ch.dataset.key).trim()===v)
      );
    }
    function reload(){
      const isTop=document.getElementById("btnTop")?.dataset.active==="1";
      if(isTop&&typeof window.loadTop==="function") window.loadTop();
      else if(typeof window.loadAndRender==="function") window.loadAndRender("all");
    }
    function setSport(key,from){
      if(!key) return;
      if(from!=="select"&&sel&&sel.value!==key) sel.value=key;
      if(from!=="chip") syncChips();
      try{localStorage.setItem("bq_sport",key);}catch{}
      reload();
    }

    chips?.addEventListener("click",e=>{
      const ch=e.target.closest(".chip"); if(!ch)return;
      setSport(ch.dataset.key,"chip");
    });
    sel?.addEventListener("change",e=>setSport(e.target.value,"select"));

    const saved=(()=>{try{return localStorage.getItem("bq_sport");}catch{return null;}})();
    if(saved) setSport(saved); else if(sel?.value) setSport(sel.value);
    syncChips();

    // harden reload functions
    const harden=fn=>typeof fn!=="function"?fn:async function(...a){
      const out=await fn.apply(window,a);
      try{
        syncChips();
        const list=$("#list");
        if(list&&!list.children.length){
          await safeJSON("/api/reseed_demo",4000);
          await fn.apply(window,a);
          syncChips();
        }
      }catch{}
      return out;
    };
    if(window.loadTop) window.loadTop=harden(window.loadTop);
    if(window.loadAndRender) window.loadAndRender=harden(window.loadAndRender);
  })();

  // === SEARCH FILTER ===
  (function(){
    const q=$("#searchBar"), list=$("#list");
    if(!q||!list) return;
    const norm=s=>String(s||"").toLowerCase();
    const apply=()=>{
      const v=norm(q.value); let n=0;
      [...list.children].forEach(c=>{
        const ok=!v||norm(c.textContent).includes(v);
        c.style.display=ok?"":"none";
        if(ok) n++;
      });
      if(statusEl) statusEl.textContent=`${n} eventi trovati`;
    };
    q.addEventListener("input",()=>{ clearTimeout(q._d); q._d=setTimeout(apply,140); });
    ["loadTop","loadAndRender"].forEach(n=>{
      const o=window[n];
      if(typeof o==="function"){
        window[n]=async(...a)=>{await o(...a); apply();};
      }
    });
  })();

  // === TRACKING QUOTE CLICK ===
  document.addEventListener("click",e=>{
    const b=e.target.closest(".oddbtn"); if(!b) return;
    send("/api/track",{bookmaker:b.dataset.book,outcome:b.dataset.outcome,price:b.dataset.odd,ts:Date.now()});
  });

  // === DIAGNOSTICA API ===
  $("#apiTestBtn")?.addEventListener("click",()=>window.open("/api/ping_odds","_blank"));
})();
