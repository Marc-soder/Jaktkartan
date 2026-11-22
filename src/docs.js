/* ---------- Mina dokument ----------
   Jaktkort, jägarexamensbevis, vapenlicenser och liknande, sparade BARA på den här enheten.
   - Inget skickas någonstans: dokumenten ligger i webbläsarens IndexedDB (databasen jk-docs) och går aldrig till Firebase,
     inte med i Data-exporten och inte via service workern.
   - Allt är krypterat med en dokumentlösen som användaren väljer: PBKDF2 (SHA-256, DOCS_ITER varv, slumpat salt) ger en
     AES-GCM-nyckel som inte går att exportera. Varje dokument krypteras för sig med ett eget slumpat IV, och dokumentets id
     är med som extra data, så att krypterade dokument inte kan flyttas mellan poster.
   - Bara giltighetsdatumet ligger okrypterat (valid), så att appen kan påminna innan ett dokument går ut utan att låsas upp.
   - Nyckeln finns bara i minnet medan dokumenten är upplåsta. De låses när appen läggs undan och efter DOCS_IDLE utan
     aktivitet. Glömmer man dokumentlösen går dokumenten inte att öppna: de kan bara raderas.
   - Bilder (JPG, PNG) och PDF:er går att lägga till. En PDF läses med pdf.js (Mozilla), som ligger i appen själv
     (pdfjs/, byggt från node_modules) och laddas först när man väljer en PDF. Varje sida blir en bild som krypteras
     och sparas som de andra bilderna, så att den kan visas utan nät och utan PDF-läsare. Filen skickas inte någonstans.
   - Tömmer man appens data i telefonen, eller avinstallerar appen, försvinner dokumenten. */
const DOCS_DB = 'jk-docs', DOCS_ITER = 600000, DOCS_IDLE = 5 * 60000, DOCS_CHECK = 'jaktkartan-docs-v1', DOCS_MIN = 8;
const DOCS_MAX_IMGS = 10, PDFJS_VER = '6.5.438';
const DOC_KIND = {jaktkort:'Jaktkort', examen:'Jägarexamensbevis', licens:'Vapenlicens', annat:'Annat'};
const docs = {key:null, list:[], last:0, picking:0};   // picking: kameran eller bildväljaren är öppen

function docsDb(mode, fn){
  return new Promise((res, rej) => {
    const o = indexedDB.open(DOCS_DB, 1);
    o.onupgradeneeded = () => { o.result.createObjectStore('meta'); o.result.createObjectStore('docs', {keyPath:'id'}); };
    o.onerror = () => rej(o.error);
    o.onsuccess = () => {
      const db = o.result, tx = db.transaction(['meta', 'docs'], mode), r = fn(tx);
      tx.oncomplete = () => { db.close(); res(r && 'result' in r ? r.result : r); };
      tx.onerror = () => { db.close(); rej(tx.error); };
      tx.onabort = () => { db.close(); rej(tx.error); };
    };
  });
}
const docsMeta = () => docsDb('readonly', tx => tx.objectStore('meta').get('k'));
const docsAll = () => docsDb('readonly', tx => tx.objectStore('docs').getAll());
async function docsKey(pass, salt, iter){
  const base = await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', hash:'SHA-256', salt, iterations:iter}, base, {name:'AES-GCM', length:256}, false, ['encrypt', 'decrypt']);
}
async function docsSeal(key, id, obj){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:te.encode(id)}, key, te.encode(JSON.stringify(obj)));
  return {iv, ct:new Uint8Array(ct)};
}
async function docsOpen(key, id, rec){
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv:rec.iv, additionalData:te.encode(id)}, key, rec.ct);
  return JSON.parse(td.decode(pt));
}
const docsOk = () => !!(window.crypto && crypto.subtle && window.indexedDB);

/* Första gången: välj dokumentlösen. Ett känt värde krypteras, så att fel lösen upptäcks vid upplåsning. */
async function docsCreate(pass){
  const salt = crypto.getRandomValues(new Uint8Array(16)), key = await docsKey(pass, salt, DOCS_ITER), chk = await docsSeal(key, 'check', DOCS_CHECK);
  await docsDb('readwrite', tx => tx.objectStore('meta').put({salt, iter:DOCS_ITER, chk}, 'k'));
  try { if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch(e){}   // minskar risken att webbläsaren rensar bort dem
  docs.key = key; docs.list = []; docs.last = Date.now();
}
async function docsUnlock(pass){
  const m = await docsMeta(); if(!m) return false;
  const key = await docsKey(pass, m.salt, m.iter);
  try { if(await docsOpen(key, 'check', m.chk) !== DOCS_CHECK) return false; } catch(e){ return false; }
  const recs = await docsAll(), list = [];
  for(const r of recs){ try { list.push(Object.assign(await docsOpen(key, r.id, r), {id:r.id})); } catch(e){} }
  docs.key = key; docs.list = list; docs.last = Date.now();
  return true;
}
function docsLock(){
  if(!docs.key && !docs.list.length) return;
  docs.key = null; docs.list = []; docs.picking = 0;
  if(document.getElementById('docsBox')) closeModal();
}
async function docsSave(d){
  const id = d.id || 'd' + uid().replace(/[^a-z0-9]/gi, ''), body = Object.assign({}, d); delete body.id;
  const rec = Object.assign({id}, await docsSeal(docs.key, id, body));
  if(d.valid) rec.valid = d.valid;
  await docsDb('readwrite', tx => tx.objectStore('docs').put(rec));
  const i = docs.list.findIndex(x => x.id === id), v = Object.assign({}, body, {id});
  if(i >= 0) docs.list[i] = v; else docs.list.push(v);
}
const docsDel = id => docsDb('readwrite', tx => tx.objectStore('docs').delete(id)).then(() => { docs.list = docs.list.filter(x => x.id !== id); });
/* Byt dokumentlösen: allt krypteras om med en ny nyckel och ett nytt salt. */
async function docsRekey(pass){
  const salt = crypto.getRandomValues(new Uint8Array(16)), key = await docsKey(pass, salt, DOCS_ITER), chk = await docsSeal(key, 'check', DOCS_CHECK), recs = [];
  for(const d of docs.list){ const body = Object.assign({}, d); delete body.id; const rec = Object.assign({id:d.id}, await docsSeal(key, d.id, body)); if(d.valid) rec.valid = d.valid; recs.push(rec); }
  await docsDb('readwrite', tx => { const s = tx.objectStore('docs'); s.clear(); for(const r of recs) s.put(r); tx.objectStore('meta').put({salt, iter:DOCS_ITER, chk}, 'k'); });
  docs.key = key;
}
const docsWipe = () => docsDb('readwrite', tx => { tx.objectStore('docs').clear(); tx.objectStore('meta').delete('k'); }).then(() => { docs.key = null; docs.list = []; });

/* Bilden förminskas (högst 1600 punkter) och sparas som JPEG, så att den tar lite plats. */
function docsImage(file){
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bild')); };
    img.src = url;
  });
}
/* PDF: varje sida (högst room stycken) ritas som en bild. {pages: [data-URL], total: antal sidor} */
let pdfjsP = null;
const pdfBase = () => new URL('pdfjs/', location.href).href;
function pdfLib(){
  if(!pdfjsP) pdfjsP = import(pdfBase() + 'pdf.min.js?v=' + PDFJS_VER).then(m => { m.GlobalWorkerOptions.workerSrc = pdfBase() + 'pdf.worker.min.js?v=' + PDFJS_VER; return m; })
    .catch(e => { pdfjsP = null; throw e; });
  return pdfjsP;
}
async function docsPdf(file, room){
  const lib = await pdfLib();
  const task = lib.getDocument({data:new Uint8Array(await file.arrayBuffer()), enableXfa:false, wasmUrl:pdfBase() + 'wasm/', standardFontDataUrl:pdfBase() + 'standard_fonts/'});
  const pdf = await task.promise;
  const pages = [], total = pdf.numPages;
  try {
    for(let i = 1; i <= Math.min(total, room); i++){
      const page = await pdf.getPage(i), v1 = page.getViewport({scale:1}), vp = page.getViewport({scale:Math.min(4, 1800 / Math.max(v1.width, v1.height))});
      const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({canvasContext:ctx, canvas:c, viewport:vp}).promise;
      pages.push(c.toDataURL('image/jpeg', 0.88)); page.cleanup();
    }
  } finally { await task.destroy(); }
  return {pages, total};
}
const isPdf = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
const daysTo = iso => Math.round((dayMs(iso) - dayMs(todayISO())) / 864e5);
function validText(iso){
  if(!iso) return '';
  const n = daysTo(iso);
  return n < 0 ? `<span class="doc-exp bad">Gick ut ${esc(fmtDay(iso))}</span>` : n <= 30 ? `<span class="doc-exp soon">Går ut ${esc(fmtDay(iso))} (om ${n} ${n === 1 ? 'dag' : 'dagar'})</span>` : `<span class="small muted">Giltig till ${esc(fmtDay(iso))}</span>`;
}

/* Jakt-fliken: en ruta som öppnar dokumenten */
function docsCardHtml(){
  if(!docsOk()) return '';
  return `<h3 class="sec">Mina dokument</h3><p class="note" style="margin-top:0">Jaktkort, jägarexamensbevis och vapenlicenser. Sparas krypterade bara på den här enheten och skickas aldrig någonstans.</p>
    <div class="btnrow"><button class="btn sm" type="button" id="docsOpenBtn">Öppna mina dokument</button></div>`;
}
document.addEventListener('click', e => { if(e.target.closest('#docsOpenBtn')) openDocs(); });

async function openDocs(){
  if(!docsOk()){ toast('Den här webbläsaren kan inte kryptera dokument.'); return; }
  if(docs.key && Date.now() - docs.last > DOCS_IDLE) docsLock();
  const m = await docsMeta().catch(() => null);
  if(!m) return docsSetupForm();
  if(!docs.key) return docsUnlockForm();
  docsListView();
}
function docsSetupForm(){
  openModal(`<h2>Mina dokument</h2><form id="dsForm">
    <p class="note" style="margin-top:0">Välj en dokumentlösen. Den krypterar dokumenten här i telefonen. Använd inte samma som till något annat.</p>
    <label class="field"><span>Dokumentlösen (minst ${DOCS_MIN} tecken)</span><input class="input" type="password" id="dsPass" autocomplete="new-password"></label>
    <label class="field"><span>Samma igen</span><input class="input" type="password" id="dsPass2" autocomplete="new-password"></label>
    <p class="pwarn">Glömmer du dokumentlösen går dokumenten inte att öppna, av någon. De kan bara raderas.</p>
    <p class="note">Dokumenten finns bara på den här enheten. Tömmer du appens data eller byter telefon försvinner de.</p>
    <div class="actions"><button class="btn primary grow" type="submit" id="dsOk">Skapa</button><button class="btn ghost" type="button" id="dsNo">Avbryt</button></div></form>`, m => {
    m.querySelector('#dsNo').addEventListener('click', closeModal);
    m.querySelector('#dsForm').addEventListener('submit', async e => {
      e.preventDefault();
      const a = m.querySelector('#dsPass').value, b = m.querySelector('#dsPass2').value;
      if(a.length < DOCS_MIN){ toast(`Dokumentlösen måste ha minst ${DOCS_MIN} tecken.`); return; }
      if(a !== b){ toast('Lösenorden är inte lika.'); return; }
      m.querySelector('#dsOk').disabled = true;
      try { await docsCreate(a); docsListView(); } catch(err){ m.querySelector('#dsOk').disabled = false; toast('Det gick inte att skapa. Försök igen.'); }
    });
  });
}
function docsUnlockForm(){
  openModal(`<h2>Mina dokument</h2><form id="duForm">
    <label class="field"><span>Dokumentlösen</span><input class="input" type="password" id="duPass" autocomplete="current-password"></label>
    <p class="small" id="duMsg" role="alert"></p>
    <div class="actions"><button class="btn primary grow" type="submit" id="duOk">Lås upp</button><button class="btn ghost" type="button" id="duNo">Avbryt</button></div>
    <p class="note"><button class="linkbtn" type="button" id="duForgot">Glömt dokumentlösen?</button></p></form>`, m => {
    const inp = m.querySelector('#duPass'); setTimeout(() => inp.focus(), 50);
    m.querySelector('#duNo').addEventListener('click', closeModal);
    m.querySelector('#duForgot').addEventListener('click', docsForgot);
    m.querySelector('#duForm').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = m.querySelector('#duOk'); btn.disabled = true; m.querySelector('#duMsg').textContent = 'Låser upp …';
      const ok = await docsUnlock(inp.value).catch(() => false);
      if(ok){ docsListView(); return; }
      btn.disabled = false; inp.value = ''; inp.focus(); m.querySelector('#duMsg').textContent = 'Fel dokumentlösen.';
    });
  });
}
function docsForgot(){
  openModal(`<h2>Glömt dokumentlösen?</h2><p>Dokumenten är krypterade med din dokumentlösen, och den finns inte sparad någonstans. Utan den går de inte att öppna.</p>
    <p>Du kan radera alla dokument och börja om med en ny dokumentlösen.</p>
    <div class="actions"><button class="btn danger grow" type="button" id="dfWipe">Radera alla dokument</button><button class="btn ghost" type="button" id="dfNo">Avbryt</button></div>`, m => {
    m.querySelector('#dfNo').addEventListener('click', docsUnlockForm);
    const w = m.querySelector('#dfWipe');
    w.addEventListener('click', () => confirmClick(w, 'Tryck igen: allt raderas', () => docsWipe().then(() => { toast('Alla dokument är raderade.'); docsSetupForm(); }).catch(() => toast('Det gick inte att radera.'))));
  });
}
function docsListView(){
  docs.last = Date.now();
  const list = docs.list.slice().sort((a, b) => (Object.keys(DOC_KIND).indexOf(a.kind) - Object.keys(DOC_KIND).indexOf(b.kind)) || String(a.title).localeCompare(String(b.title), 'sv'));
  openModal(`<div class="cal-head"><h2>Mina dokument</h2><button class="btn sm" type="button" data-dc="lock">Lås</button></div><div id="docsBox">
    <p class="note" style="margin-top:0">🔒 Krypterade och sparade bara på den här enheten. De låses när appen läggs undan och efter ${DOCS_IDLE / 60000} minuter.</p>
    ${list.length ? `<div class="doc-list">${list.map(d => `<div class="doc-row"><button class="doc-thumb" type="button" data-dc="view" data-id="${esc(d.id)}" aria-label="Visa ${esc(d.title || DOC_KIND[d.kind])}">${d.imgs && d.imgs[0] ? `<img src="${esc(d.imgs[0])}" alt="">` : '📄'}</button>
      <div class="doc-info"><b>${esc(d.title || DOC_KIND[d.kind] || 'Dokument')}</b><div class="small muted">${esc(DOC_KIND[d.kind] || 'Dokument')}${d.num ? ' · ' + esc(d.num) : ''}</div>${validText(d.valid)}</div>
      <div class="doc-btns"><button class="btn sm" type="button" data-dc="view" data-id="${esc(d.id)}">Visa</button><button class="btn sm ghost" type="button" data-dc="edit" data-id="${esc(d.id)}">Ändra</button></div></div>`).join('')}</div>`
      : '<p class="note">Inga dokument ännu.</p>'}
    <div class="btnrow"><button class="btn primary sm" type="button" data-dc="add">Lägg till dokument</button><button class="btn sm ghost" type="button" data-dc="pass">Byt dokumentlösen</button></div></div>`, m => {
    m.addEventListener('click', e => {
      const b = e.target.closest('[data-dc]'); if(!b) return;
      docs.last = Date.now();
      const d = docs.list.find(x => x.id === b.dataset.id);
      if(b.dataset.dc === 'lock'){ docsLock(); closeModal(); toast('Dokumenten är låsta.'); }
      else if(b.dataset.dc === 'add') docsForm(null);
      else if(b.dataset.dc === 'edit' && d) docsForm(d);
      else if(b.dataset.dc === 'view' && d) docsView(d);
      else if(b.dataset.dc === 'pass') docsPassForm();
    });
  });
}
function docsView(d){
  openModal(`<div class="cal-head"><h2>${esc(d.title || DOC_KIND[d.kind])}</h2><button class="iconbtn" type="button" id="dvClose" aria-label="Stäng">×</button></div><div id="docsBox">
    <div class="small muted">${esc(DOC_KIND[d.kind] || 'Dokument')}${d.num ? ' · nummer ' + esc(d.num) : ''}</div>${validText(d.valid)}
    ${d.note ? `<p>${esc(d.note)}</p>` : ''}
    ${(d.imgs || []).map((src, i) => `<img class="doc-img" src="${esc(src)}" alt="Bild ${i + 1} av ${d.imgs.length}">`).join('') || '<p class="note">Ingen bild.</p>'}
    <div class="actions"><button class="btn grow" type="button" id="dvBack">Tillbaka</button></div></div>`, m => {
    m.querySelector('#dvClose').addEventListener('click', docsListView);
    m.querySelector('#dvBack').addEventListener('click', docsListView);
  });
}
/* Lägg till eller ändra. Bilden tas helst direkt med kameran, så att den inte hamnar i telefonens bildgalleri. */
function docsForm(d){
  const imgs = d && d.imgs ? d.imgs.slice() : [];
  openModal(`<h2>${d ? 'Ändra dokument' : 'Lägg till dokument'}</h2><form id="dfForm"><div id="docsBox">
    <label class="field"><span>Typ</span><select class="input" id="dfKind">${Object.entries(DOC_KIND).map(([k, v]) => `<option value="${k}"${d && d.kind === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="field"><span>Benämning</span><input class="input" id="dfTitle" maxlength="80" value="${esc(d ? d.title || '' : '')}" placeholder="Till exempel licens för älgstudsaren"></label>
    <div class="row2"><label class="field"><span>Nummer (valfritt)</span><input class="input" id="dfNum" maxlength="40" value="${esc(d ? d.num || '' : '')}" autocomplete="off"></label>
    <label class="field"><span>Giltig till (valfritt)</span><input class="input" type="date" id="dfValid" value="${esc(d ? d.valid || '' : '')}"></label></div>
    <label class="field"><span>Anteckning (valfri)</span><textarea class="input" id="dfNote" maxlength="500" rows="2">${esc(d ? d.note || '' : '')}</textarea></label>
    <div class="field"><span>Bilder och sidor (högst ${DOCS_MAX_IMGS})</span><div id="dfImgs" class="doc-imgs"></div>
      <div class="btnrow"><label class="btn sm">Ta bild<input type="file" accept="image/*" capture="environment" id="dfCam" hidden></label><label class="btn sm ghost">Välj fil (JPG, PNG eller PDF)<input type="file" accept="image/*,application/pdf,.pdf,.jpg,.jpeg,.png" id="dfFile" hidden></label></div>
      <p class="note" style="margin-top:4px">Ta bild sparar bilden bara här, inte i telefonens bildgalleri. En PDF sparas som en bild per sida. Väljer du en fil som redan finns i telefonen ligger den kvar där.</p></div>
    <div class="actions"><button class="btn primary grow" type="submit" id="dfSave">Spara</button>${d ? '<button class="btn danger" type="button" id="dfDel">Ta bort</button>' : ''}<button class="btn ghost" type="button" id="dfNo">Avbryt</button></div></div></form>`, m => {
    const draw = () => { m.querySelector('#dfImgs').innerHTML = imgs.map((src, i) => `<span class="doc-imgw"><img src="${esc(src)}" alt=""><button class="x" type="button" data-rm="${i}" aria-label="Ta bort bild ${i + 1}">×</button></span>`).join('') || '<span class="small muted">Ingen bild ännu.</span>'; };
    const add = async inp => {
      const f = inp.files && inp.files[0]; inp.value = ''; if(!f) return;
      const room = DOCS_MAX_IMGS - imgs.length; if(room <= 0){ toast(`Högst ${DOCS_MAX_IMGS} bilder och sidor per dokument.`); return; }
      const save = m.querySelector('#dfSave'); save.disabled = true;
      try {
        if(isPdf(f)){
          toast('Läser PDF:en …', 3000);
          const r = await docsPdf(f, room); imgs.push(...r.pages); draw();
          toast(r.total > r.pages.length ? `PDF:en har ${r.total} sidor. De första ${r.pages.length} sparas.` : `PDF:en är inläst: ${r.pages.length} ${r.pages.length === 1 ? 'sida' : 'sidor'}.`, 4000);
        } else if(/^image\//.test(f.type) || /\.(jpe?g|png|webp|gif)$/i.test(f.name || '')){ imgs.push(await docsImage(f)); draw(); }
        else toast('Filen stöds inte. Välj en bild (JPG eller PNG) eller en PDF.', 5000);
      } catch(e){ toast(isPdf(f) ? 'PDF:en kunde inte läsas. Är den skyddad med lösenord?' : 'Bilden kunde inte läsas. Spara den som JPG eller PNG och försök igen.', 5000); }
      finally { save.disabled = false; }
    };
    // Kameran lägger appen i bakgrunden en stund: lås inte då, annars försvinner bilden
    m.querySelectorAll('#dfCam, #dfFile').forEach(i => { i.closest('label').addEventListener('click', () => { docs.picking = Date.now(); }); i.addEventListener('change', e => { docs.picking = 0; docs.last = Date.now(); add(e.target); }); });
    m.querySelector('#dfImgs').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if(b){ imgs.splice(+b.dataset.rm, 1); draw(); } });
    m.querySelector('#dfNo').addEventListener('click', docsListView);
    const del = m.querySelector('#dfDel');
    if(del) del.addEventListener('click', () => confirmClick(del, 'Bekräfta', () => docsDel(d.id).then(() => { toast('Dokumentet är borttaget.'); docsListView(); }).catch(() => toast('Det gick inte att ta bort.'))));
    m.querySelector('#dfForm').addEventListener('submit', async e => {
      e.preventDefault();
      if(!docs.key){ toast('Dokumenten har låsts. Lås upp igen.'); docsUnlockForm(); return; }
      const v = {kind:m.querySelector('#dfKind').value, title:m.querySelector('#dfTitle').value.trim().slice(0, 80), num:m.querySelector('#dfNum').value.trim().slice(0, 40),
        valid:m.querySelector('#dfValid').value || '', note:m.querySelector('#dfNote').value.trim().slice(0, 500), imgs, created:d ? d.created || Date.now() : Date.now(), updated:Date.now()};
      if(d) v.id = d.id;
      m.querySelector('#dfSave').disabled = true;
      try { await docsSave(v); toast('Dokumentet är sparat på den här enheten.'); docsListView(); }
      catch(err){ m.querySelector('#dfSave').disabled = false; toast('Det gick inte att spara. Finns det utrymme kvar i telefonen?', 5000); }
    });
    draw();
  });
}
function docsPassForm(){
  openModal(`<h2>Byt dokumentlösen</h2><form id="dpForm">
    <label class="field"><span>Ny dokumentlösen (minst ${DOCS_MIN} tecken)</span><input class="input" type="password" id="dpPass" autocomplete="new-password"></label>
    <label class="field"><span>Samma igen</span><input class="input" type="password" id="dpPass2" autocomplete="new-password"></label>
    <div class="actions"><button class="btn primary grow" type="submit" id="dpOk">Byt</button><button class="btn ghost" type="button" id="dpNo">Avbryt</button></div></form>`, m => {
    m.querySelector('#dpNo').addEventListener('click', docsListView);
    m.querySelector('#dpForm').addEventListener('submit', async e => {
      e.preventDefault();
      const a = m.querySelector('#dpPass').value, b = m.querySelector('#dpPass2').value;
      if(a.length < DOCS_MIN){ toast(`Dokumentlösen måste ha minst ${DOCS_MIN} tecken.`); return; }
      if(a !== b){ toast('Lösenorden är inte lika.'); return; }
      if(!docs.key){ docsUnlockForm(); return; }
      m.querySelector('#dpOk').disabled = true;
      try { await docsRekey(a); toast('Dokumentlösen är bytt.'); docsListView(); } catch(err){ m.querySelector('#dpOk').disabled = false; toast('Det gick inte att byta.'); }
    });
  });
}
/* Lås när appen läggs undan, och efter en stund utan aktivitet */
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'hidden'){ if(!(docs.picking && Date.now() - docs.picking < DOCS_IDLE)) docsLock(); }
  else if(docs.picking) setTimeout(() => { docs.picking = 0; }, 4000);   // tillbaka utan bild (avbruten): vanlig låsning igen
});
['pointerdown', 'keydown'].forEach(t => document.addEventListener(t, () => { if(docs.key) docs.last = Date.now(); }, true));
setInterval(() => { if(docs.key && Date.now() - docs.last > DOCS_IDLE) docsLock(); }, 15000);
/* Påminnelse när appen startar: ett dokument går ut inom 30 dagar (en gång per dag, utan att visa vilket) */
function docsRemind(){
  if(!docsOk()) return;
  docsAll().then(recs => {
    const soon = recs.map(r => r.valid).filter(v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && daysTo(v) <= 30).sort();
    if(!soon.length || lsGet('jk.docsRemind') === todayISO()) return;
    lsSet('jk.docsRemind', todayISO());
    const n = daysTo(soon[0]);
    toast(n < 0 ? 'Ett av dina sparade dokument har gått ut. Öppna Mina dokument under Mitt konto.' : `Ett av dina sparade dokument går ut ${fmtDay(soon[0])}. Öppna Mina dokument under Mitt konto.`, 7000);
  }).catch(() => {});
}
setTimeout(docsRemind, 2500);
