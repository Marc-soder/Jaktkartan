/* ---------- Nödläge ----------
   Knappen SOS skickar ett nödlarm med min position till alla i mina jaktlag (medlemmar, och gäster i pågående jakter).
   Larmet ligger i groups/<lag>/sos/<uid> = {t, name, lat, lng, acc}. Positionen uppdateras medan larmet är aktivt.
   De som har appen öppen får ett larmfönster med frågan om de vill navigera till personen, vibration och ljud,
   och en systemavisering om appen ligger i bakgrunden och aviseringar är tillåtna.
   En stängd app kan inte väckas utan en server som skickar pushnotiser, så ring alltid 112 vid fara. */
const SOS_LIVE = 3 * 3600000, SOS_CLEAN = 12 * 3600000, SOS_TRACK_MS = 20000;
const sosLayer = L.layerGroup().addTo(map);
const sosState = {seen:{}, sentAt:0, lastTrack:0};
const sosGroups = () => Object.values(cloud.groups).filter(g => g.meta && (g.kind === 'member' || (g.guest && g.guest.expires > Date.now())));
const sosActive = (s, now) => !!s && typeof s.t === 'number' && s.t > (now || Date.now()) - SOS_LIVE;
/* Aktiva larm från andra: [{g, uid, s}] */
function sosOthers(){
  const out = [], now = Date.now();
  for(const g of Object.values(cloud.groups)) for(const [u, s] of Object.entries(g.sos || {})) if(u !== myUid() && sosActive(s, now)) out.push({g, uid:u, s});
  return out.sort((a, b) => b.s.t - a.s.t);
}
const mySos = () => sosGroups().some(g => sosActive((g.sos || {})[myUid()]));

function sosPayload(){
  const v = {t:Date.now(), name:myName()};
  if(myPos){ v.lat = +myPos.lat.toFixed(6); v.lng = +myPos.lng.toFixed(6); if(myPos.acc) v.acc = Math.min(100000, Math.round(myPos.acc)); }
  return v;
}
function sosSend(){
  const gs = sosGroups(); if(!gs.length || !fb){ toast('Du är inte med i något jaktlag. Ring 112.', 6000); return; }
  const send = () => {
    const v = sosPayload(); sosState.sentAt = v.t;
    Promise.all(gs.map(g => fb.db.ref(`groups/${g.id}/sos/${myUid()}`).set(v))).then(() => toast('Nödlarmet är skickat till jaktlaget. Ring 112 om det är fara för liv.', 8000))
      .catch(() => toast('Nödlarmet kunde inte skickas till alla. Ring 112.', 8000));
    renderSos();
  };
  // Försök få en färsk position först (högst 8 s), annars skickas den senast kända
  if('geolocation' in navigator) navigator.geolocation.getCurrentPosition(p => { showMe(p.coords.latitude, p.coords.longitude, p.coords.accuracy || 0); send(); }, send, {enableHighAccuracy:true, timeout:8000, maximumAge:15000});
  else send();
}
function sosCancel(){
  for(const g of sosGroups()) if((g.sos || {})[myUid()]) fb.db.ref(`groups/${g.id}/sos/${myUid()}`).remove().catch(() => {});
  sosState.sentAt = 0; renderSos(); toast('Nödlarmet är avbrutet. Jaktlaget får besked om att du är OK.', 5000);
}
/* Medan mitt larm är aktivt skickas nya positioner, så att de som kommer till hjälp hittar rätt. */
function sosTrack(){
  if(!fb || !myPos || !mySos() || Date.now() - sosState.lastTrack < SOS_TRACK_MS) return;
  sosState.lastTrack = Date.now();
  for(const g of sosGroups()){ const s = (g.sos || {})[myUid()]; if(sosActive(s)) fb.db.ref(`groups/${g.id}/sos/${myUid()}`).update({lat:+myPos.lat.toFixed(6), lng:+myPos.lng.toFixed(6), acc:Math.min(100000, Math.round(myPos.acc || 0))}).catch(() => {}); }
}

function openSos(){
  if(mySos()){ sosCancelAsk(); return; }
  openModal(`<h2 class="sos-h">Nödläge</h2>
    <p>Skickar ett nödlarm med din position till alla i jaktlaget som har appen öppen. De får frågan om de vill navigera till dig.</p>
    <p class="note" style="margin-top:0"><b>Är det fara för liv: ring 112.</b> Larmet i appen når bara dem som har Jaktkartan öppen.</p>
    <div class="actions"><button class="btn sos-btn grow" type="button" id="sosSend">Skicka nödlarm</button><a class="btn" href="tel:112" id="sos112">Ring 112</a><button class="btn ghost" type="button" id="sosNo">Avbryt</button></div>`, m => {
    m.querySelector('#sosNo').addEventListener('click', closeModal);
    m.querySelector('#sosSend').addEventListener('click', () => { closeModal(); sosSend(); });
  });
}
function sosCancelAsk(){
  openModal(`<h2 class="sos-h">Ditt nödlarm är aktivt</h2><p>Skickat ${esc(fmtClock(sosState.sentAt || Date.now()))}. Jaktlaget ser din position.</p>
    <div class="actions"><button class="btn primary grow" type="button" id="sosOk">Jag är OK, avbryt larmet</button><a class="btn" href="tel:112">Ring 112</a><button class="btn ghost" type="button" id="sosKeep">Behåll larmet</button></div>`, m => {
    m.querySelector('#sosKeep').addEventListener('click', closeModal);
    m.querySelector('#sosOk').addEventListener('click', () => { closeModal(); sosCancel(); });
  });
}

/* Ett nytt larm från någon annan: larmfönster, vibration, ljud och systemavisering. */
function sosAlarm(x){
  const s = x.s, has = typeof s.lat === 'number' && typeof s.lng === 'number';
  const dist = has && myPos ? `${fmtDist(distM(myPos, s))} mot ${dirName(bearingDeg(L.latLng(myPos.lat, myPos.lng), L.latLng(s.lat, s.lng)))}` : '';
  openModal(`<div id="sosAlert"><h2 class="sos-h">Nödlarm</h2>
    <p><b>${esc(s.name || 'En deltagare')}</b> skickade ett nödlarm kl. ${esc(fmtClock(s.t))} och behöver hjälp.</p>
    <p>${has ? `${dist ? `Avstånd: <b>${esc(dist)}</b>.<br>` : ''}<span class="small muted">${fmtLatLng(s.lat, s.lng)} · SWEREF 99 TM ${fmtSweref(s.lat, s.lng)}</span>` : '<b>Positionen är okänd.</b> Ring personen eller 112.'}</p>
    <p class="small muted">Vill du navigera till ${esc(s.name || 'personen')}?</p>
    <div class="actions">${has ? `<a class="btn sos-btn grow" id="sosNav" href="${esc(navUrl(s.lat, s.lng))}" target="_blank" rel="noopener">${ICON_NAV}Navigera till ${esc(s.name || 'personen')}</a><button class="btn" type="button" id="sosShow">Visa på kartan</button>` : ''}<a class="btn" href="tel:112">Ring 112</a><button class="btn ghost" type="button" id="sosClose">Stäng</button></div></div>`, m => {
    m.querySelector('#sosClose').addEventListener('click', closeModal);
    const sh = m.querySelector('#sosShow'); if(sh) sh.addEventListener('click', () => { closeModal(); map.setView([s.lat, s.lng], Math.max(map.getZoom(), 16)); if(!isDesktop()) setSheet('peek'); });
  });
  try { if(navigator.vibrate) navigator.vibrate([600, 200, 600, 200, 600]); } catch(e){}
  sosBeep();
  if(document.hidden && NAT.on){ natNotify('sos/' + x.uid, `Nödlarm: ${s.name || 'en deltagare'} behöver hjälp`, has ? 'Tryck för att öppna Jaktkartan och navigera dit.' : 'Positionen är okänd. Ring personen eller 112.', 'sos'); return; }
  try {
    if(document.hidden && window.Notification && Notification.permission === 'granted' && navigator.serviceWorker) navigator.serviceWorker.getRegistration().then(r => {
      const title = `Nödlarm: ${s.name || 'en deltagare'} behöver hjälp`, opt = {body:has ? 'Tryck för att öppna Jaktkartan och navigera dit.' : 'Positionen är okänd. Ring personen eller 112.', tag:'sos-' + x.uid, requireInteraction:true, vibrate:[600, 200, 600]};
      if(r) r.showNotification(title, opt); else new Notification(title, opt);
    }).catch(() => {});
  } catch(e){}
}
function sosBeep(){
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if(!AC) return;
    const ac = new AC(), o = ac.createOscillator(), g = ac.createGain();
    o.type = 'square'; o.frequency.value = 880; o.connect(g); g.connect(ac.destination);
    g.gain.value = 0.0001; const t = ac.currentTime;
    for(let i = 0; i < 6; i++){ g.gain.setValueAtTime(0.25, t + i * 0.5); g.gain.setValueAtTime(0.0001, t + i * 0.5 + 0.3); }
    o.start(t); o.stop(t + 3); o.onended = () => ac.close();
  } catch(e){}
}
/* Körs när någon av lagens larm ändras. prev är förra läget (undefined första gången: då larmas bara om larm som är nya). */
function sosOnData(g, prev){
  const now = g.sos || {}, t = Date.now();
  for(const [u, s] of Object.entries(now)){
    if(u === myUid() || !sosActive(s, t)) continue;
    const key = g.id + '/' + u + '/' + s.t;
    if(sosState.seen[key]) continue;
    sosState.seen[key] = true;
    if(prev === undefined && t - s.t > 10 * 60000) continue;   // gamla larm vid start: visas på kartan men larmar inte
    sosAlarm({g, uid:u, s});
  }
  if(prev) for(const [u, s] of Object.entries(prev)) if(u !== myUid() && sosActive(s, t) && !now[u]) toast(`${s.name || 'Deltagaren'} har avbrutit nödlarmet och är OK.`, 8000);
  // Jaktledare och admin städar bort gamla larm
  if(g.kind === 'member' && canLeadGroup(g)) for(const [u, s] of Object.entries(now)) if(s && !(s.t > t - SOS_CLEAN)) fb.db.ref(`groups/${g.id}/sos/${u}`).remove().catch(() => {});
  renderSos();
}
/* Kartan: röda markeringar för aktiva larm. Knappen och raden för mitt eget larm. */
function renderSos(){
  sosLayer.clearLayers();
  for(const {uid:u, s} of sosOthers()){
    if(typeof s.lat !== 'number' || typeof s.lng !== 'number') continue;
    L.marker([s.lat, s.lng], {icon:L.divIcon({className:'sos-icon', html:`<span class="sos-dot">SOS</span><span class="sos-name">${esc(s.name || '')}</span>`, iconSize:[40, 40], iconAnchor:[20, 20]}), zIndexOffset:2000, keyboard:false})
      .on('click', () => sosAlarmShow(u)).addTo(sosLayer);
  }
  const btn = $('#btnSos'); if(btn){ btn.hidden = !sosGroups().length; btn.classList.toggle('on', mySos()); btn.setAttribute('aria-label', mySos() ? 'Ditt nödlarm är aktivt' : 'Nödläge: skicka nödlarm till jaktlaget'); }
  const bar = $('#sosBar'); if(bar) bar.hidden = !mySos();
}
function sosAlarmShow(u){ const x = sosOthers().find(y => y.uid === u); if(x) sosAlarm(x); }
$('#btnSos').addEventListener('click', openSos);
$('#sosBar').addEventListener('click', e => { if(e.target.closest('[data-sos="ok"]')) sosCancelAsk(); });
setInterval(renderSos, 60000);
