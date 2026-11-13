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
  const ctx = await browser.newContext(Object.assign({viewport:{width:1280, height:900}, geolocation:{latitude:58.72, longitude:14.61, accuracy:12}, permissions:['geolocation']}, opts || {}));
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
  await B.click('#hfForm button[type=submit]'); await W(B, 500);
  const hid = Object.keys(data.groups[gid].hunts || {})[0], hunt = hid && data.groups[gid].hunts[hid];
  check(hunt && hunt.species.radjur && hunt.species.vildsvin && hunt.areas[aid] === true && !hunt.areas[aid2] && data.huntCodes[hunt.code].hid === hid, 'Bob (jaktledare) skapade jakt med vilt, ett område och jaktkod');
  check(hunt.expires > Date.now() && new Date(hunt.expires).getHours() === 23, 'jakten gäller till kl. 23.59 i dag');
  check(hunt.starts <= Date.now() && Date.now() - hunt.starts < 120000, 'jakten startar nu som standard');
  check((await A.innerText('#paneJakt')).includes(hunt.code), 'Alice ser jakten och koden');
  // ---- Carl: gäst utan konto ----
  const C = await mkPage(browser, 'carl', '#j-' + hunt.code);
  await C.fill('#gName', 'Carl Gäst'); await C.click('[data-j="login-guest"]'); await W(C, 900);
  check(data.groups[gid].guests && data.groups[gid].guests['anon-carl'] && data.groups[gid].guests['anon-carl'].expires === hunt.expires, 'Carl gick med som gäst, åtkomsten slutar när jakten slutar');
  let sc = await st(C);
  const cShared = sc.pins.filter(p => p.areaId === aid).length, cOther = sc.pins.filter(p => p.areaId === aid2).length;
  check(cShared === 6 && cOther === 0, `gästen ser jaktens område (${cShared} nålar) men inte det andra delade området (${cOther})`);
  check((sc.areas.find(a => a.id === aid) || {}).border === data.groups[gid].areas[aid].border, 'gästen ser gränsen för jaktens område');
  const txtC = await C.innerText('#paneJakt');
  check(txtC.includes('Rådjur') && txtC.includes('Vildsvin') && !txtC.includes(hunt.code) && !txtC.includes('Medlemmar'), 'gästen ser jaktbart vilt men inte kod eller medlemslista');
  const g1 = await C.evaluate(([g, a]) => Promise.all(['members', 'hunts', 'guests', 'pins/' + a, 'pins', 'areas'].map(p => firebase.database().ref('groups/' + g + '/' + p).get().then(() => 'ok', () => 'denied'))), [gid, aid2]);
  check(g1.every(x => x === 'denied'), 'gästen nekas läsa medlemmar, alla jakter, andra gäster och övriga områden');
  const g2 = await C.evaluate(([g, a]) => firebase.database().ref('groups/' + g + '/pins/' + a + '/zz').set({lat:1, lng:1, typeId:'t'}).then(() => 'ok', () => 'denied'), [gid, aid]);
  check(g2 === 'denied', 'gästen kan inte skriva nålar');
  // ---- Positioner ----
  await A.click('#tab-jakt'); await A.locator('#shareToggle').check({force:true}); await W(A, 900);
  const hp = () => ((data.groups[gid].huntPos || {})[hid] || {});
  check(hp().alice && Math.abs(hp().alice.lat - 58.72) < 1e-6 && !data.groups[gid].positions, 'Alice delar sin position i den pågående jakten');
  check(await B.locator('.pos-icon').count() === 1 && await C.locator('.pos-icon').count() === 1 && await A.locator('.pos-icon').count() === 0, 'Bob och gästen Carl ser Alice på kartan, Alice ser inte sig själv som annan');
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
  await A.locator('#shareToggle').uncheck({force:true}); await W(A, 500);
  check(!hp().alice && !Object.keys(tr()).length && await B.locator('.pos-icon').count() === 1, 'Alice slutar dela: hennes position och spår tas bort');
  // ---- Avsluta jakten ----
  await B.click('[data-j="hunt-end"]'); await B.click('[data-j="hunt-end"]'); await W(B, 900);
  check(!data.groups[gid].hunts && !data.huntCodes && !(data.groups[gid].guests || {})['anon-carl'], 'jakten, koden och gästposten är borta');
  check(!data.groups[gid].huntPos && !data.groups[gid].huntTrail, 'jaktens positioner och spår raderades när jakten avslutades');
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
      huntPos:{h:{e:{lat:1, lng:1, t:1}}, h2:{}}, huntTrail:{h:{e:{k1:{lat:1, lng:1, t:1}}}}}},
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
  check(!D('e').write('/groups/g/huntTrail/h/e/k3', {lat:1, lng:1, t:t0 + 3600000}).allowed && D('a2').write('/groups/g/huntTrail/h', null).allowed && !D('e').write('/groups/g/huntTrail/h', null).allowed, 'regel: spårpunkter kan inte framtidsdateras, bara jaktledare raderar jaktens spår');
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
  await browser.close(); server.close();
  console.log(`\n${passes} PASS, ${fails.length} FAIL` + (fails.length ? '\n' + fails.join('\n') : ''));
  process.exitCode = fails.length ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
