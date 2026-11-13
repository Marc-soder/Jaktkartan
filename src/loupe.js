/* ---------- Förstoringsglas ----------
   En liten karta som visar det som ligger under en punkt, 3 gånger större än huvudkartan.
   Visas ovanför punkten när man placerar en nål med korset, passar in en skärmdump,
   lägger till en punkt i en gräns eller drar en punkt. */
const LOUPE_ZOOM = Math.log2(3), LOUPE_SIZE = 150;
const loupe = {el:null, map:null, base:null, baseKey:null, vec:null, shots:null, timer:null, on:false};
function loupeInit(){
  if(loupe.map) return;
  loupe.el = h(`<div class="loupe" aria-hidden="true" hidden><div class="loupe-map"></div><svg class="loupe-cross" viewBox="0 0 40 40" fill="none" stroke-linecap="round"><path d="M20 4v11M20 25v11M4 20h11M25 20h11" stroke="#fff" stroke-width="5"/><path d="M20 4v11M20 25v11M4 20h11M25 20h11" stroke="#d9520e" stroke-width="2.5"/><circle cx="20" cy="20" r="2" fill="#d9520e"/></svg><span class="loupe-tag">3×</span></div>`);
  map.getContainer().appendChild(loupe.el);
  loupe.el.hidden = false; // Leaflet behöver en synlig behållare när kartan skapas
  loupe.map = L.map(loupe.el.firstElementChild, {zoomControl:false, attributionControl:false, zoomSnap:0, zoomAnimation:false, fadeAnimation:false,
    dragging:false, touchZoom:false, scrollWheelZoom:false, doubleClickZoom:false, boxZoom:false, keyboard:false, tap:false, inertia:false});
  loupe.map.createPane('shot'); loupe.map.getPane('shot').style.zIndex = 300;
  loupe.vec = L.layerGroup().addTo(loupe.map); loupe.shots = L.layerGroup().addTo(loupe.map);
  loupe.el.hidden = true;
}
function loupeBase(){
  const key = state.settings.base in BASES ? state.settings.base : 'osm';
  if(loupe.baseKey === key) return;
  if(loupe.base) loupe.map.removeLayer(loupe.base);
  loupe.base = BASES[key].make().addTo(loupe.map); loupe.baseKey = key;
}
/* Ritar gränser, vägar, utkastet och synliga skärmdumpar i förstoringsglaset. */
function loupeLayers(){
  loupe.vec.clearLayers(); loupe.shots.clearLayers();
  for(const a of state.areas){
    if(a.visible === false) continue;
    areaRings(a).forEach((pts, k) => { if(!(drawing && drawing.mode === 'border' && drawing.id === a.id && drawing.ring === k)) L.polygon(pts, {color:'#d9520e', weight:3, fill:false, dashArray:'10 6', interactive:false}).addTo(loupe.vec); });
    for(const [, l] of areaLines(a)) L.polyline(parseBorder(l.p), {color:l.k === 'path' ? '#7a2e8f' : '#8a4b12', weight:3, interactive:false}).addTo(loupe.vec);
  }
  if(drawing && drawing.pts.length >= 2){
    const p = drawing.pts, o = {color:'#d9520e', weight:3, interactive:false};
    (drawing.mode === 'border' && p.length >= 3 ? L.polygon(p, Object.assign({fillOpacity:.1}, o)) : L.polyline(p, o)).addTo(loupe.vec);
  }
  if(drawing) drawing.pts.forEach(pt => L.circleMarker(pt, {radius:4, color:'#fff', weight:2, fillColor:'#d9520e', fillOpacity:1, interactive:false}).addTo(loupe.vec));
  if(typeof shotLayersFor === 'function') shotLayersFor(loupe.map).forEach(l => l.addTo(loupe.shots));
}
/* Visar förstoringsglaset för latlng. at = punktens läge i kartbehållaren (pixlar). */
function loupeShow(latlng, at){
  loupeInit();
  const c = map.getContainer(), W = c.clientWidth, H = c.clientHeight, s = LOUPE_SIZE;
  let x = at.x - s / 2, y = at.y - s - 34;
  if(y < 8) y = Math.min(at.y + 34, H - s - 8);                       // för nära kanten upptill: visa under punkten
  x = Math.max(8, Math.min(W - s - 8, x));
  loupe.el.style.left = x + 'px'; loupe.el.style.top = y + 'px';
  const wasHidden = loupe.el.hidden; loupe.el.hidden = false;
  if(wasHidden){ loupe.map.invalidateSize(false); loupeBase(); loupeLayers(); }
  loupe.map.setView(latlng, map.getZoom() + LOUPE_ZOOM, {animate:false});
  loupe.on = true;
}
function loupeHide(){ if(loupe.el) loupe.el.hidden = true; loupe.on = false; clearTimeout(loupe.timer); }
/* Visar förstoringsglaset en kort stund, till exempel efter att en punkt lagts till med ett tryck. */
function loupeFlash(latlng, ms){
  loupeShow(latlng, map.latLngToContainerPoint(latlng)); loupeLayers();
  clearTimeout(loupe.timer); loupe.timer = setTimeout(loupeHide, ms || 1600);
}
/* Förstoringsglas vid korset. */
function loupeAtCenter(){ const p = crossPoint(); loupeShow(map.containerPointToLatLng(p), p); }
/* Gör en markör dragbar med förstoringsglas. onMove(latlng) anropas under dragningen, onEnd(latlng) när den släpps. */
function loupeDrag(marker, onMove, onEnd){
  marker.on('dragstart', () => { clearTimeout(loupe.timer); loupeShow(marker.getLatLng(), map.latLngToContainerPoint(marker.getLatLng())); loupeLayers(); });
  marker.on('drag', () => { const ll = marker.getLatLng(); if(onMove) onMove(ll); loupeShow(ll, map.latLngToContainerPoint(ll)); });
  marker.on('dragend', () => { loupeHide(); if(onEnd) onEnd(marker.getLatLng()); });
  return marker;
}
/* Handtag som går att dra med fingret: en synlig prick i en större träffyta. */
const dragHandle = (ll, cls) => L.marker(ll, {draggable:true, autoPan:true, keyboard:false, zIndexOffset:2000,
  icon:L.divIcon({className:'drag-handle ' + (cls || ''), html:'<span></span>', iconSize:[36, 36], iconAnchor:[18, 18]})});
