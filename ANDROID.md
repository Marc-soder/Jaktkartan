# Jaktkartan som app på Android

Appen delar positionen under jakten även när skärmen är släckt. Webbsidan kan inte det, eftersom webbläsaren pausar
sidan när skärmen släcks.

Appen är ett tunt skal runt samma sida som webben (https://marc-soder.github.io/Jaktkartan/). Allt du ändrar på
webben, och som mergas till `main`, syns därför i appen direkt. En ny version av appen behövs bara när själva skalet
ändras (se [Steg 8](#steg-8-uppdateringar)).

**Kostnad:** inget. Appen byggs gratis i GitHub Actions och sprids som en APK-fil, utan Google Play.

**All kod är klar.** Det som återstår är det bara du kan göra: skapa en signeringsnyckel, lägga in appen i Firebase,
ge GitHub nycklarna och installera appen. Räkna med ungefär en timme första gången, plus en provjakt.

| Steg | Vad | Var | Tid |
|---|---|---|---|
| 1 | Skapa signeringsnyckeln | Din dator | 15 min |
| 2 | Lägg till Android-appen i Firebase | Firebase-konsolen | 10 min |
| 3 | Lägg in tre hemligheter | GitHub | 5 min |
| 4 | Bygg appen | GitHub Actions | 10 min, mest väntan |
| 5 | Installera och logga in | Din telefon | 10 min |
| 6 | Provjakt med släckt skärm | I skogen | 1 timme |
| 7 | Dela med laget | Telefonerna i laget | 10 min per person |
| 8 | Uppdateringar | GitHub Actions | Vid behov |

> **Innan du börjar:** PR:en med appen måste vara mergad till `main`. Knappen för att bygga appen (steg 4) syns först då.

---

## Steg 1: Skapa signeringsnyckeln

Android kräver att appen är signerad. Samma nyckel måste användas till varje ny version, annars går appen inte att uppdatera.
Nyckeln skapas en gång, på din dator, och läggs **aldrig** i repot.

### 1.1 Installera Java (för programmet `keytool`)

1. Gå till https://adoptium.net och ladda ned **Temurin 21 (LTS)** för din dator.
2. Installera med standardvalen. På Windows: kryssa i **Set JAVA_HOME** och **Add to PATH** om installationen frågar.
3. Öppna ett terminalfönster:
   - **Windows:** Start → skriv `PowerShell` → öppna **Windows PowerShell**.
   - **Mac:** Program → Verktygsprogram → **Terminal**.
4. Skriv `keytool -help` och tryck Enter. Kommer en lista med kommandon fungerar det.
   Står det att kommandot inte finns: stäng terminalen, öppna en ny och försök igen.

### 1.2 Skapa nyckeln

1. Skapa en mapp **utanför** repot, till exempel `Dokument/Jaktkartan-nyckel`, och gå dit i terminalen:
   - **Windows:** `cd $HOME\Documents\Jaktkartan-nyckel`
   - **Mac:** `cd ~/Documents/Jaktkartan-nyckel`
2. Kör (en rad):
   ```
   keytool -genkeypair -v -keystore jaktkartan.jks -storetype PKCS12 -alias jaktkartan -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Jaktkartan"
   ```
3. Den frågar efter ett lösenord två gånger. Välj ett långt lösenord (minst 12 tecken) och spara det i din lösenordshanterare.
   Det syns inte när du skriver.
4. Nu finns filen `jaktkartan.jks` i mappen. Namnet på nyckeln i filen är `jaktkartan`. Det namnet förutsätter bygget, så ändra det inte.

### 1.3 Säkerhetskopiera nyckeln

Spara en kopia av `jaktkartan.jks` och lösenordet på ett säkert ställe, till exempel i lösenordshanteraren (som bifogad fil)
eller på ett USB-minne i ett kassaskåp.

> Tappar du nyckeln eller lösenordet går appen inte att uppdatera. Då måste alla i laget avinstallera och installera om.

### 1.4 Hämta nyckelns fingeravtryck (SHA-1)

Firebase behöver fingeravtrycket för att inloggningen med Google ska fungera i appen.

1. Kör i samma mapp (en rad):
   ```
   keytool "-J-Duser.language=en" -list -v -keystore jaktkartan.jks -alias jaktkartan
   ```
   `"-J-Duser.language=en"` gör att keytool skriver på engelska. Den svenska översättningen i Java 25 har ett fel som
   gör att keytool kraschar med `IllegalFormatConversionException` när certifikatet ska visas. Citattecknen behövs i
   PowerShell, annars delas argumentet vid punkten.
2. Skriv lösenordet. Leta upp raden som börjar med `SHA1:`, till exempel
   `SHA1: 94:6C:F5:56:9D:1F:74:CE:41:DE:7D:CB:46:06:63:73:24:8C:9F:49`.
3. Kopiera hela värdet efter `SHA1:` (under **Certificate fingerprints**). Du behöver det i steg 2.

Fingeravtrycket är inte hemligt.

---

## Steg 2: Lägg till Android-appen i Firebase

1. Öppna https://console.firebase.google.com och välj projektet **jaktkartan-daa0a**.
2. Klicka på kugghjulet uppe till vänster → **Projektinställningar** (Project settings) → fliken **Allmänt** (General).
3. Längst ned under **Dina appar** (Your apps): klicka **Lägg till app** (Add app) → Android-ikonen.
4. Fyll i:
   - **Android-paketnamn** (Android package name): `io.github.marcsoder.jaktkartan`. Det måste vara exakt så.
   - **Appens smeknamn** (App nickname): `Jaktkartan Android`.
   - Finns ett fält för **SHA-1** kan du klistra in fingeravtrycket från steg 1.4 där. Finns det inte, lägg in det i punkt 7.
5. Klicka **Registrera app** (Register app).
6. Hoppa över nedladdningen av `google-services.json` i guiden. Klicka **Nästa** (Next) genom resten
   (Gradle och SDK är redan gjort i repot) och sedan **Fortsätt till konsolen** (Continue to console).
7. Kugghjulet → **Projektinställningar** (Project settings) → **Allmänt** (General) → **Dina appar** (Your apps) → **Jaktkartan Android**.
   Står fingeravtrycket inte under **SHA-certifikatfingeravtryck** (SHA certificate fingerprints): klicka **Lägg till fingeravtryck**
   (Add fingerprint), klistra in det från steg 1.4 och klicka **Spara** (Save).
8. Klicka på **google-services.json** på samma ställe och spara filen. Den måste hämtas **efter** att fingeravtrycket är tillagt,
   annars saknar den det som inloggningen med Google behöver (bygget i steg 4 stoppar då med ett tydligt fel).
9. Gå till **Authentication** → **Sign-in method**. **Google** och **Anonym** ska vara påslagna, som för webben.

### 2.1 Begränsa appens API-nyckel i Google Cloud

När Android-appen läggs till skapar Firebase en ny API-nyckel för Android. Begränsa den på samma sätt som webbens nyckel.

1. Öppna https://console.cloud.google.com → välj projektet **jaktkartan-daa0a** → **API:er och tjänster** → **Inloggningsuppgifter** (Credentials).
2. Klicka på **Android key (auto created by Firebase)**. Finns den inte behövs inget mer här.
3. Under **Programbegränsningar** (Application restrictions): välj **Android-appar** → **Lägg till** →
   paketnamn `io.github.marcsoder.jaktkartan` och SHA-1 från steg 1.4.
4. Klicka **Spara**.

Webbens nyckel (den med begränsningen till `marc-soder.github.io`) används också av appen och ska **inte** ändras.
Den måste få använda **Identity Toolkit API** och **Token Service API**, som i dag. Appen förnyar inloggningen via Token Service
när skärmen är släckt.

---

## Steg 3: Lägg in tre hemligheter i GitHub

Hemligheterna syns bara för dig som äger repot. De används bara när du själv startar bygget, aldrig i PR:er.

### 3.1 Gör om nyckelfilen till text

Kör i mappen med `jaktkartan.jks`. Texten hamnar direkt i urklipp:

- **Windows (PowerShell):**
  ```
  [Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\jaktkartan.jks")) | Set-Clipboard
  ```
- **Mac:**
  ```
  base64 -i jaktkartan.jks | pbcopy
  ```

### 3.2 Lägg in hemligheterna

1. Öppna https://github.com/Marc-soder/Jaktkartan → **Settings** → **Secrets and variables** → **Actions**.
2. Klicka **New repository secret** och lägg in de här tre, en i taget:

| Name | Secret |
|---|---|
| `JK_KEYSTORE_BASE64` | Klistra in texten från 3.1 (den är lång, det ska den vara). |
| `JK_KEYSTORE_PASSWORD` | Lösenordet från steg 1.2. |
| `JK_GOOGLE_SERVICES_JSON` | Öppna `google-services.json` i Anteckningar (Windows) eller TextEdit (Mac), markera allt, kopiera och klistra in. |

Lägg aldrig in `jaktkartan.jks`, lösenordet eller `google-services.json` i repot. `.gitignore` stoppar filerna om de
skulle hamna i repomappen, men håll dem utanför den.

---

## Steg 4: Bygg appen

1. Öppna https://github.com/Marc-soder/Jaktkartan/actions → **Android-appen** i listan till vänster.
2. Klicka **Run workflow** (till höger). Låt **Branch: main** stå kvar.
3. Kryssa i **Lägg APK-filen under Releases**. Då kan du ladda ned appen direkt på telefonen.
4. Klicka den gröna knappen **Run workflow**. Bygget tar 5–10 minuter.

**Blir bygget grönt:** appen finns under https://github.com/Marc-soder/Jaktkartan/releases som `Jaktkartan-1.<nummer>.apk`.
Den finns också under **Artifacts** längst ned i körningen (som en zip-fil, kräver inloggning på GitHub).

**Blir bygget rött:** klicka på körningen. Felet står överst i klartext, till exempel:

| Felet | Gör så här |
|---|---|
| Hemligheter saknas | Steg 3. Namnen måste stavas exakt som i tabellen. |
| Signeringsnyckeln gick inte att läsa | Fel lösenord, eller texten i `JK_KEYSTORE_BASE64` blev avklippt. Gör om 3.1 och lägg in den igen. |
| SHA-1 finns inte i google-services.json | Steg 2.7 och 2.8, och lägg sedan in den nya filen i `JK_GOOGLE_SERVICES_JSON`. |
| google-services.json saknar Android-appen | Paketnamnet i Firebase är fel. Lägg till appen igen med `io.github.marcsoder.jaktkartan`. |

APK-filen innehåller inga hemligheter. Den kräver inloggning i jaktlaget som vanligt, så det gör inget att den är publik.

---

## Steg 5: Installera och logga in på din telefon

### 5.1 Installera

1. Öppna https://github.com/Marc-soder/Jaktkartan/releases i Chrome på telefonen.
2. Tryck på den senaste `Jaktkartan-1.<nummer>.apk` under **Assets**. Filen laddas ned.
3. Tryck **Öppna** när nedladdningen är klar.
4. Första gången frågar Android om Chrome får installera appar: tryck **Inställningar** → slå på **Tillåt från den här källan** → tillbaka.
5. Tryck **Installera**.
6. Säger **Play Protect** att appen är okänd: tryck **Mer information** → **Installera ändå**.
   Det beror på att appen inte kommer från Google Play.

### 5.2 Första starten

Appen behöver nät första gången. Sedan startar den även utan täckning, som webbsidan.

1. Öppna **Jaktkartan**.
2. Menyn → **Mitt konto** → **Logga in med Google** → välj ditt konto. Inloggningen sker i telefonens eget fönster.
3. Tryck **Tillåt aviseringar** → **Tillåt**. Behövs för nödlarm, påminnelser och aviseringen när positionen delas.

### 5.3 Batteri (viktigt)

Telefonen stänger annars appen efter en stund med släckt skärm, och positionen slutar skickas.

- **Inställningar → Appar → Jaktkartan → Batteri → Obegränsad** (namnet varierar: "Obegränsad", "Ingen begränsning", "Optimera inte").
- **Samsung:** även **Inställningar → Batteri → Gränser för bakgrundsanvändning**: Jaktkartan får inte stå under
  "Appar i viloläge" eller "Appar i djupt viloläge".
- **Xiaomi:** även **Autostart** på för Jaktkartan.
- För andra märken: sök på märket på https://dontkillmyapp.com.

### 5.4 Platsåtkomst

Första gången positionen delas frågar Android om plats:

- Välj **Exakt** och **När appen används**. Det räcker: delningen fortsätter med släckt skärm så länge aviseringen
  **Jaktkartan delar din position** syns. **Tillåt alltid** behövs inte.

### 5.5 Ta bort webbappen från hemskärmen

Har du Jaktkartan på hemskärmen från Chrome: ta bort den när appen fungerar, så att du inte råkar dela från båda.

---

## Steg 6: Provjakt med släckt skärm

Gör det här med en eller två till innan hela laget går över till appen.

1. Skapa en jakt (**Ny jakt**) som startar nu. Tryck **Jag deltar** i appen.
2. Kontrollera att positionen delas och att aviseringen **Jaktkartan delar din position** syns i telefonens aviseringar.
3. Släck skärmen, lägg telefonen i fickan och gå i minst en timme.
4. Följ positionen från en annan telefon eller dator. Den ska uppdateras ungefär var 8:e sekund när du går,
   och ungefär varje minut i sparläget när du är incheckad på passet.

Prova också, och notera vad som händer:

- [ ] Byt till en annan app en stund och gå tillbaka.
- [ ] Flygplansläge i 5 minuter, sedan av. Positionen ska komma fram igen inom en minut.
- [ ] Hur mycket batteri går åt på en timme, jämfört med webbsidan med tänd skärm?
- [ ] Starta om telefonen under jakten och öppna appen. Har du tryckt **Jag deltar** ska delningen starta igen av sig själv.
- [ ] Avsluta jakten. Inom någon minut ska aviseringen försvinna och delningen sluta.
- [ ] Gärna på två olika märken, helst en Samsung.

Om positionen slutar komma fram med släckt skärm: kontrollera batteriinställningarna i steg 5.3 först.

---

## Steg 7: Dela med laget

Skicka länken https://github.com/Marc-soder/Jaktkartan/releases/latest till laget, med de här stegen:

1. Öppna länken i Chrome på telefonen och tryck på `Jaktkartan-….apk`.
2. Tillåt installation från Chrome, och tryck **Installera** (och **Installera ändå** om Play Protect varnar).
3. Öppna Jaktkartan → menyn → **Mitt konto** → **Logga in med Google** (eller gå med som gäst med jaktkoden).
4. Tryck **Tillåt aviseringar**.
5. Inställningar → Appar → Jaktkartan → Batteri → **Obegränsad**.
6. När positionen delas första gången: välj **Exakt** och **När appen används**.

Den som deltar i en planerad jakt får en påminnelse i telefonen när jakten startar. Ett tryck på den öppnar appen,
och delningen startar.

---

## Steg 8: Uppdateringar

**Webbdelen (kartan, jakterna, planen och allt annat):** uppdateras av sig själv när en PR mergas, som på webben.
Ingen ny APK behövs.

**Själva appen:** en ny APK behövs bara när PR:en ändrar `android/`, `app/`, `capacitor.config.json` eller
insticksprogrammen i `package.json`. Det står i PR:en när det gäller.

1. Kör steg 4 igen (med **Lägg APK-filen under Releases** ikryssat).
2. Inom några timmar, eller direkt när appen öppnas nästa gång, visas raden **Ny version av appen: 1.x** hos alla i laget.
   Man kan också trycka **Sök efter uppdatering** under **Mitt konto**.
3. Tryck **Uppdatera**. Appen laddar ned den nya versionen och Android frågar **Vill du uppdatera den här appen?**: tryck **Uppdatera**.
4. Första gången frågar appen om Jaktkartan får installera uppdateringar: tryck **Öppna inställningar**, slå på
   **Tillåt från den här källan**, gå tillbaka och tryck **Uppdatera** igen. Det behövs bara en gång.

Android godkänner aldrig en installation helt utan att fråga, för appar som inte kommer från Google Play. Därför den sista rutan.
Android installerar bara en uppdatering som är signerad med samma nyckel som appen, så ingen annan kan skicka en falsk uppdatering.

Appar byggda innan uppdateringen fanns (till och med 1.4) har inte raden. De uppdateras en gång för hand, på samma sätt som i steg 7.
Inloggning och inställningar finns kvar.

Versionsnumret räknas upp av sig själv. Samma nyckel måste användas varje gång (den ligger i GitHub sedan steg 3).

---

## Felsökning

| Problem | Orsak och åtgärd |
|---|---|
| "Inloggningen med Google misslyckades" med en kod som innehåller `10` eller `DEVELOPER_ERROR` | Fingeravtrycket (SHA-1) saknas eller är fel i Firebase. Steg 2.7 och 2.8, lägg in nya `google-services.json` i `JK_GOOGLE_SERVICES_JSON`, bygg och installera igen. |
| "Appen har inte installerats" vid uppdatering | Den nya APK-filen är signerad med en annan nyckel. Använd samma `jaktkartan.jks`. Annars: avinstallera den gamla först. |
| Positionen slutar komma fram med släckt skärm | Batteriinställningarna i steg 5.3. |
| "Positionen är blockerad" | Inställningar → Appar → Jaktkartan → Behörigheter → Plats → **När appen används** och **Använd exakt plats**. |
| "Ingen täckning" när appen startar | Appen har aldrig öppnats med nät. Öppna den en gång med täckning. |
| Ingen avisering när jakten startar | Aviseringar är inte tillåtna (Mitt konto → **Tillåt aviseringar**), eller jakten startas för hand av jaktledaren. Då finns ingen tid att påminna om. |

---

## Så fungerar det (för den som ändrar i koden)

| Fil | Innehåll |
|---|---|
| `capacitor.config.json` | Appens id (`io.github.marcsoder.jaktkartan`), adressen som öppnas (`server.url`) och inställningar för insticksprogrammen. |
| `android/` | Android-projektet (skapat med `npx cap add android`). Ikoner, aviseringsikon, behörigheter och signering från miljövariabler. |
| `app/www/` | Sidor som finns i själva appen: `offline.html` visas om sidan inte går att hämta första gången. |
| `src/native.js` | Kopplingen mellan webbsidan och telefonen. Gör ingenting i en vanlig webbläsare. |
| `.github/workflows/android.yml` | Kontrollbygge i PR:er, och det signerade bygget som startas för hand. |

- **Position i bakgrunden:** `@capacitor-community/background-geolocation` (MIT). En tjänst i förgrunden med en fast avisering.
- **Sändning:** med telefonens egen HTTP (`CapacitorHttp`) till Firebase REST, eftersom Android stryper webbvyns nät i bakgrunden.
  Inloggningen förnyas på samma sätt när skärmen är släckt.
- **onDisconnect:** används inte i appen. Annars skulle Firebase ta bort positionen när skärmen släcks och anslutningen bryts.
  Positionen tas bort när man stoppar delningen eller när jakten slutar, och andra ser hur gammal den är.
- **Inloggning:** `@capacitor-firebase/authentication` loggar in med Google i telefonens eget system och lämnar över till
  webbsidans Firebase (`signInWithCredential`). Google tillåter inte inloggning i webbvyer.
- **Aviseringar:** `@capacitor/local-notifications` för nödlarm och påminnelse när en jakt man deltar i startar.
- **Uppdatering av appen:** `android/app/src/main/java/.../AppUpdatePlugin.java` (appens eget insticksprogram) och
  `natUpdateCheck` i `src/native.js`. Appen frågar GitHub efter senaste releasen (`app-1.<nr>`, där nr är versionCode),
  högst var sjätte timme, laddar bara ned APK-filer från repots egna releaser, kontrollerar paketnamnet och öppnar Androids installerare.
- **Export** (säkerhetskopia, GPX, GeoJSON): `@capacitor/filesystem` och `@capacitor/share`. Webbvyn kan inte ladda ned filer,
  så filen skrivs i appens cache och öppnas i Androids Dela-meny, där man sparar den (Filer, Drive) eller skickar den.
- **Säkerhetsreglerna** i Firebase är oförändrade. Appen skriver samma sökvägar och fält som webben.
- **Tester:** `tests/test2.js` kör sidan med en låtsad telefon (en låtsad `window.Capacitor`) och prövar inloggning, delning,
  förnyad inloggning med släckt skärm, nödlarm, påminnelser och nekad plats. Själva Android-bygget kontrolleras i CI.
  Det som bara går att pröva på en riktig telefon står i steg 6.

**Att känna till:** Google har aviserat att appar som installeras utanför Google Play ska komma från en verifierad utvecklare
på certifierade Android-telefoner, med start 2027. Kontrollera vad som gäller innan dess. iPhone stöds inte (se TODO.md).
