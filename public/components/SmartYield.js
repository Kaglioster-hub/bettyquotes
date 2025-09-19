export async function mountSmartYield(slotSel, ctx = {}){
  const el = document.querySelector(slotSel);
  if(!el) return;
  try{
    const params = new URLSearchParams(ctx).toString();
    const res = await fetch(`/api/ads?${params}`);
    const { items = [] } = await res.json();
    el.innerHTML = items.map(it => `
      <a href="/go_smart/${encodeURIComponent(it.slug)}" 
         class="block p-3 rounded-xl border dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5"
         data-campaign="${it.id}" data-slot="${ctx.slot||'sidebar'}">
        <div class="text-sm font-medium">${it.name}</div>
        <div class="text-xs opacity-70">${(it.tags||[]).join(' • ')}</div>
      </a>
    `).join('');

    // track impressions
    const payload = {slot: ctx.slot||'sidebar', ids: items.map(x=>x.id)};
    const blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
    navigator.sendBeacon('/api/ad_imp', blob);
  }catch(e){
    console.error('SmartYield error', e);
  }
}
