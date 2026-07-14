# FLIRT — Arhitectură Backend

> **Slogan:** *No Regrets*
> Backend pentru aplicația de dating FLIRT (iOS / Android), un singur API pentru ambele platforme.

Acest document descrie **arhitectura reală** a backend-ului: stack-ul, structura de foldere, separarea pe straturi și unde intervine AI. Este sursa de adevăr pentru organizarea codului.

> **Acest document descrie ce EXISTĂ în cod.** Ce e doar planificat e marcat cu 🔜. Dacă găsești o divergență între document și cod, **codul are dreptate**.
>
> Cifre verificate: **445 teste** backend (37 module, 392 funcții), acoperire **83%**. Rulare: `cd backend && pytest -q`.

---

## Cuprins

| Document | Ce conține |
|---|---|
| [`README.md`](./README.md) | Arhitectura generală, stack, structura de foldere, unde intervine AI |
| [`api-spec.md`](./api-spec.md) | Specificația endpoint-urilor REST grupate pe domeniu |
| [`data-models.md`](./data-models.md) | Schema DB, entități, relații, indexuri, formula Compatibility Score |
| [`security.md`](./security.md) | Autentificare, JWT, sesiuni, rate limiting, GDPR, guardul de producție |
| [`../DEPLOYMENT.md`](../DEPLOYMENT.md) | Deploy pe server real: TLS, nginx, `.env`, backup |
| [`../INTEGRATIONS.md`](../INTEGRATIONS.md) | Integrări externe: provideri, chei, moduri `stub` / `live` |

---

## 1. Stack tehnologic

Backend Python async, **fără workeri și fără broker de cozi**. Procesarea „grea" (verificare facială, geocoding, push) se face **sincron în request**, prin apeluri HTTP către servicii externe.

| Componentă | Tehnologie | Rol |
|---|---|---|
| **Web framework** | **FastAPI** (ASGI) | API REST, validare automată, OpenAPI generat |
| **Server de producție** | **gunicorn** cu **4 workeri uvicorn** | vezi `entrypoint.sh` |
| **ORM + migrări** | **SQLAlchemy 2.0** (async) + **Alembic** | mapping, versionare schemă |
| **Bază de date** | **PostgreSQL 16** — **fără PostGIS** | `lat`/`lng` sunt coloane `Float`; distanța se calculează cu **haversine în aplicație** |
| **Redis** | **doar** rate-limiting (prefix `rl:`) + store OTP live (prefix `otp:`) | **nu** ține sesiuni, **nu** e cache de feed, **nu** e broker |
| **Validare / config** | **Pydantic v2** + `pydantic-settings` | scheme request/response, config din env |
| **Auth** | **`python-jose`** (JWT RS256) + **`passlib[argon2]`** | tokenuri și parole |
| **HTTP client** | **`httpx`** | JWKS Apple/Google, Nominatim, Twilio, Stripe, FCM |
| **Object storage** | S3 (`boto3`) sau stub local | fotografii de profil |
| **Reverse proxy / TLS** | **nginx** + **certbot** (Let's Encrypt) | TLS 1.2/1.3, HSTS, rate limit la margine |

### Ce NU folosim (și de ce contează să fie scris)

| ❌ | De ce nu |
|---|---|
| **Celery / workeri async / broker** | Nu există. Nici o coadă, nici un `workers/`. Operațiile lente (Rekognition, geocoding, push, Stripe) se fac **în request**. Simplu, dar are un cost: o cerere care declanșează geocoding e mai lentă. Mitigat prin plafoane (`GEO_MAX_LOOKUPS_PER_REQUEST=25`). |
| **PostGIS** | Nu e instalat. Filtrarea pe rază se face în două trepte: **bounding box în SQL** (folosește indexul `ix_profiles_lat_lng`; un `WHERE` pe haversine nu ar putea) + **haversine exact în Python** (`services/geo.py`). Bounding box-ul e generos prin construcție — nu poate elimina din greșeală un candidat valid. |
| **Cache de feed în Redis** | Feed-ul se construiește la fiecare cerere, direct din DB, cu plafon `FEED_SCAN_LIMIT=500` candidați scanați (anti-DoS). |
| **Model NLP** | Mascarea contactelor e pe **regex** (`services/contact_masker.py`), nu NLP. Vezi `security.md` §4.3. |

### De ce alegerile care există

- **FastAPI** — async-first (backend-ul e I/O-bound: DB, S3, servicii externe), validare declarativă cu Pydantic, contract OpenAPI gratuit cu echipele mobile.
- **SQLAlchemy 2.0 async + Alembic** — control fin pe interogările de feed (ranking, join-uri) și migrări versionate, rulate automat de `entrypoint.sh`.
- **PostgreSQL** — datele sunt puternic relaționale (users ↔ likes ↔ matches ↔ chats).
- **Redis, minimal** — un contor partajat de rate-limit **trebuie** să fie comun celor 4 workeri (altfel limita reală devine 4× cea configurată). Asta e singura nevoie reală de Redis azi. Vezi `security.md` §5.1 și §6.

---

## 2. Structura de foldere — reală

Straturi separate (`api` / `services` / `models` / `schemas`), grupate pe domeniu în fiecare strat. **Logica de business nu se amestecă cu stratul HTTP sau cu accesul la date.**

```
backend/
  app/
    main.py                   # FastAPI, middleware (CORS, request-id, access log),
                              #   handler global de excepții, lifespan
    core/
      config.py               # Settings (Pydantic) + _guard_adult_only + _guard_production
      security.py             # Argon2 (passlib) + JWT RS256 (python-jose) + hash_token
      deps.py                 # get_current_user, require_admin (rolul/banul din DB!)
      logging.py              # logging JSON, RequestContextMiddleware, AccessLogMiddleware
      ratelimit.py            # rate limiting Redis (fallback in-memory) + client_ip
      validators.py           # safe_str, optional_safe_str, is_https_url
    api/
      v1/
        router.py             # api_router: agregă toate routerele de domeniu
        auth.py               # register/login/refresh/logout, Google, Apple, telefon+OTP
        profiles.py           # anketă CRUD, upload foto (magic-bytes), verificare facială
        feed.py               # GET /feed, POST /feed/swipe, /feed/undo, GET /feed/matches
        chat.py               # dialoguri, mesaje, reacții, mascare contacte
        settings.py           # temă, notificări, preferințe de căutare, ștergere cont
        social.py             # favorite, blacklist
        ticket.py             # bilet Flirt Party
        events.py             # evenimente, „iau parte", Flirt Passport
        stories.py            # povești (TTL 24h)
        humor.py              # profil de umor
        reports.py            # raportări de moderare
        subscriptions.py      # planuri, achiziții, entitlements
        push.py               # înregistrare dispozitiv push
        health.py             # /health, /health/ready (montate la RĂDĂCINĂ, nu sub /api/v1)
        admin/                # PANOUL DE ADMIN (subpachet)
          __init__.py         #   require_admin aplicat pe include_router, o dată
          auth.py             #   POST /admin/login (rate limit 3/min, bucket separat)
          users.py  moderation.py  events.py  subscriptions.py  stats.py  audit.py
    models/                   # SQLAlchemy (1:1 cu data-models.md)
      user.py  session.py     #   User; RefreshSession (refresh în DB, ca SHA-256)
      profile.py  interest.py
      swipe.py                #   Like, Match
      chat.py                 #   Chat, Message
      event.py                #   Event, EventAttendance, FlirtPassportStamp
      story.py  account.py    #   Story; UserSettings, Favorite, Block, Ticket,
                              #     AccountDeletionRequest
      moderation.py           #   Report
      billing.py  device.py   #   Subscription; PushDevice
      admin.py                #   AdminAuditLog
    schemas/                  # Pydantic (request/response DTO)
      auth.py  profile.py  feed.py  chat.py  account.py  event.py
      story.py  humor.py  moderation.py  billing.py  admin.py
    services/                 # business logic (independentă de HTTP)
      auth_service.py         # register, login, rotație refresh + reuse detection, logout
      auth_providers.py       # JWKS Apple/Google, OTP (Redis live / in-memory stub)
      profile_service.py      # validări anketă, ordonare foto, status
      feed_service.py         # construire feed + ranking (Treapta 1 + 2)
      compatibility.py        # Compatibility Score — funcție PURĂ, fără DB
      chat_service.py         # mesaje, deferred likes, reacții, apel la contact_masker
      contact_masker.py       # mask_contacts() — REGEX, funcție pură (TZ 5.5)
      account_service.py      # setări, preferințe, favorite, blocuri, ștergere + purjare GDPR
      event_service.py        # evenimente, attendance, pașaport
      story_service.py        # povești cu TTL
      humor_service.py        # profil de umor
      moderation_service.py   # raportări + auto-ASCUNDERE la 3 raportori distincți
      billing.py              # planuri, achiziții (stub / Stripe / App Store / Play)
      geo.py                  # geocoding (stub/nominatim/google/mapbox) + haversine + bbox
      storage.py              # foto (stub local / S3)
      push.py                 # notificări (stub / Expo / FCM)
      face_verify.py          # verificare facială (stub / AWS Rekognition)
      admin_service.py        # ban/unban/ștergere, statistici, AdminAuditLog
      pagination.py           # cursor + clamp_limit (plafoane din config)
    db/
      session.py              # async engine, sessionmaker, get_db
      base.py                 # DeclarativeBase + import agregat pentru Alembic
  alembic/
    versions/                 # 13 migrări
    env.py
  scripts/
    gdpr_purge.py             # purjarea GDPR (--loop) — RULEAZĂ CA SERVICIU SEPARAT
    create_admin.py  create_test_users.py  seed_load_data.py
  tests/                      # PLAT (fără unit/ vs integration/) — 37 module, 445 teste
    conftest.py
    test_auth.py  test_profiles.py  test_feed.py  test_chat.py  ...
    test_security_hardening.py  test_admin_security.py  test_upload_security.py
    test_perf_queries.py      # teste de REGRESIE pe numărul de query-uri (N+1)
    test_config.py            # guardul de producție
    test_e2e_journey.py       # parcursul complet, cap-coadă
  nginx/                      # nginx.conf (TLS 1.2/1.3, HSTS, limit_req)
  Dockerfile
  entrypoint.sh               # verifică .env → migrații Alembic (cu retry) → gunicorn 4 workeri
  docker-compose.yml          # api · db · redis · nginx · certbot · admin-build · purge · backup
  pyproject.toml
  alembic.ini
```

Panoul de admin web (React + Vite) e un proiect separat, la rădăcina repo-ului: **`/admin`** — construit de serviciul Compose `admin-build` și servit de nginx.

### Principii de organizare

1. **Straturi separate.** `router` (transport HTTP + validare schemă) → `service` (business logic) → `model` (persistență). Routerele nu conțin business logic; serviciile nu știu de HTTP; modelele nu știu de Pydantic.
2. **Nume consistente pe verticală.** `api/v1/chat.py` ↔ `services/chat_service.py` ↔ `models/chat.py` ↔ `schemas/chat.py`.
3. **Dependency Injection.** DB și userul curent vin prin `Depends(...)` din `core/deps.py`. `CurrentUser` și `CurrentAdmin` sunt alias-uri gata de injectat.
4. **Securitate prin construcție, nu prin disciplină.** `require_admin` se aplică **o singură dată**, pe `include_router` în `api/v1/admin/__init__.py`, nu rută cu rută. O rută de admin nouă e protejată automat; trebuie să te străduiești ca să o expui, nu ca să o aperi.
5. **Zero hardcodare.** Toate pragurile (ponderi Compatibility, limite de feed, TTL-uri, plafoane de paginare, limite de rate) trăiesc în `core/config.py`, citite din env. Serviciile nu conțin numere magice.
6. **Funcții pure unde se poate.** `compatibility.compute_compatibility`, `contact_masker.mask_contacts`, `geo.haversine_km` nu ating DB-ul → testabile direct, fără fixture.

---

## 3. Unde intervine AI (și unde nu)

| Funcție | TZ | Unde, în cod | Stare |
|---|---|---|---|
| **Verificare facială** | 2.2 | `services/face_verify.py` | ✅ **AWS Rekognition `CompareFaces`** (provider `rekognition`) sau `stub`. `verified = score ≥ FACE_MATCH_THRESHOLD` (90.0). **Fără liveness check** 🔜 — vezi `security.md` §3.2. |
| **Compatibility Score** | 4.6 | `services/compatibility.py` | ✅ Sumă ponderată, **funcție pură**: interese 30%, status 15%, umor 20%, distanță 15%, limbi 10%, comportament 10% (ponderi din config). Distanța pe **km reali** (geocoding + haversine), cu decădere `1 - d/300km`. Umorul și comportamentul întorc azi valori **neutre** (0.5) — semnalele nu există încă. |
| **Recomandare feed** | 4 | `services/feed_service.py` | ✅ **Treapta 1** (filtre dure: preferințe, rază, activitate, blocuri) + **Treapta 2** (ranking pe Compatibility Score). |
| **Mascare contacte** | 5.5 | `services/contact_masker.py` | ✅ Dar e **REGEX, nu NLP** — 6 tipare (email, URL, domeniu, mesagerie, handle, telefon). Ofuscările („t e l e g r a m") trec. |
| **Moderare automată** | 5.5 / 10 | `services/moderation_service.py` | ⚠️ **3 raportori distincți → auto-ASCUNDERE** (`profile_hidden`), **NU ban**. Contul se poate încă loga. Decizia de ban e umană, din panoul de admin — altfel brigading-ul ar deveni o armă. |
| **AI hints (teme de conversație)** | 5.3 | — | 🔜 **Nu există.** Nici bancă de teme, nici generare, nici push de re-engagement. |
| **Chemistry Score** | 5.4 | — | 🔜 **Nu există.** Nici `chemistry_service`, nici semnale (viteză de răspuns, ton, umor reciproc). |
| **Agregare evenimente din surse externe** | 8.1 | — | 🔜 **Nu există.** Evenimentele se introduc din panoul de admin. |

Cheia AI aleasă pentru viitoarele funcții generative (hints, chemistry) este **Anthropic** — vezi deciziile de producție.

Fiecare integrare externă are o **fabrică de provideri** (`get_face_verifier()`, geo, storage, push, billing), aleasă din config, cu modul `stub` pentru dezvoltare. Providerul concret se schimbă fără a atinge logica de business. **Guardul de producție refuză pornirea cu orice integrare rămasă pe `stub`** (`security.md` §6).

---

## 4. Fluxul unui request (exemplu: like → match)

1. `POST /api/v1/feed/swipe` ajunge la `api/v1/feed.py`, body validat de schema Pydantic.
2. `Depends(get_current_user)` (`core/deps.py`) decodează access token-ul RS256 **și încarcă userul din DB** — de aici se citesc rolul și `banned_at` (revocare instantanee; detalii în `security.md` §1.3).
3. Routerul apelează serviciul din `feed_service`.
4. Serviciul persistă `Like`, verifică reciprocitatea; dacă există like invers → creează `Match` + `Chat` și face vizibil mesajul deferred (TZ 4.7).
5. Notificarea push se trimite **în request** (`services/push.py`) — nu există coadă.
6. Răspunsul e serializat de Pydantic.

**Feed-ul** se construiește la fiecare cerere, din DB: filtre dure (Treapta 1) → scor de compatibilitate (Treapta 2) → paginare cu cursor. Fără cache Redis.

---

## 5. Performanță — ce a fost reparat și e testat

| Problemă | Înainte | Acum | Test de regresie |
|---|---|---|---|
| **N+1 pe `GET /chats`** | ~**604** query-uri la 200 de match-uri (3 query-uri **per chat**: profil + ultimul mesaj + necitite), **la fiecare poll** | **6** query-uri, **constant**, indiferent de numărul de chat-uri | `tests/test_perf_queries.py` — **numără efectiv statement-urile SQL** trimise la DB (nu le estimează) |
| **Colecții nemărginite** | `GET /social/favorites`, `/blocks` etc. întorceau lista **întreagă**, fără `ORDER BY` (deci nici ordine reproductibilă) | **Paginare cu cursor** pe toate colecțiile (feed, chats, messages, stories, events, social, admin), cursorul în header-ul **`X-Next-Cursor`** | `tests/test_perf_queries.py` |
| **Plafoane de `limit`** | un client putea cere o pagină arbitrar de mare = vector de DoS | `clamp_limit()` cu plafoane din config (`*_MAX_LIMIT`), **inclusiv în panoul de admin** | `tests/test_perf_queries.py` |
| **`GET` care scriau în DB** | `last_active_at` se scria la fiecare cerere | scriere **rară**, cu prag (`LAST_ACTIVE_TOUCH_MINUTES=15`) | `tests/test_perf_queries.py` |

---

## 6. Producție

```
docker compose up --build -d
```

**Servicii Compose:** `api` · `db` (Postgres 16) · `redis` · `nginx` · `certbot` · `admin-build` · **`purge`** · `backup`

- **`api`** — `entrypoint.sh`: verifică `.env` (refuză orice `<<< COMPLETEAZĂ >>>` rămas și orice `JWT_PRIVATE_KEY` care nu arată a PEM) → rulează **migrațiile Alembic** (cu retry, 5 încercări) → pornește **gunicorn cu 4 workeri uvicorn**. Nu există un pas manual „rulează întâi migrațiile".
- **`purge`** — rulează `scripts/gdpr_purge.py --loop`. **De ce un serviciu separat și nu lifespan-ul FastAPI:** cu 4 workeri gunicorn, un task în lifespan ar rula **de 4 ori în paralel**, pe aceleași rânduri.
- **`nginx`** — TLS 1.2/1.3, HSTS, `limit_req` (`flirt_auth` 5r/m pe auth, `flirt_general` 20r/s pe restul), servește și `/admin`.
- **`backup`** — `pg_dump` periodic + retenție. Restaurarea se testează cu `scripts/restore_db.sh` — un backup netestat nu e backup.
- **Observabilitate** — logging JSON, `X-Request-ID` pe fiecare cerere, handler global de excepții (stack trace pe server, răspuns generic + `request_id` la client). Access log fără PII, tokenuri sau body-uri.
- **Health** — `/health` (liveness) și `/health/ready` (readiness: **503** dacă DB-ul nu răspunde) la **rădăcină**, nu sub `/api/v1`: nginx, healthcheck-ul Docker și load balancer-ele le caută acolo, iar ele nu fac parte din API-ul public.

Procedura completă (DNS, certificate, generarea cheilor JWT, `.env`): [`../DEPLOYMENT.md`](../DEPLOYMENT.md).

---

## 7. Teste

```bash
cd backend && . .venv/bin/activate
pytest -q                 # 445 teste, 37 module
pytest --cov=app          # acoperire 83%
```

Structura e **plată** (`tests/test_*.py`), fără `unit/` vs `integration/` — modulele își spun singure ce testează. Câteva care merită știute:

| Modul | Ce apără |
|---|---|
| `test_admin_security.py` | contractul `require_admin` pe **FIECARE** rută de admin: fără token → 401, user obișnuit → 403, admin banat → 403, **rol retras între două cereri → 403 imediat** |
| `test_security_hardening.py`, `test_security_edges.py` | rate limiting, anti-enumerare, timing uniform la login |
| `test_upload_security.py` | allowlist MIME + **magic-bytes** + limita de 8 MB |
| `test_block_gdpr_security.py` | purjarea GDPR: ce se șterge, ce se anonimizează, ce se **păstrează** (rapoartele) |
| `test_perf_queries.py` | **N+1** — numără statement-urile SQL efective |
| `test_config.py` | guardul de producție (cele 18 verificări) + `_guard_adult_only` |
| `test_e2e_journey.py` | parcursul complet: register → anketă → feed → like → match → chat |
| `test_*_live.py` | ramurile `live` ale integrărilor (auth, geo, storage, push, billing) |
