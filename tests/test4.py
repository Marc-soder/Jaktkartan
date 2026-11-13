"""Vindriktning, kryss med avståndsringar och mätning."""
import json, os, sys, math
from playwright.sync_api import sync_playwright
from offline import offline
B = os.path.dirname(os.path.abspath(__file__)); APP = 'file://' + os.path.join(os.path.dirname(B), 'index.html')
CHROME = os.environ.get('CHROME_PATH') or None
tile = open(os.path.join(B, 'tile_osm.png'), 'rb').read(); fails = []; meteo = []
def check(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
def route(r):
    u = r.request.url
    if 'api.open-meteo.com' in u:
        meteo.append(u)
        return r.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'},
                         body=json.dumps({'current': {'time': '2026-11-13T07:00', 'wind_speed_10m': 4.2, 'wind_direction_10m': 225, 'wind_gusts_10m': 7.5}}))
    if offline(r): return
    if u.startswith('file:'): return r.continue_()
    return r.fulfill(status=200, body=tile, content_type='image/png')
lines = lambda pg, c: pg.evaluate("c => { let n=0; __fk.map.eachLayer(l => { if(l instanceof L.Polyline && !(l instanceof L.Polygon) && l.options.color === c) n++; }); return n; }", c)

with sync_playwright() as p:
    br = p.chromium.launch(executable_path=CHROME)
    for name, vp in (('desktop', dict(viewport={'width': 1280, 'height': 820})), ('mobil', dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True))):
        ctx = br.new_context(**vp); ctx.route('**/*', route); pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(APP); pg.wait_for_timeout(1200)
        pg.evaluate('__fk.map.setView([58.72, 14.61], 15, {animate:false})'); pg.wait_for_timeout(3000)

        # ---- Vind ----
        check(pg.is_visible('#windChip') and len(meteo) >= 1 and pg.locator('path.wind-sector').count() == 1, f'{name}: vinden är påslagen från början')
        pg.click('#btnLayers'); pg.wait_for_timeout(200)
        check(pg.is_checked('#popWind'), f'{name}: Vindriktning är ibockad från början')
        pg.uncheck('#popWind'); pg.wait_for_timeout(300)
        check(not pg.is_visible('#windChip') and pg.evaluate('__fk.state().settings.wind') is False, f'{name}: vinden går att stänga av och valet sparas')
        meteo.clear(); pg.evaluate('__fk.wind.data = null')
        pg.check('#popWind'); pg.wait_for_timeout(800)
        chip = pg.inner_text('#windChip')
        check(len(meteo) == 1 and 'current=wind_speed_10m,wind_direction_10m,wind_gusts_10m' in meteo[0] and 'wind_speed_unit=ms' in meteo[0], f'{name}: vinden hämtas från Open-Meteo i m/s')
        check(pg.is_visible('#windChip') and 'SV' in chip and '4,2 m/s' in chip and 'byar 7,5' in chip, f'{name}: vindetiketten visar riktning, styrka och byar: {chip}')
        check('Vind från SV' in pg.inner_text('#windNote'), f'{name}: lagermenyn visar vinden: {pg.inner_text("#windNote")}')
        lp = pg.evaluate("(() => { const p = document.getElementById('layerPop'), r = p.getBoundingClientRect(); p.scrollTop = 9999; return {bottom:r.bottom, vh:innerHeight, scroll:p.scrollTop, over:p.scrollHeight > p.clientHeight}; })()")
        check(lp['bottom'] <= lp['vh'] and (not lp['over'] or lp['scroll'] > 0), f'{name}: lagermenyn får plats på skärmen och går att scrolla ({lp})')
        pg.keyboard.press('Escape')
        sec = pg.evaluate("(() => { const s = __fk.wind.sector; return {axis:s.axis, half:s.half, o:s.o, far:s.pts[Math.floor(s.pts.length / 2)]}; })()")
        b = pg.evaluate("([a, f]) => __fk.bearingDeg(L.latLng(a.lat, a.lng), L.latLng(f.lat, f.lng))", [sec['o'], sec['far']])
        d = pg.evaluate("([a, f]) => __fk.distM(a, f)", [sec['o'], sec['far']])
        check(abs(sec['axis'] - 45) < 1e-9 and abs(b - 45) < 1 and abs(d - 600) < 10 and sec['half'] == 20, f'{name}: vind från SV ger ett område mot NO, 600 m långt (riktning {b:.1f}°, {d:.0f} m)')
        cross = pg.evaluate('__fk.map.getCenter()')
        check(abs(sec['o']['lat'] - cross['lat']) < 1e-6 and abs(sec['o']['lng'] - cross['lng']) < 1e-6, f'{name}: utan känd position utgår området från kartans mitt')
        check(pg.locator('path.wind-sector').count() == 1, f'{name}: det gula området ritas')
        # pilarna rör sig
        f0 = pg.evaluate('__fk.wind.frames || 0'); h0 = pg.evaluate("(() => { const c = document.querySelector('canvas.wind-arrows'); return c.toDataURL().length + ':' + c.toDataURL().slice(-200); })()")
        pg.wait_for_timeout(400)
        f1 = pg.evaluate('__fk.wind.frames || 0'); h1 = pg.evaluate("(() => { const c = document.querySelector('canvas.wind-arrows'); return c.toDataURL().length + ':' + c.toDataURL().slice(-200); })()")
        check(f1 > f0 + 3 and h0 != h1, f'{name}: pilarna ritas om och rör sig ({f1 - f0} bilder på 0,4 s)')
        px = pg.evaluate("""(() => { const c = document.querySelector('canvas.wind-arrows'), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data;
            let n = 0, a = 0; for(let i = 3; i < d.length; i += 4){ if(d[i]){ n++; a = Math.max(a, d[i]); } } return {n, a, blue: d.findIndex((v, i) => i % 4 === 2 && v > 150 && d[i + 1] > 0)}; })()""")
        op = pg.evaluate("getComputedStyle(document.querySelector('canvas.wind-arrows')).opacity")
        check(px['n'] > 200 and 0.4 <= float(op) <= 0.7, f'{name}: blå pilar ritas, lite genomskinliga (genomskinlighet {op})')
        # med känd position utgår området från den
        pg.evaluate('__fk.showMe(58.7200, 14.6000, 8)'); pg.wait_for_timeout(300)
        o = pg.evaluate('__fk.wind.sector.o')
        check(abs(o['lat'] - 58.72) < 1e-9 and abs(o['lng'] - 14.60) < 1e-9, f'{name}: med känd position utgår området från den')
        pg.click('#btnLayers'); pg.wait_for_timeout(200); pg.uncheck('#popWind'); pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
        check(not pg.is_visible('#windChip') and pg.locator('path.wind-sector').count() == 0 and pg.evaluate("document.querySelector('canvas.wind-arrows').hidden"), f'{name}: vinden går att stänga av')

        # ---- Kryss med avståndsringar ----
        pg.evaluate('__fk.map.panBy([60, 40], {animate:false})'); pg.wait_for_timeout(200)
        check(pg.is_visible('.pancross .pc-x') and pg.locator('.pc-ring').count() == 3, f'{name}: krysset med tre avståndsringar visas när kartan flyttas')
        mb = pg.locator('#map').bounding_box(); xb = pg.locator('.pc-x').bounding_box()
        check(abs(xb['x'] + xb['width'] / 2 - (mb['x'] + mb['width'] / 2)) < 2 and abs(xb['y'] + xb['height'] / 2 - (mb['y'] + mb['height'] / 2)) < 2, f'{name}: krysset sitter mitt på kartan')
        rl = pg.locator('.pc-rl').all_inner_texts()
        # ringarnas radie ska stämma med kartans skala: avståndet till en punkt på ringen = etiketten
        ok = pg.evaluate("""(() => { const r = document.querySelectorAll('.pc-ring')[0], b = r.getBoundingClientRect(), c = __fk.map.getContainer().getBoundingClientRect();
            const ctr = __fk.map.containerPointToLatLng([b.left + b.width / 2 - c.left, b.top + b.height / 2 - c.top]), edge = __fk.map.containerPointToLatLng([b.right - c.left, b.top + b.height / 2 - c.top]);
            return __fk.distM(ctr, edge); })()""")
        lab = rl[0].replace(' ', ' ')
        want = float(lab.split()[0].replace(',', '.')) * (1000 if 'km' in lab else 1)
        check(abs(ok - want) / want < 0.03, f'{name}: första ringen är {lab} (uppmätt {ok:.0f} m)')
        lbl = pg.inner_text('.pc-label'); dist = pg.evaluate('__fk.distM({lat:58.72, lng:14.60}, __fk.map.getCenter())')
        check(lbl.startswith(pg.evaluate("m => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toLocaleString('sv-SE', {maximumFractionDigits: m < 10000 ? 1 : 0})} km`).replace(/\u00a0/g, ' ')", dist)), f'{name}: avståndet från dig gäller punkten i mitten')
        check('från dig' in lbl, f'{name}: avståndet från din position visas: {lbl} (exakt {dist:.0f} m)')
        pg.wait_for_timeout(3000)
        check(not pg.is_visible('.pancross .pc-x'), f'{name}: krysset försvinner en stund efter att kartan stannat')
        pg.click('#btnAdd'); pg.wait_for_timeout(400); pg.evaluate('__fk.map.panBy([30, 0], {animate:false})'); pg.wait_for_timeout(200)
        check(not pg.is_visible('.pancross .pc-x'), f'{name}: inget extra kryss när man placerar en nål')
        pg.click('#placeCancel'); pg.wait_for_timeout(300)

        # ---- Mäta ----
        pg.click('#btnMeasure'); pg.wait_for_timeout(500)
        check(pg.is_visible('#measurebar') and pg.is_visible('.pancross .pc-x') and pg.get_attribute('#btnMeasure', 'aria-pressed') == 'true' and pg.is_disabled('#mUndo'), f'{name}: mätläget öppnas med kryss')
        cp = pg.evaluate('__fk.crossPoint()'); mb = pg.locator('#map').bounding_box(); xb = pg.locator('.pc-x').bounding_box(); bb = pg.locator('#measurebar').bounding_box()
        check(abs(xb['y'] + xb['height'] / 2 - (mb['y'] + cp['y'])) < 2 and xb['y'] + xb['height'] < bb['y'], f'{name}: i mätläget ligger krysset ovanför mätfältet')
        a = pg.evaluate('__fk.crossLatLng()'); pg.click('#mAdd'); pg.wait_for_timeout(150)
        pg.evaluate('__fk.map.panBy([120, -80], {animate:false})'); pg.wait_for_timeout(200)
        c = pg.evaluate('__fk.crossLatLng()'); d1 = pg.evaluate('([a, b]) => __fk.distM(a, b)', [a, c])
        txt = pg.inner_text('#measureText').replace(' ', ' ')
        check(lines(pg, '#d9520e') >= 2, f'{name}: linje från punkten till krysset')
        def fmt(m): return pg.evaluate('m => fmtDistForTest(m)', m) if False else None
        want = pg.evaluate("m => { const f = m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toLocaleString('sv-SE', {maximumFractionDigits: m < 10000 ? 1 : 0})} km`; return f.replace(/\\u00a0/g, ' '); }", d1)
        check(want in txt, f'{name}: avståndet till krysset visas: {txt.splitlines()[0]} (väntat {want})')
        pg.click('#mAdd'); pg.wait_for_timeout(150)
        pg.evaluate('__fk.map.panBy([-60, 100], {animate:false})'); pg.wait_for_timeout(200)
        m = pg.evaluate('__fk.measure().pts.map(p => ({lat:p.lat, lng:p.lng}))'); e = pg.evaluate('__fk.crossLatLng()')
        tot = pg.evaluate('([a, b]) => __fk.distM(a, b)', [m[0], m[1]])
        check(len(m) == 2 and abs(tot - d1) < 0.5 and 'mellan punkterna' in pg.inner_text('#measureText'), f'{name}: två punkter, avståndet mellan dem {tot:.0f} m')
        pg.click('#mUndo'); pg.wait_for_timeout(100)
        check(len(pg.evaluate('__fk.measure().pts')) == 1, f'{name}: Ångra tar bort den senaste punkten')
        pg.wait_for_timeout(3000)
        check(pg.is_visible('.pancross .pc-x'), f'{name}: krysset ligger kvar i mätläget')
        pg.evaluate('__fk.map.fire("contextmenu", {latlng: __fk.map.getCenter()})'); pg.wait_for_timeout(200)
        check(not pg.is_visible('#pinForm'), f'{name}: långt tryck i mätläget öppnar inte nålformuläret')
        pg.click('#mClose'); pg.wait_for_timeout(300)
        check(pg.is_hidden('#measurebar') and pg.evaluate('__fk.measure()') is None and lines(pg, '#d9520e') == 0 and not pg.is_visible('.pancross .pc-x'), f'{name}: Klar stänger mätningen och tar bort linjen')
        check(not errs, f'{name}: inga JS-fel {errs[:2]}')
        ctx.close()
    br.close()
print('\n' + ('ALLA OK' if not fails else f'{len(fails)} FEL: ' + '; '.join(fails)))
sys.exit(1 if fails else 0)
