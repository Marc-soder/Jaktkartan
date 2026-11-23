/* ---------- Krypterade meddelanden i jakten ----------
   Varje enhet har ett eget nyckelpar (ECDH P-256). Den privata nyckeln skapas i webbläsaren, kan inte exporteras
   och sparas i IndexedDB. Den publika nyckeln läggs i groups/<lag>/msgKeys/<uid>/<enhet>.
   Ett meddelande krypteras med en slumpad AES-GCM-nyckel. Den nyckeln krypteras i sin tur för varje mottagares enheter
   (och avsändarens egna) med en nyckel som härleds med ECDH + HKDF. Databasen ser alltså bara vem som skrivit till vem,
   aldrig texten. Meddelandena ligger i groups/<lag>/huntMsg/<jakt> och finns bara medan jakten pågår. */
const MSG_MAX = 1000;
const KEY_TTL = 90 * 864e5;   // nycklar från enheter som inte använts på 90 dagar används inte och tas bort
const keyFresh = d => !!d && !!d.k && (d.t || 0) >= Date.now() - KEY_TTL;
var msgKeyP = null;                 // Promise med {did, priv, pubB64}
const msgPlain = {};                // mid -> {text} | {err}
const msgPair = {};                 // publik nyckel (base64) -> härledd AES-nyckel
const msgSeen = {start:Date.now(), told:{}};
const te = new TextEncoder(), td = new TextDecoder();
const b64 = buf => { const a = new Uint8Array(buf); let s = ''; for(let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const msgCryptoOk = () => !!(window.crypto && crypto.subtle && window.indexedDB);

function idbReq(mode, fn){
  return new Promise((res, rej) => {
    const o = indexedDB.open('faltkartan-keys', 1);
    o.onupgradeneeded = () => o.result.createObjectStore('k');
    o.onerror = () => rej(o.error);
    o.onsuccess = () => { const tx = o.result.transaction('k', mode), r = fn(tx.objectStore('k')); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); };
  });
}
/* Min nyckel: hämtas från IndexedDB, eller skapas första gången. */
function myMsgKey(){
  if(msgKeyP) return msgKeyP;
  msgKeyP = (async () => {
    let v = null;
    try { v = await idbReq('readonly', s => s.get('me')); } catch(e){}
    if(!v || !v.priv || !v.pubB64){
      const kp = await crypto.subtle.generateKey({name:'ECDH', namedCurve:'P-256'}, false, ['deriveBits']);
      v = {did:'d' + uid().replace(/[^a-z0-9]/gi, ''), priv:kp.privateKey, pubB64:b64(await crypto.subtle.exportKey('raw', kp.publicKey))};
      try { await idbReq('readwrite', s => s.put(v, 'me')); } catch(e){}   // privat läge: nyckeln gäller bara den här sessionen
    }
    return v;
  })();
  msgKeyP.catch(() => { msgKeyP = null; });
  return msgKeyP;
}
/* Gemensam nyckel mellan min privata nyckel och en publik nyckel (samma åt båda hållen). */
async function pairKey(pubB64){
  if(msgPair[pubB64]) return msgPair[pubB64];
  const me = await myMsgKey();
  const pub = await crypto.subtle.importKey('raw', unb64(pubB64), {name:'ECDH', namedCurve:'P-256'}, false, []);
  const bits = await crypto.subtle.deriveBits({name:'ECDH', public:pub}, me.priv, 256);
  const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  msgPair[pubB64] = await crypto.subtle.deriveKey({name:'HKDF', hash:'SHA-256', salt:te.encode('jaktkartan-msg-v1'), info:te.encode('wrap')}, hk, {name:'AES-GCM', length:256}, false, ['encrypt', 'decrypt']);
  return msgPair[pubB64];
}
const aadOf = m => te.encode(`${m.from}|${m.t}`);
/* recips: [{id:'uid~enhet', k:publik nyckel}] */
async function msgEncrypt(text, recips, from, t){
  const me = await myMsgKey();
  const ck = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12));
  const cKey = await crypto.subtle.importKey('raw', ck, 'AES-GCM', false, ['encrypt']);
  const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:aadOf({from, t})}, cKey, te.encode(text));
  const keys = {};
  for(const r of recips){
    const wk = await pairKey(r.k), wiv = crypto.getRandomValues(new Uint8Array(12));
    const w = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv:wiv, additionalData:te.encode(r.id)}, wk, ck));
    const both = new Uint8Array(12 + w.length); both.set(wiv); both.set(w, 12); keys[r.id] = b64(both);
  }
  return {iv:b64(iv), ct:b64(ct), spk:me.pubB64, keys};
}
/* Avkrypterar om meddelandet har en nyckel till den här enheten. Avsändarens nyckel måste vara en av hens publicerade. */
async function msgDecrypt(g, m){
  const me = await myMsgKey(), id = myUid() + '~' + me.did, w = m.keys && m.keys[id];
  if(!w) return {err:'Skickades innan du öppnade appen på den här enheten.'};
  const own = Object.values((g.msgKeys || {})[m.from] || {}).some(x => x && x.k === m.spk);
  if(!own) return {err:'Kunde inte bekräfta avsändaren.'};
  try {
    const raw = unb64(w), wk = await pairKey(m.spk);
    const ck = await crypto.subtle.decrypt({name:'AES-GCM', iv:raw.slice(0, 12), additionalData:te.encode(id)}, wk, raw.slice(12));
    const cKey = await crypto.subtle.importKey('raw', ck, 'AES-GCM', false, ['decrypt']);
    return {text:td.decode(await crypto.subtle.decrypt({name:'AES-GCM', iv:unb64(m.iv), additionalData:aadOf(m)}, cKey, unb64(m.ct)))};
  } catch(e){ return {err:'Kunde inte låsa upp meddelandet.'}; }
}

/* Publicera min nyckel i laget (och uppdatera namnet). Gäster märker nyckeln med sin jakt. */
async function msgPublish(g){
  if(!fb || !cloud.user || !g || !msgCryptoOk()) return;
  if(g.kind === 'member' ? !(g.members || {})[myUid()] : !(g.guest && g.guest.hid)) return;
  let me; try { me = await myMsgKey(); } catch(e){ return; }
  const cur = ((g.msgKeys || {})[myUid()] || {})[me.did], hid = g.kind === 'guest' ? g.guest.hid : null;
  // Mina gamla enheters nycklar tas bort, så att meddelanden inte krypteras till enheter som inte används
  for(const [did, d] of Object.entries((g.msgKeys || {})[myUid()] || {})) if(did !== me.did && !keyFresh(d)) fb.db.ref(`groups/${g.id}/msgKeys/${myUid()}/${did}`).remove().catch(() => {});
  // Tiden uppdateras högst en gång per dygn: den visar att enheten används
  if(cur && cur.k === me.pubB64 && cur.name === myName() && (cur.hid || null) === hid && Date.now() - (cur.t || 0) < 864e5) return;
  const v = {k:me.pubB64, name:myName(), t:Date.now()}; if(hid) v.hid = hid;
  fb.db.ref(`groups/${g.id}/msgKeys/${myUid()}/${me.did}`).set(v).catch(() => {});
}
/* Vilka jag kan skriva till i jakten: alla med nyckel som är medlemmar eller gäster i just den jakten. */
function msgPeople(g, hid){
  const out = [];
  for(const [u, devs] of Object.entries(g.msgKeys || {})){
    if(!devs || u === myUid()) continue;
    const list = Object.entries(devs).filter(([, d]) => keyFresh(d) && (!d.hid || d.hid === hid));
    if(!list.length) continue;
    if(g.kind === 'member' && !(g.members || {})[u] && !Object.entries(g.guests || {}).some(([gu, v]) => gu === u && v && v.hid === hid)) continue;
    const guest = list.every(([, d]) => d.hid);
    list.sort((a, b) => b[1].t - a[1].t);
    out.push({uid:u, name:(list[0][1].name || 'Deltagare') + (guest ? ' (gäst)' : ''), devices:list.map(([did, d]) => ({id:u + '~' + did, k:d.k}))});
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
}
const myDevices = g => Object.entries((g.msgKeys || {})[myUid()] || {}).filter(([, d]) => keyFresh(d)).map(([did, d]) => ({id:myUid() + '~' + did, k:d.k}));

/* Meddelanden som rör mig: jag skrev dem eller de är skickade till mig. */
function msgMine(g, hid){
  const me = myUid();
  return Object.entries((g.huntMsg || {})[hid] || {}).filter(([, m]) => m && (m.from === me || m.all || (m.to && m.to[me]))).sort((a, b) => a[1].t - b[1].t);
}
const msgToText = (g, hid, m) => m.all ? 'alla' : Object.keys(m.to || {}).map(u => u === myUid() ? 'dig' : ((msgPeople(g, hid).find(p => p.uid === u) || {}).name || 'deltagare')).join(', ');
function msgHtml(g, hid, chat){
  if(!msgCryptoOk()) return `<div class="lbl">Meddelanden</div><p class="note" style="margin-top:0">Den här webbläsaren kan inte kryptera meddelanden.</p>`;
  const list = msgMine(g, hid).slice(chat ? -100 : -30);
  let h = chat ? '' : `<div class="lbl">Meddelanden</div>`;
  if(!list.length) h += '<p class="note" style="margin-top:0">Inga meddelanden ännu. De är krypterade: bara mottagarna kan läsa dem.</p>';
  else h += `<div class="msg-list">${list.map(([mid, m]) => {
    const p = msgPlain[mid], mine = m.from === myUid();
    if(!p) msgLoad(g, mid, m);
    return `<div class="msg${mine ? ' me' : ''}${msgFlash.mid === mid && Date.now() < msgFlash.until ? ' flash' : ''}" id="msg-${esc(mid)}"><div class="msg-h"><b>${esc(mine ? 'Du' : m.name || 'Deltagare')}</b> till ${esc(msgToText(g, hid, m))} <span class="muted">· ${esc(fmtClock(m.t))}</span></div>
      ${m.re ? msgQuote(g, hid, m.re) : ''}<div class="msg-t">${p ? (p.text != null ? esc(p.text) : `<span class="muted">${esc(p.err)}</span>`) : '<span class="muted">Låser upp …</span>'}</div>
      ${!mine ? `<button class="linkbtn" type="button" data-j="msg-reply" data-g="${esc(g.id)}" data-h="${esc(hid)}" data-u="${esc(m.from)}" data-m="${esc(mid)}">Svara</button>` : ''}</div>`; }).join('')}</div>`;
  if(chat) return h;
  h += `<div class="btnrow" style="margin-top:6px"><button class="btn sm primary" type="button" data-j="msg-new" data-g="${esc(g.id)}" data-h="${esc(hid)}">Nytt meddelande</button></div>`;
  return h;
}
/* Skrivfältet längst ned i chatten: Skicka går till alla i jakten. Knappen bredvid väljer mottagare. */
function chatBarHtml(g, hid){
  if(!msgCryptoOk()) return '';
  const id = `chatText-${g.id}-${hid}`;
  return `<div class="chat-bar"><textarea class="input" id="${esc(id)}" rows="1" maxlength="${MSG_MAX}" placeholder="Skriv till alla i jakten" aria-label="Meddelande till alla i jakten">${esc(chatDraft[id] || '')}</textarea>
    <button class="btn sm primary" type="button" data-j="chat-send" data-g="${esc(g.id)}" data-h="${esc(hid)}">Skicka</button>
    <button class="iconbtn" type="button" data-j="msg-new" data-g="${esc(g.id)}" data-h="${esc(hid)}" title="Välj mottagare" aria-label="Skriv till valda mottagare"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 19.5c.6-3.3 3-5.2 6-5.2s5.4 1.9 6 5.2"/><circle cx="17" cy="9" r="2.4"/><path d="M16.5 14.2c2.3.2 4 1.8 4.5 4.3"/></svg></button></div>`;
}
async function chatSend(g, hid, b){
  const ta = document.getElementById(`chatText-${g.id}-${hid}`), text = ta ? ta.value.trim().slice(0, MSG_MAX) : '';
  if(!text){ toast('Skriv ett meddelande.'); if(ta) ta.focus(); return; }
  b.disabled = true;
  try {
    const r = await msgSend(g, hid, text, msgPeople(g, hid), true);
    const id = `chatText-${g.id}-${hid}`, t2 = document.getElementById(id); if(t2) t2.value = ''; delete chatDraft[id];
    chatStick = 'send'; scheduleRender();
    if(r === 'queued') toast('Ingen täckning: meddelandet skickas när täckningen kommer tillbaka. Håll appen öppen.', 6000);
  } catch(e){ toast('Kunde inte skicka meddelandet. Kontrollera nätverket.', 5000); }
  finally { b.disabled = false; }
}
/* Chatten rullar till det senaste meddelandet när den öppnas, och när något nytt kommer om man redan är längst ned. */
let chatStick = true;
// Det man håller på att skriva finns kvar när chatten ritas om (till exempel när ett nytt meddelande kommer)
const chatDraft = {};
/* Skrivfältet växer med texten, upp till några rader */
function chatGrow(ta){ ta.style.height = ''; if(ta.scrollHeight > ta.clientHeight) ta.style.height = Math.min(ta.scrollHeight + 2, 120) + 'px'; }
document.addEventListener('input', e => { if(e.target.id && e.target.id.startsWith('chatText-')){ chatDraft[e.target.id] = e.target.value; chatGrow(e.target); } });
/* Olästa meddelanden: de som kommit till mig och inte visats i Chatt-fliken. Vilka som är lästa sparas på enheten. */
let msgRead = null;
function msgReadMap(){
  if(!msgRead || msgRead.uid !== myUid()){ let v = {}; try { v = JSON.parse(lsGet('jk.msgRead.' + myUid()) || '{}') || {}; } catch(e){} msgRead = {uid:myUid(), m:v}; }
  return msgRead.m;
}
function msgUnread(g){
  if(!g || !msgCryptoOk() || !cloud.user) return 0;
  const r = msgReadMap(), me = myUid(); let n = 0;
  for(const hid of liveHunts(g)) for(const [mid, m] of msgMine(g, hid)) if(m.from !== me && !r[mid] && msgPlain[mid] && msgPlain[mid].text != null) n++;
  return n;
}
const msgUnreadAll = () => Object.values(cloud.groups).reduce((n, g) => n + msgUnread(g), 0);
const chatOpen = g => nav.tab === 'jakt' && nav.team === g.id && nav.sub === 'chat' && !!teamTabs(g).chat && !document.hidden;
function msgMarkRead(g){
  const r = msgReadMap(), me = myUid(); let ch = false;
  for(const hid of liveHunts(g)) for(const [mid, m] of msgMine(g, hid)) if(m.from !== me && !r[mid] && msgPlain[mid] && msgPlain[mid].text != null){ r[mid] = Date.now(); ch = true; }
  if(!ch) return false;
  const lim = Date.now() - 3 * 864e5; for(const k of Object.keys(r)) if(r[k] < lim) delete r[k];
  lsSet('jk.msgRead.' + me, JSON.stringify(r));
  msgBell(); if(typeof renderNav === 'function') renderNav();
  return true;
}
/* Klockan högst upp: syns under pågående jakter, med antal olästa. Ett tryck öppnar chatten. */
function msgBell(){
  const b = document.getElementById('btnBell'); if(!b || typeof cloud === 'undefined') return;
  const n = cloud.user ? msgUnreadAll() : 0, live = !!cloud.user && msgCryptoOk() && Object.values(cloud.groups).some(g => liveHunts(g).length);
  b.hidden = !live; b.classList.toggle('on', n > 0);
  b.querySelector('.bell-n').textContent = n ? (n > 9 ? '9+' : String(n)) : '';
  b.setAttribute('aria-label', n ? `Meddelanden: ${n} olästa` : 'Meddelanden');
}
function msgBellOpen(){
  const gs = Object.values(cloud.groups).filter(g => liveHunts(g).length);
  const g = gs.find(x => msgUnread(x)) || gs[0]; if(!g) return;
  openTeam(g.id, 'chat'); if(!isDesktop()) setSheet('full');
}
/* Avisering i telefonen när appen ligger i bakgrunden: i appen via telefonens egna aviseringar, på webben via
   service workern (om aviseringar är tillåtna). */
// Kommer man tillbaka till appen med chatten öppen räknas meddelandena som lästa
document.addEventListener('visibilitychange', () => { if(!document.hidden && typeof cloud !== 'undefined' && nav.team && cloud.groups[nav.team] && chatOpen(cloud.groups[nav.team])) msgMarkRead(cloud.groups[nav.team]); });
function msgSysNotify(mid, title, body){
  if(typeof NAT !== 'undefined' && NAT.on){ natNotify('msg/' + mid, title, body, 'msg'); return; }
  try {
    if(window.Notification && Notification.permission === 'granted' && navigator.serviceWorker) navigator.serviceWorker.getRegistration().then(r => {
      const opt = {body, tag:'msg-' + mid, icon:'icons/icon-192.png'};
      if(r) r.showNotification(title, opt); else new Notification(title, opt);
    }).catch(() => {});
  } catch(e){}
}
/* Citatet i ett svar: avsändare och början av meddelandet det svarar på. Texten kommer från min egen upplåsta kopia,
   så den som inte fick det ursprungliga meddelandet ser bara att det är ett svar. Ett tryck visar meddelandet. */
function msgQuote(g, hid, re){
  const o = ((g.huntMsg || {})[hid] || {})[re], p = msgPlain[re];
  if(o && p === undefined && msgMine(g, hid).some(([k]) => k === re)) msgLoad(g, re, o);
  const who = o ? (o.from === myUid() ? 'Du' : o.name || 'Deltagare') : '';
  const text = p && p.text != null ? p.text.slice(0, 120) + (p.text.length > 120 ? '…' : '') : '';
  if(!o || !text) return `<div class="msg-q muted">Svar på ett meddelande${o ? '' : ' som inte finns kvar'}</div>`;
  return `<button class="msg-q" type="button" data-j="msg-goto" data-g="${esc(g.id)}" data-m="${esc(re)}"><b>${esc(who)}</b>${esc(text)}</button>`;
}
// Markeringen ligger kvar även om chatten ritas om medan den visas
const msgFlash = {mid:null, until:0};
function msgGoto(mid){
  const el = document.getElementById('msg-' + mid); if(!el) return;
  msgFlash.mid = mid; msgFlash.until = Date.now() + 1600;
  el.scrollIntoView({block:'center', behavior:'smooth'}); el.classList.add('flash');
  setTimeout(() => { if(msgFlash.mid === mid){ msgFlash.mid = null; const e2 = document.getElementById('msg-' + mid); if(e2) e2.classList.remove('flash'); } }, 1650);
}
function msgLoad(g, mid, m){
  if(msgPlain[mid]) return;
  msgPlain[mid] = null;
  msgDecrypt(g, m).then(r => {
    msgPlain[mid] = r; scheduleRender();
    // Nytt meddelande till mig: säg till, i appen och i telefonen om appen ligger i bakgrunden
    if(r.text != null && m.from !== myUid() && m.t >= msgSeen.start - 5000 && !msgSeen.told[mid]){
      msgSeen.told[mid] = true;
      const title = `Meddelande från ${m.name || 'deltagare'}`, short = r.text.slice(0, 140) + (r.text.length > 140 ? '…' : '');
      if(document.hidden) msgSysNotify(mid, title, short);
      if(chatOpen(g)){ msgMarkRead(g); return; }
      toast(`${title}: ${r.text.slice(0, 80)}${r.text.length > 80 ? '…' : ''}`, 6000);
      try { if(navigator.vibrate) navigator.vibrate([150, 80, 150]); } catch(e){}
      if(!(nav.tab === 'jakt' && nav.team === g.id)){ $('#tab-jakt').classList.add('has-news'); if($('#drawer').hidden) $('#btnMenu').classList.add('has-news'); }
    }
  }).catch(() => { msgPlain[mid] = {err:'Kunde inte låsa upp meddelandet.'}; scheduleRender(); });
}
/* Nya meddelanden: lås upp dem direkt så att man får besked även om Jakt-fliken inte är öppen. */
function msgOnData(g, hid){ for(const [mid, m] of msgMine(g, hid)) if(!(mid in msgPlain)) msgLoad(g, mid, m); }

function openMsgForm(g, hid, to, re){
  const people = msgPeople(g, hid), all = !to, orig = re ? ((g.huntMsg || {})[hid] || {})[re] : null;
  if(!orig) re = null;
  openModal(`<h2>${re ? 'Svara' : 'Nytt meddelande'}</h2><form id="msgForm">
    ${re ? `<div class="lbl" style="margin-top:0">Svarar på</div>${msgQuote(g, hid, re).replace('data-j="msg-goto"', 'disabled')}` : ''}
    <label class="checkline"><input type="checkbox" id="msgAll"${all ? ' checked' : ''}><span><b>Alla i jakten</b> (${people.length})</span></label>
    <div class="field" id="msgPeople"><span>Eller välj mottagare</span>${people.length ? people.map(p => `<label class="checkline"><input type="checkbox" data-to="${esc(p.uid)}"${to === p.uid ? ' checked' : ''}${all ? ' disabled' : ''}><span>${esc(p.name)}</span></label>`).join('') : '<span class="small muted">Ingen annan i jakten har öppnat appen ännu.</span>'}</div>
    <label class="field"><span>Meddelande</span><textarea class="input" id="msgText" maxlength="${MSG_MAX}" rows="3" placeholder="Skriv här"></textarea></label>
    <p class="note" style="margin-top:0">🔒 Krypterat: bara mottagarna kan läsa meddelandet. Deltagare som inte har öppnat Jaktkartan sedan meddelanden infördes finns inte i listan.</p>
    <div class="actions"><button class="btn primary grow" type="submit" id="msgSend">Skicka</button><button class="btn ghost" type="button" id="msgCancel">Avbryt</button></div></form>`, m => {
    m.querySelector('#msgAll').addEventListener('change', e => $$('[data-to]', m).forEach(c => { c.disabled = e.target.checked; }));
    m.querySelector('#msgCancel').addEventListener('click', closeModal);
    m.querySelector('#msgForm').addEventListener('submit', async e => {
      e.preventDefault();
      const text = m.querySelector('#msgText').value.trim().slice(0, MSG_MAX); if(!text){ toast('Skriv ett meddelande.'); return; }
      const toAll = m.querySelector('#msgAll').checked, chosen = toAll ? people : people.filter(p => m.querySelector(`[data-to="${CSS.escape(p.uid)}"]`).checked);
      if(!chosen.length){ toast('Välj minst en mottagare.'); return; }
      const btn = m.querySelector('#msgSend'); btn.disabled = true;
      try {
        const r = await msgSend(g, hid, text, chosen, toAll, re);
        closeModal();
        if(r === 'queued') toast('Ingen täckning: meddelandet skickas när täckningen kommer tillbaka. Håll appen öppen.', 6000);
        else toast(toAll ? 'Meddelandet är skickat till alla i jakten.' : `Meddelandet är skickat till ${chosen.map(p => p.name).join(', ')}.`);
      } catch(err){ btn.disabled = false; toast('Kunde inte skicka meddelandet. Kontrollera nätverket.', 5000); }
    });
  });
}
async function msgSend(g, hid, text, people, toAll, re){
  const me = await myMsgKey(), t = Date.now(), from = myUid();
  const recips = people.flatMap(p => p.devices).concat(myDevices(g));
  if(!recips.some(r => r.id === from + '~' + me.did)) recips.push({id:from + '~' + me.did, k:me.pubB64});
  const enc = await msgEncrypt(text, recips, from, t);
  const msg = Object.assign({from, name:myName(), t}, enc);
  if(toAll) msg.all = true; else { msg.to = {}; for(const p of people) msg.to[p.uid] = true; }
  if(re) msg.re = re;
  const mid = 'm' + uid().replace(/[^a-z0-9]/gi, '');
  msgPlain[mid] = {text};
  const sent = fb.db.ref(`groups/${g.id}/huntMsg/${hid}/${mid}`).set(msg);
  // Utan täckning lägger Firebase meddelandet i kö och skickar det när täckningen kommer tillbaka (så länge appen är öppen)
  if(!navigator.onLine){ sent.catch(() => toast('Ett meddelande kunde inte skickas.', 5000)); return 'queued'; }
  await sent;
}
$('#tab-jakt').addEventListener('click', () => $('#tab-jakt').classList.remove('has-news'));
$('#drTeams').addEventListener('click', () => $('#tab-jakt').classList.remove('has-news'));
