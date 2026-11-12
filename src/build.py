"""Bygger index.html och database.rules.json från filerna i src/.

Körs från repots rot efter `npm ci`:
    python3 src/build.py            # skriver index.html och database.rules.json
    python3 src/build.py --check    # bygger i minnet och kontrollerar att filerna i repot är aktuella
"""
import json, os, subprocess, sys

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
    inj = read(os.path.join(SRC, 'vilt.js')) + '\n' + cloud + '\n' + read(os.path.join(SRC, 'loupe.js')) + '\n' + read(os.path.join(SRC, 'border.js')) + '\n' + read(os.path.join(SRC, 'overlay.js'))
    for k in ('/*LEAFLET_CSS*/', '/*LEAFLET_JS*/', '/*INJECT*/'):
        assert src.count(k) == 1, k
    assert '</script' not in inj
    html = src.replace('/*INJECT*/', inj).replace('/*LEAFLET_CSS*/', css).replace('/*LEAFLET_JS*/', js.replace('</script', '<\\/script'))
    return html, rules


def main():
    html, rules = build()
    targets = {os.path.join(ROOT, 'index.html'): html, os.path.join(ROOT, 'database.rules.json'): rules}
    if '--check' in sys.argv:
        stale = [os.path.relpath(p, ROOT) for p, text in targets.items() if not os.path.exists(p) or read(p) != text]
        if stale:
            print('Inaktuella filer: ' + ', '.join(stale) + '. Kör `npm run build` och committa resultatet.')
            sys.exit(1)
        print('index.html och database.rules.json stämmer med src/.')
        return
    for p, text in targets.items():
        with open(p, 'w', encoding='utf-8', newline='') as f:
            f.write(text)
        print(f'{os.path.relpath(p, ROOT)}: {len(text)} tecken')


if __name__ == '__main__':
    main()
