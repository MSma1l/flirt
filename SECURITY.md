# FLIRT — Raport de securitate (pentest + remediere)

Audit defensiv + remediere + teste de regresie. Status pe fiecare finding.
Legendă: ✅ reparat (cu test) · 🟡 parțial/acceptat · 📋 operațional (la deploy).

**Stare curentă:** backend **445 teste** verzi, acoperire **83%**.
Teste de regresie de securitate: `test_feed_security.py` · `test_security_hardening.py` ·
`test_upload_security.py` · `test_block_gdpr_security.py` · `test_admin_security.py` ·
`test_security_edges.py` · `test_security_unit.py` · `test_config.py` · `test_ops.py`.

---

# Valul 2 — breșe găsite la auditul de producție (recent)

Acestea sunt cele mai grave, pentru că fiecare dintre ele **arăta ca și cum ar funcționa**.
Un control de securitate care pare activ, dar nu e, e mai periculos decât unul absent: te bazezi pe el.

## Critice

| # | Finding | Status | Fix |
|---|---|---|---|
| **P1** | **Banul NU revoca sesiunile.** Se seta `banned_at`, dar refresh token-ul rămânea valid. Access-ul expiră în 15 min — refresh-ul e o creanță de **30 de zile**. Un cont banat care rotea refresh-ul **folosea aplicația o lună întreagă.** Banul era teatru. | ✅ | `admin_service.ban_user()` face **trei** lucruri în aceeași tranzacție: `banned_at` + motiv, **revocarea tuturor sesiunilor de refresh**, `profile_hidden`. `get_current_user` citește banul **din DB la fiecare cerere** (403 imediat), iar `rotate_refresh` refuză un cont banat. |
| **P2** | **Ștergerea GDPR lăsa `PushDevice` în urmă.** Un cont „șters" continua să **primească notificări push** pe telefon. Datele personale ștergeau, dar canalul de contact rămânea deschis. | ✅ | `purge_user_data` șterge acum și `PushDevice` (plus Ticket, EventAttendance, FlirtPassportStamp, Subscription). Rândul din `users` se **anonimizează** (`deleted+{uuid}@deleted.invalid`), nu se șterge, ca să nu rupă cheile externe. |
| **P3** | **Purjarea GDPR nu rula NICIODATĂ.** Funcția `purge_expired_accounts()` exista, era testată... și **n-o apela nimeni**. Conturile „șterse" rămâneau în baza de date la infinit. Conformitatea era un comentariu. | ✅ | Serviciu Docker Compose **separat** (`purge` → `scripts/gdpr_purge.py --loop`). Deliberat NU în lifespan-ul FastAPI: cu 4 workeri gunicorn ar fi rulat de 4 ori în paralel. |
| **P4** | **Rate-limiting fals.** Contorul era in-memory, per proces. Cu **4 workeri gunicorn**, limita reală era **4× cea configurată**: „5 încercări/minut" însemna de fapt 20. Protecția anti-brute-force era un sfert din ce credeam. | ✅ | Rate-limiting pe **Redis**, partajat între workeri (`INCR`+`EXPIRE` în pipeline). `REDIS_URL` gol în producție = **refuz de pornire**. Fallback in-memory doar în dev/test. |
| **P5** | **TLS era COMENTAT în nginx.** Configul avea blocul HTTPS, dar comentat. Deploy-ul ar fi servit **HTTP în clar** — cu tokenuri JWT și mesaje private pe fir. | ✅ | TLS activ (TLS 1.2/1.3, cifruri AEAD), redirect **80→443**, HSTS `max-age=63072000; includeSubDomains; preload`, certbot automat (emitere + reînnoire). Host necunoscut / scanare pe IP brut → `444` (conexiune închisă). |
| **P6** | **Guardul de producție accepta CHEI GOALE.** Verifica doar *modul* (`stub` vs `live`), nu și dacă cheile există. Un `.env` cu `STORAGE_PROVIDER=s3` și `AWS_SECRET_ACCESS_KEY=` gol trecea guardul și pornea — apoi crăpa la prima poză. La fel, **`GEO_PROVIDER` lipsea complet** din lista verificată: putea rămâne pe `stub` în producție. | ✅ | Guardul verifică acum **și cheile, per provider** (18 verificări), include `GEO_PROVIDER`, respinge un `.env` necompletat (orice valoare care mai conține `<<< COMPLETEAZĂ >>>`), și refuză `User-Agent`-ul implicit la Nominatim (politica OSM). Vezi tabelul complet mai jos. |

## Înalte

| # | Finding | Status | Fix |
|---|---|---|---|
| **P7** | **`/health/ready` mințea.** Întorcea `{"status":"ok"}` **static**, fără să atingă nicio dependență. Un load balancer ar fi trimis trafic către un API cu baza de date căzută, la nesfârșit. | ✅ | Readiness real: `SELECT 1` pe Postgres + `PING` pe Redis, cu timeout de 3s → **503** dacă o dependență cade. Verificat: cu `db` oprit, întoarce 503. `/health` (liveness) rămâne separat și nu atinge nimic. |
| **P8** | **Feed-ul nu filtra pe gen/orientare.** Un bărbat heterosexual primea **bărbați** în feed. În plus, **raza de căutare se salva și se ignora** — userul o seta, feed-ul n-o folosea. | ✅ | `UserSettings.interested_in` se aplică efectiv în SQL; raza se aplică (bounding-box + tăiere exactă pe cerc). Ordonare deterministă + paginare cu cursor (înainte: profiluri duplicate/sărite la paginare). |
| **P9** | **Rapoartele de moderare nu le citea nimeni.** `POST /reports` scria rânduri într-o tabelă pe care **nicio interfață nu o afișa**. Apple **Guideline 1.2** cere răspuns la raportări în **≤24h** — cerința era *imposibil* de îndeplinit, nu doar neîndeplinită. | ✅ | Panou de admin cu coadă de moderare (`GET /admin/reports`), sortată cu **cele în așteptare primele**, + rezolvare (ban / hide / dismiss) și jurnal de audit. |
| **P10** | **N+1 pe `GET /chats`**: 3 query-uri per chat → **~604 query-uri** la 200 de match-uri. Nu e strict o breșă de securitate, dar e un **DoS pe cheltuiala noastră**: orice user cu multe match-uri devenea cel mai scump endpoint al aplicației. | ✅ | **6 query-uri constant**, indiferent de volum. Test de regresie care **numără efectiv statement-urile SQL** și cade dacă numărul crește cu datele. |

## Operaționale (nu compromiteau datele, dar blocau deploy-ul)

| # | Finding | Status | Fix |
|---|---|---|---|
| **P11** | **Dockerfile-ul NU se construia DELOC.** `pip install .` rula **înainte** de `COPY . .` — pip încerca să construiască pachetul fără directorul `app/`. Imaginea **nu s-a construit niciodată** cu succes. | ✅ | Se instalează doar *dependențele* (extrase din `pyproject.toml`), iar `COPY . .` rămâne dedesubt — aplicația rulează ca `app.main:app` din `/app`, nu are nevoie să fie instalată ca pachet. Layer-ul de pip se invalidează doar când se schimbă `pyproject.toml`. |
| **P12** | **Coliziune de nume Docker.** Compose deriva numele proiectului din folder (`backend`) — orice alt proiect cu un folder `backend` s-ar fi ciocnit de aceleași volume/rețele. | ✅ | `name: flirt` explicit în `docker-compose.yml`. |
| **P13** | **Producția nu putea crea niciun eveniment.** `POST /events` **nu exista** în API-ul public, iar seed-ul demo se oprește explicit când `environment == "production"`. Secțiunea „Evenimente" s-ar fi lansat goală și ar fi rămas goală. | ✅ | CRUD complet în panoul de admin (`/admin/events`) — singura cale prin care un eveniment real ajunge în baza de producție. |

---

# Valul 1 — pentest inițial (4 dimensiuni)

## Findings CRITICE

| # | Finding | Status | Fix |
|---|---|---|---|
| C1 | Modul `stub` de auth/OTP/billing poate rula în producție → account takeover, premium gratuit | ✅ | `_guard_production` respinge `stub`/`debug`/`CORS=*` în `environment=production` |
| C2 | Gate de vârstă doar în feed; `swipe` accepta orice țintă | ✅ | `_authorize_swipe`: verifică vârstă (18+) + block + hidden + completed + self + existență |
| F1 | Zero rate-limiting → brute-force login/OTP, SMS bombing | ✅ | `app/core/ratelimit.py` (Redis) + `limit_req` în nginx pe `/` și `/auth/` |
| F2 | OTP brute-force (fără limită de încercări) | ✅ | contor de încercări per telefon + invalidare la `otp_max_attempts` (5) + cooldown |

## Findings ÎNALTE

| # | Finding | Status | Fix |
|---|---|---|---|
| F5 | Mesaj deferred la like livrat NEMASCAT → ocolire mascare contacte (TZ 5.5) | ✅ | `mask_contacts` aplicat la livrare + `max_length` pe `SwipeIn.message` |
| S1 | Ștergere/citire arbitrară de obiecte S3 (cheie derivată din URL user) | ✅ | allowlist domeniu `storage_base_url` + prefix `photos/{profile_id}/`; cheia nu se derivă din input |
| U1 | Upload fără validare → stored XSS prin Content-Type | ✅ | allowlist content-type + **magic-bytes** + tip forțat server-side |
| F6 | Feed DoS: candidați nemărginiți + geocoding per candidat | ✅ | `feed_scan_limit` (SQL) + coordonate **persistate** la salvarea anketei (zero geocodare în feed) |
| F4 | Premium fără enforcement în feed | ✅ | limită `free_daily_swipe_limit` (50)/zi pentru non-premium; premium nelimitat |
| G1 | GDPR: ștergere cont doar „soft", fără purge real | ✅ | `purge_expired_accounts()` — vezi și **P3** (nimeni nu o apela) |

## Findings MEDII

| # | Finding | Status | Fix |
|---|---|---|---|
| U2 | Upload fără limită de dimensiune → DoS | ✅ | respinge > `max_upload_bytes` (8 MB) → 413 |
| U3 | URL-uri poze arbitrare în anketă + liste nemărginite | ✅ | `is_https_url` + allowlist + `max_photos` + `max_length` pe liste |
| M1 | User blocat scrie în chat existent | ✅ | `_ensure_not_blocked` în `send_message`/`react_to_message` (403) |
| M2 | Enumerare useri (timing la login) | ✅ | `verify_password` pe hash dummy constant → timing uniform + 401 generic |
| M3 | Validare target moderare (raport către user inexistent, `chat_id` neverificat) | ✅ | 404 target inexistent + participant-check pe `chat_id` + `max_length` pe notă |
| D1 | `debug=True` în prod → stack traces + SQL cu PII | ✅ | blocat de `_guard_production`; handler global → răspuns generic + `request_id` |
| CO1 | CORS `allow_credentials=True` + risc `*` | ✅ | guard respinge `*` în prod (auth e pe Bearer) |
| H1 | Lipsă HSTS / TLS forțat în nginx | ✅ | vezi **P5** — TLS real, HSTS, redirect 80→443 |
| J1 | JWKS: fallback pe `keys[0]` la `kid` necunoscut | ✅ | respinge tokenul cu `kid` necunoscut |

---

# Guardul de producție — ce verifică, exact

`_guard_production()` (`app/core/config.py`) rulează doar când `ENVIRONMENT=production`, adună **toate**
problemele și ridică o singură `ValueError` cu lista completă. Aplicația **nu pornește** cu o configurare nesigură.

| Verifică | Respinge |
|---|---|
| `.env` necompletat | orice valoare care mai conține `<<< COMPLETEAZĂ >>>` |
| Parolă DB | `POSTGRES_PASSWORD=change_me`; lipsă DB URL **și** parolă |
| Chei JWT | `JWT_PRIVATE_KEY` sau `JWT_PUBLIC_KEY` goale |
| Integrări pe `stub` | `SOCIAL_AUTH_MODE`, `OTP_MODE`, `BILLING_PROVIDER`, `FACE_VERIFY_PROVIDER`, `STORAGE_PROVIDER`, `PUSH_PROVIDER`, **`GEO_PROVIDER`** |
| Chei per provider | S3 fără `S3_BUCKET`/`S3_REGION`/`AWS_*` · Rekognition fără `AWS_*` · social live fără `GOOGLE_CLIENT_ID`/`APPLE_CLIENT_ID` · OTP live fără Twilio · Stripe fără `STRIPE_SECRET_KEY` · App Store fără `APP_STORE_SHARED_SECRET` · FCM fără `FCM_SERVER_KEY` · google/mapbox fără `GEO_API_KEY` |
| Redis | **`REDIS_URL` gol = eroare, mereu** (fără el rate-limiting-ul devine fals — vezi P4) |
| Nominatim | `GEO_USER_AGENT` implicit (`example.com`) — politica OSM îl blochează |
| Debug / CORS | `DEBUG=true` · `CORS_ORIGINS` care conține `*` |

Separat, `_guard_adult_only()` rulează în **orice** mediu: `ValueError` dacă `MIN_REGISTRATION_AGE < ADULT_AGE`.
Aplicația e **18+ only** — o configurare greșită nu poate readuce minorii în produs.

---

# Rate limiting — limitele reale

| Endpoint | Limită (per IP) | Fereastră |
|---|---|---|
| `POST /auth/login` | **5** | 1 min |
| `POST /auth/register` | **10** | 1 oră |
| `POST /auth/phone/request` | **5** | 1 oră |
| `POST /auth/phone/verify` | **5** | 1 min |
| `POST /admin/login` | **3** | 1 min (bucket separat — conturile cele mai valoroase) |

La margine, nginx: `flirt_general` 20r/s (burst 40), `flirt_auth` 5r/m (burst 10) → `429`.
OTP: maximum **5 încercări** per cod, apoi codul e invalidat.
Non-premium: **50** like-uri / 24h.

---

# Confirmate SIGURE la audit (fără acțiune)

- **JWT RS256** fixat explicit (anti `alg=none` / algorithm confusion); refresh **rotativ** + reuse-detection
  cu revocare pe toată familia de tokenuri.
- **Rolul și banul se citesc din DB la fiecare cerere**, nu dintr-un claim JWT → revocare **instantanee**.
  Un admin demis nu rămâne admin 15 minute.
- **IDOR** corect per resursă (chat / stories / favorites / blocks / settings / subscriptions scopate pe `user.id`).
- **Fără mass-assignment** (`verified` / `completed` / `role` doar server-side; Pydantic ignoră câmpurile extra).
- **Parole Argon2**; refresh stocat **doar ca SHA-256**; token mobil în SecureStore (Keychain/Keystore).
- **SQLi**: 100% ORM parametrizat, zero SQL brut. `%` și `_` escapate explicit în căutările de admin
  (fără asta, o căutare de `%` întorcea toată tabela — un DoS declanșat dintr-un câmp de căutare).
- **Fără expunere PII**: adresa exactă nu e niciodată serializată — doar `distance_km`. Fără emailuri ale
  altora, fără hash-uri în output. Schemele de admin enumeră **explicit** fiecare câmp expus.
- **Fără SSRF** (S3 prin SDK, host ignorat); fără ReDoS (input plafonat).
- **Secretele 100% din env**, niciodată în cod sau în git.
- **Selfie-ul biometric NU e stocat** — doar un boolean `verified`.
- **Jurnal de audit append-only**: nu există rută de ștergere sau editare. Un jurnal pe care adminul
  suspect îl poate curăța nu e un jurnal.

---

# 🟡 Acceptat conștient

- **„Auto-ban"-ul la raportări e de fapt auto-ASCUNDERE.** La 3 raportori distincți, profilul iese din feed
  și rapoartele sunt marcate `auto_banned`, dar contul **nu** primește `banned_at` — se poate încă autentifica.
  E intenționat: o măsură automată de urgență, nu o sancțiune finală. Cazul **rămâne în coada moderatorului**
  pentru o decizie umană (Apple cere una). Banul real, care revocă sesiunile, se dă doar din panoul de admin.
- **Refresh token-ul panoului de admin stă în `sessionStorage`**, nu într-un cookie httpOnly — backend-ul
  întoarce tokenurile în corpul JSON și nu setează cookie-uri. Compromis conștient, documentat în cod.
- **Chat-ul nu e criptat end-to-end.** Mesajele sunt criptate la tranzit (TLS) și la nivel de disc, dar
  serverul le poate citi — necesar pentru mascarea contactelor și moderare.

# 📋 Operațional la deploy

- `ENVIRONMENT=production`, `DEBUG=false`, `CORS_ORIGINS` explicit — **guardul le impune**, nu poți uita.
- `.env` cu `chmod 600`; cheia privată JWT generată **pe server**, niciodată în git.
- Doar `nginx` publică porturi (80, 443). **Postgres și Redis nu au niciun port pe host** — un Redis expus
  pe internet e preluat în minute (`CONFIG SET` → execuție de cod).
- Firewall: doar 22, 80, 443 (și în panoul providerului, nu doar `ufw`).
- Backup-uri pe alt disc / off-site, **testate prin restore** (`make restore`). Un backup pe care nu l-ai
  restaurat niciodată nu e un backup, e o presupunere.

Vezi [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) pentru procedura completă și checklistul final.
