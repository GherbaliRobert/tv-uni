# Panou TV mecanizare

Două intrări, cu două parole:

- **Monitorul**, pentru televizor (`PAROLA_TV`): ce e în curs, ce e de rezolvat, ITP-uri, RCA-uri, roviniete, licențe, tahografe și revizii care expiră. Doar se uită la date.
- **Meniul**, pentru laptop (`PAROLA_LAPTOP`): filele De rezolvat, În curs, Acte, Istoric și Import Excel. Aici se schimbă datele.

Pe același formular, parola scrisă decide ce se deschide. Literele mari și spațiile de la capete nu contează, pentru că tastatura unui televizor le pune singură.

Fila GPS există în cod, dar e oprită: `gps.activ` în `config.json`.

## Pornire pe Railway

1. **New Project → Deploy from GitHub repo**, apoi alege acest repository.
2. La **Variables**, adaugă `PAROLA_TV` și `PAROLA_LAPTOP`, fiecare cu cel puțin 8 caractere și diferite între ele. Fără ele serverul refuză să pornească, ca panoul să nu ajungă pe internet neprotejat.
3. Adaugă un **Volume** și montează-l la `/data`. Fără el, tot ce e salvat se pierde la fiecare deploy, iar meniul afișează un avertisment.
4. La **Settings → Networking**, apasă **Generate Domain**.
5. Pe laptop deschide `https://DOMENIU`, scrie parola de laptop, apoi importă fișierul Logistica Auto din fila **Import Excel**.
6. Pe televizor deschide `https://DOMENIU` și scrie parola de televizor. Browserul o ține minte un an, iar pe laptop 30 de zile.

Repository-ul este public. **Nu urca în el fișierul Logistica Auto, parolele sau folderul `date`**: `.gitignore` le exclude.

Browserele din televizoare pot fi vechi. Dacă panoul nu poate porni, pe ecran apare un mesaj cu versiunea browserului. Un mini-PC pe HDMI este varianta sigură.

## Pornire pe calculator

O singură dată, în folderul proiectului:

```bash
npm install
```

Pune parolele într-un fișier `.env`, care nu ajunge pe GitHub:

```
PAROLA_TV=parola-televizorului
PAROLA_LAPTOP=parola-laptopului
```

Apoi dublu-click pe `Porneste-Server.bat` și deschide http://localhost:8080. `Porneste-Panou.bat` deschide în plus și Edge pe tot ecranul, iar acesta se închide cu Alt+F4.

## Taste pe monitor

| Tastă | Efect |
|---|---|
| OK pe telecomandă, Enter sau click | Ecran complet |
| F | Ecran complet, pornit sau oprit |
| Spațiu | Oprește sau reia rotirea, când sunt mai multe file |
| Săgeată stânga / dreapta | Schimbă fila, când sunt mai multe file |

## Date

### Ce se citește din Logistica Auto

Doar foile **VALABILITATE ACTE** și **EVIDENTA AUTO**, și doar numărul, inventarul, tipul, marca, modelul, statusul, șantierul, datele de expirare și linkul de dosar. Foile șoferilor, cu CNP-uri și salarii, nu se citesc, iar fișierul în sine nu se păstrează pe server: rămân doar datele extrase, în `flota.json`.

- Mașinile radiate sau vândute nu apar nicăieri. Lista e la `mecanizare.statusuriExcluse` în `config.json`, iar o schimbare se aplică la repornire, fără un nou import.
- Coloanele `STATUS` ale actelor nu se folosesc, pentru că formula lor scrie `EXPIRAT` și când data lipsește. O dată goală înseamnă că actul nu apare pe monitor. Se vede în fila **Acte**, cu `—`.
- Dacă un fișier nu poate fi citit, e refuzat și datele bune rămân.

### Cum merge o lucrare

| Pas | Ce se întâmplă |
|---|---|
| **De rezolvat** | Actele expirate sau care expiră în 30 de zile apar singure. Problemele se adaugă de mână. |
| **Preia** | Trece la **În curs** și apare pe monitor, cu responsabil și termen. |
| **Rezolvat** | La acte cere noua dată de valabilitate. Rămâne în **Istoric**. |
| **Înapoi** | Revine la De rezolvat. |
| **Nu se aplică** | Actul dispare de pe liste pentru mașina respectivă. Se poate reveni din fila **Acte**. |

Între Excel și meniu câștigă mereu data cea mai nouă: un import cu o dată mai veche nu anulează o reînnoire trecută din meniu. Când Excelul ajunge la zi, decide din nou Excelul.

Reviziile nu sunt în Logistica Auto. Se trec din fila **Acte**, pe coloana Revizie, sau se citesc dintr-o coloană `REVIZIE` dacă apare în Excel.

Totul se salvează în `stare.json`, lângă `flota.json`, pe volumul serverului.

### Actualizare în timp real

Monitorul ține o conexiune deschisă cu serverul (`/api/mecanizare/evenimente`) și se actualizează imediat ce se salvează ceva în meniu, fără reîncărcare. Dacă legătura se întrerupe, se reconectează singur și preia ce s-a schimbat între timp. Tot timpul, și dacă un browser sau o rețea nu permite o astfel de conexiune, monitorul citește datele și la 30 de secunde.

### GPS

Pentru a-l porni, pune `gps.activ` pe `true`. Implicit rulează simulatorul `src/gps/demo.js`, iar pe ecran apare eticheta **DATE DEMO**. Pentru date reale:

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
| `PAROLA_TV` | Parola monitorului. Obligatorie. |
| `PAROLA_LAPTOP` | Parola meniului. Obligatorie. |
| `DIR_DATE` | Unde stau datele. Pe Railway se ia singur din volum; altfel, folderul `date`. |
| `PORT` | Îl setează Railway. Când există, serverul ascultă pe toate adresele. |

Dacă schimbi o parolă, toate dispozitivele intrate cu ea trebuie să o scrie din nou. După 10 parole greșite de la aceeași adresă, formularul se blochează 15 minute.

## Setări (`config.json`)

| Cheie | Ce face |
|---|---|
| `mecanizare.statusuriExcluse` | Începutul statusurilor care nu apar pe panou, fără diacritice |
| `mecanizare.zileUrgent`, `mecanizare.zileAtentie` | Praguri pentru acte |
| `rotatieSecunde` | Cât stă o filă pe ecran, când sunt mai multe |
| `gps.activ` | Pornește sau oprește fila GPS |
| `gps.pragVitezaAtentie`, `gps.pragVitezaCritic`, `gps.topViteze` | Top viteze |
| `harta.tile` | Serverul de hartă (implicit OpenStreetMap, necesită internet) |

Modificările din `config.json` se aplică după repornirea serverului.

## Teste

```bash
npm test
```
