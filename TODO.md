# Att göra

## Garmin-pejlar live under jakten (väntar)

Målet är att se hundarnas positioner från Garmins hundpejlar (Alpha eller Astro med halsband) i Jaktkartan medan jakten pågår.

### Varför det inte är enkelt

Garmin har inget öppet API för hundpositioner. Det gäller handenheten, appen Garmin Alpha och Alpha LTE.
Positionerna går från halsbandet till handenheten via radio. Handenheten sänder dem sedan vidare över **ANT+**,
med ANT-profilen *Tracker*, till kompatibla Garmin-klockor. Det är den vägen vi kan använda.

```
Halsband ──radio──> Alpha-handenhet ──ANT+──> Garmin-klocka (Connect IQ-app) ──Bluetooth──> telefon (Garmin Connect) ──mobilnät──> Firebase ──> Jaktkartan
```

### Det här krävs

1. **En Garmin-klocka som tar emot hundarna från handenheten och kan köra Connect IQ-appar.**
   Fenix, Epix och Tactix har haft det. Kontrollera att just den modellen visar hundarna från er Alpha eller Astro i klockan.
   Klockan måste vara nära handenheten (ANT+ når några meter), så samma person bär båda.
2. **En telefon med Garmin Connect** som är parkopplad med klockan och har mobiltäckning.
   Connect IQ-appar når internet via telefonen.
3. **En egen Connect IQ-app**, skriven i Monkey C, som
   - lyssnar på ANT+ Tracker-meddelanden och läser ut varje hunds id, latitud och longitud
   - skickar positionerna med HTTPS POST var 10–30:e sekund, via `Communications.makeWebRequest`
   - har en inställning för jaktens **hundkod** (se nedan) och ett namn per hund.

   Förebild: [DogTracker](https://github.com/mikkosh/DogTracker), en öppen Connect IQ-app som tar emot hundpositioner via ANT+
   och skickar dem till en webbadress. Upphovspersonen skriver att den inte är färdig för riktig användning.
   ANT-profilen *Tracker* beskriver meddelandenas format. Den finns på thisisant.com och kräver konto.
4. **Ändringar i Jaktkartan**
   - En **hundkod** per jakt, till exempel `huntDogKeys/<kod> = {gid, hid, expires}`, skapad av jaktledaren på jaktkortet.
     Den fungerar som jaktkoden för gäster, men är bara till för att skriva hundpositioner.
   - En nod för positionerna: `groups/<lag>/huntDogs/<jakt>/<hund> = {lat, lng, t, name}`.
     Den ska ha samma åtkomst som `huntPos`: bara läsas medan jakten pågår och bara av jaktens deltagare.
     Den raderas när jakten avslutas, tillsammans med resten av jakten.
   - **Hur klockan skriver.** Klockan kan inte logga in med Google. Två alternativ:
     - (a) anonym inloggning via Firebase Auth REST, med hundkoden som bevis, på samma sätt som gäster går med i dag
     - (b) en liten server, till exempel en Cloud Function, som tar emot POST med hundkoden och skriver till databasen.
       Kräver Firebase Blaze-abonnemanget.

     (a) behöver ingen server men kräver mer logik i klockappen. Börja med att pröva (a).
   - Säkerhetsregler och regeltester i `tests/test2.js`, och låtsassvar i testerna. Testerna ska gå utan nätverk.
   - Kartan: hundarna som egna ikoner med namn och färg, spår de senaste minuterna (som spåren för personer),
     och tiden sedan senaste positionen.

### Begränsningar att berätta för laget

- Det fungerar bara när klockan är nära handenheten och telefonen har täckning. Utan täckning visas den senaste positionen.
- Klockans batteri går åt fortare.
- Om Garmin ändrar ANT+-profilen eller Connect IQ kan klockappen sluta fungera.
- Klockappen går inte att testa i CI. Den måste provas med riktiga pejlar.

### Innan arbetet börjar

- Ta reda på vilken handenhet och vilka halsband laget har, och vilken Garmin-klocka som ska användas.
- Kontrollera i klockan att hundarna syns där. Annars fungerar inte den här vägen.

### Andra vägar som undersökts

- **Exportera hundspåren som GPX efter jakten** och importera dem: enkelt och pålitligt, men inte live.
- **inReach (Alpha 200i/300i), MapShare KML-flöde:** visar handenhetens position, inte hundarnas (inte bekräftat),
  uppdateras med några minuters mellanrum och kräver en server som hämtar flödet.
- **Web Bluetooth direkt mot handenheten:** protokollet är inte dokumenterat, och iPhone saknar Web Bluetooth. Går inte.
