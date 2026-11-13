/* ---------- Gränser för områden ---------- */
const borderLayer = L.layerGroup().addTo(map), drawLayer = L.layerGroup().addTo(map), drawHandles = L.layerGroup().addTo(map);
let drawing = null;
const parseBorder = s => typeof s === 'string' && s ? s.split(';').map(p => p.split(',').map(Number)).filter(p => p.length === 2 && isFinite(p[0]) && isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180) : [];
const fmtBorder = pts => pts.map(p => p[0].toFixed(5) + ',' + p[1].toFixed(5)).join(';');
/* Ett område kan ha flera gränsdelar (skiften). De sparas i samma sträng, avskilda med |. */
const parseRings = s => typeof s === 'string' && s ? s.split('|').map(parseBorder).filter(r => r.length >= 3) : [];
const fmtRings = rings => rings.filter(r => r.length >= 3).map(fmtBorder).join('|');
const areaRings = a => parseRings(a && a.border);
const ringsHa = rings => rings.reduce((s, r) => s + areaHa(r), 0);
function setRings(a, rings){ const s = fmtRings(rings); if(s) a.border = s; else delete a.border; }
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
    if(a.visible === false) continue;
    areaRings(a).forEach((pts, k) => {
      if(drawing && drawing.mode === 'border' && drawing.id === a.id && drawing.ring === k) return;   // delen som ritas visas som utkast
      L.polygon(pts, {color:'#ffffff', weight:6, opacity:.7, fill:false, interactive:false}).addTo(borderLayer);
      L.polygon(pts, {color:'#d9520e', weight:3, fillColor:'#d9520e', fillOpacity:.06, dashArray:'10 6', interactive:false}).addTo(borderLayer);
    });
  }
  renderLines();
}

/* Alla punkter som hör till ett område: gränsdelar, egna vägar och nålar */
function areaPoints(a){
  const pts = [];
  areaRings(a).forEach(r => r.forEach(p => pts.push(p)));
  areaLines(a).forEach(([, l]) => parseBorder(l.p).forEach(p => pts.push(p)));
  state.pins.filter(p => p.areaId === a.id).forEach(p => pts.push([p.lat, p.lng]));
  return pts;
}
function zoomToArea(id){
  const a = areaById(id); if(!a) return;
  const pts = areaPoints(a);
  if(!pts.length){ toast(`${a.name} har ingen gräns, väg eller nål att visa.`); return; }
  if(a.visible === false){ a.visible = true; save(); renderAll(); }
  map.closePopup(); if(!isDesktop()) setSheet('peek');
  setTimeout(() => {
    if(pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 16));
    else map.fitBounds(L.latLngBounds(pts), {paddingTopLeft:[30, 30], paddingBottomRight:[70, bottomPad() + 30], maxZoom:17});
  }, isDesktop() ? 0 : 280);
}
/* ---------- Egna vägar och stigar ----------
   Sparas per område som a.lines = {id: {k:'road'|'path', p:'lat,lng;lat,lng', n:'namn'}} och delas med jaktlaget tillsammans med området. */
const lineLayer = L.layerGroup().addTo(map);
const LINE_KIND = {road:'Väg', path:'Stig'};
function lineLen(pts){ let m = 0; for(let i = 1; i < pts.length; i++) m += distM({lat:pts[i-1][0], lng:pts[i-1][1]}, {lat:pts[i][0], lng:pts[i][1]}); return m; }
const areaLines = a => Object.entries(a && a.lines && typeof a.lines === 'object' ? a.lines : {}).filter(([, l]) => l && LINE_KIND[l.k] && parseBorder(l.p).length >= 2);
function lineStyle(kind, pts, interactive){
  const path = kind === 'path', o = {interactive:!!interactive, bubblingMouseEvents:false};
  return [L.polyline(pts, Object.assign({color:'#ffffff', weight:path ? 6 : 8, opacity:.85}, o)), L.polyline(pts, Object.assign({color:path ? '#7a2e8f' : '#8a4b12', weight:path ? 3 : 4.5, dashArray:path ? '7 6' : null}, o))];
}
function renderLines(){
  lineLayer.clearLayers();
  for(const a of state.areas){
    if(a.visible === false) continue;
    for(const [lid, l] of areaLines(a)){
      if(drawing && drawing.mode === 'line' && drawing.lid === lid) continue;
      const pts = parseBorder(l.p);
      for(const pl of lineStyle(l.k, pts, !drawing && !placing)){
        pl.bindPopup(() => {
          const el = h(`<div class="pp"><h4>${esc(l.n || LINE_KIND[l.k])}</h4><div class="pnote">${LINE_KIND[l.k]} · ${fmtDist(lineLen(pts))} · ${esc(a.name)}</div>${canEditArea(a) ? '<div class="pbtns"><button class="btn sm" type="button" data-l="edit">Ändra</button><button class="btn sm danger" type="button" data-l="del">Ta bort</button></div>' : ''}</div>`);
          const ed = el.querySelector('[data-l="edit"]'), del = el.querySelector('[data-l="del"]');
          if(ed) ed.addEventListener('click', () => { map.closePopup(); openLineForm({areaId:a.id, lid}); });
          if(del) del.addEventListener('click', () => confirmClick(del, 'Bekräfta', () => { map.closePopup(); deleteLine(a.id, lid); }));
          return el;
        });
        pl.addTo(lineLayer);
      }
    }
  }
}
function deleteLine(areaId, lid){
  const a = areaById(areaId); if(!a || !a.lines || !a.lines[lid]) return;
  const name = a.lines[lid].n || LINE_KIND[a.lines[lid].k];
  delete a.lines[lid]; if(!Object.keys(a.lines).length) delete a.lines;
  a.updated = Date.now(); save(); renderAll(); toast(`${name} är borttagen.`);
}
/* Områden man kan flytta innehåll till */
const moveTargets = a => state.areas.filter(t => t.id !== a.id && canEditArea(t));
/* Flyttar gräns, egna vägar och nålar från ett område till ett annat. Returnerar en text till användaren. */
function moveAreaContent(fromId, toId, what){
  const from = areaById(fromId), to = areaById(toId); if(!from || !to) return 'Området finns inte längre.';
  if(!canEditArea(from) || !canEditArea(to)) return 'Du har inte rättighet att ändra något av områdena.';
  const done = [], now = Date.now();
  if(what.border && areaRings(from).length){ const r = areaRings(from); setRings(to, areaRings(to).concat(r)); delete from.border; done.push(r.length === 1 ? 'gränsen' : `${r.length} gränsdelar`); }
  if(what.lines && areaLines(from).length){ const n = areaLines(from).length; to.lines = Object.assign({}, to.lines || {}, from.lines); delete from.lines; done.push(n === 1 ? '1 väg eller stig' : `${n} vägar och stigar`); }
  if(what.pins){ const ps = state.pins.filter(p => p.areaId === fromId); ps.forEach(p => { p.areaId = toId; p.updated = now; }); if(ps.length) done.push(ps.length === 1 ? '1 nål' : `${ps.length} nålar`); }
  if(!done.length) return 'Det fanns inget att flytta.';
  from.updated = now; to.updated = now; delete from.example; delete to.example;
  if(to.visible === false) to.visible = true;
  save(); renderAll();
  return `Flyttade ${done.join(', ').replace(/, ([^,]*)$/, ' och $1')} till ${to.name}.`;
}
/* Formulär för en ny eller befintlig väg/stig. opts: {areaId, lid} */
function openLineForm(opts){
  opts = opts || {};
  const editable = state.areas.filter(a => canEditArea(a));
  if(!editable.length){ toast('Skapa ett område under Filter först. Vägen sparas i ett område.', 5000); return; }
  const cur = opts.lid ? (areaById(opts.areaId) || {}).lines : null, l = cur && cur[opts.lid] ? cur[opts.lid] : {k:'path', n:''};
  const sel = opts.areaId || (editable.find(a => a.visible !== false && !a.example) || editable[0]).id;
  openModal(`<h2>${opts.lid ? 'Ändra' : 'Rita'} väg eller stig</h2><form id="lfForm">
    <div class="field"><span>Typ</span><div class="row2">${Object.entries(LINE_KIND).map(([k, t]) => `<label class="radio-card" style="margin:0"><input type="radio" name="lfKind" value="${k}" ${l.k === k ? 'checked' : ''}> ${t}<br><span class="small muted">${k === 'road' ? 'Brun heldragen' : 'Lila streckad'}</span></label>`).join('')}</div></div>
    <label class="field"><span>Namn (valfritt)</span><input class="input" id="lfName" maxlength="60" value="${esc(l.n || '')}" placeholder="${opts.lid ? '' : 'Till exempel Stigen till tornet'}"></label>
    <label class="field"><span>Område</span><select class="input" id="lfArea">${editable.map(a => `<option value="${a.id}"${a.id === sel ? ' selected' : ''}>${esc(a.name)}${a.gid ? ' (delas med ' + esc(gname(cloud.groups[a.gid])) + ')' : ''}</option>`).join('')}</select></label>
    <p class="note" style="margin-top:0">Vägen visas när området är påslaget och delas med jaktlaget om området är delat.</p>
    <div class="actions"><button class="btn primary grow" type="submit">${opts.lid ? 'Spara' : 'Börja rita'}</button>${opts.lid ? '<button class="btn" type="button" id="lfRedraw">Rita om</button>' : ''}<button class="btn ghost" type="button" id="lfCancel">Avbryt</button></div></form>`, m => {
    const read = () => ({k:(m.querySelector('input[name=lfKind]:checked') || {}).value || 'path', n:m.querySelector('#lfName').value.trim(), areaId:m.querySelector('#lfArea').value});
    m.querySelector('#lfCancel').addEventListener('click', closeModal);
    const rd = m.querySelector('#lfRedraw'); if(rd) rd.addEventListener('click', () => { const v = read(); startLine(opts.areaId, v.k, v.n, opts.lid); });
    m.querySelector('#lfForm').addEventListener('submit', e => {
      e.preventDefault(); const v = read();
      if(!opts.lid){ startLine(v.areaId, v.k, v.n); return; }
      const a = areaById(opts.areaId); if(!a || !a.lines || !a.lines[opts.lid]){ closeModal(); return; }
      a.lines[opts.lid].k = v.k; if(v.n) a.lines[opts.lid].n = v.n; else delete a.lines[opts.lid].n;
      a.updated = Date.now();
      const to = v.areaId !== a.id && areaById(v.areaId);
      if(to){ to.lines = Object.assign({}, to.lines || {}, {[opts.lid]: a.lines[opts.lid]}); delete a.lines[opts.lid]; if(!Object.keys(a.lines).length) delete a.lines; to.updated = Date.now(); if(to.visible === false) to.visible = true; }
      save(); closeModal(); renderAll(); toast(to ? `Flyttad till ${to.name}.` : 'Ändringen är sparad.');
    });
  });
}
$('#popDrawLine').addEventListener('click', () => { toggleLayerPop(false); openLineForm(); });
function startLine(areaId, kind, name, lid){
  const a = areaById(areaId); if(!a) return;
  if(!canEditArea(a)){ toast('Du har inte rättighet att ändra det området.'); return; }
  closeModal(); map.closePopup(); if(placing) endPlacing();
  if(a.visible === false){ a.visible = true; save(); renderAll(); }
  drawing = {mode:'line', id:areaId, kind, name, lid:lid || null, pts:lid && a.lines && a.lines[lid] ? parseBorder(a.lines[lid].p) : [], hist:[], sel:null};
  $('#drawbar').hidden = false; $('#btnAdd').hidden = true; if(!isDesktop()) setSheet('min');
  if(drawing.pts.length >= 2) map.fitBounds(L.latLngBounds(drawing.pts), {paddingTopLeft:[40,70], paddingBottomRight:[40, bottomPad() + 190], maxZoom:17});
  renderBorders(); drawDraft();
}
/* Hörnen går att dra med fingret (med förstoringsglas). Linjen ritas om under dragningen. */
/* Varje ändring sparas först så att Ångra kan ta tillbaka den. */
function drawPush(){ drawing.hist.push(drawing.pts.map(p => p.slice())); if(drawing.hist.length > 200) drawing.hist.shift(); }
/* Punkterna: tryck för att markera (och ta bort), dra för att flytta.
   Mellan två punkter finns ett +: tryck för att lägga in en punkt där, eller dra det dit punkten ska. */
function drawHandlesRender(){
  drawHandles.clearLayers(); if(!drawing) return;
  const P = drawing.pts, cls = drawing.mode === 'line' ? (drawing.kind === 'path' ? 'path' : 'road') : 'border';
  P.forEach((pt, i) => {
    const m = dragHandle(pt, cls + (i === P.length - 1 ? ' last' : '') + (drawing.sel === i ? ' sel' : ''));
    m.on('dragstart', () => { drawPush(); drawing.sel = i; });
    loupeDrag(m, ll => { P[i] = [ll.lat, ll.lng]; drawShape(); }, ll => { P[i] = [ll.lat, ll.lng]; drawDraft(); });
    m.on('click', () => { drawing.sel = drawing.sel === i ? null : i; drawDraft(); });
    m.addTo(drawHandles);
  });
  // + mitt på varje kant (för en gräns även kanten mellan sista och första punkten)
  const edges = P.length < 2 ? 0 : drawing.mode === 'border' && P.length >= 3 ? P.length : P.length - 1;
  for(let i = 0; i < edges; i++){
    const a = P[i], b = P[(i + 1) % P.length], at = i + 1;
    const mid = map.unproject(map.project(a).add(map.project(b)).divideBy(2));
    const m = dragHandle(mid, 'mid'); let added = false;
    const add = ll => { drawPush(); P.splice(at, 0, [ll.lat, ll.lng]); drawing.sel = at; added = true; };
    m.on('dragstart', () => add(m.getLatLng()));
    loupeDrag(m, ll => { if(added) P[at] = [ll.lat, ll.lng]; drawShape(); }, () => drawDraft());
    m.on('click', () => { add(m.getLatLng()); drawDraft(); loupeFlash(m.getLatLng()); });
    m.addTo(drawHandles);
  }
}
function drawShape(){
  drawLayer.clearLayers(); const p = drawing.pts;
  if(drawing.mode === 'line'){ if(p.length >= 2) lineStyle(drawing.kind, p, false).forEach(pl => pl.addTo(drawLayer)); return; }
  if(p.length >= 3) L.polygon(p, {color:'#d9520e', weight:3, fillColor:'#d9520e', fillOpacity:.14, interactive:false}).addTo(drawLayer);
  else if(p.length === 2) L.polyline(p, {color:'#d9520e', weight:3, interactive:false}).addTo(drawLayer);
}
function drawDraft(){
  const p = drawing.pts; if(drawing.sel != null && drawing.sel >= p.length) drawing.sel = null;
  drawShape(); drawHandlesRender();
  $('#drawUndo').disabled = !drawing.hist.length;
  $('#drawDel').hidden = drawing.sel == null;
  $('#drawDel').disabled = drawing.sel == null || p.length <= (drawing.mode === 'line' ? 2 : 3);
  if(drawing.mode === 'line'){
    const what = LINE_KIND[drawing.kind].toLowerCase();
    $('#drawText').textContent = p.length < 2 ? `Tryck på kartan längs ${what}en, eller gå den och tryck på positionsknappen. ${p.length} av minst 2 punkter.` : `${p.length} punkter · ${fmtDist(lineLen(p))}. ${drawing.sel != null ? 'Punkten är markerad.' : `Fortsätt längs ${what}en. Dra en punkt för att flytta den, tryck på den för att ta bort den, eller dra ett + för att lägga till en punkt.`}`;
    $('#drawOk').disabled = p.length < 2;
    return;
  }
  $('#drawText').textContent = p.length < 3 ? `Tryck på kartan i varje hörn av marken. ${p.length} av minst 3 punkter.` : `${p.length} punkter · ${fmtHa(areaHa(p))}. ${drawing.sel != null ? 'Punkten är markerad.' : 'Dra en punkt för att flytta den, tryck på den för att ta bort den, eller dra ett + för att lägga till en punkt mellan två andra.'}`;
  $('#drawOk').disabled = p.length < 3;
}
/* Ritar en gränsdel. ring = index för en befintlig del som ska ändras, eller utelämnas för en ny del. */
function startDrawing(id, ring){
  const a = areaById(id); if(!a) return;
  if(!canEditArea(a)){ toast('Du har inte rättighet att ändra det området.'); return; }
  closeModal(); map.closePopup(); if(placing) endPlacing();
  const rings = areaRings(a), k = ring != null && rings[ring] ? ring : null;
  drawing = {mode:'border', id, ring:k, pts:k != null ? rings[k] : [], hist:[], sel:null};
  $('#drawbar').hidden = false; $('#btnAdd').hidden = true; if(!isDesktop()) setSheet('min');
  if(drawing.pts.length) map.fitBounds(L.latLngBounds(drawing.pts), {paddingTopLeft:[40,70], paddingBottomRight:[40, bottomPad() + 190], maxZoom:17});
  renderBorders(); drawDraft();
}
function endDrawing(){ drawing = null; drawLayer.clearLayers(); drawHandles.clearLayers(); loupeHide(); $('#drawbar').hidden = true; $('#btnAdd').hidden = false; renderBorders(); sheetRestore(); }
map.on('click', e => {
  if(!drawing) return;
  if(drawing.sel != null){ drawing.sel = null; drawDraft(); return; }   // ett tryck bredvid tar bort markeringen
  drawPush(); drawing.pts.push([e.latlng.lat, e.latlng.lng]); drawDraft(); loupeFlash(e.latlng);
});
$('#drawUndo').addEventListener('click', () => { if(!drawing.hist.length) return; drawing.pts = drawing.hist.pop(); drawing.sel = null; drawDraft(); });
$('#drawDel').addEventListener('click', () => { const i = drawing.sel; if(i == null) return; drawPush(); drawing.pts.splice(i, 1); drawing.sel = null; drawDraft(); });
$('#drawCancel').addEventListener('click', endDrawing);
$('#drawGps').addEventListener('click', () => {
  if(!('geolocation' in navigator)){ toast('Den här webbläsaren kan inte ge din position.'); return; }
  navigator.geolocation.getCurrentPosition(pos => { if(!drawing) return; showMe(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy || 0); drawPush(); drawing.pts.push([pos.coords.latitude, pos.coords.longitude]); map.panTo([pos.coords.latitude, pos.coords.longitude]); drawDraft(); },
    () => toast('Kunde inte läsa din position.'), {enableHighAccuracy:true, timeout:15000, maximumAge:2000});
});
$('#drawOk').addEventListener('click', () => {
  const d = drawing, a = areaById(d.id), pts = d.pts; endDrawing();
  if(!a){ toast('Området finns inte längre.'); return; }
  if(d.mode === 'line'){
    if(!a.lines || typeof a.lines !== 'object') a.lines = {};
    const lid = d.lid || 'l-' + uid(), l = {k:d.kind, p:fmtBorder(pts)}; if(d.name) l.n = d.name;
    a.lines[lid] = l; a.updated = Date.now(); delete a.example;
    save(); renderAll(); toast(`${d.name || LINE_KIND[d.kind]} är sparad, ${fmtDist(lineLen(pts))}.`);
    return;
  }
  const rings = areaRings(a);
  if(d.ring != null && rings[d.ring]) rings[d.ring] = pts; else rings.push(pts);
  setRings(a, rings); a.updated = Date.now(); delete a.example;
  save(); renderAll();
  toast(rings.length > 1 ? `Gränsen för ${a.name} är sparad. ${rings.length} delar, totalt ${fmtHa(ringsHa(rings))}.` : `Gränsen för ${a.name} är sparad, ${fmtHa(areaHa(pts))}.`);
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
    const rings = areaRings(a).concat([pts]);
    setRings(a, rings); a.updated = Date.now(); delete a.example;
    closeModal(); save(); renderAll();
    map.fitBounds(L.latLngBounds(pts), {paddingTopLeft:[40,70], paddingBottomRight:[40, bottomPad() + 40], maxZoom:16});
    toast(rings.length > 1 ? `En ny gränsdel är importerad till ${a.name}, ${fmtHa(areaHa(pts))}.` : `Gränsen för ${a.name} är importerad, ${fmtHa(areaHa(pts))}.`);
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
