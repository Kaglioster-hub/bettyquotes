(()=>{ if(window.__BQS_SUPREME_ALL__) return; window.__BQS_SUPREME_ALL__=true;

  // THEME
  const tbtn=document.getElementById("themeBtn");
  const pref=()=>{const s=localStorage.getItem("theme"); if(s==="light"||s==="dark")return s; return (matchMedia&&matchMedia("(prefers-color-scheme: light)").matches)?"light":"dark";}
  const apply=t=>{document.documentElement.setAttribute("data-theme",t); document.documentElement.classList.toggle("dark",t==="dark"); localStorage.setItem("theme",t); if(tbtn){tbtn.setAttribute("aria-pressed",String(t==="dark")); tbtn.textContent=t==="dark"?"☾":"☀︎";}}
  apply(pref()); tbtn?.addEventListener("click",()=>{const cur=document.documentElement.getAttribute("data-theme")||"dark"; apply(cur==="dark"?"light":"dark");});

  // PV tracking
  try{ const b=new Blob([JSON.stringify({path:location.pathname,ts:Date.now()})],{type:"application/json"}); navigator.sendBeacon("/api/pv",b);}catch(_){}

  // Odds helpers
  const safeJSON=async(u,ms=6000)=>{ const c=new AbortController(); const t=setTimeout(()=>c.abort(),ms);
    try{ const r=await fetch(u,{signal:c.signal}); clearTimeout(t); if(!r.ok) throw new Error(r.status); return await r.json(); }catch(e){ clearTimeout(t); return null;} };

  // Populate <select> and build chips if missing, then sync both ways
  (async function(){
    const select=document.getElementById("sportSelect"), chips=document.getElementById("chips"); if(!select) return;

    // Populate select if empty
    if(![...select.options].some(o=>o.value&&o.textContent.trim())){
      const cfg=await safeJSON("/public/config.json"); const sports=cfg?.sports||[];
      if(sports.length){ select.innerHTML=sports.map(s=>`<option value="${s.key}">${s.name}</option>`).join(""); }
    }

    // Build chips if missing
    if(chips && !chips.querySelector(".chip")){
      const cfg=await safeJSON("/public/config.json"); const sports=cfg?.sports||[];
      const val = select.value || (sports[0]?.key||"");
      if(sports.length){
        chips.innerHTML = sports.slice(0,12).map(s=>{
          const label=(s.name||"").split("•")[1]?.trim()||s.name;
          const active=s.key===val?'active':'';
          return `<span class="chip ${active}" data-key="${s.key}">${label}</span>`;
        }).join("");
      }
    }

    function reload(){ const top=document.getElementById("btnTop")?.dataset.active==="1";
      if(top && typeof window.loadTop==="function") window.loadTop(); else if(typeof window.loadAndRender==="function") window.loadAndRender("all"); }

    function setSport(key,from){
      if(!key) return;
      if(from!=="select" && select.value!==key) select.value=key;
      if(from!=="chip" && chips){ chips.querySelectorAll(".chip").forEach(c=>c.classList.toggle("active",c.dataset.key===key)); }
      try{ localStorage.setItem("bq_sport", key); }catch(_){}
      reload();
    }

    // Wire
    chips?.addEventListener("click",e=>{const ch=e.target.closest(".chip"); if(!ch) return; setSport(ch.dataset.key,"chip");});
    select.addEventListener("change",e=> setSport(e.target.value,"select"));

    // Restore
    const saved = (()=>{ try{ return localStorage.getItem("bq_sport"); }catch(_){ return null; } })();
    if(saved) setSport(saved); else if(select.value) setSport(select.value);
  })();

  // Live search on #list
  (function(){
    const q=document.getElementById("searchBar"), list=document.getElementById("list"); if(!q||!list) return;
    const norm=s=>String(s||"").toLowerCase(); const apply=()=>{const v=norm(q.value); let vis=0; [...list.children].forEach(c=>{const ok=!v||norm(c.textContent).includes(v); c.style.display=ok?"":"none"; if(ok) vis++;}); const st=document.getElementById("status"); if(st) st.textContent=vis+" eventi";}
    q.addEventListener("input",()=>{ clearTimeout(q._d); q._d=setTimeout(apply,140); });
    ["loadTop","loadAndRender"].forEach(n=>{ const o=window[n]; if(typeof o==="function"){ window[n]=async(...a)=>{ await o(...a); apply(); }; }});
  })();

  // Quote click tracking
  document.addEventListener("click", e=>{
    const b=e.target.closest(".oddbtn"); if(!b) return;
    try{ const blob=new Blob([JSON.stringify({bookmaker:b.dataset.book,outcome:b.dataset.outcome,price:b.dataset.odd,ts:Date.now()})],{type:"application/json"}); navigator.sendBeacon("/api/track",blob);}catch(_){}
  });

  // Harden loaders: se 0 risultati prova demo
  (function(){
    const harden=fn=>typeof fn!=="function"?fn:async function(...a){const out=await fn.apply(window,a); try{const list=document.getElementById("list"); if(list && !list.children.length){ await safeJSON("/api/reseed_demo",4000); await fn.apply(window,a);} }catch(_){ } return out;};
    if(window.loadTop) window.loadTop = harden(window.loadTop);
    if(window.loadAndRender) window.loadAndRender = harden(window.loadAndRender);
  })();

})();
