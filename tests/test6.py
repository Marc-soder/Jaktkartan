"""Mina dokument: krypterade och sparade bara på enheten.
Körs mot en lokal webbserver (krypteringen kräver en säker sida), utan riktigt nätverk.
Kontrollerar att inget skickas någonstans, att inget ligger i klartext i webbläsarens lagring, och upplåsning och låsning."""
import functools, http.server, os, sys, threading
from playwright.sync_api import sync_playwright
from offline import offline

B = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(B)
CHROME = os.environ.get('CHROME_PATH') or None
IMG = os.path.join(B, 'tile_osm.png')
fails = []

def nav(pg, tab):
    """Sidomenyn: öppna menyn och välj en sida."""
    pg.click('#btnMenu'); pg.wait_for_timeout(100); pg.click(f'#tab-{tab}'); pg.wait_for_timeout(100)

def check(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: fails.append(m)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
PORT = srv.server_address[1]
APP = f'http://localhost:{PORT}/index.html'
PASS, PASS2 = 'Älgjakt i Tiveden 2026', 'Ett annat långt lösen'

def make_pdf(pages):
    """En liten PDF med en rad stor svart text per sida (Helvetica, som inte bäddas in: pdf.js hämtar ett standardtypsnitt)."""
    objs = ['<< /Type /Catalog /Pages 2 0 R >>', None, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    kids = []
    for text in pages:
        stream = f'BT /F1 48 Tf 40 300 Td ({text}) Tj ET 0 0 0 rg 40 100 300 120 re f'.encode()
        objs.append(f'<< /Length {len(stream)} >>\nstream\n'.encode() + stream + b'\nendstream')
        objs.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 420] /Resources << /Font << /F1 3 0 R >> >> /Contents {len(objs)} 0 R >>')
        kids.append(f'{len(objs)} 0 R')
    objs[1] = f'<< /Type /Pages /Kids [{" ".join(kids)}] /Count {len(kids)} >>'
    out, offs = bytearray(b'%PDF-1.4\n'), []
    for i, o in enumerate(objs, 1):
        offs.append(len(out)); out += f'{i} 0 obj\n'.encode() + (o if isinstance(o, bytes) else o.encode()) + b'\nendobj\n'
    x = len(out)
    out += f'xref\n0 {len(objs) + 1}\n0000000000 65535 f \n'.encode() + b''.join(f'{o:010d} 00000 n \n'.encode() for o in offs)
    out += f'trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{x}\n%%EOF\n'.encode()
    return bytes(out)
# Andel mörka punkter i en bild (data-URL): visar att PDF-sidan verkligen ritades, inte bara en vit yta
DARK = """src => new Promise(res => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight;
  const x = c.getContext('2d'); x.drawImage(i, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0; for(let k = 0; k < d.length; k += 4) if(d[k] < 80 && d[k+1] < 80 && d[k+2] < 80) n++;
  res({w:c.width, h:c.height, dark:n / (d.length / 4)}); }; i.src = src; })"""

net = []   # allt som sidan försöker skicka utanför den lokala servern: (metod, adress, innehåll)
SECRETS = ('älgstudsaren', 'LIC-4711', 'vapenskåpet', 'Älgjakt i Tiveden', 'annat långt lösen', 'data:image', 'VAPENLICENS')
def route(r):
    u = r.request.url
    if u.startswith(f'http://127.0.0.1:{PORT}/') or u.startswith(f'http://localhost:{PORT}/'): return r.continue_()
    if offline(r): return
    return r.abort()

# Det som ligger sparat i webbläsaren, som text (för att leta efter klartext)
RAW = """() => new Promise(res => { const o = indexedDB.open('jk-docs'); o.onsuccess = () => { const db = o.result;
  if(!db.objectStoreNames.contains('docs')){ db.close(); res(''); return; }
  const tx = db.transaction(['docs', 'meta']), a = tx.objectStore('docs').getAll(), b = tx.objectStore('meta').getAll();
  tx.oncomplete = () => { const dec = x => x instanceof Uint8Array ? Array.from(x).map(c => String.fromCharCode(c)).join('') : x;
    res(JSON.stringify([a.result, b.result], (k, v) => v instanceof Uint8Array ? dec(v) : v) + JSON.stringify(Object.assign({}, localStorage))); db.close(); }; }; })"""

with sync_playwright() as p:
    br = p.chromium.launch(executable_path=CHROME)
    ctx = br.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    ctx.route('**/*', route)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(APP); pg.wait_for_timeout(1200)
    def watch(req):
        if not (req.url.startswith(f'http://localhost:{PORT}/') or req.url.startswith('data:') or req.url.startswith('blob:')): net.append((req.method, req.url, req.post_data or ''))
    pg.on('request', watch)

    nav(pg, 'konto'); pg.wait_for_timeout(200)
    check(pg.is_visible('#docsOpenBtn') and 'bara på den här enheten' in pg.inner_text('#paneKonto'), 'Mitt konto har Mina dokument, även utan inloggning')
    pg.click('#docsOpenBtn'); pg.wait_for_timeout(300)
    check(pg.is_visible('#dsPass') and 'Glömmer du dokumentlösen' in pg.inner_text('.modal'), 'första gången väljer man en dokumentlösen, med varning om att den inte går att få tillbaka')
    pg.fill('#dsPass', 'kort'); pg.fill('#dsPass2', 'kort'); pg.click('#dsOk'); pg.wait_for_timeout(300)
    check(pg.is_visible('#dsPass') and 'minst 8 tecken' in pg.inner_text('#toast'), 'för kort dokumentlösen nekas')
    pg.fill('#dsPass', PASS); pg.fill('#dsPass2', PASS + 'x'); pg.click('#dsOk'); pg.wait_for_timeout(300)
    check(pg.is_visible('#dsPass') and 'inte lika' in pg.inner_text('#toast'), 'olika lösen nekas')
    pg.fill('#dsPass2', PASS); pg.click('#dsOk'); pg.wait_for_timeout(2500)
    check(pg.is_visible('#docsBox') and 'Inga dokument ännu' in pg.inner_text('#docsBox'), 'dokumentlösen är skapad och listan är öppen')

    # Lägg till en vapenlicens med bild
    pg.click('[data-dc="add"]'); pg.wait_for_timeout(200)
    check(pg.get_attribute('#dfCam', 'capture') == 'environment', 'Ta bild öppnar kameran direkt')
    pg.select_option('#dfKind', 'licens'); pg.fill('#dfTitle', 'Licens för älgstudsaren'); pg.fill('#dfNum', 'LIC-4711')
    soon = pg.evaluate("(() => { const d = new Date(); d.setDate(d.getDate() + 10); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })()")
    pg.fill('#dfValid', soon); pg.fill('#dfNote', 'Förvaras i vapenskåpet')
    pg.set_input_files('#dfFile', IMG); pg.wait_for_timeout(600)
    check(pg.locator('#dfImgs img').count() == 1, 'bilden är vald')
    # PDF med två sidor, och en JPG
    pg.set_input_files('#dfFile', files=[{'name':'licens.pdf', 'mimeType':'application/pdf', 'buffer':make_pdf(['VAPENLICENS 4711', 'Sida 2'])}])
    for _ in range(40):
        if pg.locator('#dfImgs img').count() >= 3: break
        pg.wait_for_timeout(250)
    check(pg.locator('#dfImgs img').count() == 3 and 'inläst: 2 sidor' in pg.inner_text('#toast'), f'en PDF med två sidor blir två bilder ({pg.inner_text("#toast")!r})')
    pages = [pg.evaluate(DARK, pg.get_attribute(f'#dfImgs .doc-imgw:nth-child({i}) img', 'src')) for i in (2, 3)]
    check(all(x['w'] > 1000 and 0.01 < x['dark'] < 0.5 for x in pages), f'PDF-sidorna är ritade med text och ruta, i god upplösning: {pages}')
    jpg = __import__('base64').b64decode(pg.evaluate("(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 250; const x = c.getContext('2d'); x.fillStyle = '#2a5'; x.fillRect(0, 0, 400, 250); return c.toDataURL('image/jpeg', 0.9).split(',')[1]; })()"))
    pg.set_input_files('#dfFile', files=[{'name':'jaktkort.jpg', 'mimeType':'image/jpeg', 'buffer':jpg}]); pg.wait_for_timeout(600)
    check(pg.locator('#dfImgs img').count() == 4, 'en JPG-fil går att välja')
    pg.set_input_files('#dfFile', files=[{'name':'anteckning.txt', 'mimeType':'text/plain', 'buffer':b'hej'}]); pg.wait_for_timeout(400)
    check(pg.locator('#dfImgs img').count() == 4 and 'stöds inte' in pg.inner_text('#toast'), 'en fil som inte är bild eller PDF nekas')
    check(pg.get_attribute('#dfFile', 'accept').count('pdf') >= 1, 'Välj fil tar emot PDF')
    pg.click('#dfImgs [data-rm="3"]'); pg.click('#dfImgs [data-rm="2"]'); pg.wait_for_timeout(100)
    check(pg.locator('#dfImgs img').count() == 2, 'bilder och sidor går att ta bort före sparning')
    pg.click('#dfSave'); pg.wait_for_timeout(800)
    txt = pg.inner_text('#docsBox')
    check('Licens för älgstudsaren' in txt and 'Vapenlicens · LIC-4711' in txt and 'om 10 dagar' in txt and pg.locator('.doc-thumb img').count() == 1, f'dokumentet syns i listan, med att det snart går ut: {txt[:120]!r}')
    raw = pg.evaluate(RAW)
    check(len(raw) > 1000 and 'älgstudsaren' not in raw and 'LIC-4711' not in raw and 'vapenskåpet' not in raw and 'data:image' not in raw and PASS not in raw, 'inget i webbläsarens lagring är i klartext: varken text, bild eller lösen')
    check(soon in raw, 'bara giltighetsdatumet ligger okrypterat, för påminnelsen')

    # Visa
    pg.click('.doc-row [data-dc="view"] >> nth=1'); pg.wait_for_timeout(300)
    check(pg.locator('.doc-img').count() == 2 and pg.get_attribute('.doc-img', 'src').startswith('data:image/jpeg') and 'Förvaras i vapenskåpet' in pg.inner_text('.modal'), 'Visa öppnar dokumentet med bilden')
    pg.click('#dvBack'); pg.wait_for_timeout(200)

    # Lås, fel lösen, rätt lösen
    pg.click('[data-dc="lock"]'); pg.wait_for_timeout(300)
    check(not pg.is_visible('.modal') and pg.evaluate('__fk.docs.key') is None and pg.evaluate('__fk.docs.list.length') == 0 and pg.locator('img[src^="data:image/jpeg"]').count() == 0, 'Lås: nyckeln, dokumenten och bilderna är borta från minnet och skärmen')
    pg.click('#docsOpenBtn'); pg.wait_for_timeout(300)
    pg.fill('#duPass', 'fel lösen helt'); pg.click('#duOk'); pg.wait_for_timeout(2500)
    check(pg.is_visible('#duPass') and 'Fel dokumentlösen' in pg.inner_text('#duMsg') and pg.evaluate('__fk.docs.key') is None, 'fel dokumentlösen låser inte upp')
    pg.fill('#duPass', PASS); pg.click('#duOk'); pg.wait_for_timeout(2500)
    check(pg.is_visible('#docsBox') and 'Licens för älgstudsaren' in pg.inner_text('#docsBox'), 'rätt dokumentlösen låser upp')

    # Låses när appen läggs undan
    pg.evaluate("(() => { Object.defineProperty(document, 'visibilityState', {value:'hidden', configurable:true}); document.dispatchEvent(new Event('visibilitychange')); delete document.visibilityState; })()"); pg.wait_for_timeout(300)
    check(pg.evaluate('__fk.docs.key') is None and not pg.is_visible('#docsBox'), 'dokumenten låses när appen läggs undan')
    # ... men inte när kameran öppnas för en bild
    pg.click('#docsOpenBtn'); pg.wait_for_timeout(300); pg.fill('#duPass', PASS); pg.click('#duOk'); pg.wait_for_timeout(2500)
    pg.click('[data-dc="add"]'); pg.wait_for_timeout(200)
    pg.evaluate("document.querySelector('#dfCam').closest('label').dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}))")
    pg.evaluate("(() => { Object.defineProperty(document, 'visibilityState', {value:'hidden', configurable:true}); document.dispatchEvent(new Event('visibilitychange')); delete document.visibilityState; })()"); pg.wait_for_timeout(300)
    check(pg.evaluate('__fk.docs.key') is not None and pg.is_visible('#dfForm'), 'medan kameran är öppen låses inte dokumenten, så bilden kommer fram')
    pg.click('#dfNo'); pg.wait_for_timeout(200)
    # ... och efter fem minuter utan aktivitet
    pg.evaluate('__fk.docs.last = Date.now() - 6 * 60000'); pg.wait_for_timeout(16000)
    check(pg.evaluate('__fk.docs.key') is None and not pg.is_visible('#docsBox'), 'dokumenten låses efter fem minuter utan aktivitet')

    # Byt dokumentlösen
    pg.click('#docsOpenBtn'); pg.wait_for_timeout(300); pg.fill('#duPass', PASS); pg.click('#duOk'); pg.wait_for_timeout(2500)
    pg.click('[data-dc="pass"]'); pg.wait_for_timeout(200); pg.fill('#dpPass', PASS2); pg.fill('#dpPass2', PASS2); pg.click('#dpOk'); pg.wait_for_timeout(3000)
    check(pg.is_visible('#docsBox') and 'Licens för älgstudsaren' in pg.inner_text('#docsBox'), 'dokumentlösen är bytt och dokumentet finns kvar')
    pg.click('[data-dc="lock"]'); pg.wait_for_timeout(200)
    pg.click('#docsOpenBtn'); pg.wait_for_timeout(300); pg.fill('#duPass', PASS); pg.click('#duOk'); pg.wait_for_timeout(2500)
    check('Fel dokumentlösen' in pg.inner_text('#duMsg'), 'den gamla dokumentlösen fungerar inte längre')
    pg.fill('#duPass', PASS2); pg.click('#duOk'); pg.wait_for_timeout(2500)
    check('Licens för älgstudsaren' in pg.inner_text('#docsBox'), 'den nya dokumentlösen låser upp')

    # Påminnelse vid start (utan att säga vilket dokument)
    pg.evaluate("localStorage.removeItem('jk.docsRemind')")
    pg.reload(); pg.wait_for_timeout(3500)
    t = pg.inner_text('#toast')
    check('går ut' in t and 'älgstudsaren' not in t and 'Licens' not in t, f'påminnelse när appen startar, utan att visa vilket dokument: {t!r}')
    check(pg.evaluate('__fk.docs.key') is None, 'efter omstart är dokumenten låsta')

    # Ta bort, och glömt lösen
    nav(pg, 'konto'); pg.click('#docsOpenBtn'); pg.wait_for_timeout(300); pg.fill('#duPass', PASS2); pg.click('#duOk'); pg.wait_for_timeout(2500)
    pg.click('.doc-row [data-dc="edit"]'); pg.wait_for_timeout(200); pg.click('#dfDel'); pg.click('#dfDel'); pg.wait_for_timeout(600)
    check('Inga dokument ännu' in pg.inner_text('#docsBox') and pg.evaluate("new Promise(r => { const o = indexedDB.open('jk-docs'); o.onsuccess = () => { const q = o.result.transaction('docs').objectStore('docs').count(); q.onsuccess = () => { r(q.result); o.result.close(); }; }; })") == 0, 'dokumentet går att ta bort')
    pg.click('[data-dc="lock"]'); pg.wait_for_timeout(200); pg.click('#docsOpenBtn'); pg.wait_for_timeout(300)
    pg.click('#duForgot'); pg.wait_for_timeout(200); pg.click('#dfWipe'); pg.click('#dfWipe'); pg.wait_for_timeout(600)
    check(pg.is_visible('#dsPass'), 'glömt dokumentlösen: allt raderas och man väljer en ny')

    # Inget har skickats någonstans, och dokumenten är inte med i Data-exporten
    # Appens vanliga hämtningar (typsnitt, vind, Firebase-biblioteket) får finnas, men inget får skickas med innehåll,
    # och inget från dokumenten får finnas i någon adress
    sent = [n for n in net if n[0] != 'GET' or n[2] or any(x.lower() in (n[1] + n[2]).lower() for x in SECRETS)]
    check(not sent, f'inget från dokumenten skickades till nätet under hela testet ({len(net)} vanliga hämtningar): {sent[:3]}')
    check('docs' not in pg.evaluate("JSON.stringify(Object.keys(__fk.state()))"), 'dokumenten är inte en del av appens vanliga data (som kan synkas och exporteras)')
    check(not errs, f'inga JS-fel {errs[:2]}')
    br.close()
srv.shutdown()
print('\n' + ('ALLA OK' if not fails else f'{len(fails)} FEL: ' + '; '.join(fails)))
sys.exit(1 if fails else 0)
