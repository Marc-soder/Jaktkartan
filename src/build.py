import sys, json, subprocess
src=open('src.html',encoding='utf-8').read()
css=open('node_modules/leaflet/dist/leaflet.css',encoding='utf-8').read()
js=open('node_modules/leaflet/dist/leaflet.js',encoding='utf-8').read().replace('//# sourceMappingURL=leaflet.js.map','')
subprocess.check_call(['node','rules.js','database.rules.json'])
rules=open('database.rules.json',encoding='utf-8').read()
cloud=open('cloud.js',encoding='utf-8').read().replace("/*RULES_JSON*/''", json.dumps(rules, ensure_ascii=False))
inj=open('vilt.js',encoding='utf-8').read()+'\n'+cloud+'\n'+open('border.js',encoding='utf-8').read()
for k in ('/*LEAFLET_CSS*/','/*LEAFLET_JS*/','/*INJECT*/'): assert src.count(k)==1,k
out=src.replace('/*INJECT*/',inj).replace('/*LEAFLET_CSS*/',css).replace('/*LEAFLET_JS*/',js.replace('</script','<\\/script'))
assert '</script' not in inj
open(sys.argv[1],'w',encoding='utf-8').write(out)
print(len(out))
