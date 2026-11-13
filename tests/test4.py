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

        # ---- Riktningen jag tittar åt ----
        pg.evaluate('__fk.showMe(58.7200, 14.6000, 8)'); pg.wait_for_timeout(200)
        check(pg.locator('.me-icon .me-cone').count() == 1 and not pg.is_visible('.me-icon .me-cone'), f'{name}: ingen riktningspil innan kompassen ger något')
        pg.evaluate('__fk.startCompass()')
        pg.evaluate("window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', {alpha: 90, beta: 0, gamma: 0, absolute: true}))"); pg.wait_for_timeout(200)
        rot = pg.evaluate("document.querySelector('.me-icon .me-cone').style.transform")
        check(pg.is_visible('.me-icon .me-cone') and rot == 'rotate(270deg)', f'{name}: Android-kompass (alpha 90) ger en pil mot väster: {rot}')
        pg.evaluate("(() => { const e = new Event('deviceorientation'); Object.defineProperty(e, 'webkitCompassHeading', {value: 45}); window.dispatchEvent(e); })()"); pg.wait_for_timeout(200)
        rot = pg.evaluate("document.querySelector('.me-icon .me-cone').style.transform")
        check(rot == 'rotate(45deg)', f'{name}: iPhone-kompass (45°) ger en pil mot nordost: {rot}')
        pg.evaluate('__fk.showMe(58.7201, 14.6001, 8)'); pg.wait_for_timeout(150)
        check(pg.evaluate("document.querySelector('.me-icon .me-cone').style.transform") == 'rotate(45deg)', f'{name}: pilen ligger kvar när positionen uppdateras')

        # ---- Kryss med avståndsringar (utan känd position) ----
        pg.evaluate('__fk.forgetMe()')
        check(pg.locator('path.me-ring').count() == 0, f'{name}: inga ringar runt mig utan känd position')
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
        check(not pg.is_visible('.pc-label') and pg.evaluate('__fk.panLine()') is None, f'{name}: utan position ingen linje och inget avstånd från dig')
        pg.wait_for_timeout(3000)
        # ---- Med känd position: linje från mig till krysset i stället för ringar ----
        pg.evaluate('__fk.map.setView([58.7200, 14.6000], 16, {animate:false})')
        pg.evaluate('__fk.showMe(58.7200, 14.6000, 8)'); pg.wait_for_timeout(200)
        pg.evaluate('__fk.map.panBy([70, -90], {animate:false})'); pg.wait_for_timeout(200)
        check(pg.is_visible('.pancross .pc-x') and pg.locator('.pc-ring').count() == 0, f'{name}: med känd position visas krysset utan avståndsringar')
        ln = pg.evaluate("(() => { const l = __fk.panLine(); if(!l) return null; const p = l.getLatLngs(), c = __fk.crossLatLng(); return {a:[p[0].lat, p[0].lng], b:[p[1].lat - c.lat, p[1].lng - c.lng], dash:l.options.dashArray, w:l.options.weight, vis:!!l._path && l._path.isConnected}; })()")
        check(ln is not None and ln['a'] == [58.72, 14.6] and max(abs(ln['b'][0]), abs(ln['b'][1])) < 1e-9 and ln['vis'], f'{name}: linjen går från min position till krysset {ln}')
        check(ln is not None and ln['dash'] and ln['w'] <= 2, f'{name}: linjen är tunn och streckad {ln and (ln["dash"], ln["w"])}')
        lbl = pg.inner_text('.pc-label').replace('\u00a0', ' '); dist = pg.evaluate('__fk.distM({lat:58.72, lng:14.60}, __fk.crossLatLng())')
        check(lbl.startswith(f'{round(dist)} m från dig'), f'{name}: avståndet visas i hela meter: {lbl} (exakt {dist:.1f} m)')
        fd = [pg.evaluate('m => __fk.fmtDist(m).replace(/\u00a0/g, " ")', m) for m in (7.4, 347.6, 1234.2, 9999.4, 12345)]
        check(fd == ['7 m', '348 m', '1 234 m', '9 999 m', '12,3 km'], f'{name}: avstånd avrundas till hela meter {fd}')
        pg.wait_for_timeout(3000)
        check(not pg.is_visible('.pancross .pc-x') and pg.evaluate('__fk.panLine()') is None, f'{name}: krysset och linjen försvinner en stund efter att kartan stannat')
        # ---- Avståndsringar runt min position, hela tiden ----
        r16 = pg.evaluate('__fk.meRings()')
        check(len(r16) >= 2 and max(r16) <= 500 and pg.locator('path.me-ring').count() == len(r16), f'{name}: ringar runt min position ligger kvar när krysset försvunnit {r16}')
        ring = pg.evaluate("""(() => { const p = document.querySelector('path.me-ring').getBoundingClientRect(), c = __fk.map.getContainer().getBoundingClientRect();
            const ctr = __fk.map.containerPointToLatLng([p.left + p.width / 2 - c.left, p.top + p.height / 2 - c.top]), edge = __fk.map.containerPointToLatLng([p.right - c.left, p.top + p.height / 2 - c.top]);
            return {d: __fk.distM({lat:58.72, lng:14.60}, ctr), r: __fk.distM(ctr, edge)}; })()""")
        check(ring['d'] < 3 and abs(ring['r'] - r16[0]) / r16[0] < 0.05, f'{name}: första ringen ligger runt min position med rätt radie {ring} (väntat {r16[0]} m)')
        labels = [t.replace(' ', ' ') for t in pg.locator('.me-rl').all_inner_texts()]
        check(labels == [f'{r} m' for r in r16], f'{name}: ringarna har avstånd utskrivet {labels}')
        pg.evaluate('__fk.map.setZoom(18, {animate:false})'); pg.wait_for_timeout(200)
        r18 = pg.evaluate('__fk.meRings()')
        pg.evaluate('__fk.map.setZoom(13, {animate:false})'); pg.wait_for_timeout(200)
        r13 = pg.evaluate('__fk.meRings()')
        check(max(r18) < max(r16) and r18[0] < r16[0] and r13 and max(r13) == 500 and r13[0] >= r16[0], f'{name}: ringarna anpassas efter zoomen, högst 500 m: z18 {r18}, z16 {r16}, z13 {r13}')
        mx = max(max(pg.evaluate(f'__fk.meRingRadii(58.72, {z})') or [0]) for z in range(8, 20))
        check(mx <= 500, f'{name}: ingen ring längre än 500 m på någon zoomnivå ({mx} m)')
        pg.evaluate('__fk.map.setZoom(16, {animate:false})'); pg.wait_for_timeout(200)
        pg.click('#btnLayers'); pg.wait_for_timeout(200)
        check(pg.is_checked('#popMeRings'), f'{name}: Avståndsringar runt mig är påslaget från början')
        pg.uncheck('#popMeRings'); pg.wait_for_timeout(100)
        check(pg.locator('path.me-ring').count() == 0 and pg.evaluate('__fk.meRings()') == [], f'{name}: ringarna går att stänga av i lagermenyn')
        pg.check('#popMeRings'); pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        check(pg.locator('path.me-ring').count() > 0, f'{name}: och slå på igen')
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
        want = pg.evaluate("m => __fk.fmtDist(m).replace(/\\u00a0/g, ' ')", d1)
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
