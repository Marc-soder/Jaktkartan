/* ---------- Gränser för områden ---------- */
const borderLayer = L.layerGroup().addTo(map), drawLayer = L.layerGroup().addTo(map);
let drawing = null;
const parseBorder = s => typeof s === 'string' && s ? s.split(';').map(p => p.split(',').map(Number)).filter(p => p.length === 2 && isFinite(p[0]) && isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180) : [];
const fmtBorder = pts => pts.map(p => p[0].toFixed(5) + ',' + p[1].toFixed(5)).join(';');
function areaHa(pts){
  if(pts.length < 3) return 0;
  const q = pts.map(p => toSweref99TM(p[0], p[1])); let s = 0;
  for(let i = 0; i < q.length; i++){ const a = q[i], b = q[(i + 1) % q.length]; s += a.E * b.N - b.E * a.N; }
  return Math.abs(s) / 2 / 10000;
}
const fmtHa = ha => (ha >= 100 ? fmtInt(ha) : ha.toLocaleString('sv-SE', {maximumFractionDigits:1})) + ' ha';
function renderBorders(){
  borderLayer.clearLayers();
  for(const a of state.areas){
    if(a.visible === false || (drawing && drawing.id === a.id)) continue;
    const pts = parseBorder(a.border); if(pts.length < 3) continue;
    L.polygon(pts, {color:'#ffffff', weight:6, opacity:.7, fill:false, interactive:false}).addTo(borderLayer);
    L.polygon(pts, {color:'#d9520e', weight:3, fillColor:'#d9520e', fillOpacity:.06, dashArray:'10 6', interactive:false}).addTo(borderLayer);
  }
}
function drawDraft(){
  drawLayer.clearLayers(); const p = drawing.pts;
  if(p.length >= 3) L.polygon(p, {color:'#d9520e', weight:3, fillColor:'#d9520e', fillOpacity:.14, interactive:false}).addTo(drawLayer);
  else if(p.length === 2) L.polyline(p, {color:'#d9520e', weight:3, interactive:false}).addTo(drawLayer);
  p.forEach((pt, i) => L.circleMarker(pt, {radius:i === p.length - 1 ? 8 : 5, color:'#ffffff', weight:2, fillColor:'#d9520e', fillOpacity:1, interactive:false}).addTo(drawLayer));
  $('#drawText').textContent = p.length < 3 ? `Tryck på kartan i varje hörn av marken. ${p.length} av minst 3 punkter.` : `${p.length} punkter · ${fmtHa(areaHa(p))}. Fortsätt runt marken eller tryck Klar.`;
  $('#drawOk').disabled = p.length < 3; $('#drawUndo').disabled = !p.length;
}
function startDrawing(id){
  const a = areaById(id); if(!a) return;
  if(!canEditArea(a)){ toast('Du har inte rättighet att ändra det området.'); return; }
  closeModal(); map.closePopup(); if(placing) endPlacing();
  drawing = {id, pts:parseBorder(a.border)};
  $('#drawbar').hidden = false; $('#btnAdd').hidden = true; if(!isDesktop()) setSheet('peek');
  if(drawing.pts.length) map.fitBounds(L.latLngBounds(drawing.pts), {paddingTopLeft:[40,70], paddingBottomRight:[40, bottomPad() + 190], maxZoom:17});
  renderBorders(); drawDraft();
}
function endDrawing(){ drawing = null; drawLayer.clearLayers(); $('#drawbar').hidden = true; $('#btnAdd').hidden = false; renderBorders(); }
map.on('click', e => { if(!drawing) return; drawing.pts.push([e.latlng.lat, e.latlng.lng]); drawDraft(); });
$('#drawUndo').addEventListener('click', () => { drawing.pts.pop(); drawDraft(); });
$('#drawCancel').addEventListener('click', endDrawing);
$('#drawGps').addEventListener('click', () => {
  if(!('geolocation' in navigator)){ toast('Den här webbläsaren kan inte ge din position.'); return; }
  navigator.geolocation.getCurrentPosition(pos => { if(!drawing) return; showMe(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy || 0); drawing.pts.push([pos.coords.latitude, pos.coords.longitude]); map.panTo([pos.coords.latitude, pos.coords.longitude]); drawDraft(); },
    () => toast('Kunde inte läsa din position.'), {enableHighAccuracy:true, timeout:15000, maximumAge:2000});
});
$('#drawOk').addEventListener('click', () => {
  const a = areaById(drawing.id), pts = drawing.pts; endDrawing();
  if(!a){ toast('Området finns inte längre.'); return; }
  a.border = fmtBorder(pts); a.updated = Date.now(); delete a.example;
  save(); renderAll(); toast(`Gränsen för ${a.name} är sparad, ${fmtHa(areaHa(pts))}.`);
});
function parseRing(text){
  const ring = c => c.map(x => [+x[1], +x[0]]);
  if(/^\s*[{[]/.test(text)){
    const o = JSON.parse(text), fs = o.type === 'FeatureCollection' ? o.features : o.type === 'Feature' ? [o] : [{geometry:o}];
    for(const f of fs){ const g = f && f.geometry; if(!g) continue;
      if(g.type === 'Polygon') return ring(g.coordinates[0]);
      if(g.type === 'MultiPolygon') return ring(g.coordinates[0][0]); }
    for(const f of fs){ const g = f && f.geometry; if(g && g.type === 'LineString') return ring(g.coordinates); }
    return [];
  }
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if(doc.getElementsByTagName('parsererror').length) throw new Error('Ogiltig fil');
  const el = name => Array.from(doc.getElementsByTagNameNS('*', name));
  const coords = n => n.textContent.trim().split(/\s+/).map(t => t.split(',')).filter(c => c.length >= 2).map(c => [+c[1], +c[0]]);
  for(const tag of ['Polygon', 'LineString']){ const n = el(tag)[0]; if(n){ const c = n.getElementsByTagNameNS('*', 'coordinates')[0]; if(c) return coords(c); } }
  for(const tag of ['trkpt', 'rtept']){ const pts = el(tag); if(pts.length) return pts.map(p => [parseFloat(p.getAttribute('lat')), parseFloat(p.getAttribute('lon'))]); }
  return [];
}
let borderTarget = null;
$('#fileBorder').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0]; e.target.value = ''; const a = areaById(borderTarget);
  if(!file || !a) return;
  try {
    let pts = parseRing(await file.text()).filter(p => isFinite(p[0]) && isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180);
    if(pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    if(pts.length < 3){ toast('Hittade ingen yta eller linje med minst tre punkter i filen.', 5000); return; }
    if(pts.length > 2000){ const step = Math.ceil(pts.length / 2000); pts = pts.filter((p, i) => i % step === 0); }
    a.border = fmtBorder(pts); a.updated = Date.now(); delete a.example;
    closeModal(); save(); renderAll();
    map.fitBounds(L.latLngBounds(pts), {paddingTopLeft:[40,70], paddingBottomRight:[40, bottomPad() + 40], maxZoom:16});
    toast(`Gränsen för ${a.name} är importerad, ${fmtHa(areaHa(pts))}.`);
  } catch(err){ toast('Filen kunde inte läsas som en gräns.', 5000); }
});

/* ---------- Skogsvägar och stigar från OpenStreetMap (Overpass) ---------- */
const roadLayer = L.layerGroup().addTo(map), roads = {box:null, busy:false, timer:null, note:''};
function setRoadNote(t){ roads.note = t; const el = $('#roadNote'); if(el) el.textContent = t || 'Från OpenStreetMap, syns när du zoomat in'; }
function roadsUpdate(){
  if(!state.settings.roads){ roadLayer.clearLayers(); roads.box = null; setRoadNote(''); return; }
  if(map.getZoom() < 13){ roadLayer.clearLayers(); roads.box = null; setRoadNote('Zooma in mer för att se dem.'); return; }
  if(roads.busy || (roads.box && roads.box.contains(map.getBounds()))) return;
  const pb = map.getBounds().pad(0.3); roads.busy = true; setRoadNote('Hämtar …');
  const q = `[out:json][timeout:20];way["highway"~"^(track|path|service|unclassified)$"](${pb.getSouth().toFixed(4)},${pb.getWest().toFixed(4)},${pb.getNorth().toFixed(4)},${pb.getEast().toFixed(4)});out geom;`;
  fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q)).then(r => { if(!r.ok) throw new Error('http'); return r.json(); }).then(d => {
    roadLayer.clearLayers(); let n = 0;
    for(const w of d.elements || []){
      if(w.type !== 'way' || !Array.isArray(w.geometry) || w.geometry.length < 2) continue;
      const path = (w.tags || {}).highway === 'path', pts = w.geometry.map(g => [g.lat, g.lon]);
      L.polyline(pts, {renderer:canvasR, color:'#ffffff', weight:path ? 3.5 : 5.5, opacity:.8, interactive:false}).addTo(roadLayer);
      L.polyline(pts, {renderer:canvasR, color:path ? '#7a2e8f' : '#8a4b12', weight:path ? 1.8 : 2.8, dashArray:path ? '5 5' : null, interactive:false}).addTo(roadLayer);
      n++;
    }
    roads.box = pb; setRoadNote(n ? `${n} vägar och stigar visas. Brun är väg, lila streckad är stig.` : 'Inga skogsvägar hittades här.');
  }).catch(() => setRoadNote('Kunde inte hämtas just nu. Flytta kartan för att försöka igen.')).then(() => { roads.busy = false; });
}
map.on('moveend', () => { clearTimeout(roads.timer); roads.timer = setTimeout(roadsUpdate, 400); });
