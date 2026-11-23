/* ---------- Jaktplan ----------
   Jaktledaren planerar en jakt innan den startar (och kan ändra under jakten):
   - vem som står på vilket pass, för hela jakten eller för varje såt, för hand eller genom lottning
   - om passen är lättillgängliga och om hagel eller kula passar bäst, och vad deltagarna har med sig
   - förbjudna skjutriktningar för varje pass (16 kompassriktningar)
   - såtar, ritade som ytor på kartan, i den ordning de ska drivas
   - vägar för hundförare och drevkarlar, med vem som går
   - samlingsplatser för återsamling efter en såt
   Planen ligger i groups/<lag>/huntPlan/<jakt>. Lagets medlemmar och jaktens gäster ser den, även före start.
   Bara jaktledare och admin ändrar den. Den tas bort när jakten avslutas. */
var planLayer = null;
const PLAN_R = 150;   // meter, längden på de röda sektorerna för förbjudna skjutriktningar
const ROUTE_KIND = {hund:{name:'Hundförare', color:'#db2777'}, drev:{name:'Drevkarl', color:'#6d28d9'}};
const DRIVE_STYLE = {color:'#166534', weight:2.5, dashArray:'8 6', fillColor:'#22c55e', fillOpacity:.08};
const planUi = {gid:null, hid:null, open:{}};
const planOf = (g, hid) => ((g && g.huntPlan) || {})[hid] || {};
const planOn = () => state.settings.planOn !== false;

/* Jakter jag deltar i som inte är slut: kommande och pågående. */
function planHunts(){
  const out = [], now = Date.now();
  for(const g of Object.values(cloud.groups)){
    for(const [hid, h] of Object.entries(g.hunts || {})){
      if(!h || !(h.expires > now)) continue;
      if(g.kind !== 'member' && !(g.guest && g.guest.hid === hid)) continue;
      out.push({g, hid, hunt:h});
    }
  }
  return out;
}
/* Passen i jaktens områden. Har jakten inga valda områden används lagets alla delade områden. */
function planAreaIds(g, hunt){ const a = Object.keys(hunt.areas || {}).filter(k => hunt.areas[k] === true); return a.length ? a : Object.keys(g.areas || {}); }
function planPasses(g, hunt){
  const ids = new Set(planAreaIds(g, hunt));
  return state.pins.filter(p => ids.has(p.areaId) && isPassType(typeById(p.typeId)))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'sv', {numeric:true}));
}
/* Deltagare att välja bland: lagets medlemmar och jaktens gäster. */
function planPeople(g, hid){
  const out = [];
  const rs = (g.huntRsvp || {})[hid] || {};
  for(const [u, m] of Object.entries(g.members || {})) if(m) out.push({uid:u, name:m.name || 'Medlem', label:(going(rs[u]) ? '✓ ' : '') + (m.name || 'Medlem'), going:going(rs[u])});
  for(const [u, v] of Object.entries(g.guests || {})) if(v && v.hid === hid) out.push({uid:u, name:v.name || 'Gäst', label:'✓ ' + (v.name || 'Gäst') + ' (gäst)', going:true});
  // De som deltar först
  return out.sort((a, b) => (b.going - a.going) || a.name.localeCompare(b.name, 'sv'));
}

/* ---------- Såtar ----------
   En jakt kan delas upp i såtar som drivs en i taget, i den ordning jaktledaren bestämmer (ord). Varje såt är som en liten
   jakt: den har egna pass (drives/<såt>/pass/<pass> = {who, uid, ok}) och egna vägar för hundförare och drevkarlar
   (routes/<väg>.drive). Jaktledaren startar och bryter såtarna: cur = {did, on, t}, och en bruten såt får done = tiden.
   När en såt bryts skickas "Såten är bruten, patron ur." i chatten. Sedan kan jaktledaren kalla till återsamling vid en av
   planens samlingsplatser (meets): call = {mid, name, lat, lng, t}, och alla får en hänvisning att navigera dit.
   Förbjudna skjutriktningar hör till passet och gäller i alla såtar (stands/<pass>.no).
   Utan såtar (eller om ingen såt har egna pass) gäller tilldelningen i stands för hela jakten, som tidigare. */
const ordOf = d => typeof d.ord === 'number' ? d.ord : -1;   // såtar från före ordningen kommer först
const driveList = plan => Object.entries(plan.drives || {}).filter(([, d]) => d && d.ring)
  .sort((a, b) => (ordOf(a[1]) - ordOf(b[1])) || String(a[1].name || '').localeCompare(String(b[1].name || ''), 'sv', {numeric:true}));
const perDrive = plan => driveList(plan).some(([, d]) => d.pass && Object.values(d.pass).some(s => s && (s.who || s.uid)));
/* Såten som gäller nu: den som pågår, annars nästa som inte är bruten. {did, d, on, n} eller null. */
function planFocus(plan){
  const ds = driveList(plan); if(!ds.length) return null;
  const c = plan.cur, i = c && c.on ? ds.findIndex(([k]) => k === c.did) : -1;
  if(i >= 0) return {did:ds[i][0], d:ds[i][1], on:true, n:i + 1};
  const j = ds.findIndex(([, d]) => !d.done);
  return j < 0 ? null : {did:ds[j][0], d:ds[j][1], on:false, n:j + 1};
}
/* Vem som står var just nu: i såten som gäller om jakten har pass per såt, annars för hela jakten.
   Förbjudna riktningar kommer alltid från stands. {pass: {who, uid, ok, no}} */
function planStands(plan){
  const base = plan.stands || {}, out = {};
  for(const [pid, s] of Object.entries(base)) if(s && s.no) out[pid] = {no:s.no};
  const src = perDrive(plan) ? (((planFocus(plan) || {}).d || {}).pass || {}) : base;
  for(const [pid, s] of Object.entries(src)) if(s && (s.who || s.uid)) out[pid] = Object.assign(out[pid] || {}, {who:s.who, uid:s.uid, ok:s.ok});
  return out;
}
/* Vägarna som gäller nu: de som hör till såten som gäller, och de som inte hör till någon såt. [[id, väg]] */
function focusRoutes(plan){
  const f = planFocus(plan), drives = plan.drives || {};
  return Object.entries(plan.routes || {}).filter(([, r]) => r && ROUTE_KIND[r.kind] && (!r.drive || !drives[r.drive] || (f && r.drive === f.did)));
}
const driveName = d => (d && d.name) || 'Såten';

/* ---------- Passens egenskaper och deltagarnas utrustning ----------
   Ett pass kan vara lättillgängligt (nålen har easy) och ha hagel eller kula som förstahandsval (nålen har ammo).
   Jaktledaren för in vad deltagarna har med sig: groups/<lag>/gear/<uid> = {name, gun:'hagel'|'kula'|'both', easy}.
   Placeras någon på ett pass som inte passar visas en varning, och jaktledaren kan godkänna placeringen ändå (ok). */
const GUN = {hagel:'Hagel', kula:'Kula', both:'Hagel och kula'};
const AMMO = {hagel:'hagel', kula:'kula'};
const gearOf = (g, u) => u ? (((g && g.gear) || {})[u] || null) : null;
function passIssues(g, p, u, name){
  const x = gearOf(g, u), out = []; if(!x || !p) return out;
  const pn = p.name || 'Passet', n = name || x.name || 'Deltagaren';
  if(x.easy && !p.easy) out.push(`${n} behöver ett lättillgängligt pass, men ${pn} är inte markerat som lättillgängligt.`);
  if(p.ammo === 'kula' && x.gun === 'hagel') out.push(`${pn} är ett pass för kula, men ${n} har bara hagel.`);
  if(p.ammo === 'hagel' && x.gun === 'kula') out.push(`${pn} är ett pass för hagel, men ${n} har bara kula.`);
  return out;
}
const passTags = p => [p.easy ? 'lättillgängligt' : '', AMMO[p.ammo] || ''].filter(Boolean).join(' · ');
/* Varning under en tilldelning i planeringen */
function warnHtml(g, p, s){
  const is = s && s.uid ? passIssues(g, p, s.uid, s.who) : [];
  if(!is.length) return '';
  return s.ok ? `<div class="pwarn ok">Godkänd avvikelse: ${esc(is.join(' '))}</div>` : `<div class="pwarn">⚠ ${esc(is.join(' '))}</div>`;
}
/* Lottning: slumpar deltagarna på passen. Den som behöver ett lättillgängligt pass lottas först, sedan den som bara har
   ett vapen, och var och en får i första hand ett pass som passar. {out: {pass: person}, left: [personer utan pass]} */
function lottery(g, passes, people){
  const rnd = n => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  const shuffle = a => { for(let i = a.length - 1; i > 0; i--){ const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pri = u => { const x = gearOf(g, u.uid); return !x ? 2 : x.easy ? 0 : x.gun && x.gun !== 'both' ? 1 : 2; };
  const us = shuffle(people.slice()).sort((a, b) => pri(a) - pri(b)), free = shuffle(passes.slice()), out = {}, left = [];
  for(const u of us){
    if(!free.length){ left.push(u); continue; }
    let i = free.findIndex(p => !passIssues(g, p, u.uid, u.name).length);
    if(i < 0) i = 0;
    out[free[i].id] = u; free.splice(i, 1);
  }
  return {out, left};
}

/* Förbjudna riktningar sparas som en bitmask: bit i = riktningen DIR16[i] (i * 22,5° medurs från norr, ± 11,25°). */
function maskRuns(no){
  no = no || 0; if(!no) return []; if(no === 0xffff) return [[0, 16]];
  let s = 0; while(no & (1 << s)) s++;   // börja på en tillåten riktning så att en sektor över norr hålls ihop
  const runs = []; let cur = null;
  for(let k = 1; k <= 16; k++){
    const i = (s + k) % 16;
    if(no & (1 << i)){ if(cur) cur[1]++; else cur = [i, 1]; }
    else if(cur){ runs.push(cur); cur = null; }
  }
  if(cur) runs.push(cur);
  return runs;
}
/* Riktningarna i läsordning: medurs, sektor för sektor (t.ex. NNV, N, NNO). */
const maskDirs = no => maskRuns(no).flatMap(([i, n]) => Array.from({length:n}, (x, k) => DIR16[(i + k) % 16]));
/* Tårtbit från punkten c, från och till i grader medurs från norr, radie r meter. */
function sectorPts(c, from, to, r){
  const pts = [[c.lat, c.lng]], n = Math.max(2, Math.ceil((to - from) / 5));
  const dLat = r / 111320, dLng = r / (111320 * Math.cos(c.lat * Math.PI / 180));
  for(let k = 0; k <= n; k++){ const a = (from + (to - from) * k / n) * Math.PI / 180; pts.push([c.lat + dLat * Math.cos(a), c.lng + dLng * Math.sin(a)]); }
  return pts;
}
const planLabel = (ll, cls, text) => L.marker(ll, {icon:L.divIcon({className:'plan-lbl ' + cls, html:`<span>${esc(text)}</span>`, iconSize:[0, 0]}), interactive:false, keyboard:false, zIndexOffset:-500});
function routeStyle(kind, pts){
  const k = ROUTE_KIND[kind] || ROUTE_KIND.hund, o = {interactive:false};
  return [L.polyline(pts, Object.assign({color:'#ffffff', weight:6, opacity:.8}, o)), L.polyline(pts, Object.assign({color:k.color, weight:3, dashArray:'2 7', lineCap:'round', className:'plan-route ' + kind}, o))];
}

/* Mitt pass under en pågående jakt, med förbjudna riktningar (för kompassen). {mask, lat, lng} eller null. */
var planMine = null;
function findMyNoFire(){
  let mine = null;
  for(const {g, hid, hunt} of planHunts()){
    if(!huntLive(hunt)) continue;
    for(const [pid, s] of Object.entries(planStands(planOf(g, hid)))){
      if(!s || s.uid !== myUid() || !s.no) continue;
      const p = pinById(pid); if(!p) continue;
      mine = mine ? Object.assign(mine, {mask:mine.mask | s.no}) : {mask:s.no, lat:p.lat, lng:p.lng, name:p.name || 'Pass'};
    }
  }
  return mine;
}
/* Gäller bara nära passet (inom 300 m) eller när positionen inte är känd. */
const NOFIRE_NEAR = 300;
function myNoFireMask(){
  const m = planMine; if(!m) return 0;
  if(myPos && distM(myPos, m) > NOFIRE_NEAR) return 0;
  return m.mask;
}

/* ---------- Incheckning på passet ----------
   Under en pågående jakt checkas man in automatiskt när man är inom CHECK_IN meter från sitt pass, och ut när man är
   längre bort än CHECK_OUT (glappet gör att det inte slår av och på när GPS:en hoppar). Det går också för hand.
   Har man själv sagt att man lämnar passet checkas man inte in automatiskt igen förrän man har varit borta från det. */
const CHECK_IN = 40, CHECK_OUT = 100;
const checkState = {busy:{}, manualOut:{}};
const checkOf = (g, hid, u) => ((g.huntCheck || {})[hid] || {})[u || myUid()] || null;
/* Mina pass i pågående jakter: [{g, hid, p}] */
function myStands(){
  const out = [];
  for(const {g, hid, hunt} of planHunts()){
    if(!huntLive(hunt)) continue;
    for(const [pid, s] of Object.entries(planStands(planOf(g, hid)))){ const p = s && s.uid === myUid() ? pinById(pid) : null; if(p) out.push({g, hid, p}); }
  }
  return out;
}
/* Incheckad på ett pass i en pågående jakt: positionen mäts och skickas då glesare (natGpsWant, gpsPos). */
const checkedIn = () => planHunts().some(({g, hid, hunt}) => huntLive(hunt) && !!(checkOf(g, hid) || {}).in);
function checkSet(g, hid, pid, inside, manual){
  setTimeout(() => { if(typeof powerUpdate === 'function') powerUpdate(); }, 1500);
  const p = pinById(pid), key = g.id + '/' + hid;
  if(manual) checkState.manualOut[key] = !inside;
  checkState.busy[key] = Date.now();
  return fb.db.ref(`groups/${g.id}/huntCheck/${hid}/${myUid()}`).set({pid, in:!!inside, t:Date.now(), name:myName()})
    .then(() => toast(inside ? `Du är incheckad på ${p ? p.name || 'passet' : 'passet'}.` : `Du har checkat ut från ${p ? p.name || 'passet' : 'passet'}.`, 4000))
    .catch(() => { if(manual) toast('Kunde inte checka in. Pågår jakten, och är du tilldelad passet?', 5000); })
    .finally(() => { checkState.busy[key] = 0; });
}
/* Körs vid varje ny position, och när jakter och planer ändras. */
function checkPass(){
  if(!fb || !cloud.user || !myPos) return;
  for(const {g, hid, p} of myStands()){
    const key = g.id + '/' + hid, cur = checkOf(g, hid), d = distM(myPos, p);
    if(checkState.busy[key] && Date.now() - checkState.busy[key] < 10000) continue;
    if(d > CHECK_OUT) checkState.manualOut[key] = false;   // borta från passet: automatiken gäller igen
    const isIn = !!(cur && cur.in && cur.pid === p.id);
    if(!isIn && d <= CHECK_IN && !checkState.manualOut[key]) checkSet(g, hid, p.id, true, false);
    else if(isIn && d > CHECK_OUT) checkSet(g, hid, p.id, false, false);
  }
}
/* Jaktledaren och admin får besked när någon kommer på plats, och när alla tilldelade pass är bemannade. */
function checkNotify(g, hid, prev){
  if(!prev || g.kind !== 'member' || !canLeadGroup(g)) return;   // inte vid första hämtningen
  const now = g.huntCheck[hid] || {}, msgs = [];   // en enda avisering, så att ingen skriver över en annan
  for(const [u, c] of Object.entries(now)){
    if(!c || u === myUid() || !c.in || (prev[u] && prev[u].in && prev[u].pid === c.pid)) continue;
    const p = pinById(c.pid);
    msgs.push(`${c.name || 'En deltagare'} är på plats på ${p ? p.name || 'passet' : 'passet'}.`);
  }
  const hunt = (g.hunts || {})[hid], stands = planStands(planOf(g, hid));
  const assigned = hunt ? planPasses(g, hunt).filter(p => stands[p.id] && stands[p.id].uid) : [];
  const manned = list => assigned.every(p => Object.values(list).some(c => c && c.in && c.pid === p.id));
  if(assigned.length && manned(now) && !manned(prev)) msgs.push(`Alla ${assigned.length} pass är bemannade.`);
  if(msgs.length) toast(msgs.join(' '), 6000);
}
/* Status för ett pass i jaktkortet: på plats, lämnat, och när personen senast hördes av (positionen). */
function checkText(g, hid, p, s){
  if(!s || !s.uid) return '';
  const c = checkOf(g, hid, s.uid), pos = ((g.huntPos || {})[hid] || {})[s.uid];
  let t = '';
  if(c && c.pid === p.id) t = c.in ? ` <span class="check-ok">✓ på plats ${esc(fmtClock(c.t))}</span>` : ` <span class="check-out">lämnade ${esc(fmtClock(c.t))}</span>`;
  else t = ' <span class="muted">ej incheckad</span>';
  if(pos && pos.t) t += ` <span class="muted">· hörd ${esc(ago(pos.t))}</span>`;
  return t;
}

/* ---------- Planen på kartan ---------- */
function renderPlan(){
  if(!planLayer) planLayer = L.layerGroup().addTo(map);
  planLayer.clearLayers();
  planMine = findMyNoFire();
  if(typeof renderCompass === 'function') renderCompass();
  renderDriveBar();
  if(!planOn()) return;
  const pins = new Map(state.pins.map(p => [p.id, p]));
  for(const {g, hid, hunt} of planHunts()){
    const plan = planOf(g, hid), f = planFocus(plan), live = huntLive(hunt);
    driveList(plan).forEach(([did, d], i) => {
      const ring = parseBorder(d.ring); if(ring.length < 3) return;
      const focus = f && f.did === did, style = focus ? Object.assign({}, DRIVE_STYLE, {weight:3.5, fillOpacity:.14}) : d.done ? {color:'#64748b', weight:1.5, dashArray:'4 6', fillColor:'#94a3b8', fillOpacity:.04} : Object.assign({}, DRIVE_STYLE, {weight:2, fillOpacity:.05});
      L.polygon(ring, Object.assign({interactive:false, className:'plan-drive' + (focus ? ' focus' : d.done ? ' done' : '')}, style)).addTo(planLayer);
      planLabel(L.latLngBounds(ring).getCenter(), 'drive' + (focus ? ' focus' : d.done ? ' done' : ''), `${i + 1}. ${driveName(d)}${focus && f.on ? ' · pågår' : d.done ? ' · bruten' : ''}`).addTo(planLayer);
    });
    for(const [, r] of focusRoutes(plan)){
      const pts = parseBorder(r.pts), k = ROUTE_KIND[r.kind]; if(pts.length < 2) continue;
      routeStyle(r.kind, pts).forEach(l => l.addTo(planLayer));
      planLabel(pts[0], 'route ' + r.kind + (r.uid && r.uid === myUid() ? ' me' : ''), k.name + (r.who ? ': ' + r.who : '')).addTo(planLayer);
    }
    for(const [pid, s] of Object.entries(planStands(plan))){
      const p = pins.get(pid); if(!p) continue;
      for(const [i, n] of maskRuns(s.no)){
        const from = i * 22.5 - 11.25;
        L.polygon(sectorPts(p, from, from + n * 22.5, PLAN_R), {color:'#dc2626', weight:1, opacity:.8, fillColor:'#dc2626', fillOpacity:.28, interactive:false, className:'plan-nofire'}).addTo(planLayer);
      }
      const cin = s.uid && checkOf(g, hid, s.uid), isIn = !!(cin && cin.in && cin.pid === pid);
      if(s.who) planLabel([p.lat, p.lng], 'who' + (s.uid && s.uid === myUid() ? ' me' : '') + (isIn ? ' in' : ''), s.who).addTo(planLayer);
    }
    // Samlingsplatser. Den man har kallats till är markerad.
    const call = live ? activeCall(plan) : null;
    for(const [mid, m] of Object.entries(plan.meets || {})){
      if(!m || typeof m.lat !== 'number') continue;
      const on = !!call && call.mid === mid;
      L.marker([m.lat, m.lng], {icon:L.divIcon({className:'meet-icon' + (on ? ' on' : ''), html:`<span class="meet-dot">⚑</span><span class="meet-name">${esc(m.name)}</span>`, iconSize:[28, 28], iconAnchor:[14, 14]}), keyboard:false, zIndexOffset:on ? 1500 : 0})
        .on('click', () => openMeet(m.name, m.lat, m.lng, on)).addTo(planLayer);
    }
  }
}
function openMeet(name, lat, lng, called){
  openModal(`<h2>${called ? 'Återsamling vid ' : 'Samlingsplats: '}${esc(name)}</h2>
    <p class="small muted">${fmtLatLng(lat, lng)} · SWEREF 99 TM ${fmtSweref(lat, lng)}${myPos ? ` · ${esc(fmtDist(distM(myPos, {lat, lng})))} härifrån` : ''}</p>
    <div class="actions"><a class="btn primary grow" href="${esc(navUrl(lat, lng))}" target="_blank" rel="noopener">${ICON_NAV}Navigera</a><button class="btn ghost" type="button" id="meetClose">Stäng</button></div>`, m => m.querySelector('#meetClose').addEventListener('click', closeModal));
}
/* Återsamlingen gäller tills nästa såt startar. */
const activeCall = plan => { const c = plan.cur, call = plan.call; return call && (!c || !c.on || call.t >= c.t) ? call : null; };

/* ---------- Raden överst: såten har startat, är bruten, eller återsamling ----------
   Syns för alla i en pågående jakt, även för den som inte har öppnat Jakt-fliken. Går att stänga. */
const driveBar = {hide:{}};
function driveEvent(){
  let ev = null; const now = Date.now();
  for(const {g, hid, hunt} of planHunts()){
    if(!huntLive(hunt)) continue;
    const plan = planOf(g, hid), c = plan.cur, call = activeCall(plan);
    let e = null;
    if(call && now - call.t < 2 * 3600000) e = {key:`${hid}/call/${call.t}`, t:call.t, kind:'call', call};
    else if(c && !c.on && now - c.t < 20 * 60000) e = {key:`${hid}/stop/${c.t}`, t:c.t, kind:'stop'};
    else if(c && c.on && now - c.t < 15 * 60000) e = {key:`${hid}/start/${c.t}`, t:c.t, kind:'start', plan};
    if(e && (!ev || e.t > ev.t)) ev = e;
  }
  return ev;
}
function renderDriveBar(){
  const bar = document.getElementById('driveBar'); if(!bar) return;
  const ev = driveEvent();
  if(!ev || driveBar.hide[ev.key]){ bar.hidden = true; return; }
  let h = '';
  if(ev.kind === 'stop') h = `<b>Såten är bruten, patron ur.</b> <span>${esc(fmtClock(ev.t))}</span>`;
  else if(ev.kind === 'call') h = `<b>Återsamling vid ${esc(ev.call.name)}.</b> <a href="${esc(navUrl(ev.call.lat, ev.call.lng))}" target="_blank" rel="noopener" id="driveNav">${ICON_NAV}Navigera</a> <button type="button" data-db="show">Visa</button>`;
  else {
    const f = planFocus(ev.plan), st = planStands(ev.plan), mine = Object.entries(st).filter(([, s]) => s.uid === myUid()).map(([pid]) => pinById(pid)).filter(Boolean);
    const myRoute = focusRoutes(ev.plan).find(([, r]) => r.uid === myUid());
    h = `<b>${esc(driveName(f && f.d))} har startat.</b> ${mine.length ? `Ditt pass: <b>${esc(mine.map(p => p.name || 'Pass').join(', '))}</b> <button type="button" data-db="pass" data-p="${esc(mine[0].id)}">Visa</button>` : myRoute ? `Du går som ${esc(ROUTE_KIND[myRoute[1].kind].name.toLowerCase())}.` : ''}`;
  }
  bar.innerHTML = `<span class="db-t">${h}</span><button type="button" class="x" data-db="x" aria-label="Stäng">×</button>`;
  bar.dataset.key = ev.key; bar.className = 'drivebar ' + ev.kind; bar.hidden = false;
  if(ev.kind === 'call') bar.dataset.ll = ev.call.lat + ',' + ev.call.lng;
}
$('#driveBar').addEventListener('click', e => {
  const b = e.target.closest('[data-db]'), bar = $('#driveBar'); if(!b) return;
  if(b.dataset.db === 'x'){ driveBar.hide[bar.dataset.key] = true; renderDriveBar(); }
  else if(b.dataset.db === 'pass') gotoPin(b.dataset.p);
  else if(b.dataset.db === 'show'){ const [la, ln] = (bar.dataset.ll || '').split(',').map(Number); if(isFinite(la)){ map.setView([la, ln], Math.max(map.getZoom(), 16)); if(!isDesktop()) setSheet('peek'); } }
});
setInterval(renderDriveBar, 30000);
/* Körs när planen ändras i molnet: en ny händelse visas på raden överst, och telefonen vibrerar när såten bryts eller
   när det är återsamling. prev är förra läget (undefined första gången: då larmar inget). */
function planOnData(g, prev){
  if(prev === undefined) return;
  for(const [hid, plan] of Object.entries(g.huntPlan || {})){
    const old = (prev || {})[hid] || {}, c = plan && plan.cur, oc = old.cur, call = plan && plan.call, ocall = old.call;
    const newStop = c && !c.on && (!oc || oc.t !== c.t || oc.on), newCall = call && (!ocall || ocall.t !== call.t), newStart = c && c.on && (!oc || oc.t !== c.t || !oc.on);
    if(newStop || newCall){ try { if(navigator.vibrate) navigator.vibrate([400, 150, 400]); } catch(e){} }
    else if(newStart){ try { if(navigator.vibrate) navigator.vibrate(200); } catch(e){} }
  }
}

/* ---------- Planen i jaktkortet ---------- */
function driveCardHtml(g, hid, plan, ds, f, live, lead){
  let h = `<div class="drive-list">${ds.map(([did, d], i) => {
    const on = f && f.did === did && f.on, next = f && f.did === did && !f.on;
    return `<div class="drive-li${on ? ' on' : next ? ' next' : d.done ? ' done' : ''}"><span class="dn">${i + 1}</span><span>${esc(driveName(d))}</span><span class="small muted">${on ? 'pågår sedan ' + esc(fmtClock(plan.cur.t)) : d.done ? 'bruten ' + esc(fmtClock(d.done)) : next ? 'nästa' : ''}</span></div>`;
  }).join('')}</div>`;
  const c = plan.cur, call = activeCall(plan);
  if(live && call) h += `<div class="drive-msg call">Återsamling vid <b>${esc(call.name)}</b> <span class="muted">${esc(fmtClock(call.t))}</span> <a class="btn sm" href="${esc(navUrl(call.lat, call.lng))}" target="_blank" rel="noopener">${ICON_NAV}Navigera</a></div>`;
  else if(live && c && !c.on && Date.now() - c.t < 60 * 60000) h += `<div class="drive-msg stop">Såten är bruten, patron ur. <span class="muted">${esc(fmtClock(c.t))}</span></div>`;
  if(lead && live){
    const meets = Object.entries(plan.meets || {}).filter(([, m]) => m);
    h += `<div class="btnrow" style="margin-top:6px">${f && f.on ? `<button class="btn sm danger" type="button" data-j="drive-stop" data-g="${esc(g.id)}" data-h="${esc(hid)}">Bryt såten</button>`
      : f ? `<button class="btn sm primary" type="button" data-j="drive-start" data-g="${esc(g.id)}" data-h="${esc(hid)}" data-d="${esc(f.did)}">Starta ${esc(driveName(f.d))}</button>` : ''}
      ${!(f && f.on) ? meets.map(([mid, m]) => `<button class="btn sm" type="button" data-j="drive-call" data-g="${esc(g.id)}" data-h="${esc(hid)}" data-m="${esc(mid)}">Återsamling vid ${esc(m.name)}</button>`).join('') : ''}</div>`;
  }
  return h;
}
function planCardHtml(g, hid, hunt, lead){
  const plan = planOf(g, hid), stands = planStands(plan), passes = planPasses(g, hunt), ds = driveList(plan), f = planFocus(plan), live = huntLive(hunt);
  const shown = passes.filter(p => stands[p.id] && (stands[p.id].who || stands[p.id].no));
  const routes = focusRoutes(plan).map(([, r]) => r);
  if(!lead && !shown.length && !routes.length && !ds.length) return '';
  const me = myUid(), mine = passes.filter(p => stands[p.id] && stands[p.id].uid === me), myRoutes = routes.filter(r => r.uid === me);
  const inDrive = ds.length && perDrive(plan) && f ? (f.on ? ` i ${esc(driveName(f.d))}` : ` i nästa såt, ${esc(driveName(f.d))}`) : '';
  let h = `<div class="lbl">Jaktplan</div>`;
  if(ds.length) h += driveCardHtml(g, hid, plan, ds, f, live, lead);
  if(mine.length){
    const c = checkOf(g, hid), isIn = !!(c && c.in && mine.some(p => p.id === c.pid));
    h += `<div class="plan-mine">Ditt pass${inDrive}: <b>${mine.map(p => esc(p.name || 'Pass')).join(', ')}</b>${maskDirs(stands[mine[0].id].no).length ? `. Skjut inte mot ${maskDirs(stands[mine[0].id].no).join(', ')}.` : ''} <button class="linkbtn" type="button" data-j="plan-go" data-g="${esc(g.id)}" data-p="${esc(mine[0].id)}">Visa</button>
      ${live ? `<div class="check-row">${isIn ? `<span class="check-ok">✓ Incheckad ${esc(fmtClock(c.t))}</span> <button class="btn sm ghost" type="button" data-j="check-out" data-g="${esc(g.id)}" data-h="${esc(hid)}" data-p="${esc(c.pid)}">Lämnar passet</button>`
        : `<button class="btn sm primary" type="button" data-j="check-in" data-g="${esc(g.id)}" data-h="${esc(hid)}" data-p="${esc(mine[0].id)}">Jag är på passet</button> <span class="small muted">Du checkas in automatiskt inom ${CHECK_IN} m.</span>`}</div>` : ''}</div>`;
  }
  for(const r of myRoutes) h += `<div class="plan-mine">Du går som <b>${ROUTE_KIND[r.kind].name.toLowerCase()}</b>${inDrive}.</div>`;
  if(shown.length) h += `<div class="small plan-list">${shown.map(p => { const s = stands[p.id], no = maskDirs(s.no);
    return `<div><span>${esc(p.name || 'Pass')}</span>: ${s.who ? `<b>${esc(s.who)}</b>` : '<span class="muted">ingen</span>'}${no.length ? ` <span class="muted">· ej mot ${no.join(', ')}</span>` : ''}${live ? checkText(g, hid, p, s) : ''}</div>`; }).join('')}</div>`;
  if(routes.length) h += `<div class="small plan-list">${routes.map(r => `<div>${ROUTE_KIND[r.kind].name}: ${r.who ? `<b>${esc(r.who)}</b>` : '<span class="muted">ingen</span>'} <span class="muted">· ${fmtDist(lineLen(parseBorder(r.pts)))}</span></div>`).join('')}</div>`;
  const set = passes.filter(p => stands[p.id] && stands[p.id].who).length;
  const withUid = passes.filter(p => stands[p.id] && stands[p.id].uid), manned = withUid.filter(p => { const c = checkOf(g, hid, stands[p.id].uid); return c && c.in && c.pid === p.id; }).length;
  h += `<div class="small muted">${set} av ${passes.length} pass tillsatta${live && withUid.length ? ` · ${manned} av ${withUid.length} på plats` : ''} · ${ds.length} ${ds.length === 1 ? 'såt' : 'såtar'} · ${routes.length} ${routes.length === 1 ? 'väg' : 'vägar'}</div>`;
  if(lead) h += `<div class="btnrow" style="margin-top:6px"><button class="btn sm" type="button" data-j="plan" data-g="${esc(g.id)}" data-h="${esc(hid)}">Planera</button></div>`;
  return h;
}

/* ---------- Planera (jaktledare och admin) ---------- */
const planRef = (g, hid, sub) => fb.db.ref(`groups/${g.id}/huntPlan/${hid}${sub ? '/' + sub : ''}`);
function openPlan(g, hid){
  if(planUi.gid !== g.id || planUi.hid !== hid) planUi.open = {};
  planUi.gid = g.id; planUi.hid = hid;
  openModal(`<h2>Planera jakten</h2><div id="planBody"></div>
    <div class="actions"><button class="btn primary grow" type="button" id="plClose">Klar</button></div>`, m => {
    m.querySelector('#plClose').addEventListener('click', closeModal);
    m.addEventListener('change', planChange);
    m.addEventListener('click', planClick);
    m.addEventListener('toggle', e => { const d = e.target.closest && e.target.closest('details.drive-box'); if(d) planUi.open[d.dataset.d] = d.open; }, true);
    planBodyRender(true);
  });
}
function planCtx(){ const g = cloud.groups[planUi.gid], hunt = g && (g.hunts || {})[planUi.hid]; return hunt ? {g, hid:planUi.hid, hunt, plan:planOf(g, planUi.hid)} : null; }
function planBodyRender(force){
  const body = document.getElementById('planBody'); if(!body) return;
  // Rita inte om medan man skriver i dialogen (en uppdatering från molnet skulle annars ta bort det man skrivit).
  if(!force && body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type !== 'checkbox') return;
  const c = planCtx();
  if(!c){ body.innerHTML = '<div class="empty">Jakten finns inte längre.</div>'; return; }
  const {g, hid, hunt, plan} = c, passes = planPasses(g, hunt), people = planPeople(g, hid), ds = driveList(plan), f = planFocus(plan), live = huntLive(hunt);
  const opts = (who, u) => {
    let found = false;
    const o = people.map(p => { const sel = !!u && p.uid === u; if(sel) found = true; return `<option value="u:${esc(p.uid)}"${sel ? ' selected' : ''}>${esc(p.label)}</option>`; }).join('');
    return `<option value="">Ingen</option>${o}${who && !found ? `<option value="n" selected>${esc(who)}</option>` : ''}<option value="__name">Annat namn …</option>`;
  };
  const now = Date.now(), upcoming = !live && hunt.expires > now;
  let h = `<p class="note" style="margin-top:0"><b>${esc(hunt.name)}</b> · ${upcoming ? (hunt.manual ? 'planerad' : 'startar ' + esc(fmtTime(hunt.starts))) : 'pågår'}. Planen syns för alla i jakten, även gästerna, och tas bort när jakten avslutas.</p>`;
  // Pass: egenskaper, förbjudna riktningar, och vem som står var när jakten inte är uppdelad i såtar
  h += `<h3 class="sec">Pass</h3><p class="note" style="margin-top:0">${ds.length ? 'Vem som står var väljs för varje såt längre ned.' : 'Vem som står var gäller hela jakten. Rita såtar längre ned för att dela upp jakten.'} Lättillgängligt och hagel eller kula sparas på passet och gäller i alla jakter.</p>`;
  if(!passes.length) h += `<p class="note" style="margin-top:0">Det finns inga pass i jaktens områden. Lägg ut nålar av typen Pass i ett område som delas med laget.</p>`;
  for(const p of passes){
    const s = (plan.stands || {})[p.id] || {}, no = maskDirs(s.no), ed = canEditPin(p) ? '' : ' disabled';
    h += `<div class="plan-pass"><div class="pp-h"><b>${esc(p.name || 'Pass')}</b>
        <label class="pp-easy"><input type="checkbox" data-pl="easy" data-p="${esc(p.id)}"${p.easy ? ' checked' : ''}${ed}> Lättillgängligt</label>
        <select class="input pp-ammo" data-pl="ammo" data-p="${esc(p.id)}" aria-label="Hagel eller kula på ${esc(p.name || 'passet')}"${ed}><option value="">Hagel eller kula</option><option value="hagel"${p.ammo === 'hagel' ? ' selected' : ''}>Hagel</option><option value="kula"${p.ammo === 'kula' ? ' selected' : ''}>Kula</option></select></div>
      <div class="plan-row">${ds.length ? '<span></span><span></span>' : `<span class="pr-name small muted">Står här</span><select class="input" data-pl="who" data-p="${esc(p.id)}" aria-label="Vem står på ${esc(p.name || 'passet')}">${opts(s.who, s.uid)}</select>`}
        <button class="btn sm${no.length ? ' nofire' : ''}" type="button" data-pl="dirs" data-p="${esc(p.id)}">${no.length ? 'Ej mot ' + no.join(', ') : 'Skjutriktningar'}</button></div>
      ${ds.length ? '' : warnHtml(g, p, s)}</div>`;
  }
  if(!ds.length && passes.length) h += `<div class="btnrow"><button class="btn sm" type="button" data-pl="lot">Lotta pass</button></div>`;
  // Deltagarnas utrustning
  h += `<h3 class="sec">Deltagare</h3><p class="note" style="margin-top:0">Vapen och behov av lättillgängligt pass används när du placerar och lottar. Bara jaktledare och admin ser det.</p>`;
  for(const u of people){
    const x = gearOf(g, u.uid) || {};
    h += `<div class="plan-row gear-row" data-u="${esc(u.uid)}" data-n="${esc(u.name)}"><span class="pr-name">${esc(u.label)}</span>
      <select class="input" data-pl="gun" aria-label="Vapen för ${esc(u.name)}"><option value="">Vapen?</option>${Object.entries(GUN).map(([k, v]) => `<option value="${k}"${x.gun === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
      <label class="pp-easy"><input type="checkbox" data-pl="geasy"${x.easy ? ' checked' : ''}> Behöver lättillgängligt pass</label></div>`;
  }
  // Såtar i ordning, var och en med egna pass och vägar
  h += `<h3 class="sec">Såtar</h3>`;
  if(!ds.length) h += `<p class="note" style="margin-top:0">Ingen såt är ritad. Med såtar drivs jakten såt för såt, med egna pass och vägar i varje såt. Du startar och bryter såtarna under jakten.</p>`;
  else if(!perDrive(plan) && Object.values(plan.stands || {}).some(s => s && s.who)) h += `<p class="note" style="margin-top:0">Passen är tilldelade för hela jakten. Tilldelar du pass i en såt gäller såtarnas pass i stället.</p>`;
  ds.forEach(([did, d], i) => {
    const st = f && f.did === did ? (f.on ? 'on' : 'next') : d.done ? 'done' : '', pass = d.pass || {};
    const set = passes.filter(p => pass[p.id] && (pass[p.id].who || pass[p.id].uid)).length;
    const open = did in planUi.open ? planUi.open[did] : (st === 'on' || st === 'next');
    const routes = Object.entries(plan.routes || {}).filter(([, r]) => r && ROUTE_KIND[r.kind] && r.drive === did);
    h += `<details class="drive-box${st ? ' ' + st : ''}" data-d="${esc(did)}"${open ? ' open' : ''}><summary><span class="dn">${i + 1}</span><b>${esc(driveName(d))}</b> <span class="small muted">${set} av ${passes.length} pass${routes.length ? ' · ' + routes.length + (routes.length === 1 ? ' väg' : ' vägar') : ''}</span>${st ? `<span class="tag${st === 'on' ? ' on' : ''}">${st === 'on' ? 'Pågår' : st === 'next' ? 'Nästa' : 'Bruten'}</span>` : ''}</summary>
      <div class="drive-name-row"><input class="input" data-pl="dname" data-d="${esc(did)}" maxlength="60" value="${esc(d.name || '')}" aria-label="Namn på såten">
        <button class="iconbtn" type="button" data-pl="up" data-d="${esc(did)}" aria-label="Flytta upp"${i === 0 ? ' disabled' : ''}>↑</button><button class="iconbtn" type="button" data-pl="down" data-d="${esc(did)}" aria-label="Flytta ned"${i === ds.length - 1 ? ' disabled' : ''}>↓</button></div>
      <div class="btnrow">${live ? (st === 'on' ? `<button class="btn sm danger" type="button" data-pl="drive-stop">Bryt såten</button>` : `<button class="btn sm primary" type="button" data-pl="drive-start" data-d="${esc(did)}">Starta såten</button>`) : ''}
        <button class="btn sm" type="button" data-pl="drive-draw" data-d="${esc(did)}">Ändra ytan</button><span class="small muted">${fmtHa(areaHa(parseBorder(d.ring)))}</span>
        <button class="iconbtn" type="button" data-pl="drive-del" data-d="${esc(did)}" aria-label="Ta bort ${esc(driveName(d))}">${ICON_TRASH}</button></div>
      <div class="lbl">Pass i såten</div>
      ${passes.map(p => { const s = pass[p.id] || {}, tags = passTags(p);
        return `<div class="plan-row"><span class="pr-name">${esc(p.name || 'Pass')}${tags ? `<br><span class="small muted">${esc(tags)}</span>` : ''}</span><select class="input" data-pl="dwho" data-d="${esc(did)}" data-p="${esc(p.id)}" aria-label="Vem står på ${esc(p.name || 'passet')} i ${esc(driveName(d))}">${opts(s.who, s.uid)}</select></div>${warnHtml(g, p, s)}`; }).join('')}
      <div class="btnrow"><button class="btn sm" type="button" data-pl="lot" data-d="${esc(did)}">Lotta pass</button>${i > 0 ? `<button class="btn sm" type="button" data-pl="copy" data-d="${esc(did)}" data-from="${esc(ds[i - 1][0])}">Samma pass som såt ${i}</button>` : ''}</div>
      <div class="lbl">Hundförare och drevkarlar</div>
      ${routes.map(([rid, r]) => routeRow(rid, r, opts)).join('') || '<p class="small muted" style="margin:0">Ingen väg är ritad i den här såten.</p>'}
      <div class="btnrow"><button class="btn sm" type="button" data-pl="route-draw" data-k="hund" data-d="${esc(did)}">Rita väg för hundförare</button><button class="btn sm" type="button" data-pl="route-draw" data-k="drev" data-d="${esc(did)}">Rita väg för drevkarl</button></div></details>`;
  });
  h += `<div class="btnrow"><button class="btn sm" type="button" data-pl="drive-draw">Rita såt</button></div>`;
  // Vägar som inte hör till en såt (jakter utan såtar, eller vägar ritade innan jakten delades upp)
  const loose = Object.entries(plan.routes || {}).filter(([, r]) => r && ROUTE_KIND[r.kind] && (!r.drive || !(plan.drives || {})[r.drive]));
  if(!ds.length || loose.length){
    h += `<h3 class="sec">Hundförare och drevkarlar${ds.length ? ' (hela jakten)' : ''}</h3>`;
    if(!loose.length) h += `<p class="note" style="margin-top:0">Rita hur hundförare och drevkarlar ska gå.</p>`;
    h += loose.map(([rid, r]) => routeRow(rid, r, opts)).join('');
    if(!ds.length) h += `<div class="btnrow"><button class="btn sm" type="button" data-pl="route-draw" data-k="hund">Rita väg för hundförare</button><button class="btn sm" type="button" data-pl="route-draw" data-k="drev">Rita väg för drevkarl</button></div>`;
  }
  // Samlingsplatser
  h += `<h3 class="sec">Samlingsplatser</h3><p class="note" style="margin-top:0">Efter en bruten såt kan du kalla alla till en samlingsplats. De får en hänvisning att navigera dit.</p>`;
  for(const [mid, m] of Object.entries(plan.meets || {}).filter(([, m]) => m)){
    h += `<div class="drive-name-row"><input class="input" data-pl="mname" data-m="${esc(mid)}" maxlength="60" value="${esc(m.name)}" aria-label="Namn på samlingsplatsen">
      <button class="btn sm" type="button" data-pl="meet-move" data-m="${esc(mid)}">Flytta</button>${live && !(f && f.on) ? `<button class="btn sm primary" type="button" data-pl="meet-call" data-m="${esc(mid)}">Kalla hit</button>` : ''}
      <button class="iconbtn" type="button" data-pl="meet-del" data-m="${esc(mid)}" aria-label="Ta bort ${esc(m.name)}">${ICON_TRASH}</button></div>`;
  }
  h += `<div class="btnrow"><button class="btn sm" type="button" data-pl="meet-add">Lägg till samlingsplats</button></div>`;
  body.innerHTML = h;
}
function routeRow(rid, r, opts){
  return `<div class="plan-row"><span class="pr-name"><span class="route-dot ${r.kind}"></span>${ROUTE_KIND[r.kind].name}<br><span class="small muted">${fmtDist(lineLen(parseBorder(r.pts)))}</span></span>
    <select class="input" data-pl="rwho" data-r="${esc(rid)}" aria-label="Vem går som ${ROUTE_KIND[r.kind].name.toLowerCase()}">${opts(r.who, r.uid)}</select>
    <button class="btn sm" type="button" data-pl="route-draw" data-r="${esc(rid)}" data-k="${esc(r.kind)}">Ändra</button>
    <button class="iconbtn" type="button" data-pl="route-del" data-r="${esc(rid)}" aria-label="Ta bort vägen">${ICON_TRASH}</button></div>`;
}
/* Vem: '' = ingen, 'u:<uid>' = deltagare, 'n' = oförändrat eget namn, '__name' = skriv ett namn.
   pass: passet när det gäller en passtilldelning. Passar inte passet personen visas en varning först. */
function planWho(c, val, path, row, pass){
  if(val === 'n') return;
  if(val === '__name'){
    const sel = row.querySelector('select[data-pl]'); sel.hidden = true;
    const inp = h(`<input class="input" data-pl="${sel.dataset.pl}-name" maxlength="60" placeholder="Namn" aria-label="Namn">`);
    sel.after(inp); inp.focus();
    return;
  }
  const u = val.startsWith('u:') ? val.slice(2) : null, p = u && planPeople(c.g, c.hid).find(x => x.uid === u);
  const v = {who:p ? p.name : null, uid:p ? u : null};
  if(pass) v.ok = null;
  const issues = pass && p ? passIssues(c.g, pass, u, p.name) : [];
  if(!issues.length){ planRef(c.g, c.hid, path).update(v).catch(fail()); return; }
  openModal(`<h2>Passar passet?</h2>${issues.map(t => `<p class="pwarn">⚠ ${esc(t)}</p>`).join('')}<p class="note">Vill du placera ${esc(p.name)} på ${esc(pass.name || 'passet')} ändå?</p>
    <div class="actions"><button class="btn primary grow" type="button" id="pwOk">Placera ändå</button><button class="btn ghost" type="button" id="pwNo">Avbryt</button></div>`, m => {
    m.querySelector('#pwOk').addEventListener('click', () => { planRef(c.g, c.hid, path).update(Object.assign(v, {ok:true})).then(() => toast(`${p.name} är placerad på ${pass.name || 'passet'}.`)).catch(fail()); openPlan(c.g, c.hid); });
    m.querySelector('#pwNo').addEventListener('click', () => openPlan(c.g, c.hid));
  });
}
function planChange(e){
  const t = e.target, c = planCtx(); if(!c || !t.dataset.pl) return;
  const row = t.closest('.plan-row'), k = t.dataset.pl;
  if(k === 'who') planWho(c, t.value, 'stands/' + t.dataset.p, row, pinById(t.dataset.p));
  else if(k === 'dwho') planWho(c, t.value, `drives/${t.dataset.d}/pass/${t.dataset.p}`, row, pinById(t.dataset.p));
  else if(k === 'rwho') planWho(c, t.value, 'routes/' + t.dataset.r, row);
  else if(k === 'who-name' || k === 'rwho-name' || k === 'dwho-name'){
    const sel = row.querySelector('select[data-pl]'), v = t.value.trim().slice(0, 60);
    const path = k === 'who-name' ? 'stands/' + sel.dataset.p : k === 'dwho-name' ? `drives/${sel.dataset.d}/pass/${sel.dataset.p}` : 'routes/' + sel.dataset.r;
    if(v) planRef(c.g, c.hid, path).update(k === 'rwho-name' ? {who:v, uid:null} : {who:v, uid:null, ok:null}).then(() => planBodyRender(true)).catch(fail()); else planBodyRender(true);
  }
  else if(k === 'dname'){ const v = t.value.trim().slice(0, 60); if(v) planRef(c.g, c.hid, 'drives/' + t.dataset.d + '/name').set(v).catch(fail()); }
  else if(k === 'mname'){ const v = t.value.trim().slice(0, 60); if(v) planRef(c.g, c.hid, 'meets/' + t.dataset.m + '/name').set(v).catch(fail()); }
  else if(k === 'easy' || k === 'ammo'){
    const p = pinById(t.dataset.p); if(!p || !canEditPin(p)) return;
    if(k === 'easy'){ if(t.checked) p.easy = true; else delete p.easy; }
    else if(AMMO[t.value]) p.ammo = t.value; else delete p.ammo;
    p.updated = Date.now(); save(); scheduleRender();
  }
  else if(k === 'gun' || k === 'geasy'){
    const r = t.closest('.gear-row'), gun = r.querySelector('[data-pl="gun"]').value, easy = r.querySelector('[data-pl="geasy"]').checked;
    const v = {name:r.dataset.n.slice(0, 60)}; if(GUN[gun]) v.gun = gun; if(easy) v.easy = true;
    fb.db.ref(`groups/${c.g.id}/gear/${r.dataset.u}`).set(v).catch(fail());
  }
}
function planClick(e){
  const b = e.target.closest('[data-pl]'); if(!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
  const c = planCtx(); if(!c) return;
  const k = b.dataset.pl;
  if(k === 'dirs') openDirs(c.g, c.hid, b.dataset.p);
  else if(k === 'drive-draw') planDrawDrive(c.g, c.hid, b.dataset.d);
  else if(k === 'route-draw') planDrawRoute(c.g, c.hid, b.dataset.k, b.dataset.r, b.dataset.d);
  else if(k === 'drive-del') confirmClick(b, 'Bekräfta', () => {
    const up = {['drives/' + b.dataset.d]: null};
    for(const [rid, r] of Object.entries(c.plan.routes || {})) if(r && r.drive === b.dataset.d) up['routes/' + rid] = null;
    if(c.plan.cur && c.plan.cur.did === b.dataset.d) up.cur = null;
    planRef(c.g, c.hid).update(up).catch(fail());
  });
  else if(k === 'route-del') confirmClick(b, 'Bekräfta', () => planRef(c.g, c.hid, 'routes/' + b.dataset.r).remove().catch(fail()));
  else if(k === 'up' || k === 'down') driveMove(c, b.dataset.d, k === 'up' ? -1 : 1);
  else if(k === 'drive-start') driveStart(c.g, c.hid, b.dataset.d);
  else if(k === 'drive-stop') confirmClick(b, 'Bekräfta: bryt såten', () => driveStop(c.g, c.hid));
  else if(k === 'lot') openLottery(c.g, c.hid, b.dataset.d);
  else if(k === 'copy'){
    const from = ((c.plan.drives || {})[b.dataset.from] || {}).pass || null, has = Object.keys(((c.plan.drives || {})[b.dataset.d] || {}).pass || {}).length;
    const go = () => planRef(c.g, c.hid, `drives/${b.dataset.d}/pass`).set(from).then(() => toast('Passen är kopierade.')).catch(fail());
    if(has) confirmClick(b, 'Ersätt passen?', go); else go();
  }
  else if(k === 'meet-add') meetAdd(c.g, c.hid);
  else if(k === 'meet-move') meetPlace(c.g, c.hid, b.dataset.m);
  else if(k === 'meet-call') driveCall(c.g, c.hid, b.dataset.m);
  else if(k === 'meet-del') confirmClick(b, 'Bekräfta', () => planRef(c.g, c.hid, 'meets/' + b.dataset.m).remove().catch(fail()));
}
/* Ordningen på såtarna: flytta en såt ett steg upp eller ned. Alla såtar får nya ordningsnummer. */
function driveMove(c, did, dir){
  const ids = driveList(c.plan).map(([k]) => k), i = ids.indexOf(did), j = i + dir;
  if(i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  const up = {}; ids.forEach((k, n) => { up[`drives/${k}/ord`] = n; });
  planRef(c.g, c.hid).update(up).catch(fail());
}
/* Lotta pass: i en såt (did) eller för hela jakten. Valda pass lottas på valda deltagare. Den som lottas tas bort från
   pass som inte var med i lottningen, så att ingen står på två pass. */
function openLottery(g, hid, did){
  const hunt = (g.hunts || {})[hid]; if(!hunt) return;
  const plan = planOf(g, hid), passes = planPasses(g, hunt), people = planPeople(g, hid), d = did ? (plan.drives || {})[did] : null;
  const cur = d ? (d.pass || {}) : (plan.stands || {}), used = passes.filter(p => cur[p.id] && (cur[p.id].who || cur[p.id].uid));
  const defP = new Set((used.length ? used : passes).map(p => p.id));
  openModal(`<h2>Lotta pass</h2><p class="note" style="margin-top:0">${d ? esc(driveName(d)) : 'Hela jakten'}. Välj vilka pass och vilka deltagare som är med. Den som behöver ett lättillgängligt pass, eller bara har hagel eller kula, får i första hand ett pass som passar.</p>
    <div class="field"><span>Pass</span>${passes.map(p => `<label class="checkline"><input type="checkbox" data-lp="${esc(p.id)}"${defP.has(p.id) ? ' checked' : ''}><span>${esc(p.name || 'Pass')}${passTags(p) ? ` <span class="small muted">${esc(passTags(p))}</span>` : ''}</span></label>`).join('')}</div>
    <div class="field"><span>Deltagare</span>${people.map(u => { const x = gearOf(g, u.uid); return `<label class="checkline"><input type="checkbox" data-lu="${esc(u.uid)}"${u.going ? ' checked' : ''}><span>${esc(u.label)}${x ? ` <span class="small muted">${esc([GUN[x.gun] || '', x.easy ? 'lättillgängligt pass' : ''].filter(Boolean).join(' · '))}</span>` : ''}</span></label>`; }).join('')}</div>
    <div class="actions"><button class="btn primary grow" type="button" id="lotOk">Lotta</button><button class="btn ghost" type="button" id="lotNo">Avbryt</button></div>`, m => {
    m.querySelector('#lotNo').addEventListener('click', () => openPlan(g, hid));
    m.querySelector('#lotOk').addEventListener('click', () => {
      const ps = passes.filter(p => m.querySelector(`[data-lp="${CSS.escape(p.id)}"]`).checked), us = people.filter(u => m.querySelector(`[data-lu="${CSS.escape(u.uid)}"]`).checked);
      if(!ps.length || !us.length){ toast('Välj minst ett pass och en deltagare.'); return; }
      const {out, left} = lottery(g, ps, us), lotted = new Set(us.map(u => u.uid)), base = d ? `drives/${did}/pass/` : 'stands/', up = {};
      for(const p of passes){
        const was = cur[p.id] || {}, sel = ps.includes(p), u = out[p.id];
        if(sel && u){ up[base + p.id + '/who'] = u.name; up[base + p.id + '/uid'] = u.uid; up[base + p.id + '/ok'] = null; }
        else if(sel || (was.uid && lotted.has(was.uid))){ up[base + p.id + '/who'] = null; up[base + p.id + '/uid'] = null; up[base + p.id + '/ok'] = null; }
      }
      const warn = Object.entries(out).filter(([pid, u]) => passIssues(g, pinById(pid), u.uid, u.name).length).length;
      planRef(g, hid).update(up).then(() => toast(`${Object.keys(out).length} pass är lottade.${left.length ? ` ${left.map(u => u.name).join(', ')} fick inget pass.` : ''}${warn ? ` ${warn === 1 ? 'En placering' : warn + ' placeringar'} passar inte: se varningarna.` : ''}`, 6000)).catch(fail());
      openPlan(g, hid);
    });
  });
}
/* Ny samlingsplats: i första hand en kartnål i jaktens områden (parkering, stuga, eldplats och liknande överst),
   annars en ny position på kartan. Nålens namn och position kopieras till samlingsplatsen. */
const MEET_ICONS = ['parking', 'house', 'fire', 'tent', 'car', 'flag', 'bridge', 'gate'];
function meetAdd(g, hid){
  const hunt = (g.hunts || {})[hid]; if(!hunt) return;
  const aids = new Set(planAreaIds(g, hunt)), used = Object.values(planOf(g, hid).meets || {}).filter(Boolean);
  const pinName = p => p.name || (typeById(p.typeId) || {}).name || 'Nål';
  const pins = state.pins.filter(p => aids.has(p.areaId) && typeof p.lat === 'number' && typeof p.lng === 'number')
    .map(p => ({p, t:typeById(p.typeId) || {name:'', color:'#475569', icon:'dot'}, sug:MEET_ICONS.includes((typeById(p.typeId) || {}).icon), used:used.some(m => Math.abs(m.lat - p.lat) < 1e-6 && Math.abs(m.lng - p.lng) < 1e-6)}))
    .sort((a, b) => (b.sug - a.sug) || pinName(a.p).localeCompare(pinName(b.p), 'sv'));
  const row = x => `<button class="mt-pin" type="button" data-pid="${esc(x.p.id)}" ${x.used ? 'disabled' : ''}>${swatch(x.t)}<span class="grow"><b>${esc(pinName(x.p))}</b><br><span class="small muted">${esc(x.t.name || '')}${x.used ? ' · redan samlingsplats' : ''}</span></span></button>`;
  const sug = pins.filter(x => x.sug), rest = pins.filter(x => !x.sug);
  openModal(`<h2>Ny samlingsplats</h2>
    ${pins.length ? `<p class="note" style="margin-top:0">Välj en kartnål i jaktens områden, eller lägg till en ny position.</p>
      ${pins.length > 8 ? '<input class="input" id="mtFind" type="search" placeholder="Sök bland nålarna" autocomplete="off" style="margin-bottom:8px">' : ''}
      <div class="mt-list">${sug.length ? `<div class="lbl">Förslag</div>${sug.map(row).join('')}` : ''}${rest.length ? `${sug.length ? '<div class="lbl">Övriga nålar</div>' : ''}${rest.map(row).join('')}` : ''}</div>`
    : '<p class="note" style="margin-top:0">Jaktens områden har inga kartnålar. Lägg till en ny position på kartan.</p>'}
    <div class="actions"><button class="btn ${pins.length ? '' : 'primary '}grow" type="button" id="mtNew">Ny position på kartan</button><button class="btn ghost" type="button" id="mtNo">Avbryt</button></div>`, m => {
    m.querySelector('#mtNo').addEventListener('click', () => openPlan(g, hid));
    m.querySelector('#mtNew').addEventListener('click', () => meetPlace(g, hid));
    const find = m.querySelector('#mtFind');
    if(find) find.addEventListener('input', () => { const q = find.value.trim().toLowerCase();
      m.querySelectorAll('.mt-pin').forEach(el => { el.hidden = !!q && !el.textContent.toLowerCase().includes(q); }); });
    m.addEventListener('click', e => {
      const b = e.target.closest('.mt-pin'); if(!b || b.disabled) return;
      const x = pins.find(y => y.p.id === b.dataset.pid); if(!x) return;
      const name = pinName(x.p).slice(0, 60);
      planRef(g, hid, 'meets/m-' + uid()).set({name, lat:+x.p.lat.toFixed(6), lng:+x.p.lng.toFixed(6)}).then(() => toast(`Samlingsplatsen ${name} är sparad.`)).catch(fail());
      openPlan(g, hid);
    });
  });
}
/* Samlingsplats: placera med korset på kartan. Ny plats får ett namn efteråt. */
function meetPlace(g, hid, mid){
  const old = mid ? (planOf(g, hid).meets || {})[mid] : null;
  closeModal();
  if(old) map.setView([old.lat, old.lng], Math.max(map.getZoom(), 16), {animate:false});
  startPlacing({mode:'meet', text:'Flytta kartan så att korset hamnar på samlingsplatsen.', ok:'Samlingsplats här', cancel:() => openPlan(g, hid), done:ll => {
    const pos = {lat:+ll.lat.toFixed(6), lng:+ll.lng.toFixed(6)};
    if(old){ planRef(g, hid, 'meets/' + mid).update(pos).then(() => toast('Samlingsplatsen är flyttad.')).catch(fail()); openPlan(g, hid); return; }
    openModal(`<h2>Ny samlingsplats</h2><form id="mtForm"><label class="field"><span>Namn</span><input class="input" id="mtName" maxlength="60" placeholder="Till exempel boden" autocomplete="off"></label>
      <div class="actions"><button class="btn primary grow" type="submit">Spara</button><button class="btn ghost" type="button" id="mtNo">Avbryt</button></div></form>`, m => {
      m.querySelector('#mtNo').addEventListener('click', () => openPlan(g, hid));
      m.querySelector('#mtForm').addEventListener('submit', e => {
        e.preventDefault(); const name = m.querySelector('#mtName').value.trim().slice(0, 60); if(!name){ toast('Skriv ett namn.'); return; }
        planRef(g, hid, 'meets/m-' + uid()).set(Object.assign({name}, pos)).then(() => toast(`Samlingsplatsen ${name} är sparad.`)).catch(fail());
        openPlan(g, hid);
      });
    });
  }});
}

/* ---------- Under jakten: starta och bryta såtar, återsamling ----------
   Det som händer skrivs i planen (alla i jakten ser det direkt) och skickas som krypterat meddelande i chatten. */
function driveSay(g, hid, text){
  if(!fb || typeof msgSend !== 'function' || !msgCryptoOk()) return;
  msgSend(g, hid, text, msgPeople(g, hid), true).catch(() => toast('Meddelandet i chatten kunde inte skickas. Planen är ändå uppdaterad.', 5000));
}
function driveStart(g, hid, did){
  const hunt = (g.hunts || {})[hid], d = (planOf(g, hid).drives || {})[did]; if(!d) return;
  if(!huntLive(hunt)){ toast('Starta jakten först. Sedan startar du såtarna en i taget.'); return; }
  const t = Date.now();
  planRef(g, hid).update({cur:{did, on:true, t}, call:null, [`drives/${did}/done`]:null})
    .then(() => { toast(`${driveName(d)} har startat.`); driveSay(g, hid, `${driveName(d)} har startat. Gå till era pass.`); }).catch(fail());
}
function driveStop(g, hid){
  const c = planOf(g, hid).cur; if(!c || !c.on) return;
  const t = Date.now();
  planRef(g, hid).update({cur:{did:c.did, on:false, t}, [`drives/${c.did}/done`]:t})
    .then(() => { toast('Såten är bruten.'); driveSay(g, hid, 'Såten är bruten, patron ur.'); }).catch(fail());
}
function driveCall(g, hid, mid){
  const m = (planOf(g, hid).meets || {})[mid]; if(!m) return;
  planRef(g, hid, 'call').set({mid, name:m.name, lat:m.lat, lng:m.lng, t:Date.now()})
    .then(() => { toast(`Återsamling vid ${m.name} är skickad.`); driveSay(g, hid, `Återsamling vid ${m.name}.`); }).catch(fail());
}
/* Vart kartan ska visa när man börjar rita: jaktens pass. */
function planFit(g, hunt){ return planPasses(g, hunt).map(p => [p.lat, p.lng]); }
function planDrawDrive(g, hid, did){
  const hunt = (g.hunts || {})[hid], plan = planOf(g, hid), d = did && (plan.drives || {})[did];
  startCustomDrawing({poly:true, cls:'border', pts:d ? parseBorder(d.ring) : [], fit:hunt ? planFit(g, hunt) : [], hint:'Tryck på kartan i varje hörn av såten.',
    style:p => p.length >= 3 ? [L.polygon(p, Object.assign({interactive:false}, DRIVE_STYLE, {weight:3, fillOpacity:.15}))] : p.length === 2 ? [L.polyline(p, {color:DRIVE_STYLE.color, weight:3, interactive:false})] : [],
    done:pts => {
      // En befintlig såt behåller namn, ordning och pass: bara ytan ändras
      const ds = driveList(plan), n = ds.length, ord = Math.min(1000, Math.max(-1, ...ds.map(([, x]) => ordOf(x))) + 1);
      (d ? planRef(g, hid, 'drives/' + did + '/ring').set(fmtBorder(pts)) : planRef(g, hid, 'drives/d-' + uid()).set({name:`Såt ${n + 1}`, ring:fmtBorder(pts), ord}))
        .then(() => toast(`Såten är sparad, ${fmtHa(areaHa(pts))}.`)).catch(fail());
      openPlan(g, hid);
    },
    cancel:() => openPlan(g, hid)});
}
function planDrawRoute(g, hid, kind, rid, did){
  const hunt = (g.hunts || {})[hid], plan = planOf(g, hid), r = rid && (plan.routes || {})[rid];
  kind = r ? r.kind : (ROUTE_KIND[kind] ? kind : 'hund');
  const drive = r ? r.drive : did, dr = drive && (plan.drives || {})[drive];
  startCustomDrawing({poly:false, cls:'path', pts:r ? parseBorder(r.pts) : [], fit:dr ? parseBorder(dr.ring) : hunt ? planFit(g, hunt) : [], hint:`Tryck på kartan där ${kind === 'hund' ? 'hundföraren' : 'drevkarlen'} ska gå${dr ? ' i ' + driveName(dr) : ''}.`,
    style:p => p.length >= 2 ? routeStyle(kind, p) : [],
    done:pts => {
      const id = rid || 'r-' + uid(), v = {kind, pts:fmtBorder(pts)};
      if(r && r.who) v.who = r.who;
      if(r && r.uid) v.uid = r.uid;
      if(drive) v.drive = drive;
      planRef(g, hid, 'routes/' + id).set(v).then(() => toast(`Vägen är sparad, ${fmtDist(lineLen(pts))}.`)).catch(fail());
      openPlan(g, hid);
    },
    cancel:() => openPlan(g, hid)});
}

/* Förbjudna skjutriktningar: tryck på riktningarna i kompassrosen.
   Passgrannarna (andra pass i jakten inom NEIGH_MAX meter) visas runt rosen i sin riktning, med nummer, och i en lista
   med namn, vem som står där, avstånd och riktning. Ligger en granne i en riktning som inte är spärrad syns det. */
const NEIGH_MAX = 1500, NEIGH_N = 8;
const dirIdx = deg => Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
function passNeighbors(g, hid, p){
  const hunt = (g.hunts || {})[hid];
  if(!p || !hunt) return [];
  const stands = planStands(planOf(g, hid));
  return planPasses(g, hunt).filter(q => q.id !== p.id)
    .map(q => { const b = bearingDeg(p, q); return {p:q, d:distM(p, q), b, i:dirIdx(b), who:(stands[q.id] || {}).who || ''}; })
    .filter(x => x.d <= NEIGH_MAX).sort((a, b) => a.d - b.d).slice(0, NEIGH_N);
}
function roseSvg(no, nb){
  const R = 100, r0 = 26, pt = (r, a) => `${(r * Math.sin(a * Math.PI / 180)).toFixed(2)},${(-r * Math.cos(a * Math.PI / 180)).toFixed(2)}`;
  const xy = (r, a) => pt(r, a).split(',');
  const nbs = (nb || []).map((x, k) => {
    // Avståndet läggs utanför numret: till höger om det på östra sidan, till vänster på västra, ovanför eller under i norr och söder
    const sn = Math.sin(x.b * Math.PI / 180), anc = sn > 0.35 ? 'start' : sn < -0.35 ? 'end' : 'middle';
    const [x0, y0] = xy(r0, x.b), [x1, y1] = xy(R + 12, x.b), [tx, ty] = xy(anc === 'middle' ? R + 29 : R + 24, x.b), open = !(no & (1 << x.i));
    return `<g class="rose-nb${open ? ' open' : ''}" aria-hidden="true"><line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}"/><circle cx="${x1}" cy="${y1}" r="9"/><text class="n" x="${x1}" y="${y1}">${k + 1}</text><text class="d" x="${tx}" y="${ty}" text-anchor="${anc}">${esc(fmtDist(x.d))}</text></g>`;
  }).join('');
  return `<svg class="rose" viewBox="-172 -142 344 284" role="group" aria-label="Skjutriktningar">${DIR16.map((d, i) => {
    const a0 = i * 22.5 - 11.25, a1 = a0 + 22.5, on = !!(no & (1 << i)), lp = pt(i % 2 ? 80 : 74, i * 22.5).split(',');
    return `<g class="rose-w${on ? ' on' : ''}" data-i="${esc(i)}" role="button" tabindex="0" aria-pressed="${on}" aria-label="${d}"><path d="M${pt(r0, a0)}L${pt(R, a0)}A${R} ${R} 0 0 1 ${pt(R, a1)}L${pt(r0, a1)}A${r0} ${r0} 0 0 0 ${pt(r0, a0)}Z"/><text x="${lp[0]}" y="${lp[1]}">${d}</text></g>`;
  }).join('')}<circle r="${r0 - 4}" class="rose-c"/><circle r="5" class="rose-me"/>${nbs}</svg>`;
}
function neighborList(nb, no){
  if(!nb.length) return `<p class="small muted" id="roseNb">Inga andra pass i jakten inom ${fmtDist(NEIGH_MAX)}.</p>`;
  return `<div class="lbl">Passgrannar inom ${fmtDist(NEIGH_MAX)}</div><ol class="rose-nbl" id="roseNb">${nb.map((x, k) => {
    const open = !(no & (1 << x.i));
    return `<li class="${open ? 'open' : ''}"><span class="rose-nbn">${k + 1}</span><span><b>${esc(x.p.name || 'Pass')}</b>${x.who ? ' (' + esc(x.who) + ')' : ''} · ${esc(fmtDist(x.d))} mot ${DIR16[x.i]} (${Math.round(x.b)}°)<br><span class="small ${open ? 'warn' : 'muted'}">${open ? '⚠ Riktningen mot passet är inte spärrad' : 'Riktningen är spärrad'}</span></span></li>`;
  }).join('')}</ol>`;
}
function openDirs(g, hid, pid){
  const p = pinById(pid), plan = planOf(g, hid), s = (plan.stands || {})[pid] || {}, who = (planStands(plan)[pid] || {}).who;
  let no = s.no || 0;
  const nb = passNeighbors(g, hid, p);
  openModal(`<h2>Skjutriktningar</h2><p class="note" style="margin-top:0"><b>${esc(p ? p.name || 'Pass' : 'Pass')}</b>${who ? ' (' + esc(who) + ')' : ''}. Tryck på de riktningar där det är <b>förbjudet</b> att skjuta. Norr är uppåt, som på kartan. Siffrorna runt rosen är passgrannarna.</p>
    <div id="roseBox"></div><p class="small" id="roseTxt"></p><div id="roseNbBox"></div>
    <div class="actions"><button class="btn primary grow" type="button" id="roseOk">Spara</button><button class="btn" type="button" id="roseClear">Rensa</button><button class="btn ghost" type="button" id="roseCancel">Avbryt</button></div>`, m => {
    const draw = () => {
      m.querySelector('#roseBox').innerHTML = roseSvg(no, nb);
      m.querySelector('#roseNbBox').innerHTML = neighborList(nb, no);
      const d = maskDirs(no);
      m.querySelector('#roseTxt').textContent = d.length ? `Förbjudet att skjuta mot ${d.join(', ')}.` : 'Inga förbjudna riktningar.';
    };
    const toggle = w => { if(!w) return; no ^= 1 << +w.dataset.i; draw(); };
    m.querySelector('#roseBox').addEventListener('click', e => toggle(e.target.closest('.rose-w')));
    m.querySelector('#roseBox').addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); const i = e.target.closest('.rose-w'); toggle(i); const n = m.querySelector(`.rose-w[data-i="${esc(i && i.dataset.i)}"]`); if(n) n.focus(); } });
    m.querySelector('#roseClear').addEventListener('click', () => { no = 0; draw(); });
    m.querySelector('#roseCancel').addEventListener('click', () => openPlan(g, hid));
    m.querySelector('#roseOk').addEventListener('click', () => {
      planRef(g, hid, 'stands/' + pid + '/no').set(no || null).catch(fail());
      openPlan(g, hid);
    });
    draw();
  });
}
$('#popPlan').addEventListener('change', e => { state.settings.planOn = e.target.checked; save(); renderPlan(); });
