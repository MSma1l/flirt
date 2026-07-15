# FLIRT — Starea reală a proiectului

> **Ce e acest document:** sursa de adevăr onestă despre ce e gata și ce nu. Cifrele de mai jos
> sunt **verificate prin rulare**, nu estimate. Dacă un lucru nu merge, scrie aici că nu merge.
> Un PROGRESS care minte e mai rău decât unul care lipsește — pe baza lui se iau decizii.
>
> Ultima verificare: **15 iulie 2026**, ramura `feat/auth-anketa-scaffold`, commit `24c169d`.

## Cifre reale

| Măsurătoare | Valoare | Cum am verificat |
|---|---|---|
| Teste backend | **507** ✔ | `cd backend && pytest -q` (Postgres real) |
| Teste mobile | **436** ✔ (61 suite) | `cd mobile && npm test` · `tsc --noEmit` curat |
| Teste admin | **19** ✔ (6 fișiere) | `cd admin && npm test` |
| API | **79 operațiuni** pe **68 căi** (58 aplicație + 21 admin) | din OpenAPI-ul aplicației |
| Bază de date | **22 tabele**, 13 migrații Alembic | `Base.metadata` |

> Cifrele vechi din acest document (313 teste backend, „49 endpoint-uri", acoperire 87%) erau
> depășite. Acoperirea a **scăzut** de la 87% la 83% pentru că baza de cod a crescut (panoul de
> admin, observabilitate, paginare) mai repede decât testele — nu pentru că s-au șters teste.

## Unde suntem, realist

| Zonă | Stare | % |
|---|---|---|
| Backend (API, business logic, securitate) | Complet, testat, deployabil | **~95%** |
| Infrastructură / deploy | Validat pe stiva reală (Docker+Postgres+Redis+nginx) | **~95%** |
| Panou de admin | Complet (statistici, moderare, useri, evenimente, abonamente, audit) | **~90%** |
| Aplicația mobilă — fluxuri | Toate ecranele există și funcționează pe backend real | **~85%** |
| Aplicația mobilă — **gata de store** | **Blocată**: fără IAP nativ nu se poate face submit | **~40%** |
| AI (hint chat, Chemistry Score, NLP umor) | Neînceput (TZ 5.3/5.4) | **0%** |

**Actualizare 15 iul 2026 — integrările native sunt IMPLEMENTATE (cod + teste), rămâne procurarea cheilor.**
IAP nativ (StoreKit 2), login social (Apple+Google), push (expo-notifications) și captura selfie
au fost scoase din stub și sunt reale în cod, cu teste verzi. Backend-ul verifică JWS-ul StoreKit 2
(lanț x5c până la Apple Root CA G3), cu anti-replay pe `transaction_id` (index UNIQUE, în producție).
Pagini legale publice live la `https://api.flrt.md/legal/{terms,privacy,support}`.
Ce mai lipsește NU e cod, ci **conturi + chei**: Apple Developer (produse IAP în App Store Connect +
Paid Applications Agreement), Google OAuth client ID, EAS projectId + APNs/FCM, AWS (S3+Rekognition).
Vezi `.context/CHEI_EXTERNE.md`. Fără conturile de developer, funcțiile degradează curat (nu crapă).

---

# 1. ✅ REALIZAT

Implementat, testat și funcțional. Fiecare linie de mai jos are teste care trec.

## Backend — nucleu

- **Auth**: register / login / refresh (rotație + reuse-detection pe familie de tokenuri) /
  logout / me. JWT **RS256**, Argon2 pe parole, refresh stocat doar ca SHA-256.
- **Anketă (TZ 2.4–2.6)**: `PUT /profiles/me` (upsert), catalog de referință (genuri, statusuri,
  limbi, interese), poze prin storage abstractizat (`POST/DELETE /profiles/photos`, reorder),
  cu validare de conținut (magic-bytes + allowlist content-type).
- **Test de umor (TZ 2.7)**: 7 tipuri, 7 carduri → `Profile.humor_vector` (JSON), care intră cu
  **20%** în Compatibility Score.
- **Feed + swipe (TZ 4)**: like/dislike, match reciproc → chat, **undo** (TZ 4.4),
  **mesaj la like** livrat abia la match (TZ 4.7), limită zilnică pentru non-premium.
- **Chat (TZ 5)**: dialoguri, mesaje, reacții emoji (TZ 5.2), mark-read,
  **mascarea contactelor** server-side (TZ 5.5 — telefon/email/URL/@handle/mesagerie).
- **Profil + setări (TZ 6)**: setări, favorite, black list, bilet Flirt Party, ascundere profil,
  ștergere cont cu 30 de zile de grație.
- **Evenimente + Flirt Passport (TZ 8)**: listă, detaliu, „merg", check-in → ștampilă.
- **Stories 24h (TZ 11)**: publicare, vizualizare (self + match-uri), ștergere.
- **Moderare (TZ 5.5/10)**: raportări cu 4 categorii + auto-ascundere la prag de raportori distincți.
- **Abonamente (TZ 9)**: planuri, entitlements, achiziție + validare de receipt (Stripe / App Store).
- **Push (TZ 6.3)**: înregistrare device + trimitere (Expo / FCM).

## Backend — producție

- **TLS real** în nginx (era **comentat**), redirect 80→443, HSTS, certbot automat (emitere + reînnoire).
- **`/health/ready` real**: `SELECT 1` pe Postgres + `PING` pe Redis → **503** dacă o dependență cade.
  (Înainte întorcea `ok` static — un load balancer ar fi trimis trafic într-un API fără bază de date.)
- **Logging structurat JSON** + `request_id` propagat (`X-Request-ID`), access log fără PII/tokenuri.
- **Rate-limiting pe Redis**, partajat între workeri (vezi §2 — era in-memory).
- **Backup + restore** (`pg_dump` periodic, retenție 14 zile, restore care refuză producția fără `--force`).
- **GDPR purge programat** — serviciu Compose separat (`purge`). Funcția exista, dar **n-o apela nimeni**.
- **Guard de producție** care refuză pornirea cu o configurare nesigură (18 verificări — vezi §2).
- **CI** (GitHub Actions): pytest + verificare sintaxă nginx + typecheck/jest pe mobil.
- **Docker Compose complet**: api, db, redis, nginx, certbot, admin-build, purge, backup.
  Un singur `docker compose up --build -d`.

## Backend — performanță

- **N+1 pe `GET /chats` eliminat**: **~604 → 6 query-uri** la 200 de match-uri (constant, indiferent
  de volum). Test de regresie care **numără efectiv statement-urile SQL** și cade dacă numărul crește.
- **Paginare cu cursor** (cursor opac + header `X-Next-Cursor`) pe colecțiile care cresc nemărginit:
  `/feed`, `/chats/{id}/messages`, `/stories`, `/events`, `/social/*` și toate listele de admin.
  **Nu** sunt paginate (deliberat — sunt mărginite prin natura lor): `/chats/` (lista de dialoguri),
  `/feed/matches`, `/reports/mine`, `/events/passport`, `/humor/quiz`, `/subscriptions/plans`.
- **Index-uri** pe `last_active_at`, `(lat, lng)`, chat/stories/events.
- **Seeder la scară** (`scripts/seed_load_data.py`): 2000 useri (implicit) → ~520k rânduri, în zeci de
  secunde. Inserări în batch-uri de 500, parolă Argon2 hash-uită **o singură dată** și reutilizată,
  coordonate reale persistate (fără geocodare prin rețea). Idempotent: `--reset` șterge doar datele de test.
  *(Cifra exactă măsurată la o rulare: 521.852 rânduri în 41s — nu e re-verificată în această trecere,
  necesită un Postgres real.)*

## Panou de admin (nou)

React + Vite pe `admin/`, API `/api/v1/admin/*` (21 rute). Rol `role` pe `User`, citit din DB la
**fiecare** cerere (revocare instantanee, nu un claim în JWT).

- **Statistici** — dashboard cu număr **constant** (~11) de query-uri agregate, indiferent de volum.
- **Moderare** — coada de rapoarte, **cele în așteptare primele** (Apple Guideline 1.2 cere răspuns ≤24h).
- **Useri** — căutare, ban / unban, ștergere GDPR (aceeași funcție ca cron-ul de purjare).
- **Evenimente** — CRUD. **`POST /events` nu exista în API-ul public**, iar seed-ul demo e blocat în
  producție: producția **nu avea nicio cale de a crea un eveniment real**. Secțiunea „Evenimente"
  s-ar fi lansat goală și ar fi rămas goală.
- **Abonamente** — listare + acordare manuală (suport / compensații).
- **Jurnal de audit** — append-only, fără rută de ștergere.
- Bootstrap primul admin: `scripts/create_admin.py` (nu „primul user devine admin" — o cursă clasică).

## Aplicația mobilă

Toate ecranele există și vorbesc cu backend-ul real: splash/redirect, welcome, login, register,
telefon+OTP, wizard de anketă, feed de swipe (gesturi + undo + MatchModal), Stories, chat (reacții,
raportare), profil, setări, favorite, black list, bilet, evenimente (+ hartă), Flirt Passport,
test de umor, paywall, ecran de verificare selfie.

- **Upload de poze din galerie** (`expo-image-picker` + `expo-image-manipulator`): selecție,
  redimensionare la 1920px și recompresie în trepte sub 8 MB **înainte** de upload — o poză făcută cu
  un telefon modern are 5–12 MB și ar fi respinsă de backend cu 413. Integrat ca ultimul pas al
  wizardului de anketă. *(Livrat chiar acum, în paralel cu această documentație.)*
- **Hărți OSM gratuite, fără cheie** — `react-native-webview` + Leaflet, tiles OpenStreetMap (vezi §2).
- Token-uri: access **doar în memorie**, refresh în `expo-secure-store` (Keychain/Keystore).
- `EXPO_PUBLIC_API_URL` per profil în `eas.json`; build-ul de producție **crapă la pornire** dacă
  URL-ul lipsește sau nu e HTTPS (mai bine o eroare la testare internă decât în fața recenzentului Apple).
- Privacy Manifest iOS + permisiuni Android declarate.

## Validat pe stiva REALĂ (nu pe SQLite)

Docker + Postgres 16 + Redis 7 + nginx, nu mediul de test:

- ✔ migrațiile rulează automat la pornire (`alembic upgrade head` în entrypoint);
- ✔ `/health/ready` întoarce **503** cu DB oprit (testat, nu presupus);
- ✔ nginx redirecționează HTTP→HTTPS;
- ✔ end-to-end `register → JWT → anketă → feed` funcționează;
- ✔ rate-limiting pe Redis dă **429** după 5 încercări (partajat între workeri).

---

# 2. 🔧 MODIFICAT față de TZ / planul inițial

Aici e realitatea care **diferă** de sarcina tehnică. Fiecare schimbare are un motiv.

## 18+ ONLY — segmentul 16–17 ELIMINAT complet (TZ 2.3 e OBSOLET)

**Ce zicea TZ 2.3:** vârsta minimă 16 ani, cu separare strictă a feed-urilor (16–17 văd doar 16–17;
18+ văd doar 18+), restricții de conținut pentru minori.

**Ce e acum:** aplicația e **18+ only**. `MIN_REGISTRATION_AGE=18`, `ADULT_AGE=18`, iar configul
**refuză să pornească** dacă cineva coboară pragul sub 18.

**De ce:** App Store și Google Play **nu acceptă** aplicații de dating cu minori. Nu e o preferință
de produs, e o condiție de existență pe magazine. O aplicație care pune adolescenți de 16 ani și
adulți în același produs nu trece de review, indiferent cât de bine e separată tehnic.

**Consecință:** tot ce ținea de segmentul 16–17 (grup de vârstă în token, `require_adult`,
praguri de moderare diferențiate, secțiunea „fără obligații" interzisă minorilor) **nu mai există
în cod**. Verificat: zero referințe. Rămâne un singur gate **dur** de 18+, aplicat în feed, la swipe
și la salvarea anketei.

## Scorul de distanță: din binar → funcție reală pe km

**Înainte:** același oraș = 1.0, alt oraș = 0.4. Adică **Chișinău↔Bălți (127 km) și
Chișinău↔Moscova (1100 km) primeau exact același scor** — factorul „distanță" (15% din scor) nu
măsura nimic.

**Acum:** `scor = 1 − (km / 300)`, plafonat la [0,1]. 0 km → 1.0; 150 km → 0.5; ≥300 km → 0.0.
Distanța reală vine din coordonatele persistate + haversine.

## Algoritm de recomandare (Treapta 1) — filtre care lipseau

Trei probleme reale, reparate:

1. **Nu exista filtrare pe gen/orientare.** Un bărbat heterosexual primea bărbați în feed. Acum
   `UserSettings.interested_in` se aplică efectiv în SQL.
2. **Raza de căutare se salva și se ignora.** Userul o seta, iar feed-ul nu o folosea. Acum se aplică
   (bounding-box în SQL + tăiere exactă pe cerc în Python).
3. **Ordonare nedeterministă** → la paginare, profiluri duplicate sau sărite. Acum `ORDER BY` total
   (`-scor`, apoi `user_id`) + cursor opac.

În plus: `lat`/`lng` persistate la salvarea anketei (nu geocodare la fiecare cerere), `last_active_at`
(inactivii de peste 30 de zile ies din feed), index-uri.

## Rate-limiting: din in-memory → Redis

**Înainte:** contor in-memory, per proces. Cu **4 workeri gunicorn**, limita reală era de **4× ce
scria în config** — un „5 încercări/minut" însemna de fapt 20. O limită falsă e mai rea decât niciuna,
pentru că îți dă impresia că ești protejat.

**Acum:** Redis, partajat între workeri. `REDIS_URL` gol în producție = **eroare de pornire**.
Fallback in-memory doar în dev/test.

## Hărți: Google Maps / Mapbox → OpenStreetMap (gratuit, fără cheie)

**De ce nu Google/Mapbox:** ambele cer card bancar și cont de facturare chiar și pentru nivelul
gratuit. Pentru un produs care încă nu are venit, e o dependență de cost inutilă.

**Acum:** `react-native-webview` + **Leaflet** + tiles **OpenStreetMap**. Zero chei, zero cont,
zero cost. Atribuția OSM (cerută de licența ODbL) e afișată. Geocodarea se face cu **Nominatim**
(tot OSM, gratuit) — cere doar un `User-Agent` cu email real, iar guardul de producție refuză
valoarea implicită.

`GEO_PROVIDER=google|mapbox` rămâne în cod, ca opțiune, dacă vreodată e nevoie.

## Compatibility Score — umorul e real, comportamentul încă nu

Ponderile din TZ 4.6 sunt respectate (interese 30%, status 15%, umor 20%, distanță 15%, limbi 10%,
comportament 10%), dar **factorul „comportament" (10%) e o constantă 0.5** — semnalele
comportamentale nu sunt încă implementate. Restul de 90% e calculat real.

## Limita free: 10/sesiune (TZ 4.5) → 50 like-uri/zi

TZ cere 10 profiluri pe sesiune + timer de 15s cu reclamă. Implementat e un plafon zilnic
(`FREE_DAILY_SWIPE_LIMIT=50`) pentru non-premium. **Timerul de 15s și reclamele nu există** —
nu există niciun SDK de reclame în aplicație.

## „Auto-ban"-ul la raportări e de fapt auto-ASCUNDERE

La 3 raportori distincți, profilul e **ascuns din feed** și rapoartele sunt marcate `auto_banned`,
dar contul **nu** primește `banned_at` — userul se poate în continuare autentifica. Este intenționat
(o măsură automată de urgență, nu o sancțiune finală) și rămâne în coada moderatorului pentru o
decizie umană. **Banul adevărat** (care revocă sesiunile) se dă doar din panoul de admin.

## Realtime: WebSocket → polling

Chat-ul folosește polling (React Query, la 5 secunde), nu WebSocket. Funcțional, dar nu „live".

## Arhitectură: fără Celery, fără PostGIS

Blueprint-ul inițial prevedea Celery (workeri async) și PostGIS (interogări geo în DB). Niciunul nu
e folosit: nu există sarcini suficient de grele ca să justifice un broker, iar `lat`/`lng` ca `Float`
+ haversine în aplicație acoperă nevoia geo. Docs-urile care le mai menționează sunt blueprint, nu realitate.

---

# 3. 🔜 URMEAZĂ

În ordinea în care are sens să fie făcute.

| # | Ce | De ce acum | Efort onest |
|---|---|---|---|
| 1 | **Câmpul `receipt` în `PurchaseIn`** | 🐛 **Bug real, prerechizit pentru IAP.** Backend-ul *are* validare de receipt, dar schema API nu poate transporta unul (vezi §4) — cu un provider live, orice achiziție dă **402**. Fără asta, IAP-ul nativ n-are unde să trimită dovada. | **mic** (ore) |
| 2 | **URL-uri legale reale** (termeni, confidențialitate, suport) | Acum sunt placeholder-e active către `https://flirt.app/...` — un domeniu care **nu e al nostru**. Obligatorii la submit (Guideline 5.1.1). | **mic** (+ paginile) |
| 3 | **IAP nativ** (StoreKit + Play Billing) | **Blocantul lansării.** Vezi §4. | **mediu** (1–2 săptămâni) |
| 4 | **Login social nativ** (Apple + Google) | Vezi §4 — Apple îl cere dacă există Google. | **mediu** (câteva zile) |
| 5 | **Push real** (`expo-notifications`) | Acum tokenul e un șir fals. Vezi §4. | **mic-mediu** |
| 6 | **Cameră / selfie de verificare** | Backend-ul (Rekognition) e gata. Lipsește captura. | **mic-mediu** (2–4 zile) |
| 7 | **Google Play Billing pe backend** | `BILLING_PROVIDER=play` trece de guard, dar ridică `NotImplementedError` → 500 la prima achiziție Android. | **mic-mediu** |
| 8 | **Semnalele comportamentale** în Compatibility Score | Ultimii 10% din scor sunt o constantă. | **mic** |
| 9 | **WebSocket pentru chat** | Polling-ul merge, dar nu scalează elegant și nu dă „typing". | **mediu** |
| 10 | **AI: hint de conversație + Chemistry Score** (TZ 5.3/5.4) | Diferențiatorul de produs din TZ. Neînceput. Cheia AI decisă: **Anthropic**. | **mare** |
| 11 | Timer 15s + reclame (TZ 4.5) | Necesită un SDK de reclame + decizie de business. | **mediu** |
| 12 | Agregare AI a evenimentelor din surse publice (TZ 8.1) | Roadmap. Acum evenimentele se creează manual din admin. | **mare** |

---

# 4. ❌ AMÂNAT (conștient)

Lucruri care **nu** se fac acum, cine a decis și ce costă.

## Plăți IAP native — amânate de user

**Ce lipsește:** achiziția nativă (StoreKit pe iOS, Google Play Billing pe Android). Nu există niciun
SDK de plată în `mobile/package.json`.

**Ce EXISTĂ deja:** modelul `Subscription`, planurile, entitlements, validarea de receipt
(App Store + Stripe) pe backend, și paywall-ul complet pe mobil (carduri de plan, preț, termeni de
reînnoire automată, „Restaurează achizițiile", linkuri ToS/Privacy). Butonul „Alege" apelează
`POST /subscriptions/purchase`, iar backend-ul **activează abonamentul direct** — fără plată reală.

> ### 🐛 Și e mai rău decât „lipsește SDK-ul": API-ul nu poate transporta un receipt
>
> `billing.purchase()` acceptă un parametru `receipt` și îl validează corect la providerii live.
> Dar **schema `PurchaseIn` conține doar `{ plan }`**, iar ruta apelează
> `billing.purchase(db, user, data.plan)` — **fără receipt**. Rezultat: `receipt = None`.
>
> Consecință: cu `BILLING_PROVIDER=app_store` sau `stripe`, **orice** achiziție întoarce **402
> „Lipsește receipt-ul"**. Validarea de receipt e scrisă, testată... și **inaccesibilă prin API**.
> Merge doar în modul `stub` — adică exact modul care nu are voie să ruleze în producție.
>
> Deci IAP-ul nativ nu e „ultimul pas": înaintea lui trebuie adăugat câmpul `receipt` în schemă
> (vezi §3, punctul 1). Altfel SDK-ul nativ n-ar avea unde să trimită dovada de plată.

> ### ⛔ Consecința, negru pe alb: **FĂRĂ IAP NU SE POATE FACE SUBMIT LA APP STORE.**
>
> Apple **Guideline 3.1.1** cere ca orice conținut digital sau funcționalitate deblocată contra cost
> să treacă exclusiv prin In-App Purchase. O aplicație care vinde „Premium" ocolind IAP e **respinsă**.
> Iar dacă abonamentul s-ar acorda gratuit ca să evităm subiectul, paywall-ul devine o minciună.
>
> **Acesta este blocantul #1 al lansării.** Tot restul produsului e livrabil; asta nu.

## Cameră / verificare prin selfie — amânată de user

**Ce lipsește:** captura nativă (`expo-camera` / `expo-image-picker` nu sunt instalate).

**Ce EXISTĂ:** backend-ul de verificare facială (AWS Rekognition, prag de similaritate configurabil,
`Profile.verified`) și ecranul mobil `verify-face.tsx` — cu explicații, buton și stări de
succes/eroare. La apăsare trimite un marcaj JSON către `/profiles/verify-face`; **nicio imagine nu e
capturată sau încărcată**.

**Consecință:** badge-ul „✓ Verificat" nu poate fi câștigat de un user real. Nu blochează submit-ul,
dar elimină un mecanism anti-fake pe care TZ îl considera obligatoriu (TZ 2.2).

## Login social nativ (Apple / Google) — stub

`socialAuth.ts` întoarce token-uri hardcodate (`'stub:google@example.com'`). Backend-ul verifică
JWKS real (Google + Apple) și e gata; lipsește doar obținerea nativă a token-ului
(`expo-auth-session` / `expo-apple-authentication`).

**Consecință (Guideline 4.8):** dacă aplicația oferă login prin Google (sau orice provider social
terț), Apple **cere obligatoriu** și „Sign in with Apple". Deci: ori le implementăm pe amândouă,
ori le scoatem pe amândouă din UI înainte de submit. Nu există variantă „doar Google".

## Push notifications — stub pe mobil

`expo-notifications` **nu e instalat**. `pushService.getPushToken()` întoarce un șir fals
(`expo-dev-token-ios`), pe care îl înregistrează cuminte la `POST /push/register`. Backend-ul
(Expo / FCM) e gata și ar trimite notificări — către un token care nu există.

**Consecință:** niciun push nu ajunge pe un telefon real. În plus, `app.json` cere deja permisiunea
Android `POST_NOTIFICATIONS` și declară `NSCameraUsageDescription` pe iOS — **cerem permisiuni pe
care nu le folosim**. La review, o aplicație care cere acces la cameră și notificări fără să le
folosească e un semnal prost (și un motiv frecvent de întrebări din partea recenzentului).

## Reclame (SDK) — neplanificat

Fără SDK de reclame nu există timer de 15s, interstițiale sau planul `no_ads` cu sens real.
Depinde de o decizie de business (rețea de reclame, venit estimat).

---

## Cum rulezi

```bash
# Backend
cd backend && . .venv/bin/activate && python -m pytest -q     # 445 teste
cd backend && docker compose up --build                        # stiva completă

# Mobile
cd mobile && npm test                                          # 340 teste
cd mobile && npm start

# Admin
cd admin && npm test                                           # 19 teste
cd admin && npm run dev
```

Deploy în producție: [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).
Breșe de securitate găsite și închise: [`SECURITY.md`](./SECURITY.md).
