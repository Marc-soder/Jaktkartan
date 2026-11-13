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
        n=pg.evaluate('(() => { let n=0; __fk.map.eachLayer(l => { if(l instanceof L.Polygon && l.options.className !== "wind-sector") n++; }); return n; })()')
        check(n==2, f'{name}: gränsen ritas på kartan ({n} lager)')
        aid=a[0]['id']
        # tryck i området: ruta med Zooma till området
        pg.evaluate('__fk.map.setView([62, 15], 6, {animate:false})'); pg.wait_for_timeout(300)
        pg.evaluate(f'__fk.zoomToArea("{aid}")'); pg.wait_for_timeout(900)
        inb=pg.evaluate(f'(() => {{ const b=__fk.map.getBounds(), a=__fk.state().areas.find(x => x.id==="{aid}"); return a.border.split(";").every(p => b.contains(p.split(",").map(Number))); }})()')
        check(inb and pg.evaluate('__fk.map.getZoom()') >= 12, f'{name}: Zooma till området visar hela gränsen')
        c=pg.evaluate(f'(() => {{ const a=__fk.state().areas.find(x => x.id==="{aid}"), p=a.border.split(";").map(q => q.split(",").map(Number)); const lat=p.reduce((s,q)=>s+q[0],0)/p.length, lng=p.reduce((s,q)=>s+q[1],0)/p.length; const r=__fk.map.getContainer().getBoundingClientRect(), pt=__fk.map.latLngToContainerPoint([lat,lng]); return [r.left+pt.x, r.top+pt.y]; }})()')
        tap(c[0], c[1]); pg.wait_for_timeout(400)
        check(pg.is_visible('.leaflet-popup') and 'Zooma till området' in pg.inner_text('.leaflet-popup') and ' ha' in pg.inner_text('.leaflet-popup') and 'Ändra' in pg.inner_text('.leaflet-popup'), f'{name}: tryck i området visar namn, storlek och Zooma till området')
        pg.evaluate('__fk.map.setZoom(__fk.map.getZoom() - 3, {animate:false})'); pg.wait_for_timeout(300)
        pg.click('.leaflet-popup [data-a="zoom"]'); pg.wait_for_timeout(900)
        inb=pg.evaluate(f'(() => {{ const b=__fk.map.getBounds(), a=__fk.state().areas.find(x => x.id==="{aid}"); return a.border.split(";").every(p => b.contains(p.split(",").map(Number))); }})()')
        check(inb and not pg.is_visible('.leaflet-popup'), f'{name}: knappen i rutan zoomar till området')
        pg.evaluate('__fk.map.setView([62, 15], 6, {animate:false})'); pg.wait_for_timeout(300)
        pg.click('#tab-filter'); pg.wait_for_timeout(400); pg.click(f'[data-act="area-zoom"][data-id="{aid}"]'); pg.wait_for_timeout(1000)
        inb=pg.evaluate(f'(() => {{ const b=__fk.map.getBounds(), a=__fk.state().areas.find(x => x.id==="{aid}"); return a.border.split(";").every(p => b.contains(p.split(",").map(Number))); }})()')
        check(inb, f'{name}: zoomknappen under Filter zoomar till området')
        # dölj området -> gränsen försvinner
        pg.click('#tab-filter'); pg.wait_for_timeout(500); pg.evaluate(f'document.getElementById("ar-{aid}").click()'); pg.wait_for_timeout(200)
        n=pg.evaluate('(() => { let n=0; __fk.map.eachLayer(l => { if(l instanceof L.Polygon && l.options.className !== "wind-sector") n++; }); return n; })()')
        check(n==0, f'{name}: släckt område döljer gränsen')
        pg.evaluate(f'document.getElementById("ar-{aid}").click()')
        # avbryt ändrar inget
        # redigera en befintlig gräns: lägga till och ta bort punkter mitt i
        orig=[x for x in pg.evaluate('__fk.state().areas') if x['id']==aid][0]['border'].split(';')
        pg.evaluate(f'__fk.openAreaForm("{aid}")'); pg.wait_for_timeout(200); pg.click('[data-ring-edit="0"]'); pg.wait_for_timeout(500)
        check(pg.locator('.drag-handle.border').count()==4 and pg.locator('.drag-handle.mid').count()==4 and pg.is_disabled('#drawUndo') and pg.is_hidden('#drawDel'), f'{name}: befintlig gräns laddas med 4 punkter och 4 plus mellan dem')
        P0=pg.evaluate('__fk.drawingPts()')
        pg.locator('.drag-handle.mid').nth(1).click(); pg.wait_for_timeout(300)
        P1=pg.evaluate('__fk.drawingPts()')
        mid=[(P0[1][0]+P0[2][0])/2, (P0[1][1]+P0[2][1])/2]
        check(len(P1)==5 and abs(P1[2][0]-mid[0]) < 1e-4 and abs(P1[2][1]-mid[1]) < 1e-4 and P1[1]==P0[1] and P1[3]==P0[2], f'{name}: tryck på + lägger in en punkt mellan punkt 2 och 3')
        # dra ett + till en ny plats
        mb=pg.locator('.drag-handle.mid').nth(0).bounding_box(); mx, my = mb['x']+mb['width']/2, mb['y']+mb['height']/2
        pg.mouse.move(mx, my); pg.mouse.down(); pg.mouse.move(mx+10, my-10, steps=4); pg.mouse.move(mx+20, my-30, steps=5); vis=pg.is_visible('.loupe'); pg.mouse.up(); pg.wait_for_timeout(300)
        P2=pg.evaluate('__fk.drawingPts()')
        dm=[(P1[0][0]+P1[1][0])/2, (P1[0][1]+P1[1][1])/2]
        check(len(P2)==6 and P2[0]==P1[0] and P2[2]==P1[1] and abs(P2[1][0]-dm[0]) > 1e-5 and vis, f'{name}: dra ett + lägger in en punkt där man släpper, med förstoringsglas')
        # markera och ta bort en punkt
        pg.locator('.drag-handle.border').nth(3).click(); pg.wait_for_timeout(200)
        check(pg.locator('.drag-handle.border.sel').count()==1 and pg.is_visible('#drawDel') and 'markerad' in pg.inner_text('#drawText'), f'{name}: tryck på en punkt markerar den')
        pg.click('#drawDel'); pg.wait_for_timeout(200)
        P3=pg.evaluate('__fk.drawingPts()')
        check(len(P3)==5 and P3==P2[:3]+P2[4:] and pg.is_hidden('#drawDel'), f'{name}: Ta bort punkt tar bort just den punkten')
        pg.click('#drawUndo'); pg.wait_for_timeout(150)
        check(pg.evaluate('__fk.drawingPts()')==P2, f'{name}: Ångra tar tillbaka den borttagna punkten')
        pg.click('#drawUndo'); pg.click('#drawUndo'); pg.wait_for_timeout(150)
        check(pg.evaluate('__fk.drawingPts()')==P0 and pg.is_disabled('#drawUndo'), f'{name}: Ångra flera gånger går tillbaka till den sparade gränsen')
        # en markerad punkt avmarkeras av ett tryck i kartan, som inte lägger till någon punkt
        pg.locator('.drag-handle.border').nth(0).click(); pg.wait_for_timeout(150)
        tap(box['x']+W*0.45, box['y']+H*0.6); pg.wait_for_timeout(250)
        check(pg.locator('.drag-handle.border.sel').count()==0 and len(pg.evaluate('__fk.drawingPts()'))==4, f'{name}: tryck i kartan tar bort markeringen utan att lägga till en punkt')
        pg.locator('.drag-handle.mid').nth(2).click(); pg.wait_for_timeout(200)
        pg.click('#drawCancel'); pg.wait_for_timeout(200)
        check([x for x in pg.evaluate('__fk.state().areas') if x['id']==aid][0]['border'].split(';')==orig, f'{name}: Avbryt lämnar gränsen orörd')
        pg.evaluate(f'__fk.openAreaForm("{aid}")'); pg.wait_for_timeout(200); pg.click('[data-ring-edit="0"]'); pg.wait_for_timeout(400)
        pg.locator('.drag-handle.mid').nth(0).click(); pg.wait_for_timeout(200); pg.click('#drawOk'); pg.wait_for_timeout(300)
        nb=[x for x in pg.evaluate('__fk.state().areas') if x['id']==aid][0]['border'].split(';')
        check(len(nb)==5 and nb[0]==orig[0] and nb[2:]==orig[1:], f'{name}: Klar sparar gränsen med den inlagda punkten, resten oförändrad')
        pg.evaluate(f'(() => {{ const a=__fk.state().areas.find(x => x.id === "{aid}"); a.border="{";".join(orig)}"; __fk.renderAll(); }})()')
        # import från KML
        pg.evaluate(f'__fk.openAreaForm("{aid}")'); pg.wait_for_timeout(200)
        with pg.expect_file_chooser() as fc: pg.click('#afImport')
        fc.value.set_files(os.path.join(B,'fixtures/border.kml')); pg.wait_for_timeout(500)
        b=[x for x in pg.evaluate('__fk.state().areas') if x['id']==aid][0]['border']
        kml='59.00000,17.00000;59.00000,17.01000;59.01000,17.01000;59.01000,17.00000'
        check(b==";".join(orig)+'|'+kml, f'{name}: KML-yta importerad som en ny gränsdel, den gamla finns kvar: {b[-60:]}')
        # flera gränsdelar i samma område
        n=pg.evaluate('(() => { let n=0; __fk.map.eachLayer(l => { if(l instanceof L.Polygon && l.options.className !== "wind-sector") n++; }); return n; })()')
        check(n==4, f'{name}: båda gränsdelarna ritas på kartan ({n} lager)')
        pg.evaluate(f'__fk.openAreaForm("{aid}")'); pg.wait_for_timeout(200)
        txt=pg.inner_text('.modal')
        check(pg.locator('[data-ring-edit]').count()==2 and 'Del 1' in txt and 'Del 2' in txt and 'Totalt' in txt and 'Rita en till del' in txt, f'{name}: områdesformuläret listar två delar och totalen')
        pg.click('[data-ring-edit="1"]'); pg.wait_for_timeout(400)
        check(pg.evaluate('__fk.drawingPts()')==[[59,17],[59,17.01],[59.01,17.01],[59.01,17]] and pg.evaluate('(() => { let n=0; __fk.map.eachLayer(l => { if(l instanceof L.Polygon && l.options.className !== "wind-sector") n++; }); return n; })()')==3, f'{name}: Ändra del 2 laddar just den delen, del 1 syns kvar')
        pg.locator('.drag-handle.mid').nth(0).click(); pg.wait_for_timeout(200); pg.click('#drawOk'); pg.wait_for_timeout(300)
        rs=[x for x in pg.evaluate('__fk.state().areas') if x['id']==aid][0]['border'].split('|')
        check(len(rs)==2 and rs[0]==";".join(orig) and len(rs[1].split(';'))==5, f'{name}: ändringen sparas i del 2, del 1 orörd')
        pg.evaluate(f'__fk.openAreaForm("{aid}")'); pg.wait_for_timeout(200); pg.click('#afDraw'); pg.wait_for_timeout(400)
        check(pg.evaluate('__fk.drawingPts()')==[], f'{name}: Rita en till del börjar med en tom del')
        for fx,fy in ((0.7,0.6),(0.8,0.6),(0.8,0.7)): tap(box['x']+W*fx, box['y']+H*fy); pg.wait_for_timeout(250)
        pg.click('#drawOk'); pg.wait_for_timeout(300)
        rs=[x for x in pg.evaluate('__fk.state().areas') if x['id']==aid][0]['border'].split('|')
        check(len(rs)==3 and rs[0]==";".join(orig) and 'delar' in pg.inner_text('#toast'), f'{name}: en tredje del läggs till: {pg.inner_text("#toast")}')
        pg.evaluate(f'__fk.openAreaForm("{aid}")'); pg.wait_for_timeout(200); pg.click('[data-ring-del="0"]'); pg.click('[data-ring-del="0"]'); pg.wait_for_timeout(300)
        rs=[x for x in pg.evaluate('__fk.state().areas') if x['id']==aid][0]['border'].split('|')
        check(len(rs)==2 and len(rs[0].split(';'))==5, f'{name}: en enskild del kan tas bort')
        pg.evaluate(f'__fk.openAreaForm("{aid}")'); pg.wait_for_timeout(200); pg.click('[data-ring-del="1"]'); pg.click('[data-ring-del="1"]'); pg.wait_for_timeout(300)
        r1=pg.evaluate('''__fk.parseRing('{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[17,59],[17.01,59],[17.01,59.01],[17,59]]]}}').length''')
        r2=pg.evaluate('''__fk.parseRing('<gpx><trk><trkseg><trkpt lat="59" lon="17"/><trkpt lat="59.01" lon="17"/><trkpt lat="59.01" lon="17.01"/></trkseg></trk></gpx>').length''')
        check(r1==4 and r2==3, f'{name}: GeoJSON-polygon och GPX-spår tolkas ({r1}, {r2})')
        # ta bort gräns
        pg.evaluate(f'__fk.openAreaForm("{aid}")'); pg.wait_for_timeout(200); pg.click('[data-ring-del="0"]'); pg.click('[data-ring-del="0"]'); pg.wait_for_timeout(300)
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
        shotn=lambda: pg.evaluate("[...document.querySelectorAll('img.shot-img')].filter(i => !i.closest('.loupe')).length")
        pg.evaluate(f'__fk.openAreaForm("{aid}")'); pg.wait_for_timeout(200)
        with pg.expect_file_chooser() as fc: pg.click('#afShot')
        fc.value.set_files(os.path.join(B,'tile_osm.png')); pg.wait_for_timeout(600)
        check(pg.is_visible('#ovImg') and pg.is_disabled('#ovNext'), f'{name}: skärmdumpen visas för att välja punkt 1')
        def img_click(u, v):
            bb=pg.locator('#ovImg').bounding_box(); pg.locator('#ovImg').click(position={'x':u/256*bb['width'], 'y':v/256*bb['height']}); pg.wait_for_timeout(150)
        img_click(32, 32); pg.click('#ovNext'); pg.wait_for_timeout(400)
        check(pg.is_visible('#ovbar') and 'korset' in pg.inner_text('#ovbar') and pg.locator('#map .crosshair:not([hidden])').count()==1, f'{name}: steg 1 i kartan med kors')
        check(pg.is_visible('.loupe'), f'{name}: förstoringsglas visas över korset')
        pg.evaluate('__fk.map.fire("contextmenu", {latlng: __fk.map.getCenter()})'); pg.wait_for_timeout(300)
        check(not pg.is_visible('#pinForm'), f'{name}: långt tryck i kartan under inpassningen öppnar inte nålformuläret')
        lz=pg.evaluate('__fk.loupe.map.getZoom() - __fk.map.getZoom()')
        check(abs(lz - 1.585) < 0.01, f'{name}: förstoringsglaset visar 3 gånger större (zoom +{lz:.3f})')
        A=(box['x']+W*0.3, box['y']+H*0.25); Bp=(box['x']+W*0.65, box['y']+H*0.4)
        cl=lambda P: pg.evaluate(f"(() => {{ const r=__fk.map.getContainer().getBoundingClientRect(); const ll=__fk.map.containerPointToLatLng([{P[0]}-r.left, {P[1]}-r.top]); return {{lat:ll.lat, lng:ll.lng}}; }})()")
        llA=cl(A); llB=cl(Bp)
        tap(*A); pg.wait_for_timeout(900)
        c=pg.evaluate('__fk.crossLatLng()')
        check(abs(c['lat']-llA['lat']) < 2e-4 and abs(c['lng']-llA['lng']) < 2e-4, f'{name}: tryck i kartan flyttar korset dit')
        lc=pg.evaluate('__fk.loupe.map.getCenter()')
        check(abs(lc['lat']-c['lat']) < 1e-6 and abs(lc['lng']-c['lng']) < 1e-6, f'{name}: förstoringsglaset följer korset')
        pg.evaluate(f"__fk.panToCross([{llA['lat']}, {llA['lng']}])")
        pg.click('#ovMapOk'); pg.wait_for_timeout(300)
        check(pg.is_visible('#ovImg') and pg.locator('.shot-mark.first').count()==1 and not pg.is_visible('.loupe'), f'{name}: punkt 2 väljs i bilden, punkt 1 är markerad')
        img_click(224, 160); pg.click('#ovNext'); pg.wait_for_timeout(300)
        check(pg.locator('.drag-handle.shot.first').count()==1, f'{name}: den första punkten går att dra under steg 2')
        pg.evaluate(f"__fk.panToCross([{llB['lat']}, {llB['lng']}])")
        pg.click('#ovMapOk'); pg.wait_for_timeout(900)
        sh=lambda: pg.evaluate('__fk.shots()[0]')
        check(shotn()==1 and pg.is_visible('#ovDrawBorder') and len(pg.evaluate('__fk.shots()'))==1, f'{name}: bilden ligger på kartan')
        g1=pg.evaluate('__fk.shotImgToLatLng(__fk.shots()[0], 32, 32)'); g2=pg.evaluate('__fk.shotImgToLatLng(__fk.shots()[0], 224, 160)')
        e1=max(abs(g1['lat']-llA['lat']), abs(g1['lng']-llA['lng'])); e2=max(abs(g2['lat']-llB['lat']), abs(g2['lng']-llB['lng']))
        check(e1 < 2e-4 and e2 < 2e-4 and pg.locator('#map .crosshair:not([hidden])').count()==0, f'{name}: bildens punkter hamnar där de pekades ut i kartan (fel {e1:.1e}, {e2:.1e} grader)')
        ok=pg.evaluate("""(() => { const img=[...document.querySelectorAll('img.shot-img')].find(i => !i.closest('.loupe')), r=img.getBoundingClientRect(), m=__fk.map, c=m.getContainer().getBoundingClientRect(), s=__fk.shots()[0];
          const pts=[[0,0],[256,0],[256,256],[0,256]].map(([u,v]) => m.latLngToContainerPoint(__fk.shotImgToLatLng(s,u,v)));
          const xs=pts.map(p=>p.x+c.left), ys=pts.map(p=>p.y+c.top);
          return Math.abs(Math.min(...xs)-r.left) < 3 && Math.abs(Math.max(...xs)-r.right) < 3 && Math.abs(Math.min(...ys)-r.top) < 3 && Math.abs(Math.max(...ys)-r.bottom) < 3; })()""")
        check(ok, f'{name}: bilden ritas med rätt skala och vridning på skärmen')
        third=pg.evaluate("""(() => { const s=__fk.shots()[0], m=__fk.map, save=s.pts.map(p => p.ll);
          const th=0.35, sc=1.7, T=(u,v) => L.point(sc*(Math.cos(th)*u - Math.sin(th)*v) + 100, sc*(Math.sin(th)*u + Math.cos(th)*v) + 50);
          s.pts[0].ll=m.layerPointToLatLng(T(s.pts[0].u, s.pts[0].v)); s.pts[1].ll=m.layerPointToLatLng(T(s.pts[1].u, s.pts[1].v));
          const got=__fk.shotImgToLatLng(s, 200, 40), want=m.layerPointToLatLng(T(200, 40));
          s.pts.forEach((p, i) => { p.ll=save[i]; });
          return Math.max(Math.abs(got.lat-want.lat), Math.abs(got.lng-want.lng)); })()""")
        check(third < 1e-9, f'{name}: en tredje punkt hamnar rätt vid känd vridning och skala (fel {third:.1e})')
        # rita gräns med bilden under, bilden ligger kvar efteråt
        pg.click('#ovDrawBorder'); pg.wait_for_timeout(300); pg.select_option('#obArea', aid); pg.click('#obGo'); pg.wait_for_timeout(300)
        check(pg.is_visible('#drawbar') and pg.is_hidden('#ovbar') and shotn()==1, f'{name}: ritläge med bilden kvar under')
        for fx,fy in ((0.3,0.25),(0.65,0.25),(0.65,0.4)): tap(box['x']+W*fx, box['y']+H*fy); pg.wait_for_timeout(250)
        check(pg.locator('.drag-handle.border').count()==3 and pg.is_visible('.loupe'), f'{name}: tre dragbara hörn, förstoringsglaset visas när en punkt läggs till')
        # dra ett hörn: punkten flyttas och förstoringsglaset visas under dragningen
        hb=pg.locator('.drag-handle.border').nth(1).bounding_box(); hx, hy = hb['x']+hb['width']/2, hb['y']+hb['height']/2
        before=pg.evaluate('__fk.drawingPts()[1]')
        pg.mouse.move(hx, hy); pg.mouse.down(); pg.mouse.move(hx+15, hy+10, steps=4); pg.mouse.move(hx+40, hy+30, steps=6); pg.wait_for_timeout(100)
        mid_loupe=pg.is_visible('.loupe')
        pg.mouse.up(); pg.wait_for_timeout(200)
        after=pg.evaluate('__fk.drawingPts()[1]')
        check(mid_loupe and (abs(after[0]-before[0]) > 1e-5 or abs(after[1]-before[1]) > 1e-5) and len(pg.evaluate('__fk.drawingPts()'))==3, f'{name}: ett hörn kan dras till rätt plats, med förstoringsglas')
        pg.click('#drawOk'); pg.wait_for_timeout(400)
        ar=[x for x in pg.evaluate('__fk.state().areas') if x['id']==aid][0]
        check(len((ar.get('border') or '').split(';'))==3 and shotn()==1 and pg.is_visible('#btnAdd'), f'{name}: gränsen sparad, bilden ligger kvar och + syns')
        # lägga ut pass med bilden kvar, med förstoringsglas över korset
        pg.click('#btnAdd'); pg.wait_for_timeout(400)
        check(pg.is_visible('#placebar') and pg.is_visible('.loupe') and shotn()==1, f'{name}: lägga ut pass med bilden kvar och förstoringsglas över korset')
        pg.click('#placeCancel'); pg.wait_for_timeout(200)
        check(not pg.is_visible('.loupe'), f'{name}: förstoringsglaset försvinner när man avbryter')
        # lista, släck och tänd
        pg.click('#btnLayers'); pg.wait_for_timeout(200)
        check(pg.locator('[data-shot-vis]').count()==1, f'{name}: skärmdumpen finns i lagermenyn')
        pg.uncheck('[data-shot-vis]'); pg.wait_for_timeout(200)
        check(shotn()==0, f'{name}: skärmdumpen kan släckas tillfälligt')
        pg.check('[data-shot-vis]'); pg.wait_for_timeout(200)
        check(shotn()==1, f'{name}: och tändas igen')
        # justera: dra mitten flyttar hela bilden, dra en punkt skalar och vrider
        pg.click('[data-shot-edit]'); pg.wait_for_timeout(300); pg.click('#seAdjust'); pg.wait_for_timeout(400)
        check(pg.locator('.drag-handle.shot').count()==3, f'{name}: två punkter och ett mitthandtag att dra')
        p0=sh()['pts']
        mb=pg.locator('.drag-handle.shot.move').bounding_box(); mx, my = mb['x']+mb['width']/2, mb['y']+mb['height']/2
        pg.mouse.move(mx, my); pg.mouse.down(); pg.mouse.move(mx+20, my, steps=4); pg.mouse.move(mx+50, my+20, steps=6); pg.mouse.up(); pg.wait_for_timeout(300)
        p1=sh()['pts']
        d0=(p1[0]['ll']['lat']-p0[0]['ll']['lat'], p1[0]['ll']['lng']-p0[0]['ll']['lng']); d1=(p1[1]['ll']['lat']-p0[1]['ll']['lat'], p1[1]['ll']['lng']-p0[1]['ll']['lng'])
        check(abs(d0[1]) > 1e-5 and abs(d0[0]-d1[0]) < 1e-6 and abs(d0[1]-d1[1]) < 1e-6, f'{name}: mitthandtaget flyttar hela bilden lika mycket')
        hb=pg.locator('.drag-handle.shot.first').bounding_box(); hx, hy = hb['x']+hb['width']/2, hb['y']+hb['height']/2
        pg.mouse.move(hx, hy); pg.mouse.down(); pg.mouse.move(hx-15, hy-10, steps=4); pg.mouse.move(hx-40, hy-30, steps=6); vis=pg.is_visible('.loupe'); pg.mouse.up(); pg.wait_for_timeout(300)
        p2=sh()['pts']
        check(vis and abs(p2[0]['ll']['lng']-p1[0]['ll']['lng']) > 1e-5 and p2[1]['ll']==p1[1]['ll'], f'{name}: en punkt kan dras för att skala och vrida, med förstoringsglas')
        pg.click('#ovAdjDone'); pg.wait_for_timeout(200)
        check(pg.locator('.drag-handle.shot').count()==0 and pg.is_visible('#btnAdd'), f'{name}: justeringen avslutas')
        # finns kvar efter omladdning
        pg.reload(); pg.wait_for_timeout(1500)
        check(len(pg.evaluate('__fk.shots()'))==1 and shotn()==1 and pg.evaluate('__fk.shots()[0].pts')==p2, f'{name}: skärmdumpen och dess läge finns kvar efter omladdning')
        # ta bort
        pg.click('#btnLayers'); pg.wait_for_timeout(200); pg.click('[data-shot-edit]'); pg.wait_for_timeout(300); pg.click('#seDel'); pg.click('#seDel'); pg.wait_for_timeout(300)
        check(len(pg.evaluate('__fk.shots()'))==0 and shotn()==0, f'{name}: skärmdumpen tas bort')
        pg.reload(); pg.wait_for_timeout(1200)
        check(len(pg.evaluate('__fk.shots()'))==0, f'{name}: borttagen även efter omladdning')
        box=pg.locator('#map').bounding_box(); W,H=box['width'],box['height']
        # flytta gräns, väg och nålar till ett annat område
        other=[x for x in pg.evaluate('__fk.state().areas') if x['id']!=aid][0]['id']
        pg.evaluate(f"""(() => {{ const a=__fk.state().areas.find(x => x.id === "{aid}"); a.lines={{'l-9':{{k:'road', p:'58.72,14.60;58.721,14.601'}}}}; }})()""")
        npins=len([p for p in pg.evaluate('__fk.state().pins') if p['areaId']==aid])
        pg.evaluate(f'__fk.openAreaForm("{aid}")'); pg.wait_for_timeout(200)
        pg.click('#afMoveBox summary'); pg.select_option('#afMoveTo', other); pg.click('#afMove'); pg.wait_for_timeout(300)
        st=pg.evaluate('__fk.state()'); src=[x for x in st['areas'] if x['id']==aid][0]; dst=[x for x in st['areas'] if x['id']==other][0]
        check(not src.get('border') and not src.get('lines') and dst.get('border') and 'l-9' in (dst.get('lines') or {}) and len([p for p in st['pins'] if p['areaId']==other]) >= npins and not [p for p in st['pins'] if p['areaId']==aid], f'{name}: gräns, väg och {npins} nålar flyttade till ett annat område')
        check('Flyttade' in pg.inner_text('#toast'), f'{name}: bekräftelse visas: {pg.inner_text("#toast")}')
        pg.evaluate(f'(() => {{ const a=__fk.state().areas.find(x => x.id === "{other}"); delete a.border; delete a.lines; __fk.renderAll(); }})()')
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
