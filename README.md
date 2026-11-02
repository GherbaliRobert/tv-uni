# Panou TV mecanizare

Panou pentru televizor cu două file care se schimbă singure la 2 minute:

- **GPS flotă**: hartă cu mașinile evidențiate după stare, top viteze pe săptămâna curentă, mașinile staționate cel mai mult.
- **Atelier și documente**: ce este în lucru acum, ITP-uri, RCA-uri, tahografe, roviniete și revizii care expiră.

## Pornire pe Railway

1. **New Project → Deploy from GitHub repo**, apoi alege acest repository.
2. La **Variables**, adaugă `CHEIE_ACCES` cu cheia de acces. Fără ea serverul refuză să pornească, ca panoul să nu ajungă pe internet neprotejat.
3. Adaugă un **Volume** și montează-l la `/data`. Fără el, Excelul încărcat se pierde la fiecare deploy.
4. La **Settings → Networking**, apasă **Generate Domain**.
5. Deschide `https://DOMENIU/incarca`, scrie cheia și încarcă Excelul.
6. Pe televizor deschide `https://DOMENIU` și scrie cheia. Browserul o ține minte un an. Poți intra și direct, cu `https://DOMENIU/?cheie=CHEIA`.

Repository-ul este public. **Nu urca în el Excelul real sau cheia de acces**: `.gitignore` le exclude, iar datele reale stau doar pe volumul din Railway.

Browserele din televizoare pot fi vechi. Dacă panoul nu poate porni, pe ecran apare un mesaj cu versiunea browserului. Un mini-PC pe HDMI este varianta sigură.

## Pornire pe calculator

O singură dată, în folderul proiectului:

```bash
npm install
```

Apoi dublu-click pe `Porneste-Panou.bat`. Pornește serverul și deschide Edge pe tot ecranul. Se închide cu Alt+F4. `Porneste-Server.bat` pornește doar serverul, la http://localhost:8080.

Pentru pornire automată la deschiderea calculatorului: `Win+R`, scrie `shell:startup`, pune acolo o scurtătură la fișierul `.bat`.

Setările locale stau într-un fișier `.env`, care nu ajunge pe GitHub. Vezi „Variabile” mai jos.

## Taste

| Tastă | Efect |
|---|---|
| Săgeată stânga / dreapta | Schimbă fila |
| Spațiu | Oprește sau reia rotirea |
| OK pe telecomandă, Enter sau click | Ecran complet |
| F | Ecran complet, pornit sau oprit |

## Date

Când panoul rulează pe date demonstrative, în bara de sus apare eticheta galbenă **DATE DEMO**.

### Fila Atelier și documente: expirări

Încarci centralizatorul lunar la adresa `/incarca`. După fiecare modificare în Excel îl încarci din nou, iar televizorul îl preia în cel mult un minut. Un fișier care nu poate fi citit este refuzat și versiunea bună rămâne pe panou. Fișierul lunii următoare îl înlocuiește pe cel vechi, deci mașinile rămase nerezolvate în fișierul vechi nu mai apar.

- Fiecare bloc are un titlu (`ITP`, `RCA`, `TAHOGRAF`, `ROVINIETĂ`, opțional `REVIZII`), un rând de antet și mașinile lui.
- Coloanele folosite sunt `NUMĂR AUTO`, `DATA EXPIRĂRII` și `REALIZAT`. Starea afișată se calculează din dată, nu din coloana `STATUS`.
- La `REALIZAT`, un rând marcat cu ✅, ☑, ✔, x sau DA dispare de pe panou. 🔲 sau o celulă goală înseamnă că rămâne. Orice alt semn lasă rândul pe panou și apare ca avertisment.
- Un bloc necunoscut, o dată greșită sau un semn neînțeles apar într-o bandă jos, pe televizor, cu foaia și rândul.

### Fila Atelier și documente: în lucru și revizii

Vin dintr-un al doilea Excel, cu foile **Flota** și **In lucru**, încărcat tot la `/incarca`. Modelul este `date/mecanizare.xlsx`, iar instrucțiunile sunt în foaia **Citeste-ma**.

- Cât timp fișierul este marcat demonstrativ, panoul îl ignoră dacă există centralizatorul și afișează „Nu sunt date în Excel”, ca datele inventate să nu apară lângă cele reale.
- Când îl completezi, scrie `NU` în celula `B3` din foaia **Citeste-ma**. Datele de rovinietă, ITP și RCA din **Flota** sunt ignorate cât timp există centralizatorul.
- `npm run excel-demo` recreează fișierul demo. Nu suprascrie un fișier existent decât cu `--suprascrie`.

### Fila GPS: furnizorul

Implicit rulează simulatorul `src/gps/demo.js`. Pentru date reale:

1. Adaugă în `src/gps/` un modul care exportă `fetchPositions()`:

   ```js
   async function fetchPositions() {
     return [{
       id: '123',             // identificator stabil
       plate: 'B-101-ABC',
       type: 'Autobasculantă', // opțional
       lat: 44.43,
       lng: 26.10,
       speed: 62,              // km/h
       heading: 90,            // grade, opțional
       ignition: true,         // contact pus
       timestamp: 1793606400000, // momentul raportării, în ms
     }];
   }
   ```

   Opțional, `fetchWeeklyMaxSpeeds(from, to)` poate întoarce `[{ plate, speed, at }]` din rapoartele furnizorului. Altfel, topul se calculează doar din pozițiile primite cât timp serverul rulează, deci poate rata vârfuri dintre două citiri.

2. Înregistreaz-o în `PROVIDERS` din `src/gps/tracker.js` și pune numele ei la `gps.furnizor` în `config.json`.

### Cum se stabilește starea unei mașini

| Stare | Condiție |
|---|---|
| Pornite | contact pus și viteză de cel puțin 5 km/h |
| Staționate | contact pus și viteză sub 5 km/h |
| Oprite | contact luat |
| Fără semnal | nu a raportat de 15 minute cu contactul pus, sau de 24 de ore cu contactul luat |

Vitezele peste 180 km/h sunt tratate ca erori GPS și nu intră în top. Top vitezele se resetează luni la 00:00.

## Variabile

| Variabilă | Ce face |
|---|---|
| `CHEIE_ACCES` | Cheia de acces la panou. Obligatorie pe internet. |
| `DIR_DATE` | Unde stau fișierele încărcate și topul de viteze. Pe Railway se ia singur din volum; altfel, folderul `date`. |
| `FISIER_EXPIRARI` | Doar pe calculator: calea către centralizator, ca să fie citit direct la fiecare salvare. Cu un `*` în nume (`Centralizator_expirari_*.xlsx`) se folosește fișierul salvat ultimul. |
| `PORT` | Îl setează Railway. Când există, serverul ascultă pe toate adresele și cere `CHEIE_ACCES`. |

Pe calculator se pun într-un fișier `.env`, câte una pe rând: `CHEIE_ACCES=cheia-ta`.

## Setări (`config.json`)

| Cheie | Ce face |
|---|---|
| `rotatieSecunde` | Cât stă o filă pe ecran |
| `gps.pragVitezaAtentie`, `gps.pragVitezaCritic` | De la ce viteză se colorează în top |
| `gps.topViteze` | Câte mașini intră în top |
| `gps.faraSemnal...`, `gps.vitezaMinimaMiscare`, `gps.vitezaMaximaPlauzibila` | Regulile de mai sus |
| `harta.tile` | Serverul de hartă (implicit OpenStreetMap, necesită internet) |
| `mecanizare.zileUrgent`, `mecanizare.zileAtentie` | Praguri pentru documente și revizii după dată |
| `mecanizare.kmUrgent`, `kmAtentie`, `oreUrgent`, `oreAtentie` | Praguri pentru revizii după contor |

Modificările din `config.json` se aplică după repornirea serverului.

Pentru probe: `http://localhost:8080/?rotatie=10&fila=mecanizare`.

## Teste

```bash
npm test
```
