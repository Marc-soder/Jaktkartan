// Flera användare mot en låtsas-Firebase där varje läsning och skrivning prövas mot de riktiga reglerna (targaryen).
const { chromium } = require('playwright');
const targaryen = require('targaryen');
const rules = require('../src/rules.js');
const fs = require('fs'), path = require('path'), http = require('http');
const APP = 'http://localhost:8765/jaktkartan.html';
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, {recursive:true});
const shot = n => path.join(SHOTS, n);
const tile = fs.readFileSync(path.join(__dirname, 'tile_osm.png'));
let data = {}, clock = () => Date.now();
const subs = []; // {page, id, path, uid, last}
const fails = []; let passes = 0;
const check = (c, msg) => { if(c) passes++; else fails.push(msg); console.log((c ? 'PASS ' : 'FAIL ') + msg); };
const tok = uid => ({uid, token:{firebase:{sign_in_provider:String(uid).startsWith('anon-') ? 'anonymous' : 'google.com'}}});
const dbAs = uid => targaryen.database(rules, data, clock()).as(uid ? tok(uid) : null);
const valAt = p => { let v = data; for(const k of p.split('/').filter(Boolean)){ if(v == null) return null; v = v[k]; } return v === undefined ? null : v; };
const canRead = (uid, p) => dbAs(uid).read('/' + p, clock()).allowed;
async function pump(failPage){
  for(const s of subs.slice()){
    if(!subs.includes(s)) continue;
    if(!canRead(s.uid, s.path)){ subs.splice(subs.indexOf(s), 1); await s.page.evaluate(id => window.__fbDeny(id), s.id).catch(() => {}); continue; }
    const j = JSON.stringify(valAt(s.path));
    if(j !== s.last || s.page === failPage){ s.last = j; await s.page.evaluate(([id, v]) => window.__fbEmit(id, v), [s.id, JSON.parse(j)]).catch(() => {}); }
  }
}
const FAKE = `
window.firebase = (function(){
  const who = new URLSearchParams(location.search).get('u');
  let user = null; const cbs = [], subs = {}; let n = 0;
  const fire = () => cbs.forEach(cb => cb(user));
  const snap = (v, key) => ({val: () => v, exists: () => v !== null && v !== undefined, key});
  window.__fbEmit = (id, v) => { if(subs[id]) subs[id].cb(snap(v)); };
  window.__fbDeny = id => { if(subs[id]){ const e = subs[id].err; delete subs[id]; if(e) e(new Error('permission_denied')); } };
  const uid = () => user ? user.uid : null;
  const auth = { get currentUser(){ return user; }, onAuthStateChanged(cb){ cbs.push(cb); setTimeout(() => cb(user), 0); },
    signInWithPopup(){ user = {uid:who, displayName:who[0].toUpperCase() + who.slice(1) + ' Test', email:who + '@example.se', isAnonymous:false}; fire(); return Promise.resolve(); },
    signInAnonymously(){ user = {uid:'anon-' + who, displayName:null, isAnonymous:true}; fire(); return Promise.resolve(); },
    signOut(){ user = null; fire(); return Promise.resolve(); } };
  const authFn = () => auth; authFn.GoogleAuthProvider = function(){};
  const wr = (kind, p, v) => window.__fbWrite(uid(), kind, p, v === undefined ? null : v).then(ok => { if(!ok) throw new Error('PERMISSION_DENIED'); });
  const ref = p => { p = String(p || '').replace(/^\\/+|\\/+$/g, ''); const ids = [];
    return { on(ev, cb, err){ const id = ++n; subs[id] = {cb, err}; ids.push(id); window.__fbSub(uid(), id, p); },
      off(){ ids.forEach(id => { delete subs[id]; window.__fbUnsub(id); }); },
      set: v => wr('set', p, v), update: v => wr('update', p, v), remove: () => wr('set', p, null),
      push: v => { const k = 'k' + Date.now().toString(36) + (++n); return wr('set', p + '/' + k, v).then(() => ({key:k})); },
      get: () => window.__fbGet(uid(), p).then(r => { if(!r.ok) throw new Error('PERMISSION_DENIED'); return snap(r.val); }),
      onDisconnect: () => ({remove: () => Promise.resolve()}) }; };
  const db = {ref}; const dbFn = () => db;
  const apps = [];
  return {apps, initializeApp(){ apps.push(1); }, auth: authFn, database: dbFn};
})();`;
async function mkPage(browser, who, hash, opts){
  const ctx = await browser.newContext(Object.assign({viewport:{width:1280, height:900}, geolocation:{latitude:58.72, longitude:14.61, accuracy:12}, permissions:['geolocation', 'accelerometer', 'gyroscope', 'magnetometer']}, opts || {}));
  await ctx.route('**/*', r => { const u = r.request().url();
    if(u.includes('firebase-app-compat')) return r.fulfill({status:200, contentType:'text/javascript', body:FAKE});
    if(u.includes('gstatic.com/firebasejs')) return r.fulfill({status:200, contentType:'text/javascript', body:''});
    if(u.includes('api.open-meteo.com')) return r.fulfill({status:200, contentType:'application/json', headers:{'Access-Control-Allow-Origin':'*'}, body:JSON.stringify({current:{wind_speed_10m:3, wind_direction_10m:270, wind_gusts_10m:5}})});
    if(u.startsWith('file:') || u.includes('localhost:8765')) return r.continue();
    if(u.includes('fonts.')) return r.abort();
    return r.fulfill({status:200, contentType:'image/png', body:tile}); });
  await ctx.addInitScript(() => { try { if(!localStorage.getItem('faltkartan.fb')) localStorage.setItem('faltkartan.fb', JSON.stringify({apiKey:'k', databaseURL:'https://x.firebasedatabase.app', projectId:'x'})); } catch(e){} });
  const page = await ctx.newPage(); page.errs = [];
  page.on('pageerror', e => page.errs.push(String(e)));
  await page.exposeFunction('__fbSub', async (uid, id, p) => { if(!canRead(uid, p)){ await page.evaluate(i => window.__fbDeny(i), id).catch(() => {}); return; } const j = JSON.stringify(valAt(p)); subs.push({page, id, path:p, uid, last:j}); await page.evaluate(([i, v]) => window.__fbEmit(i, v), [id, JSON.parse(j)]).catch(() => {}); });
  await page.exposeFunction('__fbUnsub', id => { const i = subs.findIndex(s => s.page === page && s.id === id); if(i >= 0) subs.splice(i, 1); });
  await page.exposeFunction('__fbGet', (uid, p) => canRead(uid, p) ? {ok:true, val:valAt(p)} : {ok:false});
  await page.exposeFunction('__fbWrite', async (uid, kind, p, v) => {
    const d = dbAs(uid), r = kind === 'set' ? d.write('/' + p, v, undefined, clock()) : d.update('/' + p, v, clock());
    if(r.allowed){ data = r.newDatabase.snapshot('/').val() || {}; await pump(); return true; }
    page.denied = (page.denied || 0) + 1; await pump(page); return false; });
  await page.goto(APP + '?u=' + who + (hash || '')); await page.waitForTimeout(700);
  return page;
}
const W = (p, ms) => p.waitForTimeout(ms || 350);
const st = p => p.evaluate(() => __fk.state());
const gids = () => Object.keys(data.groups || {});

(async () => {
  const server = http.createServer((q, r) => { r.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); r.end(HTML); });
  await new Promise(ok => server.listen(8765, ok));
  const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || undefined});
  // ---- Alice skapar lag och delar ett område ----
  const A = await mkPage(browser, 'alice');
  await A.click('#tab-jakt'); await W(A);
  check(await A.isVisible('[data-j="login-google"]'), 'utloggad: inloggningsknapp visas');
  await A.click('[data-j="login-google"]'); await W(A);
  check(data.owner === 'alice', 'första inloggade (Alice) blev ägare');
  await A.click('[data-j="group-new"]'); await A.fill('#atVal', 'Älglaget'); await A.click('#atForm button[type=submit]'); await W(A, 500);
  const gid = gids()[0];
  check(gid && data.groups[gid].members.alice.role === 'admin' && data.userGroups.alice[gid] === 'member', 'Alice skapade jaktlag och är admin');
  check((await A.innerText('#paneJakt')).includes('ÄLGLAGET') || (await A.innerText('#paneJakt')).toLowerCase().includes('älglaget'), 'laget visas i Jakt-fliken');
  await A.click('#tab-filter'); await A.locator('#paneFilter [data-act="area-edit"]').first().click(); await W(A, 200);
  await A.selectOption('#afShare', gid); await A.click('#afForm button[type=submit]'); await W(A, 500);
  const aid = Object.keys(data.groups[gid].areas || {})[0];
  check(aid && Object.keys(data.groups[gid].pins[aid]).length === 5, 'delat område laddades upp med 5 nålar');
  check(Object.keys(data.groups[gid].types || {}).length === 5, 'de 5 typer som nålarna använder följde med');
  check((await st(A)).pins.length === 8 && await A.locator('.pin-icon').count() === 8, 'Alice ser fortfarande 8 nålar, inga dubbletter');
  for(let i = subs.length - 1; i >= 0; i--) if(subs[i].page === A) subs.splice(i, 1);
  await A.reload(); await W(A, 700); await A.click('#tab-jakt'); await A.click('[data-j="login-google"]'); await W(A, 600);
  const sa = await st(A);
  check(sa.pins.length === 8 && sa.areas.filter(a => a.gid === gid).length === 1 && sa.areas.length === 2, 'efter omladdning: delat område hämtas från molnet utan dubbletter');
  await A.evaluate(a => { const ar = __fk.state().areas.find(x => x.id === a); ar.border = '58.72000,14.60000;58.73000,14.61000;58.72000,14.62000'; ar.updated = Date.now(); document.querySelector('#btnZoomIn').click(); }, aid); await W(A, 600);
  check(data.groups[gid].areas[aid].border === '58.72000,14.60000;58.73000,14.61000;58.72000,14.62000', 'gränsen för delat område sparas i laget');
  await A.evaluate(a => { const ar = __fk.state().areas.find(x => x.id === a); ar.lines = {'l-1': {k:'path', p:'58.72100,14.60500;58.72500,14.61000', n:'Stigen till tornet'}}; ar.updated = Date.now(); document.querySelector('#btnZoomIn').click(); }, aid); await W(A, 600);
  check(((data.groups[gid].areas[aid].lines || {})['l-1'] || {}).n === 'Stigen till tornet', 'egen stig i delat område sparas i laget');
  await A.evaluate(a => { const ar = __fk.state().areas.find(x => x.id === a); delete ar.lines['l-1']; ar.lines['l-2'] = {k:'road', p:'58.72000,14.60000;58.72300,14.60800'}; ar.updated = Date.now(); document.querySelector('#btnZoomOut').click(); }, aid); await W(A, 600);
  check(JSON.stringify(Object.keys(data.groups[gid].areas[aid].lines || {})) === '["l-2"]', 'ändrade vägar i delat område synkas (borttagen stig försvinner)');
  // ---- Inbjudan ----
  await A.click('[data-j="invite"]'); await A.selectOption('#ivRole', 'editor'); await A.click('#ivOk'); await W(A, 400);
  await A.keyboard.press('Escape');
  const inv = Object.keys(data.invites || {})[0];
  check(inv && inv.length === 10 && data.invites[inv].role === 'editor', 'inbjudan skapad med roll Medlem');
  // ---- Bob går med via länk ----
  const B = await mkPage(browser, 'bob', '#l-' + inv);
  check(await B.isVisible('#paneJakt [data-j="login-google"]') && (await B.innerText('#paneJakt')).includes(inv), 'Bob: länken öppnar Jakt-fliken med koden');
  await B.click('[data-j="login-google"]'); await W(B, 800);
  check(data.groups[gid].members.bob && data.groups[gid].members.bob.role === 'editor', 'Bob blev medlem med rätt roll');
  let sb = await st(B);
  check((sb.areas.find(a => a.id === aid) || {}).border === data.groups[gid].areas[aid].border && await B.evaluate(() => { let n = 0; __fk.map.eachLayer(l => { if(l instanceof L.Polygon && l.options.className !== 'wind-sector') n++; }); return n; }) === 2, 'Bob ser lagets gräns på kartan');
  check((((sb.areas.find(a => a.id === aid) || {}).lines || {})['l-2'] || {}).k === 'road' && await B.evaluate(() => { let n = 0; __fk.map.eachLayer(l => { if(l instanceof L.Polyline && !(l instanceof L.Polygon) && l.options.color === '#8a4b12') n++; }); return n; }) === 1, 'Bob ser lagets egna väg på kartan');
  check(sb.pins.length === 13 && sb.areas.length === 3, `Bob ser sina 8 egna + 5 delade nålar (${sb.pins.length}) och 3 områden`);
  // Bob lägger till en nål i det delade området
  await B.evaluate(a => __fk.openPinForm({lat:58.73, lng:14.6, areaId:a}), aid); await W(B, 200);
  await B.fill('#pfName', 'Bobs pass'); await B.click('#pinForm button[type=submit]'); await W(B, 500);
  check(Object.values(data.groups[gid].pins[aid]).some(p => p.name === 'Bobs pass' && p.by === 'bob'), 'Bobs nya nål sparades i laget');
  check((await st(A)).pins.some(p => p.name === 'Bobs pass'), 'Alice ser Bobs nål direkt');
  check(await A.locator('.pin-icon').count() === 9, 'Alice har 9 nålar på kartan');
  // Alice ändrar en nål, Bob ser det
  const pid = Object.keys(data.groups[gid].pins[aid]).find(k => data.groups[gid].pins[aid][k].name === 'Jaktstugan');
  await A.evaluate(id => __fk.openPinForm({id}), pid); await W(A, 200); await A.fill('#pfName', 'Jaktstugan (ny)'); await A.click('#pinForm button[type=submit]'); await W(A, 500);
  check((await st(B)).pins.some(p => p.name === 'Jaktstugan (ny)'), 'Bob ser Alices namnändring');
  // ---- Rättigheter ----
  await A.click('#tab-jakt'); await W(A, 200);
  await A.selectOption('select[data-j="role"][data-u="bob"]', 'viewer'); await W(A, 500);
  check(data.groups[gid].members.bob.role === 'viewer', 'Alice ändrade Bob till Läsare');
  const row = await A.evaluate(() => { const sel = document.querySelector('select[data-j="role"][data-u="bob"]'), r = sel.closest('.frow'), n = r.querySelector('.fname'), t = r.querySelector('.iconbtn');
    return {name:n.getBoundingClientRect().width, text:n.textContent, sel:sel.getBoundingClientRect().width, row:r.getBoundingClientRect().width, trash:t.getBoundingClientRect().right, right:r.getBoundingClientRect().right}; });
  check(row.name > 60 && row.text.includes('Bob') && row.sel < row.row / 2 && row.trash <= row.right + 1, `medlemmens namn syns bredvid rättighetsmenyn, och papperskorgen ryms (${JSON.stringify(row)})`);
  await B.evaluate(id => __fk.openPinForm({id}), pid); await W(B, 200);
  check(!(await B.isVisible('#pinForm')), 'Läsare kan inte öppna redigering av delad nål');
  const before = JSON.stringify(data.groups[gid].pins);
  await B.evaluate(id => { const s = __fk.state(); s.pins.find(p => p.id === id).name = 'HACK'; s.pins = s.pins.filter(p => p.name !== 'Bobs pass'); document.querySelector('#btnZoomIn').click(); }, pid); await W(B, 600);
  check(JSON.stringify(data.groups[gid].pins) === before, 'Läsarens ändringar når inte molnet');
  const d0 = B.denied || 0;
  const r1 = await B.evaluate(g => firebase.database().ref('groups/' + g + '/members/bob/role').set('admin').then(() => 'ok', () => 'denied'), gid);
  const r2 = await B.evaluate(g => firebase.database().ref('groups/' + g + '/pins/x/y').set({lat:1, lng:1, typeId:'t'}).then(() => 'ok', () => 'denied'), gid);
  const r3 = await B.evaluate(g => firebase.database().ref('invites/ABCDEFGHJK').set({gid:g, role:'leader', expires:Date.now() + 1e6}).then(() => 'ok', () => 'denied'), gid);
  check(r1 === 'denied' && r2 === 'denied' && r3 === 'denied', 'Läsare nekas: höja egen roll, skriva nål, skapa inbjudan');
  await A.selectOption('select[data-j="role"][data-u="bob"]', 'leader'); await W(A, 500);
  check(await B.locator('#paneJakt [data-j="hunt-new"]').count() === 1 && await B.locator('#paneJakt [data-j="invite"]').count() === 0, 'Jaktledare får knappen Ny jakt men inte Bjud in');
  // ---- Ingen jakt: inga positioner ----
  await A.click('#tab-jakt'); await W(A, 200);
  check(await A.locator('#shareToggle').isDisabled() && (await A.innerText('#posCount')).includes('bara delas och ses medan en jakt pågår'), 'utan pågående jakt går det inte att dela position');
  const noHunt = await A.evaluate(g => firebase.database().ref('groups/' + g + '/huntPos/xx/alice').set({lat:1, lng:1, t:1}).then(() => 'ok', () => 'denied'), gid);
  check(noHunt === 'denied', 'utan pågående jakt nekas skrivning av position direkt mot databasen');
  // ---- Jakt med gäståtkomst ----
  await A.click('#tab-filter'); await A.locator('#paneFilter [data-act="area-edit"]').first().click(); await W(A, 200);
  await A.selectOption('#afShare', gid); await A.click('#afForm button[type=submit]'); await W(A, 500);
  const aid2 = Object.keys(data.groups[gid].areas).find(k => k !== aid);
  check(aid2 && Object.keys(data.groups[gid].pins[aid2]).length === 3, 'andra området (svamp) delat med 3 nålar');
  await B.click('#tab-jakt'); await B.click('[data-j="hunt-new"]'); await W(B, 200);
  await B.selectOption('#hfLan', 'Södermanland'); await W(B, 100);
  const viltTxt = await B.innerText('#hfVilt');
  await B.check('#hfVilt [data-vilt="radjur"]'); await B.check('#hfVilt [data-vilt="vildsvin"]');
  await B.uncheck(`[data-area="${aid2}"]`);
  check(await B.isVisible('#hfOk') && (await B.innerText('#hfPlan')) === 'Skapa och planera', 'formuläret har både Skapa jakt och Skapa och planera');
  await B.click('#hfPlan'); await W(B, 600);
  check(await B.isVisible('#planBody') && (await B.innerText('#planBody')).includes('Pass') && (await B.innerText('#planBody')).includes('Rita såt'), 'Skapa och planera öppnar planeringen direkt för den nya jakten');
  await B.click('#plClose'); await W(B, 200);
  const hid = Object.keys(data.groups[gid].hunts || {})[0], hunt = hid && data.groups[gid].hunts[hid];
  check(hunt && hunt.species.radjur && hunt.species.vildsvin && hunt.areas[aid] === true && !hunt.areas[aid2] && data.huntCodes[hunt.code].hid === hid, 'Bob (jaktledare) skapade jakt med vilt, ett område och jaktkod');
  check(hunt.expires > Date.now() && new Date(hunt.expires).getHours() === 23, 'jakten gäller till kl. 23.59 i dag');
  check(hunt.manual === true && hunt.starts === hunt.expires - 1000, 'jakten är planerad och startas för hand som standard');
  await W(A, 300);
  { const at = await A.innerText('#paneJakt'); check(at.toUpperCase().includes('PLANERAD') && at.includes('Du har en inbjudan att svara på') && at.includes('Startas av jaktledaren'), 'Alice ser den planerade jakten som en inbjudan i kalendern'); }
  check(await A.evaluate(([g, h]) => firebase.database().ref('groups/' + g + '/huntPos/' + h + '/alice').set({lat:1, lng:1, t:Date.now(), name:'A'}).then(() => 'ok', () => 'denied'), [gid, hid]) === 'denied', 'positioner kan inte delas innan jakten har startat');
  check(await B.locator(`[data-j="hunt-start"][data-h="${hid}"]`).count() === 1 && await A.locator(`[data-j="hunt-start"]`).count() === 1, 'jaktledare och admin har knappen Starta jakten');
  await B.click(`[data-j="hunt-start"][data-h="${hid}"]`); await W(B, 600);
  { const h = data.groups[gid].hunts[hid]; check(!h.manual && h.starts <= Date.now() && Date.now() - h.starts < 60000 && h.expires === hunt.expires && (await B.innerText('#paneJakt')).toUpperCase().includes('PÅGÅR'), 'jaktledaren startar jakten: den pågår nu, med samma sluttid'); }
  check((await A.innerText('#paneJakt')).includes(hunt.code), 'Alice ser jakten och koden');
  // ---- Carl: gäst utan konto ----
  const C = await mkPage(browser, 'carl', '#j-' + hunt.code);
  await C.fill('#gName', 'Carl Gäst'); await C.click('[data-j="login-guest"]'); await W(C, 900);
  check(data.groups[gid].guests && data.groups[gid].guests['anon-carl'] && data.groups[gid].guests['anon-carl'].expires === hunt.expires, 'Carl gick med som gäst, åtkomsten slutar när jakten slutar');
  // Gästens områden och nålar hämtas efter att gästposten finns: vänta på dem (högst 5 s) i stället för en fast tid
  for(let i = 0; i < 25 && (await st(C)).pins.filter(p => p.areaId === aid).length < 6; i++) await W(C, 200);
  let sc = await st(C);
  const cShared = sc.pins.filter(p => p.areaId === aid).length, cOther = sc.pins.filter(p => p.areaId === aid2).length;
  if(cShared !== 6) console.log('DBG carl', JSON.stringify({denied:C.denied || 0, errs:C.errs, areas:sc.areas.map(a => a.id), subs:subs.filter(x => x.page === C).map(x => x.path)}));
  check(cShared === 6 && cOther === 0, `gästen ser jaktens område (${cShared} nålar) men inte det andra delade området (${cOther})`);
  check((sc.areas.find(a => a.id === aid) || {}).border === data.groups[gid].areas[aid].border, 'gästen ser gränsen för jaktens område');
  const txtC = await C.innerText('#paneJakt');
  check(txtC.includes('Rådjur') && txtC.includes('Vildsvin') && !txtC.includes(hunt.code) && !txtC.includes('Medlemmar'), 'gästen ser jaktbart vilt men inte kod eller medlemslista');
  const g1 = await C.evaluate(([g, a]) => Promise.all(['members', 'hunts', 'guests', 'pins/' + a, 'pins', 'areas'].map(p => firebase.database().ref('groups/' + g + '/' + p).get().then(() => 'ok', () => 'denied'))), [gid, aid2]);
  check(g1.every(x => x === 'denied'), 'gästen nekas läsa medlemmar, alla jakter, andra gäster och övriga områden');
  const g2 = await C.evaluate(([g, a]) => firebase.database().ref('groups/' + g + '/pins/' + a + '/zz').set({lat:1, lng:1, typeId:'t'}).then(() => 'ok', () => 'denied'), [gid, aid]);
  check(g2 === 'denied', 'gästen kan inte skriva nålar');
  // ---- Jaktplan ----
  await B.evaluate(([g, a]) => firebase.database().ref('groups/' + g + '/pins/' + a + '/pass1').set({name:'Pass 1 – bäcken', note:'', typeId:'t-pass', lat:58.7228, lng:14.6045, created:1, updated:1, by:'bob'}), [gid, aid]); await W(B, 500);
  const passIds = Object.entries(data.groups[gid].pins[aid]).filter(([, p]) => p.typeId === 't-pass').map(([k]) => k);
  await B.click('#tab-jakt'); await W(B, 200); await C.click('#tab-jakt'); await W(C, 200);
  check(await B.locator('[data-j="plan"]').count() === 1 && await A.locator('[data-j="plan"]').count() === 1 && await C.locator('[data-j="plan"]').count() === 0, 'jaktledare och admin kan planera jakten, gästen kan inte');
  await B.click('[data-j="plan"]'); await W(B, 300);
  check(await B.locator('#planBody select[data-pl="who"]').count() === passIds.length && passIds.length === 2, `planen listar jaktens ${passIds.length} pass`);
  const pA = passIds.find(k => k === 'pass1'), pB = passIds.find(k => k !== 'pass1');
  const opts = await B.locator(`select[data-pl="who"][data-p="${pA}"] option`).allInnerTexts();
  check(opts.some(o => o.includes('Carl Gäst (gäst)')) && opts.some(o => o.includes('Alice')) && opts.includes('Annat namn …'), `man kan välja medlemmar, jaktens gäster eller skriva ett namn: ${opts.join(' | ')}`);
  await B.selectOption(`select[data-pl="who"][data-p="${pA}"]`, 'u:anon-carl'); await W(B, 400);
  const plan = () => ((data.groups[gid].huntPlan || {})[hid] || {});
  check((plan().stands || {})[pA] && plan().stands[pA].who === 'Carl Gäst' && plan().stands[pA].uid === 'anon-carl', 'Carl tilldelas Pass 1');
  await B.selectOption(`select[data-pl="who"][data-p="${pB}"]`, '__name'); await W(B, 100);
  await B.fill('#planBody input[data-pl="who-name"]', 'Kalle utan app'); await B.press('#planBody input[data-pl="who-name"]', 'Tab'); await W(B, 400);
  check(plan().stands[pB] && plan().stands[pB].who === 'Kalle utan app' && !plan().stands[pB].uid, 'ett pass kan få ett eget namn för någon utan appen');
  await B.click(`[data-pl="dirs"][data-p="${pA}"]`); await W(B, 200);
  check(await B.locator('.rose .rose-w').count() === 16, 'kompassrosen har 16 riktningar');
  // Passgrannen visas i sin riktning, med avstånd, och om riktningen mot den är spärrad
  const nbI = await B.evaluate(([g, h, a]) => { const x = __fk.passNeighbors(__fk.cloud.groups[g], h, __fk.pinById(a))[0]; return x && {name:x.p.name, id:x.p.id, m:x.d, deg:Math.round(x.b), i:x.i, who:x.who}; }, [gid, hid, pA]);
  const nbP = data.groups[gid].pins[aid][pB], nbM = await B.evaluate(([a, b]) => { const m = __fk.distM(a, b), x = __fk.bearingDeg(a, b), D = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSV', 'SV', 'VSV', 'V', 'VNV', 'NV', 'NNV']; return {m, d:__fk.fmtDist(m), deg:Math.round(x), dir:D[Math.round(x / 22.5) % 16]}; }, [data.groups[gid].pins[aid][pA], nbP]);
  Object.assign(nbI, {d:nbM.d, dir:nbM.dir});
  let nbT = await B.innerText('#roseNb');
  check(nbI.id === pB && Math.abs(nbI.m - nbM.m) < 1 && Math.abs(nbI.deg - nbM.deg) <= 1 && nbI.m <= 1500 && nbT.includes(nbP.name) && nbT.includes('(Kalle utan app)') && nbT.includes(`${nbI.d} mot ${nbI.dir} (${nbI.deg}°)`) && nbT.includes('inte spärrad') && await B.locator('.rose-nb.open').count() === 1 && (await B.textContent('.rose-nb .d')) === nbI.d, `passgrannen visas med namn, vem som står där, avstånd och riktning: ${nbT}`);
  await B.click(`.rose-w[data-i="${nbI.i}"]`); nbT = await B.innerText('#roseNb');
  check(nbT.includes('Riktningen är spärrad') && await B.locator('.rose-nb.open').count() === 0 && await B.locator('.rose-nb').count() === 1, 'när riktningen mot grannen spärras syns det direkt');
  await B.click(`.rose-w[data-i="${nbI.i}"]`);
  for(const i of [15, 0, 1]) await B.click(`.rose-w[data-i="${i}"]`);
  check((await B.innerText('#roseTxt')).includes('NNV, N, NNO'), `valda riktningar visas: ${await B.innerText('#roseTxt')}`);
  await B.screenshot({path:shot('b_rose.png')});
  await B.click('#roseOk'); await W(B, 400);
  check(plan().stands[pA].no === (1 | 2 | 32768) && await B.isVisible('#planBody'), `förbjudna riktningar sparas (${plan().stands[pA].no}) och planen öppnas igen`);
  check(JSON.stringify(await B.evaluate(n => __fk.maskRuns(n), plan().stands[pA].no)) === '[[15,3]]', 'riktningarna över norr ritas som en sammanhängande sektor');
  // såt
  await B.click('[data-pl="drive-draw"]'); await W(B, 300);
  check(await B.isVisible('#drawbar') && !(await B.isVisible('#planBody')), 'Rita såt: ritläget öppnas');
  await B.evaluate(() => [[58.7240, 14.6000], [58.7245, 14.6150], [58.7200, 14.6150], [58.7195, 14.6010]].forEach(p => __fk.map.fire('click', {latlng:L.latLng(p[0], p[1])}))); await W(B, 200);
  await B.click('#drawOk'); await W(B, 500);
  const drives = () => Object.values(plan().drives || {});
  check(drives().length === 1 && drives()[0].name === 'Såt 1' && drives()[0].ring.split(';').length === 4 && await B.isVisible('#planBody'), 'såten sparas med namn och fyra hörn, och planen öppnas igen');
  await B.fill('#planBody input[data-pl="dname"]', 'Mossen'); await B.press('#planBody input[data-pl="dname"]', 'Tab'); await W(B, 400);
  check(drives()[0].name === 'Mossen', 'såten kan byta namn');
  // väg för hundförare
  await B.click('[data-pl="route-draw"][data-k="hund"]'); await W(B, 300);
  await B.evaluate(() => [[58.7238, 14.6020], [58.7215, 14.6080], [58.7205, 14.6140]].forEach(p => __fk.map.fire('click', {latlng:L.latLng(p[0], p[1])}))); await W(B, 200);
  await B.click('#drawOk'); await W(B, 500);
  const rid = Object.keys(plan().routes || {})[0];
  check(rid && plan().routes[rid].kind === 'hund' && plan().routes[rid].pts.split(';').length === 3, 'hundförarens väg sparas');
  await B.selectOption(`select[data-pl="rwho"][data-r="${rid}"]`, 'u:alice'); await W(B, 400);
  check(plan().routes[rid].uid === 'alice' && plan().routes[rid].pts.split(';').length === 3, 'Alice blir hundförare, vägen ligger kvar');
  await B.click('[data-pl="route-draw"][data-k="drev"]'); await W(B, 300);
  await B.evaluate(() => [[58.7242, 14.6140], [58.7198, 14.6145]].forEach(p => __fk.map.fire('click', {latlng:L.latLng(p[0], p[1])}))); await W(B, 200);
  await B.click('#drawCancel'); await W(B, 300);
  check(Object.keys(plan().routes).length === 1 && await B.isVisible('#planBody'), 'Avbryt sparar ingen väg och går tillbaka till planen');
  await B.screenshot({path:shot('b_plan.png')});
  await B.click('#plClose'); await W(B, 300);
  // det deltagarna ser
  const cnt = (P, cls) => P.evaluate(c => document.querySelectorAll('path.' + c).length, cls);
  await W(C, 300);
  check(await cnt(C, 'plan-nofire') === 1 && await cnt(C, 'plan-drive') === 1 && await cnt(C, 'plan-route') === 1, 'gästen ser den förbjudna sektorn, såten och vägen på kartan');
  const ctxt = await C.innerText('#paneJakt');
  check(ctxt.includes('Ditt pass: Pass 1 – bäcken') && ctxt.includes('Skjut inte mot NNV, N, NNO') && ctxt.includes('Kalle utan app'), 'gästen ser sitt pass, förbjudna riktningar och vem som står var');
  check(await C.locator('.plan-lbl.who.me').count() === 1 && await C.locator('.plan-lbl.who').count() === 2, 'gästens namn är markerat vid hans pass på kartan');
  check((await A.innerText('#paneJakt')).includes('Du går som hundförare'), 'Alice ser att hon går som hundförare');
  const sec = await C.evaluate(() => { let r = null; __fk.map.eachLayer(l => { if(l instanceof L.Polygon && l.options.className === 'plan-nofire') r = l.getLatLngs()[0].map(p => [p.lat, p.lng]); }); return r; });
  const pp = data.groups[gid].pins[aid][pA], north = sec && sec.reduce((m, p) => Math.max(m, p[0]), -90);
  check(sec && Math.abs(sec[0][0] - pp.lat) < 1e-9 && Math.abs(north - pp.lat - 150 / 111320) < 2e-6, 'sektorn utgår från passet och pekar mot norr, 150 m lång');
  await C.evaluate(() => __fk.map.setView([58.7225, 14.607], 16, {animate:false})); await W(C, 400); await C.screenshot({path:shot('c_plan.png')});
  const cw2 = await C.evaluate(([g, h]) => Promise.all([
    firebase.database().ref('groups/' + g + '/huntPlan/' + h + '/stands/x').set({who:'Carl'}).then(() => 'ok', () => 'denied'),
    firebase.database().ref('groups/' + g + '/huntPlan/' + h).get().then(() => 'ok', () => 'denied'),
    firebase.database().ref('groups/' + g + '/huntPlan').get().then(() => 'ok', () => 'denied')]), [gid, hid]);
  check(cw2.join() === 'denied,ok,denied', `gästen kan läsa sin jakts plan men inte ändra den eller läsa andra jakters (${cw2})`);
  // Kompassen på Carls pass: röda fält för förbjudna riktningar, varning när telefonen pekar dit
  const pa = data.groups[gid].pins[aid][pA];
  await C.click('#btnLocate'); await W(C, 500);
  await C.evaluate(([la, ln]) => __fk.showMe(la, ln, 5), [pa.lat, pa.lng]); await W(C, 300);
  const head = h => C.evaluate(v => { const e = new Event('deviceorientation'); Object.defineProperty(e, 'webkitCompassHeading', {value: v}); window.dispatchEvent(e); }, h).then(() => W(C, 250));
  await C.evaluate(() => { window.__vib = 0; navigator.vibrate = () => { window.__vib++; return true; }; });
  await head(90);
  check(await C.locator('#cmpNo path').count() === 1 && !(await C.evaluate(() => document.getElementById('compassBtn').classList.contains('nofire'))), 'kompassen visar ett rött fält för de förbjudna riktningarna, ingen varning mot öster');
  await head(5);
  check(await C.evaluate(() => document.getElementById('compassBtn').classList.contains('nofire')) && (await C.innerText('#compassTxt')).startsWith('Förbjuden riktning'), `varning när telefonen pekar mot norr: ${await C.innerText('#compassTxt')}`);
  await head(340);
  check(await C.evaluate(() => document.getElementById('compassBtn').classList.contains('nofire')), 'varning också mot NNV');
  check(await C.evaluate(() => window.__vib) === 0, 'telefonen vibrerar inte vid förbjuden riktning');
  await head(320);
  check(!(await C.evaluate(() => document.getElementById('compassBtn').classList.contains('nofire'))), 'ingen varning mot NV, som är tillåtet');
  await C.screenshot({path:shot('c_compass.png'), clip:{x:380, y:0, width:200, height:150}});
  await C.evaluate(([la, ln]) => __fk.showMe(la - 0.01, ln, 5), [pa.lat, pa.lng]); await head(5);
  check(await C.locator('#cmpNo path').count() === 0 && !(await C.evaluate(() => document.getElementById('compassBtn').classList.contains('nofire'))), 'mer än 300 m från passet: inga röda fält och ingen varning');
  await C.evaluate(() => __fk.showMe(58.72, 14.61, 12));
  // ---- Incheckning på passet ----
  const chk = () => (((data.groups[gid].huntCheck || {})[hid] || {})['anon-carl']) || null;
  await B.evaluate(() => { window.__toasts = []; const t = document.getElementById('toast'); new MutationObserver(() => window.__toasts.push(t.textContent)).observe(t, {childList:true, characterData:true, subtree:true}); });
  // Flytta både telefonens (låtsade) GPS och positionen i appen, så att GPS-mätningarna i sparläget ger samma plats
  const at = async (dLat) => { await C.context().setGeolocation({latitude:pa.lat + dLat, longitude:pa.lng, accuracy:5}); await C.evaluate(([la, ln]) => __fk.showMe(la, ln, 5), [pa.lat + dLat, pa.lng]); await W(C, 900); };
  await C.evaluate(() => { window.__ct = []; const t = document.getElementById('toast'); new MutationObserver(() => window.__ct.push(t.textContent)).observe(t, {childList:true, characterData:true, subtree:true}); });
  await at(0.01);   // drygt en kilometer bort
  check(!chk() || chk().in === false, 'långt från passet är Carl inte incheckad');
  check(await C.locator(`[data-j="check-in"][data-h="${hid}"]`).count() === 1 && (await C.innerText('#paneJakt')).includes('Du checkas in automatiskt inom 40 m'), 'Carl har knappen Jag är på passet');
  await at(0.0002); await W(B, 500);   // cirka 22 m
  check(chk() && chk().in === true && chk().pid === pA && chk().name === 'Carl Gäst', 'inom 40 m checkas Carl in automatiskt på sitt pass');
  const bt = await B.evaluate(() => window.__toasts);
  check(bt.some(t => t.includes('Carl Gäst är på plats på Pass 1 – bäcken')) && bt.some(t => t.includes('Alla 1 pass är bemannade')), `jaktledaren får besked: ${JSON.stringify(bt)}`);
  const bj = await B.innerText('#paneJakt');
  check(bj.includes('✓ på plats') && bj.includes('1 av 1 på plats') && await B.locator('.plan-lbl.who.in').count() === 1, 'jaktkortet och kartan visar att passet är bemannat');
  await B.evaluate(() => { const c = document.querySelector('.plan-list'); if(c) c.scrollIntoView(); __fk.map.setView([58.7225, 14.606], 16, {animate:false}); }); await W(B, 400); await B.screenshot({path:shot('b_checkin.png')});
  await C.evaluate(() => { const c = document.querySelector('.check-row'); if(c) c.scrollIntoView(); }); await C.screenshot({path:shot('c_checkin.png'), clip:{x:0, y:0, width:380, height:900}});
  check((await C.innerText('#paneJakt')).includes('✓ Incheckad') && await C.locator(`[data-j="check-out"][data-h="${hid}"]`).count() === 1, 'Carl ser att han är incheckad, och kan säga att han lämnar passet');
  // Sparläge på passet: incheckad och ingen beröring på en stund ger glesare GPS och sändning
  await head(90);   // kompassen pekar åt ett tillåtet håll (mot en förbjuden riktning ska det vara full fart)
  await C.evaluate(() => { __fk.power.touch = 0; __fk.powerUpdate(); }); await W(C, 300);
  const pw1 = await C.evaluate(() => ({on:__fk.power.on, reason:__fk.power.reason, gps:__fk.gpsMode(), chip:!document.getElementById('powerChip').hidden}));
  check(pw1.on && pw1.reason === 'pass' && pw1.gps.timer && !pw1.gps.watch && pw1.chip, `incheckad på passet går appen i sparläge: GPS var 30:e sekund (${JSON.stringify(pw1)})`);
  await C.mouse.click(700, 450); await W(C, 300);
  const pw2 = await C.evaluate(() => ({on:__fk.power.on, gps:__fk.gpsMode()}));
  check(!pw2.on && pw2.gps.watch && !pw2.gps.timer, 'ett tryck på skärmen ger full fart direkt');
  await C.evaluate(() => { __fk.power.touch = 0; __fk.powerUpdate(); });
  await at(0.0006);   // cirka 67 m: inom glappet
  check(chk().in === true, 'mellan 40 och 100 m är man fortfarande incheckad (GPS:en får hoppa)');
  await at(0.0015);   // cirka 167 m
  for(let i = 0; i < 4 && chk().in !== false; i++) await at(0.0015);   // nästa GPS-position, om den förra skrivningen fortfarande pågick
  for(let i = 0; i < 15 && !(await B.innerText('#paneJakt')).includes('lämnade'); i++) await W(B, 200);
  check(chk().in === false && (await B.innerText('#paneJakt')).includes('lämnade'), 'längre bort än 100 m checkas Carl ut, och jaktledaren ser när han lämnade');
  await W(C, 1700);
  const pw3 = await C.evaluate(() => ({on:__fk.power.on, gps:__fk.gpsMode()}));
  check(!pw3.on && pw3.gps.watch, 'när Carl lämnar passet blir det full fart igen');
  check(!(await C.evaluate(() => window.__ct)).some(t => t.includes('Kunde inte läsa')) && await C.evaluate(() => __fk.cloud.sharing), 'ett tillfälligt GPS-fel stänger inte av delningen');
  await C.click(`[data-j="check-in"][data-h="${hid}"]`); await W(C, 700);
  check(chk().in === true, 'Carl kan checka in för hand');
  await C.click(`[data-j="check-out"][data-h="${hid}"]`); await W(C, 700);
  await at(0.0002);
  check(chk().in === false, 'har Carl själv sagt att han lämnar passet checkas han inte in automatiskt igen direkt');
  await at(0.01); await at(0.0002);
  check(chk().in === true, 'efter att ha varit borta från passet gäller den automatiska incheckningen igen');
  const cw3 = await C.evaluate(([g, h, p]) => firebase.database().ref(`groups/${g}/huntCheck/${h}/anon-carl`).set({pid:p, in:true, t:Date.now(), name:'Carl'}).then(() => 'ok', () => 'denied'), [gid, hid, pB]);
  const aw3 = await A.evaluate(([g, h, p]) => firebase.database().ref(`groups/${g}/huntCheck/${h}/anon-carl`).set({pid:p, in:false, t:Date.now(), name:'Carl'}).then(() => 'ok', () => 'denied'), [gid, hid, pA]);
  check(cw3 === 'denied' && aw3 === 'denied', `man kan bara checka in på sitt eget pass, och bara sig själv (${cw3}, ${aw3})`);
  await C.context().setGeolocation({latitude:58.72, longitude:14.61, accuracy:12});
  await C.evaluate(() => __fk.showMe(58.72, 14.61, 12)); await W(C, 600);
  // ---- Jag deltar: positionen delas automatiskt ----
  const hp = () => ((data.groups[gid].huntPos || {})[hid] || {});
  await W(C, 900);
  check(hp()['anon-carl'] && await C.isChecked('#shareToggle') && (await C.innerText('#paneJakt')).includes('delas automatiskt'), 'gästen som gått med via jaktkoden delar sin position automatiskt under jakten');
  await A.click('#tab-jakt'); await W(A, 200);
  check(!(await A.isChecked('#shareToggle')) && !hp().alice && (await A.innerText('#paneJakt')).includes('Carl Gäst (gäst)'), 'Alice har inte svarat och delar inte, men ser att gästen deltar');
  await A.evaluate(() => { window.__toasts = []; const t = document.getElementById('toast'); new MutationObserver(() => window.__toasts.push(t.textContent)).observe(t, {childList:true, characterData:true, subtree:true}); });
  await A.click(`[data-j="rsvp"][data-h="${hid}"]`); await W(A, 900);
  const rs = () => ((data.groups[gid].huntRsvp || {})[hid] || {});
  check(rs().alice && rs().alice.name === 'Alice Test' && await A.isChecked('#shareToggle') && hp().alice, 'Alice trycker Jag deltar: svaret sparas och positionen delas direkt eftersom jakten pågår');
  for(let i = 0; i < 15 && !(await A.evaluate(() => window.__toasts.length)); i++) await W(A, 200);   // vänta på aviseringen
  await W(A, 1200);   // och en stund till, om en andra skulle komma
  { const ts = await A.evaluate(() => window.__toasts); check(ts.length === 1 && ts[0].startsWith('Du deltar'), `bara en avisering när man trycker Jag deltar under jakten: ${JSON.stringify(ts)}`); }
  check((await B.innerText('#paneJakt')).toUpperCase().includes('DELTAR (2)') && (await B.innerText('#paneJakt')).includes('Alice Test, Carl Gäst (gäst)'), 'jaktledaren ser vilka som deltar');
  const rw = await C.evaluate(([g, h]) => firebase.database().ref('groups/' + g + '/huntRsvp/' + h + '/bob').set({name:'Bob', t:Date.now()}).then(() => 'ok', () => 'denied'), [gid, hid]);
  const rw2 = await B.evaluate(([g, h]) => firebase.database().ref('groups/' + g + '/huntRsvp/' + h + '/alice').set({name:'Fejk', t:Date.now()}).then(() => 'ok', () => 'denied'), [gid, hid]);
  check(rw === 'denied' && rw2 === 'denied', 'man kan bara svara för sig själv');
  // ---- Ändra en pågående jakt utan att bryta den ----
  await B.click('#tab-jakt'); await W(B, 200);
  check(await B.locator(`[data-j="hunt-edit"][data-h="${hid}"]`).count() === 1 && await C.locator('[data-j="hunt-edit"]').count() === 0, 'jaktledaren kan ändra jakten, gästen kan inte');
  const hunt0 = JSON.parse(JSON.stringify(data.groups[gid].hunts[hid]));
  await B.click(`[data-j="hunt-edit"][data-h="${hid}"]`); await W(B, 300);
  check(await B.isDisabled('#hfDay') && await B.isDisabled('#hfStart') && (await B.inputValue('#hfName')) === hunt0.name && await B.isChecked('#hfVilt [data-vilt="radjur"]'), 'formuläret är ifyllt, och datum och start ligger fast medan jakten pågår');
  const newEnd = new Date(hunt0.expires - 60000), hhmm = String(newEnd.getHours()).padStart(2, '0') + ':' + String(newEnd.getMinutes()).padStart(2, '0');
  await B.fill('#hfName', 'Älgjakt, eftermiddag'); await B.fill('#hfEnd', hhmm);
  const hasAlg = await B.locator('#hfVilt [data-vilt="alg"]').count();
  if(hasAlg) await B.check('#hfVilt [data-vilt="alg"]');
  await B.click('#hfOk'); await W(B, 700);
  const hunt1 = data.groups[gid].hunts[hid], newExp = hunt1.expires;
  check(hunt1.name === 'Älgjakt, eftermiddag' && hunt1.code === hunt0.code && hunt1.starts === hunt0.starts && hunt1.created === hunt0.created && newExp === new Date(newEnd.getFullYear(), newEnd.getMonth(), newEnd.getDate(), newEnd.getHours(), newEnd.getMinutes(), 59).getTime(), 'jakten har nytt namn och ny sluttid, men samma kod och start');
  check(!hasAlg || (hunt1.species.alg && hunt1.species.radjur), 'nytt vilt läggs till, det gamla finns kvar');
  check(data.huntCodes[hunt0.code].expires === newExp && data.groups[gid].guests['anon-carl'].expires === newExp, 'jaktkoden och gästens åtkomst följer den nya sluttiden');
  check(hp()['anon-carl'] && ((data.groups[gid].huntPlan || {})[hid] || {}).stands && rs().alice, 'positioner, plan och svar finns kvar efter ändringen');
  await W(C, 500);
  check((await C.innerText('#paneJakt')).includes('Älgjakt, eftermiddag') && await C.isChecked('#shareToggle'), 'gästen ser det nya namnet och delar fortfarande sin position');
  // ---- Krypterade meddelanden ----
  await W(A, 400); await W(B, 400); await W(C, 400);
  const keys = () => data.groups[gid].msgKeys || {};
  const carlKey = Object.values(keys()['anon-carl'] || {})[0];
  check(Object.keys(keys().alice || {}).length === 1 && Object.keys(keys().bob || {}).length === 1 && carlKey && carlKey.hid === hid && carlKey.name === 'Carl Gäst', 'varje deltagare har publicerat sin nyckel, gästens är märkt med jakten');
  const msgs = () => Object.values(((data.groups[gid].huntMsg || {})[hid]) || {});
  await B.click('#tab-jakt'); await W(B, 200);
  await B.click(`[data-j="msg-new"][data-h="${hid}"]`); await W(B, 200);
  const opts2 = await B.locator('#msgPeople .checkline').allInnerTexts();
  check(opts2.length === 2 && opts2.some(o => o.includes('Alice Test')) && opts2.some(o => o.includes('Carl Gäst (gäst)')) && await B.isChecked('#msgAll'), `mottagare: alla i jakten, eller valda (${opts2.join(' | ')})`);
  await B.uncheck('#msgAll'); await B.check('[data-to="anon-carl"]'); await B.fill('#msgText', 'Hej Carl, du står på pass 1'); await B.click('#msgSend'); await W(B, 900);
  const m1 = msgs()[0];
  check(msgs().length === 1 && m1.from === 'bob' && m1.to && m1.to['anon-carl'] && !m1.all && Object.keys(m1.keys).length === 2, 'meddelandet till Carl sparas med en nyckel till Carl och en till Bob');
  check(!JSON.stringify(data).includes('Hej Carl') && !JSON.stringify(data).includes('pass 1'), 'texten finns inte i klartext någonstans i databasen');
  await W(C, 600); await C.click('#tab-jakt'); await W(C, 400);
  check((await C.innerText('#paneJakt')).includes('Hej Carl, du står på pass 1'), 'Carl kan läsa meddelandet till honom');
  check(!(await A.innerText('#paneJakt')).includes('Hej Carl') && (await A.evaluate(() => Object.values(__fk.msgPlain()).filter(Boolean).filter(p => p.text).length)) === 0, 'Alice ser inte meddelandet, och kan inte låsa upp det');
  await B.click(`[data-j="msg-new"][data-h="${hid}"]`); await W(B, 200);
  await B.fill('#msgText', 'Samling vid bilarna 15.00'); await B.click('#msgSend'); await W(B, 900);
  await W(A, 600);
  check((await A.innerText('#paneJakt')).includes('Samling vid bilarna 15.00') && (await C.innerText('#paneJakt')).includes('Samling vid bilarna 15.00') && msgs().some(m => m.all), 'meddelande till alla: Alice och Carl kan läsa det');
  check((await A.innerText('#toast')).includes('Meddelande från Bob Test: Samling vid bilarna'), `mottagaren får en avisering: ${await A.innerText('#toast')}`);
  await C.click(`[data-j="msg-reply"][data-h="${hid}"][data-u="bob"] >> nth=0`); await W(C, 200);
  check(!(await C.isChecked('#msgAll')) && await C.isChecked('[data-to="bob"]'), 'Svara väljer avsändaren som mottagare');
  await C.fill('#msgText', 'Uppfattat, jag går dit nu'); await C.click('#msgSend'); await W(C, 900); await W(B, 500);
  check((await B.innerText('#paneJakt')).includes('Uppfattat, jag går dit nu') && !(await A.innerText('#paneJakt')).includes('Uppfattat'), 'gästens svar når Bob men inte Alice');
  await A.screenshot({path:shot('a_msg.png')}); await C.screenshot({path:shot('c_msg.png')});
  // Gamla enheters nycklar: Bobs egen gamla nyckel tas bort, och ingen krypterar till Alices gamla
  const old = Date.now() - 100 * 864e5, okKey = Object.values(keys().bob)[0].k;
  await B.evaluate(([g, k, t]) => firebase.database().ref(`groups/${g}/msgKeys/bob/dgammal`).set({k, name:'Bob Test', t}), [gid, okKey, old]);
  await A.evaluate(([g, k, t]) => firebase.database().ref(`groups/${g}/msgKeys/alice/dgammal`).set({k, name:'Alice Test', t}), [gid, okKey, old]); await W(B, 900);
  const aliceDevs = await B.evaluate(([g, h]) => __fk.msgPeopleFor(g, h).find(p => p.uid === 'alice').devices.length, [gid, hid]);
  check(!(keys().bob || {}).dgammal && aliceDevs === 1, `Bobs app tar bort hans gamla enhets nyckel och krypterar inte till Alices gamla (${aliceDevs} enhet)`);
  // En öppen nålruta hos Bob stängs inte när Carl skickar ett meddelande
  await B.evaluate(() => __fk.map.setView([58.72, 14.6], 15, {animate:false})); await W(B, 300);
  await B.evaluate(() => { let m = null; __fk.map.eachLayer(l => { if(l.pinId && !m) m = l; }); m.openPopup(); }); await W(B, 300);
  const popBefore = await B.locator('.leaflet-popup').count();
  await C.click(`[data-j="msg-new"][data-h="${hid}"]`); await W(C, 200); await C.fill('#msgText', 'Jag ser en räv'); await C.click('#msgSend'); await W(C, 900); await W(B, 600);
  check(popBefore === 1 && await B.locator('.leaflet-popup').count() === 1 && (await B.innerText('#paneJakt')).includes('Jag ser en räv'), 'Bobs öppna nålruta ligger kvar när ett nytt meddelande kommer');
  await B.evaluate(() => __fk.map.closePopup());
  // Försök att lura systemet
  const fake = await A.evaluate(([g, h, m]) => Promise.all([
    firebase.database().ref(`groups/${g}/huntMsg/${h}/mfake1`).set(Object.assign({}, m, {from:'bob', t:Date.now()})).then(() => 'ok', () => 'denied'),
    firebase.database().ref(`groups/${g}/huntMsg/${h}/${m.mid}`).set(Object.assign({}, m, {from:'alice'})).then(() => 'ok', () => 'denied')]),
    [gid, hid, Object.assign({mid:Object.keys(data.groups[gid].huntMsg[hid])[0]}, msgs()[0])]);
  check(fake.join() === 'denied,denied', `man kan inte skriva i någon annans namn eller ändra ett meddelande (${fake})`);
  // Alice kopierar Bobs krypterade meddelande till alla och skickar det som sitt eget: det går inte att läsa som Alices
  const allMsg = msgs().find(m => m.all), copy = Object.assign({}, allMsg, {from:'alice', name:'Alice Test', t:Date.now()});
  delete copy.mid;
  const cp = await A.evaluate(([g, h, m]) => firebase.database().ref(`groups/${g}/huntMsg/${h}/mcopy1`).set(m).then(() => 'ok', () => 'denied'), [gid, hid, copy]); await W(C, 700);
  const ctx2 = await C.innerText('#paneJakt');
  check(cp === 'ok' && ctx2.includes('Kunde inte bekräfta avsändaren'), 'ett kopierat meddelande avslöjas: avsändaren kan inte bekräftas');
  // ---- Positioner ----
  await A.click('#tab-jakt'); await A.locator('#shareToggle').check({force:true}); await W(A, 900);
  check(hp().alice && Math.abs(hp().alice.lat - 58.72) < 1e-6 && !data.groups[gid].positions, 'Alice delar sin position i den pågående jakten');
  check(await B.locator('.pos-icon').count() === 2 && await C.locator('.pos-icon').count() === 1 && await A.locator('.pos-icon').count() === 1, 'Bob ser Alice och Carl, Carl ser Alice, Alice ser Carl men inte sig själv');
  await C.locator('#shareToggle').check({force:true}); await W(C, 900);
  check(await A.locator('.pos-icon').count() === 1 && (await A.innerText('#posCount')).startsWith('1 person'), 'gästens position syns för laget');
  // ---- Spår ----
  const tr = () => (((data.groups[gid].huntTrail || {})[hid] || {}).alice || {});
  check(Object.keys(tr()).length >= 1, 'Alices spårpunkt sparas i jakten');
  await A.evaluate(([g, h]) => { const r = firebase.database().ref('groups/' + g + '/huntTrail/' + h + '/alice'); return Promise.all([r.push({lat:58.7150, lng:14.5950, t:Date.now() - 20 * 60000}), r.push({lat:58.7155, lng:14.5955, t:Date.now() - 19 * 60000}), r.push({lat:58.7180, lng:14.5980, t:Date.now() - 10 * 60000}), r.push({lat:58.7185, lng:14.5985, t:Date.now() - 9 * 60000})]); }, [gid, hid]); await W(B, 600);
  const aliceColor = await B.evaluate(() => __fk.personColor('alice'));
  const lines = (P, c) => P.evaluate(c => { let n = 0; __fk.map.eachLayer(l => { if(l instanceof L.Polyline && !(l instanceof L.Polygon) && l.options.color === c) n++; }); return n; }, c);
  const minLat = (P, c) => P.evaluate(c => { let m = 99; __fk.map.eachLayer(l => { if(l instanceof L.Polyline && !(l instanceof L.Polygon) && l.options.color === c) l.getLatLngs().forEach(p => { m = Math.min(m, p.lat); }); }); return m; }, c);
  const bobPin = await B.evaluate(() => getComputedStyle(document.querySelector('.pos-dot')).backgroundColor);
  check(await lines(B, aliceColor) === 3 && Math.abs(await minLat(B, aliceColor) - 58.715) < 1e-6 && bobPin !== 'rgb(26, 115, 232)', 'Bob ser Alices spår i hennes färg (standard 30 min), uppdelat vid glapp i tid');
  const setMin = (P, v) => P.evaluate(v => { const r = document.getElementById('trailMin'); r.value = v; r.dispatchEvent(new Event('input', {bubbles:true})); r.dispatchEvent(new Event('change', {bubbles:true})); }, v);
  await setMin(B, 0); await W(B, 300);
  check(await lines(B, aliceColor) === 0 && (await B.innerText('#trailMinTxt')) === 'Av', 'reglaget på Av döljer spåren');
  await setMin(B, 5); await W(B, 300);
  check(await minLat(B, aliceColor) > 58.719, 'med 5 minuter syns inte punkter som är 10 och 20 minuter gamla');
  await setMin(B, 15); await W(B, 300);
  check(await lines(B, aliceColor) === 2 && Math.abs(await minLat(B, aliceColor) - 58.718) < 1e-6 && (await B.innerText('#trailMinTxt')) === '15 min' && (await st(B)).settings.trailMin === 15, 'med 15 minuter syns spåret från 10 minuter sedan, och valet sparas');
  const forged = await B.evaluate(([g, h]) => firebase.database().ref('groups/' + g + '/huntTrail/' + h + '/alice').push({lat:1, lng:1, t:Date.now()}).then(() => 'ok', () => 'denied'), [gid, hid]);
  check(forged === 'denied', 'man kan inte skriva i någon annans spår');
  // ---- Viltobservationer ----
  check(await B.isVisible('#btnObs') && await C.isVisible('#btnObs'), 'kikaren syns under pågående jakt, även för gästen');
  await B.click('#btnObs'); await W(B, 200); await B.click('[data-obs-kind="obs"]'); await W(B, 400); await B.click('#placeOk'); await W(B, 300);
  check(await B.isVisible('#obForm') && (await B.innerText('#obSp')).includes('Rådjur'), 'observationsformuläret öppnas med jaktens vilt');
  await B.selectOption('#obSp', 'Rådjur'); await B.fill('#obN', '2'); await B.fill('#obNote', 'Get och kid'); await B.click('#obForm button[type=submit]'); await W(B, 700);
  const obs = () => Object.values(((data.groups[gid].huntObs || {})[hid]) || {});
  check(obs().length === 1 && obs()[0].sp === 'Rådjur' && obs()[0].n === 2 && obs()[0].by === 'bob' && obs()[0].note === 'Get och kid', 'Bobs observation sparas i jakten');
  await W(C, 400);
  check(await A.locator('.obs-icon').count() === 1 && await C.locator('.obs-icon').count() === 1, 'Alice och gästen Carl ser observationen på kartan');
  check((await A.innerText('#paneJakt')).includes('Get och kid'), 'observationen listas i jaktkortet');
  const bobOid = Object.keys(data.groups[gid].huntObs[hid])[0];
  const cw = await C.evaluate(([g, h, o]) => Promise.all([
    firebase.database().ref('groups/' + g + '/huntObs/' + h).push({sp:'Vildsvin', n:1, lat:58.722, lng:14.61, t:Date.now(), by:'anon-carl', name:'Carl'}).then(() => 'ok', () => 'denied'),
    firebase.database().ref('groups/' + g + '/huntObs/' + h + '/' + o).remove().then(() => 'ok', () => 'denied'),
    firebase.database().ref('groups/' + g + '/huntObs/' + h).push({sp:'Älg', n:1, lat:58.72, lng:14.6, t:Date.now(), by:'bob'}).then(() => 'ok', () => 'denied')]), [gid, hid, bobOid]);
  check(cw.join() === 'ok,denied,denied', `gästen kan lägga in egna observationer men inte ta bort andras eller skriva i någon annans namn (${cw})`);
  await W(A, 400);
  check(await A.locator('.obs-icon').count() === 2, 'Alice ser båda observationerna');
  // ---- Fällt vilt: under samma knapp som viltobservation ----
  await B.click('#btnObs'); await W(B, 200);
  const menu = await B.locator('#obsMenu [data-obs-kind]').allInnerTexts();
  check(await B.isVisible('#obsMenu') && menu.length === 2 && menu[0].includes('Viltobservation') && menu[1].includes('Fällt vilt'), `kikaren ger ett val: ${menu.join(' | ')}`);
  await B.click('[data-obs-kind="kill"]'); await W(B, 400);
  check((await B.innerText('#placeOk')) === 'Viltet fälldes här', 'placeringen säger var viltet fälldes');
  await B.click('#placeOk'); await W(B, 300);
  check((await B.innerText('#obForm')).includes('Kön') && await B.inputValue('#obShooter') === 'Bob Test', 'formuläret för fällt vilt har kön, ålder och skytt (Bob som standard)');
  await B.selectOption('#obSp', 'Rådjur'); await B.selectOption('#obSex', 'f'); await B.selectOption('#obAge', 'ad');
  await B.click('#obForm button[type=submit]'); await W(B, 700);
  const killE = Object.entries(data.groups[gid].huntObs[hid]).find(([, o]) => o.kind === 'kill');
  check(killE && killE[1].sp === 'Rådjur' && killE[1].sex === 'f' && killE[1].age === 'ad' && killE[1].shooter === 'Bob Test' && killE[1].by === 'bob', 'fällt vilt sparas med art, kön, ålder och skytt');
  await W(A, 500);
  const at2 = await A.innerText('#paneJakt');
  check(at2.includes('Rådjur 1') && at2.toUpperCase().includes('FÄLLT VILT (1)') && at2.includes('hona, vuxen, skytt Bob Test') && await A.locator('.obs-icon .obs-dot.kill').count() === 1, 'jaktkortet och kartan visar fällt vilt för sig');
  const kw = await C.evaluate(([g, h]) => firebase.database().ref(`groups/${g}/huntObs/${h}`).push({sp:'Älg', n:1, lat:58.72, lng:14.61, t:Date.now(), by:'anon-carl', kind:'kill', sex:'x'}).then(() => 'ok', () => 'denied'), [gid, hid]);
  check(kw === 'denied', 'fällt vilt tar bara emot giltiga värden för kön och ålder');
  await B.evaluate(([g, h, o]) => firebase.database().ref(`groups/${g}/huntObs/${h}/${o}`).remove(), [gid, hid, killE[0]]); await W(A, 500);
  check(!data.groups[gid].huntObs[hid][killE[0]] && await A.locator('.obs-icon .obs-dot.kill').count() === 0, 'den som registrerat fällt vilt kan ta bort det');
  // ---- Nödläge ----
  check(await A.isVisible('#btnSos') && await B.isVisible('#btnSos') && await C.isVisible('#btnSos'), 'alla i jaktlaget, även gästen, har knappen SOS');
  await C.click('#btnSos'); await W(C, 200);
  check(await C.isVisible('#sosSend') && (await C.innerText('.modal')).includes('Ring 112'), 'SOS frågar först, och visar Ring 112');
  const sos = () => (data.groups[gid].sos || {})['anon-carl'];
  await C.click('#sosSend');
  for(let i = 0; i < 50 && !sos(); i++) await W(C, 200);   // appen försöker först få en färsk position (högst 8 s)
  await W(A, 800);
  check(sos() && sos().name === 'Carl Gäst' && Math.abs(sos().lat - 58.72) < 1e-6 && Math.abs(sos().lng - 14.61) < 1e-6, 'nödlarmet sparas med namn och position');
  for(const [n, P] of [['Alice', A], ['Bob', B]]){
    const t = await P.isVisible('#sosAlert') ? await P.innerText('#sosAlert') : '';
    const href = await P.isVisible('#sosNav') ? await P.getAttribute('#sosNav', 'href') : '';
    check(t.includes('Carl Gäst') && t.includes('Vill du navigera') && href.includes('destination=58.72') && await P.locator('.sos-icon').count() === 1, `${n} får larmet, med frågan om att navigera till Carl och en markering på kartan`);
  }
  await A.screenshot({path:shot('a_sos.png')});
  check(await C.isVisible('#sosBar') && await C.evaluate(() => document.getElementById('btnSos').classList.contains('on')), 'Carl ser att hans larm är aktivt');
  await A.click('#sosClose'); await B.click('#sosClose'); await W(A, 200);
  const sw1 = await A.evaluate(g => Promise.all([
    firebase.database().ref(`groups/${g}/sos/bob`).set({t:Date.now(), name:'Bob'}).then(() => 'ok', () => 'denied'),
    firebase.database().ref(`groups/${g}/sos/alice`).set({t:Date.now(), name:'Alice', extra:1}).then(() => 'ok', () => 'denied')]), gid);
  check(sw1.join() === 'denied,denied', `man kan bara larma för sig själv, utan extra fält (${sw1})`);
  await A.evaluate(() => { window.__toasts = []; });
  await C.click('#sosBar [data-sos="ok"]'); await W(C, 200); await C.click('#sosOk'); await W(C, 800); await W(A, 500);
  check(!sos() && (await A.evaluate(() => window.__toasts)).some(t => t.includes('Carl Gäst har avbrutit nödlarmet')) && await A.locator('.sos-icon').count() === 0 && !(await C.isVisible('#sosBar')), 'Carl avbryter: larmet tas bort och laget får besked');
  await A.evaluate(() => { const o = document.querySelector('.obs-icon'); if(o) o.scrollIntoView(); }); await A.screenshot({path:shot('a_obs.png')});
  await A.locator('#shareToggle').uncheck({force:true}); await W(A, 500);
  check(!hp().alice && !Object.keys(tr()).length && await B.locator('.pos-icon').count() === 1, 'Alice slutar dela: hennes position och spår tas bort');
  await W(A, 600);
  check(!(await A.isChecked('#shareToggle')) && !hp().alice, 'stänger man av själv startas delningen inte igen automatiskt under samma jakt');
  // ---- Såtar som minijakter: pass per såt, lotta pass, starta och bryta, återsamling ----
  const PLN = () => (data.groups[gid].huntPlan || {})[hid] || {};
  const dM = Object.keys(PLN().drives || {})[0];
  await B.click('#tab-jakt'); await W(B, 200); await B.click(`[data-j="plan"][data-h="${hid}"]`); await W(B, 400);
  check(await B.locator('#planBody [data-pl="easy"]').count() === 2 && await B.locator('#planBody .gear-row').count() >= 3, 'planeringen har passens egenskaper och deltagarnas utrustning');
  await B.check(`#planBody [data-pl="easy"][data-p="${pA}"]`); await W(B, 700);
  await B.selectOption(`#planBody [data-pl="ammo"][data-p="${pB}"]`, 'kula'); await W(B, 700);
  check(data.groups[gid].pins[aid][pA].easy === true && data.groups[gid].pins[aid][pB].ammo === 'kula' && !data.groups[gid].pins[aid][pB].easy, 'lättillgängligt och kula sparas på passen i laget');
  await B.selectOption('#planBody .gear-row[data-u="alice"] [data-pl="gun"]', 'hagel'); await W(B, 500);
  await B.check('#planBody .gear-row[data-u="alice"] [data-pl="geasy"]'); await W(B, 600);
  { const ga = (data.groups[gid].gear || {}).alice || {}; check(ga.name === 'Alice Test' && ga.gun === 'hagel' && ga.easy === true, 'jaktledaren för in att Alice har hagel och behöver ett lättillgängligt pass'); }
  check(await C.evaluate(g => firebase.database().ref('groups/' + g + '/gear').get().then(() => 'ok', () => 'denied'), gid) === 'denied', 'gästen kan inte läsa deltagarnas utrustning');
  // en till såt, och ordningen
  await B.click('#planBody [data-pl="drive-draw"]:not([data-d])'); await W(B, 300);
  await B.evaluate(() => [[58.7180, 14.6000], [58.7185, 14.6150], [58.7150, 14.6150], [58.7145, 14.6010]].forEach(p => __fk.map.fire('click', {latlng:L.latLng(p[0], p[1])}))); await W(B, 200);
  await B.click('#drawOk'); await W(B, 700);
  const d2 = Object.keys(PLN().drives).find(k => k !== dM), dNames = () => B.evaluate(([g, h]) => __fk.driveList(__fk.cloud.groups[g].huntPlan[h]).map(([, d]) => d.name).join(','), [gid, hid]);
  const openBox = d => B.evaluate(d => { const x = document.querySelector(`details.drive-box[data-d="${d}"]`); if(x) x.open = true; }, d).then(() => W(B, 100));
  check(d2 && PLN().drives[d2].name === 'Såt 2' && PLN().drives[d2].ord === PLN().drives[dM].ord + 1 && await dNames() === 'Mossen,Såt 2', `en ny såt hamnar sist: ${await dNames()} ${JSON.stringify(PLN().drives[d2] && {n:PLN().drives[d2].name, o:PLN().drives[d2].ord})}`);
  await openBox(d2); await B.click(`#planBody [data-pl="up"][data-d="${d2}"]`); await W(B, 600);
  check(await dNames() === 'Såt 2,Mossen', 'jaktledaren flyttar upp en såt');
  await openBox(dM); await B.click(`#planBody [data-pl="up"][data-d="${dM}"]`); await W(B, 600);
  check(await dNames() === 'Mossen,Såt 2' && PLN().drives[dM].ord === 0 && PLN().drives[d2].ord === 1, 'och tillbaka: ordningen sparas');
  // pass i såten, med varning när passet inte passar
  await B.evaluate(d => { const x = document.querySelector(`details.drive-box[data-d="${d}"]`); if(x) x.open = true; }, dM); await W(B, 100);
  await B.selectOption(`#planBody [data-pl="dwho"][data-d="${dM}"][data-p="${pB}"]`, 'u:alice'); await W(B, 300);
  { const wt = await B.innerText('.modal'); check(wt.includes('Alice Test behöver ett lättillgängligt pass') && wt.includes('har bara hagel') && await B.isVisible('#pwOk'), `varning när Alice placeras på ett kulpass som inte är lättillgängligt: ${wt.split('\n').slice(0, 3).join(' | ')}`); }
  await B.click('#pwNo'); await W(B, 500);
  check(!((PLN().drives[dM].pass || {})[pB]) && await B.isVisible('#planBody'), 'Avbryt: Alice placeras inte, och planeringen öppnas igen');
  await B.evaluate(d => { const x = document.querySelector(`details.drive-box[data-d="${d}"]`); if(x) x.open = true; }, dM); await W(B, 100);
  await B.selectOption(`#planBody [data-pl="dwho"][data-d="${dM}"][data-p="${pB}"]`, 'u:alice'); await W(B, 300); await B.click('#pwOk'); await W(B, 700);
  { const x = PLN().drives[dM].pass[pB]; check(x && x.uid === 'alice' && x.ok === true && (await B.innerText('#planBody')).includes('Godkänd avvikelse'), 'Placera ändå: Alice står på passet, och avvikelsen syns som godkänd'); }
  await B.selectOption(`#planBody [data-pl="dwho"][data-d="${dM}"][data-p="${pA}"]`, 'u:anon-carl'); await W(B, 700);
  check(PLN().drives[dM].pass[pA].uid === 'anon-carl' && !(await B.isVisible('#pwOk')), 'Carl placeras utan varning (ingen utrustning angiven)');
  // lotta pass i såt 2
  check(JSON.stringify(await B.evaluate(() => { const g = {gear:{u1:{name:'U1', gun:'both', easy:true}, u2:{name:'U2', gun:'kula'}}}, ps = [{id:'p1', name:'P1'}, {id:'p2', name:'P2', easy:true}, {id:'p3', name:'P3', ammo:'hagel'}], us = [{uid:'u2', name:'U2'}, {uid:'u1', name:'U1'}, {uid:'u3', name:'U3'}];
    const ok = []; for(let i = 0; i < 40; i++){ const r = __fk.lottery(g, ps, us).out; ok.push(r.p2.uid === 'u1' && r.p3.uid === 'u3' && r.p1.uid === 'u2'); } return [...new Set(ok)]; })) === '[true]', 'lottningen ger alltid den som behöver lättillgängligt pass ett sådant, och kula-skytten inte hagelpasset');
  await B.evaluate(d => { const x = document.querySelector(`details.drive-box[data-d="${d}"]`); if(x) x.open = true; }, d2); await W(B, 100);
  await B.click(`#planBody [data-pl="lot"][data-d="${d2}"]`); await W(B, 300);
  const lotPeople = await B.evaluate(() => [...document.querySelectorAll('[data-lu]')].filter(c => c.checked).map(c => c.dataset.lu));
  check(await B.locator('[data-lp]').count() === 2 && lotPeople.includes('alice') && lotPeople.includes('anon-carl'), `lottningen föreslår alla pass och de som deltar (${lotPeople})`);
  await B.click('#lotOk'); await W(B, 800);
  await openBox(d2); await B.evaluate(d => document.querySelector(`details.drive-box[data-d="${d}"]`).scrollIntoView(), d2); await B.screenshot({path:shot('b_plan_drives.png')});
  { const ps = PLN().drives[d2].pass || {}; check(ps[pA] && ps[pA].uid === 'alice' && ps[pB] && lotPeople.includes(ps[pB].uid) && ps[pB].uid !== 'alice', `passen i såt 2 är lottade, och Alice fick det lättillgängliga passet (${JSON.stringify(ps)})`); }
  await B.click('#plClose'); await W(B, 300);
  // under jakten: Carl ser sitt pass i nästa såt, jaktledaren startar såten
  await W(C, 400); await C.click('#tab-jakt'); await W(C, 200);
  check((await C.innerText('#paneJakt')).includes('Ditt pass i nästa såt, Mossen: Pass 1 – bäcken'), 'Carl ser sitt pass i nästa såt');
  check(await B.locator(`[data-j="drive-start"][data-h="${hid}"]`).count() === 1 && await C.locator('[data-j="drive-start"]').count() === 0, 'jaktledaren kan starta såten, gästen kan inte');
  await B.click(`[data-j="drive-start"][data-h="${hid}"]`); await W(B, 1200); await W(C, 600);
  check(PLN().cur && PLN().cur.did === dM && PLN().cur.on === true && (await C.innerText('#driveBar')).includes('Mossen har startat') && (await C.innerText('#driveBar')).includes('Ditt pass: Pass 1 – bäcken'), `Mossen startar: Carl får besked överst med sitt pass (${await C.innerText('#driveBar')})`);
  check((await C.innerText('#paneJakt')).includes('Mossen har startat. Gå till era pass.'), 'starten skickas i chatten');
  await C.screenshot({path:shot('c_drive_start.png')});
  await B.click(`[data-j="drive-stop"][data-h="${hid}"]`); await W(B, 100); await B.click(`[data-j="drive-stop"][data-h="${hid}"]`); await W(B, 1200); await W(C, 600); await W(A, 400);
  check(PLN().cur.on === false && PLN().drives[dM].done > 0 && (await C.innerText('#driveBar')).includes('Såten är bruten, patron ur.'), 'jaktledaren bryter såten efter en bekräftelse: alla får besked överst');
  check((await C.innerText('#paneJakt')).includes('Såten är bruten, patron ur.') && (await A.innerText('#paneJakt')).includes('Såten är bruten, patron ur.'), 'Såten är bruten, patron ur. skickas i chatten till alla');
  // samlingsplats och återsamling
  await B.click(`[data-j="plan"][data-h="${hid}"]`); await W(B, 300);
  await B.click('#planBody [data-pl="meet-add"]'); await W(B, 400);
  check(await B.isVisible('#placebar') && (await B.innerText('#placeOk')) === 'Samlingsplats här', 'samlingsplatsen placeras med korset');
  await B.click('#placeOk'); await W(B, 300); await B.fill('#mtName', 'boden'); await B.click('#mtForm button[type=submit]'); await W(B, 800);
  const mid = Object.keys(PLN().meets || {})[0], meet = mid && PLN().meets[mid];
  check(meet && meet.name === 'boden' && typeof meet.lat === 'number' && await B.isVisible('#planBody'), 'samlingsplatsen boden är sparad i planen');
  await B.click('#plClose'); await W(B, 300);
  await B.click(`[data-j="drive-call"][data-h="${hid}"][data-m="${mid}"]`); await W(B, 1200); await W(C, 600);
  { const bar = await C.innerText('#driveBar'), href = await C.getAttribute('#driveNav', 'href');
    check(PLN().call && PLN().call.name === 'boden' && bar.includes('Återsamling vid boden') && href.includes('google.com/maps/dir') && href.includes('destination=' + meet.lat.toFixed(6)), `återsamling vid boden: alla får en hänvisning att navigera dit (${bar})`); }
  check((await C.innerText('#paneJakt')).includes('Återsamling vid boden.') && await C.locator('.meet-icon.on').count() === 1, 'återsamlingen skickas i chatten och syns på kartan');
  await C.screenshot({path:shot('c_drive_call.png')});
  await B.evaluate(([g, h]) => document.getElementById(`hc-${g}-${h}`).querySelector('.drive-list').scrollIntoView(), [gid, hid]); await B.screenshot({path:shot('b_drive_card.png')});
  await C.click('#driveBar [data-db="x"]'); await W(C, 200);
  check(await C.isHidden('#driveBar'), 'raden överst går att stänga');
  // nästa såt: hundföraren och passkyttarna får det som gäller i såt 2
  check((await B.innerText(`[data-j="drive-start"][data-h="${hid}"]`)).includes('Starta Såt 2'), 'nästa såt i ordningen är Såt 2');
  await B.click(`[data-j="drive-start"][data-h="${hid}"]`); await W(B, 1200); await W(C, 600);
  const carlPass2 = Object.entries(PLN().drives[d2].pass).find(([, x]) => x.uid === 'anon-carl');
  check(PLN().cur.did === d2 && !PLN().call && (await C.isVisible('#driveBar')) && (carlPass2 ? (await C.innerText('#driveBar')).includes('Ditt pass: ' + data.groups[gid].pins[aid][carlPass2[0]].name) : true), 'Såt 2 startar: återsamlingen tas bort och Carl får sitt nya pass');
  check(JSON.stringify(Object.keys(await C.evaluate(([g, h]) => __fk.planStands(__fk.cloud.groups[g].huntPlan[h]), [gid, hid])).sort()) === JSON.stringify(Object.keys(PLN().drives[d2].pass).concat(Object.keys(PLN().stands || {}).filter(k => PLN().stands[k].no)).filter((v, i, a) => a.indexOf(v) === i).sort()), 'passen som gäller är såt 2:s');
  check(await C.evaluate(([g, h]) => firebase.database().ref(`groups/${g}/huntPlan/${h}/cur`).set({did:'x', on:true, t:Date.now()}).then(() => 'ok', () => 'denied'), [gid, hid]) === 'denied', 'gästen kan inte starta eller bryta en såt');
  await B.click(`[data-j="drive-stop"][data-h="${hid}"]`); await W(B, 100); await B.click(`[data-j="drive-stop"][data-h="${hid}"]`); await W(B, 900);
  check(PLN().drives[d2].done > 0 && !(await B.locator(`[data-j="drive-start"][data-h="${hid}"]`).count()), 'när alla såtar är brutna finns ingen nästa såt');
  // Kommande jakt: delningen startar själv när jakten startar och slutar när den är slut
  const h2 = 'h2kvall', t2 = Date.now();
  await B.evaluate(() => { __fk.cloud.cleanAfter = 3000; });   // i appen: en timme efter sluttiden
  await B.evaluate(([g, h, t]) => firebase.database().ref().update({[`groups/${g}/hunts/${h}`]: {name:'Kvällsjakt', day:'2026-11-14', starts:t + 5000, expires:t + 16000, code:'KVALL234', by:'bob', created:t, areas:{}, species:{}}, 'huntCodes/KVALL234': {gid:g, hid:h, expires:t + 16000}}), [gid, h2, t2]); await W(A, 500);
  check((await A.innerText('#paneJakt')).includes('Kvällsjakt') && (await A.innerText('#paneJakt')).includes('KOMMANDE'), 'Alice ser den kommande jakten');
  await A.click(`[data-j="rsvp"][data-h="${h2}"]`); await W(A, 600);
  const hp2 = () => ((data.groups[gid].huntPos || {})[h2] || {});
  check(((data.groups[gid].huntRsvp || {})[h2] || {}).alice && !(await A.isChecked('#shareToggle')) && !hp2().alice, 'Alice deltar i kvällsjakten, men inget delas innan den startar');
  await A.waitForTimeout(Math.max(0, t2 + 5000 - Date.now()) + 1800);
  check(await A.isChecked('#shareToggle') && hp2().alice && !hp().alice, 'när kvällsjakten startar delas Alices position automatiskt, bara i den jakten');
  await A.waitForTimeout(Math.max(0, t2 + 16000 - Date.now()) + 1800);
  check(!(await A.isChecked('#shareToggle')) && (await A.evaluate(() => __fk.cloud.sharing)) === false, 'när kvällsjakten är slut slutar delningen av sig själv');
  await B.click('#tab-jakt'); await W(B, 200);
  check(!!data.groups[gid].hunts[h2] && (await B.innerText('#paneJakt')).includes('Tas bort automatiskt'), 'en jakt som passerat sluttiden finns kvar en stund, med besked om när den tas bort');
  await B.waitForTimeout(Math.max(0, t2 + 16000 + 3000 - Date.now()) + 2500);
  check(!data.groups[gid].hunts[h2] && !(data.groups[gid].huntRsvp || {})[h2] && !(data.groups[gid].huntPos || {})[h2] && !(data.huntCodes || {})['KVALL234'], 'kvällsjakten städas bort av sig själv efter sluttiden, med kod, svar och positioner');
  await B.evaluate(() => { __fk.cloud.cleanAfter = 3600000; });
  // ---- Planera i förväg: kalender, inbjudan, avböj, automatisk start och start för hand ----
  check(await A.evaluate(() => [[2026, 0, 1], [2027, 0, 1], [2026, 10, 16], [2026, 11, 28]].map(([y, m, d]) => __fk.isoWeek(new Date(y, m, d))).join()) === '1,53,47,53', 'kalendern räknar veckonummer rätt');
  const futD = new Date(); futD.setDate(futD.getDate() + 40);
  const futISO = `${futD.getFullYear()}-${String(futD.getMonth() + 1).padStart(2, '0')}-${String(futD.getDate()).padStart(2, '0')}`;
  const MONS = ['jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec'];
  await B.click('#tab-jakt'); await W(B, 200); await B.click(`[data-j="hunt-new"][data-g="${gid}"]`); await W(B, 200);
  check(await B.isChecked('input[name=hfMode][value=manual]') && await B.isDisabled('#hfStart'), 'en ny jakt startas för hand som standard, utan starttid');
  await B.fill('#hfDay', futISO); await B.dispatchEvent('#hfDay', 'change'); await B.fill('#hfEnd', '23:58');
  check((await B.inputValue('#hfName')) === `Jakt ${futD.getDate()} ${MONS[futD.getMonth()]} ${futD.getFullYear()}`, `namnet följer det valda datumet: ${await B.inputValue('#hfName')}`);
  await B.click('#hfOk'); await W(B, 700);
  const h3 = Object.keys(data.groups[gid].hunts).find(k => data.groups[gid].hunts[k].day === futISO), H3 = () => data.groups[gid].hunts[h3];
  check(h3 && H3().manual && H3().expires === new Date(futD.getFullYear(), futD.getMonth(), futD.getDate(), 23, 58, 59).getTime() && H3().starts === H3().expires - 1000 && data.huntCodes[H3().code].hid === h3, 'jakten planeras för ett datum långt fram, med jaktkod');
  check(await A.evaluate(([g, h]) => firebase.database().ref('groups/' + g + '/huntPos/' + h + '/alice').set({lat:1, lng:1, t:Date.now(), name:'A'}).then(() => 'ok', () => 'denied'), [gid, h3]) === 'denied', 'den planerade jakten tar inte emot positioner');
  await A.click('#tab-jakt'); await W(A, 300);
  check((await A.innerText('#paneJakt')).includes('Du har en inbjudan att svara på') && await A.locator(`#paneJakt .cal-row.me-invite [data-j="cal-go"][data-h="${h3}"]`).count() >= 1, 'Alice ser inbjudan till den planerade jakten i Jakt-fliken');
  await A.click('[data-j="cal"]'); await W(A, 300);
  check(await A.isVisible('#calBox') && await A.locator('.cal-day.today').count() === 1 && await A.locator('.cal-grid .cal-wk').count() >= 5, 'kalendern öppnas med dagens datum markerat och veckonummer');
  for(let i = 0; i < 3 && !(await A.locator(`.cal-day[data-d="${futISO}"]`).count()); i++){ await A.click('[data-c="next"]'); await W(A, 100); }
  check(await A.locator(`.cal-day[data-d="${futISO}"] .cdot.invite`).count() === 1, 'dagen för den planerade jakten har en markering för inbjudan');
  await A.click(`.cal-day[data-d="${futISO}"]`); await W(A, 200);
  { const ct = await A.innerText('#calBox'); check(ct.includes(H3().name) && ct.includes('Startas av jaktledaren') && ct.toUpperCase().includes('INBJUDAN') && await A.locator('#calBox [data-c="plan"]').count() === 1, `dagen visar jakten, att den startas för hand och att Alice är inbjuden: ${ct.split('\n').slice(-8).join(' | ')}`); }
  await A.click(`#calBox [data-c="rsvp-no"][data-h="${h3}"]`); await W(A, 600);
  const rs3 = () => ((data.groups[gid].huntRsvp || {})[h3] || {}).alice;
  check(rs3() && rs3().no === true && (await A.innerText('#calBox')).toUpperCase().includes('DU HAR AVBÖJT') && await A.locator(`.cal-day[data-d="${futISO}"] .cdot.no`).count() === 1, 'Alice avböjer i kalendern: svaret sparas och syns');
  await W(B, 300);
  check((await B.innerText(`#hc-${gid}-${h3}`)).includes('Avböjt: Alice Test'), 'jaktledaren ser vem som har avböjt');
  await A.click(`#calBox [data-c="rsvp"][data-h="${h3}"]`); await W(A, 600);
  check(rs3() && !rs3().no && (await A.innerText('#calBox')).toUpperCase().includes('DU DELTAR') && !(await A.isChecked('#shareToggle')), 'Alice ångrar sig och deltar, men inget delas innan jakten startar');
  await A.click(`#calBox [data-c="go"][data-h="${h3}"]`); await W(A, 500);
  check(!(await A.isVisible('#calBox')) && await A.isVisible(`#hc-${gid}-${h3}`), 'Visa jakten stänger kalendern och visar jaktkortet');
  // automatisk start
  await B.click(`[data-j="hunt-edit"][data-h="${h3}"]`); await W(B, 300);
  check(await B.isChecked('input[name=hfMode][value=manual]') && !(await B.isDisabled('#hfDay')), 'en planerad jakt går att ändra, även datum och start');
  await B.check('input[name=hfMode][value=auto]'); check(!(await B.isDisabled('#hfStart')), 'tiden går att välja när jakten ska starta automatiskt');
  await B.fill('#hfStart', '08:30'); await B.click('#hfOk'); await W(B, 700);
  check(!H3().manual && H3().starts === new Date(futD.getFullYear(), futD.getMonth(), futD.getDate(), 8, 30).getTime() && (await B.innerText(`#hc-${gid}-${h3}`)).includes('startar automatiskt') && (await B.innerText(`#hc-${gid}-${h3}`)).toUpperCase().includes('KOMMANDE'), 'jakten startar automatiskt kl. 08.30 den dagen');
  await A.click(`[data-j="rsvp-no"][data-h="${h3}"]`); await W(A, 500);
  // start för hand en annan dag: jakten flyttas till i dag
  const exp0 = H3().expires;
  await B.click(`[data-j="hunt-start"][data-h="${h3}"]`); await W(B, 100);
  check((await B.innerText(`[data-j="hunt-start"][data-h="${h3}"]`)) === 'Starta i dag?' && H3().starts > Date.now(), 'en jakt planerad till en annan dag startas först efter en bekräftelse');
  await B.click(`[data-j="hunt-start"][data-h="${h3}"]`); await W(B, 700);
  { const n = new Date(), want = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 23, 58, 59).getTime();
    check(H3().day === `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}` && H3().expires === want && H3().starts <= Date.now() && data.huntCodes[H3().code].expires === want && exp0 !== want, 'jakten startar i dag, med samma sluttid på dagen, och jaktkoden följer med'); }
  await B.click(`[data-j="hunt-end"][data-h="${h3}"]`); await B.click(`[data-j="hunt-end"][data-h="${h3}"]`); await W(B, 900);
  check(!data.groups[gid].hunts[h3] && !(data.groups[gid].huntRsvp || {})[h3], 'den extra jakten är avslutad');
  // ---- Avsluta jakten ----
  await B.click('[data-j="hunt-end"]'); await B.click('[data-j="hunt-end"]'); await W(B, 900);
  check(!data.groups[gid].hunts && !data.huntCodes && !(data.groups[gid].guests || {})['anon-carl'], 'jakten, koden och gästposten är borta');
  check(!data.groups[gid].huntPos && !data.groups[gid].huntTrail && !data.groups[gid].huntObs && !data.groups[gid].huntPlan && !data.groups[gid].huntRsvp && !data.groups[gid].huntMsg && !data.groups[gid].huntCheck && !(data.groups[gid].msgKeys || {})['anon-carl'], 'jaktens positioner, spår, observationer, plan, svar, meddelanden och gästens nyckel raderades när jakten avslutades');
  const arch = Object.values(data.groups[gid].obsArchive || {});
  check(arch.length === 2 && arch.every(o => !o.by && !o.name && !o.note && o.hid === hid && o.kind === 'obs') && arch.map(o => o.sp + o.n).sort().join() === 'Rådjur2,Vildsvin1', 'observationerna arkiverades utan namn när jakten avslutades');
  // ---- Värmekarta ----
  await A.click('#btnLayers'); await W(A, 200);
  check(await A.isVisible('#heatBox') && !(await A.isChecked('#popHeat')), 'admin ser värmekartan i lagermenyn, avstängd från början');
  await A.check('#popHeat'); await W(A, 600);
  const heatPx = () => A.evaluate(() => { const c = document.querySelector('canvas.heat-canvas'); if(!c || c.hidden || !c.width) return 0; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for(let i = 3; i < d.length; i += 4) if(d[i]) n++; return n; });
  check((await A.innerText('#heatNote')).includes('3 djur i 2 observationer') && await heatPx() > 100, `värmekartan visar arkivet: ${await A.innerText('#heatNote')}`);
  await A.evaluate(() => __fk.map.setZoom(15, {animate:false})); await W(A, 400); await A.screenshot({path:shot('a_heat.png')});
  await A.selectOption('#heatSp', 'Rådjur'); await W(A, 300);
  check((await A.innerText('#heatNote')).includes('2 djur i 1 observationer') && await A.evaluate(() => __fk.heatPoints().length) === 1, 'filter på art');
  await A.selectOption('#heatPeriod', 'last'); await W(A, 300);
  check(await A.evaluate(() => __fk.heatPoints().length) === 0 && await heatPx() === 0, 'filter på förra jaktåret visar inga');
  await A.selectOption('#heatPeriod', 'season'); await A.selectOption('#heatSp', ''); await A.selectOption('#heatArea', aid); await W(A, 300);
  { // Förväntat antal räknas med barycentriska koordinater (oberoende av appens metod). Punkter på kanten räknas inte.
    const tri = data.groups[gid].areas[aid].border.split(';').map(q => q.split(',').map(Number));
    const inside = o => { const [[y1, x1], [y2, x2], [y3, x3]] = tri, d = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
      const a = ((y2 - y3) * (o.lng - x3) + (x3 - x2) * (o.lat - y3)) / d, b = ((y3 - y1) * (o.lng - x3) + (x1 - x3) * (o.lat - y3)) / d, c = 1 - a - b;
      return a > 1e-9 && b > 1e-9 && c > 1e-9; };
    const want = Object.values(data.groups[gid].obsArchive).filter(inside).length, got = await A.evaluate(() => __fk.heatPoints().length);
    check(got === want && want === 1, `filter på jaktmark: ${got} av 2 observationer ligger inom gränsen (väntat ${want})`); }
  await A.selectOption('#heatArea', ''); await A.keyboard.press('Escape'); await W(A, 200);
  // Bob är jaktledare och ser också arkivet, en vanlig medlem skulle inte göra det (se regeltesterna)
  await B.click('#btnLayers'); await W(B, 200);
  check(await B.isVisible('#heatBox'), 'jaktledaren ser värmekartan');
  await B.keyboard.press('Escape');
  await W(A, 300);
  check(await A.locator('.obs-icon').count() === 0 && !(await A.isVisible('#btnObs')), 'efter jakten syns inga observationer och ingen kikare');
  await W(B, 300);
  check(await A.locator('.pos-icon').count() === 0 && await B.locator('.pos-icon').count() === 0 && await A.locator('#shareToggle').isDisabled(), 'efter jakten syns inga positioner och delningen är avstängd');
  sc = await st(C);
  check(sc.pins.filter(p => p.areaId === aid).length === 0 && !(data.userGroups || {})['anon-carl'], 'gästen förlorade åtkomsten och nålarna försvann hos honom');
  const g3 = await C.evaluate(([g, a, h]) => Promise.all(['meta', 'pins/' + a, 'huntPos/' + h].map(p => firebase.database().ref('groups/' + g + '/' + p).get().then(() => 'ok', () => 'denied'))), [gid, aid, hid]);
  check(g3.every(x => x === 'denied'), 'efter avslutad jakt nekas gästen all läsning');
  // ---- Alice tar bort Bob ----
  await A.click('#tab-jakt'); await A.click('[data-j="member-del"][data-u="bob"]'); await A.click('[data-j="member-del"][data-u="bob"]'); await W(A, 900);
  sb = await st(B);
  check(!data.groups[gid].members.bob && sb.pins.length === 8 && sb.areas.length === 2, 'borttagen medlem: Bob har bara sina egna 8 nålar kvar');
  // Lokalt sparat innehåller inget delat
  const ls = await A.evaluate(() => JSON.parse(localStorage.getItem('faltkartan.v1')));
  check(ls.areas.every(a => !a.gid) && ls.pins.length === 0, 'delade nålar lagras inte i webbläsarens privata lagring');
  for(const [n, p] of [['Alice', A], ['Bob', B], ['Carl', C]]) check(!p.errs.length, `${n}: inga JS-fel ${p.errs.slice(0, 2)}`);

  // ---- Regler direkt ----
  const t0 = Date.now();
  const base = {owner:'o', creators:{c1:true}, groups:{g:{meta:{name:'L', owner:'o'}, members:{o:{role:'admin', name:'O'}, a2:{role:'admin', name:'A2'}, e:{role:'editor', name:'E'}, v:{role:'viewer', name:'V'}},
    areas:{ar:{name:'A'}}, pins:{ar:{p:{lat:1, lng:2, typeId:'t'}}}, hunts:{h:{name:'J', expires:t0 + 1000, code:'HUNTCODE', areas:{ar:true}}, h2:{name:'J2', starts:t0 + 500, expires:t0 + 1000, code:'HUNTCOD2'}}, guests:{gu:{hid:'h', code:'HUNTCODE', name:'G', expires:t0 + 1000}},
      huntPos:{h:{e:{lat:1, lng:1, t:1}}, h2:{}}, huntTrail:{h:{e:{k1:{lat:1, lng:1, t:1}}}}, huntObs:{h:{o1:{sp:'Rådjur', n:1, lat:1, lng:1, t:1, by:'e'}}}, obsArchive:{a1:{sp:'Älg', n:2, lat:1, lng:1, t:1, hid:'h'}}, huntMsg:{h:{m0:{from:'e', name:'E', t:1, iv:'x', ct:'y', spk:'z', keys:{a:'b'}, all:true}}}, huntPlan:{h:{stands:{p:{uid:'e', who:'E'}, p2:{uid:'gu', who:'G'}}}}}},
    invites:{INVITECODE1:{gid:'g', role:'editor', expires:t0 + 1000}, OLDINVITE01:{gid:'g', role:'editor', expires:t0 - 1}}, huntCodes:{HUNTCODE:{gid:'g', hid:'h', expires:t0 + 1000}}};
  const D = (uid, now) => { const d = targaryen.database(rules, base, now || t0).as(uid ? tok(uid) : null);
    return {read: p => d.read(p, now || t0), write: (p, v) => d.write(p, v, undefined, now || t0)}; };
  const m = (role, extra) => Object.assign({role, name:'N'}, extra || {});
  check(!D(null).read('/groups/g/pins').allowed && !D('x').read('/groups/g/pins').allowed && !D('x').read('/groups/g/meta').allowed, 'regel: utloggad och utomstående kan inte läsa laget');
  check(!D('x').read('/invites').allowed && !D('x').read('/groups').allowed && !D('x').read('/huntCodes').allowed, 'regel: ingen kan lista inbjudningar, jaktkoder eller alla lag');
  check(D('x').write('/groups/g/members/x', m('editor', {code:'INVITECODE1'})).allowed, 'regel: gå med via giltig inbjudan tillåts');
  check(!D('x').write('/groups/g/members/x', m('admin', {code:'INVITECODE1'})).allowed, 'regel: inbjudan ger inte högre roll än den anger');
  check(!D('x').write('/groups/g/members/x', m('editor', {code:'OLDINVITE01'})).allowed && !D('x').write('/groups/g/members/x', m('editor')).allowed, 'regel: utgången eller saknad inbjudan nekas');
  check(!D('e').write('/groups/g/members/e/role', 'admin').allowed && !D('e').write('/groups/g/members/v/role', 'editor').allowed, 'regel: medlem kan inte ändra roller');
  check(D('a2').write('/groups/g/members/v/role', 'leader').allowed && !D('a2').write('/groups/g/members/o/role', 'viewer').allowed && !D('a2').write('/groups/g/members/o', null).allowed, 'regel: admin ändrar roller men kan inte peta ägaren');
  check(!D('a2').write('/groups/g', null).allowed && D('o').write('/groups/g', null).allowed, 'regel: bara ägaren kan ta bort laget');
  check(D('e').write('/groups/g/pins/ar/n', {lat:1, lng:2, typeId:'t'}).allowed && !D('v').write('/groups/g/pins/ar/n', {lat:1, lng:2, typeId:'t'}).allowed && !D('e').write('/groups/g/pins/ar/n', {lat:'x', lng:2, typeId:'t'}).allowed, 'regel: medlem skriver nål, läsare nekas, ogiltig nål nekas');
  check(!D('e').write('/groups/g/hunts/h2', {name:'J', expires:1, code:'ABCDEFGH'}).allowed && !D('e').write('/huntCodes/NEWCODE1', {gid:'g', hid:'h2', expires:1}).allowed, 'regel: vanlig medlem kan inte skapa jakt');
  check(D('gu').read('/groups/g/pins/ar').allowed && D('gu').read('/groups/g/hunts/h').allowed && !D('gu', t0 + 2000).read('/groups/g/pins/ar').allowed && !D('gu', t0 + 2000).read('/groups/g/meta').allowed, 'regel: gäståtkomst upphör av sig själv när tiden gått ut');
  check(D('y').write('/groups/g/guests/y', {hid:'h', code:'HUNTCODE', name:'Y', expires:t0 + 1000}).allowed && !D('y').write('/groups/g/guests/y', {hid:'h', code:'HUNTCODE', name:'Y', expires:t0 + 9e9}).allowed && !D('y', t0 + 2000).write('/groups/g/guests/y', {hid:'h', code:'HUNTCODE', name:'Y', expires:t0 + 1000}).allowed, 'regel: gäst kan inte förlänga sin tid eller gå med efter sluttid');
  const P = {lat:1, lng:1, t:1};
  check(!D('e').write('/groups/g/huntPos/h/v', P).allowed && D('e').write('/groups/g/huntPos/h/e', P).allowed && !D('x').write('/groups/g/huntPos/h/x', P).allowed && D('gu').write('/groups/g/huntPos/h/gu', P).allowed, 'regel: man kan bara skriva sin egen position, och bara med åtkomst');
  check(!D('e').write('/groups/g/positions/e', P).allowed && !D('e').read('/groups/g/positions').allowed && !D('e').write('/groups/g/huntPos/nojakt/e', P).allowed, 'regel: positioner utanför en jakt nekas');
  check(D('v').read('/groups/g/huntPos/h').allowed && D('gu').read('/groups/g/huntPos/h').allowed && !D('gu').read('/groups/g/huntPos/h2').allowed && !D('x').read('/groups/g/huntPos/h').allowed, 'regel: lagets medlemmar och jaktens gäster ser positionerna, inte gäster i andra jakter eller utomstående');
  check(!D('v').read('/groups/g/huntPos/h2').allowed && !D('e').write('/groups/g/huntPos/h2/e', P).allowed && D('v', t0 + 600).read('/groups/g/huntPos/h2').allowed && D('e', t0 + 600).write('/groups/g/huntPos/h2/e', P).allowed, 'regel: positioner går inte att se eller dela innan jakten startat');
  check(!D('v', t0 + 2000).read('/groups/g/huntPos/h').allowed && !D('e', t0 + 2000).write('/groups/g/huntPos/h/e', P).allowed, 'regel: positioner går inte att se eller dela efter att jakten slutat');
  check(D('a2').write('/groups/g/huntPos/h', null).allowed && !D('e').write('/groups/g/huntPos/h', null).allowed, 'regel: bara jaktledare och admin kan radera en jakts positioner');
  const T = {lat:1, lng:1, t:t0};
  check(D('e').write('/groups/g/huntTrail/h/e/k2', T).allowed && D('gu').write('/groups/g/huntTrail/h/gu/k2', T).allowed && !D('e').write('/groups/g/huntTrail/h/v/k2', T).allowed && !D('x').write('/groups/g/huntTrail/h/x/k2', T).allowed, 'regel: spår skrivs bara av personen själv, med åtkomst till jakten');
  check(D('v').read('/groups/g/huntTrail/h').allowed && D('gu').read('/groups/g/huntTrail/h').allowed && !D('x').read('/groups/g/huntTrail/h').allowed && !D('v', t0 + 2000).read('/groups/g/huntTrail/h').allowed && !D('e', t0 + 2000).write('/groups/g/huntTrail/h/e/k2', T).allowed && !D('e').write('/groups/g/huntTrail/h2/e/k2', T).allowed, 'regel: spår syns och skrivs bara medan jakten pågår');
  const O = u => ({sp:'Älg', n:1, lat:1, lng:1, t:t0, by:u});
  check(D('e').write('/groups/g/huntObs/h/n1', O('e')).allowed && D('v').write('/groups/g/huntObs/h/n1', O('v')).allowed && D('gu').write('/groups/g/huntObs/h/n1', O('gu')).allowed && !D('x').write('/groups/g/huntObs/h/n1', O('x')).allowed, 'regel: alla jaktens deltagare kan lägga in observationer, inte utomstående');
  check(!D('e').write('/groups/g/huntObs/h/n1', O('v')).allowed && !D('v').write('/groups/g/huntObs/h/o1', O('v')).allowed && !D('v').write('/groups/g/huntObs/h/o1', null).allowed, 'regel: man kan inte skriva i någon annans namn eller ändra och ta bort andras observationer');
  check(D('e').write('/groups/g/huntObs/h/o1', Object.assign(O('e'), {n:3})).allowed && D('e').write('/groups/g/huntObs/h/o1', null).allowed && D('a2').write('/groups/g/huntObs/h/o1', null).allowed && D('a2').write('/groups/g/huntObs/h', null).allowed && !D('e').write('/groups/g/huntObs/h', null).allowed, 'regel: egna observationer ändras och tas bort, jaktledare och admin tar bort alla');
  check(!D('e').write('/groups/g/huntObs/h2/n1', O('e')).allowed && !D('e', t0 + 2000).write('/groups/g/huntObs/h/n1', O('e')).allowed && !D('v', t0 + 2000).read('/groups/g/huntObs/h').allowed && D('v').read('/groups/g/huntObs/h').allowed && D('gu').read('/groups/g/huntObs/h').allowed && !D('gu').read('/groups/g/huntObs/h2').allowed && !D('x').read('/groups/g/huntObs/h').allowed, 'regel: observationer finns bara medan jakten pågår och bara för dess deltagare');
  check(!D('e').write('/groups/g/huntObs/h/n1', Object.assign(O('e'), {n:0})).allowed && !D('e').write('/groups/g/huntObs/h/n1', Object.assign(O('e'), {sp:'x'.repeat(41)})).allowed && !D('e').write('/groups/g/huntObs/h/n1', Object.assign(O('e'), {t:t0 + 3600000})).allowed && !D('e').write('/groups/g/huntObs/h/n1', {sp:'Älg', n:1, by:'e'}).allowed, 'regel: ogiltiga observationer nekas');
  const AR = {sp:'Älg', n:1, lat:1, lng:1, t:t0, hid:'h'};
  check(D('a2').read('/groups/g/obsArchive').allowed && !D('e').read('/groups/g/obsArchive').allowed && !D('v').read('/groups/g/obsArchive').allowed && !D('gu').read('/groups/g/obsArchive').allowed && !D('x').read('/groups/g/obsArchive').allowed, 'regel: bara jaktledare och admin läser observationsarkivet');
  check(D('a2').write('/groups/g/obsArchive/a2x', AR).allowed && !D('e').write('/groups/g/obsArchive/a2x', AR).allowed && D('a2').write('/groups/g/obsArchive/a1', null).allowed && !D('e').write('/groups/g/obsArchive/a1', null).allowed, 'regel: bara jaktledare och admin skriver och tar bort i arkivet');
  check(!D('a2').write('/groups/g/obsArchive/a2x', Object.assign({by:'e'}, AR)).allowed && !D('a2').write('/groups/g/obsArchive/a2x', Object.assign({name:'Eva'}, AR)).allowed && !D('a2').write('/groups/g/obsArchive/a2x', Object.assign({note:'x'}, AR)).allowed, 'regel: arkivet tar inte emot namn eller andra uppgifter om personen');
  check(D('a2', t0 + 2000).read('/groups/g/huntObs/h').allowed && !D('e', t0 + 2000).read('/groups/g/huntObs/h').allowed, 'regel: jaktledare och admin kan läsa en avslutad jakts observationer för att arkivera dem');
  check(!D('e').write('/groups/g/huntTrail/h/e/k3', {lat:1, lng:1, t:t0 + 3600000}).allowed && D('a2').write('/groups/g/huntTrail/h', null).allowed && !D('e').write('/groups/g/huntTrail/h', null).allowed, 'regel: spårpunkter kan inte framtidsdateras, bara jaktledare raderar jaktens spår');
  const PL = {stands:{p:{who:'O', uid:'o', no:3}}, drives:{d1:{name:'Såt 1', ring:'1,1;1,2;2,2'}}, routes:{r1:{kind:'hund', who:'E', pts:'1,1;1,2'}}};
  check(D('a2').write('/groups/g/huntPlan/h2', PL).allowed && D('a2').write('/groups/g/huntPlan/h/stands/p/no', 5).allowed, 'regel: jaktledare och admin planerar, även innan jakten startat');
  check(!D('e').write('/groups/g/huntPlan/h2', PL).allowed && !D('v').write('/groups/g/huntPlan/h/stands/p', {who:'V'}).allowed && !D('gu').write('/groups/g/huntPlan/h/stands/p', {who:'G'}).allowed && !D('x').write('/groups/g/huntPlan/h2', PL).allowed, 'regel: medlemmar, gäster och utomstående kan inte ändra planen');
  check(D('v').read('/groups/g/huntPlan').allowed && D('gu').read('/groups/g/huntPlan/h').allowed && !D('gu').read('/groups/g/huntPlan/h2').allowed && !D('gu').read('/groups/g/huntPlan').allowed && !D('x').read('/groups/g/huntPlan/h').allowed && !D('gu', t0 + 2000).read('/groups/g/huntPlan/h').allowed, 'regel: lagets medlemmar och jaktens gäster läser planen, ingen annan');
  check(!D('a2').write('/groups/g/huntPlan/nojakt', PL).allowed && D('a2').write('/groups/g/huntPlan/nojakt', null).allowed, 'regel: plan kan bara finnas för en jakt som finns');
  const PL2 = {drives:{d1:{name:'Såt 1', ring:'1,1;1,2;2,2', ord:0, done:t0, pass:{p:{who:'E', uid:'e', ok:true}}}}, routes:{r1:{kind:'hund', pts:'1,1;1,2', drive:'d1'}}, meets:{m1:{name:'Boden', lat:1, lng:2}}, cur:{did:'d1', on:false, t:t0}, call:{mid:'m1', name:'Boden', lat:1, lng:2, t:t0}, stands:{p:{who:'E', uid:'e', ok:true}}};
  check(D('a2').write('/groups/g/huntPlan/h2', PL2).allowed, 'regel: såtar med ordning och pass, samlingsplatser, pågående såt och återsamling');
  const bad2 = [{cur:{did:'d1', on:'ja', t:t0}}, {cur:{did:'d 1', on:true, t:t0}}, {call:{name:'B', lat:200, lng:1, t:t0}}, {meets:{m1:{name:'B', lat:1}}}, {drives:{d1:{name:'S', ring:'1,1', pass:{p:{who:'E', x:1}}}}}, {routes:{r:{kind:'hund', pts:'1,1;1,2', drive:'<b>'}}}, {cur:{did:'d1', on:true, t:t0 + 3600000}}];
  check(bad2.every(b => !D('a2').write('/groups/g/huntPlan/h2', b).allowed), 'regel: såtar, samlingsplatser och återsamling tar bara emot rätt fält och typer');
  check(D('a2').write('/groups/g/gear/e', {name:'E', gun:'both', easy:true}).allowed && !D('a2').write('/groups/g/gear/e', {name:'E', gun:'pil'}).allowed && !D('a2').write('/groups/g/gear/e', {name:'E', vikt:80}).allowed, 'regel: utrustning med hagel, kula eller båda och lättillgängligt pass');
  check(!D('e').write('/groups/g/gear/e', {name:'E', gun:'kula'}).allowed && !D('e').read('/groups/g/gear').allowed && !D('gu').read('/groups/g/gear').allowed && D('a2').read('/groups/g/gear').allowed, 'regel: bara jaktledare och admin läser och skriver utrustningen');
  const bad = [{stands:{p:{who:'O', note:'x'}}}, {stands:{p:{no:70000}}}, {stands:{p:{no:1.5}}}, {stands:{p:{who:'x'.repeat(61)}}}, {routes:{r:{kind:'bil', pts:'1,1;1,2'}}}, {routes:{r:{kind:'hund'}}}, {drives:{d:{ring:'1,1;1,2;2,2'}}}, {drives:{d:{name:'S', ring:'1,1;1,2;2,2', by:'x'}}}, {foo:1}];
  check(bad.every(b => !D('a2').write('/groups/g/huntPlan/h2', b).allowed), 'regel: planen tar bara emot kända fält med rätt typ');
  check(D('e').write('/groups/g/huntRsvp/h2/e', {name:'E', t:t0}).allowed && D('gu').read('/groups/g/huntRsvp').allowed === false && D('v').read('/groups/g/huntRsvp').allowed, 'regel: medlemmar svarar Jag deltar, laget ser svaren, gäster ser dem inte');
  check(!D('e').write('/groups/g/huntRsvp/h2/v', {name:'V', t:t0}).allowed && !D('x').write('/groups/g/huntRsvp/h2/x', {name:'X', t:t0}).allowed && !D('e').write('/groups/g/huntRsvp/nojakt/e', {name:'E', t:t0}).allowed && !D('e').write('/groups/g/huntRsvp/h2/e', {name:'E', t:t0, extra:1}).allowed, 'regel: man svarar bara för sig själv, för en jakt som finns, utan extra fält');
  check(D('e').write('/groups/g/huntRsvp/h2/e', {name:'E', t:t0, no:true}).allowed && !D('e').write('/groups/g/huntRsvp/h2/e', {name:'E', t:t0, no:'ja'}).allowed, 'regel: man kan avböja en jakt (no:true)');
  check(D('a2').write('/groups/g/huntRsvp/h2', null).allowed && !D('e').write('/groups/g/huntRsvp/h2', null).allowed, 'regel: bara jaktledare och admin raderar alla svar för en jakt');
  check(D('a2').write('/huntCodes/HUNTCODE', {gid:'g', hid:'h', expires:t0 + 5000}).allowed && !D('a2').write('/huntCodes/HUNTCODE', {gid:'g', hid:'h2', expires:t0 + 5000}).allowed && !D('a2').write('/huntCodes/HUNTCODE', {gid:'n2', hid:'h', expires:t0 + 5000}).allowed && !D('e').write('/huntCodes/HUNTCODE', {gid:'g', hid:'h', expires:t0 + 5000}).allowed, 'regel: jaktledaren kan ändra jaktkodens sluttid, men inte flytta den till en annan jakt, och en vanlig medlem kan inte ändra den');
  const K = (extra) => Object.assign({k:'A'.repeat(88), name:'N', t:t0}, extra || {});
  check(D('e').write('/groups/g/msgKeys/e/d1', K()).allowed && !D('e').write('/groups/g/msgKeys/v/d1', K()).allowed && !D('x').write('/groups/g/msgKeys/x/d1', K()).allowed && !D('e').write('/groups/g/msgKeys/e/d1', K({extra:1})).allowed && !D('e').write('/groups/g/msgKeys/e/d1', K({k:'kort'})).allowed, 'regel: man publicerar bara sin egen nyckel, i rätt form');
  check(D('gu').write('/groups/g/msgKeys/gu/d1', K({hid:'h'})).allowed && !D('gu').write('/groups/g/msgKeys/gu/d1', K({hid:'h2'})).allowed && !D('gu').write('/groups/g/msgKeys/gu/d1', K()).allowed, 'regel: en gäst märker sin nyckel med sin egen jakt');
  check(D('gu').read('/groups/g/msgKeys').allowed && D('v').read('/groups/g/msgKeys').allowed && !D('x').read('/groups/g/msgKeys').allowed && D('a2').write('/groups/g/msgKeys/gu', null).allowed && !D('e').write('/groups/g/msgKeys/gu', null).allowed, 'regel: laget och gästerna läser nycklarna, jaktledaren kan ta bort en gästs nyckel');
  const MS = (u, extra) => Object.assign({from:u, name:'N', t:t0, iv:'x', ct:'y', spk:'z', keys:{a:'b'}, all:true}, extra || {});
  check(D('e').write('/groups/g/huntMsg/h/m1', MS('e')).allowed && D('gu').write('/groups/g/huntMsg/h/m1', MS('gu')).allowed && !D('e').write('/groups/g/huntMsg/h/m1', MS('v')).allowed && !D('x').write('/groups/g/huntMsg/h/m1', MS('x')).allowed, 'regel: jaktens deltagare skriver meddelanden, bara i eget namn');
  check(!D('e').write('/groups/g/huntMsg/h2/m1', MS('e')).allowed && !D('e', t0 + 2000).write('/groups/g/huntMsg/h/m1', MS('e')).allowed && !D('v', t0 + 2000).read('/groups/g/huntMsg/h').allowed && D('v').read('/groups/g/huntMsg/h').allowed && D('gu').read('/groups/g/huntMsg/h').allowed && !D('gu').read('/groups/g/huntMsg/h2').allowed && !D('x').read('/groups/g/huntMsg/h').allowed, 'regel: meddelanden finns bara medan jakten pågår, och bara för jaktens deltagare');
  check(!D('e').write('/groups/g/huntMsg/h/m1', MS('e', {text:'klartext'})).allowed && !D('e').write('/groups/g/huntMsg/h/m1', MS('e', {all:null})).allowed && D('e').write('/groups/g/huntMsg/h/m1', MS('e', {all:null, to:{v:true}})).allowed, 'regel: inga extra fält (ingen klartext), och mottagare måste anges');
  check(!D('e').write('/groups/g/huntMsg/h/m0', MS('e')).allowed && D('e').write('/groups/g/huntMsg/h/m0', null).allowed && !D('v').write('/groups/g/huntMsg/h/m0', null).allowed && D('a2').write('/groups/g/huntMsg/h/m0', null).allowed && D('a2').write('/groups/g/huntMsg/h', null).allowed, 'regel: ett meddelande kan inte ändras, avsändaren och jaktledaren kan ta bort det');
  { const bad = 'x" onmouseover="alert(1)';
    check(!D('e').write('/groups/g/pins/ar/' + bad, {lat:1, lng:2, typeId:'t'}).allowed && !D('e').write('/groups/g/areas/' + bad, {name:'X'}).allowed && !D('e').write('/groups/g/types/' + bad, {name:'X', color:'#000'}).allowed && !D('gu').write('/groups/g/huntObs/h/' + bad, O('gu')).allowed && !D('e').write('/groups/g/huntMsg/h/' + bad, MS('e')).allowed && !D('a2').write('/groups/g/huntPlan/h2/drives/' + bad, {name:'S', ring:'1,1;1,2;2,2'}).allowed && !D('e').write('/groups/g/huntTrail/h/e/' + bad, T).allowed && !D('e').write('/groups/g/msgKeys/e/' + bad, K()).allowed, 'regel: nycklar med andra tecken än bokstäver, siffror, - och _ nekas');
    check(D('e').write('/groups/g/pins/ar/-Nab_c1', {lat:1, lng:2, typeId:'t'}).allowed && D('gu').write('/groups/g/huntObs/h/-Nab_c1', O('gu')).allowed && !D('e').write('/groups/g/pins/ar/' + 'a'.repeat(65), {lat:1, lng:2, typeId:'t'}).allowed, 'regel: vanliga nycklar (även Firebase push-nycklar) godtas, för långa nekas'); }
  const CK = (pid, extra) => Object.assign({pid, in:true, t:t0, name:'N'}, extra || {});
  check(D('e').write('/groups/g/huntCheck/h/e', CK('p')).allowed && D('gu').write('/groups/g/huntCheck/h/gu', CK('p2')).allowed && !D('v').write('/groups/g/huntCheck/h/v', CK('p')).allowed && !D('e').write('/groups/g/huntCheck/h/e', CK('p2')).allowed, 'regel: man checkar bara in på det pass man är tilldelad');
  check(!D('e').write('/groups/g/huntCheck/h/v', CK('p')).allowed && !D('x').write('/groups/g/huntCheck/h/x', CK('p')).allowed && !D('e').write('/groups/g/huntCheck/h/e', CK('p', {extra:1})).allowed && !D('e', t0 + 2000).write('/groups/g/huntCheck/h/e', CK('p')).allowed, 'regel: bara sig själv, inga extra fält, och bara medan jakten pågår');
  check(D('v').read('/groups/g/huntCheck/h').allowed && D('gu').read('/groups/g/huntCheck/h').allowed && !D('gu').read('/groups/g/huntCheck/h2').allowed && !D('x').read('/groups/g/huntCheck/h').allowed && !D('v', t0 + 2000).read('/groups/g/huntCheck/h').allowed && D('a2').write('/groups/g/huntCheck/h', null).allowed && !D('e').write('/groups/g/huntCheck/h', null).allowed, 'regel: jaktens deltagare ser incheckningarna medan jakten pågår, jaktledaren raderar dem');
  const SO = extra => Object.assign({t:t0, name:'N', lat:1, lng:2}, extra || {});
  check(D('e').write('/groups/g/sos/e', SO()).allowed && D('gu').write('/groups/g/sos/gu', SO()).allowed && !D('e').write('/groups/g/sos/v', SO()).allowed && !D('x').write('/groups/g/sos/x', SO()).allowed && !D('e').write('/groups/g/sos/e', SO({extra:1})).allowed && !D('e').write('/groups/g/sos/e', SO({lat:200})).allowed, 'regel: nödlarm bara för sig själv, i rätt form');
  check(D('v').read('/groups/g/sos').allowed && D('gu').read('/groups/g/sos').allowed && !D('x').read('/groups/g/sos').allowed && !D('gu', t0 + 2000).read('/groups/g/sos').allowed && D('a2').write('/groups/g/sos/e', null).allowed && !D('e').write('/groups/g/sos/v', null).allowed, 'regel: hela laget och giltiga gäster läser larmen, jaktledaren tar bort gamla');
  check(D('e').write('/groups/g/huntObs/h/k1', Object.assign(O('e'), {kind:'kill', sex:'m', age:'juv', shooter:'E'})).allowed && !D('e').write('/groups/g/huntObs/h/k1', Object.assign(O('e'), {kind:'skott'})).allowed && !D('e').write('/groups/g/huntObs/h/k1', Object.assign(O('e'), {age:'gammal'})).allowed, 'regel: fällt vilt med giltigt kön, ålder och skytt');
  check(!D('x').write('/groups/n2/meta', {name:'N', owner:'x'}).allowed && !D('e').write('/groups/n2/meta', {name:'N', owner:'e'}).allowed && D('o').write('/groups/n2/meta', {name:'N', owner:'o'}).allowed && D('c1').write('/groups/n2/meta', {name:'N', owner:'c1'}).allowed, 'regel: bara ägaren och godkända kan skapa jaktlag');
  check(!D('x').write('/owner', 'x').allowed && !D('o').write('/owner', 'x').allowed && !D('x').write('/creators/x', true).allowed && D('o').write('/creators/x', true).allowed, 'regel: ägarskapet kan inte tas över, bara ägaren godkänner fler');
  { const e0 = targaryen.database(rules, {}, t0); check(e0.as(tok('first')).write('/owner', 'first', undefined, t0).allowed && !e0.as(tok('anon-z')).write('/owner', 'anon-z', undefined, t0).allowed && !e0.as(tok('first')).write('/owner', 'other', undefined, t0).allowed, 'regel: första Google-inloggade blir ägare, inte en gäst och inte åt någon annan'); }
  check(!D('x').write('/groups/new/meta', {name:'N', owner:'o'}).allowed && !D('x').write('/groups/g/meta', {name:'Kapad', owner:'x'}).allowed, 'regel: kan inte skapa lag åt någon annan eller ta över ett lag');

  // ---- Jakttider ----
  const V = await mkPage(browser, 'vera');
  const law = (id, lan, md) => V.evaluate(([i, l, d]) => __fk.viltLawful(__fk.VILT.find(v => v.id === i), l, d).map(r => (r.cls || '') + '|' + (r.sub || '')), [id, lan, md]);
  check(JSON.stringify(await law('radjur', 'Södermanland', '11-11')) === '["Alla djur|"]', 'rådjur 11 nov: alla djur');
  check(JSON.stringify(await law('radjur', 'Skåne', '06-01')) === '["Hornbärande|"]' && (await law('radjur', 'Skåne', '07-01')).length === 0, 'rådjur 1 juni: bara hornbärande; 1 juli: inget');
  check((await law('skogshare', 'Skåne', '02-20')).length === 0 && (await law('skogshare', 'Uppsala', '02-20')).length === 1 && (await law('falthare', 'Skåne', '02-29')).length === 1, 'skogshare slutar 15 feb i söder, fälthare 28/29 feb');
  check((await law('rodrav', 'Norrbotten', '04-10')).length === 1 && (await law('rodrav', 'Stockholm', '03-16')).length === 0 && (await law('rodrav', 'Dalarna', '04-10')).join() === '|Älvdalens kommun', 'rödräv: länsvisa slutdatum och Älvdalen');
  check((await law('vildsvin', 'Kalmar', '02-15')).join() === 'Årsunge|' && (await law('vildsvin', 'Kalmar', '04-01')).length === 2, 'vildsvin: februari bara årsunge');
  check((await law('orre', 'Gotland', '09-01')).length === 0 && (await law('orre', 'Skåne', '09-10')).join() === 'Tupp|' && (await law('tjader', 'Jämtland', '12-01')).join() === 'Tupp|' && (await law('tjader', 'Kalmar', '09-15')).join() === 'Höna och tupp|', 'orre och tjäder per län');
  check((await law('jarpe', 'Skåne', '09-01')).length === 0 && (await law('blasgas', 'Halland', '11-01')).length === 0 && (await law('raka', 'Halland', '08-01')).length === 1, 'arter som bara har jakttid i vissa län');
  check((await law('grasand', 'Uppsala', '12-15')).length === 1 && (await law('kricka', 'Uppsala', '12-15')).length === 0 && (await law('gragas', 'Norrbotten', '08-15')).join() === '|utom gränsälvsområdet', 'änder och gäss, gränsälvsområdet');
  check((await law('kraka', 'Stockholm', '06-15')).length === 0 && (await law('kraka', 'Jämtland', '04-20')).length === 1 && (await law('dovhjort', 'Örebro', '11-01')).join() === 'Hind och kalv|', 'kråka och dovhjort');
  await V.click('#tab-vilt'); await V.selectOption('#viltLan', 'Södermanland'); await V.fill('#viltDay', '2026-11-11'); await V.dispatchEvent('#viltDay', 'change'); await W(V, 200);
  const vt = (await V.innerText('#paneVilt')).toLowerCase();
  check(/rådjur/.test(vt.split('licens eller')[0]) && /älg/.test(vt.split('licens eller')[1].split('inte lovligt')[0]) && !/järpe/.test(vt), 'Vilt-fliken: rådjur lovligt, älg under licens, järpe saknas i Södermanland');
  check(await V.locator('#paneVilt .vname').first().getAttribute('href') === 'https://jagareforbundet.se/jakt/jakttider/jakttid-for-enskilt-djur/?animalId=565', 'artnamn länkar till Jägareförbundets tabell');
  check(viltTxt.includes('Älg') && !viltTxt.includes('Bläsgås') && !viltTxt.includes('Järpe'), 'Ny jakt: bara vilt som är lovligt den dagen kan väljas');
  await V.screenshot({path:shot('v_vilt.png')}); await A.click('#tab-jakt'); await W(A, 200); await A.screenshot({path:shot('a_jakt.png')});
  // mobilvy av Jakt
  const M = await mkPage(browser, 'mia', '', {viewport:{width:390, height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true});
  await M.click('#tab-jakt'); await W(M, 300); await M.click('[data-j="login-google"]'); await W(M, 300);
  check(await M.locator('[data-j="group-new"]').count() === 0 && (await M.innerText('#paneJakt')).includes('Bara ägaren') && data.owner === 'alice', 'annan inloggad: ingen knapp för att skapa jaktlag, ägaren oförändrad');
  const mk = await M.evaluate(() => { const up = {}; up['groups/zz/meta'] = {name:'Z', owner:'mia', created:1}; up['groups/zz/members/mia'] = {role:'admin', name:'M'}; up['userGroups/mia/zz'] = 'member'; return firebase.database().ref().update(up).then(() => 'ok', () => 'denied'); });
  check(mk === 'denied' && !data.groups.zz, 'annan inloggad nekas skapa jaktlag direkt mot databasen');
  await M.evaluate(() => { document.getElementById('handle').click; });
  await M.locator('#handle').tap(); await W(M, 400); await M.screenshot({path:shot('m_jakt.png')});
  check(await M.evaluate(() => document.documentElement.scrollWidth) <= 390, 'mobil: Jakt-fliken utan sidscroll');
  check(await M.evaluate(() => document.getElementById('heatBox').hidden), 'den som inte är jaktledare eller admin ser ingen värmekarta');
  await browser.close(); server.close();
  console.log(`\n${passes} PASS, ${fails.length} FAIL` + (fails.length ? '\n' + fails.join('\n') : ''));
  process.exitCode = fails.length ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
