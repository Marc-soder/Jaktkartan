/* ---------- Kalender ----------
   Varje användare ser sina jakter i en månadskalender: planerade, kommande och pågående jakter i alla jaktlag man är med i,
   och jakten man gått med i som gäst. En jakt i ett lag man är medlem i är en inbjudan tills man har svarat
   (Jag deltar eller Avböj). Avslutade jakter tas bort en timme efter sluttiden och syns därför inte bakåt i tiden.
   Jaktledare kan planera en ny jakt direkt från en dag i kalendern. */
const WDAY = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];
const MONTH = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
const ME_TAG = {going:'Du deltar', no:'Du har avböjt', invite:'Inbjudan', guest:'Gäst'};
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
      out.push({g, hid, h, day:huntDay(h), st, me:g.kind !== 'member' ? 'guest' : accepted(g, hid) ? 'going' : declined(g, hid) ? 'no' : 'invite'});
    }
  }
  return out.sort((a, b) => huntSort(a.h) - huntSort(b.h));
}
const calInvites = () => calHunts().filter(x => x.me === 'invite' && x.st !== 'ended');
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
/* Visar jaktkortet i Jakt-fliken. */
function calGo(gid, hid){
  closeModal(); setTab('jakt'); if(!isDesktop() && sheet !== 'full') setSheet('full');
  setTimeout(() => { const el = document.getElementById(`hc-${gid}-${hid}`); if(!el) return; el.scrollIntoView({block:'start', behavior:'smooth'}); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); }, 80);
}
function openCal(iso){
  const hs = calHunts(), today = todayISO();
  const first = hs.find(x => x.st !== 'ended' && x.day >= today);
  calUi.sel = iso || (hs.some(x => x.day === today) ? today : first ? first.day : today);
  calUi.month = calUi.sel.slice(0, 7);
  openModal(`<div class="cal-head"><h2>Kalender</h2><button class="iconbtn" type="button" id="calClose" aria-label="Stäng">×</button></div><div id="calBox"></div>`, m => {
    m.querySelector('#calClose').addEventListener('click', closeModal);
    m.querySelector('#calBox').addEventListener('click', calClick);
    calRender();
  });
}
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
    ${lead.length && calUi.sel >= today ? `<div class="btnrow">${lead.map(g => `<button class="btn sm primary" type="button" data-c="new" data-g="${esc(g.id)}">Planera jakt ${esc(dayLabel(calUi.sel))}${lead.length > 1 ? ' i ' + esc(gname(g)) : ''}</button>`).join('')}</div>` : ''}`;
}
/* Ritar om kalendern när något ändras i molnet, om den är öppen. */
function calRefresh(){ if(document.getElementById('calBox')) calRender(); }
function calClick(e){
  const b = e.target.closest('[data-c]'); if(!b) return;
  const c = b.dataset.c, g = cloud.groups[b.dataset.g], hid = b.dataset.h;
  if(c === 'day'){ calUi.sel = b.dataset.d; calRender(); return; }
  if(c === 'prev' || c === 'next'){ const [y, m] = calUi.month.split('-').map(Number), d = new Date(y, m - 1 + (c === 'next' ? 1 : -1), 1); calUi.month = isoOf(d).slice(0, 7); calUi.sel = calUi.month === todayISO().slice(0, 7) ? todayISO() : calUi.month + '-01'; calRender(); return; }
  if(c === 'today'){ calUi.sel = todayISO(); calUi.month = calUi.sel.slice(0, 7); calRender(); return; }
  if(!g) return;
  if(c === 'go' || c === 'cal-go') calGo(g.id, hid);
  else if(c === 'rsvp') rsvpSet(g, hid, true);
  else if(c === 'rsvp-no') rsvpSet(g, hid, false);
  else if(c === 'plan'){ closeModal(); openPlan(g, hid); }
  else if(c === 'start'){ const h = (g.hunts || {})[hid]; if(h && huntDay(h) !== todayISO()) confirmClick(b, 'Starta i dag?', () => startHunt(g, hid)); else startHunt(g, hid); }
  else if(c === 'new'){ closeModal(); openHuntForm(g, null, calUi.sel); }
}
