/* ---------- Förstoringsglas ----------
   En liten fyrkantig karta uppe i vänstra hörnet som visar det som ligger under en punkt, 2 gånger större än
   huvudkartan. Visas när man lägger till eller drar en punkt i en gräns eller väg, och när man passar in en
   skärmdump. Inte när man sätter ut nålar. Ligger punkten under förstoringsglaset flyttas det till höger. */
const LOUPE_ZOOM = 1;   // log2(2): två gånger större
const loupe = {el:null, map:null, base:null, baseKey:null, vec:null, shots:null, timer:null, on:false};
function loupeInit(){
  if(loupe.map) return;
  loupe.el = h(`<div class="loupe" aria-hidden="true" hidden><div class="loupe-map"></div><svg class="loupe-cross" viewBox="0 0 40 40" fill="none" stroke-linecap="round"><path d="M20 4v11M20 25v11M4 20h11M25 20h11" stroke="#fff" stroke-width="5"/><path d="M20 4v11M20 25v11M4 20h11M25 20h11" stroke="#d9520e" stroke-width="2.5"/><circle cx="20" cy="20" r="2" fill="#d9520e"/></svg><span class="loupe-tag">2×</span></div>`);
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
    for(const [, l] of areaLines(a)) L.polyline(parseBorder(l.p), {color:LINE_COLOR[l.k] || LINE_COLOR.road, weight:3, interactive:false}).addTo(loupe.vec);
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
  const wasHidden = loupe.el.hidden; loupe.el.hidden = false; document.body.classList.add('loupe-on');
  // Uppe till vänster, eller till höger om punkten ligger under förstoringsglaset
  loupe.el.classList.remove('right');
  const r = loupe.el.getBoundingClientRect(), c = map.getContainer().getBoundingClientRect(), x = at.x + c.left, y = at.y + c.top;
  if(x > r.left - 24 && x < r.right + 24 && y > r.top - 24 && y < r.bottom + 24) loupe.el.classList.add('right');
  if(wasHidden){ loupe.map.invalidateSize(false); loupeBase(); loupeLayers(); }
  loupe.map.setView(latlng, map.getZoom() + LOUPE_ZOOM, {animate:false});
  loupe.on = true;
}
function loupeHide(){ if(loupe.el) loupe.el.hidden = true; document.body.classList.remove('loupe-on'); loupe.on = false; clearTimeout(loupe.timer); }
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
