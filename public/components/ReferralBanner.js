export function mount(sel){
  const el = document.querySelector(sel);
  if(!el) return;
  fetch('/referrals.json').then(r=>r.json()).then(refs=>{
    const items = Object.entries(refs).slice(0,4);
    el.innerHTML = items.map(([k,v])=>`
      <a href="/go/${k}" class="block p-3 rounded-xl border dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5">
        <div class="text-sm font-medium">${k.toUpperCase()}</div>
        <div class="text-xs opacity-70">Bonus esclusivo →</div>
      </a>
    `).join('');
  });
}
