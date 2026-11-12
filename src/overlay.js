/* ---------- Skärmdump ovanpå kartan ----------
   Hjälp att rita en gräns efter en skärmdump (till exempel från Min karta eller en annan jaktapp).
   Man pekar ut två punkter i bilden och samma två punkter i kartan. Appen räknar ut skala, vridning
   och läge, och lägger bilden halvgenomskinlig ovanpå kartan. Bilden sparas inte, den finns bara
   kvar tills man tar bort den eller sparar gränsen. */
map.createPane('shot'); map.getPane('shot').style.zIndex = 300; map.getPane('shot').style.pointerEvents = 'none';
let ov = null;           // {url, w, h, areaId, pts:[{u,v,ll}], step, i, layer, mark, opacity}
const OV_MAX = 2400;     // längsta sida i pixlar efter nedskalning

/* Likformighetsavbildning (skala, vridning, förflyttning) från bildpixel till kartans lagerpunkt,
   räknad som komplexa tal: p = a·u + b. */
// Lagerpunkt utan avrundning (Leaflets latLngToLayerPoint avrundar till hela pixlar, vilket ger fel som växer längre från punkterna)
const exactLayerPoint = ll => map.project(L.latLng(ll)).subtract(map.getPixelOrigin());
function ovTransform(){
  const [A, B] = ov.pts, P1 = exactLayerPoint(A.ll), P2 = exactLayerPoint(B.ll);
  const dx = B.u - A.u, dy = B.v - A.v, px = P2.x - P1.x, py = P2.y - P1.y, n = dx * dx + dy * dy;
  const ar = (px * dx + py * dy) / n, ai = (py * dx - px * dy) / n;
  return {ar, ai, bx:P1.x - (ar * A.u - ai * A.v), by:P1.y - (ai * A.u + ar * A.v)};
}
function ovImgToLatLng(u, v){
  const t = ovTransform();
  return map.layerPointToLatLng(L.point(t.ar * u - t.ai * v + t.bx, t.ai * u + t.ar * v + t.by));
}
const ShotLayer = L.Layer.extend({
  onAdd(m){
    const img = this._img = L.DomUtil.create('img', 'shot-img leaflet-zoom-hide', m.getPane('shot'));
    img.src = ov.url; img.alt = '';
    Object.assign(img.style, {position:'absolute', left:'0', top:'0', width:ov.w + 'px', height:ov.h + 'px', maxWidth:'none', transformOrigin:'0 0', opacity:ov.opacity});
    m.on('zoomend viewreset', this._update, this); this._update();
  },
  onRemove(m){ L.DomUtil.remove(this._img); m.off('zoomend viewreset', this._update, this); },
  _update(){ const t = ovTransform(); this._img.style.transform = `matrix(${t.ar},${t.ai},${-t.ai},${t.ar},${t.bx},${t.by})`; },
  setOpacity(o){ if(this._img) this._img.style.opacity = o; }
});

function startOverlay(areaId){
  const a = areaById(areaId); if(!a) return;
  if(!canEditArea(a)){ toast('Du har inte rättighet att ändra det området.'); return; }
  $('#fileOverlay').dataset.area = areaId; $('#fileOverlay').click();
}
$('#fileOverlay').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0], areaId = e.target.dataset.area; e.target.value = '';
  if(!file) return;
  if(!/^image\//.test(file.type)){ toast('Välj en bild, till exempel en skärmdump.'); return; }
  const src = URL.createObjectURL(file), img = new Image();
  img.onload = () => {
    let w = img.naturalWidth, h = img.naturalHeight;
    const done = url => { removeOverlay(true); ov = {url, w, h, areaId, pts:[], step:'img', i:0, opacity:.6}; closeModal(); pickImage(0); };
    if(Math.max(w, h) <= OV_MAX){ done(src); return; }
    const k = OV_MAX / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k);
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(src);
    c.toBlob(b => done(URL.createObjectURL(b)), 'image/jpeg', .9);
  };
  img.onerror = () => { URL.revokeObjectURL(src); toast('Bilden kunde inte läsas.'); };
  img.src = src;
});

/* Steg 1: punkt i bilden */
function pickImage(i){
  ov.step = 'img'; ov.i = i; $('#ovbar').hidden = true; ovCross(false);
  let zoom = 1;
  const p = ov.pts[i] || {};
  openModal(`<h2>Punkt ${i + 1} av 2 i bilden</h2>
    <p class="note" style="margin-top:0">Tryck på en plats som är lätt att hitta även i kartan, till exempel en vägkorsning, ett vägslut eller ett hus. ${i ? 'Välj en plats långt från den första.' : 'Den andra punkten ska ligga långt från den här.'}</p>
    <div class="shot-pick" id="ovWrap"><div class="shot-inner" id="ovInner"><img id="ovImg" src="${ov.url}" alt="Skärmdumpen"><span class="shot-mark" id="ovMark" hidden></span>${i ? `<span class="shot-mark first" style="left:${ov.pts[0].u / ov.w * 100}%;top:${ov.pts[0].v / ov.h * 100}%"></span>` : ''}</div></div>
    <div class="btnrow" style="margin-top:8px"><button class="btn sm" type="button" id="ovZoomIn" aria-label="Förstora bilden">+</button><button class="btn sm" type="button" id="ovZoomOut" aria-label="Förminska bilden">−</button><span class="small muted" style="align-self:center">Förstora för att träffa rätt.</span></div>
    <div class="actions"><button class="btn primary grow" type="button" id="ovNext" ${p.u == null ? 'disabled' : ''}>Nästa: samma plats i kartan</button><button class="btn ghost" type="button" id="ovCancel">Avbryt</button></div>`, m => {
    const inner = m.querySelector('#ovInner'), mark = m.querySelector('#ovMark'), wrap = m.querySelector('#ovWrap');
    const showMark = () => { if(p.u == null) return; mark.hidden = false; mark.style.left = (p.u / ov.w * 100) + '%'; mark.style.top = (p.v / ov.h * 100) + '%'; };
    const setZoom = z => {
      const cx = (wrap.scrollLeft + wrap.clientWidth / 2) / inner.clientWidth, cy = (wrap.scrollTop + wrap.clientHeight / 2) / inner.clientHeight;
      zoom = Math.max(1, Math.min(8, z)); inner.style.width = (zoom * 100) + '%';
      wrap.scrollLeft = cx * inner.clientWidth - wrap.clientWidth / 2; wrap.scrollTop = cy * inner.clientHeight - wrap.clientHeight / 2;
    };
    m.querySelector('#ovImg').addEventListener('click', e => {
      const r = e.currentTarget.getBoundingClientRect();
      p.u = (e.clientX - r.left) / r.width * ov.w; p.v = (e.clientY - r.top) / r.height * ov.h;
      ov.pts[i] = Object.assign(ov.pts[i] || {}, {u:p.u, v:p.v}); showMark();
      m.querySelector('#ovNext').disabled = false;
    });
    m.querySelector('#ovZoomIn').addEventListener('click', () => setZoom(zoom * 2));
    m.querySelector('#ovZoomOut').addEventListener('click', () => setZoom(zoom / 2));
    m.querySelector('#ovCancel').addEventListener('click', () => { closeModal(); removeOverlay(true); });
    m.querySelector('#ovNext').addEventListener('click', () => { closeModal(); pickMap(i); });
    showMark();
  });
}

/* Steg 2: samma punkt i kartan */
function pickMap(i){
  ov.step = 'map'; ov.i = i; map.closePopup();
  if(ov.layer){ map.removeLayer(ov.layer); ov.layer = null; }
  $('#btnAdd').hidden = true; if(!isDesktop()) setSheet('peek');
  const p = ov.pts[i];
  $('#ovbar').innerHTML = `<div class="shot-hint"><canvas id="ovCrop" width="120" height="80" aria-label="Utsnitt av bilden runt punkten"></canvas>
      <p>Flytta kartan så att <b>korset</b> hamnar på samma plats som i bilden (punkt ${i + 1} av 2). Zooma in för att träffa rätt. Satellit kan göra det lättare.</p></div>
    <div class="btnrow"><button class="btn primary" id="ovMapOk" type="button">${i ? 'Lägg bilden på kartan' : 'Nästa punkt'}</button><button class="btn" id="ovBack" type="button">Tillbaka till bilden</button><button class="btn ghost" id="ovMapCancel" type="button">Avbryt</button></div>`;
  $('#ovbar').hidden = false;
  // utsnitt av bilden runt punkten, med ett kors i mitten
  const img = new Image(); img.onload = () => {
    const c = $('#ovCrop'); if(!c) return; const g = c.getContext('2d'), s = Math.max(ov.w, ov.h) / 8;
    g.fillStyle = '#ddd'; g.fillRect(0, 0, 120, 80);
    g.drawImage(img, p.u - s * .75, p.v - s / 2, s * 1.5, s, 0, 0, 120, 80);
    g.strokeStyle = '#d9520e'; g.lineWidth = 2; g.beginPath(); g.moveTo(60, 30); g.lineTo(60, 50); g.moveTo(50, 40); g.lineTo(70, 40); g.stroke();
  }; img.src = ov.url;
  if(p.ll) map.setView(p.ll, Math.max(map.getZoom(), 15), {animate:false});
  ovCross(true); ovMark();
  $('#ovMapOk').addEventListener('click', () => {
    const c = map.getCenter(); ov.pts[i].ll = {lat:c.lat, lng:c.lng};
    if(i === 0){ pickImage(1); return; }
    const [A, B] = ov.pts;
    if(Math.hypot(B.u - A.u, B.v - A.v) < Math.max(ov.w, ov.h) / 10){ toast('Punkterna i bilden ligger för nära varandra. Välj två platser längre ifrån varandra.', 5000); pickImage(1); return; }
    if(distM(A.ll, B.ll) < 30){ toast('Punkterna i kartan ligger för nära varandra.', 5000); return; }
    placeOverlay(true);
  });
  $('#ovBack').addEventListener('click', () => { ovCross(false); pickImage(i); });
  $('#ovMapCancel').addEventListener('click', () => removeOverlay());
}
/* Visar den första punkten i kartan medan man väljer den andra. */
function ovMark(){
  if(ov.mark){ map.removeLayer(ov.mark); ov.mark = null; }
  const p = ov.step === 'map' && ov.i === 1 && ov.pts[0];
  if(p && p.ll) ov.mark = L.circleMarker(p.ll, {radius:8, color:'#ffffff', weight:3, fillColor:'#1a73e8', fillOpacity:1, interactive:false}).addTo(map);
}
let ovCrossEl = null;
function ovCross(show){
  if(show && !ovCrossEl){ ovCrossEl = h(`<div class="crosshair" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><circle cx="24" cy="24" r="9"/><path d="M24 3v11M24 34v11M3 24h11M34 24h11"/></svg></div>`); map.getContainer().appendChild(ovCrossEl); }
  if(ovCrossEl) ovCrossEl.hidden = !show;
}
// Ett tryck i kartan flyttar korset dit
map.on('click', e => { if(ov && ov.step === 'map') map.panTo(e.latlng); });

/* Steg 3: bilden ligger på kartan */
function placeOverlay(fit){
  ov.step = 'placed'; ovMark(); ovCross(false);
  if(!ov.layer) ov.layer = new ShotLayer().addTo(map);
  if(fit){ const c = [[0, 0], [ov.w, 0], [ov.w, ov.h], [0, ov.h]].map(([u, v]) => ovImgToLatLng(u, v)); map.fitBounds(L.latLngBounds(c), {paddingTopLeft:[20, 60], paddingBottomRight:[20, bottomPad() + 200]}); ov.layer._update(); }
  $('#btnAdd').hidden = true;
  $('#ovbar').innerHTML = `<p>Bilden ligger på kartan. Kontrollera att vägar och gränser i bilden stämmer med kartan, rita sedan gränsen ovanpå.</p>
    <label class="trail-range" style="padding:0"><span style="display:flex;justify-content:space-between"><strong>Genomskinlighet</strong><span id="ovOpTxt">${Math.round(ov.opacity * 100)} %</span></span><input type="range" id="ovOpacity" min="10" max="100" step="5" value="${Math.round(ov.opacity * 100)}"></label>
    <div class="btnrow"><button class="btn primary" id="ovDraw" type="button">Rita gränsen</button><button class="btn" id="ovRedo" type="button">Gör om punkterna</button><button class="btn ghost" id="ovRemove" type="button">Ta bort bilden</button></div>`;
  $('#ovbar').hidden = false;
  $('#ovOpacity').addEventListener('input', e => { ov.opacity = e.target.value / 100; $('#ovOpTxt').textContent = e.target.value + ' %'; ov.layer.setOpacity(ov.opacity); });
  $('#ovDraw').addEventListener('click', () => { $('#ovbar').hidden = true; ov.step = 'draw'; startDrawing(ov.areaId); });
  $('#ovRedo').addEventListener('click', () => { if(ov.layer){ map.removeLayer(ov.layer); ov.layer = null; } pickImage(0); });
  $('#ovRemove').addEventListener('click', () => removeOverlay());
}
/* Anropas av ritverktyget när ritningen är klar eller avbruten. */
function overlayDrawEnded(saved){
  if(!ov || ov.step !== 'draw') return;
  if(saved){ removeOverlay(true); return; }
  placeOverlay(false);
}
function removeOverlay(silent){
  if(!ov) return;
  if(ov.layer) map.removeLayer(ov.layer);
  if(ov.mark) map.removeLayer(ov.mark);
  try { URL.revokeObjectURL(ov.url); } catch(e){}
  ov = null; ovCross(false); $('#ovbar').hidden = true; $('#ovbar').innerHTML = '';
  if(!drawing) $('#btnAdd').hidden = false;
  if(!silent) toast('Bilden är borttagen.');
}
