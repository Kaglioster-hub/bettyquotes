const CACHE='bq-supreme-20250919181641'
const ASSETS=['/','/index.html','/styles.css','/app.js','/manifest.json','/offline.html','/logo/BQ.png'];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  e.respondWith(fetch(e.request).catch(()=>caches.match(e.request).then(r=>r||caches.match('/offline.html'))));
});









