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
        # skärmdump ovanpå kartan
        pg.evaluate(f'__fk.openAreaForm("{aid}")'); pg.wait_for_timeout(200)
        with pg.expect_file_chooser() as fc: pg.click('#afShot')
        fc.value.set_files(os.path.join(B,'tile_osm.png')); pg.wait_for_timeout(600)
        check(pg.is_visible('#ovImg') and pg.is_disabled('#ovNext'), f'{name}: skärmdumpen visas för att välja punkt 1')
        def img_click(u, v):
            bb=pg.locator('#ovImg').bounding_box(); pg.locator('#ovImg').click(position={'x':u/256*bb['width'], 'y':v/256*bb['height']}); pg.wait_for_timeout(150)
        img_click(32, 32); pg.click('#ovNext'); pg.wait_for_timeout(300)
        check(pg.is_visible('#ovbar') and 'korset' in pg.inner_text('#ovbar') and pg.locator('#map .crosshair:not([hidden])').count()==1, f'{name}: steg 1 i kartan med kors')
        A=(box['x']+W*0.3, box['y']+H*0.25); Bp=(box['x']+W*0.65, box['y']+H*0.4)
        cl=lambda P: pg.evaluate(f"(() => {{ const r=__fk.map.getContainer().getBoundingClientRect(); const ll=__fk.map.containerPointToLatLng([{P[0]}-r.left, {P[1]}-r.top]); return {{lat:ll.lat, lng:ll.lng}}; }})()")
        llA=cl(A); llB=cl(Bp)
        tap(*A); pg.wait_for_timeout(900)
        c=pg.evaluate('__fk.map.getCenter()')
        check(abs(c['lat']-llA['lat']) < 2e-4 and abs(c['lng']-llA['lng']) < 2e-4, f'{name}: tryck i kartan flyttar korset dit')
        pg.evaluate(f"__fk.map.setView([{llA['lat']}, {llA['lng']}], __fk.map.getZoom(), {{animate:false}})")
        pg.click('#ovMapOk'); pg.wait_for_timeout(300)
        check(pg.is_visible('#ovImg') and pg.locator('.shot-mark.first').count()==1, f'{name}: punkt 2 väljs i bilden, punkt 1 är markerad')
        img_click(224, 160); pg.click('#ovNext'); pg.wait_for_timeout(300)
        pg.evaluate(f"__fk.map.setView([{llB['lat']}, {llB['lng']}], __fk.map.getZoom(), {{animate:false}})")
        pg.click('#ovMapOk'); pg.wait_for_timeout(900)
        check(pg.locator('img.shot-img').count()==1 and pg.is_visible('#ovDraw'), f'{name}: bilden ligger på kartan')
        g1=pg.evaluate('__fk.ovImgToLatLng(32, 32)'); g2=pg.evaluate('__fk.ovImgToLatLng(224, 160)')
        e1=max(abs(g1['lat']-llA['lat']), abs(g1['lng']-llA['lng'])); e2=max(abs(g2['lat']-llB['lat']), abs(g2['lng']-llB['lng']))
        check(e1 < 2e-4 and e2 < 2e-4 and pg.locator('#map .crosshair:not([hidden])').count()==0, f'{name}: bildens punkter hamnar där de pekades ut i kartan (fel {e1:.1e}, {e2:.1e} grader)')
        # bildens hörn på skärmen ska stämma med avbildningen
        ok=pg.evaluate("""(() => { const img=document.querySelector('img.shot-img'), r=img.getBoundingClientRect(), m=__fk.map, c=m.getContainer().getBoundingClientRect();
          const pts=[[0,0],[256,0],[256,256],[0,256]].map(([u,v]) => m.latLngToContainerPoint(__fk.ovImgToLatLng(u,v)));
          const xs=pts.map(p=>p.x+c.left), ys=pts.map(p=>p.y+c.top);
          return Math.abs(Math.min(...xs)-r.left) < 3 && Math.abs(Math.max(...xs)-r.right) < 3 && Math.abs(Math.min(...ys)-r.top) < 3 && Math.abs(Math.max(...ys)-r.bottom) < 3; })()""")
        check(ok, f'{name}: bilden ritas med rätt skala och vridning på skärmen')
        third=pg.evaluate("""(() => { const o=__fk.ov(), m=__fk.map, save=o.pts.map(p => p.ll);
          const th=0.35, sc=1.7, T=(u,v) => L.point(sc*(Math.cos(th)*u - Math.sin(th)*v) + 100, sc*(Math.sin(th)*u + Math.cos(th)*v) + 50);
          o.pts[0].ll=m.layerPointToLatLng(T(o.pts[0].u, o.pts[0].v)); o.pts[1].ll=m.layerPointToLatLng(T(o.pts[1].u, o.pts[1].v));
          const got=__fk.ovImgToLatLng(200, 40), want=m.layerPointToLatLng(T(200, 40));
          o.pts.forEach((p, i) => { p.ll=save[i]; });
          return Math.max(Math.abs(got.lat-want.lat), Math.abs(got.lng-want.lng)); })()""")
        check(third < 1e-9, f'{name}: en tredje punkt hamnar rätt vid känd vridning och skala (fel {third:.1e})')
        pg.evaluate("(() => { const r=document.getElementById('ovOpacity'); r.value=30; r.dispatchEvent(new Event('input', {bubbles:true})); })()")
        check(pg.evaluate("document.querySelector('img.shot-img').style.opacity") == '0.3', f'{name}: genomskinligheten går att ändra')
        pg.click('#ovDraw'); pg.wait_for_timeout(300)
        check(pg.is_visible('#drawbar') and pg.is_hidden('#ovbar') and pg.locator('img.shot-img').count()==1, f'{name}: ritläge med bilden kvar under')
        pg.click('#drawCancel'); pg.wait_for_timeout(300)
        check(pg.is_visible('#ovDraw') and pg.locator('img.shot-img').count()==1, f'{name}: Avbryt i ritläget behåller bilden')
        pg.click('#ovDraw'); pg.wait_for_timeout(300)
        for fx,fy in ((0.3,0.25),(0.65,0.25),(0.65,0.4)): tap(box['x']+W*fx, box['y']+H*fy); pg.wait_for_timeout(250)
        pg.click('#drawOk'); pg.wait_for_timeout(400)
        ar=[x for x in pg.evaluate('__fk.state().areas') if x['id']==aid][0]
        check(len((ar.get('border') or '').split(';'))==3 and pg.locator('img.shot-img').count()==0 and pg.is_hidden('#ovbar') and pg.evaluate('__fk.ov()') is None, f'{name}: gränsen sparad och skärmdumpen borttagen')
        pg.evaluate(f'(() => {{ const a=__fk.state().areas.find(x => x.id === "{aid}"); delete a.border; }})()')
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
