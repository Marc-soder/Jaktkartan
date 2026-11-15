"""Bygger index.html och database.rules.json från filerna i src/.

Körs från repots rot efter `npm ci`:
    python3 src/build.py            # skriver index.html, database.rules.json, sw.js, manifest.webmanifest och icons/
    python3 src/build.py --check    # bygger i minnet och kontrollerar att filerna i repot är aktuella
"""
import hashlib, json, os, subprocess, sys

SRC = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SRC)
LEAFLET = os.path.join(ROOT, 'node_modules', 'leaflet', 'dist')


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def build():
    src = read(os.path.join(SRC, 'src.html'))
    css = read(os.path.join(LEAFLET, 'leaflet.css'))
    js = read(os.path.join(LEAFLET, 'leaflet.js')).replace('//# sourceMappingURL=leaflet.js.map', '')
    rules = subprocess.check_output(['node', '-e', 'process.stdout.write(JSON.stringify(require(process.argv[1]), null, 2))',
                                     os.path.join(SRC, 'rules.js')]).decode('utf-8')
    cloud = read(os.path.join(SRC, 'cloud.js')).replace("/*RULES_JSON*/''", json.dumps(rules, ensure_ascii=False))
    inj = read(os.path.join(SRC, 'vilt.js')) + '\n' + cloud + '\n' + read(os.path.join(SRC, 'loupe.js')) + '\n' + read(os.path.join(SRC, 'border.js')) + '\n' + read(os.path.join(SRC, 'overlay.js')) + '\n' + read(os.path.join(SRC, 'tools.js')) + '\n' + read(os.path.join(SRC, 'plan.js')) + '\n' + read(os.path.join(SRC, 'msg.js'))
    for k in ('/*LEAFLET_CSS*/', '/*LEAFLET_JS*/', '/*INJECT*/'):
        assert src.count(k) == 1, k
    assert '</script' not in inj
    html = src.replace('/*INJECT*/', inj).replace('/*LEAFLET_CSS*/', css).replace('/*LEAFLET_JS*/', js.replace('</script', '<\\/script'))
    return html, rules


def outputs():
    """Alla filer som byggs, som bytes. Service workern får en version från index.html, så att telefoner hämtar nya versioner."""
    html, rules = build()
    out = {'index.html': html.encode('utf-8'), 'database.rules.json': rules.encode('utf-8')}
    version = hashlib.sha1(out['index.html']).hexdigest()[:10]
    sw = read(os.path.join(SRC, 'sw.js'))
    assert sw.count('/*VERSION*/') == 1
    out['sw.js'] = sw.replace('/*VERSION*/', version).encode('utf-8')
    out['manifest.webmanifest'] = open(os.path.join(SRC, 'manifest.webmanifest'), 'rb').read()
    for name in sorted(os.listdir(os.path.join(SRC, 'icons'))):
        out['icons/' + name] = open(os.path.join(SRC, 'icons', name), 'rb').read()
    return out


def main():
    targets = {os.path.join(ROOT, k): v for k, v in outputs().items()}
    if '--check' in sys.argv:
        stale = [os.path.relpath(p, ROOT) for p, data in targets.items() if not os.path.exists(p) or open(p, 'rb').read() != data]
        if stale:
            print('Inaktuella filer: ' + ', '.join(stale) + '. Kör `npm run build` och committa resultatet.')
            sys.exit(1)
        print('index.html, database.rules.json och appfilerna stämmer med src/.')
        return
    for p, data in targets.items():
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'wb') as f:
            f.write(data)
        print(f'{os.path.relpath(p, ROOT)}: {len(data)} byte')


if __name__ == '__main__':
    main()
