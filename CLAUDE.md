# Instruktioner för Claude

Jaktkartan är en webbapp för jaktlag. Sidan publiceras med GitHub Pages från `main`, och delad data ligger i Firebase.
Svara ägaren på svenska.

## Arbetssätt med PR
- **Öppna en PR automatiskt** när en ändring är klar och alla tester går igenom. Fråga inte först.
- Är PR:en från samma gren fortfarande öppen: **lägg till nya ändringar på samma gren**, så uppdateras den öppna PR:en.
- Är den mergad: börja nästa ändring från senaste `main`, i en ny PR.
- **Merga aldrig själv.** Ägaren mergar när CI är grönt.
- Bevaka PR:en efter att den öppnats, och rätta själv om CI blir rött.

## Innan en ändring pushas
1. Ändra i `src/`, inte i `index.html` eller `database.rules.json` direkt.
2. `npm run build` bygger om `index.html` och `database.rules.json`. Båda ska committas.
3. `npm run check` och `npm test` ska gå igenom. Lägg till tester för nya funktioner.
   Se README för hur testerna körs. I en molnsession: sätt `CHROME_PATH` till den förinstallerade Chromium.
4. Testerna ska gå utan nätverk. Nya externa tjänster behöver ett låtsassvar i testerna (se `tests/offline.py`).

## Säkerhetsregler för Firebase
- Reglerna skrivs i `src/rules.js`. Lägg till regeltester i `tests/test2.js` när de ändras.
- Firebase uppdateras **inte** automatiskt. När `database.rules.json` ändras: säg tydligt till ägaren att reglerna
  måste klistras in i Firebase-konsolen (Realtime Database → Regler → Publicera), och om det ska ske före eller efter merge.
- Delad data under en jakt (positioner, spår, observationer) ligger per jakt och får bara gå att läsa och skriva medan jakten pågår.

## Repot är publikt
- Lägg aldrig in personliga uppgifter: e-postadresser, riktiga koordinater för jaktmarker, pass eller torn,
  fastighetsbeteckningar, inloggningsuppgifter eller nycklar. Firebase-konfigurationen i `src/cloud.js` är inte hemlig.
- Exempeldata och testdata ska ligga på påhittade platser (exempelnålarna ligger i Tiveden).
- Skärmdumpar och kartdata som ägaren delar i chatten används bara i chatten, aldrig i repot.
