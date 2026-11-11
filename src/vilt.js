/* ---------- Jakttider: allmän jakt enligt jaktförordningen (1987:905) bilaga 1, lydelse t.o.m. 30 juni 2027 ---------- */
const LAN = ['Blekinge','Dalarna','Gotland','Gävleborg','Halland','Jämtland','Jönköping','Kalmar','Kronoberg','Norrbotten','Skåne','Stockholm','Södermanland','Uppsala','Värmland','Västerbotten','Västernorrland','Västmanland','Västra Götaland','Örebro','Östergötland'];
const JT_CHECKED = '2026-11-11';
const JF_URL = id => 'https://jagareforbundet.se/jakt/jakttider/jakttid-for-enskilt-djur/?animalId=' + id;
const VILT = (() => {
  const N4 = ['Västernorrland','Jämtland','Västerbotten','Norrbotten'];
  const N6 = ['Dalarna','Gävleborg'].concat(N4);
  const N7 = ['Värmland'].concat(N6);
  const S9 = ['Gotland','Halland','Jönköping','Kalmar','Kronoberg','Skåne','Södermanland','Västra Götaland','Östergötland'];
  const G7 = ['Östergötland','Jönköping','Kronoberg','Kalmar','Blekinge','Halland','Västra Götaland'];
  const SV = 'Endast smyg- eller vaktjakt';
  const R = (lan, per, o) => Object.assign({lan, per: Array.isArray(per[0]) ? per : [per]}, o || {});
  const all = (per, o) => R('*', per, o);
  const rest = (ex, per, o) => R('*', per, Object.assign({ex}, o || {}));
  // Norrbottens gränsälvsområde har egen starttid för flera sjöfåglar
  const grans = (start, end) => [
    R(['Norrbotten'], [start, end], {sub:'utom gränsälvsområdet'}),
    R(['Norrbotten'], ['08-20', end], {sub:'gränsälvsområdet', note:'Från kl. 11.00 den 20 augusti'})];
  const and = restEnd => [R(['Gotland','Blekinge','Skåne'], ['08-21','12-31']),
    R(['Dalarna','Gävleborg','Västernorrland','Jämtland','Västerbotten'], ['08-25','11-30'])]
    .concat(grans('08-25','11-30'), [rest(['Gotland','Blekinge','Skåne'].concat(N6), ['08-21', restEnd])]);
  const dyk = () => [rest(['Norrbotten'], ['08-21','01-31'])].concat(grans('08-21','01-31'));
  const gas = () => [rest(['Norrbotten'], ['08-11','01-31'])].concat(grans('08-11','01-31'));
  const ripa = () => [R(['Jämtland'], ['08-25','02-29']),
    R(['Dalarna'], ['08-25','02-29'], {sub:'Älvdalens kommun'}), R(['Dalarna'], ['08-25','02-15'], {sub:'övriga delar av länet'}),
    R(['Västerbotten','Norrbotten'], ['08-25','02-15'], {sub:'nedanför lappmarksgränsen'}),
    R(['Västerbotten','Norrbotten'], ['08-25','03-15'], {sub:'ovanför lappmarksgränsen'}),
    R(['Värmland','Gävleborg','Västernorrland'], ['08-25','11-15'])];
  const skog = () => [R(G7, ['08-25','09-30'], {cls:'Höna och tupp'}), R(G7, ['01-01','01-31'], {cls:'Tupp'}),
    R(['Skåne'], [['09-01','09-15'],['01-01','01-31']], {cls:'Tupp'}),
    rest(G7.concat(['Gotland','Skåne']), ['08-25','11-15'], {cls:'Höna och tupp'}),
    rest(G7.concat(['Gotland','Skåne']), ['11-16','02-15'], {cls:'Tupp'})];
  const kraka = () => [R(N4, ['07-16','04-30']), rest(N4, ['07-01','04-15'])];
  const S = (id, name, cat, jf, rules, o) => Object.assign({id, name, cat, jf, rules}, o || {});
  return [
    S('alg','Älg','d',623,[],{lic:'Jakttid och tilldelning beslutas av länsstyrelsen (licens- eller älgskötselområde).'}),
    S('radjur','Rådjur','d',565,[all([['08-16','09-30'],['05-01','06-15']],{cls:'Hornbärande',note:SV}), all(['09-01','09-30'],{cls:'Kid',note:SV}), all(['10-01','01-31'],{cls:'Alla djur'})]),
    S('vildsvin','Vildsvin','d',612,[all(['04-01','01-31'],{cls:'Alla utom sugga som följs av randiga eller bruna små kultingar'}), all(['07-01','06-30'],{cls:'Årsunge'})]),
    S('dovhjort','Dovhjort','d',499,[all([['10-01','10-20'],['11-16','02-29']],{cls:'Alla djur'}), all(['09-01','09-30'],{cls:'Hornbärande djur och kalv',note:SV}), all([['10-21','11-15'],['03-01','03-31']],{cls:'Hind och kalv',note:'1–31 mars endast smyg- eller vaktjakt'})]),
    S('kronhjort','Kronhjort','d',537,[
      R(['Skåne'],['10-08','01-31'],{sub:'utanför kronhjortsområden',note:'Inom kronhjortsområden krävs licens. Kontrollera vilka djur som får fällas.'}),
      rest(['Skåne'],['08-16','01-31'],{cls:'Årskalv',sub:'utanför kronhjortsskötselområden',note:'16 aug–30 sep endast smyg- eller vaktjakt'}),
      rest(['Skåne'],[['08-16','10-07'],['02-01','02-29']],{cls:'Hind och årskalv',sub:'inom kronhjortsskötselområde',note:'Till 30 sep och i februari endast smyg- eller vaktjakt'}),
      rest(['Skåne'],['10-08','01-31'],{cls:'Alla djur',sub:'inom kronhjortsskötselområde'})]),
    S('falthare','Fälthare','d',513,[all(['09-01','02-29'])]),
    S('skogshare','Skogshare','d',589,[R(S9,['09-01','02-15']), rest(S9,['09-01','02-29'])]),
    S('rodrav','Rödräv','d',579,[R(['Blekinge','Skåne','Halland'],['08-01','02-29']), R(['Värmland','Örebro','Gävleborg'],['08-01','03-31']),
      R(['Dalarna'],['08-01','03-31'],{sub:'utom Älvdalens kommun'}), R(['Dalarna'],['08-01','04-15'],{sub:'Älvdalens kommun'}), R(N4,['08-01','04-15']),
      rest(['Blekinge','Skåne','Halland','Värmland','Örebro','Gävleborg','Dalarna'].concat(N4),['08-01','03-15'])]),
    S('gravling','Grävling','d',518,[all(['08-01','01-31'])]),
    S('skogsmard','Mård','d',557,[R(N7,['09-01','03-31']), rest(N7,['09-01','02-29'])]),
    S('iller','Iller','d',531,[all(['09-01','02-29'])]),
    S('baver','Bäver','d',496,[R(N6,['10-01','05-15']), rest(N6,['10-01','05-10'])]),
    S('gragas','Grågås','f',400,gas()), S('kanadagas','Kanadagås','f',421,gas()),
    S('blasgas','Bläsgås','f',369,[R(['Skåne'],['10-01','01-31'])]),
    S('grasand','Gräsand','f',408,and('12-31')), S('blasand','Bläsand','f',365,and('11-30')), S('kricka','Kricka','f',428,and('11-30')),
    S('knipa','Knipa','f',425,dyk()), S('storskrake','Storskrake','f',469,dyk()), S('vigg','Vigg','f',484,dyk()),
    S('sjoorre','Sjöorre','f',456,[all(['09-21','01-31'])]),
    S('tjader','Tjäder','f',474,skog()), S('orre','Orre','f',440,skog()),
    S('jarpe','Järpe','f',414,[R(N7,['08-25','11-15'])]),
    S('dalripa','Dalripa','f',373,ripa()), S('fjallripa','Fjällripa','f',394,ripa()),
    S('rapphona','Rapphöna','f',446,[all(['09-16','11-30'])]),
    S('fasan','Fasan','f',389,[all(['10-01','01-31'])]),
    S('morkulla','Morkulla','f',435,[all(['09-11','12-31'])]),
    S('ringduva','Ringduva','f',449,[R(N6,['08-01','12-31']), rest(N6,['08-16','12-31'])]),
    S('kraka','Kråka','f',432,kraka()), S('kaja','Kaja','f',418,kraka()), S('skata','Skata','f',458,kraka()),
    S('raka','Råka','f',453,[R(['Skåne','Halland'],['07-21','01-31'])]),
    S('notskrika','Nötskrika','f',438,[all(['08-21','03-10'])]),
    S('fiskmas','Fiskmås','f',391,[all(['08-11','02-29'])]),
    S('gratrut','Gråtrut','f',406,[all(['08-01','03-31'])]),
  ];
})();
const viltById = id => VILT.find(v => v.id === id);
const MON = ['jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec'];
const fmtMD = md => md === '02-29' ? '28/29 feb' : `${+md.slice(3)} ${MON[+md.slice(0,2) - 1]}`;
const fmtPer = per => per.map(([a,b]) => `${fmtMD(a)}–${fmtMD(b)}`).join(' och ');
const inPer = (md, [a,b]) => a <= b ? (md >= a && md <= b) : (md >= a || md <= b);
function viltRows(v, lan){ return v.rules.filter(r => r.lan === '*' ? !(r.ex || []).includes(lan) : r.lan.includes(lan)); }
function viltLawful(v, lan, md){ return viltRows(v, lan).filter(r => r.per.some(p => inPer(md, p))); }
const rowLabel = r => [r.cls, r.sub].filter(Boolean).join(', ');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

function renderVilt(){
  const pane = $('#paneVilt'); if(!pane) return;
  const lan = state.settings.lan || '', day = viltDay || todayISO(), md = day.slice(5);
  let html = `<div class="row2"><label class="field"><span>Län</span><select class="input" id="viltLan"><option value="">Välj län</option>${LAN.map(l => `<option${l === lan ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field"><span>Datum</span><input class="input" type="date" id="viltDay" value="${day}"></label></div>`;
  if(!lan){ html += `<div class="empty">Välj län för att se vad som är lovligt.</div>`; }
  else {
    const row = r => `<div class="vrow"><span class="vper">${fmtPer(r.per)}</span>${rowLabel(r) ? `<span class="vcls">${esc(rowLabel(r))}</span>` : ''}${r.note ? `<span class="vnote">${esc(r.note)}</span>` : ''}</div>`;
    const item = (v, rows) => `<div class="vitem"><a class="vname" href="${JF_URL(v.jf)}" target="_blank" rel="noopener">${esc(v.name)}</a>${rows.map(row).join('')}</div>`;
    const yes = [], no = [], lic = [];
    for(const v of VILT){ if(v.lic){ lic.push(v); continue; } const rows = viltRows(v, lan); if(!rows.length) continue; const ok = rows.filter(r => r.per.some(p => inPer(md, p))); if(ok.length) yes.push([v, ok]); else no.push([v, rows]); }
    const dstr = `${+day.slice(8)} ${MON[+day.slice(5,7) - 1]}`;
    for(const [cat, label] of [['d','Däggdjur'],['f','Fåglar']]){
      const l = yes.filter(([v]) => v.cat === cat);
      html += `<h3 class="sec">${label} – lovligt ${dstr} <span class="fcount">${l.length}</span></h3>`;
      html += l.length ? l.map(([v, rows]) => item(v, rows)).join('') : `<p class="note" style="margin-top:0">Ingen allmän jakttid den här dagen.</p>`;
    }
    html += `<h3 class="sec">Licens eller särskilt beslut</h3>${lic.map(v => `<div class="vitem"><a class="vname" href="${JF_URL(v.jf)}" target="_blank" rel="noopener">${esc(v.name)}</a><div class="vrow"><span class="vnote">${esc(v.lic)}</span></div></div>`).join('')}`;
    html += `<details class="vmore"><summary>Inte lovligt ${dstr} (${no.length})</summary>${no.map(([v, rows]) => item(v, rows)).join('')}</details>`;
  }
  html += `<p class="note">Allmän jakttid enligt jaktförordningen (1987:905) bilaga 1, kontrollerad ${JT_CHECKED}. Nya jakttider gäller från 1 juli 2027. Skyddsjakt, licensjakt, länsstyrelsens beslut och lokala regler ingår inte. Tryck på en art för Jägareförbundets tabell och kontrollera alltid där före jakt.</p>
    <div class="btnrow" style="margin-top:8px"><a class="btn sm" href="https://jagareforbundet.se/jakt/jakttider/" target="_blank" rel="noopener">Jägareförbundets jakttider</a></div>`;
  pane.innerHTML = html;
  $('#viltLan').addEventListener('change', e => { state.settings.lan = e.target.value; save(); renderVilt(); });
  $('#viltDay').addEventListener('change', e => { viltDay = e.target.value || todayISO(); renderVilt(); });
}
let viltDay = null;
