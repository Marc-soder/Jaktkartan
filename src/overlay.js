/* ---------- Skärmdumpar ovanpå kartan ----------
   Hjälp att rita gränser och lägga ut pass efter en skärmdump (till exempel från Min karta eller en annan jaktapp).
   Man pekar ut två punkter i bilden och samma två punkter i kartan. Appen räknar ut skala, vridning och läge
   och lägger bilden halvgenomskinlig ovanpå kartan. Bilderna ligger kvar tills man tar bort dem och sparas
   bara i den här webbläsaren (bilden i IndexedDB, resten i localStorage). De delas aldrig. */
map.createPane('shot'); map.getPane('shot').style.zIndex = 300; map.getPane('shot').style.pointerEvents = 'none';
const SHOT_META = 'faltkartan.shots', SHOT_MAX = 2400;
let shots = [];   // {id, name, created, w, h, pts:[{u,v,ll},{u,v,ll}], visible, opacity, url, layer}
let cal = null;   // inpassning: {shot, i, step:'img'|'map', isNew, areaId}
let adj = null;   // justering: {shot, handles}

/* --- Lagring --- */
function idb(){
  if(idb.p) return idb.p;
  idb.p = new Promise((ok, no) => {
    try { const r = indexedDB.open('jaktkartan', 1); r.onupgradeneeded = () => r.result.createObjectStore('shots'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); } catch(e){ no(e); }
  });
  return idb.p;
}
const idbDo = (mode, fn) => idb().then(db => new Promise((ok, no) => { const t = db.transaction('shots', mode), r = fn(t.objectStore('shots')); t.oncomplete = () => ok(r && r.result); t.onerror = () => no(t.error); }));
const idbPut = (id, blob) => idbDo('readwrite', s => s.put(blob, id)).catch(() => {});
const idbGet = id => idbDo('readonly', s => s.get(id)).catch(() => null);
const idbDel = id => idbDo('readwrite', s => s.delete(id)).catch(() => {});
const calibrated = s => s && s.pts.length === 2 && s.pts.every(p => p && p.ll && p.u != null);
function saveShots(){ lsSet(SHOT_META, JSON.stringify(shots.filter(calibrated).map(s => ({id:s.id, name:s.name, created:s.created, w:s.w, h:s.h, pts:s.pts, visible:s.visible, opacity:s.opacity})))); }
async function loadShots(){
  let meta = [];
  try { meta = JSON.parse(lsGet(SHOT_META) || '[]'); } catch(e){}
  for(const m of Array.isArray(meta) ? meta : []){
    const blob = await idbGet(m.id);
    if(!blob || !calibrated(m)) continue;
    const s = Object.assign({}, m, {url:URL.createObjectURL(blob)});
    shots.push(s); if(s.visible) showShot(s);
  }
  if(shots.length !== meta.length) saveShots();
  renderShotList();
}

/* --- Avbildning ---
   Likformighetsavbildning (skala, vridning, förflyttning) från bildpixel till kartans lagerpunkt, som komplexa tal p = a·u + b.
   Räknas utan Leaflets avrundning till hela pixlar, som annars ger fel som växer längre från punkterna. */
const exactLayerPoint = (m, ll) => m.project(L.latLng(ll)).subtract(m.getPixelOrigin());
function shotTransform(s, m){
  const [A, B] = s.pts, P1 = exactLayerPoint(m, A.ll), P2 = exactLayerPoint(m, B.ll);
  const dx = B.u - A.u, dy = B.v - A.v, px = P2.x - P1.x, py = P2.y - P1.y, n = dx * dx + dy * dy;
  const ar = (px * dx + py * dy) / n, ai = (py * dx - px * dy) / n;
  return {ar, ai, bx:P1.x - (ar * A.u - ai * A.v), by:P1.y - (ai * A.u + ar * A.v)};
}
function shotImgToLatLng(s, u, v){
  const t = shotTransform(s, map);
  return map.unproject(L.point(t.ar * u - t.ai * v + t.bx, t.ai * u + t.ar * v + t.by).add(map.getPixelOrigin()));
}
const ShotLayer = L.Layer.extend({
  initialize(s){ this._s = s; },
  onAdd(m){
    const s = this._s, img = this._img = L.DomUtil.create('img', 'shot-img leaflet-zoom-hide', m.getPane('shot'));
    img.src = s.url; img.alt = ''; img.dataset.shot = s.id;
    Object.assign(img.style, {position:'absolute', left:'0', top:'0', width:s.w + 'px', height:s.h + 'px', maxWidth:'none', transformOrigin:'0 0', opacity:s.opacity, pointerEvents:'none'});
    m.on('zoomend viewreset', this._update, this); this._update();
  },
  onRemove(m){ L.DomUtil.remove(this._img); m.off('zoomend viewreset', this._update, this); },
  _update(){ const t = shotTransform(this._s, this._map); this._img.style.transform = `matrix(${t.ar},${t.ai},${-t.ai},${t.ar},${t.bx},${t.by})`; },
  setOpacity(o){ if(this._img) this._img.style.opacity = o; }
});
function showShot(s){ if(!s.layer && calibrated(s)) s.layer = new ShotLayer(s).addTo(map); }
function hideShot(s){ if(s.layer){ map.removeLayer(s.layer); s.layer = null; } }
function refreshShot(s){ if(s.layer) s.layer._update(); }
/* Lager för förstoringsglaset */
const shotLayersFor = m => shots.filter(s => s.visible && calibrated(s)).map(s => new ShotLayer(s));
const shotById = id => shots.find(s => s.id === id);

/* --- Lista i lagermenyn --- */
function renderShotList(){
  const el = $('#shotList'); if(!el) return;
  el.innerHTML = shots.map(s => `<div class="shot-row"><label class="base-opt" style="flex:1;min-width:0"><input type="checkbox" data-shot-vis="${s.id}" ${s.visible ? 'checked' : ''}><span class="shot-name">${esc(s.name)}</span></label><button class="btn sm" type="button" data-shot-edit="${s.id}">Ändra</button></div>`).join('')
    + `<button class="base-opt" type="button" id="shotAdd" style="width:100%;border:0;background:none;text-align:left;color:inherit;font:inherit"><span style="width:18px;text-align:center;font-weight:700;color:var(--accent)">+</span><span><strong>Lägg till skärmdump</strong><small>Ligger kvar tills du tar bort den. Sparas bara i den här telefonen.</small></span></button>`;
}
$('#layerPop').addEventListener('click', e => {
  const ed = e.target.closest('[data-shot-edit]'); if(ed){ toggleLayerPop(false); openShotForm(shotById(ed.dataset.shotEdit)); return; }
  if(e.target.closest('#shotAdd')){ toggleLayerPop(false); startShotAdd(); }
});
$('#layerPop').addEventListener('change', e => {
  const id = e.target.dataset && e.target.dataset.shotVis; if(!id) return;
  const s = shotById(id); if(!s) return;
  s.visible = e.target.checked; if(s.visible) showShot(s); else hideShot(s); saveShots();
});
function openShotForm(s){
  if(!s) return;
  openModal(`<h2>Skärmdump</h2><form id="seForm">
    <label class="field"><span>Namn</span><input class="input" id="seName" maxlength="60" value="${esc(s.name)}"></label>
    <label class="trail-range" style="padding:0"><span style="display:flex;justify-content:space-between"><strong>Genomskinlighet</strong><span id="seOpTxt">${Math.round(s.opacity * 100)} %</span></span><input type="range" id="seOpacity" min="10" max="100" step="5" value="${Math.round(s.opacity * 100)}"></label>
    <label class="checkline"><input type="checkbox" id="seVis" ${s.visible ? 'checked' : ''}><span>Visa på kartan</span></label>
    <div class="btnrow" style="margin-top:10px"><button class="btn" type="button" id="seAdjust">Flytta, skala och vrid</button><button class="btn" type="button" id="seRedo">Gör om punkterna</button><button class="btn" type="button" id="seDraw">Rita gräns</button></div>
    <div class="actions"><button class="btn primary grow" type="submit">Klar</button><button class="btn danger" type="button" id="seDel">Ta bort</button></div></form>`, m => {
    const keepName = () => { const v = m.querySelector('#seName').value.trim(); if(v) s.name = v; };
    m.querySelector('#seOpacity').addEventListener('input', e => { s.opacity = e.target.value / 100; m.querySelector('#seOpTxt').textContent = e.target.value + ' %'; if(s.layer) s.layer.setOpacity(s.opacity); });
    m.querySelector('#seVis').addEventListener('change', e => { s.visible = e.target.checked; if(s.visible) showShot(s); else hideShot(s); });
    m.querySelector('#seAdjust').addEventListener('click', () => { keepName(); closeModal(); startAdjust(s); });
    m.querySelector('#seRedo').addEventListener('click', () => { keepName(); closeModal(); startCalibration(s, false); });
    m.querySelector('#seDraw').addEventListener('click', () => { keepName(); saveShots(); renderShotList(); openBorderPick(); });
    const del = m.querySelector('#seDel');
    del.addEventListener('click', () => confirmClick(del, 'Bekräfta', () => { closeModal(); deleteShot(s); toast('Skärmdumpen är borttagen.'); }));
    m.querySelector('#seForm').addEventListener('submit', e => { e.preventDefault(); keepName(); saveShots(); renderShotList(); closeModal(); });
  });
}
function deleteShot(s){
  if(adj && adj.shot === s) endAdjust();
  hideShot(s); shots = shots.filter(x => x !== s); idbDel(s.id);
  try { URL.revokeObjectURL(s.url); } catch(e){}
  saveShots(); renderShotList();
}
/* Välj område och börja rita dess gräns, med skärmdumparna kvar under. */
function openBorderPick(areaId){
  const editable = state.areas.filter(a => canEditArea(a));
  if(!editable.length){ toast('Skapa ett område under Filter först.'); return; }
  const sel = areaId || (cal && cal.areaId) || (editable.find(a => !a.example) || editable[0]).id;
  openModal(`<h2>Rita gräns</h2><label class="field"><span>Område</span><select class="input" id="obArea">${editable.map(a => `<option value="${a.id}"${a.id === sel ? ' selected' : ''}>${esc(a.name)}${a.border ? ' (en ny gränsdel läggs till)' : ''}</option>`).join('')}</select></label>
    <div class="actions"><button class="btn primary grow" type="button" id="obGo">Börja rita</button><button class="btn ghost" type="button" id="obCancel">Avbryt</button></div>`, m => {
    m.querySelector('#obCancel').addEventListener('click', closeModal);
    m.querySelector('#obGo').addEventListener('click', () => { const id = m.querySelector('#obArea').value; endAdjust(); cal = null; endCalBar(); startDrawing(id); });
  });
}

/* --- Ny skärmdump och inpassning --- */
function startShotAdd(areaId){ $('#fileOverlay').dataset.area = areaId || ''; $('#fileOverlay').click(); }
$('#fileOverlay').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0], areaId = e.target.dataset.area || null; e.target.value = '';
  if(!file) return;
  if(!/^image\//.test(file.type)){ toast('Välj en bild, till exempel en skärmdump.'); return; }
  const src = URL.createObjectURL(file), img = new Image();
  img.onload = () => {
    let w = img.naturalWidth, h = img.naturalHeight;
    const done = blob => {
      const d = new Date(), s = {id:'s-' + uid(), name:`Skärmdump ${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`,
        created:Date.now(), w, h, pts:[{}, {}], visible:true, opacity:.6, url:URL.createObjectURL(blob), blob};
      URL.revokeObjectURL(src); closeModal(); startCalibration(s, true, areaId);
    };
    if(Math.max(w, h) <= SHOT_MAX){ done(file); return; }
    const k = SHOT_MAX / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k);
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
    c.toBlob(b => done(b), 'image/jpeg', .9);
  };
  img.onerror = () => { URL.revokeObjectURL(src); toast('Bilden kunde inte läsas.'); };
  img.src = src;
});
function startCalibration(s, isNew, areaId){
  endAdjust(); hideShot(s);
  cal = {shot:s, i:0, step:'img', isNew, areaId:areaId || null, old:isNew ? null : JSON.parse(JSON.stringify(s.pts))};
  pickImage(0);
}
function cancelCalibration(){
  if(!cal) return; const s = cal.shot;
  if(cal.isNew){ try { URL.revokeObjectURL(s.url); } catch(e){} }
  else { s.pts = cal.old; if(s.visible) showShot(s); }
  endCalBar(); cal = null;
}
/* Steg 1: punkt i bilden */
function pickImage(i){
  const s = cal.shot; cal.step = 'img'; cal.i = i; endCalBar(true);
  let zoom = 1;
  const p = s.pts[i] || (s.pts[i] = {});
  openModal(`<h2>Punkt ${i + 1} av 2 i bilden</h2>
    <p class="note" style="margin-top:0">Tryck på en plats som är lätt att hitta även i kartan, till exempel en vägkorsning, ett vägslut eller ett hus. ${i ? 'Välj en plats långt från den första.' : 'Den andra punkten ska ligga långt från den här.'}</p>
    <div class="shot-pick" id="ovWrap"><div class="shot-inner" id="ovInner"><img id="ovImg" src="${s.url}" alt="Skärmdumpen"><span class="shot-mark" id="ovMark" hidden></span>${i && s.pts[0].u != null ? `<span class="shot-mark first" style="left:${s.pts[0].u / s.w * 100}%;top:${s.pts[0].v / s.h * 100}%"></span>` : ''}</div></div>
    <div class="btnrow" style="margin-top:8px"><button class="btn sm" type="button" id="ovZoomIn" aria-label="Förstora bilden">+</button><button class="btn sm" type="button" id="ovZoomOut" aria-label="Förminska bilden">−</button><span class="small muted" style="align-self:center">Förstora för att träffa rätt.</span></div>
    <div class="actions"><button class="btn primary grow" type="button" id="ovNext" ${p.u == null ? 'disabled' : ''}>Nästa: samma plats i kartan</button><button class="btn ghost" type="button" id="ovCancel">Avbryt</button></div>`, m => {
    const inner = m.querySelector('#ovInner'), mark = m.querySelector('#ovMark'), wrap = m.querySelector('#ovWrap');
    const showMark = () => { if(p.u == null) return; mark.hidden = false; mark.style.left = (p.u / s.w * 100) + '%'; mark.style.top = (p.v / s.h * 100) + '%'; };
    const setZoom = z => {
      const cx = (wrap.scrollLeft + wrap.clientWidth / 2) / inner.clientWidth, cy = (wrap.scrollTop + wrap.clientHeight / 2) / inner.clientHeight;
      zoom = Math.max(1, Math.min(8, z)); inner.style.width = (zoom * 100) + '%';
      wrap.scrollLeft = cx * inner.clientWidth - wrap.clientWidth / 2; wrap.scrollTop = cy * inner.clientHeight - wrap.clientHeight / 2;
    };
    m.querySelector('#ovImg').addEventListener('click', e => {
      const r = e.currentTarget.getBoundingClientRect();
      p.u = (e.clientX - r.left) / r.width * s.w; p.v = (e.clientY - r.top) / r.height * s.h; showMark();
      m.querySelector('#ovNext').disabled = false;
    });
    m.querySelector('#ovZoomIn').addEventListener('click', () => setZoom(zoom * 2));
    m.querySelector('#ovZoomOut').addEventListener('click', () => setZoom(zoom / 2));
    m.querySelector('#ovCancel').addEventListener('click', () => { closeModal(); cancelCalibration(); });
    m.querySelector('#ovNext').addEventListener('click', () => { closeModal(); pickMap(i); });
    showMark();
  });
}
/* Steg 2: samma punkt i kartan, med kors och förstoringsglas. Den första punkten går att dra om den hamnade fel. */
let calCrossEl = null, calHandles = L.layerGroup().addTo(map);
function calCross(show){
  if(show && !calCrossEl){ calCrossEl = h(`<div class="crosshair" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><circle cx="24" cy="24" r="9"/><path d="M24 3v11M24 34v11M3 24h11M34 24h11"/></svg></div>`); map.getContainer().appendChild(calCrossEl); }
  if(calCrossEl) calCrossEl.hidden = !show;
}
function pickMap(i){
  const s = cal.shot, p = s.pts[i]; cal.step = 'map'; cal.i = i; map.closePopup();
  $('#btnAdd').hidden = true; if(!isDesktop()) setSheet('min');
  $('#ovbar').innerHTML = `<div class="shot-hint"><canvas id="ovCrop" width="120" height="80" aria-label="Utsnitt av bilden runt punkten"></canvas>
      <p>Flytta kartan så att <b>korset</b> hamnar på samma plats som i bilden (punkt ${i + 1} av 2). Förstoringsglaset visar vad som ligger under korset.</p></div>
    <div class="btnrow"><button class="btn primary" id="ovMapOk" type="button">${i ? 'Lägg bilden på kartan' : 'Nästa punkt'}</button><button class="btn" id="ovBack" type="button">Tillbaka till bilden</button><button class="btn ghost" id="ovMapCancel" type="button">Avbryt</button></div>`;
  $('#ovbar').hidden = false;
  const img = new Image(); img.onload = () => {
    const c = $('#ovCrop'); if(!c) return; const g = c.getContext('2d'), z = Math.max(s.w, s.h) / 8;
    g.fillStyle = '#ddd'; g.fillRect(0, 0, 120, 80);
    g.drawImage(img, p.u - z * .75, p.v - z / 2, z * 1.5, z, 0, 0, 120, 80);
    g.strokeStyle = '#d9520e'; g.lineWidth = 2; g.beginPath(); g.moveTo(60, 30); g.lineTo(60, 50); g.moveTo(50, 40); g.lineTo(70, 40); g.stroke();
  }; img.src = s.url;
  calCross(true); syncCross();
  if(p.ll){ map.setView(p.ll, Math.max(map.getZoom(), 15), {animate:false}); panToCross(p.ll); }
  setTimeout(() => { if(cal && cal.step === 'map' && cal.i === i){ syncCross(); if(p.ll) panToCross(p.ll); loupeAtCenter(); } }, 320);
  calMarks(); loupeAtCenter();
  $('#ovMapOk').addEventListener('click', () => {
    const c = crossLatLng(); p.ll = {lat:c.lat, lng:c.lng};
    if(i === 0){ pickImage(1); return; }
    const [A, B] = s.pts;
    if(Math.hypot(B.u - A.u, B.v - A.v) < Math.max(s.w, s.h) / 10){ toast('Punkterna i bilden ligger för nära varandra. Välj två platser längre ifrån varandra.', 5000); pickImage(1); return; }
    if(distM(A.ll, B.ll) < 30){ toast('Punkterna i kartan ligger för nära varandra.', 5000); return; }
    finishCalibration();
  });
  $('#ovBack').addEventListener('click', () => pickImage(i));
  $('#ovMapCancel').addEventListener('click', () => cancelCalibration());
}
function calMarks(){
  calHandles.clearLayers();
  if(!cal || cal.step !== 'map' || cal.i !== 1 || !cal.shot.pts[0].ll) return;
  const A = cal.shot.pts[0];
  loupeDrag(dragHandle(A.ll, 'shot first'), null, ll => { A.ll = {lat:ll.lat, lng:ll.lng}; }).addTo(calHandles);
}
map.on('move', () => { if(cal && cal.step === 'map') loupeAtCenter(); });
map.on('click', e => { if(cal && cal.step === 'map') panToCross(e.latlng, true); });
function endCalBar(keepCal){
  calCross(false); calHandles.clearLayers(); loupeHide();
  if(!adj){ $('#ovbar').hidden = true; $('#ovbar').innerHTML = ''; }
  if(!keepCal && !drawing && !placing) $('#btnAdd').hidden = false;
  if(!keepCal) setTimeout(sheetRestore, 0);
}
function finishCalibration(){
  const s = cal.shot, isNew = cal.isNew;
  endCalBar(true); cal.step = 'done';
  if(isNew){ shots.push(s); idbPut(s.id, s.blob); delete s.blob; }
  s.visible = true; showShot(s); refreshShot(s); saveShots(); renderShotList();
  const c = [[0, 0], [s.w, 0], [s.w, s.h], [0, s.h]].map(([u, v]) => shotImgToLatLng(s, u, v));
  map.fitBounds(L.latLngBounds(c), {paddingTopLeft:[20, 60], paddingBottomRight:[20, bottomPad() + 200]});
  const areaId = cal.areaId; cal = {shot:s, step:'done', areaId};
  $('#ovbar').innerHTML = `<p>Bilden ligger på kartan och finns kvar tills du tar bort den. Stämmer den inte, tryck Justera och dra punkterna rätt.</p>
    <div class="btnrow"><button class="btn primary" id="ovDrawBorder" type="button">Rita gräns</button><button class="btn" id="ovAdjust" type="button">Justera</button><button class="btn ghost" id="ovDone" type="button">Klar</button></div>
    <p class="small">Pass och torn lägger du ut med + som vanligt. Skärmdumparna tänder och släcker du i lagermenyn.</p>`;
  $('#ovbar').hidden = false; $('#btnAdd').hidden = true;
  $('#ovDrawBorder').addEventListener('click', () => openBorderPick(areaId));
  $('#ovAdjust').addEventListener('click', () => { const sh = cal.shot; cal = null; startAdjust(sh); });
  $('#ovDone').addEventListener('click', () => { cal = null; endCalBar(); });
}

/* --- Justera: dra de två punkterna (skala och vridning) eller mitten (flytta hela bilden) --- */
function startAdjust(s){
  endAdjust(); if(cal){ endCalBar(); cal = null; }
  if(!s.visible){ s.visible = true; saveShots(); renderShotList(); }
  showShot(s);
  adj = {shot:s, handles:L.layerGroup().addTo(map)};
  const mid = () => { const a = exactLayerPoint(map, s.pts[0].ll), b = exactLayerPoint(map, s.pts[1].ll); return map.unproject(a.add(b).divideBy(2).add(map.getPixelOrigin())); };
  const draw = () => {
    adj.handles.clearLayers();
    s.pts.forEach((p, i) => loupeDrag(dragHandle(p.ll, 'shot' + (i ? '' : ' first')), ll => { p.ll = {lat:ll.lat, lng:ll.lng}; refreshShot(s); }, () => { saveShots(); draw(); }).addTo(adj.handles));
    const c = dragHandle(mid(), 'shot move'); let start = null, from = null;
    c.on('dragstart', () => { start = exactLayerPoint(map, c.getLatLng()); from = s.pts.map(p => exactLayerPoint(map, p.ll)); });
    c.on('drag', () => { const d = exactLayerPoint(map, c.getLatLng()).subtract(start); s.pts.forEach((p, i) => { const ll = map.unproject(from[i].add(d).add(map.getPixelOrigin())); p.ll = {lat:ll.lat, lng:ll.lng}; }); refreshShot(s); });
    c.on('dragend', () => { saveShots(); draw(); });
    c.addTo(adj.handles);
  };
  draw();
  $('#btnAdd').hidden = true; if(!isDesktop()) setSheet('min');
  $('#ovbar').innerHTML = `<p>Dra en <b>punkt</b> för att passa in bilden: det skalar och vrider den. Dra <b>mitten</b> för att flytta hela bilden. Förstoringsglaset visas medan du drar.</p>
    <label class="trail-range" style="padding:0"><span style="display:flex;justify-content:space-between"><strong>Genomskinlighet</strong><span id="ovOpTxt">${Math.round(s.opacity * 100)} %</span></span><input type="range" id="ovOpacity" min="10" max="100" step="5" value="${Math.round(s.opacity * 100)}"></label>
    <div class="btnrow"><button class="btn primary" id="ovAdjDone" type="button">Klar</button><button class="btn" id="ovAdjRedo" type="button">Gör om punkterna</button></div>`;
  $('#ovbar').hidden = false;
  $('#ovOpacity').addEventListener('input', e => { s.opacity = e.target.value / 100; $('#ovOpTxt').textContent = e.target.value + ' %'; if(s.layer) s.layer.setOpacity(s.opacity); });
  $('#ovOpacity').addEventListener('change', saveShots);
  $('#ovAdjDone').addEventListener('click', () => { endAdjust(); toast('Bilden är sparad i sitt nya läge.'); });
  $('#ovAdjRedo').addEventListener('click', () => { endAdjust(); startCalibration(s, false); });
}
function endAdjust(){
  if(!adj) return;
  map.removeLayer(adj.handles); adj = null; saveShots(); loupeHide();
  $('#ovbar').hidden = true; $('#ovbar').innerHTML = '';
  if(!drawing && !placing && !cal) $('#btnAdd').hidden = false;
  sheetRestore();
}

loadShots();
