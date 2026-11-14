"""Offline: service workern sparar appen och de kartrutor man har tittat på, och appen startar utan täckning.
Körs mot en lokal webbserver (service workers kräver http/https), utan riktigt nätverk."""
import functools, http.server, os, sys, threading
# Låt testerna fånga upp service workerns nätverksanrop (kartrutorna), så att de kan få låtsassvar
os.environ.setdefault('PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS', '1')
from playwright.sync_api import sync_playwright
from offline import offline

B = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(B)
CHROME = os.environ.get('CHROME_PATH') or None
tile = open(os.path.join(B, 'tile_osm.png'), 'rb').read(); fails = []
def check(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: fails.append(m)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
PORT = srv.server_address[1]
TILES = ('tile.openstreetmap.org', 'tile.opentopomap.org', 'server.arcgisonline.com')

def route(r):
    u = r.request.url
    if u.startswith(f'http://127.0.0.1:{PORT}/') or u.startswith(f'http://localhost:{PORT}/'): return r.continue_()
    if any(h in u for h in TILES): return r.fulfill(status=200, body=tile, content_type='image/png', headers={'Access-Control-Allow-Origin': '*'})
    if offline(r): return
    return r.abort()

with sync_playwright() as p:
    br = p.chromium.launch(executable_path=CHROME)
    ctx = br.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, service_workers='allow')
    ctx.route('**/*', route)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    app = f'http://localhost:{PORT}/index.html?sw=1'
    pg.goto(app); pg.wait_for_timeout(1500)
    ready = pg.evaluate("navigator.serviceWorker.ready.then(r => !!r.active)")
    pg.reload(); pg.wait_for_timeout(1500)
    check(ready and pg.evaluate("!!navigator.serviceWorker.controller"), 'service workern är installerad och styr sidan')
    man = pg.evaluate("fetch('manifest.webmanifest').then(r => r.json())")
    check(man['name'] == 'Jaktkartan' and man['display'] == 'standalone' and any(i['purpose'] == 'maskable' for i in man['icons']), 'manifestet gör att appen kan installeras på hemskärmen')
    check(pg.evaluate("document.querySelector('link[rel=manifest]').getAttribute('href')") == 'manifest.webmanifest', 'sidan länkar till manifestet')
    pg.evaluate("__fk.map.setView([58.72, 14.6], 14, {animate:false})"); pg.wait_for_timeout(1500)
    n = pg.evaluate("caches.open('jk-tiles-v1').then(c => c.keys()).then(k => k.length)")
    check(n > 0, f'kartrutor som visats sparas ({n} st)')
    shell = pg.evaluate("caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('jk-app-')).map(k => caches.open(k).then(c => c.keys())))).then(a => a.flat().map(r => new URL(r.url).pathname))")
    check(any(s.endswith('/index.html') for s in shell) and any(s.endswith('icon-192.png') for s in shell), f'appen är sparad ({len(shell)} filer)')
    check(pg.is_hidden('#netBar'), 'med täckning visas ingen varning')

    # Utan täckning
    ctx.set_offline(True); pg.wait_for_timeout(300)
    check(pg.is_visible('#netBar'), 'utan täckning visas en rad om det')
    pg.reload(); pg.wait_for_timeout(2000)
    loaded = pg.evaluate("[...document.querySelectorAll('img.leaflet-tile')].filter(i => i.complete && i.naturalWidth > 0).length")
    check(pg.title() == 'Jaktkartan' and pg.is_visible('#map') and pg.locator('.pin-icon').count() > 0, 'appen startar utan täckning, med nålarna')
    check(loaded > 0, f'kartan visas från de sparade rutorna utan täckning ({loaded} rutor)')
    check(pg.is_visible('#netBar') and 'Ingen täckning' in pg.inner_text('#netBar'), 'raden om att täckning saknas visas efter omstart')
    ctx.set_offline(False); pg.wait_for_timeout(500)
    check(pg.is_hidden('#netBar'), 'när täckningen kommer tillbaka försvinner raden')
    check(not errs, f'inga JS-fel {errs[:2]}')
    br.close()
srv.shutdown()
print('\n' + ('ALLA OK' if not fails else f'{len(fails)} FEL: ' + '; '.join(fails)))
sys.exit(1 if fails else 0)
