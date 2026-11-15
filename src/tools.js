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
   Vinden hämtas från Open-Meteo (gratis, utan nyckel). Det gula området visar vart vittringen driver från din position,
   och visas bara när positionen är känd (det följer alltså aldrig kartans mitt). De blå pilarna rör sig med vinden
   över hela den synliga kartan. */
const WIND_LEN = 600;
map.createPane('wind'); map.getPane('wind').style.zIndex = 450; map.getPane('wind').style.pointerEvents = 'none';
const wind = {data:null, at:0, from:null, busy:false, layer:L.layerGroup().addTo(map), canvas:null, raf:0, sector:null, timer:null};
// Påslagen från början. Bara den som själv stängt av den (wind === false) har den avstängd.
const windOn = () => state.settings.wind !== false;
function windOrigin(){ return myPos ? L.latLng(myPos.lat, myPos.lng) : map.getCenter(); }
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
  const d = wind.data; if(!d || !myPos) return null;
  const o = L.latLng(myPos.lat, myPos.lng);
  const axis = (d.dir + 180) % 360, half = windHalf(d.speed), pts = [o];
  for(let a = -half; a <= half + 1e-9; a += half / 8) pts.push(destPoint(o, WIND_LEN, axis + a));
  return {o, axis, half, pts};
}
function windRender(){
  wind.layer.clearLayers(); wind.sector = null;
  if(!windOn() || !wind.data){ windChip(); windAnim(false); renderWindNote(); return; }
  const s = wind.sector = windSector();
  if(s) L.polygon(s.pts, {color:'#e8b500', weight:2, opacity:.9, fillColor:'#ffd400', fillOpacity:.28, interactive:false, className:'wind-sector'}).addTo(wind.layer);
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
  n.textContent = !windOn() ? 'Gult område där vittringen driver, med pilar som visar vinden' : d ? `Vind från ${dirName(d.dir)}, ${fmtNum(d.speed)} m/s. ${myPos ? 'Gula området utgår från din position.' : 'Gula området visas när din position är känd.'} Open-Meteo.` : 'Hämtar …';
  const c = $('#popWind'); if(c) c.checked = windOn();
}
function setWind(on){
  state.settings.wind = !!on; save();
  if(on){ windFetch(); clearInterval(wind.timer); wind.timer = setInterval(() => windFetch(), 10 * 60000); }
  else { clearInterval(wind.timer); }
  windRender();
}
/* Blå pilar som rör sig i vindens riktning över hela den synliga kartan, ritade på en canvas som följer kartan. */
function windAnim(on){
  if(!on){ cancelAnimationFrame(wind.raf); clearTimeout(wind.tmo); wind.raf = 0; wind.tmo = 0; if(wind.canvas) wind.canvas.hidden = true; return; }
  if(!wind.canvas){ wind.canvas = L.DomUtil.create('canvas', 'wind-arrows', map.getPane('wind')); }
  wind.canvas.hidden = false;
  if(!wind.raf && !wind.tmo) wind.raf = requestAnimationFrame(windFrame);
}
function windFrame(t){
  wind.raf = 0;
  const d = wind.data, cv = wind.canvas; if(!d || !cv || cv.hidden) return;
  if(!document.hidden){
    const size = map.getSize(), dpr = window.devicePixelRatio || 1;
    if(cv.width !== Math.round(size.x * dpr) || cv.height !== Math.round(size.y * dpr)){ cv.width = Math.round(size.x * dpr); cv.height = Math.round(size.y * dpr); cv.style.width = size.x + 'px'; cv.style.height = size.y + 'px'; }
    L.DomUtil.setPosition(cv, map.containerPointToLayerPoint([0, 0]));
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, size.x, size.y);
    // Rutnätet är fäst i kartan (där vinden hämtades), så pilarna följer kartan när man flyttar den
    const A = map.latLngToContainerPoint(wind.from || map.getCenter()), axis = (d.dir + 180) % 360;
    g.save();
    const r = Math.PI / 180, ax = Math.sin(axis * r), ay = -Math.cos(axis * r), px = -ay, py = ax;   // axel (nedvind) och tvärs
    const step = 34, len = 11, speed = 14 + d.speed * 5;                 // pixlar mellan pilarna, pilens längd, fart (px/s)
    const phase = ((t / 1000) * speed) % step;
    // Bara den del av rutnätet som syns på skärmen
    const cs = [[0, 0], [size.x, 0], [size.x, size.y], [0, size.y]].map(([x, y]) => [(x - A.x) * ax + (y - A.y) * ay, (x - A.x) * px + (y - A.y) * py]);
    const u0 = Math.min(...cs.map(c => c[0])) - step, u1 = Math.max(...cs.map(c => c[0])) + step;
    const v0 = Math.min(...cs.map(c => c[1])) - step, v1 = Math.max(...cs.map(c => c[1])) + step;
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
  // I sparläget ritas pilarna om cirka tio gånger i sekunden i stället för sextio
  if(power.on) wind.tmo = setTimeout(() => { wind.tmo = 0; wind.raf = requestAnimationFrame(windFrame); }, POWER_FRAME_MS);
  else wind.raf = requestAnimationFrame(windFrame);
}
map.on('moveend', () => { if(windOn()) windFetch(); });
$('#popWind').addEventListener('change', e => setWind(e.target.checked));
$('#windChip').addEventListener('click', () => { windFetch(true); toast('Hämtar vinden igen …', 1500); });

/* ---------- Kryss med avståndsringar ----------
   Visas i mitten av den synliga kartan medan man panorerar och zoomar, och en stund efteråt.
   Är din position känd visas i stället för ringarna en tunn streckad linje från dig till krysset,
   och avståndet i hela meter. Ligger kvar hela tiden när man mäter. */
const NICE = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
const pan = {el:null, timer:null, ready:false, line:null};
const ringLabel = m => m < 1000 ? `${m} m` : `${(m / 1000).toLocaleString('sv-SE')} km`;
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
function panHide(){ clearTimeout(pan.timer); if(pan.el && !measure){ pan.el.hidden = true; panLine(null); } }
/* Linjen från din position till krysset. null tar bort den. */
function panLine(to){
  if(!to || !myPos){ if(pan.line){ map.removeLayer(pan.line); pan.line = null; } return; }
  const pts = [L.latLng(myPos.lat, myPos.lng), to];
  if(pan.line) pan.line.setLatLngs(pts);
  else pan.line = L.polyline(pts, {color:'#1a73e8', weight:2, opacity:.95, dashArray:'4 6', lineCap:'butt', interactive:false, className:'me-line'}).addTo(map);
}
function panUpdate(){
  if(!pan.el || pan.el.hidden) return;
  // Samma punkt som placeringskorset: mitt på kartan
  const p = crossPoint(), ll = map.containerPointToLatLng(p), mpp = metersPerPixel(ll.lat, map.getZoom());
  pan.el.style.left = p.x + 'px'; pan.el.style.top = p.y + 'px';
  const step = NICE.find(m => m / mpp >= 38) || NICE[NICE.length - 1];
  // Med känd position: linje från dig i stället för ringar. När man mäter från egna punkter behövs ingen linje från dig.
  panLine(myPos && !(measure && measure.pts.length) ? ll : null);
  pan.el.querySelector('.pc-rings').innerHTML = myPos ? '' : [1, 2, 3].map(k => { const rpx = k * step / mpp; return `<span class="pc-ring" style="width:${2 * rpx}px;height:${2 * rpx}px;margin:${-rpx}px 0 0 ${-rpx}px"></span><span class="pc-rl" style="top:${-rpx}px">${ringLabel(k * step)}</span>`; }).join('');
  const lab = pan.el.querySelector('.pc-label');
  lab.textContent = myPos ? `${fmtDist(distM(myPos, ll))} från dig · ${dirName(bearingDeg(L.latLng(myPos.lat, myPos.lng), ll))}` : '';
  lab.hidden = !myPos;
}
map.on('movestart zoomstart', () => panShow(true));
map.on('move zoom', () => { if(pan.el && !pan.el.hidden) panUpdate(); else panShow(true); });
map.on('moveend zoomend', () => { if(pan.el && !pan.el.hidden){ panUpdate(); if(!measure){ clearTimeout(pan.timer); pan.timer = setTimeout(panHide, 2500); } } });

/* ---------- Avståndsringar runt min position ----------
   Ligger kvar hela tiden när positionen är känd. Avståndet mellan ringarna väljs efter zoomen,
   så att de inte hamnar för tätt, och den yttersta ringen är högst 500 m. */
const ME_RING_MAX = 500, ME_RING_STEPS = [10, 20, 25, 50, 100, 250, 500];
const meRings = {layer:null, radii:[]};
const meRingsOn = () => state.settings.meRings !== false;
function meRingRadii(lat, zoom){
  const mpp = metersPerPixel(lat, zoom);
  let step = ME_RING_STEPS.find(m => m / mpp >= 45);
  if(!step){ if(ME_RING_MAX / mpp < 14) return []; step = ME_RING_MAX; }   // utzoomat: bara 500 m-ringen, eller inget alls
  const out = [];
  for(let k = 1; k <= 5 && k * step <= ME_RING_MAX; k++) out.push(k * step);
  return out;
}
function meRingsRender(){
  if(!meRings.layer) meRings.layer = L.layerGroup().addTo(map);
  meRings.layer.clearLayers(); meRings.radii = [];
  if(!myPos || !meRingsOn()) return;
  const c = L.latLng(myPos.lat, myPos.lng), radii = meRingRadii(c.lat, map.getZoom());
  meRings.radii = radii;
  for(const r of radii){
    L.circle(c, {radius:r, color:'#ffffff', weight:3, opacity:.55, fill:false, interactive:false, className:'me-ring-halo'}).addTo(meRings.layer);
    L.circle(c, {radius:r, color:'#16231c', weight:1.2, opacity:.75, fill:false, interactive:false, className:'me-ring'}).addTo(meRings.layer);
    L.marker([c.lat + r / 111320, c.lng], {icon:L.divIcon({className:'me-rl', html:`<span>${r} m</span>`, iconSize:[0, 0]}), interactive:false, keyboard:false, zIndexOffset:-1000}).addTo(meRings.layer);
  }
}
function setMeRings(on){ state.settings.meRings = !!on; save(); meRingsRender(); const c = $('#popMeRings'); if(c) c.checked = meRingsOn(); }
map.on('zoomend', meRingsRender);
$('#popMeRings').addEventListener('change', e => setMeRings(e.target.checked));

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

/* ---------- Riktningen jag tittar åt ----------
   En blå kon från positionspricken och en kompass uppe till vänster, efter telefonens kompass. Startas av ett tryck på positionsknappen
   (på iPhone krävs ett tryck för att få tillåtelse att läsa kompassen). */
const compass = {on:false, heading:null, raf:0, rot:0, timer:null, mask:0, bad:false, last:0};

/* ---------- Sparläge ----------
   Slås på när man är incheckad på sitt pass under en pågående jakt och inte har rört skärmen på 30 sekunder,
   och (där webbläsaren berättar det, t.ex. Android) när batteriet är under 20 % och telefonen inte laddas.
   Då mäter GPS:en mer sällan, positionen skickas mer sällan och vindpilar och kompass ritas om cirka tio gånger
   i sekunden. Ett tryck på skärmen, att lämna passet eller att peka mot en förbjuden riktning ger full fart direkt. */
const power = {on:false, touch:Date.now(), battery:null, reason:''};
const POWER_IDLE_MS = 30000, POWER_FRAME_MS = 100;
const powerAllowed = () => state.settings.powerSave !== false;
const powerOn = () => power.on;
function powerReason(){
  if(!powerAllowed() || compass.bad || Date.now() - power.touch < POWER_IDLE_MS) return '';
  const b = power.battery;
  if(b && !b.charging && b.level < 0.2) return 'battery';
  if(typeof checkOf === 'function' && typeof myStands === 'function' && myStands().some(({g, hid, p}) => { const c = checkOf(g, hid); return c && c.in && c.pid === p.id; })) return 'pass';
  return '';
}
function powerUpdate(){
  const r = powerReason(), on = !!r;
  power.reason = r;
  if(on !== power.on){ power.on = on; if(typeof gpsSync === 'function') gpsSync(); }
  const chip = $('#powerChip'); if(chip){ chip.hidden = !on; chip.textContent = r === 'battery' ? 'Sparläge · lågt batteri' : 'Sparläge'; }
}
['pointerdown', 'keydown', 'wheel'].forEach(ev => window.addEventListener(ev, () => { power.touch = Date.now(); if(power.on) powerUpdate(); }, {passive:true, capture:true}));
setInterval(powerUpdate, 5000);
try { if(navigator.getBattery) navigator.getBattery().then(b => { power.battery = b; b.addEventListener('levelchange', powerUpdate); b.addEventListener('chargingchange', powerUpdate); powerUpdate(); }).catch(() => {}); } catch(e){}
$('#popPower').addEventListener('change', e => { state.settings.powerSave = e.target.checked; save(); powerUpdate(); });
$('#powerChip').addEventListener('click', () => toast(power.reason === 'battery' ? 'Sparläge: batteriet är under 20 %. GPS, sändning och animationer går långsammare. Tryck på skärmen för full fart en stund.' : 'Sparläge på passet: GPS och sändning går mer sällan och animationer långsammare. Lämnar du passet eller rör skärmen blir det full fart igen.', 6000));
const compassOn = () => state.settings.compass !== false;
const isTouch = () => !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches);
const screenAngle = () => (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (typeof window.orientation === 'number' ? window.orientation : 0);
function onOrient(e){
  let hd = null;
  if(typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) hd = e.webkitCompassHeading;   // iPhone: medsols från norr
  else if(e.absolute && typeof e.alpha === 'number') hd = 360 - e.alpha;                                            // Android: moturs från norr
  if(hd == null) return;
  compass.heading = ((hd + screenAngle()) % 360 + 360) % 360;
  if(compass.raf) return;
  // I sparläget ritas kompassen om högst tio gånger i sekunden
  const wait = power.on ? Math.max(0, POWER_FRAME_MS - (Date.now() - compass.last)) : 0;
  const draw = () => { compass.raf = 0; compass.last = Date.now(); const was = compass.bad; renderHeading(); if(compass.bad !== was) powerUpdate(); };
  compass.raf = wait ? setTimeout(() => requestAnimationFrame(draw), wait) : requestAnimationFrame(draw);
}
/* Kompassen uppe till vänster. Syns på telefon (och på dator om den ger en riktning). */
function renderCompass(){
  const btn = $('#compassBtn'); if(!btn) return;
  // Är panelen så utdragen att kartan bara är en smal remsa skulle kompassen krocka med vinden: dölj den då.
  const roomy = isDesktop() || window.innerHeight - bottomPad() >= 330;
  btn.hidden = !compassOn() || !(isTouch() || compass.heading != null) || !roomy;
  const h = compass.heading;
  btn.classList.toggle('off', h == null);
  if(h == null){ $('#compassTxt').textContent = compass.on ? 'Väntar …' : 'Kompass'; btn.setAttribute('aria-label', compass.on ? 'Kompass: väntar på telefonens riktning' : 'Kompass: tryck för att starta'); return; }
  // Vrid kortaste vägen så att rosen inte snurrar ett helt varv när riktningen passerar norr
  const last = ((compass.rot % 360) + 360) % 360; let d = h - last; if(d > 180) d -= 360; if(d < -180) d += 360;
  compass.rot += d;
  $('#compassDial').style.transform = `rotate(${-compass.rot}deg)`;
  // Förbjudna skjutriktningar på mitt pass: röda fält i rosen, och varning när telefonen pekar in i ett
  const mask = typeof myNoFireMask === 'function' ? myNoFireMask() : 0;
  if(mask !== compass.mask){
    compass.mask = mask;
    const pt = (r, a) => `${(r * Math.sin(a * Math.PI / 180)).toFixed(2)},${(-r * Math.cos(a * Math.PI / 180)).toFixed(2)}`;
    $('#cmpNo').innerHTML = maskRuns(mask).map(([i, n]) => { const a0 = i * 22.5 - 11.25, a1 = a0 + n * 22.5, big = n * 22.5 > 180 ? 1 : 0;
      return n >= 16 ? '<path d="M0,-47A47,47 0 1 1 0,47A47,47 0 1 1 0,-47Z"/>' : `<path d="M0,0L${pt(47, a0)}A47,47 0 ${big} 1 ${pt(47, a1)}Z"/>`; }).join('');
  }
  const bad = !!(mask & (1 << (Math.round(h / 22.5) % 16)));
  btn.classList.toggle('nofire', bad);
  if(bad && !compass.bad){ try { if(navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch(e){} }
  compass.bad = bad;
  const t = `${dirName(h)} ${Math.round(h) % 360}°`;
  $('#compassTxt').textContent = bad ? `Förbjuden riktning · ${t}` : t;
  btn.setAttribute('aria-label', bad ? `Förbjuden skjutriktning: telefonen pekar mot ${t}` : 'Telefonen pekar mot ' + t);
}
function renderHeading(){
  renderCompass();
  const el = typeof meMarker !== 'undefined' && meMarker && meMarker.getElement(), cone = el && el.querySelector('.me-cone');
  if(!cone) return;
  // SVG-element har ingen hidden-egenskap, så attributet sätts direkt
  if(compass.heading == null){ cone.setAttribute('hidden', ''); return; }
  cone.removeAttribute('hidden'); cone.style.transform = `rotate(${compass.heading}deg)`;
}
function startCompass(){
  if(compass.on) return;
  const go = () => {
    compass.on = true; renderCompass();
    clearTimeout(compass.timer);
    compass.timer = setTimeout(() => { if(compass.heading == null && compassOn() && isTouch()) toast('Telefonen ger ingen kompassriktning. Kontrollera att sidan får använda rörelse och orientering i webbläsarens inställningar.', 6000); }, 4000);
    window.addEventListener('deviceorientationabsolute', onOrient);
    window.addEventListener('deviceorientation', e => { if(typeof e.webkitCompassHeading === 'number' || e.absolute) onOrient(e); });
  };
  try {
    if(typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') DeviceOrientationEvent.requestPermission().then(r => { if(r === 'granted') go(); }).catch(() => {});
    else go();
  } catch(e){}
}
$('#btnLocate').addEventListener('click', startCompass);
$('#compassBtn').addEventListener('click', () => { if(!compass.on) startCompass(); else if(compass.heading != null) toast(`Telefonen pekar mot ${dirName(compass.heading)}, ${Math.round(compass.heading) % 360}°.`, 2500); });
$('#popCompass').addEventListener('change', e => { state.settings.compass = e.target.checked; save(); renderCompass(); if(e.target.checked) startCompass(); });
map.whenReady(renderCompass);
// Försök starta direkt. Där tillåtelse ges utan tryck (t.ex. Android) startar kompassen av sig själv.
// iPhone nekar utan ett tryck: då väntar kompassen på ett tryck (på kompassen eller positionsknappen).
if(compassOn()) startCompass();
$('#popTrailRec').addEventListener('change', startCompass);
$('#paneJakt').addEventListener('change', e => { if(e.target.id === 'shareToggle') startCompass(); });
$('#btnObs').addEventListener('click', () => { if(!blocked() && !measure) startPlacing({mode:'obs'}); });

/* ---------- Värmekarta över tidigare viltobservationer ----------
   Observationerna arkiveras utan namn när en jakt avslutas (groups/<lag>/obsArchive). Bara jaktledare och admin
   kan läsa arkivet, så värmekartan visas bara för dem. Den kan filtreras på art, jaktår och område. */
map.createPane('heat'); map.getPane('heat').style.zIndex = 380; map.getPane('heat').style.pointerEvents = 'none';
const heat = {refs:{}, data:{}, canvas:null, count:0};
const heatGroups = () => Object.values(cloud.groups).filter(g => g.kind === 'member' && g.meta && canLeadGroup(g));
const heatOn = () => !!state.settings.heat;
const heatFilter = () => Object.assign({sp:'', period:'season', area:''}, state.settings.heatFilter || {});
/* Jaktåret börjar 1 juli. */
function seasonStart(offset){ const d = new Date(), y = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1; return new Date(y - (offset || 0), 6, 1).getTime(); }
function heatRange(p){
  if(p === 'season') return [seasonStart(0), Infinity];
  if(p === 'last') return [seasonStart(1), seasonStart(0)];
  if(p === '365') return [Date.now() - 365 * 86400000, Infinity];
  return [0, Infinity];
}
function inRing(pt, ring){
  let inside = false;
  for(let i = 0, j = ring.length - 1; i < ring.length; j = i++){
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if(((yi > pt.lat) !== (yj > pt.lat)) && (pt.lng < (xj - xi) * (pt.lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function heatAll(){ const out = []; for(const [gid, d] of Object.entries(heat.data)) for(const o of Object.values(d || {})) if(o && typeof o.lat === 'number') out.push(Object.assign({gid}, o)); return out; }
function heatPoints(){
  const f = heatFilter(), [t0, t1] = heatRange(f.period), area = f.area && areaById(f.area), rings = area ? areaRings(area) : null;
  return heatAll().filter(o => (!f.sp || o.sp === f.sp) && o.t >= t0 && o.t < t1 && (!rings || rings.some(r => inRing(o, r))));
}
function heatSync(){
  const want = new Set(heatOn() && fb && cloud.user ? heatGroups().map(g => g.id) : []);
  for(const gid of Object.keys(heat.refs)) if(!want.has(gid)){ heat.refs[gid].off(); delete heat.refs[gid]; delete heat.data[gid]; }
  for(const gid of want) if(!heat.refs[gid]){
    const r = fb.db.ref(`groups/${gid}/obsArchive`);
    r.on('value', s => { if(heat.refs[gid] === r){ heat.data[gid] = s.val() || {}; heatRender(); renderHeatControls(); } }, () => { if(heat.refs[gid] === r){ delete heat.refs[gid]; delete heat.data[gid]; heatRender(); } });
    heat.refs[gid] = r;
  }
  renderHeatControls(); heatRender();
}
function renderHeatControls(){
  const box = $('#heatBox'); if(!box) return;
  const groups = heatGroups(); box.hidden = !groups.length; if(!groups.length) return;
  $('#popHeat').checked = heatOn(); $('#heatFilters').hidden = !heatOn();
  if(!heatOn()){ $('#heatNote').textContent = 'Var vilt har setts på tidigare jakter'; return; }
  const f = heatFilter(), all = heatAll(), sps = [...new Set(all.map(o => o.sp))].sort((a, b) => a.localeCompare(b, 'sv'));
  const areas = state.areas.filter(a => a.gid && groups.some(g => g.id === a.gid) && areaRings(a).length);
  const opt = (v, l, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`;
  $('#heatSp').innerHTML = opt('', 'Allt vilt', f.sp) + sps.map(s => opt(s, s, f.sp)).join('');
  $('#heatPeriod').innerHTML = [['season', 'Det här jaktåret'], ['last', 'Förra jaktåret'], ['365', 'Senaste 12 månaderna'], ['all', 'Alla år']].map(([v, l]) => opt(v, l, f.period)).join('');
  $('#heatArea').innerHTML = opt('', 'Alla jaktmarker', f.area) + areas.map(a => opt(a.id, a.name, f.area)).join('');
  const n = heatPoints().reduce((s, o) => s + (o.n || 1), 0);
  $('#heatNote').textContent = !all.length ? 'Inga observationer i arkivet ännu. De sparas när en jakt avslutas.' : `${n} ${n === 1 ? 'djur' : 'djur'} i ${heatPoints().length} observationer`;
}
/* Ritar värmekartan: suddiga fläckar som läggs på varandra, sedan färgade från blått (få) till rött (många). */
const HEAT_COLORS = (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 1; const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 256, 0);
  [[0, '#2563eb'], [.35, '#06b6d4'], [.55, '#84cc16'], [.75, '#facc15'], [1, '#dc2626']].forEach(([o, col]) => gr.addColorStop(o, col)); g.fillStyle = gr; g.fillRect(0, 0, 256, 1); return g.getImageData(0, 0, 256, 1).data; })();
function heatRender(){
  if(!heat.canvas){ heat.canvas = L.DomUtil.create('canvas', 'heat-canvas leaflet-zoom-hide', map.getPane('heat')); }
  const cv = heat.canvas, pts = heatOn() ? heatPoints() : [];
  heat.count = pts.length; cv.hidden = !pts.length; if(!pts.length) return;
  const size = map.getSize(); cv.width = size.x; cv.height = size.y;
  L.DomUtil.setPosition(cv, map.containerPointToLayerPoint([0, 0]));
  const g = cv.getContext('2d'), c = map.getCenter(), r = Math.max(14, Math.min(90, 70 / metersPerPixel(c.lat, map.getZoom())));
  for(const o of pts){
    const p = map.latLngToContainerPoint([o.lat, o.lng]);
    if(p.x < -r || p.y < -r || p.x > size.x + r || p.y > size.y + r) continue;
    const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    gr.addColorStop(0, `rgba(0,0,0,${Math.min(.9, .25 + .12 * (o.n || 1))})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(p.x - r, p.y - r, 2 * r, 2 * r);
  }
  const img = g.getImageData(0, 0, size.x, size.y), d = img.data;
  for(let i = 0; i < d.length; i += 4){ const a = d[i + 3]; if(!a) continue; const k = a * 4; d[i] = HEAT_COLORS[k]; d[i + 1] = HEAT_COLORS[k + 1]; d[i + 2] = HEAT_COLORS[k + 2]; d[i + 3] = Math.min(200, 60 + a); }
  g.putImageData(img, 0, 0);
}
map.on('moveend zoomend resize', () => { if(heatOn() && heat.count) heatRender(); });
$('#popHeat').addEventListener('change', e => { state.settings.heat = e.target.checked; save(); heatSync(); });
for(const [id, k] of [['#heatSp', 'sp'], ['#heatPeriod', 'period'], ['#heatArea', 'area']])
  $(id).addEventListener('change', e => { state.settings.heatFilter = Object.assign(heatFilter(), {[k]: e.target.value}); save(); renderHeatControls(); heatRender(); });

/* ---------- Numrera om passen ----------
   Passen i en jaktmark får nummer i ordning efter läge, t.ex. från söder till norr.
   En beskrivning efter numret behålls: "Pass 3 – kalhygget" kan bli "Pass 1 – kalhygget". */
var renumberUndo = null;   /* var: listan kan ritas innan den här filen har körts klart */
const RENUM_DIRS = {sn:'Söder till norr', ns:'Norr till söder', wo:'Väster till öster', ow:'Öster till väster'};
function isPassType(t){ return !!t && (t.id === 't-pass' || /^pass$/i.test((t.name || '').trim())); }
function passPins(){ return state.pins.filter(p => isPassType(typeById(p.typeId)) && canEditPin(p)); }
function passRest(name){
  const s = (name || '').trim();
  const m = s.match(/^(?:pass\s*)?(?:nr\.?\s*)?\d+\s*[–—\-:.,)]*\s*(.*)$/i);
  if(m) return m[1].trim();
  return s.replace(/^pass\b[\s–—\-:.,]*/i, '').trim();
}
function passName(n, rest){ return 'Pass ' + n + (rest ? ' – ' + rest : ''); }
/* Grupperar per område och sorterar. Returnerar [{pin, name}] med de nya namnen. */
function renumberPlan(areaKey, dir, start){
  start = Math.max(1, Math.floor(+start) || 1);
  const pins = passPins().filter(p => areaKey === '*' || (p.areaId || '') === areaKey);
  const groups = {};
  for(const p of pins) (groups[p.areaId || ''] = groups[p.areaId || ''] || []).push(p);
  const cmp = {sn:(a,b) => a.lat - b.lat || a.lng - b.lng, ns:(a,b) => b.lat - a.lat || a.lng - b.lng,
               wo:(a,b) => a.lng - b.lng || a.lat - b.lat, ow:(a,b) => b.lng - a.lng || a.lat - b.lat}[dir] || ((a,b) => a.lat - b.lat);
  const out = [];
  for(const list of Object.values(groups)) list.slice().sort(cmp).forEach((p, i) => out.push({pin:p, name:passName(start + i, passRest(p.name))}));
  return out;
}
function renumberAreas(){
  const counts = {};
  for(const p of passPins()) counts[p.areaId || ''] = (counts[p.areaId || ''] || 0) + 1;
  return Object.entries(counts).map(([id, n]) => ({id, n, name:id ? ((areaById(id) || {}).name || 'Okänt område') : 'Utan område'}))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'sv'));
}
function openRenumber(){
  const areas = renumberAreas();
  if(!passPins().length){ toast('Det finns inga pass som du kan ändra.'); return; }
  const set = state.settings.renumber || {};
  let areaKey = areas.some(a => a.id === set.area) ? set.area : areas[0].id, dir = RENUM_DIRS[set.dir] ? set.dir : 'sn', start = 1;
  openModal(`<h2>Numrera om passen</h2>
    <p class="note" style="margin-top:0">Passen får nummer i ordning efter var de ligger. Varje jaktmark numreras för sig. Text efter numret behålls.</p>
    <div class="row2">
      <label class="field"><span>Jaktmark</span><select class="input" id="rnArea">${areas.map(a => `<option value="${esc(a.id)}"${a.id === areaKey ? ' selected' : ''}>${esc(a.name)} (${a.n})</option>`).join('')}${areas.length > 1 ? `<option value="*"${areaKey === '*' ? ' selected' : ''}>Alla, var för sig</option>` : ''}</select></label>
      <label class="field"><span>Ordning</span><select class="input" id="rnDir">${Object.entries(RENUM_DIRS).map(([k, v]) => `<option value="${esc(k)}"${k === dir ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    </div>
    <label class="field rn-start"><span>Börja på nummer</span><input class="input" id="rnStart" type="number" inputmode="numeric" min="1" max="999" step="1" value="1"></label>
    <div class="field"><span>Så här blir det</span><div id="rnPreview" class="rn-preview"></div></div>
    <div class="actions"><button class="btn primary grow" type="button" id="rnOk">Numrera om</button><button class="btn ghost" type="button" id="rnCancel">Avbryt</button></div>`, m => {
    const preview = () => {
      const plan = renumberPlan(areaKey, dir, start);
      m.querySelector('#rnPreview').innerHTML = plan.map(({pin, name}) => {
        const same = (pin.name || '') === name;
        return `<div class="rn-row${same ? ' same' : ''}"><span class="rn-old">${esc(pin.name || 'Pass')}</span><span class="rn-arrow" aria-hidden="true">→</span><span class="rn-new">${esc(name)}</span></div>`;
      }).join('');
      const changed = plan.filter(x => (x.pin.name || '') !== x.name).length;
      const ok = m.querySelector('#rnOk'); ok.disabled = !changed; ok.textContent = changed ? `Numrera om ${changed} pass` : 'Redan i ordning';
    };
    m.querySelector('#rnArea').addEventListener('change', e => { areaKey = e.target.value; preview(); });
    m.querySelector('#rnDir').addEventListener('change', e => { dir = e.target.value; preview(); });
    m.querySelector('#rnStart').addEventListener('input', e => { start = Math.min(999, Math.max(1, Math.floor(+e.target.value) || 1)); preview(); });
    m.querySelector('#rnCancel').addEventListener('click', closeModal);
    m.querySelector('#rnOk').addEventListener('click', () => {
      const plan = renumberPlan(areaKey, dir, start), now = Date.now();
      const undo = plan.map(({pin}) => [pin.id, pin.name, pin.updated]);
      let changed = 0;
      for(const {pin, name} of plan){ if((pin.name || '') === name) continue; pin.name = name; pin.updated = now; delete pin.example; changed++; }
      state.settings.renumber = {area:areaKey, dir};
      renumberUndo = changed ? undo : null;
      save(); closeModal(); renderAll();
      toast(changed ? `${changed} pass har numrerats om. Ångra under Nålar.` : 'Passen var redan i ordning.', 4500);
    });
    preview();
  });
}
function undoRenumber(){
  if(!renumberUndo) return;
  for(const [id, name, upd] of renumberUndo){ const p = pinById(id); if(p && canEditPin(p)){ p.name = name; p.updated = Date.now(); } }
  renumberUndo = null; save(); renderAll(); toast('Numreringen är ångrad.');
}
