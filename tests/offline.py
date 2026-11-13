"""Gemensamt för Python-testerna: svarar på anrop till Firebase och typsnitt utan nätverk."""
# Utloggad låtsas-Firebase. Molnfunktionerna testas på riktigt i test2.js.
FIREBASE_STUB = """
window.firebase = {apps: [], initializeApp(){ this.apps.push(1); },
  auth(){ return {currentUser: null, onAuthStateChanged(cb){ setTimeout(() => cb(null), 0); }}; },
  database(){ const ref = () => ({on(){}, off(){}, get: () => Promise.resolve({val: () => null, exists: () => false})}); return {ref}; }};
"""


def offline(r):
    """Hanterar Firebase och Google Fonts. Returnerar True om anropet är besvarat."""
    u = r.request.url
    if 'gstatic.com/firebasejs' in u:
        r.fulfill(status=200, content_type='text/javascript', body=FIREBASE_STUB if 'firebase-app-compat' in u else '')
        return True
    if 'api.open-meteo.com' in u:   # vinden är påslagen från början
        r.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'},
                  body='{"current":{"time":"2026-11-13T07:00","wind_speed_10m":3,"wind_direction_10m":270,"wind_gusts_10m":5}}')
        return True
    if 'fonts.googleapis' in u or 'fonts.gstatic' in u:
        r.fulfill(status=200, content_type='text/css', body='')
        return True
    return False
