/* ---------- Jaktkartan som app på Android (Capacitor) ----------
   Appen är ett tunt skal som öppnar samma sida som webben. Skalet lägger in window.Capacitor, med anrop till
   telefonens egna funktioner (insticksprogram):
   - BackgroundGeolocation: positionen även med släckt skärm, via en tjänst i förgrunden med en fast avisering.
   - CapacitorHttp: positionen skickas med telefonens egen HTTP till Firebase REST. Webbvyn får sämre nät i bakgrunden
     (Android stryper dess anrop efter några minuter), och Firebase tar då inte bort positionen när anslutningen bryts.
   - FirebaseAuthentication: inloggning med Google i telefonens eget system. Google tillåter inte inloggning i webbvyer.
   - LocalNotifications: aviseringar om nödlarm, och en påminnelse när en jakt man deltar i startar.
   I en vanlig webbläsare finns inget window.Capacitor. Då är NAT.on false och inget här används.
   Skalet anropas direkt via Capacitors brygga (nativePromise och nativeCallback), så sidan behöver inga extra filer. */
const NAT = (() => {
  const C = window.Capacitor;
  const on = !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform() && typeof C.nativePromise === 'function' && typeof C.nativeCallback === 'function');
  const has = name => on && (C.PluginHeaders || []).some(p => p && p.name === name);
  const call = (plugin, method, opts) => has(plugin) ? C.nativePromise(plugin, method, opts || {}) : Promise.reject(new Error('Appen saknar ' + plugin));
  const listen = (plugin, method, opts, cb) => has(plugin) ? C.nativeCallback(plugin, method, opts || {}, cb) : null;
  return {on, has, call, listen, notif:'unknown', watch:null};
})();

/* Ett heltal 1..2 000 000 000 för en avisering (Android kräver ett heltal som id). */
const natId = s => { let x = 7; for(let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return (Math.abs(x) % 2000000000) + 1; };

function natInit(){
  if(!NAT.on) return;
  if(NAT.has('LocalNotifications')){
    NAT.call('LocalNotifications', 'createChannel', {id:'sos', name:'Nödlarm', description:'Nödlarm från jaktlaget', importance:5, visibility:1, vibration:true}).catch(() => {});
    NAT.call('LocalNotifications', 'createChannel', {id:'jakt', name:'Jakten börjar', description:'När en jakt du deltar i startar', importance:4, visibility:1, vibration:true}).catch(() => {});
    NAT.call('LocalNotifications', 'checkPermissions').then(r => { NAT.notif = (r && r.display) || 'unknown'; renderJakt(); }).catch(() => {});
  }
}
setTimeout(natInit, 0);

/* Aviseringar: Android 13 och senare frågar användaren. Behövs också för att aviseringen om delad position ska synas. */
function natNotifPerm(quiet){
  if(!NAT.has('LocalNotifications')) return Promise.resolve('denied');
  return NAT.call('LocalNotifications', 'requestPermissions').then(r => {
    NAT.notif = (r && r.display) || 'denied';
    if(!quiet) toast(NAT.notif === 'granted' ? 'Aviseringar är tillåtna.' : 'Aviseringar är inte tillåtna. Det går att ändra under Inställningar, Appar, Jaktkartan.', 5000);
    renderJakt(); return NAT.notif;
  }).catch(() => 'denied');
}
function natNotify(key, title, body, channelId){
  if(!NAT.has('LocalNotifications')) return;
  NAT.call('LocalNotifications', 'schedule', {notifications:[{id:natId(key), title, body, channelId:channelId || 'sos'}]}).catch(() => {});
}

/* ---------- Position i bakgrunden ---------- */
/* Telefonen ger en position i sekunden, även när man står still (distanceFilter 0). Står man på passet skulle man
   annars inte skicka något, och försvinna från kartan efter 30 minuter. gpsPos glesar ut sändningen som på webben
   (var 8:e sekund, i sparläget varje minut). GPS:en är ändå på hela tiden, så batteriet påverkas inte av det. */
function natGpsStart(){
  natGpsStop();
  if(NAT.notif !== 'granted') natNotifPerm(true);
  const opts = {backgroundTitle:'Jaktkartan delar din position', backgroundMessage:'Under jakten. Stoppa delningen i appen.', requestPermissions:true, stale:false, distanceFilter:0};
  NAT.watch = NAT.listen('BackgroundGeolocation', 'addWatcher', opts, (loc, err) => {
    if(err){
      if(err.code === 'NOT_AUTHORIZED'){
        gpsErr({code:1});
        NAT.call('BackgroundGeolocation', 'openSettings').catch(() => {});
      } else gpsErr({code:2});
      return;
    }
    if(loc && typeof loc.latitude === 'number' && typeof loc.longitude === 'number')
      gpsPos({coords:{latitude:loc.latitude, longitude:loc.longitude, accuracy:loc.accuracy || 0}});
  });
}
function natGpsStop(){
  if(NAT.watch == null) return;
  NAT.call('BackgroundGeolocation', 'removeWatcher', {id:NAT.watch}).catch(() => {});
  NAT.watch = null;
}

/* ---------- Sändning till Firebase REST med telefonens egen HTTP ----------
   ID-token gäller en timme. När sidan syns hämtas den från Firebase-biblioteket. När skärmen är släckt förnyas den
   med telefonens egen HTTP (securetoken.googleapis.com), eftersom webbvyns anrop stryps i bakgrunden.
   API-nyckeln är begränsad till sidans adress, därför skickas Referer med. */
const natTok = {uid:null, t:null, exp:0, rt:null};
const NAT_TOK_MARGIN = 5 * 60000;
function natJwtExp(t){
  try { const p = String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(atob(p + '==='.slice((p.length + 3) % 4))).exp * 1000 || 0; } catch(e){ return 0; }
}
function natSetTok(t, rt){ natTok.t = t; natTok.exp = natJwtExp(t); if(rt) natTok.rt = rt; }
/* Samtidiga sändningar (position och spår) delar på samma förnyelse. */
function natToken(force){
  const u = fb && fb.auth.currentUser; if(!u) return Promise.reject(new Error('Inte inloggad'));
  if(natTok.uid !== u.uid){ natTok.uid = u.uid; natTok.t = null; natTok.exp = 0; natTok.rt = null; natTok.p = null; }
  if(!force && natTok.t && natTok.exp - Date.now() > NAT_TOK_MARGIN) return Promise.resolve(natTok.t);
  if(!natTok.p) natTok.p = natTokenNew(u, force).finally(() => { natTok.p = null; });
  return natTok.p;
}
async function natTokenNew(u, force){
  if(!document.hidden){
    try { const t = await u.getIdToken(!!force); natSetTok(t, u.refreshToken); if(natTok.exp - Date.now() > NAT_TOK_MARGIN) return t; } catch(e){}
  }
  const rt = natTok.rt || u.refreshToken; if(!rt) throw new Error('Ingen förnyelse');
  const r = await NAT.call('CapacitorHttp', 'request', {
    url:'https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(cloud.cfg.apiKey), method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded', 'Referer':location.origin + location.pathname},
    data:{grant_type:'refresh_token', refresh_token:rt}});
  const d = r && typeof r.data === 'string' ? JSON.parse(r.data) : (r && r.data) || {};
  if(!r || r.status !== 200 || !d.id_token) throw new Error('Förnyelsen misslyckades (' + (r && r.status) + ')');
  natSetTok(d.id_token, d.refresh_token);
  return natTok.t;
}
async function natRest(method, path, body, retried){
  const t = await natToken(retried);
  const base = String(cloud.cfg.databaseURL || '').replace(/\/+$/, '');
  const r = await NAT.call('CapacitorHttp', 'request', {url:`${base}/${path}.json?auth=${encodeURIComponent(t)}`, method, headers:{'Content-Type':'application/json'}, data:body});
  if(r && r.status === 401 && !retried) return natRest(method, path, body, true);   // ogiltig token: hämta en ny och försök en gång till
  if(!r || r.status < 200 || r.status >= 300) throw new Error('HTTP ' + (r && r.status));
  return r.data;
}
/* Bara den senaste positionen skickas. Är en sändning på väg väntar nästa, och mellanliggande hoppas över. */
const natQ = {busy:false, next:null};
function natPutPos(path, val){
  natQ.next = Object.assign(natQ.next || {}, {[path]:val});
  if(natQ.busy) return;
  natQ.busy = true;
  (async () => {
    while(natQ.next){
      const batch = natQ.next; natQ.next = null;
      for(const [p, v] of Object.entries(batch)){ try { await natRest('PUT', p, v); } catch(e){} }
    }
    natQ.busy = false;
  })();
}
function natPushTrail(path, val){ natRest('POST', path, val).catch(() => {}); }

/* ---------- Inloggning med Google ---------- */
function natGoogleLogin(){
  NAT.call('FirebaseAuthentication', 'signInWithGoogle', {skipNativeAuth:true})
    .then(r => {
      const t = r && r.credential && r.credential.idToken; if(!t) throw new Error('Ingen inloggning från Google');
      return fb.auth.signInWithCredential(firebase.auth.GoogleAuthProvider.credential(t));
    })
    .catch(e => {
      const m = String((e && (e.message || e.code)) || '');
      toast(/cancel|avbr/i.test(m) ? 'Inloggningen avbröts.' : 'Inloggningen med Google misslyckades. ' + m.slice(0, 120), 7000);
    });
}
function natLogout(){
  if(!NAT.on) return;
  NAT.call('FirebaseAuthentication', 'signOut').catch(() => {});
  natRemindersClear();
}

/* ---------- Påminnelse när en jakt man deltar i startar ----------
   Schemaläggs i telefonen, så den kommer även om appen är stängd. Ett tryck öppnar appen, och delningen startar
   som vanligt när jakten pågår. Jakter som startas för hand av jaktledaren har ingen tid och får ingen påminnelse. */
const NAT_REM_KEY = 'jk.natRem';
const natRemGet = () => { try { return JSON.parse(lsGet(NAT_REM_KEY) || '{}') || {}; } catch(e){ return {}; } };
function natReminders(){
  if(!NAT.has('LocalNotifications') || NAT.notif !== 'granted' || !cloud.user) return;
  const now = Date.now(), want = {};
  for(const g of Object.values(cloud.groups)) if(g.kind === 'member' && g.meta) for(const [hid, h] of Object.entries(g.hunts || {})){
    if(h && huntState(h, now) === 'upcoming' && h.starts > now && accepted(g, hid)) want[`${g.id}/${hid}/${h.starts}`] = {at:h.starts, name:h.name || 'Jakt', team:gname(g)};
  }
  const have = natRemGet(), add = Object.keys(want).filter(k => !have[k]);
  // Ta bort påminnelser som har passerat, och sådana för lag som är laddade men där jakten ändrats, avböjts eller tagits bort
  const del = Object.keys(have).filter(k => !want[k] && (have[k] <= now || (cloud.groups[k.split('/')[0]] || {}).meta));
  if(!add.length && !del.length) return;
  if(del.length) NAT.call('LocalNotifications', 'cancel', {notifications:del.map(k => ({id:natId('rem/' + k)}))}).catch(() => {});
  if(add.length) NAT.call('LocalNotifications', 'schedule', {notifications:add.map(k => ({id:natId('rem/' + k), title:'Jakten börjar: ' + want[k].name,
    body:want[k].team + '. Tryck för att öppna Jaktkartan och dela din position.', channelId:'jakt', schedule:{at:new Date(want[k].at).toISOString(), allowWhileIdle:true}}))}).catch(() => {});
  for(const k of del) delete have[k];
  for(const k of add) have[k] = want[k].at;
  lsSet(NAT_REM_KEY, JSON.stringify(have));
}
function natRemindersClear(){
  const have = Object.keys(natRemGet()); if(!have.length) return;
  NAT.call('LocalNotifications', 'cancel', {notifications:have.map(k => ({id:natId('rem/' + k)}))}).catch(() => {});
  lsSet(NAT_REM_KEY, '{}');
}
