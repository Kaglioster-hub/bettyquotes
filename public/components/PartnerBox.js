export function mountPartners(sel){
  const el = document.querySelector(sel);
  if(!el) return;
  fetch('/partners.json').then(r=>r.json()).then(items=>{
    el.innerHTML = `
      <div class="card">
        <div class="font-semibold mb-2">Scopri anche</div>
        <div class="grid grid-cols-2 gap-2">
          ${items.map(p=>`<a class="text-sm underline opacity-90 hover:opacity-100" href="${p.url}" target="_blank" rel="nofollow noopener">${p.name}</a>`).join('')}
        </div>
      </div>`;
  });
}
mountPartners('#refBanners');
