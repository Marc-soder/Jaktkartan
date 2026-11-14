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

## Meddelanden via Meshtastic (väntar)

Krypterade meddelanden i appen finns (`src/msg.js`). Målet är att också kunna välja att skicka via Meshtastic
till deltagare som har en Meshtastic-radio, så att meddelandet når fram utan mobiltäckning.

### Så fungerar det i Meshtastic

- Sedan firmware 2.5 krypteras **direktmeddelanden** med publika nycklar (x25519 och AES-CCM). Varje radio har ett eget nyckelpar,
  och bara mottagarens radio kan läsa meddelandet. Saknar avsändaren mottagarens publika nyckel skickas inget,
  och avsändaren får felet `PKI_SEND_FAIL_PUBLIC_KEY`.
- Meddelanden på en **kanal** kan läsas av alla som har kanalnyckeln. Ett meddelande "till flera" ska därför skickas som
  ett direktmeddelande till var och en, inte på kanalen.
- Ett meddelande får vara högst cirka 200 tecken.
- Använd aktuell firmware. Flera säkerhetsfel i den första versionen av den publika krypteringen är rättade i senare versioner, se Meshtastics CVE-meddelanden.

### Vad som behöver byggas

1. **Ansluta radion från webbappen** med Web Bluetooth (eller Web Serial/USB) via `@meshtastic/core` och
   `@meshtastic/transport-web-bluetooth`: `new MeshDevice(await TransportWebBluetooth.create())`, `configure()`,
   och sedan `sendText(text, nodnummer, wantAck)` för direktmeddelanden. Inkommande meddelanden kommer via `onMessagePacket`.
   - **Licens:** biblioteken är GPL-3.0. Ägaren valde att vänta med det här. Alternativen är att göra Jaktkartan GPL-3.0
     eller att hämta biblioteket från ett CDN när radion ansluts (en juridisk gråzon).
2. **Koppla deltagare till radio:** varje deltagare sparar sitt nod-id (t.ex. `!a1b2c3d4`) i jakten, antingen automatiskt
   när radion ansluts eller genom att skriva in det. Det behövs en ny nod i reglerna, till exempel `groups/<lag>/meshNodes/<uid>`,
   och regeltester.
3. **Välja väg när man skickar:** "App" eller "Meshtastic" (eller båda). Meshtastic går bara att välja för mottagare som har
   ett nod-id, och bara när avsändarens radio är ansluten. Visa en varning om texten är för lång.
4. **Ta emot:** är mottagarens radio ansluten till Jaktkartan visas meddelandet i appen. Annars läses det i Meshtastic-appen.
   En radio kan ofta bara vara ansluten till en app i taget via Bluetooth.
5. **Tester:** en låtsasradio i testerna (testerna ska gå utan nätverk och utan hårdvara), och skarpa prov med riktiga radioapparater.

### Begränsningar

- **iPhone:** webbläsare på iPhone har inte Web Bluetooth. Den som skickar via Meshtastic från Jaktkartan behöver Android
  (Chrome) eller en dator. Den som har iPhone kan ta emot genom att skriva in sitt nod-id och läsa i Meshtastic-appen.
- Det går inte att testa i CI mot riktiga radioapparater.

Källor: [Meshtastic: publik nyckelkryptering i 2.5](https://meshtastic.org/blog/introducing-new-public-key-cryptography-in-v2_5/),
[Meshtastic: krypteringens begränsningar](https://meshtastic.org/docs/about/overview/encryption/limitations/),
[@meshtastic/core: MeshDevice.sendText](https://jsr.io/@meshtastic/core/doc/~/MeshDevice.prototype.sendText).
