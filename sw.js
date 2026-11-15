/* Service worker för Jaktkartan: gör att appen startar och visar kartan utan täckning.
   - Appen (index.html, manifest, ikoner) sparas. Vid start hämtas den senaste versionen om det finns nät, annars används den sparade.
   - Firebase-skripten sparas första gången de hämtas (de har versionsnummer i adressen och ändras inte).
   - Kartrutor som man har tittat på sparas, högst TILE_MAX stycken, och visas när det inte finns nät.
     Inget laddas ned i förväg: OpenStreetMaps regler förbjuder det.
   Positioner, meddelanden och annat i jakten går via Firebase och påverkas inte. */
const VERSION = '2b5d592b49';
const APP = 'jk-app-' + VERSION, LIBS = 'jk-libs-v1', TILES = 'jk-tiles-v1', TILE_MAX = 2500;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
const TILE_HOSTS = /(^|\.)tile\.openstreetmap\.org$|(^|\.)tile\.opentopomap\.org$|^server\.arcgisonline\.com$/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('jk-app-') && k !== APP).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

/* Appen: nätet först (så att nya versioner kommer fram), den sparade om nätet inte svarar inom 4 s. */
async function appFirst(req){
  const cache = await caches.open(APP);
  try {
    const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
    if(res && res.ok) cache.put(req.mode === 'navigate' ? './index.html' : req, res.clone());
    return res;
  } catch(e){
    return (await cache.match(req, {ignoreSearch:true})) || (await cache.match('./index.html')) || Response.error();
  }
}
/* Bibliotek med versionsnummer i adressen: det sparade först. */
async function libFirst(req){
  const cache = await caches.open(LIBS), hit = await cache.match(req);
  if(hit) return hit;
  const res = await fetch(req);
  if(res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
  return res;
}
/* Kartrutor: nätet först. Går det att hämta med CORS sparas rutan (annars skulle den ta orimligt mycket lagringsutrymme). */
let puts = 0;
async function tile(req){
  const cache = await caches.open(TILES);
  try {
    let res;
    try { res = await fetch(req.url, {mode:'cors', credentials:'omit'}); }
    catch(e){ return await fetch(req); }   // servern tillåter inte CORS: visa rutan men spara den inte
    if(res.ok){ cache.put(req.url, res.clone()); if(++puts % 50 === 0) trim(cache); }
    return res;
  } catch(e){
    return (await cache.match(req.url)) || Response.error();
  }
}
async function trim(cache){
  const keys = await cache.keys();
  for(let i = 0; i < keys.length - TILE_MAX; i++) await cache.delete(keys[i]);   // äldst först
}

self.addEventListener('fetch', e => {
  const req = e.request; if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin === self.location.origin){ if(req.mode === 'navigate' || SHELL.some(s => url.pathname.endsWith(s.slice(1)) && s !== './')) e.respondWith(appFirst(req)); return; }
  if(url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')){ e.respondWith(libFirst(req)); return; }
  if(TILE_HOSTS.test(url.hostname)){ e.respondWith(tile(req)); return; }
  // Allt annat (Firebase-databasen, vind, fynd) går direkt till nätet.
});
