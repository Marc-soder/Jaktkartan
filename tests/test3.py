import json, os, sys
from playwright.sync_api import sync_playwright
from offline import offline
B=os.path.dirname(os.path.abspath(__file__)); APP='file://'+os.path.join(os.path.dirname(B),'index.html')
CHROME=os.environ.get('CHROME_PATH') or None
os.makedirs(os.path.join(B,'shots'),exist_ok=True)
tile=open(os.path.join(B,'tile_osm.png'),'rb').read(); fails=[]; over=[]
def check(c,m):
    print(('PASS ' if c else 'FAIL ')+m); (None if c else fails.append(m))
def route(r):
    u=r.request.url
    if u.startswith('file:'): return r.continue_()
    if 'overpass-api.de' in u:
        over.append(u)
        return r.fulfill(status=200,content_type='application/json',headers={'Access-Control-Allow-Origin':'*'},body=json.dumps({'elements':[
          {'type':'way','id':1,'tags':{'highway':'track'},'geometry':[{'lat':58.72,'lon':14.60},{'lat':58.721,'lon':14.61}]},
          {'type':'way','id':2,'tags':{'highway':'path'},'geometry':[{'lat':58.71,'lon':14.60},{'lat':58.711,'lon':14.61},{'lat':58.712,'lon':14.62}]},
          {'type':'node','id':3,'lat':59,'lon':17}]}))
    if offline(r): return
    return r.fulfill(status=200,body=tile,content_type='image/png')
with sync_playwright() as p:
    br=p.chromium.launch(executable_path=CHROME)
    for name,vp in (('desktop',dict(viewport={'width':1280,'height':820})),('mobil',dict(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=2))):
        ctx=br.new_context(**vp); ctx.route('**/*',route); pg=ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.goto(APP); pg.wait_for_timeout(1200)
        ha=pg.evaluate('__fk.areaHa([[59.00,17.00],[59.00,17.01],[59.01,17.01],[59.01,17.00]])')
        check(63.0<ha<64.8, f'{name}: areal för 0,01° ruta vid 59°N = {ha:.2f} ha (väntat ca 63,9)')
        pg.click('#tab-filter'); pg.wait_for_timeout(300)
        pg.locator('#paneFilter [data-act="area-edit"]').first.click(); pg.wait_for_timeout(200)
        check('Ingen gräns' in pg.inner_text('.modal'), f'{name}: området saknar gräns från början')
        pg.click('#afDraw'); pg.wait_for_timeout(500)
        check(pg.is_visible('#drawbar') and not pg.is_visible('#btnAdd') and pg.is_disabled('#drawOk'), f'{name}: ritläge öppet, Klar avstängd')
        box=pg.locator('#map').bounding_box(); W,H=box['width'],box['height']
        top = 0.12 if name=='desktop' else 0.10
        pts=[(0.25,top),(0.6,top),(0.6,0.3),(0.3,0.36),(0.2,0.25)]
        tap = (lambda x,y: pg.touchscreen.tap(x,y)) if name=='mobil' else (lambda x,y: pg.mouse.click(x,y))
        for fx,fy in pts: tap(box['x']+W*fx, box['y']+H*fy); pg.wait_for_timeout(350)
        check('5 punkter' in pg.inner_text('#drawText') and ' ha' in pg.inner_text('#drawText'), f'{name}: fem hörn ritade: {pg.inner_text("#drawText")}')
        pg.click('#drawUndo'); pg.wait_for_timeout(100)
        check('4 punkter' in pg.inner_text('#drawText'), f'{name}: Ångra tar bort senaste punkten')
        if name=='desktop':
            pg.mouse.click(box['x']+W*0.5, box['y']+H*0.5, button='right'); pg.wait_for_timeout(200)
            check(not pg.is_visible('#pinForm'), 'desktop: högerklick i ritläge öppnar inte nålformulär')
        pg.click('#drawOk'); pg.wait_for_timeout(400)
        st=pg.evaluate('__fk.state()'); a=[x for x in st['areas'] if x.get('border')]
        check(len(a)==1 and len(a[0]['border'].split(';'))==4 and not pg.is_visible('#drawbar') and pg.is_visible('#btnAdd'), f'{name}: gränsen sparad med 4 punkter, ritläge stängt')
        n=pg.evaluate('(() => { let n=0; __fk.map.eachLayer(l => { if(l instanceof L.Polygon) n++; }); return n; })()')
        check(n==2, f'{name}: gränsen ritas på kartan ({n} lager)')
        aid=a[0]['id']
        # dölj området -> gränsen försvinner
        pg.click('#tab-filter'); pg.wait_for_timeout(500); pg.evaluate(f'document.getElementById("ar-{aid}").click()'); pg.wait_for_timeout(200)
        n=pg.evaluate('(() => { let n=0; __fk.map.eachLayer(l => { if(l instanceof L.Polygon) n++; }); return n; })()')
        check(n==0, f'{name}: släckt område döljer gränsen')
        pg.evaluate(f'document.getElementById("ar-{aid}").click()')
        # avbryt ändrar inget
        pg.evaluate(f'__fk.startDrawing("{aid}")'); pg.wait_for_timeout(400); pg.click('#drawUndo'); pg.click('#drawCancel'); pg.wait_for_timeout(200)
        check(len([x for x in pg.evaluate('__fk.state().areas') if x['id']==aid][0]['border'].split(';'))==4, f'{name}: Avbryt lämnar gränsen orörd')
        # import från KML
        pg.evaluate(f'__fk.openAreaForm("{aid}")'); pg.wait_for_timeout(200)
        with pg.expect_file_chooser() as fc: pg.click('#afImport')
        fc.value.set_files(os.path.join(B,'fixtures/border.kml')); pg.wait_for_timeout(500)
        b=[x for x in pg.evaluate('__fk.state().areas') if x['id']==aid][0]['border']
        check(b=='59.00000,17.00000;59.00000,17.01000;59.01000,17.01000;59.01000,17.00000', f'{name}: KML-yta importerad som gräns: {b}')
        r1=pg.evaluate('''__fk.parseRing('{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[17,59],[17.01,59],[17.01,59.01],[17,59]]]}}').length''')
        r2=pg.evaluate('''__fk.parseRing('<gpx><trk><trkseg><trkpt lat="59" lon="17"/><trkpt lat="59.01" lon="17"/><trkpt lat="59.01" lon="17.01"/></trkseg></trk></gpx>').length''')
        check(r1==4 and r2==3, f'{name}: GeoJSON-polygon och GPX-spår tolkas ({r1}, {r2})')
        # ta bort gräns
        pg.evaluate(f'__fk.openAreaForm("{aid}")'); pg.wait_for_timeout(200); pg.click('#afBorderDel'); pg.click('#afBorderDel'); pg.wait_for_timeout(300)
        check(not [x for x in pg.evaluate('__fk.state().areas') if x.get('border')], f'{name}: gränsen borttagen efter bekräftelse')
        # egna vägar och stigar
        pg.click('#btnLayers'); pg.wait_for_timeout(200); pg.click('#popDrawLine'); pg.wait_for_timeout(300)
        check(pg.is_visible('#lfForm') and pg.is_hidden('#layerPop'), f'{name}: Rita egen väg öppnar formuläret')
        pg.check('input[name=lfKind][value=path]'); pg.fill('#lfName', 'Stigen till tornet'); pg.select_option('#lfArea', aid)
        pg.click('#lfForm button[type=submit]'); pg.wait_for_timeout(400)
        check(pg.is_visible('#drawbar') and pg.is_disabled('#drawOk') and 'stig' in pg.inner_text('#drawText'), f'{name}: ritläge för stig öppet')
        for fx,fy in ((0.3,0.3),(0.45,0.35),(0.6,0.32)): tap(box['x']+W*fx, box['y']+H*fy); pg.wait_for_timeout(300)
        check('3 punkter' in pg.inner_text('#drawText') and not pg.is_disabled('#drawOk'), f'{name}: tre punkter längs stigen: {pg.inner_text("#drawText")}')
        pg.click('#drawOk'); pg.wait_for_timeout(400)
        ar=[x for x in pg.evaluate('__fk.state().areas') if x['id']==aid][0]; ls=list((ar.get('lines') or {}).values())
        check(len(ls)==1 and ls[0]['k']=='path' and ls[0]['n']=='Stigen till tornet' and len(ls[0]['p'].split(';'))==3 and not pg.is_visible('#drawbar'), f'{name}: stigen sparad i området')
        nl=pg.evaluate("(() => { let n=0; __fk.map.eachLayer(l => { if(l instanceof L.Polyline && !(l instanceof L.Polygon) && l.options.color === '#7a2e8f') n++; }); return n; })()")
        check(nl==1, f'{name}: stigen ritas på kartan ({nl})')
        pg.evaluate("(() => { let p=null; __fk.map.eachLayer(l => { if(!p && l instanceof L.Polyline && !(l instanceof L.Polygon) && l.options.color === '#7a2e8f') p=l; }); p.openPopup(p.getLatLngs()[1]); })()"); pg.wait_for_timeout(300)
        check('Stigen till tornet' in pg.inner_text('.leaflet-popup') and ' m' in pg.inner_text('.leaflet-popup'), f'{name}: stigens popup visar namn och längd')
        pg.click('.leaflet-popup [data-l="del"]'); pg.click('.leaflet-popup [data-l="del"]'); pg.wait_for_timeout(300)
        ar=[x for x in pg.evaluate('__fk.state().areas') if x['id']==aid][0]
        check(not ar.get('lines'), f'{name}: stigen borttagen efter bekräftelse')
        # eget spår
        pg.evaluate("__fk.trail.own.length = 0")
        pg.evaluate("(() => { const t = __fk.trail.own; t.push({lat:58.71, lng:14.59, t:Date.now() - 50 * 60000}, {lat:58.711, lng:14.591, t:Date.now() - 49 * 60000}); __fk.showMe(58.712, 14.592, 10); __fk.showMe(58.713, 14.594, 10); })()"); pg.wait_for_timeout(400)
        own=lambda: pg.evaluate("(() => { let n=0; __fk.map.eachLayer(l => { if(l instanceof L.Polyline && !(l instanceof L.Polygon) && l.options.color === '#1a73e8') n++; }); return n; })()")
        check(own()==1 and len(pg.evaluate('__fk.trail.own'))==4, f'{name}: eget spår visas, de senaste 30 minuterna ({own()} linje)')
        pg.click('#btnLayers'); pg.wait_for_timeout(200)
        pg.evaluate("(() => { const r = document.getElementById('trailMin'); r.value = 60; r.dispatchEvent(new Event('input', {bubbles:true})); r.dispatchEvent(new Event('change', {bubbles:true})); })()"); pg.wait_for_timeout(400)
        check(own()==2 and pg.inner_text('#trailMinTxt')=='1 h', f'{name}: med 1 h syns även den äldre sträckan, som ett eget stycke efter glappet ({own()})')
        pg.evaluate("(() => { const r = document.getElementById('trailMin'); r.value = 0; r.dispatchEvent(new Event('input', {bubbles:true})); })()"); pg.wait_for_timeout(400)
        check(own()==0 and pg.inner_text('#trailMinTxt')=='Av', f'{name}: reglaget på Av döljer spåret')
        pg.keyboard.press('Escape')
        # skogsvägar
        over.clear(); pg.evaluate('__fk.map.setView([58.715,14.61],14)'); pg.wait_for_timeout(700)
        check(len(over)==0, f'{name}: inga vägar hämtas när lagret är av')
        pg.click('#btnLayers'); pg.check('#popRoads'); pg.wait_for_timeout(900)
        nl=pg.evaluate('(() => { let n=0; __fk.map.eachLayer(l => { if(l instanceof L.Polyline && !(l instanceof L.Polygon)) n++; }); return n; })()')
        check(len(over)==1 and 'highway' in over[0] and nl==4 and '2 vägar' in pg.inner_text('#roadNote'), f'{name}: skogsvägar hämtade och ritade ({nl} linjer): {pg.inner_text("#roadNote")}')
        pg.keyboard.press('Escape'); pg.evaluate('__fk.map.panBy([40,0])'); pg.wait_for_timeout(900)
        check(len(over)==1, f'{name}: liten förflyttning hämtar inte om')
        pg.evaluate('__fk.map.setZoom(10)'); pg.wait_for_timeout(1200)
        nl=pg.evaluate('(() => { let n=0; __fk.map.eachLayer(l => { if(l instanceof L.Polyline && !(l instanceof L.Polygon)) n++; }); return n; })()')
        check(nl==0 and len(over)==1, f'{name}: utzoomat rensas vägarna utan nytt anrop')
        check(not errs, f'{name}: inga JS-fel {errs[:2]}')
        ctx.close()
    # skärmbild
    ctx=br.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=2); ctx.route('**/*',route); pg=ctx.new_page(); pg.goto(APP); pg.wait_for_timeout(1000)
    aid=pg.evaluate('__fk.state().areas[0].id'); pg.evaluate(f'__fk.startDrawing("{aid}")'); pg.wait_for_timeout(300)
    for x,y in ((80,160),(300,150),(310,380),(120,420)): pg.touchscreen.tap(x,y); pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(B,'shots/m_draw.png')); br.close()
print('\n'+('ALLA OK' if not fails else f'{len(fails)} FEL: '+'; '.join(fails)))
sys.exit(1 if fails else 0)
