# 01 — Overview: FLIRT — No Regrets

> **Ce e acest document:** produsul **REAL**, nu viziunea din TZ. Fiecare feature e marcat
> ✅ **Implementat** / 🔜 **Planificat** / ❌ **Amânat (decizie de produs)**. Unde TZ-ul a fost
> abandonat deliberat, scrie **de ce** — nu ștergem istoria, o explicăm.
>
> Detalii: [`PROGRESS.md`](../PROGRESS.md) (starea pe etape) · [`backend/api-spec.md`](./backend/api-spec.md)
> (API) · [`backend/data-models.md`](./backend/data-models.md) (DB) · [`architecture.md`](./architecture.md)
> (arhitectura reală) · [`admin/README.md`](./admin/README.md) (panoul de admin) ·
> [`INTEGRATIONS.md`](./INTEGRATIONS.md) (provideri externi) · [`DEPLOYMENT.md`](./DEPLOYMENT.md) (deploy).

## Ce este FLIRT

**FLIRT** este o aplicație mobilă de dating (iOS / Android) construită în jurul a trei
piloni: mecanica de **swipe**, **compatibilitatea calculată** și **evenimentele offline
„Flirt Party"** (Live Events). La pornire, aplicația afișează un splash screen cu logo-ul
FLIRT și sloganul **„No Regrets"**.

Spre deosebire de un dating app clasic, FLIRT nu se oprește la corespondența online:
împinge utilizatorii spre **întâlniri reale la evenimente**, iar la profilul fiecărui
utilizator adaugă istoricul de participare fizică („Flirt Passport").

## Starea pe scurt

| Componentă | Stare | Cifre |
|---|---|---|
| Backend (FastAPI) | ✅ deployabil pe server real, TLS automat | **445 teste**, **83% acoperire** |
| API | ✅ | **79 operațiuni** pe **68 căi** (58 aplicație + 21 admin) |
| Bază de date | ✅ PostgreSQL 16 | **22 tabele**, **13 migrații** |
| Mobile (Expo) | ✅ ecrane live pe API real | **340 teste** / **57 suite** |
| Panou de admin (React + Vite) | ✅ | **19 teste** |
| Plăți IAP native | ❌ amânat | **blochează submit-ul la App Store** |
| Cameră / selfie de verificare | ❌ amânat | backend gata, lipsește captura |
| AI (hint chat, Chemistry Score) | 🔜 neînceput | — |

## Diferențiatori față de concurență

- **Live Events / Flirt Party** ✅ — evenimente offline reale, cu **hartă a orașului**
  (OpenStreetMap, fără cheie API), contor de participanți și **„Flirt Passport"** (ștampile
  digitale după check-in confirmat).
- **Simțul umorului ca parametru calculat** ✅ — profilul de umor (sarcasm, umor negru,
  meme/internet, intelectual/fin, absurd, bun/naiv, fizic) e stocat ca **vector de ponderi**
  și intră cu **20%** în Compatibility Score, prin similaritate cosine reală.
- **Compatibility Score** ✅ — calculat înainte de match, în feed.
  **Chemistry Score** 🔜 — din dinamica unei conversații pornite; neimplementat.
- **AI-asistent de chat** 🔜 — sugestii de teme, relansarea dialogurilor „stinse", propuneri
  de evenimente comune. **Neînceput.**

## Platforme

| Platformă | Cerință minimă |
|---|---|
| iOS | 15+ |
| Android | 9.0 (API 28)+ |

Backend și API unic pentru ambele platforme, o singură bază de utilizatori. Mobile
cross-platform: **React Native + Expo**.

## Audiență și restricții de vârstă — **18+ ONLY**

> ### ⚠️ TZ 2.3 (segmentul 16–17) este **OBSOLET** și eliminat complet din produs
>
> **De ce:** App Store și Google Play **nu acceptă aplicații de dating cu minori**. Un
> segment 16–17 nu era o feature riscantă — era un **respingere garantată la review** și un
> risc juridic real. Nu se putea „ascunde" sau „modera mai strict": pur și simplu nu se
> publică.
>
> **Ce am făcut:** am eliminat **tot** codul legat de 16–17 (verificat prin grep — a rămas
> **ZERO**). Nu există separare de grupe, nu există filtru de conținut pe minori, nu există
> „grupa proprie de vârstă".

Aplicația se adresează unui public **adult, urban, orientat spre întâlniri și evenimente
reale**. Vârsta minimă de înregistrare este **18 ani**, confirmată prin data nașterii.

| Setare | Valoare | Rol |
|---|---|---|
| `MIN_REGISTRATION_AGE` | `18` | Pragul de înregistrare. |
| `ADULT_AGE` | `18` | Pragul legal de adult. |
| `SEARCH_AGE_MIN_DEFAULT` | `18` | Ridicat automat la `ADULT_AGE` — **nu se poate căuta sub pragul legal.** |

**Garanție la nivel de config:** aplicația **refuză să pornească** dacă
`MIN_REGISTRATION_AGE` scade sub `ADULT_AGE`. Nu e o validare de formular pe care o poate
ocoli cineva — e o eroare fatală la boot. Un deploy greșit nu poate reintroduce minori în
producție.

## Navigare de nivel înalt

După completarea profilului, ecranul principal are un **tab-bar inferior cu 3 tab-uri**:

1. **Profiluri (Ankete)** — stiva de carduri pentru swipe (ecranul default).
2. **Mesaje** — lista de conversații.
3. **Setări** — profil, foto, status, biletul de Flirt Party, restul setărilor.

## Feature-uri majore

### Onboarding și verificare

| Feature | Stare | Detaliu |
|---|---|---|
| E-mail + parolă | ✅ | JWT (access + refresh). |
| Telefon + OTP | ✅ | OTP stocat în **Redis** (expiră singur, nu poluează DB). |
| Sign in with Apple / Google | ❌ **stub** | Vezi consecința mai jos. |
| Profil obligatoriu | ✅ | Nume, dată naștere, gen, înălțime, oraș, opțional stradă/naționalitate, limbi, „despre mine" (max 500 car.), interese, status de cunoștință. |
| Upload 3–9 fotografii | ✅ | **S3** (boto3). |
| Test de umor la înscriere | ✅ | `/humor/*` → `Profile.humor_vector` → 20% din Compatibility Score. |
| Verificare facială (backend) | ✅ | **AWS Rekognition** — comparație selfie ↔ foto de profil. |
| Captura selfie/liveness (mobil) | ❌ **amânat** | Backendul e gata și așteaptă; **lipsește camera în app**. Fără ea, badge-ul „✓ Verificat" nu se poate obține în practică. |
| Rafinarea vectorului de umor prin NLP din conversații | 🔜 | Neînceput. |

> **❌ Consecința login-ului social amânat:** Apple cere **Sign in with Apple** dacă
> aplicația oferă orice alt login social (Google) — **Guideline 4.8**. Momentan ambele sunt
> stub, deci regula nu e încălcată; dar în clipa în care se activează Google, **Apple devine
> obligatoriu**, nu opțional.

### Swipe și compatibilitate

- ✅ Card full-screen, plăcuță cu nume/vârstă/oraș/**distanță reală**/interese.
- ✅ Acțiuni like/dislike prin **butoane** + **gesturi de swipe**, plus **undo**
  (`POST /feed/undo`). `MatchModal` la match reciproc.
- ✅ **Mesaj trimis la like** (`SendFirstMessageSheet`) — stocat pe `Like.deferred_message`
  și livrat destinatarului **doar după like reciproc** (TZ 4.7).
- 🔜 Galerie multi-foto tip Stories pe card, expandare la profil complet, swipe-up.

#### Algoritm de recomandare — Treapta 1 ✅

Feed-ul nu mai e „toți userii în ordinea din DB". Ce s-a reparat, și de ce conta:

| Ce | De ce era grav înainte |
|---|---|
| **Filtrare pe gen și orientare** | **NU EXISTA.** Un bărbat hetero primea bărbați în feed. Aplicația era, practic, inutilizabilă. |
| **Raza de căutare aplicată efectiv** | Se **salva și se ignora**. Userul o seta și nu se întâmpla nimic. |
| **`lat`/`lng` persistate la salvarea anketei** | Fără ele, distanța nu se putea calcula deloc la scară. |
| **`ORDER BY` determinist + paginare cu cursor** | Fără ordine stabilă, paginarea repeta/sărea profiluri. |
| **`last_active_at`** | Conturile moarte (inactive **>30 zile**) ies din feed. Un feed plin de fantome ucide retenția. |

🔜 **Treapta 2** (ranking comportamental, învățare din swipe-uri) — neînceputa.

#### Compatibility Score ✅

Sumă ponderată, ponderi configurabile din backend:

| Factor | Pondere | Stare |
|---|---|---|
| Interese | 30% | ✅ Jaccard. |
| Umor | 20% | ✅ **similaritate cosine reală** pe vectorul de umor. |
| Status de cunoștință | 15% | ✅ overlap. |
| **Distanță** | 15% | ✅ **reală: `1 − (km / 300)`**. |
| Limbi | 10% | ✅ Cu **gate**: zero limbi comune ⇒ scor 0 pe factor. |
| Semnale comportamentale | 10% | ❌ **încă o constantă `0.5`** (`BEHAVIOR_NEUTRAL`). |

> **De ce conta distanța reală:** înainte era **binar** — același oraș = `1.0`, alt oraș =
> `0.4`. Adică **Chișinău ↔ Bălți (127 km)** și **Chișinău ↔ Moscova (1100 km)** primeau
> **exact același scor**. Acum decade liniar cu kilometrii.
>
> **Onest despre comportament:** cei 10% pentru „semnale comportamentale" **nu fac încă
> nimic** — sunt o constantă `0.5` pentru toată lumea. Nu diferențiază pe nimeni. Rămâne
> plasat în formulă ca să nu rescriem ponderile când apare Treapta 2.

### Chat

| Feature | Stare | Detaliu |
|---|---|---|
| Lista de dialoguri (preview, timestamp, badge necitite) | ✅ | Prin **polling** (React Query, la 5s). |
| Ecran de conversație, mark-read | ✅ | |
| **Mascarea contactelor externe** | ✅ | Instagram/Telegram, telefon, email, linkuri → asteriscuri, **la trimitere**. |
| Reacții pe mesaje (long-press → emoji) | ✅ | `Message.reaction`. |
| Compatibility Score în header + listă | ✅ | |
| Raportare din chat | ✅ | `ReportModal` → `POST /reports/`. |
| Realtime **WebSocket** | 🔜 | **Nu există.** Chat-ul e polling. Vezi [`architecture.md`](./architecture.md). |
| Status online / typing | 🔜 | Depinde de WebSocket. |
| AI-asistent (teme, relansare dialoguri stinse) și **Chemistry Score** | 🔜 | **Neînceput.** |

### Evenimente și Passport

- ✅ Lista de evenimente + detaliu, marcaj „Merg la eveniment".
- ✅ **Check-in** → **Flirt Passport** (ștampilă după vizită confirmată).
- ✅ **Hartă Live Events** — `react-native-webview` + **Leaflet** + tiles **OpenStreetMap**.
  **Gratuit, fără cheie API** (nu Google Maps, nu Mapbox — ambele cer card la înscriere).
- ✅ **Bilet gratuit de Flirt Party** — bilet one-time (cod + QR) per user, emis lazy.
- ✅ **Crearea evenimentelor — din panoul de admin.** Vezi mai jos de ce e critic.
- 🔜 Agregare AI a evenimentelor din surse publice, validarea biletului la intrare (redeem).

### Panou de administrare ✅ — **NOU**

React + Vite (`admin/`), SPA static servit de nginx, peste **21 de rute** `/api/v1/admin/*`.
Rol `role` pe `User`, **citit din DB la fiecare cerere** (nu din token — un admin retrogradat
își pierde puterile instant, nu la expirarea JWT-ului).

| Modul | Ce face |
|---|---|
| **Statistici** | Agregate în SQL, nu în Python. |
| **Moderare** | Coada de raportări, decizii. |
| **Utilizatori** | Ban / unban / **ștergere GDPR**. |
| **Evenimente** | **CRUD complet.** |
| **Abonamente** | Vizualizare și gestiune. |
| **Jurnal de audit** | **Append-only** — cine, ce, când. |

> **De ce panoul nu era „nice to have":** `POST /events` **nu exista în API-ul public**. În
> producție, **nimeni nu putea crea niciun eveniment** — pilonul „Live Events" al aplicației
> era, la propriu, gol și imposibil de umplut. În plus, App Store **cere** un mecanism de
> moderare pentru conținut generat de utilizatori. Fără panou, aplicația nu era lansabilă.

Detalii: [`admin/README.md`](./admin/README.md) · [`admin/api.md`](./admin/api.md).

### Monetizare — ✅ backend gata · ❌ **IAP nativ amânat**

- ✅ **Planuri și entitlements** — `Subscription` + `/subscriptions/*` (plans / me / purchase /
  entitlements). Pachete: `premium`, `no_ads`, `ai_bot`, `all_inclusive`.
- ✅ **Provideri de billing** — **Stripe** și **App Store** conectabili din `.env`.
- ❌ **Plăți IAP native (amânat de user).**

> **⚠️ Consecința, spusă direct:** **fără IAP nativ, aplicația NU poate fi trimisă la App
> Store.** **Guideline 3.1.1** obligă orice conținut digital vândut într-o app iOS să treacă
> prin In-App Purchase. Backendul e pregătit; ce lipsește e integrarea nativă în app și
> validarea de receipt. **Acesta este, azi, blocantul #1 al lansării pe iOS.**

#### Limita free — implementată **altfel** decât cere TZ 4.5

| | TZ 4.5 | Realitatea |
|---|---|---|
| Limită | 10 profiluri / **sesiune** | **50 like-uri / zi** (`FREE_DAILY_SWIPE_LIMIT`) |
| Reclame | timer 15s cu reclamă între porții | **Nu există.** |

**De ce:** „timer cu reclamă" presupune un **SDK de reclame** (AdMob etc.) — nu e integrat
niciunul, deci nu există ce număra sau afișa. O limită zilnică curată e onestă, funcționează
azi și nu depinde de un ad network inexistent.

### Moderare și securitate

- ✅ Mascarea automată a datelor de contact în chat.
- ✅ **Raportări** (spam / fake / offensive / obscene) → `POST /reports/`.
- ✅ **Black list**, **ascundere profil**, **ștergere cont** cu grație de **30 zile**.
- ✅ **Ban real** — se dă **din panoul de admin** și **revocă sesiunile**.
- ✅ **Jurnal de audit append-only** pentru orice acțiune de admin.

> **Corectare de terminologie — „auto-ban"-ul nu e ban.** La **3 raportori distincți**
> (`REPORT_AUTOBAN_THRESHOLD`), profilul intră în **auto-ASCUNDERE**: iese din feed, dar
> **contul se poate loga în continuare**. Nu e o pedeapsă, e o carantină automată până se
> uită un om peste el. **Banul propriu-zis** e o acțiune manuală de admin și **taie
> sesiunile**. Confundarea celor două ar fi însemnat că 3 useri coordonați pot exclude pe
> oricine din aplicație — de aceea automatul doar ascunde, iar omul decide.

## Geolocație ✅

- **Geocoding: Nominatim (OpenStreetMap)** — real, **gratuit, fără cheie API**, cu cache și
  plafon de geocodări noi per cerere de feed (anti-DoS/cost). Self-hosting posibil.
- **Distanță: haversine în aplicație**, calculată din `lat`/`lng` (`Float` în Postgres).
  **Nu folosim PostGIS.**
- **Hărți: Leaflet + tiles OSM** în `react-native-webview`.
- **Adresa exactă nu e niciodată expusă** — pe card apare doar distanța aproximativă
  (`distance_km`, „3 km de tine").

## Ce a rămas: 🔜 planificat vs ❌ amânat

**❌ Amânat prin decizie de produs (nu e datorie tehnică ascunsă):**

| Ce | Consecința reală |
|---|---|
| **Plăți IAP native** | **Blochează submit-ul la App Store** (Guideline 3.1.1). Blocantul #1. |
| **Cameră / selfie** | Verificarea facială (Rekognition) e gata pe backend, dar **inutilizabilă** — nu se poate captura selfie-ul. |
| **Login social nativ** (stub) | La activarea Google devine **obligatoriu** Sign in with Apple (Guideline 4.8). |

**🔜 Planificat, neînceput:** AI-asistent de chat (hint) · Chemistry Score · rafinarea NLP a
vectorului de umor · Treapta 2 a algoritmului (semnalele comportamentale de 10%) · WebSocket
realtime · cadouri virtuale · niveluri/badge-uri Flirt Passport · evenimente și chat-uri de
grup · agregarea AI a evenimentelor.

---

**Surse**: `FLIRT TZ.docx` (sarcina tehnică — **istorică**; TZ 2.3 și TZ 4.5 au fost
abandonate deliberat, vezi mai sus) · `flirt_paleta_culori.png` · `FLIRT Prototype
(standalone).html`.

Vezi și: [Arhitectura reală](./architecture.md) · [Panou de admin](./admin/README.md) ·
[Deployment](./DEPLOYMENT.md) · [Index documentație](./README.md)
