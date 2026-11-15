/* ---------- Jaktplan ----------
   Jaktledaren planerar en jakt innan den startar (och kan ändra under jakten):
   - vem som står på vilket pass
   - förbjudna skjutriktningar för varje pass (16 kompassriktningar)
   - såtar, ritade som ytor på kartan
   - vägar för hundförare och drevkarlar, med vem som går
   Planen ligger i groups/<lag>/huntPlan/<jakt>. Lagets medlemmar och jaktens gäster ser den, även före start.
   Bara jaktledare och admin ändrar den. Den tas bort när jakten avslutas. */
var planLayer = null;
const PLAN_R = 150;   // meter, längden på de röda sektorerna för förbjudna skjutriktningar
const ROUTE_KIND = {hund:{name:'Hundförare', color:'#db2777'}, drev:{name:'Drevkarl', color:'#6d28d9'}};
const DRIVE_STYLE = {color:'#166534', weight:2.5, dashArray:'8 6', fillColor:'#22c55e', fillOpacity:.08};
const planUi = {gid:null, hid:null};
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
  const going = (g.huntRsvp || {})[hid] || {};
  for(const [u, m] of Object.entries(g.members || {})) if(m) out.push({uid:u, name:m.name || 'Medlem', label:(going[u] ? '✓ ' : '') + (m.name || 'Medlem'), going:!!going[u]});
  for(const [u, v] of Object.entries(g.guests || {})) if(v && v.hid === hid) out.push({uid:u, name:v.name || 'Gäst', label:'✓ ' + (v.name || 'Gäst') + ' (gäst)', going:true});
  // De som deltar först
  return out.sort((a, b) => (b.going - a.going) || a.name.localeCompare(b.name, 'sv'));
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
    for(const [pid, s] of Object.entries(planOf(g, hid).stands || {})){
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
    for(const [pid, s] of Object.entries(planOf(g, hid).stands || {})){ const p = s && s.uid === myUid() ? pinById(pid) : null; if(p) out.push({g, hid, p}); }
  }
  return out;
}
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
  const hunt = (g.hunts || {})[hid], stands = planOf(g, hid).stands || {};
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
  if(!planOn()) return;
  const pins = new Map(state.pins.map(p => [p.id, p]));
  for(const {g, hid} of planHunts()){
    const plan = planOf(g, hid);
    for(const d of Object.values(plan.drives || {})){
      const ring = parseBorder(d && d.ring); if(ring.length < 3) continue;
      L.polygon(ring, Object.assign({interactive:false, className:'plan-drive'}, DRIVE_STYLE)).addTo(planLayer);
      if(d.name) planLabel(L.latLngBounds(ring).getCenter(), 'drive', d.name).addTo(planLayer);
    }
    for(const r of Object.values(plan.routes || {})){
      const pts = parseBorder(r && r.pts), k = r && ROUTE_KIND[r.kind]; if(pts.length < 2 || !k) continue;
      routeStyle(r.kind, pts).forEach(l => l.addTo(planLayer));
      planLabel(pts[0], 'route ' + r.kind + (r.uid && r.uid === myUid() ? ' me' : ''), k.name + (r.who ? ': ' + r.who : '')).addTo(planLayer);
    }
    for(const [pid, s] of Object.entries(plan.stands || {})){
      const p = pins.get(pid); if(!p || !s) continue;
      for(const [i, n] of maskRuns(s.no)){
        const from = i * 22.5 - 11.25;
        L.polygon(sectorPts(p, from, from + n * 22.5, PLAN_R), {color:'#dc2626', weight:1, opacity:.8, fillColor:'#dc2626', fillOpacity:.28, interactive:false, className:'plan-nofire'}).addTo(planLayer);
      }
      const cin = s.uid && checkOf(g, hid, s.uid), isIn = !!(cin && cin.in && cin.pid === pid);
      if(s.who) planLabel([p.lat, p.lng], 'who' + (s.uid && s.uid === myUid() ? ' me' : '') + (isIn ? ' in' : ''), s.who).addTo(planLayer);
    }
  }
}

/* ---------- Planen i jaktkortet ---------- */
function planCardHtml(g, hid, hunt, lead){
  const plan = planOf(g, hid), stands = plan.stands || {}, passes = planPasses(g, hunt);
  const shown = passes.filter(p => stands[p.id] && (stands[p.id].who || stands[p.id].no));
  const routes = Object.values(plan.routes || {}).filter(r => r && ROUTE_KIND[r.kind]);
  const nd = Object.values(plan.drives || {}).filter(Boolean).length;
  if(!lead && !shown.length && !routes.length && !nd) return '';
  const me = myUid(), mine = passes.filter(p => stands[p.id] && stands[p.id].uid === me), myRoutes = routes.filter(r => r.uid === me);
  let h = `<div class="lbl">Jaktplan</div>`;
  if(mine.length){
    const live = huntLive(hunt), c = checkOf(g, hid), isIn = !!(c && c.in && mine.some(p => p.id === c.pid));
    h += `<div class="plan-mine">Ditt pass: <b>${mine.map(p => esc(p.name || 'Pass')).join(', ')}</b>${maskDirs(stands[mine[0].id].no).length ? `. Skjut inte mot ${maskDirs(stands[mine[0].id].no).join(', ')}.` : ''} <button class="linkbtn" type="button" data-j="plan-go" data-g="${esc(g.id)}" data-p="${esc(mine[0].id)}">Visa</button>
      ${live ? `<div class="check-row">${isIn ? `<span class="check-ok">✓ Incheckad ${esc(fmtClock(c.t))}</span> <button class="btn sm ghost" type="button" data-j="check-out" data-g="${esc(g.id)}" data-h="${esc(hid)}" data-p="${esc(c.pid)}">Lämnar passet</button>`
        : `<button class="btn sm primary" type="button" data-j="check-in" data-g="${esc(g.id)}" data-h="${esc(hid)}" data-p="${esc(mine[0].id)}">Jag är på passet</button> <span class="small muted">Du checkas in automatiskt inom ${CHECK_IN} m.</span>`}</div>` : ''}</div>`;
  }
  for(const r of myRoutes) h += `<div class="plan-mine">Du går som <b>${ROUTE_KIND[r.kind].name.toLowerCase()}</b>.</div>`;
  if(shown.length) h += `<div class="small plan-list">${shown.map(p => { const s = stands[p.id], no = maskDirs(s.no);
    return `<div><span>${esc(p.name || 'Pass')}</span>: ${s.who ? `<b>${esc(s.who)}</b>` : '<span class="muted">ingen</span>'}${no.length ? ` <span class="muted">· ej mot ${no.join(', ')}</span>` : ''}${huntLive(hunt) ? checkText(g, hid, p, s) : ''}</div>`; }).join('')}</div>`;
  if(routes.length) h += `<div class="small plan-list">${routes.map(r => `<div>${ROUTE_KIND[r.kind].name}: ${r.who ? `<b>${esc(r.who)}</b>` : '<span class="muted">ingen</span>'} <span class="muted">· ${fmtDist(lineLen(parseBorder(r.pts)))}</span></div>`).join('')}</div>`;
  const set = passes.filter(p => stands[p.id] && stands[p.id].who).length;
  const withUid = passes.filter(p => stands[p.id] && stands[p.id].uid), manned = withUid.filter(p => { const c = checkOf(g, hid, stands[p.id].uid); return c && c.in && c.pid === p.id; }).length;
  h += `<div class="small muted">${set} av ${passes.length} pass tillsatta${huntLive(hunt) && withUid.length ? ` · ${manned} av ${withUid.length} på plats` : ''} · ${nd} ${nd === 1 ? 'såt' : 'såtar'} · ${routes.length} ${routes.length === 1 ? 'väg' : 'vägar'}</div>`;
  if(lead) h += `<div class="btnrow" style="margin-top:6px"><button class="btn sm" type="button" data-j="plan" data-g="${esc(g.id)}" data-h="${esc(hid)}">Planera</button></div>`;
  return h;
}

/* ---------- Planera (jaktledare och admin) ---------- */
const planRef = (g, hid, sub) => fb.db.ref(`groups/${g.id}/huntPlan/${hid}${sub ? '/' + sub : ''}`);
function openPlan(g, hid){
  planUi.gid = g.id; planUi.hid = hid;
  openModal(`<h2>Planera jakten</h2><div id="planBody"></div>
    <div class="actions"><button class="btn primary grow" type="button" id="plClose">Klar</button></div>`, m => {
    m.querySelector('#plClose').addEventListener('click', closeModal);
    m.addEventListener('change', planChange);
    m.addEventListener('click', planClick);
    planBodyRender(true);
  });
}
function planCtx(){ const g = cloud.groups[planUi.gid], hunt = g && (g.hunts || {})[planUi.hid]; return hunt ? {g, hid:planUi.hid, hunt, plan:planOf(g, planUi.hid)} : null; }
function planBodyRender(force){
  const body = document.getElementById('planBody'); if(!body) return;
  // Rita inte om medan man skriver i dialogen (en uppdatering från molnet skulle annars ta bort det man skrivit).
  if(!force && body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  const c = planCtx();
  if(!c){ body.innerHTML = '<div class="empty">Jakten finns inte längre.</div>'; return; }
  const {g, hid, hunt, plan} = c, passes = planPasses(g, hunt), people = planPeople(g, hid);
  const opts = (who, u) => {
    let found = false;
    const o = people.map(p => { const sel = !!u && p.uid === u; if(sel) found = true; return `<option value="u:${esc(p.uid)}"${sel ? ' selected' : ''}>${esc(p.label)}</option>`; }).join('');
    return `<option value="">Ingen</option>${o}${who && !found ? `<option value="n" selected>${esc(who)}</option>` : ''}<option value="__name">Annat namn …</option>`;
  };
  const now = Date.now(), upcoming = hunt.starts > now;
  let h = `<p class="note" style="margin-top:0"><b>${esc(hunt.name)}</b> · ${upcoming ? 'startar ' + esc(fmtTime(hunt.starts)) : 'pågår'}. Planen syns för alla i jakten, även gästerna, och tas bort när jakten avslutas.</p>`;
  h += `<h3 class="sec">Pass</h3>`;
  if(!passes.length) h += `<p class="note" style="margin-top:0">Det finns inga pass i jaktens områden. Lägg ut nålar av typen Pass i ett område som delas med laget.</p>`;
  for(const p of passes){
    const s = (plan.stands || {})[p.id] || {}, no = maskDirs(s.no);
    h += `<div class="plan-row"><span class="pr-name">${esc(p.name || 'Pass')}</span>
      <select class="input" data-pl="who" data-p="${esc(p.id)}" aria-label="Vem står på ${esc(p.name || 'passet')}">${opts(s.who, s.uid)}</select>
      <button class="btn sm${no.length ? ' nofire' : ''}" type="button" data-pl="dirs" data-p="${esc(p.id)}">${no.length ? 'Ej mot ' + no.join(', ') : 'Skjutriktningar'}</button></div>`;
  }
  h += `<h3 class="sec">Såtar</h3>`;
  const drives = Object.entries(plan.drives || {}).filter(([, d]) => d);
  if(!drives.length) h += `<p class="note" style="margin-top:0">Ingen såt är ritad.</p>`;
  for(const [did, d] of drives){
    h += `<div class="plan-row"><input class="input" data-pl="dname" data-d="${esc(did)}" maxlength="60" value="${esc(d.name || '')}" aria-label="Namn på såten">
      <span class="small muted">${fmtHa(areaHa(parseBorder(d.ring)))}</span>
      <button class="btn sm" type="button" data-pl="drive-draw" data-d="${esc(did)}">Ändra</button>
      <button class="iconbtn" type="button" data-pl="drive-del" data-d="${esc(did)}" aria-label="Ta bort ${esc(d.name || 'såten')}">${ICON_TRASH}</button></div>`;
  }
  h += `<div class="btnrow"><button class="btn sm" type="button" data-pl="drive-draw">Rita såt</button></div>`;
  h += `<h3 class="sec">Hundförare och drevkarlar</h3>`;
  const routes = Object.entries(plan.routes || {}).filter(([, r]) => r && ROUTE_KIND[r.kind]);
  if(!routes.length) h += `<p class="note" style="margin-top:0">Rita hur hundförare och drevkarlar ska gå.</p>`;
  for(const [rid, r] of routes){
    h += `<div class="plan-row"><span class="pr-name"><span class="route-dot ${r.kind}"></span>${ROUTE_KIND[r.kind].name}<br><span class="small muted">${fmtDist(lineLen(parseBorder(r.pts)))}</span></span>
      <select class="input" data-pl="rwho" data-r="${esc(rid)}" aria-label="Vem går som ${ROUTE_KIND[r.kind].name.toLowerCase()}">${opts(r.who, r.uid)}</select>
      <button class="btn sm" type="button" data-pl="route-draw" data-r="${esc(rid)}" data-k="${esc(r.kind)}">Ändra</button>
      <button class="iconbtn" type="button" data-pl="route-del" data-r="${esc(rid)}" aria-label="Ta bort vägen">${ICON_TRASH}</button></div>`;
  }
  h += `<div class="btnrow"><button class="btn sm" type="button" data-pl="route-draw" data-k="hund">Rita väg för hundförare</button><button class="btn sm" type="button" data-pl="route-draw" data-k="drev">Rita väg för drevkarl</button></div>`;
  body.innerHTML = h;
}
/* Vem: '' = ingen, 'u:<uid>' = deltagare, 'n' = oförändrat eget namn, '__name' = skriv ett namn. */
function planWho(c, val, path, row){
  if(val === 'n') return;
  if(val === '__name'){
    const sel = row.querySelector('select'); sel.hidden = true;
    const inp = h(`<input class="input" data-pl="${sel.dataset.pl}-name" maxlength="60" placeholder="Namn" aria-label="Namn">`);
    sel.after(inp); inp.focus();
    return;
  }
  const u = val.startsWith('u:') ? val.slice(2) : null, p = u && planPeople(c.g, c.hid).find(x => x.uid === u);
  planRef(c.g, c.hid, path).update({who:p ? p.name : null, uid:p ? u : null}).catch(fail());
}
function planChange(e){
  const t = e.target, c = planCtx(); if(!c || !t.dataset.pl) return;
  const row = t.closest('.plan-row'), k = t.dataset.pl;
  if(k === 'who') planWho(c, t.value, 'stands/' + t.dataset.p, row);
  else if(k === 'rwho') planWho(c, t.value, 'routes/' + t.dataset.r, row);
  else if(k === 'who-name' || k === 'rwho-name'){
    const sel = row.querySelector('select'), v = t.value.trim().slice(0, 60);
    const path = k === 'who-name' ? 'stands/' + sel.dataset.p : 'routes/' + sel.dataset.r;
    if(v) planRef(c.g, c.hid, path).update({who:v, uid:null}).then(() => planBodyRender(true)).catch(fail()); else planBodyRender(true);
  }
  else if(k === 'dname'){ const v = t.value.trim().slice(0, 60); if(v) planRef(c.g, c.hid, 'drives/' + t.dataset.d + '/name').set(v).catch(fail()); }
}
function planClick(e){
  const b = e.target.closest('[data-pl]'); if(!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
  const c = planCtx(); if(!c) return;
  const k = b.dataset.pl;
  if(k === 'dirs') openDirs(c.g, c.hid, b.dataset.p);
  else if(k === 'drive-draw') planDrawDrive(c.g, c.hid, b.dataset.d);
  else if(k === 'route-draw') planDrawRoute(c.g, c.hid, b.dataset.k, b.dataset.r);
  else if(k === 'drive-del') confirmClick(b, 'Bekräfta', () => planRef(c.g, c.hid, 'drives/' + b.dataset.d).remove().catch(fail()));
  else if(k === 'route-del') confirmClick(b, 'Bekräfta', () => planRef(c.g, c.hid, 'routes/' + b.dataset.r).remove().catch(fail()));
}
/* Vart kartan ska visa när man börjar rita: jaktens pass. */
function planFit(g, hunt){ return planPasses(g, hunt).map(p => [p.lat, p.lng]); }
function planDrawDrive(g, hid, did){
  const hunt = (g.hunts || {})[hid], plan = planOf(g, hid), d = did && (plan.drives || {})[did];
  startCustomDrawing({poly:true, cls:'border', pts:d ? parseBorder(d.ring) : [], fit:hunt ? planFit(g, hunt) : [], hint:'Tryck på kartan i varje hörn av såten.',
    style:p => p.length >= 3 ? [L.polygon(p, Object.assign({interactive:false}, DRIVE_STYLE, {weight:3, fillOpacity:.15}))] : p.length === 2 ? [L.polyline(p, {color:DRIVE_STYLE.color, weight:3, interactive:false})] : [],
    done:pts => {
      const id = did || 'd-' + uid(), n = Object.values(plan.drives || {}).filter(Boolean).length;
      planRef(g, hid, 'drives/' + id).set({name:d ? d.name : `Såt ${n + 1}`, ring:fmtBorder(pts)}).then(() => toast(`Såten är sparad, ${fmtHa(areaHa(pts))}.`)).catch(fail());
      openPlan(g, hid);
    },
    cancel:() => openPlan(g, hid)});
}
function planDrawRoute(g, hid, kind, rid){
  const hunt = (g.hunts || {})[hid], plan = planOf(g, hid), r = rid && (plan.routes || {})[rid];
  kind = r ? r.kind : (ROUTE_KIND[kind] ? kind : 'hund');
  startCustomDrawing({poly:false, cls:'path', pts:r ? parseBorder(r.pts) : [], fit:hunt ? planFit(g, hunt) : [], hint:`Tryck på kartan där ${kind === 'hund' ? 'hundföraren' : 'drevkarlen'} ska gå.`,
    style:p => p.length >= 2 ? routeStyle(kind, p) : [],
    done:pts => {
      const id = rid || 'r-' + uid(), v = {kind, pts:fmtBorder(pts)};
      if(r && r.who) v.who = r.who;
      if(r && r.uid) v.uid = r.uid;
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
  const stands = planOf(g, hid).stands || {};
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
  const p = pinById(pid), plan = planOf(g, hid), s = (plan.stands || {})[pid] || {};
  let no = s.no || 0;
  const nb = passNeighbors(g, hid, p);
  openModal(`<h2>Skjutriktningar</h2><p class="note" style="margin-top:0"><b>${esc(p ? p.name || 'Pass' : 'Pass')}</b>${s.who ? ' (' + esc(s.who) + ')' : ''}. Tryck på de riktningar där det är <b>förbjudet</b> att skjuta. Norr är uppåt, som på kartan. Siffrorna runt rosen är passgrannarna.</p>
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
