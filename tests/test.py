import json, re, sys, os, urllib.parse
from playwright.sync_api import sync_playwright
from offline import offline

B = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(B)
APP = 'file://' + os.path.join(ROOT, 'index.html')
CHROME = os.environ.get('CHROME_PATH') or None
SHOTS = os.path.join(B, 'shots'); os.makedirs(SHOTS, exist_ok=True)
tile = {k: open(os.path.join(B, f'tile_{k}.png'), 'rb').read() for k in ('osm', 'sat', 'dens')}
calls = {'match': 0, 'occ': [], 'density': 0}
fails = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

def route(r):
    u = r.request.url
    if offline(r):
        return
    if 'tile.openstreetmap.org' in u or 'opentopomap' in u:
        return r.fulfill(status=200, body=tile['osm'], content_type='image/png')
    if 'arcgisonline' in u:
        return r.fulfill(status=200, body=tile['sat'], content_type='image/png')
    if 'api.gbif.org/v2/map' in u:
        calls['density'] += 1
        return r.fulfill(status=200, body=tile['dens'], content_type='image/png')
    if 'api.gbif.org/v1/species/match' in u:
        calls['match'] += 1
        name = urllib.parse.parse_qs(urllib.parse.urlparse(u).query).get('name', [''])[0]
        return r.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'},
                         body=json.dumps({'usageKey': 1000 + len(name), 'matchType': 'EXACT', 'scientificName': name}))
    if 'api.gbif.org/v1/occurrence/search' in u:
        q = urllib.parse.parse_qs(urllib.parse.urlparse(u).query)
        calls['occ'].append(q)
        s, n = map(float, q['decimalLatitude'][0].split(','))
        w, e = map(float, q['decimalLongitude'][0].split(','))
        off = int(q['offset'][0]); total = 1000
        res = []
        for i in range(off, min(off + 300, total)):
            res.append({'key': 5000000 + i * 7 + int(q['taxonKey'][0]), 'decimalLatitude': s + (n - s) * ((i * 37) % 100) / 100,
                        'decimalLongitude': w + (e - w) * ((i * 53) % 100) / 100, 'eventDate': '2021-08-1%dT00:00:00' % (i % 10),
                        'coordinateUncertaintyInMeters': 50, 'locality': 'Testskogen', 'datasetName': 'Artportalen (Swedish Species Observation System)'})
        return r.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'},
                         body=json.dumps({'count': total, 'offset': off, 'limit': 300, 'endOfRecords': off + 300 >= total, 'results': res}))
    if u.startswith('file:') or u.startswith('data:'):
        return r.continue_()
    return r.fulfill(status=404, body='')  # inga riktiga nätverksanrop i testerna

with sync_playwright() as p:
    br = p.chromium.launch(executable_path=CHROME, args=['--allow-file-access-from-files'])
    # ---------- Desktop ----------
    ctx = br.new_context(viewport={'width': 1280, 'height': 820}, accept_downloads=True, color_scheme='light')
    ctx.route('**/*', route)
    pg = ctx.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.goto(APP); pg.wait_for_timeout(1200)
    n0 = pg.locator('.pin-icon').count()
    check(n0 == 8, f'8 exempelnålar på kartan (fick {n0})')
    check(pg.locator('.group').count() == 8, f'listan grupperad på 8 typer (fick {pg.locator(".group").count()})')
    check('8 nålar' in pg.inner_text('#pStat'), 'statusrad visar 8 nålar')
    pg.screenshot(path=f'{SHOTS}/d1_start.png')

    # Namn på nålarna
    lab = lambda: pg.evaluate("[...document.querySelectorAll('.pin-label')].filter(e => e.offsetParent !== null).map(e => e.textContent)")
    pg.evaluate('__fk.map.setView([58.7205, 14.61], 15, {animate:false})'); pg.wait_for_timeout(400)
    check('Tornet vid mossen' in lab(), f'namnen syns under nålarna när man zoomat in ({len(lab())} st)')
    pg.evaluate('__fk.map.setZoom(12, {animate:false})'); pg.wait_for_timeout(400)
    check(lab() == [], 'namnen döljs när man zoomat ut')
    pg.evaluate('__fk.map.setZoom(15, {animate:false})'); pg.wait_for_timeout(300)
    pg.click('#btnLayers'); pg.wait_for_timeout(200)
    check(pg.is_checked('#popLabels'), 'Namn på nålar är påslaget från början')
    pg.uncheck('#popLabels'); pg.wait_for_timeout(200)
    check(lab() == [] and pg.evaluate('__fk.state().settings.pinLabels') is False, 'namnen går att stänga av, och valet sparas')
    pg.check('#popLabels'); pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    check('Tornet vid mossen' in lab(), 'och slås på igen')

    # Områdesfilter
    pg.click('#tab-filter')
    pg.click('label[for="ar-a-ex-svamp"]', force=True) if False else pg.locator('#paneFilter .frow:nth-child(2) input[data-act="area-toggle"]').click()
    pg.wait_for_timeout(200)
    check(pg.locator('.pin-icon').count() == 5, f'släcka Svampskogen ger 5 nålar (fick {pg.locator(".pin-icon").count()})')
    pg.locator('input[data-act="type-toggle"][data-id="t-pass"]').click(); pg.wait_for_timeout(150)
    check(pg.locator('.pin-icon').count() == 4, 'släcka typen Pass ger 4 nålar')
    pg.click('[data-act="areas-all"]'); pg.locator('input[data-act="type-toggle"][data-id="t-pass"]').click(); pg.wait_for_timeout(150)
    check(pg.locator('.pin-icon').count() == 8, 'Visa alla områden + Pass på igen ger 8')

    # Nytt område
    pg.fill('#areaName', 'Hemmaskogen'); pg.click('#areaAdd button[type=submit]'); pg.wait_for_timeout(150)
    check(any(a['name'] == 'Hemmaskogen' for a in pg.evaluate('__fk.state().areas')), 'nytt område skapat')

    # Ny typ med egen text-symbol
    pg.click('[data-act="type-new"]'); pg.wait_for_timeout(150)
    pg.fill('#tfName', 'Saltsten'); pg.click('.color-opt[data-c="#0f766e"]'); pg.click('.icon-opt[data-i="text"]'); pg.fill('#tfText', 'S')
    pg.screenshot(path=f'{SHOTS}/d2_typeform.png')
    pg.click('#tfForm button[type=submit]'); pg.wait_for_timeout(150)
    t = [t for t in pg.evaluate('__fk.state().types') if t['name'] == 'Saltsten']
    check(len(t) == 1 and t[0]['icon'] == 'text' and t[0]['text'] == 'S' and t[0]['color'] == '#0f766e', 'typ Saltsten sparad med text S och färg')

    # Ny nål via placering
    pg.evaluate('__fk.map.setView([58.72,14.61],14)'); pg.wait_for_timeout(300)
    pg.click('#btnAdd'); pg.wait_for_timeout(350)
    check(pg.is_visible('#placebar') and pg.is_visible('.crosshair'), 'placeringsläge visar kors och knappar')
    check('SWEREF' in pg.inner_text('#placeCoords'), 'placering visar SWEREF-koordinater')
    cp = pg.evaluate('__fk.crossPoint()'); mh = pg.evaluate('__fk.map.getContainer().clientHeight')
    pb = pg.locator('#placebar').bounding_box(); cb = pg.locator('.crosshair').bounding_box(); mb = pg.locator('#map').bounding_box()
    mw = pg.evaluate('__fk.map.getContainer().clientWidth')
    check(abs(cp['y'] - mh / 2) <= 1 and abs(cp['x'] - mw / 2) <= 1 and cb['y'] + cb['height'] < pb['y'] and abs(cb['y'] + cb['height'] / 2 - (mb['y'] + cp['y'])) < 2, f'korset ligger mitt på kartan, ovanför knappfältet (y {cp["y"]} av {mh})')
    c0 = pg.evaluate('__fk.map.getCenter()'); cl0 = pg.evaluate('__fk.crossLatLng()')
    check(abs(c0['lat'] - cl0['lat']) < 1e-9 and abs(c0['lng'] - cl0['lng']) < 1e-9, 'nålen placeras i kartans mitt, samma punkt som krysset med ringar')
    cross_ll = pg.evaluate('__fk.crossLatLng()')
    pg.click('#placeOk'); pg.wait_for_timeout(200)
    pg.fill('#pfName', 'Saltstenen vid bäcken')
    pg.select_option('#pfType', label='Saltsten')
    pg.select_option('#pfArea', label='Hemmaskogen')
    pg.fill('#pfNote', 'Fylld i maj')
    pg.screenshot(path=f'{SHOTS}/d3_pinform.png')
    pg.click('#pinForm button[type=submit]'); pg.wait_for_timeout(250)
    st = pg.evaluate('__fk.state()')
    newp = [x for x in st['pins'] if x['name'] == 'Saltstenen vid bäcken']
    check(len(newp) == 1 and abs(newp[0]['lat'] - cross_ll['lat']) < 1e-6 and abs(newp[0]['lng'] - cross_ll['lng']) < 1e-6, 'ny nål sparad där korset stod')
    check(pg.locator('.pin-icon').count() == 9, 'nio nålar på kartan')

    # Högerklick (långt tryck på mobil) skapar ingen nål, det gör man med +
    box = pg.locator('#map').bounding_box()
    pg.mouse.click(box['x'] + box['width'] * 0.3, box['y'] + box['height'] * 0.4, button='right'); pg.wait_for_timeout(250)
    check(not pg.is_visible('#pinForm'), 'högerklick i kartan öppnar inte nålformuläret')
    pg.evaluate('__fk.map.fire("contextmenu", {latlng: __fk.map.getCenter()})'); pg.wait_for_timeout(200)
    check(not pg.is_visible('#pinForm'), 'långt tryck i kartan öppnar inte nålformuläret')
    # Ny nål via + och ny typ från formuläret
    pg.click('#btnAdd'); pg.wait_for_timeout(350); pg.click('#placeOk'); pg.wait_for_timeout(250)
    check(pg.is_visible('#pinForm'), '+ och Lägg nålen här öppnar nålformuläret')
    pg.fill('#pfName', 'Utkasttest')
    pg.select_option('#pfType', '__new'); pg.wait_for_timeout(200)
    pg.fill('#tfName', 'Gömsle'); pg.click('.icon-opt[data-i="tent"]'); pg.click('#tfForm button[type=submit]'); pg.wait_for_timeout(250)
    check(pg.is_visible('#pinForm') and pg.input_value('#pfName') == 'Utkasttest', 'utkast behålls efter ny typ')
    sel = pg.eval_on_selector('#pfType', 'e => e.options[e.selectedIndex].text')
    check(sel.startswith('Gömsle'), f'nya typen förvald (fick {sel})')
    pg.click('#pinForm button[type=submit]'); pg.wait_for_timeout(200)

    # Redigera befintlig nål -> ny typ i redigering behåller namn
    pid = newp[0]['id']
    pg.evaluate(f'__fk.openPinForm({{id:"{pid}"}})'); pg.wait_for_timeout(150)
    pg.fill('#pfName', 'Saltsten omdöpt'); pg.select_option('#pfType', '__new'); pg.wait_for_timeout(150)
    pg.fill('#tfName', 'Foderautomat'); pg.click('#tfForm button[type=submit]'); pg.wait_for_timeout(200)
    check(pg.input_value('#pfName') == 'Saltsten omdöpt', 'redigering: namn behålls efter ny typ')
    pg.click('#pinForm button[type=submit]'); pg.wait_for_timeout(200)
    p2 = [x for x in pg.evaluate('__fk.state().pins') if x['id'] == pid][0]
    ft = [t for t in pg.evaluate('__fk.state().types') if t['name'] == 'Foderautomat'][0]
    check(p2['name'] == 'Saltsten omdöpt' and p2['typeId'] == ft['id'], 'redigerad nål fick nytt namn och typ')

    # Lista: klick på rad öppnar popup, navigeringslänk rätt
    pg.click('#tab-list'); pg.wait_for_timeout(150)
    href = pg.locator('.pin-row .navbtn').first.get_attribute('href')
    check(href.startswith('https://www.google.com/maps/dir/?api=1&destination='), f'navigeringslänk: {href}')
    pg.locator('.pin-row .main').first.click(); pg.wait_for_timeout(800)
    check(pg.locator('.leaflet-popup .pp').count() == 1, 'klick i listan öppnar popup')
    check('SWEREF 99 TM N' in pg.inner_text('.leaflet-popup .pp'), 'popup visar SWEREF')
    pg.screenshot(path=f'{SHOTS}/d4_popup.png')

    # Sökning
    pg.fill('#listSearch', 'torn'); pg.wait_for_timeout(150)
    check(pg.locator('.pin-row').count() == 1, f'sök "torn" ger 1 rad (fick {pg.locator(".pin-row").count()})')
    check(pg.evaluate('document.activeElement.id') == 'listSearch', 'sökfältet behåller fokus')
    pg.fill('#listSearch', '')
    pg.select_option('#listSort', 'area'); pg.wait_for_timeout(150)
    gn = pg.locator('.group .gname').all_inner_texts()
    check([g.lower() for g in gn[:2]] == ['exempel: jaktmarken', 'exempel: svampskogen'], f'sortering per område: {gn}')
    pg.select_option('#listSort', 'type')

    # Visa alla
    pg.evaluate('__fk.map.setView([62,15],5)'); pg.wait_for_timeout(200)
    pg.click('#btnFit'); pg.wait_for_timeout(600)
    z = pg.evaluate('__fk.map.getZoom()')
    inb = pg.evaluate('(() => { const b = __fk.map.getBounds(); return __fk.state().pins.every(p => b.contains([p.lat,p.lng])); })()')
    check(z >= 12 and inb, f'Visa alla zoomar till nålarna (zoom {z}, alla inom vy: {inb})')

    # Satellit
    pg.click('#btnLayers'); pg.check('input[name=base][value=sat]'); pg.wait_for_timeout(400)
    check(pg.locator('img.leaflet-tile[src*="World_Imagery"]').count() > 0, 'satellitlager laddat')
    check(pg.locator('img.leaflet-tile[src*="World_Boundaries"]').count() > 0, 'ortnamn ovanpå satellit')
    pg.screenshot(path=f'{SHOTS}/d5_sat.png')
    pg.check('input[name=base][value=osm]'); pg.keyboard.press('Escape'); pg.wait_for_timeout(200)

    # Svampkarta
    pg.click('#tab-svamp'); pg.locator('#svampToggle').check(force=True); pg.wait_for_timeout(500)
    st = pg.evaluate('__fk.state()')
    svids = {t['id'] for t in st['types'] if t['svamp']}
    exp = sum(1 for x in st['pins'] if x['typeId'] in svids)
    check(pg.locator('.pin-icon').count() == exp == 3, f'svampkarta visar bara svampnålar ({pg.locator(".pin-icon").count()} av {exp})')
    check(pg.is_visible('#modeChip'), 'svampkarta-märke synligt')
    check(calls['density'] > 0, f'GBIF-översiktslager hämtades ({calls["density"]} rutor)')
    pg.evaluate('__fk.map.setView([58.715,14.61],12)'); pg.wait_for_timeout(300)
    pg.click('#gbifLoad'); pg.wait_for_function('!__fk.gbif.busy && __fk.gbif.status.includes("fynd")', timeout=8000)
    status = pg.inner_text('#gbifStatus')
    check('2 700 fynd visas av 3 000' in status.replace(chr(160), ' '), f'GBIF status: {status}')
    occ = calls['occ']
    check(len(occ) == 9 and all(q.get('taxonKey') and q['year'][0].startswith('2000,') and q['hasCoordinate'] == ['true'] for q in occ), f'{len(occ)} sidor med taxonKey, år och koordinatfilter')
    check(sorted({q['offset'][0] for q in occ}) == ['0', '300', '600'], 'paginering 0/300/600, max 900 per art')
    ncirc = pg.evaluate('(() => { let n = 0; __fk.map.eachLayer(l => { if(l instanceof L.CircleMarker && !(l instanceof L.Circle)) n++; }); return n; })()')
    check(ncirc == 2700, f'2700 fyndpunkter ritade (fick {ncirc})')
    pg.screenshot(path=f'{SHOTS}/d6_svamp.png')
    # Klicka på en fyndpunkt -> popup
    pt = pg.evaluate('(() => { let c = null; __fk.map.eachLayer(l => { if(!c && l instanceof L.CircleMarker && !(l instanceof L.Circle)) c = l; }); const p = __fk.map.latLngToContainerPoint(c.getLatLng()); c.openPopup(); return [p.x,p.y]; })()')
    pg.wait_for_timeout(300)
    txt = pg.inner_text('.leaflet-popup .pp')
    check('Fynddatum 2021-08' in txt and '±50 m' in txt, 'fyndpopup visar datum och osäkerhet')
    pg.click('.leaflet-popup [data-act=copy]'); pg.wait_for_timeout(200)
    check(pg.is_visible('#pinForm'), 'Spara som egen öppnar nålformulär')
    pg.keyboard.press('Escape')

    # Import: KML som svampkälla
    with pg.expect_file_chooser() as fc:
        pg.click('[data-act="import-ext"]')
    fc.value.set_files(os.path.join(B, 'fixtures/test.kml')); pg.wait_for_timeout(300)
    check('2 punkter' in pg.inner_text('.modal h2'), 'KML: 2 punkter hittade')
    check(pg.is_checked('input[name=im][value=ext]'), 'KML via svampfliken förvalt som svampkälla')
    pg.click('#imOk'); pg.wait_for_timeout(300)
    ext = pg.evaluate('__fk.state().external')
    check(len(ext) == 1 and ext[0]['points'][0]['name'] == 'Kantarell kompis' and ext[0]['points'][0]['note'] == 'Bra ställe', 'KML importerad med namn och rensad beskrivning')
    # GPX som egna nålar
    with pg.expect_file_chooser() as fc:
        pg.click('#tab-data'); pg.click('[data-act="import"]')
    fc.value.set_files(os.path.join(B, 'fixtures/test.gpx')); pg.wait_for_timeout(300)
    pg.check('input[name=im][value=pins]'); pg.select_option('#imType', label='Saltsten'); pg.select_option('#imArea', '__new'); pg.fill('#imAreaNew', 'Saltstenar')
    pg.click('#imOk'); pg.wait_for_timeout(300)
    st = pg.evaluate('__fk.state()')
    sa = [a for a in st['areas'] if a['name'] == 'Saltstenar']
    check(len(sa) == 1 and sum(1 for x in st['pins'] if x['areaId'] == sa[0]['id']) == 2, 'GPX importerad som 2 nålar i nytt område')
    # CSV med semikolon och decimalkomma
    with pg.expect_file_chooser() as fc:
        pg.click('[data-act="import"]')
    fc.value.set_files(os.path.join(B, 'fixtures/test.csv')); pg.wait_for_timeout(300)
    check('2 punkter' in pg.inner_text('.modal h2'), 'CSV med ; och decimalkomma: 2 punkter')
    pg.click('#imCancel')
    pts = pg.evaluate('__fk.parseCSV(\'Namn;Latitud;Longitud\\n"Tratt; norra";58,7044;14,6011\')')
    check(pts and pts[0]['name'] == 'Tratt; norra' and abs(pts[0]['lat'] - 58.7044) < 1e-9, 'CSV med citattecken tolkas rätt')
    with pg.expect_file_chooser() as fc:
        pg.click('[data-act="import"]')
    fc.value.set_files(os.path.join(B, 'fixtures/test.geojson')); pg.wait_for_timeout(300)
    check('1 punkt' in pg.inner_text('.modal h2'), 'GeoJSON: bara punkten importeras')
    pg.click('#imCancel')

    # Export
    with pg.expect_download() as dl:
        pg.click('[data-act="export-gpx"]')
    gpx = open(dl.value.path(), encoding='utf-8').read()
    check(gpx.count('<wpt') == 3 and '<gpx version="1.1"' in gpx, f'GPX-export i svampläge har 3 svamp-waypoints (fick {gpx.count("<wpt")})')
    with pg.expect_download() as dl:
        pg.click('[data-act="export-json"]')
    backup = json.load(open(dl.value.path(), encoding='utf-8'))
    check(len(backup['pins']) == len(pg.evaluate('__fk.state().pins')) and len(backup['external']) == 1, 'JSON-säkerhetskopia komplett')
    bpath = dl.value.path()

    # Rensa exempel + persistens
    pg.click('#paneData [data-act="clear-ex"]'); pg.wait_for_timeout(300)
    st = pg.evaluate('__fk.state()')
    check(not any(x.get('example') for x in st['pins']) and not any(a.get('example') for a in st['areas']), 'exempel rensade')
    left = len(st['pins'])
    pg.wait_for_timeout(400); pg.reload(); pg.wait_for_timeout(1000)
    check(len(pg.evaluate('__fk.state().pins')) == left and pg.evaluate('__fk.state().settings.svampMode') is True, 'data och svampläge kvar efter omladdning')
    # Återställ från backup (ersätt)
    with pg.expect_file_chooser() as fc:
        pg.click('#tab-data'); pg.click('[data-act="import"]')
    fc.value.set_files(bpath); pg.wait_for_timeout(300)
    pg.check('input[name=bm][value=replace]'); pg.click('#biOk'); pg.wait_for_timeout(300)
    check(len(pg.evaluate('__fk.state().pins')) == len(backup['pins']), 'säkerhetskopia återställd')
    # Ta bort nål med tvåstegsbekräftelse
    pg.evaluate(f'__fk.openPinForm({{id:"{pid}"}})'); pg.wait_for_timeout(150)
    pg.click('#pfDel'); check(pg.is_visible('#pinForm'), 'första klick på Ta bort raderar inte')
    pg.click('#pfDel'); pg.wait_for_timeout(200)
    check(not any(x['id'] == pid for x in pg.evaluate('__fk.state().pins')), 'andra klick raderar nålen')
    # Numrera om passen från söder till norr (påhittade platser i Tiveden)
    rest = pg.evaluate("['Pass 3 – kalhygget','Pass 12','3. Bäcken','Pass vid ån','Granpasset','pass nr 4: Myren',''].map(__fk.passRest)")
    check(rest == ['kalhygget', '', 'Bäcken', 'vid ån', 'Granpasset', 'Myren', ''], f'beskrivningen efter passnumret tas fram {rest}')
    pg.evaluate("""(() => { const s = __fk.state(), now = Date.now();
      s.areas.push({id:'a-rn', name:'Testmarken', visible:true}, {id:'a-rn2', name:'Andra marken', visible:true});
      const P = (id, name, area, lat, lng, typeId) => s.pins.push({id, name, typeId:typeId || 't-pass', areaId:area, lat, lng, note:'', created:now, updated:now});
      P('rn1', 'Granpasset', 'a-rn', 58.73, 14.60); P('rn2', 'Pass 2', 'a-rn', 58.69, 14.61); P('rn3', 'Pass 7 – stora stenen', 'a-rn', 58.70, 14.62);
      P('rn4', '3. Bäcken', 'a-rn', 58.71, 14.58); P('rn5', 'Tornet', 'a-rn', 58.68, 14.60, 't-torn');
      P('rn6', 'Pass 1', 'a-rn2', 58.75, 14.60); P('rn7', 'Pass 2', 'a-rn2', 58.74, 14.60);
      s.settings.svampMode = false; __fk.renderAll(); })()""")
    pg.click('#tab-list'); pg.wait_for_timeout(200)
    check(pg.is_visible('#btnRenumber'), 'knappen Numrera om passen finns under Nålar')
    pg.click('#btnRenumber'); pg.wait_for_timeout(200)
    pg.select_option('#rnArea', 'a-rn'); pg.select_option('#rnDir', 'sn'); pg.wait_for_timeout(100)
    prev = pg.locator('#rnPreview .rn-new').all_inner_texts()
    check(prev == ['Pass 1', 'Pass 2 – stora stenen', 'Pass 3 – Bäcken', 'Pass 4 – Granpasset'], f'förhandsvisning söder till norr, tornet ingår inte {prev}')
    pg.screenshot(path=f'{SHOTS}/renumber.png')
    pg.click('#rnOk'); pg.wait_for_timeout(300)
    names = pg.evaluate("Object.fromEntries(__fk.state().pins.filter(p => p.id.startsWith('rn')).map(p => [p.id, p.name]))")
    check(names == {'rn1': 'Pass 4 – Granpasset', 'rn2': 'Pass 1', 'rn3': 'Pass 2 – stora stenen', 'rn4': 'Pass 3 – Bäcken', 'rn5': 'Tornet', 'rn6': 'Pass 1', 'rn7': 'Pass 2'},
          f'passen numrerade söder till norr, andra marken och tornet orörda {names}')
    pg.click('#btnRenumberUndo'); pg.wait_for_timeout(300)
    names = pg.evaluate("Object.fromEntries(__fk.state().pins.filter(p => p.id.startsWith('rn')).map(p => [p.id, p.name]))")
    check(names['rn1'] == 'Granpasset' and names['rn3'] == 'Pass 7 – stora stenen' and not pg.is_visible('#btnRenumberUndo'), f'numreringen kan ångras {names}')
    plan = pg.evaluate("__fk.renumberPlan('*', 'ns').filter(x => x.pin.id.startsWith('rn')).map(x => x.pin.id + '=' + x.name).sort()")
    check(plan == ['rn1=Pass 1 – Granpasset', 'rn2=Pass 4', 'rn3=Pass 3 – stora stenen', 'rn4=Pass 2 – Bäcken', 'rn6=Pass 1', 'rn7=Pass 2'], f'alla marker var för sig, norr till söder {plan}')
    plan = pg.evaluate("__fk.renumberPlan('a-rn', 'wo').map(x => x.pin.id)")
    check(plan == ['rn4', 'rn1', 'rn2', 'rn3'], f'väster till öster {plan}')
    check(not errors, f'inga JS-fel på dator: {errors[:3]}')
    ctx.close()

    # ---------- Mobil, mörkt läge ----------
    for scheme in ('light', 'dark'):
        ctx = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme=scheme)
        ctx.route('**/*', route)
        pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(APP); pg.wait_for_timeout(1200)
        sh = pg.evaluate('getComputedStyle(document.documentElement).getPropertyValue("--sheet-h")')
        check(pg.locator('.pin-icon').count() == 8, f'mobil {scheme}: 8 nålar, låda {sh}')
        pg.screenshot(path=f'{SHOTS}/m_{scheme}_peek.png')
        pg.click('#tab-list'); pg.wait_for_timeout(400)
        pg.screenshot(path=f'{SHOTS}/m_{scheme}_list.png')
        sw = pg.evaluate('document.documentElement.scrollWidth')
        check(sw <= 390, f'mobil {scheme}: ingen horisontell scroll ({sw})')
        if scheme == 'light':
            pg.click('#tab-svamp'); pg.wait_for_timeout(300); pg.screenshot(path=f'{SHOTS}/m_svamp.png')
            pg.click('#tab-filter'); pg.wait_for_timeout(300); pg.screenshot(path=f'{SHOTS}/m_filter.png')
            pg.click('#btnAdd'); pg.wait_for_timeout(400); pg.screenshot(path=f'{SHOTS}/m_place.png')
            pg.click('#placeOk'); pg.wait_for_timeout(300); pg.screenshot(path=f'{SHOTS}/m_form.png')
            pg.keyboard.press('Escape')
            # dra lådan
            hb = pg.locator('#handle').bounding_box()
            pg.locator('#handle').tap(); pg.wait_for_timeout(400)
            h1 = pg.evaluate('document.getElementById("panel").getBoundingClientRect().height')
            check(h1 > 300, f'tryck på handtaget fäller ut lådan ({h1:.0f}px)')
            hb = pg.locator('#handle').bounding_box(); x0, y0 = hb['x'] + hb['width'] / 2, hb['y'] + hb['height'] / 2
            pg.evaluate("__fk.setSheet('peek', true)"); pg.wait_for_timeout(350)
            hb = pg.locator('#handle').bounding_box(); y0 = hb['y'] + hb['height'] / 2
            pg.mouse.move(x0, y0); pg.mouse.down(); pg.mouse.move(x0, y0 + 30, steps=5); pg.mouse.move(x0, y0 + 80, steps=5); pg.mouse.up(); pg.wait_for_timeout(400)
            h2 = pg.evaluate('document.getElementById("panel").getBoundingClientRect().height')
            check(pg.evaluate('__fk.sheet()') == 'min' and h2 < 40, f'lådan kan dras ned till bara handtaget ({h2:.0f}px)')
            pg.locator('#handle').tap(); pg.wait_for_timeout(400)
            check(pg.evaluate('__fk.sheet()') == 'peek', 'tryck på handtaget tar fram flikarna igen')
            pg.click('#btnAdd'); pg.wait_for_timeout(500)
            check(pg.evaluate('__fk.sheet()') == 'min' and pg.is_visible('.loupe'), 'vid placering går lådan ned till handtaget och förstoringsglaset visas')
            pg.click('#placeCancel'); pg.wait_for_timeout(400)
            check(pg.evaluate('__fk.sheet()') == 'peek' and not pg.is_visible('.loupe'), 'efter placering kommer flikarna tillbaka')
            # sidan ska aldrig gå att scrolla på telefon, i något lådläge
            for st in ('min', 'peek', 'half', 'full'):
                pg.evaluate(f"__fk.setSheet('{st}', true)"); pg.wait_for_timeout(350)
                dims = pg.evaluate('[document.documentElement.scrollHeight, document.documentElement.scrollWidth, innerHeight, innerWidth]')
                check(dims[0] <= dims[2] and dims[1] <= dims[3], f'mobil, låda {st}: sidan ryms på skärmen {dims}')
            pg.evaluate("__fk.setSheet('peek', true)"); pg.wait_for_timeout(350)
            pg.evaluate('window.scrollTo(0, 400); document.body.scrollTop = 400; document.documentElement.scrollTop = 400')
            pg.wait_for_timeout(100)
            sc = pg.evaluate('[scrollX, scrollY, document.body.scrollTop, document.documentElement.scrollTop]')
            check(sc == [0, 0, 0, 0], f'mobil: sidan går inte att scrolla {sc}')
            css = pg.evaluate("(() => { const h = getComputedStyle(document.documentElement), b = getComputedStyle(document.body); return [h.overflowY, b.position, b.touchAction, h.overscrollBehaviorY]; })()")
            check(css == ['hidden', 'fixed', 'manipulation', 'none'], f'mobil: html/body är låsta mot scroll och dubbeltryckszoom {css}')
            small = pg.evaluate("""[...document.querySelectorAll('input,select,textarea')].filter(e => !['checkbox','radio','range','file','color','hidden'].includes(e.type) && parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.id || e.className)""")
            check(not small, f'mobil: inga fält under 16 px som får iPhone att zooma in {small}')
        check(not errs, f'mobil {scheme}: inga JS-fel {errs[:2]}')
        ctx.close()
    br.close()

print('\n' + ('ALLA TESTER OK' if not fails else f'{len(fails)} FEL: ' + '; '.join(fails)))
sys.exit(1 if fails else 0)
