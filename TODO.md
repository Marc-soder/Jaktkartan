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

### Börja utan att bygga något

Meshtastic har egna gratisappar:
- Android (Google Play och F-Droid)
- iPhone, iPad och Mac (App Store)
- en webbklient, client.meshtastic.org, för Chrome och Edge på dator och Android

Laget kan använda dem parallellt med Jaktkartan redan nu, även med iPhone:
1. Var och en kopplar sin radio till sin telefon i Meshtastic-appen via Bluetooth.
2. Skapa en **egen privat kanal** med egen nyckel för jaktlaget och dela den med QR-kod.
   Använd inte den öppna standardkanalen. Allt som skrivs på kanalen kan läsas av alla som har kanalnyckeln.
3. Till en person skickar man ett **direktmeddelande** från nodlistan. Med firmware 2.5 eller nyare kan bara mottagarens radio läsa det.
4. Vissa radioapparater med skärm och knappar eller tangentbord kan skicka färdiga snabbmeddelanden utan telefon,
   till exempel "Klar", "Vilt på väg" eller "Behöver hjälp".

Prova under en jakt och se om räckvidden i terrängen räcker, innan något byggs i Jaktkartan.
En koppling i Jaktkartan ger framför allt två saker: meddelandena på ett ställe med jaktens mottagarlista,
och möjligheten att välja Meshtastic när mobiltäckningen saknas.

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
   - **Licens:** biblioteken är GPL-3.0. Ägaren valde att vänta med det här. Alternativen:
     - **Göra Jaktkartan GPL-3.0** och bygga in biblioteket. Det är enklast och juridiskt säkrast, och repot är redan publikt.
     - **Hämta biblioteket från ett CDN** när radion ansluts. Det är en juridisk gråzon och kräver nät första gången.
     - **Skriva en egen minimal Bluetooth-koppling** i stället för att använda deras bibliotek. Det föreslogs av Gemini,
       och en självständigt skriven koppling mot ett protokoll är i regel inte en kopia av deras kod.
       Haken är att Meshtastics **protobuf-definitioner** (`.proto`-filerna, och npm-paketet `@meshtastic/protobufs`) också är GPL-3.0.
       Kopierar man dem, eller genererar kod från dem, är man tillbaka i samma fråga. Kodningen måste då skrivas själv,
       med fältnummer och format hämtade ur dokumentationen, och bara för det som behövs: handskakningen
       (`want_config_id`), ett textpaket till en nod (`MeshPacket` med `TEXT_MESSAGE_APP`, `to`, `want_ack`)
       och att läsa inkommande paket. Uppskattningsvis några hundra rader.
       Krypteringen av direktmeddelanden sköts av radion, inte av appen.
       Nackdelar: vi måste själva hålla kopplingen uppdaterad när Meshtastic ändrar protokollet, och den kan bara testas
       mot riktiga radioapparater utanför CI. Gränsen mellan att använda ett gränssnitt och att kopiera kod är juridiskt
       omdiskuterad. Det här är en bedömning, inte juridisk rådgivning.
2. **Koppla deltagare till radio:** varje deltagare sparar sitt nod-id (t.ex. `!a1b2c3d4`) i jakten, antingen automatiskt
   när radion ansluts eller genom att skriva in det. Det behövs en ny nod i reglerna, till exempel `groups/<lag>/meshNodes/<uid>`,
   och regeltester.
3. **Välja väg när man skickar:** "App" eller "Meshtastic" (eller båda). Meshtastic går bara att välja för mottagare som har
   ett nod-id, och bara när avsändarens radio är ansluten. Visa en varning om texten är för lång.
4. **Ta emot:** är mottagarens radio ansluten till Jaktkartan visas meddelandet i appen. Annars läses det i Meshtastic-appen.
   En radio kan ofta bara vara ansluten till en app i taget via Bluetooth.
5. **Tester:** en låtsasradio i testerna (testerna ska gå utan nätverk och utan hårdvara), och skarpa prov med riktiga radioapparater.

### Begränsningar

- En radio kan oftast bara vara ansluten till en app i taget via Bluetooth. Ansluter man den till Jaktkartan
  kan den inte samtidigt vara ansluten i Meshtastic-appen.
- **iPhone:** webbläsare på iPhone har inte Web Bluetooth. Den som skickar via Meshtastic från Jaktkartan behöver Android
  (Chrome) eller en dator. Den som har iPhone kan ta emot genom att skriva in sitt nod-id och läsa i Meshtastic-appen.
- Det går inte att testa i CI mot riktiga radioapparater.

Källor: [Meshtastic: publik nyckelkryptering i 2.5](https://meshtastic.org/blog/introducing-new-public-key-cryptography-in-v2_5/),
[Meshtastic: krypteringens begränsningar](https://meshtastic.org/docs/about/overview/encryption/limitations/),
[@meshtastic/core: MeshDevice.sendText](https://jsr.io/@meshtastic/core/doc/~/MeshDevice.prototype.sendText),
[meshtastic/protobufs (GPL-3.0)](https://www.github.com/meshtastic/protobufs),
[@meshtastic/protobufs på JSR (GPL-3.0-only)](https://jsr.io/@meshtastic/protobufs@2.7.26).

## Spåra positionen med släckt skärm (väntar)

Målet är att positionen ska delas under jakten även när skärmen är släckt eller man använder en annan app.

### Varför det inte går i webbappen

En webbsida får bara läsa positionen medan den är öppen och syns. När skärmen släcks, eller man byter app, pausas sidan
och GPS-uppdateringarna slutar. Det gäller Android och iPhone, i alla webbläsare, och även när appen är installerad på
hemskärmen. Service workern har inte tillgång till positionen alls. Därför håller appen i dag skärmen tänd när
positionen delas (Wake Lock), och sparläget minskar förbrukningen så mycket det går.

### Det som krävs: en riktig app

Lägg webbappen i ett tunt skal med **Capacitor**, och använd ett insticksprogram för position i bakgrunden
(till exempel `@capacitor-community/background-geolocation`, MIT-licens). Kartan, jakterna, planen och Firebase-koden kan återanvändas.
Positionsdelningen (`gpsStart`, `gpsPos` och `sendPos` i `src/cloud.js`) byter källa från webbläsarens
geolocation till insticksprogrammet när appen körs i skalet. Webbsidan finns kvar som i dag, till exempel för gäster.

**Hela jaktlaget har Android.** Android byggs därför först, och iPhone tas bara om någon i laget behöver det.

| | Android | iPhone |
|---|---|---|
| Hur | En tjänst i förgrunden med en fast avisering ("Jaktkartan delar din position") | Bakgrundsläget `location`, och en blå markering medan positionen delas |
| Behörigheter | Plats, avisering, förgrundstjänst för plats. "Tillåt alltid" bara om delningen ska starta av sig själv | "När appen används" räcker om delningen startas i appen, annars "Alltid" |
| Hur laget får appen | En APK-fil, Firebase App Distribution eller Google Play | TestFlight eller App Store |
| Kostnad | Gratis (Google Play: 25 USD en gång) | Apple Developer Program, cirka 99 USD per år, och en Mac eller molnbyggen |
| Insats | Måttlig | Större |

### Gemensamt för Android och iPhone

**Projektet**
- [ ] Lägg till `@capacitor/core` och `@capacitor/cli` och en `capacitor.config.json` (app-id, namn, `webDir`).
- [ ] Låt `npm run build` även lägga `index.html`, `manifest.webmanifest` och `icons/` i `webDir`, och kör `npx cap sync`.
- [ ] Appikoner och startskärm från `src/icons/`.
- [ ] Webbkoden känner av appen med `window.Capacitor && Capacitor.isNativePlatform()`. Wake Lock behövs inte i appen.

**Uppdateringar: välj en väg**
- [ ] **A. Webbkoden ligger i appen.** Fungerar utan nät från start, men varje ändring kräver en ny version av appen.
- [ ] **B. Appen laddar sidan från GitHub Pages** (`server.url`). Webbdelen uppdateras som i dag när en PR mergas,
  och bara ändringar i själva skalet kräver en ny app. Service workern cachar sidan som i dag, så appen startar även utan täckning
  om den har öppnats en gång. Rekommenderas för Android när appen inte ligger på Google Play.

**Positionen i bakgrunden**
- [ ] `addWatcher` från insticksprogrammet ger positioner till `gpsPos`, med `backgroundTitle` och `backgroundMessage`
  för aviseringen. `removeWatcher` när delningen stoppas eller jakten slutar.
- [ ] Samma regler som i dag: bara under jakter man deltar i ("Jag deltar"), start och slut, och man kan alltid stoppa.
- [ ] **`onDisconnect().remove()` i `sendPos` måste ändras i appen.** När telefonen kopplar ner i bakgrunden tar Firebase annars
  bort positionen, och man försvinner från kartan för de andra. Låt i stället positionen ligga kvar och visa hur gammal den är,
  och ta bort den när man stoppar delningen eller jakten slutar (det görs redan av `endHunt`).
- [ ] Sparläget gäller även i appen: gles GPS och sändning varje minut när man är incheckad på passet.

**Sändningen när skärmen är släckt (största tekniska risken)**
- [ ] Prova först om Firebase-koden i webbdelen fortsätter skicka med släckt skärm i minst en timme.
- [ ] Räcker inte det: skicka positionen med appens egen HTTP (`CapacitorHttp`) till Firebase REST,
  `PUT https://<databas>/groups/<lag>/huntPos/<jakt>/<uid>.json?auth=<ID-token>`, och spårpunkter med `POST` till `huntTrail`.
  ID-token gäller en timme och måste förnyas. Pausas webbdelen helt behöver även inloggningen ligga i appens egen kod (se nedan).
- [ ] Utan täckning: skicka bara den senaste positionen när nätet kommer tillbaka, inte alla som köats.
- [ ] Alternativ: Transistorsofts betalda `capacitor-background-geolocation` har inbyggd sändning, köhantering och
  batterisnål rörelseavkänning. Android-byggen för release kräver en licens.
- [ ] Reglerna i `src/rules.js` behöver inte ändras: samma sökvägar och samma fält.

**Inloggning**
- [ ] Google blockerar inloggning i popup-fönster inuti appar, så `signInWithPopup` fungerar inte i skalet.
  Använd `@capacitor-firebase/authentication` för inloggning med Google i telefonens eget system, och logga sedan in
  webbdelen med `signInWithCredential`.
- [ ] Anonym inloggning för gäster fungerar som i dag.
- [ ] Firebase-konsolen: lägg till appen i projektet. Är API-nyckeln begränsad till webbadresser behöver appen få använda den.

**Säkerhet (repot är publikt)**
- [ ] Signeringsnycklar och lösenord (`*.jks`, `*.keystore`, `key.properties`, Apples certifikat och profiler) läggs aldrig i repot.
  Lägg dem i `.gitignore` och som hemligheter i GitHub.
- [ ] Spara en säkerhetskopia av Androids signeringsnyckel utanför repot. Tappas den går appen inte att uppdatera,
  och alla måste avinstallera och installera om.
- [ ] `google-services.json` och `GoogleService-Info.plist` innehåller samma sorts uppgifter som konfigurationen i
  `src/cloud.js` och är inte hemliga.

**Tester**
- [ ] CI fortsätter testa webbdelen som i dag. Bygg även appen i CI (`./gradlew assembleDebug`) så att bygget inte går sönder.
- [ ] Delningen i bakgrunden kan inte testas i CI. Prova på riktiga telefoner enligt listan under Android.

### Android (först)

**Behörigheter i `AndroidManifest.xml`** (kontrollera mot insticksprogrammets dokumentation)
- [ ] `ACCESS_FINE_LOCATION` och `ACCESS_COARSE_LOCATION`.
- [ ] `FOREGROUND_SERVICE` och `FOREGROUND_SERVICE_LOCATION` (Android 14 och senare), och tjänsten med `foregroundServiceType="location"`.
- [ ] `POST_NOTIFICATIONS` (Android 13 och senare), för aviseringen som visar att positionen delas.
- [ ] `ACCESS_BACKGROUND_LOCATION` bara om delningen ska kunna starta när appen inte är öppen. Den behörigheten måste
  användaren ge i inställningarna ("Tillåt alltid"), och Google Play granskar den särskilt.

**När delningen startar**
- [ ] Android tillåter i regel inte att en förgrundstjänst startas när appen ligger i bakgrunden. Starta därför delningen
  när man öppnar appen under en jakt man deltar i, eller trycker Dela position.
- [ ] Lägg en lokal avisering vid jaktens start (`@capacitor/local-notifications`): "Jakten har börjat. Tryck för att dela din position."
  Ett tryck öppnar appen och startar delningen. Efter det fortsätter den med släckt skärm.

**Batterisparfunktioner**
- [ ] Samsung, Xiaomi, OnePlus och Huawei stänger gärna av appar i bakgrunden. Visa en instruktion i appen för att
  undanta Jaktkartan från batterioptimering (se dontkillmyapp.com för respektive märke).

**Hur laget får appen: välj en väg**
- [ ] **APK från GitHub Releases.** Enklast och gratis. Repot är publikt, så vem som helst kan ladda ner den, men den kräver
  inloggning i laget som i dag. Man måste tillåta "Installera okända appar" och kan få en varning från Play Protect.
  Uppdateringar installeras för hand (med väg B ovan gäller det bara skalet).
- [ ] **Firebase App Distribution.** Gratis. Laget bjuds in och får besked när en ny version finns.
- [ ] **Google Play, intern testning.** 25 USD en gång. Upp till 100 testare, och uppdateringar kommer automatiskt.
  Kräver en deklaration om position i bakgrunden om `ACCESS_BACKGROUND_LOCATION` används.
  Publicering för alla kräver för nya personliga konton först ett slutet test med 12 testare i 14 dagar.
- [ ] Google har aviserat att appar på certifierade Android-telefoner från 2027 ska komma från en verifierad utvecklare,
  även när de installeras utanför Google Play. Kontrollera vad som gäller när appen ska spridas.

**Bygge**
- [ ] Android Studio, eller bara JDK och Android SDK. Fungerar på Linux, Windows och Mac, och i GitHub Actions.
- [ ] Signerat release-bygge (`./gradlew assembleRelease` eller `bundleRelease` för Google Play) med nyckeln som hemlighet i GitHub.

**Prova på riktiga telefoner**
- [ ] Skärmen släckt och telefonen i fickan i minst en timme: kommer positionen fram, och hur ofta?
- [ ] Byte till en annan app, och tillbaka.
- [ ] Dålig och ingen täckning: kommer positionen fram när nätet kommer tillbaka?
- [ ] Batteri: förbrukning per timme, jämfört med webbappen med tänd skärm.
- [ ] Minst två märken, helst en Samsung.
- [ ] Omstart av telefonen under jakten, och att delningen slutar när jakten slutar.

### iPhone (senare, om någon i laget behöver det)

**Det som behövs**
- [ ] Apple Developer Program (cirka 99 USD per år).
- [ ] En Mac med Xcode, eller molnbyggen (till exempel macOS i GitHub Actions). Certifikat och profiler som hemligheter i GitHub.

**I appen**
- [ ] `Info.plist`: `UIBackgroundModes` med `location`, och texterna `NSLocationWhenInUseUsageDescription` och
  `NSLocationAlwaysAndWhenInUseUsageDescription` på svenska, som förklarar att positionen bara delas under jakten.
- [ ] Delningen startas i appen, som på Android (en app på iPhone kan inte starta vanlig GPS från bakgrunden).
- [ ] **Logga in med Apple** krävs troligen i App Store när inloggning med Google finns. Det behöver också läggas till i Firebase.
- [ ] Offline: service workers fungerar bara i appens webbvy med App-Bound Domains (högst tio domäner).
  Cachen för kartrutor måste lösas på annat sätt, eller få finnas bara på webben.

**Hur laget får appen**
- [ ] **TestFlight.** Räcker för ett jaktlag. Kräver en kortare granskning, och varje bygge slutar fungera efter 90 dagar.
- [ ] **App Store.** Full granskning. Apple granskar position i bakgrunden noga, och en app som mest är en webbsida kan nekas.

**Prova**
- [ ] Samma lista som för Android, på minst en iPhone.

### Ordning för arbetet (Android)

1. Prototyp: Capacitor och insticksprogrammet, bara positionen till Firebase, en APK som provas en jaktdag med släckt skärm.
2. Bestäm hur positionen skickas (webbdelen eller Firebase REST), och ändra `onDisconnect`.
3. Inloggning med Google i appen.
4. Välj väg för uppdateringar och spridning.
5. Signering och bygge av appen i CI.
6. Provning på lagets telefoner, och sedan spridning till laget.

### Alternativ utan egen app

- **Meshtastic-radio med GPS:** radion sänder själv sin position med jämna mellanrum, utan telefon och utan täckning.
  Se avsnittet om Meshtastic ovan.
- **Tills vidare:** sparläget, mörkt läge och låg ljusstyrka på telefonen.
