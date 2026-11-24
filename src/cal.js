/* ---------- Kalender ----------
   Varje användare ser sina jakter i en månadskalender: planerade, kommande och pågående jakter i alla jaktlag man är med i,
   och jakten man gått med i som gäst. En jakt i ett lag man är medlem i är en inbjudan tills man har svarat
   (Jag deltar eller Avböj). Avslutade jakter tas bort en timme efter sluttiden och syns därför inte bakåt i tiden.
   Jaktledare kan planera en ny jakt direkt från en dag i kalendern. */
const WDAY = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];
const MONTH = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
const ME_TAG = {going:'Du deltar', no:'Du har avböjt', invite:'Inbjudan', guest:'Gäst', notinv:'Inte inbjuden'};
const calUi = {month:null, sel:null};
const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/* Veckonummer enligt ISO 8601 (vecka 1 är veckan med årets första torsdag) */
function isoWeek(d){
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()); t.setDate(t.getDate() + 3 - (t.getDay() + 6) % 7);
  const w1 = new Date(t.getFullYear(), 0, 4);
  return 1 + Math.round(((t - w1) / 864e5 - 3 + (w1.getDay() + 6) % 7) / 7);
}
/* Alla jakter jag ser: [{g, hid, h, day, st, me}] sorterade efter dag och starttid. */
function calHunts(){
  const out = [];
  for(const g of Object.values(cloud.groups)){
    if(!g.meta) continue;
    for(const [hid, h] of Object.entries(g.hunts || {})){
      if(!h || (g.kind !== 'member' && !(g.guest && g.guest.hid === hid))) continue;
      const st = huntState(h); if(st === 'gone') continue;
      // En jakt med utvalda inbjudna syns bara för dem, och för jaktledare (som Inte inbjuden)
      if(!invitedTo(g, hid) && !canLeadGroup(g)) continue;
      out.push({g, hid, h, day:huntDay(h), st, me:g.kind !== 'member' ? 'guest' : !invitedTo(g, hid) ? 'notinv' : accepted(g, hid) ? 'going' : declined(g, hid) ? 'no' : 'invite'});
    }
  }
  return out.sort((a, b) => huntSort(a.h) - huntSort(b.h));
}
const calInvites = () => calHunts().filter(x => x.me === 'invite' && x.st !== 'ended');
/* ---------- Avisering om nya inbjudningar ----------
   En inbjudan är en jakt i ett lag man är medlem i, som man är inbjuden till, inte själv har skapat och inte har svarat på.
   Varje ny inbjudan aviseras en gång per enhet: en rad i appen, och en avisering i telefonen (i appen alltid, på webben
   när sidan inte syns). Vilka som är aviserade sparas på enheten. Klockan och Kalender i menyn visar hur många som väntar
   på svar. Svarar man tas aviseringen i telefonen bort.
   Körs när jakterna eller svaren ändras, även med släckt skärm. Utan push-server kommer aviseringen bara medan appen
   eller sidan är igång (även i bakgrunden), annars nästa gång den öppnas. */
const INV_KEY = () => 'jk.huntInv.' + myUid();
function huntInvitesCheck(){
  if(typeof cloud === 'undefined' || cloud.status !== 'in' || !cloud.user) return;
  const now = Date.now(), me = myUid(), pend = {};
  let seen = {}; try { seen = JSON.parse(lsGet(INV_KEY()) || '{}') || {}; } catch(e){}
  const loaded = new Set();
  for(const g of Object.values(cloud.groups)){
    if(g.kind !== 'member' || !g.meta || !g.huntsLoaded || !g.rsvpLoaded) continue;
    loaded.add(g.id);
    for(const [hid, h] of Object.entries(g.hunts || {})){
      if(!h || !(h.expires > now) || h.by === me || !invitedTo(g, hid) || rsvpOf(g, hid)) continue;
      const st = huntState(h, now); if(st === 'ended' || st === 'gone') continue;
      pend[g.id + '/' + hid] = {g, hid, h};
    }
  }
  const add = Object.keys(pend).filter(k => !seen[k]);
  // Besvarad, borttagen eller inte längre inbjuden: aviseringen i telefonen tas bort (bara för lag som är laddade)
  const gone = Object.keys(seen).filter(k => !pend[k] && (seen[k] < now || loaded.has(k.split('/')[0])));
  if(gone.length && typeof NAT !== 'undefined' && NAT.has('LocalNotifications'))
    NAT.call('LocalNotifications', 'cancel', {notifications:gone.map(k => ({id:natId('inv/' + k)}))}).catch(() => {});
  for(const k of gone) delete seen[k];
  for(const k of add) seen[k] = pend[k].h.expires;
  if(add.length || gone.length) lsSet(INV_KEY(), JSON.stringify(seen));
  if(add.length){
    const xs = add.map(k => pend[k]).sort((a, b) => huntSort(a.h) - huntSort(b.h)), one = xs[0];
    const line = x => `${x.h.name || 'Jakt'} (${gname(x.g)}), ${dayLabel(huntDay(x.h))}`;
    const title = xs.length === 1 ? 'Inbjudan: ' + (one.h.name || 'Jakt') : `${xs.length} nya inbjudningar till jakter`;
    const body = xs.length === 1 ? `${gname(one.g)}, ${dayLabel(huntDay(one.h))}. Svara Jag deltar eller Avböj i kalendern.` : xs.map(line).join('\n');
    if(!document.hidden) toast(xs.length === 1 ? `Du är inbjuden till ${line(one)}. Svara i kalendern.` : `Du är inbjuden till ${xs.length} jakter. Svara i kalendern.`, 7000);
    huntInviteSys(xs.length === 1 ? 'inv/' + add[0] : 'inv/' + add.join(','), title, body);
  }
  if(typeof msgBell === 'function') msgBell();
}
function huntInviteSys(key, title, body){
  if(typeof NAT !== 'undefined' && NAT.on){ natNotify(key, title, body, 'jakt'); return; }
  if(!document.hidden) return;
  try {
    if(window.Notification && Notification.permission === 'granted' && navigator.serviceWorker) navigator.serviceWorker.getRegistration().then(r => {
      const opt = {body, tag:key, icon:'icons/icon-192.png'};
      if(r) r.showNotification(title, opt); else new Notification(title, opt);
    }).catch(() => {});
  } catch(e){}
}
const dayLabel = iso => { const [y, m, d] = iso.split('-').map(Number), dt = new Date(y, m - 1, d); return `${WDAY[dt.getDay()]} ${d} ${MON[m - 1]}`; };
function calWhen(x){
  const h = x.h;
  if(x.st === 'live') return 'Pågår till ' + fmtClock(h.expires);
  if(x.st === 'ended') return 'Avslutad';
  if(x.st === 'upcoming') return 'Startar kl. ' + fmtClock(h.starts);
  return 'Startas av jaktledaren';
}
/* En rad för en jakt (i Jakt-fliken och i kalendern). */
function calRow(x, inModal){
  const a = inModal ? 'data-c' : 'data-j';
  const btns = [];
  if(inModal && x.st !== 'ended'){
    if(x.me === 'invite' || x.me === 'no') btns.push(`<button class="btn sm primary" type="button" data-c="rsvp" data-g="${esc(x.g.id)}" data-h="${esc(x.hid)}">Jag deltar</button>`);
    if(x.me === 'invite' || x.me === 'going') btns.push(`<button class="btn sm ghost" type="button" data-c="rsvp-no" data-g="${esc(x.g.id)}" data-h="${esc(x.hid)}">Avböj</button>`);
    if(x.g.kind === 'member' && canLeadGroup(x.g)){
      btns.push(`<button class="btn sm" type="button" data-c="plan" data-g="${esc(x.g.id)}" data-h="${esc(x.hid)}">Planera</button>`);
      if(x.st === 'planned' || x.st === 'upcoming') btns.push(`<button class="btn sm" type="button" data-c="start" data-g="${esc(x.g.id)}" data-h="${esc(x.hid)}">Starta jakten</button>`);
    }
  }
  if(inModal) btns.push(`<button class="btn sm ghost" type="button" data-c="go" data-g="${esc(x.g.id)}" data-h="${esc(x.hid)}">Visa jakten</button>`);
  if(inModal && icsWanted(x)) btns.push(`<button class="btn sm ghost" type="button" data-c="ics1" data-g="${esc(x.g.id)}" data-h="${esc(x.hid)}">Till telefonens kalender</button>`,
    `<a class="btn sm ghost" data-gcal href="${esc(calGcalUrl(x))}" target="_blank" rel="noopener">Google Kalender</a>`);
  const [, mo, d] = x.day.split('-').map(Number);
  return `<div class="cal-row st-${esc(x.st)} me-${esc(x.me)}">
    <button class="cal-date" type="button" ${a}="cal-go" data-g="${esc(x.g.id)}" data-h="${esc(x.hid)}" aria-label="Visa ${esc(x.h.name)}"><b>${d}</b><span>${MON[mo - 1]}</span></button>
    <div class="cal-info"><button class="cal-name" type="button" ${a}="cal-go" data-g="${esc(x.g.id)}" data-h="${esc(x.hid)}">${esc(x.h.name)}</button>
      <div class="small muted">${esc(dayLabel(x.day))} · ${esc(calWhen(x))} · ${esc(gname(x.g))}</div>
      <div class="cal-tags"><span class="tag${x.st === 'live' ? ' on' : x.st === 'planned' ? ' plan' : ''}">${HUNT_TAG[x.st]}</span><span class="tag me ${esc(x.me)}">${ME_TAG[x.me]}</span></div>
      ${btns.length ? `<div class="btnrow cal-btns">${btns.join('')}</div>` : ''}</div></div>`;
}
/* Jakt-fliken: inbjudningar och de närmaste jakterna, och knappen till kalendern. */
function calAgendaHtml(){
  const all = calHunts().filter(x => x.st !== 'ended'), inv = all.filter(x => x.me === 'invite');
  let h = `<h3 class="sec">Kalender</h3>`;
  if(inv.length) h += `<div class="banner cal-inv"><span>Du har ${inv.length === 1 ? 'en inbjudan' : inv.length + ' inbjudningar'} att svara på.</span></div>`;
  h += all.length ? `<div class="cal-list">${all.slice(0, 5).map(x => calRow(x, false)).join('')}</div>${all.length > 5 ? `<p class="small muted">… och ${all.length - 5} till i kalendern.</p>` : ''}`
    : '<p class="note" style="margin-top:0">Inga planerade jakter.</p>';
  h += `<div class="btnrow"><button class="btn sm" type="button" data-j="cal">Visa kalendern</button></div>`;
  return h;
}
/* Visar jaktkortet i jaktlagets vy: pågående jakter under Jakt, kommande under Planera. */
function calGo(gid, hid){
  const g = cloud.groups[gid], h = g && (g.hunts || {})[hid], st = h ? huntState(h) : 'live';
  closeModal(); openTeam(gid, g && g.kind === 'member' && (st === 'planned' || st === 'upcoming') ? 'plan' : 'jakt'); if(!isDesktop() && sheet !== 'full') setSheet('full');
  setTimeout(() => { const el = document.getElementById(`hc-${gid}-${hid}`); if(!el) return; el.scrollIntoView({block:'start', behavior:'smooth'}); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); }, 80);
}
/* Kalendern i panelen. Väljer dagen i dag, eller nästa dag med en jakt. */
function calPick(iso){
  const hs = calHunts(), today = todayISO();
  const first = hs.find(x => x.st !== 'ended' && x.day >= today);
  calUi.sel = iso || (hs.some(x => x.day === today) ? today : first ? first.day : today);
  calUi.month = calUi.sel.slice(0, 7);
}
function openCal(iso){ calPick(iso); setTab('kalender'); }
function renderKalender(){
  if(!calUi.sel) calPick();
  const inv = document.getElementById('calInv'), n = cloud.status === 'in' ? calInvites().length : 0;
  if(inv) inv.innerHTML = cloud.status !== 'in' ? '<p class="note" style="margin-top:0">Logga in under Mitt konto för att se jakterna i dina jaktlag.</p>'
    : n ? `<div class="banner cal-inv"><span>Du har ${n === 1 ? 'en inbjudan' : n + ' inbjudningar'} att svara på.</span></div>` : '';
  calRender();
}
$('#paneKalender').addEventListener('click', e => { if(e.target.closest('#calBox')) calClick(e); });
function calRender(){
  const box = document.getElementById('calBox'); if(!box) return;
  const [y, mo] = calUi.month.split('-').map(Number), first = new Date(y, mo - 1, 1), days = new Date(y, mo, 0).getDate();
  const hs = calHunts(), byDay = {};
  for(const x of hs) (byDay[x.day] = byDay[x.day] || []).push(x);
  const today = todayISO(), lead = Object.values(cloud.groups).filter(g => g.kind === 'member' && g.meta && canLeadGroup(g));
  let grid = `<div class="cal-grid" role="grid"><span class="cal-wk">v.</span>${['mån', 'tis', 'ons', 'tor', 'fre', 'lör', 'sön'].map(d => `<span class="cal-wd">${d}</span>`).join('')}`;
  const off = (first.getDay() + 6) % 7, cells = Math.ceil((off + days) / 7) * 7;
  for(let i = 0; i < cells; i++){
    const dt = new Date(y, mo - 1, 1 - off + i), iso = isoOf(dt), inMonth = dt.getMonth() === mo - 1;
    if(i % 7 === 0) grid += `<span class="cal-wk">${isoWeek(dt)}</span>`;
    if(!inMonth){ grid += '<span class="cal-day out"></span>'; continue; }
    const xs = byDay[iso] || [], dots = xs.slice(0, 3).map(x => `<i class="cdot ${x.st === 'live' ? 'live' : x.me}"></i>`).join('');
    grid += `<button class="cal-day${iso === today ? ' today' : ''}${iso === calUi.sel ? ' sel' : ''}${xs.length ? ' has' : ''}" type="button" data-c="day" data-d="${iso}" aria-pressed="${iso === calUi.sel}" aria-label="${esc(dayLabel(iso))}${xs.length ? ', ' + xs.length + (xs.length === 1 ? ' jakt' : ' jakter') : ''}"><span>${dt.getDate()}</span><span class="dots">${dots}</span></button>`;
  }
  grid += '</div>';
  const sel = byDay[calUi.sel] || [];
  box.innerHTML = `<div class="cal-nav"><button class="iconbtn" type="button" data-c="prev" aria-label="Föregående månad">‹</button><b>${MONTH[mo - 1]} ${y}</b><button class="iconbtn" type="button" data-c="next" aria-label="Nästa månad">›</button><button class="btn sm ghost" type="button" data-c="today">I dag</button></div>
    ${grid}
    <div class="cal-legend small muted"><span><i class="cdot invite"></i>Inbjudan</span><span><i class="cdot going"></i>Du deltar</span><span><i class="cdot live"></i>Pågår</span><span><i class="cdot no"></i>Avböjt</span></div>
    <h3 class="sec">${esc(dayLabel(calUi.sel))}</h3>
    ${sel.length ? `<div class="cal-list">${sel.map(x => calRow(x, true)).join('')}</div>` : '<p class="note" style="margin-top:0">Ingen jakt den här dagen.</p>'}
    ${lead.length && calUi.sel >= today ? `<div class="btnrow">${lead.map(g => `<button class="btn sm primary" type="button" data-c="new" data-g="${esc(g.id)}">Planera jakt ${esc(dayLabel(calUi.sel))}${lead.length > 1 ? ' i ' + esc(gname(g)) : ''}</button>`).join('')}</div>` : ''}
    ${cloud.status === 'in' ? `<h3 class="sec">Telefonens kalender</h3><p class="note" style="margin-top:0">Spara kommande jakter som du deltar i eller är inbjuden till som en kalenderfil (.ics) och öppna den i telefonens kalender. Ändras en jakt senare: exportera igen, så uppdateras den. Googles Kalender-app kan inte öppna filen; använd då <b>Google Kalender</b> vid varje jakt.</p>
      <div class="btnrow"><button class="btn sm" type="button" data-c="ics">Exportera kalenderfil</button></div>` : ''}`;
}
/* ---------- Kalenderfil (.ics, RFC 5545) ----------
   Kommande jakter som man deltar i, är inbjuden till eller är gäst i (inte avböjda, inte avslutade). En jakt med starttid
   blir en händelse från start till sluttid; en jakt som jaktledaren startar för hand blir en heldag. UID är jaktens id,
   och SEQUENCE ökar med tiden, så att en ny export uppdaterar händelsen i stället för att lägga in den två gånger.
   Ingen plats eller koordinater skickas med, bara namn, lag, tid och om man deltar. */
const icsWanted = x => x.st !== 'ended' && (x.me === 'going' || x.me === 'invite' || x.me === 'guest');
const icsEsc = s => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsUtc = t => new Date(t).toISOString().replace(/\.\d{3}/, '').replace(/[-:]/g, '');
const icsDay = iso => iso.replace(/-/g, '');
/* Rader längre än 75 byte (UTF-8) delas, och fortsättningen börjar med ett blanksteg. */
function icsFold(line){
  const enc = new TextEncoder(); if(enc.encode(line).length <= 75) return line;
  const parts = []; let cur = '', n = 0;
  for(const ch of line){ const b = enc.encode(ch).length, max = parts.length ? 74 : 75; if(n + b > max){ parts.push(cur); cur = ''; n = 0; } cur += ch; n += b; }
  parts.push(cur); return parts.join('\r\n ');
}
function calIcs(xs, now){
  now = now || Date.now();
  const url = location.origin + location.pathname, L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Jaktkartan//Jakter//SV', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Jaktkartan'];
  for(const x of xs){
    const h = x.h, timed = !h.manual && h.starts && h.expires > h.starts;
    L.push('BEGIN:VEVENT', `UID:${x.g.id}-${x.hid}@jaktkartan`, 'DTSTAMP:' + icsUtc(now), 'SEQUENCE:' + Math.floor(now / 60000));
    if(timed) L.push('DTSTART:' + icsUtc(h.starts), 'DTEND:' + icsUtc(h.expires));
    else { const [y, m, d] = x.day.split('-').map(Number); L.push('DTSTART;VALUE=DATE:' + icsDay(x.day), 'DTEND;VALUE=DATE:' + icsDay(isoOf(new Date(y, m - 1, d + 1)))); }
    const how = timed ? `Startar ${fmtClock(h.starts)}, slutar ${fmtClock(h.expires)}.` : 'Jaktledaren startar jakten.';
    L.push('SUMMARY:' + icsEsc(h.name || 'Jakt'), 'DESCRIPTION:' + icsEsc(`${gname(x.g)}. ${ME_TAG[x.me]}. ${how}\nÖppna Jaktkartan för planering och karta.`),
      'STATUS:' + (x.me === 'invite' ? 'TENTATIVE' : 'CONFIRMED'), 'TRANSP:OPAQUE', 'URL:' + url, 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(icsFold).join('\r\n') + '\r\n';
}
/* Google Kalender: öppnar en ny händelse med jakten ifylld (namn, tid, lag), som man sparar själv. Ingen fil behövs, så det
   fungerar även där Googles Kalender-app inte kan öppna .ics-filer. Samma innehåll som i kalenderfilen. */
function calGcalUrl(x){
  const h = x.h, timed = !h.manual && h.starts && h.expires > h.starts;
  let dates;
  if(timed) dates = icsUtc(h.starts) + '/' + icsUtc(h.expires);
  else { const [y, m, d] = x.day.split('-').map(Number); dates = icsDay(x.day) + '/' + icsDay(isoOf(new Date(y, m - 1, d + 1))); }
  const how = timed ? `Startar ${fmtClock(h.starts)}, slutar ${fmtClock(h.expires)}.` : 'Jaktledaren startar jakten.';
  const q = {action:'TEMPLATE', text:h.name || 'Jakt', dates, details:`${gname(x.g)}. ${ME_TAG[x.me]}. ${how}\nÖppna Jaktkartan för planering och karta: ${location.origin + location.pathname}`};
  return 'https://calendar.google.com/calendar/render?' + Object.entries(q).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
}
function calExport(xs, name){
  if(!xs.length){ toast('Inga kommande jakter att exportera.'); return; }
  download(name, calIcs(xs), 'text/calendar');
  toast(NAT.on ? 'Välj telefonens kalender i Dela-menyn för att lägga in ' + (xs.length === 1 ? 'jakten.' : `de ${xs.length} jakterna.`)
    : `Kalenderfilen med ${xs.length === 1 ? 'jakten' : xs.length + ' jakter'} sparas. Öppna den för att lägga in den i kalendern.`, 7000);
}
/* Ritar om kalendern när något ändras i molnet. */
function calRefresh(){ if(document.getElementById('calBox') && calUi.sel) renderKalender(); }
function calClick(e){
  const b = e.target.closest('[data-c]'); if(!b) return;
  const c = b.dataset.c, g = cloud.groups[b.dataset.g], hid = b.dataset.h;
  if(c === 'day'){ calUi.sel = b.dataset.d; calRender(); return; }
  if(c === 'prev' || c === 'next'){ const [y, m] = calUi.month.split('-').map(Number), d = new Date(y, m - 1 + (c === 'next' ? 1 : -1), 1); calUi.month = isoOf(d).slice(0, 7); calUi.sel = calUi.month === todayISO().slice(0, 7) ? todayISO() : calUi.month + '-01'; calRender(); return; }
  if(c === 'today'){ calUi.sel = todayISO(); calUi.month = calUi.sel.slice(0, 7); calRender(); return; }
  if(c === 'ics'){ calExport(calHunts().filter(icsWanted), `jaktkartan-jakter-${todayISO()}.ics`); return; }
  if(!g) return;
  if(c === 'ics1'){ const x = calHunts().find(y => y.g.id === g.id && y.hid === hid); if(x) calExport([x], `jakt-${x.day}.ics`); return; }
  if(c === 'go' || c === 'cal-go') calGo(g.id, hid);
  else if(c === 'rsvp') rsvpSet(g, hid, true);
  else if(c === 'rsvp-no') rsvpSet(g, hid, false);
  else if(c === 'plan') openPlan(g, hid);
  else if(c === 'start'){ const h = (g.hunts || {})[hid]; if(h && huntDay(h) !== todayISO()) confirmClick(b, 'Starta i dag?', () => startHunt(g, hid)); else startHunt(g, hid); }
  else if(c === 'new') openHuntForm(g, null, calUi.sel);
}
