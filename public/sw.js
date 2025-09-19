const CACHE='bq-v20250919054506';
const ASSETS=['/','/index.html','/styles.css','/app.js','/manifest.json','/offline.html','/logo/BQ.png'];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  e.respondWith(fetch(e.request).catch(()=>caches.match(e.request).then(r=>r||caches.match('/offline.html'))));
});



