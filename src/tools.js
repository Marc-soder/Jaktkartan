/* ---------- Vind, kryss med avståndsringar och mätning ---------- */

/* Gemensamt: riktning och avstånd */
const DIR16 = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSV', 'SV', 'VSV', 'V', 'VNV', 'NV', 'NNV'];
const dirName = deg => DIR16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
function bearingDeg(a, b){
  const r = Math.PI / 180, f1 = a.lat * r, f2 = b.lat * r, dl = (b.lng - a.lng) * r;
  const y = Math.sin(dl) * Math.cos(f2), x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) / r + 360) % 360;
}
/* Punkt d meter från p i riktningen b grader (tillräckligt noggrant för några kilometer). */
function destPoint(p, d, b){
  const r = Math.PI / 180;
  return L.latLng(p.lat + d * Math.cos(b * r) / 111320, p.lng + d * Math.sin(b * r) / (111320 * Math.cos(p.lat * r)));
}
const metersPerPixel = (lat, z) => 40075016.686 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z + 8);
const blocked = () => placing || drawing || (typeof cal !== 'undefined' && cal) || (typeof adj !== 'undefined' && adj);

/* ---------- Vindriktning ----------
   Vinden hämtas från Open-Meteo (gratis, utan nyckel). Det gula området visar vart vittringen driver,
   från din position (eller korset om positionen inte är känd), och de blå pilarna rör sig med vinden. */
const WIND_LEN = 600;
map.createPane('wind'); map.getPane('wind').style.zIndex = 450; map.getPane('wind').style.pointerEvents = 'none';
const wind = {data:null, at:0, from:null, busy:false, layer:L.layerGroup().addTo(map), canvas:null, raf:0, sector:null, timer:null};
const windOn = () => !!state.settings.wind;
function windOrigin(){ return myPos ? L.latLng(myPos.lat, myPos.lng) : crossLatLng(); }
/* Hur brett området är: svag vind vänder mer, så då blir det bredare. */
const windHalf = s => s < 1.5 ? 45 : s < 4 ? 30 : 20;
async function windFetch(force){
  if(!windOn() || wind.busy) return;
  const o = windOrigin();
  if(!force && wind.data && Date.now() - wind.at < 10 * 60000 && wind.from && distM(wind.from, o) < 3000) return;
  wind.busy = true; windChip();
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${o.lat.toFixed(3)}&longitude=${o.lng.toFixed(3)}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=ms&timezone=auto`);
    if(!r.ok) throw new Error('http');
    const c = (await r.json()).current || {};
    if(typeof c.wind_direction_10m !== 'number' || typeof c.wind_speed_10m !== 'number') throw new Error('data');
    wind.data = {dir:c.wind_direction_10m, speed:c.wind_speed_10m, gust:typeof c.wind_gusts_10m === 'number' ? c.wind_gusts_10m : null, time:c.time || ''};
    wind.at = Date.now(); wind.from = o;
  } catch(e){ if(!wind.data) toast('Vinden kunde inte hämtas just nu.'); }
  wind.busy = false; windRender();
}
/* Det gula området: spets i origo, öppning mot det håll vinden blåser. */
function windSector(){
  const o = windOrigin(), d = wind.data; if(!d) return null;
  const axis = (d.dir + 180) % 360, half = windHalf(d.speed), pts = [o];
  for(let a = -half; a <= half + 1e-9; a += half / 8) pts.push(destPoint(o, WIND_LEN, axis + a));
  return {o, axis, half, pts};
}
function windRender(){
  wind.layer.clearLayers(); wind.sector = null;
  if(!windOn() || !wind.data){ windChip(); windAnim(false); renderWindNote(); return; }
  const s = wind.sector = windSector();
  L.polygon(s.pts, {color:'#e8b500', weight:2, opacity:.9, fillColor:'#ffd400', fillOpacity:.28, interactive:false, className:'wind-sector'}).addTo(wind.layer);
  windChip(); windAnim(true); renderWindNote();
}
function windChip(){
  const el = $('#windChip'); if(!el) return;
  el.hidden = !windOn();
  if(!windOn()) return;
  const d = wind.data;
  el.innerHTML = d ? `<svg viewBox="0 0 24 24" style="transform:rotate(${(d.dir + 180) % 360}deg)" aria-hidden="true"><path d="M12 3l5 9h-3.5v9h-3v-9H7z" fill="currentColor"/></svg><span><b>${dirName(d.dir)}</b> ${fmtNum(d.speed)} m/s${d.gust != null ? ` <span class="muted">byar ${fmtNum(d.gust)}</span>` : ''}</span>`
    : `<span>${wind.busy ? 'Hämtar vind …' : 'Ingen vinddata'}</span>`;
  el.title = d ? `Vind från ${dirName(d.dir)} (${Math.round(d.dir)}°). Tryck för att hämta igen.` : '';
}
const fmtNum = v => (Math.round(v * 10) / 10).toLocaleString('sv-SE');
function renderWindNote(){
  const n = $('#windNote'); if(!n) return;
  const d = wind.data;
  n.textContent = !windOn() ? 'Gult område där vittringen driver, med pilar som visar vinden' : d ? `Vind från ${dirName(d.dir)}, ${fmtNum(d.speed)} m/s. Från ${myPos ? 'din position' : 'korset'}. Open-Meteo.` : 'Hämtar …';
  const c = $('#popWind'); if(c) c.checked = windOn();
}
function setWind(on){
  state.settings.wind = !!on; save();
  if(on){ windFetch(); clearInterval(wind.timer); wind.timer = setInterval(() => windFetch(), 10 * 60000); }
  else { clearInterval(wind.timer); }
  windRender();
}
/* Blå pilar som rör sig i vindens riktning inne i det gula området, ritade på en canvas som följer kartan. */
function windAnim(on){
  if(!on){ cancelAnimationFrame(wind.raf); wind.raf = 0; if(wind.canvas) wind.canvas.hidden = true; return; }
  if(!wind.canvas){ wind.canvas = L.DomUtil.create('canvas', 'wind-arrows', map.getPane('wind')); }
  wind.canvas.hidden = false;
  if(!wind.raf) wind.raf = requestAnimationFrame(windFrame);
}
function windFrame(t){
  wind.raf = 0;
  const s = wind.sector, cv = wind.canvas; if(!s || !cv || cv.hidden) return;
  if(!document.hidden){
    const size = map.getSize(), dpr = window.devicePixelRatio || 1;
    if(cv.width !== Math.round(size.x * dpr) || cv.height !== Math.round(size.y * dpr)){ cv.width = Math.round(size.x * dpr); cv.height = Math.round(size.y * dpr); cv.style.width = size.x + 'px'; cv.style.height = size.y + 'px'; }
    L.DomUtil.setPosition(cv, map.containerPointToLayerPoint([0, 0]));
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, size.x, size.y);
    const P = s.pts.map(ll => map.latLngToContainerPoint(ll)), A = P[0];
    g.save(); g.beginPath(); P.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath(); g.clip();
    const r = Math.PI / 180, ax = Math.sin(s.axis * r), ay = -Math.cos(s.axis * r), px = -ay, py = ax;   // axel (nedvind) och tvärs
    const R = Math.max(...P.map(p => Math.hypot(p.x - A.x, p.y - A.y)));
    const step = 30, len = 11, speed = 14 + wind.data.speed * 5;                 // pixlar mellan pilarna, pilens längd, fart (px/s)
    const phase = ((t / 1000) * speed) % step;
    // Bara den del av rutnätet som syns på skärmen
    const cs = [[0, 0], [size.x, 0], [size.x, size.y], [0, size.y]].map(([x, y]) => [(x - A.x) * ax + (y - A.y) * ay, (x - A.x) * px + (y - A.y) * py]);
    const u0 = Math.max(-step, Math.min(...cs.map(c => c[0]))), u1 = Math.min(R, Math.max(...cs.map(c => c[0])));
    const v0 = Math.max(-R, Math.min(...cs.map(c => c[1]))), v1 = Math.min(R, Math.max(...cs.map(c => c[1])));
    g.strokeStyle = '#1a73e8'; g.fillStyle = '#1a73e8'; g.lineWidth = 2; g.lineCap = 'round';
    let n = 0;
    for(let u = Math.floor(u0 / step) * step; u <= u1 && n < 4000; u += step){
      const row = Math.round(u / step), off = (row & 1) ? step / 2 : 0;
      for(let v = Math.floor(v0 / step) * step; v <= v1 && n < 4000; v += step){
        const uu = u + phase, vv = v + off, x = A.x + ax * uu + px * vv, y = A.y + ay * uu + py * vv;
        const hx = x + ax * len / 2, hy = y + ay * len / 2;
        g.beginPath(); g.moveTo(x - ax * len / 2, y - ay * len / 2); g.lineTo(hx, hy); g.stroke();
        g.beginPath(); g.moveTo(hx + ax * 3, hy + ay * 3); g.lineTo(hx - ax * 3 + px * 3.5, hy - ay * 3 + py * 3.5); g.lineTo(hx - ax * 3 - px * 3.5, hy - ay * 3 - py * 3.5); g.closePath(); g.fill();
        n++;
      }
    }
    g.restore();
    wind.frames = (wind.frames || 0) + 1;
  }
  wind.raf = requestAnimationFrame(windFrame);
}
map.on('move zoom', () => { if(windOn() && wind.data && !myPos) windRender(); });
map.on('moveend', () => { if(windOn()) windFetch(); });
$('#popWind').addEventListener('change', e => setWind(e.target.checked));
$('#windChip').addEventListener('click', () => { windFetch(true); toast('Hämtar vinden igen …', 1500); });

/* ---------- Kryss med avståndsringar ----------
   Visas i mitten av den synliga kartan medan man panorerar och zoomar, och en stund efteråt.
   Visar också avståndet från din position till krysset. Ligger kvar hela tiden när man mäter. */
const NICE = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
const pan = {el:null, timer:null, ready:false};
function panInit(){
  if(pan.el) return;
  pan.el = h(`<div class="pancross" hidden aria-hidden="true"><div class="pc-rings"></div><svg class="pc-x" viewBox="0 0 30 30"><path d="M15 3v9M15 18v9M3 15h9M18 15h9" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M15 3v9M15 18v9M3 15h9M18 15h9" stroke="#16231c" stroke-width="2" stroke-linecap="round"/></svg><div class="pc-label"></div></div>`);
  map.getContainer().appendChild(pan.el);
}
function panShow(stay){
  if(!pan.ready) return;
  if(blocked() && !measure) { panHide(); return; }
  panInit(); pan.el.hidden = false; panUpdate();
  clearTimeout(pan.timer);
  if(!stay && !measure) pan.timer = setTimeout(panHide, 2500);
}
function panHide(){ clearTimeout(pan.timer); if(pan.el && !measure) pan.el.hidden = true; }
function panUpdate(){
  if(!pan.el || pan.el.hidden) return;
  const p = crossPoint(), ll = map.containerPointToLatLng(p), mpp = metersPerPixel(ll.lat, map.getZoom());
  pan.el.style.left = p.x + 'px'; pan.el.style.top = p.y + 'px';
  const step = NICE.find(m => m / mpp >= 38) || NICE[NICE.length - 1];
  pan.el.querySelector('.pc-rings').innerHTML = [1, 2, 3].map(k => { const rpx = k * step / mpp; return `<span class="pc-ring" style="width:${2 * rpx}px;height:${2 * rpx}px;margin:${-rpx}px 0 0 ${-rpx}px"></span><span class="pc-rl" style="top:${-rpx}px">${fmtDist(k * step)}</span>`; }).join('');
  const lab = pan.el.querySelector('.pc-label');
  lab.textContent = myPos ? `${fmtDist(distM(myPos, ll))} från dig · ${dirName(bearingDeg(L.latLng(myPos.lat, myPos.lng), ll))}` : '';
  lab.hidden = !myPos;
}
map.on('movestart zoomstart', () => panShow(true));
map.on('move zoom', () => { if(pan.el && !pan.el.hidden) panUpdate(); else panShow(true); });
map.on('moveend zoomend', () => { if(pan.el && !pan.el.hidden){ panUpdate(); if(!measure){ clearTimeout(pan.timer); pan.timer = setTimeout(panHide, 2500); } } });

/* ---------- Mäta avstånd ----------
   Flytta kartan så att krysset hamnar på en punkt och tryck Sätt punkt. Linjen och avståndet följer krysset
   till nästa punkt. Man kan sätta flera punkter, då visas hela sträckan. */
let measure = null;   // {pts:[latlng], layer}
function startMeasure(){
  if(drawing || placing || (typeof cal !== 'undefined' && cal) || (typeof adj !== 'undefined' && adj)) return;
  measure = {pts:[], layer:L.layerGroup().addTo(map)};
  $('#btnMeasure').setAttribute('aria-pressed', 'true');
  $('#measurebar').hidden = false; $('#btnAdd').hidden = true; if(!isDesktop()) setSheet('min');
  panShow(true); measureRender();
  setTimeout(() => { syncCross(); panUpdate(); measureRender(); }, 320);
}
function endMeasure(){
  if(!measure) return;
  map.removeLayer(measure.layer); measure = null;
  $('#btnMeasure').setAttribute('aria-pressed', 'false');
  $('#measurebar').hidden = true; $('#btnAdd').hidden = false; panHide(); sheetRestore();
}
const pathLen = pts => pts.reduce((s, p, i) => i ? s + distM(pts[i - 1], p) : 0, 0);
function measureRender(){
  if(!measure) return;
  measure.layer.clearLayers();
  const c = crossLatLng(), P = measure.pts;
  if(P.length){
    L.polyline(P.concat([c]), {color:'#ffffff', weight:6, opacity:.8, interactive:false}).addTo(measure.layer);
    L.polyline(P, {color:'#d9520e', weight:3, interactive:false}).addTo(measure.layer);
    L.polyline([P[P.length - 1], c], {color:'#d9520e', weight:3, dashArray:'6 6', interactive:false}).addTo(measure.layer);
    P.forEach(p => L.circleMarker(p, {radius:5, color:'#fff', weight:2, fillColor:'#d9520e', fillOpacity:1, interactive:false}).addTo(measure.layer));
  }
  const last = P[P.length - 1], seg = last ? distM(last, c) : 0, tot = pathLen(P);
  $('#measureText').innerHTML = !P.length ? 'Flytta kartan så att krysset hamnar på den första punkten och tryck <b>Sätt punkt</b>.'
    : `<b>${fmtDist(tot + seg)}</b> till krysset${P.length > 1 ? ` <span class="muted">(${fmtDist(tot)} mellan punkterna)</span>` : ''}<br><span class="small muted">Senaste delen ${fmtDist(seg)} mot ${dirName(bearingDeg(last, c))}${P.length > 1 ? ` · ${P.length} punkter` : ''}</span>`;
  $('#mUndo').disabled = !P.length;
}
map.on('move zoom', () => { if(measure) measureRender(); });
map.on('click', e => { if(measure) panToCross(e.latlng, true); });
$('#btnMeasure').addEventListener('click', () => { if(measure) endMeasure(); else startMeasure(); });
$('#mAdd').addEventListener('click', () => { const c = crossLatLng(); measure.pts.push(L.latLng(c.lat, c.lng)); measureRender(); });
$('#mUndo').addEventListener('click', () => { measure.pts.pop(); measureRender(); });
$('#mClose').addEventListener('click', endMeasure);

/* Starta när kartan har fått sitt första läge */
map.whenReady(() => setTimeout(() => { pan.ready = true; if(windOn()) setWind(true); }, 400));
