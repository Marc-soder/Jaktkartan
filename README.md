# Jaktkartan

En karta för jaktlaget, med nålar, områden, gränser, skogsvägar, jakttider och svampställen. Den fungerar på mobil och dator.
Jaktlaget delar data med varandra via Firebase.

**Sidan:** https://marc-soder.github.io/Jaktkartan/

## Så publiceras sidan

GitHub Pages publicerar `index.html` från `main`. När en PR mergas uppdateras sidan automatiskt inom någon minut.
Det går att följa under fliken **Actions** (jobbet "pages build and deployment").

GitHub kör **inte** byggsteget. `index.html` måste alltså vara ombyggd och committad i samma PR som ändringen i `src/`.
CI stoppar en PR där det har glömts.

### Säkerhetsreglerna publiceras inte automatiskt

`database.rules.json` är reglerna för Firebase Realtime Database. När den ändras visar CI en varning i PR:en.
Efter merge klistrar du in den nya filen i Firebase-konsolen under Realtime Database → Regler → Publicera.

## Filer

| Fil / mapp | Innehåll |
|---|---|
| `index.html` | Den färdiga sidan, byggd från `src/`. Ändra inte direkt. |
| `database.rules.json` | Säkerhetsregler för Firebase, byggda från `src/rules.js`. Ändra inte direkt. |
| `src/src.html` | Sidans HTML, CSS och huvudsakliga JavaScript. |
| `src/vilt.js` | Jakttider per art och län. |
| `src/cloud.js` | Jaktlag, inbjudningar, gäster, positioner, spår och synk mot Firebase. |
| `src/border.js` | Gränser för jaktmarken, skogsvägar och egna vägar och stigar. |
| `src/loupe.js` | Förstoringsglas som visas när man placerar eller drar en punkt. |
| `src/overlay.js` | Skärmdumpar ovanpå kartan, som hjälp att rita gränser och lägga ut pass. Sparas bara i webbläsaren. |
| `src/rules.js` | Säkerhetsreglerna för Firebase. |
| `src/build.py` | Bygger `index.html` och `database.rules.json`. |
| `tests/` | Webbläsartester med Playwright, och testfiler. |

## Bygga och testa lokalt

Kräver Node 22 och Python 3.

```sh
npm ci                                   # Leaflet, Playwright och regeltestaren
pip install -r tests/requirements.txt    # Playwright för Python
npx playwright install chromium
python3 -m playwright install chromium

npm run build    # bygger index.html och database.rules.json från src/
npm run check    # kontrollerar att de byggda filerna är aktuella
npm test         # kör alla tester
```

Testerna går utan nätverk. Kartrutor, GBIF, OpenStreetMap och Firebase ersätts med låtsassvar.
`tests/test2.js` prövar varje läsning och skrivning mot de riktiga säkerhetsreglerna.
Skärmbilder hamnar i `tests/shots/`.
Om du vill använda en befintlig Chrome i stället för Playwrights, sätt `CHROME_PATH` till sökvägen.

## CI

`.github/workflows/ci.yml` körs på varje PR och varje push till `main`:

- kontrollerar att `index.html` och `database.rules.json` är byggda från `src/`
- kör alla tester
- varnar med en kommentar i PR:en om säkerhetsreglerna ändras
