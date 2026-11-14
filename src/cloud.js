/* ---------- Moln: jaktlag, rättigheter, jakter och positioner (Firebase Realtime Database) ---------- */
const FB_VER = '10.12.2', FBKEY = 'faltkartan.fb', NAMEKEY = 'faltkartan.name';
const BAKED_CFG = {apiKey:"AIzaSyDlhnsDFs3HxuMmGPYBUm-3e0ZBmVsCiq0", authDomain:"jaktkartan-daa0a.firebaseapp.com", databaseURL:"https://jaktkartan-daa0a-default-rtdb.europe-west1.firebasedatabase.app", projectId:"jaktkartan-daa0a", storageBucket:"jaktkartan-daa0a.firebasestorage.app", messagingSenderId:"813258995773", appId:"1:813258995773:web:00660a1eb536eaa85cd254"};
const RULES_TEXT = /*RULES_JSON*/'';
const ROLES = {admin:'Admin', leader:'Jaktledare', editor:'Medlem', viewer:'Läsare'};
const ROLE_HELP = {admin:'Allt, även medlemmar och rättigheter', leader:'Skapa jakter, ändra nålar', editor:'Lägga till och ändra nålar', viewer:'Bara titta'};
let fb = null;
const cloud = {autoOff:{}, autoShared:false, owner:undefined, creator:false, ownRef:null, cfg:null, status:'off', user:null, groups:{}, ugRef:null, sharing:false, watchId:null, lastSent:0, err:'', pending:null};
const newCode = n => { const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', a = new Uint32Array(n); crypto.getRandomValues(a); return Array.from(a, x => abc[x % 32]).join(''); };
const canon = o => JSON.stringify(o, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((r, key) => { r[key] = v[key]; return r; }, {}) : v);
const lsGet = k => { try { return localStorage.getItem(k); } catch(e){ return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch(e){} };
const b64e = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const b64d = s => decodeURIComponent(escape(atob(s.replace(/-/g,'+').replace(/_/g,'/'))));

function loadCfg(){ if(BAKED_CFG) return BAKED_CFG; try { return JSON.parse(lsGet(FBKEY) || 'null'); } catch(e){ return null; } }
function parseCfg(text){
  const out = {};
  for(const k of ['apiKey','authDomain','databaseURL','projectId','appId','storageBucket','messagingSenderId']){
    const r = new RegExp('["\']?' + k + '["\']?\\s*:\\s*["\']([^"\']+)["\']').exec(text || ''); if(r) out[k] = r[1];
  }
  return out.apiKey && out.databaseURL && out.projectId ? out : null;
}
function loadScript(src){ return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load')); document.head.appendChild(s); }); }
async function cloudInit(){
  const cfg = loadCfg(); if(!cfg){ cloud.status = 'off'; renderJakt(); return; }
  cloud.cfg = cfg; cloud.status = 'loading'; renderJakt();
  try {
    for(const m of ['app','auth','database']) await loadScript(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-${m}-compat.js`);
    if(!firebase.apps || !firebase.apps.length) firebase.initializeApp(cfg);
    fb = {auth:firebase.auth(), db:firebase.database()};
    fb.auth.onAuthStateChanged(onAuth);
  } catch(e){ cloud.status = 'error'; cloud.err = 'Kunde inte ansluta till Firebase. Kontrollera nätverket och konfigurationen.'; renderJakt(); }
}
const myUid = () => cloud.user ? cloud.user.uid : null;
const myName = () => (lsGet(NAMEKEY) || (cloud.user && cloud.user.displayName) || 'Jägare').slice(0, 60);
const myRole = g => g.kind === 'member' ? ((g.members[myUid()] || {}).role || null) : null;
const canEditGroup = g => ['admin','leader','editor'].includes(myRole(g));
const canLeadGroup = g => ['admin','leader'].includes(myRole(g));
const isAdminGroup = g => myRole(g) === 'admin';
const groupOfArea = a => a && a.gid ? cloud.groups[a.gid] : null;
function canEditArea(a){ if(!a || !a.gid) return true; const g = cloud.groups[a.gid]; return !!g && canEditGroup(g); }
function canEditPin(p){ return canEditArea(p.areaId ? areaById(p.areaId) : null); }
const canCreate = () => !!cloud.user && !cloud.user.isAnonymous && (cloud.owner === cloud.user.uid || cloud.creator);
const gname = g => g && g.meta ? g.meta.name : 'Jaktlag';

let renderTimer = null;
function scheduleRender(){
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    const ae = document.activeElement, keep = ae && ae.id && $('#panel').contains(ae) && 'value' in ae ? {id:ae.id, v:ae.value} : null;
    renderAll();
    if(keep){ const n = document.getElementById(keep.id); if(n && n.type !== 'checkbox'){ n.value = keep.v; n.focus(); } }
  }, 30);
}

function onAuth(user){
  for(const gid of Object.keys(cloud.groups)) dropGroup(gid);
  if(cloud.ugRef){ cloud.ugRef.off(); cloud.ugRef = null; }
  if(cloud.ownRef){ cloud.ownRef.off(); cloud.ownRef = null; }
  cloud.owner = undefined; cloud.creator = false;
  stopSharing(true);
  cloud.user = user; cloud.status = user ? 'in' : 'out';
  if(user){
    cloud.ugRef = fb.db.ref('userGroups/' + user.uid);
    cloud.ugRef.on('value', s => {
      const v = s.val() || {};
      for(const gid of Object.keys(cloud.groups)) if(!v[gid]) dropGroup(gid);
      for(const gid of Object.keys(v)) if(!cloud.groups[gid]) subGroup(gid, v[gid] === 'guest' ? 'guest' : 'member');
      scheduleRender();
    }, () => {});
    // Den första som loggar in med Google blir ägare. Bara ägaren (och de ägaren godkänt) kan skapa jaktlag.
    cloud.ownRef = fb.db.ref('owner');
    cloud.ownRef.on('value', s => {
      cloud.owner = s.val();
      if(!cloud.owner && !user.isAnonymous) fb.db.ref('owner').set(user.uid).then(() => toast('Du är nu ägare av den här Jaktkartan och kan skapa jaktlag.', 5000)).catch(() => {});
      scheduleRender();
    }, () => {});
    if(!user.isAnonymous) fb.db.ref('creators/' + user.uid).get().then(s => { cloud.creator = s.val() === true; scheduleRender(); }).catch(() => {});
    if(cloud.pending){ const c = cloud.pending; cloud.pending = null; joinByCode(c); }
  }
  scheduleRender();
}
function purgeLocal(gid){
  const ids = new Set(state.areas.filter(a => a.gid === gid).map(a => a.id));
  state.pins = state.pins.filter(p => !ids.has(p.areaId));
  state.areas = state.areas.filter(a => a.gid !== gid);
}
function dropGroup(gid){
  const g = cloud.groups[gid]; if(!g) return;
  g.refs.forEach(r => r.off()); Object.values(g.posRefs).forEach(r => r.off()); Object.values(g.trailRefs).forEach(r => r.off()); Object.values(g.obsRefs).forEach(r => r.off()); delete cloud.groups[gid];
  purgeLocal(gid); scheduleRender(); renderPositions();
}
function forgetGroup(gid){ if(fb && cloud.user) fb.db.ref('userGroups/' + myUid() + '/' + gid).remove().catch(() => {}); dropGroup(gid); }
function subGroup(gid, kind){
  const g = cloud.groups[gid] = {id:gid, kind, meta:null, members:{}, areas:{}, pins:{}, types:{}, hunts:{}, guests:{}, guest:null, refs:[], areaRefs:{}, huntRef:null, posRefs:{}, huntPos:{}, trailRefs:{}, huntTrail:{}, obsRefs:{}, huntObs:{}, huntPlan:{}, huntRsvp:{}, disc:{}};
  const on = (path, fn) => { const r = fb.db.ref('groups/' + gid + '/' + path); r.on('value', s => { if(cloud.groups[gid] === g) fn(s.val()); }, () => { if(cloud.groups[gid] === g) fn(null, true); }); g.refs.push(r); return r; };
  on('meta', v => { g.meta = v; if(!v){ forgetGroup(gid); toast('Du har inte längre åtkomst till ett jaktlag eller en jakt.'); return; } scheduleRender(); });
  on('types', v => { g.types = v || {}; applyRemote(gid); });
  if(kind === 'member'){
    on('members', v => { g.members = v || {}; scheduleRender(); });
    on('areas', v => { g.areas = v || {}; applyRemote(gid); });
    on('pins', v => { g.pins = v || {}; applyRemote(gid); });
    on('hunts', v => { g.hunts = v || {}; scheduleRender(); syncHuntPos(); });
    on('guests', v => { g.guests = v || {}; scheduleRender(); });
    on('huntPlan', v => { g.huntPlan = v || {}; scheduleRender(); });
    on('huntRsvp', v => { g.huntRsvp = v || {}; syncHuntPos(); });
  } else {
    on('guests/' + myUid(), v => {
      g.guest = v;
      if(!v) return;
      if(g.huntRef) return;
      on('huntPlan/' + v.hid, pv => { g.huntPlan = pv ? {[v.hid]: pv} : {}; scheduleRender(); });
      g.huntRef = on('hunts/' + v.hid, hv => {
        g.hunts = hv ? {[v.hid]: hv} : {}; syncHuntPos();
        const want = hv && hv.areas ? Object.keys(hv.areas).filter(k => hv.areas[k] === true) : [];
        for(const aid of want){ if(g.areaRefs[aid]) continue; g.areaRefs[aid] = true;
          on('areas/' + aid, av => { if(av) g.areas[aid] = av; else delete g.areas[aid]; applyRemote(gid); });
          on('pins/' + aid, pv => { if(pv) g.pins[aid] = pv; else delete g.pins[aid]; applyRemote(gid); }); }
        for(const aid of Object.keys(g.areas)) if(!want.includes(aid)){ delete g.areas[aid]; delete g.pins[aid]; }
        applyRemote(gid);
      });
    });
  }
}
function applyRemote(gid){
  const g = cloud.groups[gid]; if(!g) return;
  const hidden = state.settings.hiddenAreas || {};
  purgeLocal(gid);
  for(const [aid, a] of Object.entries(g.areas)){
    if(!a) continue;
    const clash = state.areas.find(x => x.id === aid); // privat område med samma id: ge det ett nytt
    if(clash){ const nid = 'a-' + uid(); state.pins.forEach(p => { if(p.areaId === aid) p.areaId = nid; }); clash.id = nid; }
    { const na = {id:aid, name:a.name || 'Område', gid, visible:!hidden[aid], updated:a.updated || 0}; if(typeof a.border === 'string' && a.border) na.border = a.border; if(a.lines && typeof a.lines === 'object') na.lines = JSON.parse(JSON.stringify(a.lines)); state.areas.push(na); }
    for(const [pid, p] of Object.entries(g.pins[aid] || {})){
      if(p && typeof p.lat === 'number' && typeof p.lng === 'number') state.pins.push({id:pid, areaId:aid, name:p.name || '', note:p.note || '', typeId:p.typeId, lat:p.lat, lng:p.lng, created:p.created || 0, updated:p.updated || 0, by:p.by || ''});
    }
  }
  for(const [tid, t] of Object.entries(g.types)){
    if(!t) continue; const loc = typeById(tid);
    const data = {name:t.name, color:t.color, icon:t.icon || 'dot', text:t.text || '', svamp:!!t.svamp, updated:t.updated || 0};
    if(!loc) state.types.push(Object.assign({id:tid, visible:true}, data));
    else if(loc.ghost || (t.updated || 0) >= (loc.updated || 0)){ Object.assign(loc, data); delete loc.ghost; }
  }
  for(const p of state.pins){ if(!typeById(p.typeId)) state.types.push({id:p.typeId, name:'Okänd typ', color:'#475569', icon:'dot', text:'', svamp:false, visible:true, ghost:true, updated:0}); }
  scheduleRender();
}
const pinJson = p => ({name:p.name || '', note:p.note || '', typeId:p.typeId, lat:p.lat, lng:p.lng, created:p.created || 0, updated:p.updated || 0, by:p.by || myUid()});
const typeJson = t => ({name:t.name, color:t.color, icon:t.icon || 'dot', text:t.text || '', svamp:!!t.svamp, updated:t.updated || 0});
/* Jämför det som visas med det som ligger i molnet och skriver skillnaden. Körs vid varje sparning. */
function cloudSync(){
  if(!fb || !cloud.user) return;
  for(const g of Object.values(cloud.groups)){
    if(g.kind !== 'member' || !canEditGroup(g)) continue;
    const up = {}, want = {};
    for(const a of state.areas){ if(a.gid !== g.id) continue;
      const aj = {name:a.name, updated:a.updated || 0}; if(a.border) aj.border = a.border; if(a.lines && Object.keys(a.lines).length) aj.lines = JSON.parse(JSON.stringify(a.lines));
      if(!g.areas[a.id] || canon(g.areas[a.id]) !== canon(aj)){ up['areas/' + a.id] = aj; g.areas[a.id] = aj; }
      want[a.id] = {};
    }
    for(const p of state.pins){ if(want[p.areaId]){ if(!p.by) p.by = myUid(); want[p.areaId][p.id] = pinJson(p); } }
    for(const aid of Object.keys(g.areas)){ if(!want[aid]){ up['areas/' + aid] = null; if(g.pins[aid]) up['pins/' + aid] = null; delete g.areas[aid]; delete g.pins[aid]; } }
    const used = new Set();
    for(const [aid, pins] of Object.entries(want)){
      const have = g.pins[aid] || (g.pins[aid] = {});
      for(const [pid, pj] of Object.entries(pins)){ used.add(pj.typeId); if(!have[pid] || canon(have[pid]) !== canon(pj)){ up['pins/' + aid + '/' + pid] = pj; have[pid] = pj; } }
      for(const pid of Object.keys(have)){ if(!pins[pid]){ up['pins/' + aid + '/' + pid] = null; delete have[pid]; } }
    }
    for(const tid of used){ const t = typeById(tid); if(!t || t.ghost) continue;
      const cur = g.types[tid];
      if(!cur || ((t.updated || 0) > (cur.updated || 0) && canon(cur) !== canon(typeJson(t)))){ const tj = typeJson(t); up['types/' + tid] = tj; g.types[tid] = tj; } }
    if(Object.keys(up).length){
      fb.db.ref('groups/' + g.id).update(up).catch(() => { toast(`Ändringen kunde inte sparas i ${gname(g)}. Du kanske saknar behörighet.`, 5000); refetch(g); });
    }
  }
}
function refetch(g){
  const get = p => fb.db.ref('groups/' + g.id + '/' + p).get().then(s => s.val() || {}).catch(() => ({}));
  Promise.all([get('areas'), get('pins'), get('types')]).then(([a, p, t]) => { if(cloud.groups[g.id] !== g) return; g.areas = a; g.pins = p; g.types = t; applyRemote(g.id); });
}

/* Positioner */
const posLayer = L.layerGroup().addTo(map);
const initials = n => (n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const ago = t => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'nyss' : m < 60 ? `för ${m} min sedan` : `för ${Math.round(m / 60)} h sedan`; };
/* Positioner delas bara under en pågående jakt. Varje jakt har sina egna positioner i groups/<lag>/huntPos/<jakt>,
   och säkerhetsreglerna släpper bara igenom läsning och skrivning mellan jaktens start och slut. */
const huntLive = (h, now) => !!h && h.expires > (now || Date.now()) && !(h.starts > (now || Date.now()));
const liveHunts = g => Object.entries(g.hunts || {}).filter(([hid, h]) => huntLive(h) && (g.kind === 'member' || (g.guest && g.guest.hid === hid))).map(([hid]) => hid);
const anyLiveHunt = () => Object.values(cloud.groups).some(g => liveHunts(g).length);
/* "Jag deltar": medlemmar svarar på jaktkortet. Den som gått med som gäst via jaktkod deltar alltid. */
const accepted = (g, hid) => g.kind === 'member' ? !!((g.huntRsvp || {})[hid] || {})[myUid()] : !!(g.guest && g.guest.hid === hid);
const acceptedLive = () => Object.values(cloud.groups).flatMap(g => liveHunts(g).filter(hid => accepted(g, hid)).map(hid => g.id + '/' + hid));
/* Delar positionen automatiskt när en jakt man deltar i startar, och slutar när den är slut.
   Stänger man av delningen själv under jakten startas den inte igen automatiskt för den jakten. */
function autoShare(){
  if(!fb || !cloud.user) return;
  const live = acceptedLive().filter(k => !cloud.autoOff[k]);   // jakter där man själv stängt av räknas inte
  if(cloud.sharing && cloud.autoShared && !live.length){ stopSharing(); toast('Jakten är slut. Din position delas inte längre.', 5000); return; }
  if(cloud.sharing || !live.length) return;
  startSharing();
  if(cloud.sharing){ cloud.autoShared = true; toast('Jakten har startat. Din position delas med jaktlaget medan appen är öppen.', 5000); }
}
let huntPosTimer = null;
function syncHuntPos(){
  if(!fb || !cloud.user) return;
  let next = Infinity;
  for(const g of Object.values(cloud.groups)){
    const live = new Set(liveHunts(g));
    for(const hid of Object.keys(g.posRefs)) if(!live.has(hid)){ g.posRefs[hid].off(); delete g.posRefs[hid]; delete g.huntPos[hid]; delete g.disc[hid]; }
    for(const hid of Object.keys(g.trailRefs)) if(!live.has(hid)){ g.trailRefs[hid].off(); delete g.trailRefs[hid]; delete g.huntTrail[hid]; }
    for(const hid of Object.keys(g.obsRefs)) if(!live.has(hid)){ g.obsRefs[hid].off(); delete g.obsRefs[hid]; delete g.huntObs[hid]; }
    for(const hid of live){
      if(!g.obsRefs[hid]){
        const or = fb.db.ref(`groups/${g.id}/huntObs/${hid}`);
        or.on('value', s => { if(g.obsRefs[hid] === or){ g.huntObs[hid] = s.val() || {}; renderObs(); scheduleRender(); } }, () => { if(g.obsRefs[hid] === or){ delete g.obsRefs[hid]; delete g.huntObs[hid]; renderObs(); } });
        g.obsRefs[hid] = or;
      }
      if(!g.trailRefs[hid]){
        const tr = fb.db.ref(`groups/${g.id}/huntTrail/${hid}`);
        tr.on('value', s => { if(g.trailRefs[hid] === tr){ g.huntTrail[hid] = s.val() || {}; renderTrails(); } }, () => { if(g.trailRefs[hid] === tr){ delete g.trailRefs[hid]; delete g.huntTrail[hid]; renderTrails(); } });
        g.trailRefs[hid] = tr;
      }
      if(g.posRefs[hid]) continue;
      const r = fb.db.ref(`groups/${g.id}/huntPos/${hid}`);
      r.on('value', s => { if(g.posRefs[hid] === r){ g.huntPos[hid] = s.val() || {}; renderPositions(); } }, () => { if(g.posRefs[hid] === r){ delete g.posRefs[hid]; delete g.huntPos[hid]; renderPositions(); } });
      g.posRefs[hid] = r;
    }
    // Nästa gång en jakt startar eller slutar
    for(const h of Object.values(g.hunts || {})) if(h){ for(const t of [h.starts, h.expires]) if(t > Date.now() && t < next) next = t; }
  }
  if(cloud.sharing && !anyLiveHunt()){ stopSharing(); toast('Jakten är slut. Din position delas inte längre.', 5000); }
  autoShare();
  renderPositions(); renderObs(); scheduleRender();
  clearTimeout(huntPosTimer);
  if(next < Infinity) huntPosTimer = setTimeout(syncHuntPos, Math.min(next - Date.now() + 1000, 2147483000));
}
function activePositions(){
  const seen = {}, out = [];
  for(const g of Object.values(cloud.groups)) for(const pos of Object.values(g.huntPos || {})) for(const [uid, p] of Object.entries(pos || {})){
    if(!p || uid === myUid() || seen[uid] || typeof p.lat !== 'number' || Date.now() - p.t > 30 * 60000) continue;
    seen[uid] = true; out.push(Object.assign({uid}, p));
  }
  return out;
}
function renderPositions(){
  posLayer.clearLayers();
  for(const p of activePositions()){
    const m = L.marker([p.lat, p.lng], {icon:L.divIcon({className:'pos-icon', html:`<span class="pos-dot" style="background:${personColor(p.uid)}">${esc(initials(p.name))}</span><span class="pos-name">${esc(p.name || 'Jägare')}</span>`, iconSize:[32,32], iconAnchor:[16,16], popupAnchor:[0,-14]}), zIndexOffset:500});
    m.bindPopup(() => h(`<div class="pp"><h4>${esc(p.name || 'Jägare')}</h4><div class="pnote">Position ${ago(p.t)}${p.acc ? ` · ±${Math.round(p.acc)} m` : ''}${myPos ? `<br>${fmtDist(distM(myPos, p))} bort` : ''}</div><div class="pbtns"><a class="navbtn" href="${navUrl(p.lat, p.lng)}" target="_blank" rel="noopener">${ICON_NAV}Navigera</a></div></div>`), {maxWidth:260});
    m.addTo(posLayer);
  }
  const el = $('#posCount'); if(el) el.textContent = posCountText();
  renderTrails();
}
const posCountText = () => { if(!anyLiveHunt()) return 'Positioner kan bara delas och ses medan en jakt pågår.'; const n = activePositions().length; return n ? `${n} ${n === 1 ? 'person delar' : 'personer delar'} sin position just nu.` : 'Ingen annan delar sin position just nu.'; };
setInterval(renderPositions, 60000);

/* Viltobservationer under jakten. Sparas bara i den pågående jakten (groups/<lag>/huntObs/<jakt>),
   syns bara medan jakten pågår och raderas när jakten avslutas. */
const obsLayer = L.layerGroup().addTo(map);
const obsKey = s => String(s || '?').replace(/[^A-Za-zÅÄÖåäö]/g, '').slice(0, 2) || '?';
function obsAll(){
  const out = [];
  for(const g of Object.values(cloud.groups)) for(const hid of liveHunts(g)) for(const [oid, o] of Object.entries(g.huntObs[hid] || {}))
    if(o && typeof o.lat === 'number' && typeof o.lng === 'number') out.push(Object.assign({oid, hid, g}, o));
  return out.sort((a, b) => b.t - a.t);
}
const canDelObs = o => o.by === myUid() || (o.g.kind === 'member' && canLeadGroup(o.g));
function renderObs(){
  obsLayer.clearLayers();
  const b = $('#btnObs'); if(b) b.hidden = !anyLiveHunt();
  for(const o of obsAll()){
    const m = L.marker([o.lat, o.lng], {icon:L.divIcon({className:'obs-icon', html:`<span class="obs-dot">${esc(obsKey(o.sp))}</span>${o.n > 1 ? `<span class="obs-n">${o.n}</span>` : ''}`, iconSize:[30, 30], iconAnchor:[15, 15], popupAnchor:[0, -14]}), zIndexOffset:400});
    m.bindPopup(() => {
      const el = h(`<div class="pp"><h4>${esc(o.sp)}${o.n > 1 ? ' × ' + o.n : ''}</h4><div class="pnote">Sedd ${esc(fmtClock(o.t))} (${ago(o.t)})${o.name ? ' av ' + esc(o.name) : ''}${o.note ? '<br>' + esc(o.note) : ''}${myPos ? `<br>${fmtDist(distM(myPos, o))} bort` : ''}</div>${canDelObs(o) ? '<div class="pbtns"><button class="btn sm danger" type="button" data-obs-del>Ta bort</button></div>' : ''}</div>`);
      const d = el.querySelector('[data-obs-del]');
      if(d) d.addEventListener('click', () => confirmClick(d, 'Bekräfta', () => { map.closePopup(); fb.db.ref(`groups/${o.g.id}/huntObs/${o.hid}/${o.oid}`).remove().then(() => toast('Observationen är borttagen.')).catch(fail()); }));
      return el;
    });
    m.addTo(obsLayer);
  }
}
const fmtClock = t => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`; };
function obsList(g, hid){
  const list = Object.entries(g.huntObs[hid] || {}).filter(([, o]) => o).sort((a, b) => b[1].t - a[1].t);
  return `<div class="lbl">Viltobservationer</div>` + (list.length ? list.map(([oid, o]) => `<button class="obs-row" type="button" data-j="obs-go" data-g="${g.id}" data-h="${hid}" data-o="${oid}"><span class="obs-dot sm">${esc(obsKey(o.sp))}</span><span><b>${esc(o.sp)}</b>${o.n > 1 ? ' × ' + o.n : ''} <span class="muted">${esc(fmtClock(o.t))}${o.name ? ' · ' + esc(o.name) : ''}</span>${o.note ? `<br><span class="small">${esc(o.note)}</span>` : ''}</span></button>`).join('')
    : '<div class="small muted">Inga ännu. Tryck på kikaren på kartan för att lägga in en.</div>');
}
function openObsForm(ll){
  const hunts = [];
  for(const g of Object.values(cloud.groups)) for(const hid of liveHunts(g)) hunts.push({g, hid, hunt:g.hunts[hid]});
  if(!hunts.length){ toast('Observationer kan bara läggas in under en pågående jakt.'); return; }
  const sel = hunts[0], sp = h0 => { const ids = Object.keys((h0.hunt || {}).species || {}).filter(k => h0.hunt.species[k]); return ids.map(viltById).filter(Boolean); };
  const opts = h0 => { const first = sp(h0), rest = VILT.filter(v => !first.includes(v)); return (first.length ? `<optgroup label="Jaktbart i jakten">${first.map(v => `<option>${esc(v.name)}</option>`).join('')}</optgroup>` : '') + `<optgroup label="Övrigt vilt">${rest.map(v => `<option>${esc(v.name)}</option>`).join('')}</optgroup><option value="__other">Annat …</option>`; };
  openModal(`<h2>Viltobservation</h2><form id="obForm">
    ${hunts.length > 1 ? `<label class="field"><span>Jakt</span><select class="input" id="obHunt">${hunts.map((x, i) => `<option value="${i}">${esc(x.hunt.name)} · ${esc(gname(x.g))}</option>`).join('')}</select></label>` : `<p class="note" style="margin-top:0">Sparas i jakten <b>${esc(sel.hunt.name)}</b> och syns för alla deltagare så länge jakten pågår.</p>`}
    <div class="row2"><label class="field"><span>Vilt</span><select class="input" id="obSp">${opts(sel)}</select></label>
    <label class="field"><span>Antal</span><input class="input" id="obN" type="number" inputmode="numeric" min="1" max="999" value="1"></label></div>
    <input class="input" id="obOther" maxlength="40" placeholder="Vilket vilt?" hidden>
    <label class="field"><span>Anteckning (valfritt)</span><input class="input" id="obNote" maxlength="200" placeholder="Till exempel: hind och kalv, gick mot norr"></label>
    <div class="actions"><button class="btn primary grow" type="submit">Spara</button><button class="btn ghost" type="button" id="obCancel">Avbryt</button></div></form>`, m => {
    const hs = m.querySelector('#obHunt'), spSel = m.querySelector('#obSp'), other = m.querySelector('#obOther');
    if(hs) hs.addEventListener('change', () => { spSel.innerHTML = opts(hunts[+hs.value]); other.hidden = true; });
    spSel.addEventListener('change', () => { other.hidden = spSel.value !== '__other'; if(!other.hidden) other.focus(); });
    m.querySelector('#obCancel').addEventListener('click', closeModal);
    m.querySelector('#obForm').addEventListener('submit', e => {
      e.preventDefault();
      const x = hunts[hs ? +hs.value : 0], name = spSel.value === '__other' ? other.value.trim() : spSel.value;
      if(!name){ toast('Skriv vilket vilt.'); return; }
      const n = Math.max(1, Math.min(999, parseInt(m.querySelector('#obN').value, 10) || 1)), note = m.querySelector('#obNote').value.trim();
      const o = {sp:name.slice(0, 40), n, lat:+ll.lat.toFixed(6), lng:+ll.lng.toFixed(6), t:Date.now(), by:myUid(), name:myName()}; if(note) o.note = note.slice(0, 200);
      closeModal();
      fb.db.ref(`groups/${x.g.id}/huntObs/${x.hid}`).push(o).then(() => toast(`${o.sp} är sparad i jakten.`)).catch(fail('Observationen kunde inte sparas. Pågår jakten fortfarande?'));
    });
  });
}

/* Spår: var man själv och andra deltagare har varit de senaste minuterna.
   Det egna spåret sparas bara i den här webbläsaren. Deltagarnas spår finns i groups/<lag>/huntTrail/<jakt> under jakten. */
const TRAIL_KEY = 'faltkartan.trail', TRAIL_KEEP = 12 * 3600000, TRAIL_GAP = 5 * 60000;
const PERSON_COLORS = ['#e11d48', '#7c3aed', '#0891b2', '#ca8a04', '#16a34a', '#db2777', '#4f46e5', '#ea580c'];
const personColor = id => { let h = 0; for(const c of String(id || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PERSON_COLORS[h % PERSON_COLORS.length]; };
const trailLayer = L.layerGroup().addTo(map);
const trail = {own:[], watchId:null, wake:null, timer:null};
try { const v = JSON.parse(lsGet(TRAIL_KEY) || '[]'); if(Array.isArray(v)) trail.own = v.filter(p => p && typeof p.lat === 'number' && typeof p.lng === 'number' && Date.now() - p.t < TRAIL_KEEP); } catch(e){}
const trailMinutes = () => { const v = state.settings.trailMin; return typeof v === 'number' && v >= 0 ? v : 30; };
function trailAdd(lat, lng, acc){
  if(acc > 100) return;
  const now = Date.now(), last = trail.own[trail.own.length - 1];
  if(last && now - last.t < 60000 && distM(last, {lat, lng}) < 5) return;
  trail.own.push({lat:+lat.toFixed(6), lng:+lng.toFixed(6), t:now});
  trail.own = trail.own.filter(p => now - p.t < TRAIL_KEEP).slice(-5000);
  lsSet(TRAIL_KEY, JSON.stringify(trail.own));
  renderTrails();
}
/* Delar upp punkterna i sträckor där det inte är för långt glapp i tid. */
function trailSegments(pts, since){
  const segs = []; let cur = [], prev = null;
  for(const p of pts){
    if(p.t < since) continue;
    if(prev && p.t - prev.t > TRAIL_GAP){ if(cur.length > 1) segs.push(cur); cur = []; }
    cur.push([p.lat, p.lng]); prev = p;
  }
  if(cur.length > 1) segs.push(cur);
  return segs;
}
function renderTrails(){
  clearTimeout(trail.timer);
  trail.timer = setTimeout(() => {
    trailLayer.clearLayers();
    const min = trailMinutes(); if(!min) return;
    const since = Date.now() - min * 60000;
    const draw = (segs, color) => { for(const seg of segs){
      L.polyline(seg, {color:'#ffffff', weight:6, opacity:.75, interactive:false}).addTo(trailLayer);
      L.polyline(seg, {color, weight:3.5, opacity:.95, interactive:false, lineCap:'round', lineJoin:'round'}).addTo(trailLayer); } };
    draw(trailSegments(trail.own, since), '#1a73e8');
    const people = {};
    for(const g of Object.values(cloud.groups)){
      for(const pts of Object.values(g.huntTrail || {})) for(const [u, list] of Object.entries(pts || {})){
        if(u === myUid() || !list) continue;
        (people[u] = people[u] || []).push(...Object.values(list).filter(p => p && typeof p.lat === 'number' && typeof p.lng === 'number' && typeof p.t === 'number'));
      }
      for(const pos of Object.values(g.huntPos || {})) for(const [u, p] of Object.entries(pos || {})) if(u !== myUid() && people[u] && p && typeof p.lat === 'number') people[u].push({lat:p.lat, lng:p.lng, t:p.t});
    }
    for(const [u, list] of Object.entries(people)) draw(trailSegments(list.sort((a, b) => a.t - b.t), since), personColor(u));
  }, 150);
}
setInterval(renderTrails, 60000);
function renderTrailControls(){
  const r = $('#trailMin'); if(!r) return;
  const v = trailMinutes(); r.value = v;
  $('#trailMinTxt').textContent = v ? (v >= 60 ? `${Math.floor(v / 60)} h${v % 60 ? ' ' + (v % 60) + ' min' : ''}` : `${v} min`) : 'Av';
  $('#popTrailRec').checked = trail.watchId != null;
  $('#trailNote').textContent = trail.watchId != null ? 'Spelar in. Skärmen hålls tänd medan appen är öppen.' : 'Visar var du har gått. Sparas bara i din telefon.';
}
function startTrailRec(){
  if(!('geolocation' in navigator)){ toast('Den här webbläsaren kan inte ge din position.'); renderTrailControls(); return; }
  trail.watchId = navigator.geolocation.watchPosition(pos => showMe(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy || 0),
    err => { stopTrailRec(); toast(err.code === 1 ? 'Positionen är blockerad. Tillåt plats för sidan i webbläsarens inställningar.' : 'Kunde inte läsa din position.'); }, {enableHighAccuracy:true, maximumAge:5000, timeout:30000});
  try { if(navigator.wakeLock) navigator.wakeLock.request('screen').then(l => { trail.wake = l; }).catch(() => {}); } catch(e){}
  if(!trailMinutes()){ state.settings.trailMin = 30; save(); }
  renderTrailControls(); renderTrails();
}
function stopTrailRec(){
  if(trail.watchId != null){ navigator.geolocation.clearWatch(trail.watchId); trail.watchId = null; }
  if(trail.wake){ try { trail.wake.release(); } catch(e){} trail.wake = null; }
  renderTrailControls();
}
$('#trailMin').addEventListener('input', e => { state.settings.trailMin = +e.target.value; renderTrailControls(); renderTrails(); });
$('#trailMin').addEventListener('change', () => save());
$('#popTrailRec').addEventListener('change', e => { if(e.target.checked) startTrailRec(); else stopTrailRec(); });
function clearOwnTrail(){ trail.own = []; try { localStorage.removeItem(TRAIL_KEY); } catch(e){} renderTrails(); }
/* Vart positionen skickas: startade man själv, till alla pågående jakter. Startade den automatiskt, bara till jakterna man deltar i. */
const shareHunts = g => liveHunts(g).filter(hid => !cloud.autoShared || (accepted(g, hid) && !cloud.autoOff[g.id + '/' + hid]));
function sendPos(){
  if(!fb || !cloud.user || !myPos) return;
  for(const g of Object.values(cloud.groups)) for(const hid of shareHunts(g)){
    const r = fb.db.ref(`groups/${g.id}/huntPos/${hid}/${myUid()}`);
    if(!g.disc[hid]){ g.disc[hid] = true; try { r.onDisconnect().remove(); } catch(e){} }
    r.set({lat:+myPos.lat.toFixed(6), lng:+myPos.lng.toFixed(6), acc:Math.round(myPos.acc || 0), t:Date.now(), name:myName()}).catch(() => {});
  }
  // Spårpunkt när man flyttat sig minst 10 m, eller varje minut
  const lt = cloud.lastTrail, now = Date.now();
  if((myPos.acc || 0) <= 100 && (!lt || now - lt.t >= 60000 || distM(lt, myPos) >= 10)){
    cloud.lastTrail = {lat:myPos.lat, lng:myPos.lng, t:now};
    for(const g of Object.values(cloud.groups)) for(const hid of shareHunts(g))
      fb.db.ref(`groups/${g.id}/huntTrail/${hid}/${myUid()}`).push({lat:+myPos.lat.toFixed(6), lng:+myPos.lng.toFixed(6), t:now}).catch(() => {});
  }
}
function startSharing(){
  if(!('geolocation' in navigator)){ toast('Den här webbläsaren kan inte ge din position.'); return; }
  if(!anyLiveHunt()){ toast('Positioner kan bara delas medan en jakt pågår.'); renderJakt(); return; }
  cloud.sharing = true; cloud.lastSent = 0; cloud.lastTrail = null;
  cloud.watchId = navigator.geolocation.watchPosition(pos => {
    showMe(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy || 0);
    if(Date.now() - cloud.lastSent < 8000) return;
    cloud.lastSent = Date.now(); sendPos();
  }, err => { for(const k of acceptedLive()) cloud.autoOff[k] = true; stopSharing(); toast(err.code === 1 ? 'Positionen är blockerad. Tillåt plats för sidan i webbläsarens inställningar.' : 'Kunde inte läsa din position.'); renderJakt(); }, {enableHighAccuracy:true, maximumAge:5000, timeout:30000});
  try { if(navigator.wakeLock) navigator.wakeLock.request('screen').then(l => { cloud.wake = l; }).catch(() => {}); } catch(e){}
  renderJakt();
}
function stopSharing(silent){
  if(cloud.watchId != null){ navigator.geolocation.clearWatch(cloud.watchId); cloud.watchId = null; }
  if(cloud.wake){ try { cloud.wake.release(); } catch(e){} cloud.wake = null; }
  const was = cloud.sharing; cloud.sharing = false; cloud.autoShared = false;
  if(was && !silent && fb && cloud.user) for(const g of Object.values(cloud.groups)) for(const hid of liveHunts(g)){ fb.db.ref(`groups/${g.id}/huntPos/${hid}/${myUid()}`).remove().catch(() => {}); fb.db.ref(`groups/${g.id}/huntTrail/${hid}/${myUid()}`).remove().catch(() => {}); }
}

/* Åtgärder */
const fail = msg => () => toast(msg || 'Det gick inte. Kontrollera nätverket och dina rättigheter.', 5000);
function createGroup(name){
  const gid = uid(), u = myUid(), up = {};
  up[`groups/${gid}/meta`] = {name, owner:u, created:Date.now()};
  up[`groups/${gid}/members/${u}`] = {role:'admin', name:myName(), joined:Date.now()};
  up[`userGroups/${u}/${gid}`] = 'member';
  return fb.db.ref().update(up).then(() => toast(`Jaktlaget ”${name}” skapades`)).catch(fail());
}
async function joinByCode(raw){
  const c = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); if(!c) return;
  if(!fb || !cloud.user){ cloud.pending = c; renderJakt(); return; }
  const u = myUid();
  try {
    const inv = (await fb.db.ref('invites/' + c).get()).val();
    if(inv){
      if(inv.expires < Date.now()){ toast('Inbjudan har gått ut. Be om en ny.'); return; }
      if(cloud.groups[inv.gid] && cloud.groups[inv.gid].kind === 'member'){ toast('Du är redan med i det jaktlaget.'); return; }
      if(cloud.groups[inv.gid]){ await fb.db.ref(`groups/${inv.gid}/guests/${u}`).remove().catch(() => {}); dropGroup(inv.gid); }
      await fb.db.ref(`groups/${inv.gid}/members/${u}`).set({role:inv.role, name:myName(), code:c, joined:Date.now()});
      await fb.db.ref(`userGroups/${u}/${inv.gid}`).set('member');
      toast(`Du är nu med som ${ROLES[inv.role].toLowerCase()}.`); return;
    }
    const hc = (await fb.db.ref('huntCodes/' + c).get()).val();
    if(hc){
      if(hc.expires < Date.now()){ toast('Jakten är avslutad, koden gäller inte längre.'); return; }
      if(cloud.groups[hc.gid]){ toast(cloud.groups[hc.gid].kind === 'member' ? 'Du är redan med i jaktlaget och ser jakten under Jakt.' : 'Du är redan med i den jakten.'); return; }
      await fb.db.ref(`groups/${hc.gid}/guests/${u}`).set({hid:hc.hid, code:c, name:myName(), expires:hc.expires});
      await fb.db.ref(`userGroups/${u}/${hc.gid}`).set('guest');
      toast('Du är med i jakten som gäst.'); return;
    }
    toast('Koden hittades inte. Kontrollera att den är rätt.');
  } catch(e){ toast('Det gick inte att gå med. Koden kan ha gått ut.', 5000); }
}
const shareLink = (kind, c) => `${location.origin}${location.pathname}#${kind}-${c}${BAKED_CFG ? '' : '.' + b64e(JSON.stringify(cloud.cfg))}`;
function copyText(text, okMsg){
  const fallback = () => openModal(`<h2>Kopiera</h2><textarea class="input" id="cpText" readonly style="min-height:110px">${esc(text)}</textarea><div class="actions"><button class="btn primary grow" type="button" id="cpClose">Klar</button></div>`, m => { const t = m.querySelector('#cpText'); t.focus(); t.select(); m.querySelector('#cpClose').addEventListener('click', closeModal); });
  try { navigator.clipboard.writeText(text).then(() => toast(okMsg || 'Kopierat'), fallback); } catch(e){ fallback(); }
}
function readHash(){
  const m = /^#([lj])-([A-Za-z0-9]+)(?:\.([A-Za-z0-9_-]+))?$/.exec(location.hash || ''); if(!m) return;
  if(m[3] && !loadCfg()){ try { const cfg = parseCfg(b64d(m[3])) || JSON.parse(b64d(m[3])); if(cfg && cfg.apiKey && cfg.databaseURL) lsSet(FBKEY, JSON.stringify(cfg)); } catch(e){} }
  cloud.pending = m[2].toUpperCase();
  try { history.replaceState(null, '', location.pathname + location.search); } catch(e){}
}

/* Jakt-fliken */
function huntChips(hunt){ const ids = Object.keys(hunt.species || {}).filter(k => hunt.species[k]); return ids.length ? `<div class="chips">${ids.map(id => `<span class="chip">${esc((viltById(id) || {name:id}).name)}</span>`).join('')}</div>` : '<div class="small muted">Inget vilt valt.</div>'; }
const fmtDay = d => d ? `${+d.slice(8)} ${MON[+d.slice(5,7) - 1]} ${d.slice(0,4)}` : '';
const fmtTime = t => { const d = new Date(t); return `${fmtDay(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`)} kl. ${String(d.getHours()).padStart(2,'0')}.${String(d.getMinutes()).padStart(2,'0')}`; };
function huntCard(g, hid, hunt, lead){
  const now = Date.now(), live = hunt.expires > now, upcoming = live && hunt.starts > now;
  const guests = Object.entries(g.guests || {}).filter(([, v]) => v && v.hid === hid);
  const areas = Object.keys(hunt.areas || {}).map(a => (g.areas[a] || {}).name).filter(Boolean);
  return `<div class="card${live ? '' : ' dim'}"><div class="card-h"><strong>${esc(hunt.name)}</strong><span class="tag${live && !upcoming ? ' on' : ''}">${upcoming ? 'Kommande' : live ? 'Pågår' : 'Avslutad'}</span></div>
    <div class="small muted">${esc(fmtDay(hunt.day))}${hunt.lan ? ' · ' + esc(hunt.lan) : ''}${hunt.starts ? ` · startar ${esc(fmtTime(hunt.starts))}` : ''} · gäller till ${esc(fmtTime(hunt.expires))}</div>
    <div class="lbl">Jaktbart vilt</div>${huntChips(hunt)}
    ${live ? rsvpHtml(g, hid) : ''}
    ${live ? planCardHtml(g, hid, hunt, lead) : ''}
    ${live && !upcoming ? obsList(g, hid) : ''}
    ${areas.length ? `<div class="lbl">Områden</div><div class="small">${areas.map(esc).join(', ')}</div>` : ''}
    ${lead && live ? `<div class="lbl">Tillfällig åtkomst för gäster</div><div class="codebox"><span>Jaktkod <b>${esc(hunt.code)}</b></span><button class="btn sm" type="button" data-j="hunt-link" data-g="${g.id}" data-h="${hid}">Kopiera länk</button></div>
      ${guests.length ? `<div class="small" style="margin-top:6px">${guests.map(([gu, v]) => `<span class="gst">${esc(v.name)}<button class="x" type="button" data-j="guest-del" data-g="${g.id}" data-u="${gu}" aria-label="Ta bort ${esc(v.name)}">×</button></span>`).join(' ')}</div>` : '<div class="small muted" style="margin-top:6px">Inga gäster har gått med.</div>'}` : ''}
    ${lead ? `<div class="btnrow" style="margin-top:10px"><button class="btn sm danger" type="button" data-j="hunt-end" data-g="${g.id}" data-h="${hid}">${live ? 'Avsluta jakten' : 'Ta bort'}</button></div>` : ''}</div>`;
}
/* Vilka som deltar, och knappen Jag deltar. Gäster deltar alltid (de har gått med via jaktkoden). */
function rsvpHtml(g, hid){
  const auto = 'Din position delas automatiskt med jaktlaget medan jakten pågår och appen är öppen.';
  if(g.kind !== 'member') return `<p class="note">${auto}</p>`;
  const names = Object.values((g.huntRsvp || {})[hid] || {}).filter(Boolean).map(v => v.name || 'Medlem')
    .concat(Object.values(g.guests || {}).filter(v => v && v.hid === hid).map(v => (v.name || 'Gäst') + ' (gäst)'))
    .sort((a, b) => a.localeCompare(b, 'sv'));
  const me = accepted(g, hid);
  return `<div class="lbl">Deltar${names.length ? ' (' + names.length + ')' : ''}</div><div class="small rsvp-list">${names.length ? names.map(esc).join(', ') : '<span class="muted">Ingen har svarat ännu.</span>'}</div>
    <div class="btnrow" style="margin-top:6px">${me ? `<span class="tag on">Du deltar</span><button class="btn sm ghost" type="button" data-j="rsvp-no" data-g="${g.id}" data-h="${hid}">Avböj</button>` : `<button class="btn sm primary" type="button" data-j="rsvp" data-g="${g.id}" data-h="${hid}">Jag deltar</button>`}</div>
    <p class="note" style="margin-top:4px">${me ? auto : 'Deltar du delas din position automatiskt med jaktlaget medan jakten pågår.'}</p>`;
}
function renderJakt(){
  const pane = $('#paneJakt'); if(!pane) return;
  let html = '';
  const st = cloud.status;
  if(st === 'off' || st === 'error'){
    html += `${st === 'error' ? `<div class="banner"><span>${esc(cloud.err)}</span></div>` : ''}
      <h3 class="sec">Koppla på delning</h3>
      <p class="note" style="margin-top:0">Delade nålar, jakter och positioner sparas i ett eget Firebase-projekt som du äger. Gör så här en gång:</p>
      <ol class="steps"><li>Skapa ett projekt på console.firebase.google.com och lägg till en webbapp.</li><li>Slå på Authentication med Google och Anonym.</li><li>Skapa en Realtime Database (Europa) och klistra in reglerna nedan under Regler.</li><li>Klistra in webbappens konfiguration här.</li></ol>
      <div class="btnrow"><button class="btn sm" type="button" data-j="copy-rules">Kopiera säkerhetsregler</button></div>
      <label class="field" style="margin-top:12px"><span>Firebase-konfiguration</span><textarea class="input" id="fbCfg" placeholder="const firebaseConfig = { apiKey: &quot;…&quot;, authDomain: &quot;…&quot;, databaseURL: &quot;…&quot;, projectId: &quot;…&quot; }" style="font-family:var(--font-mono);font-size:13px"></textarea></label>
      <div class="btnrow"><button class="btn primary" type="button" data-j="cfg-save">Spara och anslut</button></div>
      ${location.protocol === 'file:' ? '<p class="note">Inloggning fungerar bara när appen ligger på en webbadress (https), inte när filen öppnas direkt.</p>' : ''}`;
  } else if(st === 'loading'){
    html += `<div class="empty">Ansluter …</div>`;
  } else if(st === 'out'){
    html += `<h3 class="sec">Logga in</h3>
      ${cloud.pending ? `<div class="banner"><span>Du har en inbjudan med kod <b>${esc(cloud.pending)}</b>. Logga in för att gå med.</span></div>` : ''}
      <div class="btnrow"><button class="btn primary" type="button" data-j="login-google">Logga in med Google</button></div>
      <h3 class="sec">Gäst på en jakt</h3>
      <p class="note" style="margin-top:0">Har du fått en jaktkod behöver du inget konto. Åtkomsten gäller bara den jakten och försvinner när den avslutas.</p>
      <label class="field" style="margin-top:8px"><span>Ditt namn</span><input class="input" id="gName" maxlength="40" value="${esc(lsGet(NAMEKEY) || '')}" placeholder="Syns för jaktlaget"></label>
      <label class="field"><span>Jaktkod</span><input class="input" id="gCode" maxlength="12" value="${esc(cloud.pending || '')}" autocapitalize="characters" autocomplete="off"></label>
      <div class="btnrow"><button class="btn" type="button" data-j="login-guest">Gå med som gäst</button></div>
      ${BAKED_CFG ? '' : '<p class="note"><button class="linkbtn" type="button" data-j="cfg-reset">Byt Firebase-projekt</button></p>'}`;
  } else {
    const u = cloud.user, gs = Object.values(cloud.groups);
    html += `<div class="userrow"><span class="pos-dot">${esc(initials(myName()))}</span><span class="grow"><strong>${esc(myName())}</strong><br><span class="small muted">${u.isAnonymous ? 'Gäst' : esc(u.email || 'Inloggad')}</span></span><button class="btn sm" type="button" data-j="name">Byt namn</button><button class="btn sm ghost" type="button" data-j="logout">Logga ut</button></div>
      <label class="bigtoggle" for="shareToggle" style="margin-top:10px"><span><strong>Dela min position</strong><br><span class="small muted">Syns bara för deltagarna i pågående jakter</span></span><input class="sw-toggle" type="checkbox" id="shareToggle" ${cloud.sharing ? 'checked' : ''} ${anyLiveHunt() ? '' : 'disabled'}></label>
      <p class="note" id="posCount">${posCountText()}</p>
      ${cloud.sharing ? '<p class="note">Positionen skickas bara medan appen är öppen och skärmen är på.</p>' : ''}`;
    for(const g of gs){
      if(!g.meta) continue;
      if(g.kind === 'guest'){
        const hid = g.guest && g.guest.hid, hunt = hid && g.hunts[hid];
        html += `<h3 class="sec">${esc(gname(g))} <span class="tag">Gäst</span></h3>${hunt ? huntCard(g, hid, hunt, false) : '<div class="empty">Jakten laddas eller är avslutad.</div>'}
          <div class="btnrow"><button class="btn sm" type="button" data-j="guest-leave" data-g="${g.id}">Lämna jakten</button></div>`;
        continue;
      }
      const role = myRole(g), lead = canLeadGroup(g), adm = isAdminGroup(g);
      const hunts = Object.entries(g.hunts || {}).filter(([, v]) => v).sort((a, b) => b[1].expires - a[1].expires);
      const members = Object.entries(g.members || {}).filter(([, v]) => v).sort((a, b) => (a[1].name || '').localeCompare(b[1].name || '', 'sv'));
      const shared = state.areas.filter(a => a.gid === g.id);
      html += `<h3 class="sec">${esc(gname(g))} <span class="tag">${esc(ROLES[role] || '')}</span></h3>`;
      html += hunts.length ? hunts.map(([hid, hunt]) => huntCard(g, hid, hunt, lead)).join('') : '<p class="note" style="margin-top:0">Ingen jakt är skapad.</p>';
      if(lead) html += `<div class="btnrow"><button class="btn primary sm" type="button" data-j="hunt-new" data-g="${g.id}">Ny jakt</button></div>`;
      html += `<div class="lbl">Delade områden</div><div class="small">${shared.length ? shared.map(a => esc(a.name)).join(', ') : '<span class="muted">Inga ännu. Öppna Filter, tryck på pennan vid ett område och välj att dela det med laget.</span>'}</div>`;
      html += `<div class="lbl">Medlemmar och rättigheter</div>`;
      for(const [mu, m] of members){
        const isOwner = g.meta.owner === mu;
        html += `<div class="frow"><span class="fname">${esc(m.name || 'Medlem')}${mu === u.uid ? ' <span class="muted">(du)</span>' : ''}</span>${adm && !isOwner ? `<select class="input rolesel" data-j="role" data-g="${g.id}" data-u="${mu}" aria-label="Rättighet för ${esc(m.name)}">${Object.entries(ROLES).map(([k, l]) => `<option value="${k}"${m.role === k ? ' selected' : ''}>${l}</option>`).join('')}</select><button class="iconbtn" type="button" data-j="member-del" data-g="${g.id}" data-u="${mu}" aria-label="Ta bort ${esc(m.name)}">${ICON_TRASH}</button>` : `<span class="tag">${isOwner ? 'Ägare' : esc(ROLES[m.role] || '')}</span>`}</div>`;
      }
      if(adm) html += `<p class="note">${Object.entries(ROLES).map(([k, l]) => `<b>${l}</b>: ${ROLE_HELP[k].toLowerCase()}`).join(' · ')}.</p><div class="btnrow"><button class="btn sm" type="button" data-j="invite" data-g="${g.id}">Bjud in medlem</button></div>`;
      html += `<div class="btnrow" style="margin-top:8px">${g.meta.owner === u.uid ? `<button class="btn sm danger" type="button" data-j="group-del" data-g="${g.id}">Ta bort jaktlaget</button>` : `<button class="btn sm" type="button" data-j="group-leave" data-g="${g.id}">Lämna jaktlaget</button>`}</div>`;
    }
    html += `<h3 class="sec">Fler jaktlag</h3><div class="btnrow">${canCreate() ? '<button class="btn sm" type="button" data-j="group-new">Skapa jaktlag</button>' : ''}<button class="btn sm" type="button" data-j="join">Gå med med kod</button></div>
      ${u.isAnonymous ? '<p class="note">Som gäst kan du gå med i jakter. Logga in med Google för att bli medlem i ett jaktlag.</p>' : canCreate() ? '' : '<p class="note">Bara ägaren av den här Jaktkartan kan skapa jaktlag. Du går med i ett lag eller en jakt med en kod.</p>'}`;
  }
  pane.innerHTML = html;
  // Stänger man av själv under en jakt man deltar i startar delningen inte automatiskt igen för den jakten.
  const stg = $('#shareToggle'); if(stg) stg.addEventListener('change', e => { if(e.target.checked){ cloud.autoOff = {}; startSharing(); } else { for(const k of acceptedLive()) cloud.autoOff[k] = true; stopSharing(); renderJakt(); } });
}
function askText(title, label, value, okLabel, cb, max){
  openModal(`<h2>${esc(title)}</h2><form id="atForm"><label class="field"><span>${esc(label)}</span><input class="input" id="atVal" maxlength="${max || 60}" value="${esc(value || '')}" autocomplete="off"></label>
    <div class="actions"><button class="btn primary grow" type="submit">${esc(okLabel)}</button><button class="btn ghost" type="button" id="atCancel">Avbryt</button></div></form>`, m => {
    m.querySelector('#atCancel').addEventListener('click', closeModal);
    m.querySelector('#atForm').addEventListener('submit', e => { e.preventDefault(); const v = m.querySelector('#atVal').value.trim(); if(!v) return; closeModal(); cb(v); });
  });
}
function openHuntForm(g){
  const areas = state.areas.filter(a => a.gid === g.id);
  const sel = {};
  openModal(`<h2>Ny jakt</h2><form id="hfForm">
    <label class="field"><span>Namn</span><input class="input" id="hfName" maxlength="60" value="Jakt ${fmtDay(todayISO())}"></label>
    <div class="row2"><label class="field"><span>Datum</span><input class="input" type="date" id="hfDay" value="${todayISO()}"></label>
    <label class="field"><span>Startar kl.</span><input class="input" type="time" id="hfStart" value="${nowHM()}"></label></div>
    <label class="field"><span>Slutar kl.</span><input class="input" type="time" id="hfEnd" value="23:59"></label>
    <p class="note" style="margin-top:0">Positioner kan bara delas och ses mellan start och slut. Gästernas åtkomst gäller till sluttiden.</p>
    <label class="field"><span>Län</span><select class="input" id="hfLan"><option value="">Välj län</option>${LAN.map(l => `<option${l === state.settings.lan ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="field"><span>Områden som gästerna får se</span>${areas.length ? areas.map(a => `<label class="checkline"><input type="checkbox" data-area="${a.id}" checked><span>${esc(a.name)}</span></label>`).join('') : '<span class="small muted">Laget har inga delade områden ännu. Gäster ser då bara varandras positioner.</span>'}</div>
    <div class="field"><span>Jaktbart vilt</span><div id="hfVilt"></div></div>
    <div class="actions"><button class="btn primary grow" type="submit" id="hfPlan" data-plan="1">Skapa och planera</button><button class="btn" type="submit" id="hfOk">Skapa jakt</button><button class="btn ghost" type="button" id="hfCancel">Avbryt</button></div></form>`, m => {
    const draw = () => {
      const lan = m.querySelector('#hfLan').value, md = (m.querySelector('#hfDay').value || todayISO()).slice(5);
      if(!lan){ m.querySelector('#hfVilt').innerHTML = '<span class="small muted">Välj län för att se vad som är lovligt den dagen.</span>'; return; }
      let out = '';
      for(const v of VILT){
        const rows = v.lic ? [] : viltLawful(v, lan, md);
        if(!v.lic && !rows.length){ delete sel[v.id]; continue; }
        const info = v.lic ? 'Enligt licens eller länsstyrelsens beslut' : rows.map(r => [rowLabel(r), fmtPer(r.per), r.note].filter(Boolean).join(' · ')).join(' | ');
        out += `<label class="checkline"><input type="checkbox" data-vilt="${v.id}" ${sel[v.id] ? 'checked' : ''}><span>${esc(v.name)}<br><span class="small muted">${esc(info)}</span></span></label>`;
      }
      m.querySelector('#hfVilt').innerHTML = out + '<p class="note">Bara arter med allmän jakttid den dagen i länet visas. Kontrollera alltid mot Jägareförbundets tabell.</p>';
    };
    m.querySelector('#hfVilt').addEventListener('change', e => { const id = e.target.dataset.vilt; if(id) sel[id] = e.target.checked; });
    m.querySelector('#hfLan').addEventListener('change', draw); m.querySelector('#hfDay').addEventListener('change', draw); draw();
    m.querySelector('#hfCancel').addEventListener('click', closeModal);
    m.querySelector('#hfForm').addEventListener('submit', e => {
      e.preventDefault();
      const plan = !!(e.submitter && e.submitter.dataset.plan);   // Skapa och planera: öppna planeringen direkt
      const name = m.querySelector('#hfName').value.trim() || 'Jakt', day = m.querySelector('#hfDay').value || todayISO(), end = m.querySelector('#hfEnd').value || '23:59', lan = m.querySelector('#hfLan').value;
      const [y, mo, d] = day.split('-').map(Number), [hh, mm] = end.split(':').map(Number), [sh, sm] = (m.querySelector('#hfStart').value || '00:00').split(':').map(Number);
      const expires = new Date(y, mo - 1, d, hh, mm, 59).getTime(), starts = new Date(y, mo - 1, d, sh, sm, 0).getTime();
      if(expires < Date.now()){ toast('Sluttiden har redan passerat. Välj en senare tid.'); return; }
      if(starts >= expires){ toast('Starttiden måste vara före sluttiden.'); return; }
      const hunt = {name, day, starts, expires, lan, code:newCode(8), by:myUid(), created:Date.now(), areas:{}, species:{}};
      $$('[data-area]', m).forEach(c => { if(c.checked) hunt.areas[c.dataset.area] = true; });
      for(const k of Object.keys(sel)) if(sel[k]) hunt.species[k] = true;
      const hid = uid(), up = {};
      up[`groups/${g.id}/hunts/${hid}`] = hunt; up[`huntCodes/${hunt.code}`] = {gid:g.id, hid, expires};
      if(lan){ state.settings.lan = lan; save(); }
      closeModal();
      fb.db.ref().update(up).then(() => {
        toast('Jakten är skapad. Dela jaktkoden med gästerna.');
        if(plan){ if(!g.hunts) g.hunts = {}; if(!g.hunts[hid]) g.hunts[hid] = hunt; openPlan(g, hid); }
      }).catch(fail());
    });
  });
}
$('#paneJakt').addEventListener('click', e => {
  const b = e.target.closest('[data-j]'); if(!b || b.tagName === 'SELECT') return;
  const act = b.dataset.j, g = cloud.groups[b.dataset.g], u = b.dataset.u, hid = b.dataset.h;
  if(act === 'copy-rules') copyText(RULES_TEXT, 'Reglerna är kopierade');
  else if(act === 'cfg-save'){ const cfg = parseCfg($('#fbCfg').value); if(!cfg){ toast('Hittade inte apiKey, databaseURL och projectId i texten.', 5000); return; } lsSet(FBKEY, JSON.stringify(cfg)); cloudInit(); }
  else if(act === 'cfg-reset') confirmClick(b, 'Tryck igen för att byta', () => { try { localStorage.removeItem(FBKEY); } catch(e){} location.reload(); });
  else if(act === 'login-google') fb.auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch(err => toast(err && err.code === 'auth/unauthorized-domain' ? 'Webbadressen är inte godkänd i Firebase. Lägg till den under Authentication, Settings, Authorized domains.' : 'Inloggningen avbröts.', 6000));
  else if(act === 'login-guest'){ const n = $('#gName').value.trim(), c = $('#gCode').value.trim(); if(!n || !c){ toast('Fyll i namn och jaktkod.'); return; } lsSet(NAMEKEY, n); cloud.pending = c.toUpperCase(); fb.auth.signInAnonymously().catch(() => toast('Gästinloggning är inte påslagen i Firebase (Anonym).', 6000)); }
  else if(act === 'logout'){ stopSharing(); fb.auth.signOut(); }
  else if(act === 'name') askText('Byt namn', 'Namn som syns för andra', myName(), 'Spara', v => { lsSet(NAMEKEY, v); for(const gr of Object.values(cloud.groups)){ if(gr.kind === 'member'){ fb.db.ref(`groups/${gr.id}/members/${myUid()}/name`).set(v).catch(() => {}); for(const [h, r] of Object.entries(gr.huntRsvp || {})) if(r && r[myUid()]) fb.db.ref(`groups/${gr.id}/huntRsvp/${h}/${myUid()}/name`).set(v).catch(() => {}); } else fb.db.ref(`groups/${gr.id}/guests/${myUid()}/name`).set(v).catch(() => {}); } renderJakt(); }, 40);
  else if(act === 'group-new') askText('Skapa jaktlag', 'Namn på jaktlaget', '', 'Skapa', v => createGroup(v), 60);
  else if(act === 'join') askText('Gå med med kod', 'Inbjudningskod eller jaktkod', '', 'Gå med', v => joinByCode(v), 14);
  else if(!g) return;
  else if(act === 'obs-go'){ const o = ((g.huntObs || {})[hid] || {})[b.dataset.o]; if(o){ map.setView([o.lat, o.lng], Math.max(map.getZoom(), 16)); if(!isDesktop()) setSheet('peek'); } }
  else if(act === 'hunt-new') openHuntForm(g);
  else if(act === 'plan') openPlan(g, hid);
  else if(act === 'rsvp'){ delete cloud.autoOff[g.id + '/' + hid]; fb.db.ref(`groups/${g.id}/huntRsvp/${hid}/${myUid()}`).set({name:myName(), t:Date.now()}).then(() => toast(huntLive(g.hunts[hid]) ? 'Du deltar. Din position delas med jaktlaget.' : 'Du deltar. Din position delas automatiskt när jakten startar.', 4500)).catch(fail()); }
  else if(act === 'rsvp-no') fb.db.ref(`groups/${g.id}/huntRsvp/${hid}/${myUid()}`).remove().catch(fail());
  else if(act === 'plan-go') gotoPin(b.dataset.p);
  else if(act === 'hunt-link'){ const hunt = g.hunts[hid]; copyText(`${hunt.name}: gå med i jakten med kod ${hunt.code}\n${shareLink('j', hunt.code)}`, 'Länken är kopierad'); }
  else if(act === 'hunt-end') confirmClick(b, 'Bekräfta', async () => { const hunt = g.hunts[hid], up = {};
    // Viltobservationerna sparas utan namn i lagets arkiv, för värmekartan. Bara jaktledare och admin kan läsa arkivet.
    let obs = {}; try { obs = (await fb.db.ref(`groups/${g.id}/huntObs/${hid}`).get()).val() || {}; } catch(e){}
    let na = 0;
    for(const [oid, o] of Object.entries(obs)) if(o && typeof o.lat === 'number' && typeof o.lng === 'number' && typeof o.sp === 'string' && o.n >= 1){
      up[`groups/${g.id}/obsArchive/${oid}`] = {sp:o.sp.slice(0, 40), n:Math.min(999, Math.round(o.n)), lat:o.lat, lng:o.lng, t:Math.min(o.t || Date.now(), Date.now()), hid:String(hid).slice(0, 40)}; na++;
    }
    up[`groups/${g.id}/hunts/${hid}`] = null; up[`groups/${g.id}/huntPos/${hid}`] = null; up[`groups/${g.id}/huntTrail/${hid}`] = null; up[`groups/${g.id}/huntObs/${hid}`] = null; up[`groups/${g.id}/huntPlan/${hid}`] = null; up[`groups/${g.id}/huntRsvp/${hid}`] = null; if(hunt && hunt.code) up[`huntCodes/${hunt.code}`] = null;
    for(const [gu, v] of Object.entries(g.guests || {})) if(v && v.hid === hid) up[`groups/${g.id}/guests/${gu}`] = null;
    fb.db.ref().update(up).then(() => toast('Jakten är avslutad. Gästernas åtkomst är borttagen.' + (na ? ` ${na === 1 ? 'En observation' : na + ' observationer'} sparades till värmekartan.` : ''), 5000)).catch(fail()); });
  else if(act === 'guest-del') fb.db.ref(`groups/${g.id}/guests/${u}`).remove().catch(fail());
  else if(act === 'member-del') confirmClick(b, 'Bekräfta', () => fb.db.ref(`groups/${g.id}/members/${u}`).remove().then(() => toast('Medlemmen är borttagen')).catch(fail()));
  else if(act === 'invite') openInvite(g);
  else if(act === 'group-leave') confirmClick(b, 'Tryck igen för att lämna', () => { stopSharing(); fb.db.ref(`groups/${g.id}/members/${myUid()}`).remove().then(() => forgetGroup(g.id)).catch(fail()); });
  else if(act === 'guest-leave'){ stopSharing(); fb.db.ref(`groups/${g.id}/guests/${myUid()}`).remove().catch(() => {}).then(() => forgetGroup(g.id)); }
  else if(act === 'group-del') confirmClick(b, 'Tryck igen: allt i laget raderas', () => { const codes = {}; for(const hv of Object.values(g.hunts || {})) if(hv && hv.code) codes['huntCodes/' + hv.code] = null;
    (Object.keys(codes).length ? fb.db.ref().update(codes) : Promise.resolve()).catch(() => {}).then(() => fb.db.ref('groups/' + g.id).remove()).then(() => { forgetGroup(g.id); toast('Jaktlaget är borttaget'); }).catch(fail()); });
});
$('#paneJakt').addEventListener('change', e => {
  const b = e.target.closest('select[data-j=role]'); if(!b) return;
  fb.db.ref(`groups/${b.dataset.g}/members/${b.dataset.u}/role`).set(b.value).then(() => toast('Rättigheten är ändrad')).catch(fail());
});
function openInvite(g){
  openModal(`<h2>Bjud in till ${esc(gname(g))}</h2><label class="field"><span>Rättighet</span><select class="input" id="ivRole">${['editor','viewer','leader'].map(k => `<option value="${k}">${ROLES[k]} – ${ROLE_HELP[k].toLowerCase()}</option>`).join('')}</select></label>
    <p class="note" style="margin-top:0">Länken gäller i sju dagar och kan användas av flera. Du kan ändra rättigheten efteråt.</p>
    <div class="actions"><button class="btn primary grow" type="button" id="ivOk">Skapa inbjudan</button><button class="btn ghost" type="button" id="ivCancel">Avbryt</button></div>`, m => {
    m.querySelector('#ivCancel').addEventListener('click', closeModal);
    m.querySelector('#ivOk').addEventListener('click', () => {
      const role = m.querySelector('#ivRole').value, c = newCode(10);
      fb.db.ref('invites/' + c).set({gid:g.id, role, expires:Date.now() + 7 * 864e5, by:myUid()}).then(() => { closeModal(); copyText(`Gå med i ${gname(g)} i Jaktkartan med kod ${c}\n${shareLink('l', c)}`, 'Inbjudan är kopierad'); }).catch(fail());
    });
  });
}
