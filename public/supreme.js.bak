/* === SUPREME_SYNC_FIX (hard sync chip<->select, reload, api test) === */
(()=>{ if(window.__BQS_SUPREME_SYNC__) return; window.__BQS_SUPREME_SYNC__=true;

  const $ = s=>document.querySelector(s);
  const chipsBox=$('#chips'), selectEl=$('#sportSelect');

  const norm=v=>String(v||'').trim();
  const current=()=>norm(selectEl?.value);

  function syncChips(){
    if(!chipsBox||!selectEl) return;
    const val=current();
    chipsBox.querySelectorAll('.chip').forEach(c=>{
      c.classList.toggle('active', norm(c.dataset.key)===val);
    });
  }

  function reloadView(){
    const top=document.getElementById('btnTop')?.dataset.active==='1';
    if(top&&typeof window.loadTop==='function'){ window.loadTop(); }
    else if(typeof window.loadAndRender==='function'){ window.loadAndRender('all'); }
  }

  function setSport(key,from){
    key=norm(key);
    if(!key||!selectEl) return;
    if(from!=='select'&&selectEl.value!==key) selectEl.value=key;
    if(from!=='chip') syncChips();
    try{localStorage.setItem('bq_sport',key);}catch(_){}
    reloadView();
  }

  chipsBox?.addEventListener('click',e=>{
    const ch=e.target.closest('.chip'); if(!ch) return;
    setSport(ch.dataset.key,'chip');
  });
  selectEl?.addEventListener('change',e=>setSport(e.target.value,'select'));

  (function boot(){
    const saved=(()=>{try{return localStorage.getItem('bq_sport');}catch(_){return null;}})();
    if(saved) setSport(saved); else if(selectEl?.value) setSport(selectEl.value);
    syncChips();
  })();

  const safeHook=fn=>(typeof fn!=='function')?fn:async function(...a){
    const out=await fn.apply(window,a);
    try{
      syncChips();
      const list=document.getElementById('list');
      if(list&&!list.children.length){
        await fetch('/api/reseed_demo').catch(()=>{});
        await fn.apply(window,a);
        syncChips();
      }
    }catch(_){}
    return out;
  };
  if(window.loadTop) window.loadTop=safeHook(window.loadTop);
  if(window.loadAndRender) window.loadAndRender=safeHook(window.loadAndRender);

  document.getElementById('apiTestBtn')?.addEventListener('click',()=>window.open('/api/ping_odds','_blank'));

})();
