# FLIRT — Arhitectură Backend

> **Slogan:** *No Regrets*
> Backend pentru aplicația de dating FLIRT (iOS / Android), un singur API pentru ambele platforme.

Acest document descrie arhitectura generală a backend-ului: stack-ul tehnologic, structura de foldere, separarea pe straturi (layers) și punctele în care intervin componentele AI. Este sursa de adevăr pentru organizarea codului. Detaliile de endpoint-uri sunt în [`api-spec.md`](./api-spec.md), iar schema bazei de date în [`data-models.md`](./data-models.md). Aspectele de autentificare/JWT sunt tratate separat în [`security.md`](./security.md).

---

## Cuprins

| Document | Ce conține |
|---|---|
| [`README.md`](./README.md) | Arhitectura generală, stack, structura de foldere, unde intervine AI |
| [`api-spec.md`](./api-spec.md) | Specificația endpoint-urilor REST grupate pe domeniu |
| [`data-models.md`](./data-models.md) | Schema bazei de date, entități, relații, indexuri, formule (Compatibility / Chemistry) |
| [`security.md`](./security.md) | Autentificare, JWT, sesiuni, biometrie (**menținut de alt agent**) |

---

## 1. Stack tehnologic

Backend-ul este construit pe un stack Python modern, orientat pe async, cu procesare grea (AI/ML, geo, NLP) delegată la workeri asincroni.

| Componentă | Tehnologie | Rol |
|---|---|---|
| **Web framework** | **FastAPI** (ASGI, Uvicorn/Gunicorn) | API REST, validare automată, OpenAPI generat, async I/O nativ |
| **ORM + migrări** | **SQLAlchemy 2.0** (stil `2.0`, async) + **Alembic** | Mapping obiect-relațional, versionare schemă |
| **Bază de date** | **PostgreSQL 15+** + **PostGIS** | Stocare relațională, indexare și interogări geo (distanță, radius) |
| **Cache / sesiuni / rate-limit** | **Redis** | Feed cache, sesiuni, contorizare limită 10 ankete, rate-limiting OTP, cozi |
| **Task queue async** | **Celery** (broker Redis, backend Redis) | face-match, NLP mascare contacte, AI hints, push, geocoding, moderare |
| **Object storage** | S3-compatibil (AWS S3 / MinIO) | Fotografii profil, media chat, cover mероприятия |
| **Push notifications** | APNs (iOS) + FCM (Android) | Match, mesaje, AI-подсказки, mероприятия |
| **Validare / serializare** | **Pydantic v2** | Scheme request/response, config din env |
| **AI / ML servicii** | Face-matching (AWS Rekognition sau echivalent), model NLP intern/extern, LLM pentru hints | Verificare facială, mascare contacte, compatibilitate, chemistry |

### De ce aceste alegeri

- **FastAPI** — async-first (potrivit pentru un backend I/O-bound: DB, Redis, S3, servicii AI externe), validare declarativă cu Pydantic, documentație OpenAPI gratuită (contract clar cu echipele mobile iOS/Android).
- **SQLAlchemy 2.0 async + Alembic** — control fin asupra interogărilor complexe (feed cu ranking, join-uri geo), migrări versionate reproductibile.
- **PostgreSQL + PostGIS** — datele sunt puternic relaționale (users ↔ likes ↔ matches ↔ chats). PostGIS oferă tipul `geography(Point)` + indexuri `GiST` pentru filtrarea pe rază (radius de căutare, formula Haversine) fără a construi manual geo-logică.
- **Redis** — feed-ul pentru swipe trebuie servit rapid și cu stare per-sesiune (fereastra glisantă de 10 ankete, timerul de 15s). Redis ține și contoarele de rate-limit (OTP, jaloabe) și acționează ca broker Celery.
- **Celery** — sarcinile AI (face-match, NLP, generare AI hints, recalcul Chemistry, push) sunt lente și nu trebuie să blocheze request-ul HTTP. Sunt împinse în cozi și procesate de workeri dedicați.

---

## 2. Structura de foldere

Organizare **modular, domain-based**: fiecare strat (routers / services / models / schemas) este separat clar, iar în interiorul fiecărui strat codul este grupat pe domeniu de business (auth, profiles, swipe, chat, events...). Această separare respectă principiul din design-system: **logica de business nu se amestecă cu stratul de transport (HTTP) sau cu accesul la date**.

```
backend/
  app/
    main.py                     # instanțiere FastAPI, montare routere, middleware, lifespan
    core/
      config.py                 # Settings (Pydantic BaseSettings, citire din env)
      security.py               # hashing parole, JWT helpers (detalii → security.md)
      deps.py                   # dependency injection: get_db, get_current_user, get_redis
      exceptions.py             # excepții custom + handlers
      logging.py                # config logging structurat
      constants.py              # enum-uri, liste (interese, statusuri, tipuri de umor)
    api/
      v1/
        __init__.py             # api_router: agregă toate routerele de domeniu
        auth.py                 # Apple/Google/email/phone-OTP, verificare facială
        profiles.py             # anketă CRUD, foto, interese, status, umor
        swipe.py                # feed (limită 10), like/dislike/favorite, undo, match
        compatibility.py        # calcul % Compatibility Score
        chat.py                 # dialoguri, mesaje, AI hints, chemistry, mascare contacte
        events.py               # listă, map, „иду", Flirt Passport, ticket QR
        settings.py             # theme, notificări, blacklist, ștergere cont, radius
        moderation.py           # raportări, ban, cozi de moderare
        subscriptions.py        # Premium, no-ads, AI-bot, purchases
    models/                     # SQLAlchemy (mapare 1:1 cu data-models.md)
      base.py                   # DeclarativeBase, mixin-uri (timestamps, soft-delete)
      user.py                   # User, Session
      profile.py                # Profile, Photo, Interest, HumorProfile
      swipe.py                  # Like, Match
      chat.py                   # Chat, Message
      event.py                  # Event, EventAttendance, FlirtPassportStamp, Ticket
      moderation.py             # Report, Block
      subscription.py           # Subscription
    schemas/                    # Pydantic (request/response DTO)
      auth.py  profile.py  swipe.py  compatibility.py
      chat.py  event.py  settings.py  moderation.py  subscription.py
      common.py                 # paginare, răspunsuri de eroare, tipuri partajate
    services/                   # business logic (независим de HTTP)
      auth_service.py           # login providers, OTP, sesiuni
      face_service.py           # orchestrare verificare facială (deleagă la worker)
      profile_service.py        # validări anketă, ordonare foto, status
      feed_service.py           # construire feed, ranking, fereastră de 10, cache Redis
      swipe_service.py          # like/dislike/favorite, undo, detectare match
      compatibility_service.py  # formula Compatibility Score (TZ 4.6)
      chat_service.py           # trimitere mesaje, deferred likes, reacții
      chemistry_service.py      # calcul Chemistry Score (TZ 5.4)
      hint_service.py           # bancă de teme + generare AI hints (TZ 5.3)
      masking_service.py        # mascare contacte NLP în mesaje (TZ 5.5)
      event_service.py          # mероприятия, map, attendance, passport, tickets
      geo_service.py            # geocoding + Haversine + filtrare radius
      moderation_service.py     # jalobe, scoring, auto-ban, cozi
      subscription_service.py   # gestionare planuri, entitlements, limite
    workers/                    # Celery tasks (async, off-request)
      celery_app.py             # instanță Celery, rutare cozi
      face_tasks.py             # face-matching selfie vs foto anketă (TZ 2.2)
      nlp_tasks.py              # scanare/mascare contacte + analiză umor (TZ 5.4/5.5)
      hint_tasks.py             # generare AI hints, push re-engagement (TZ 5.3)
      compatibility_tasks.py    # recalcul batch scoruri, pre-warm feed
      push_tasks.py             # trimitere APNs / FCM
      event_tasks.py            # agregare mероприятия externe + moderare (TZ 8.1)
    db/
      session.py               # async engine, sessionmaker, get_session
      base.py                  # import agregat modele pentru Alembic
      init_db.py               # seed date (interese, tipuri umor, planuri)
    integrations/              # clienți pentru servicii externe
      apple.py  google.py       # verificare token OIDC providers
      sms.py                    # provider SMS/OTP
      rekognition.py            # client face-matching
      geocoding.py              # Google Maps / Mapbox
      storage.py                # S3 client
      push.py                   # APNs / FCM
  alembic/
    versions/                   # migrări generate
    env.py
  tests/
    conftest.py
    unit/                       # servicii izolate (compatibility, chemistry, masking)
    integration/                # endpoint-uri cu DB de test
    factories/                  # factory-uri de date de test
  pyproject.toml
  alembic.ini
  Dockerfile
  docker-compose.yml            # api + postgres/postgis + redis + celery worker
```

### Principii de organizare

1. **Straturi separate.** Un request trece prin: `router` (transport HTTP + validare schema) → `service` (business logic) → `model` (persistență). Routerele nu conțin logică de business; serviciile nu știu despre HTTP; modelele nu știu despre Pydantic.
2. **Domain-based în fiecare strat.** Numele fișierelor sunt consistente pe verticală (`api/v1/chat.py` ↔ `services/chat_service.py` ↔ `models/chat.py` ↔ `schemas/chat.py`). Ușor de navigat.
3. **Dependency Injection.** Accesul la DB, Redis, utilizatorul curent se obțin prin `Depends(...)` din `core/deps.py`. Facilitează testarea (mock ușor).
4. **Sarcini grele → workers.** Orice operație care depinde de un serviciu extern lent sau de ML rulează în Celery, nu în request-ul HTTP. Serviciul doar pune task-ul în coadă și, unde e nevoie, notifică rezultatul prin push / actualizare DB.
5. **Config centralizat.** Toate valorile de mediu și feature-flag-urile (inclusiv **ponderile Compatibility Score**, limita de ankete, timerul de reclamă) trăiesc în `core/config.py` / remote config, ca să fie modificabile fără release de app (cerință TZ 4.6).

---

## 3. Unde intervine AI

AI-ul este izolat în servicii dedicate care orchestrează, plus workeri Celery care fac procesarea grea. Punctele din TZ:

| Funcție AI | TZ | Serviciu | Worker | Descriere |
|---|---|---|---|---|
| **Face-match / liveness** | 2.2 | `face_service` | `face_tasks` | Selfie/video live comparat cu fotografiile din anketă printr-un model de face-matching (Rekognition sau echivalent). Setează statusul `verified` pe profil. |
| **Compatibility Score** | 4.6 | `compatibility_service` | `compatibility_tasks` | Sumă ponderată: interese 30%, status 15%, umor 20%, distanță 15%, limbi 10%, comportament 10%. Vectorii de umor și semnalele comportamentale fac partea „inteligentă". |
| **AI hints (teme de conversație)** | 5.3 | `hint_service` | `hint_tasks` | Bancă de ~100 teme + generare pe baza intersecției de interese, status și tip de umor. Nu se trimite automat; se sugerează. Include push de re-engagement când conversația s-a stins. |
| **Chemistry Score** | 5.4 | `chemistry_service` | `nlp_tasks` | Se calculează doar în cadrul unei conversații active: viteză de răspuns, lungime mesaje, ton emoțional, umor reciproc, emoji/reacții. Rafinează vectorul de umor și influențează feed-ul viitor. |
| **Mascare contacte (NLP)** | 5.5 | `masking_service` | `nlp_tasks` | Scanare în timp real a mesajelor de ieșire pentru nickname-uri de rețele sociale, numere de telefon, email, linkuri. Datele detectate se maschează cu asteriscuri organic. |
| **Moderare automată** | 5.5 / 10 | `moderation_service` | `nlp_tasks` | Jalobe cu încredere mare (match cu bază de conținut interzis sau mai multe jalobe independente) → auto-ban; cazurile ambigue merg în coada manuală. |
| **Agregare mероприятия** | 8.1 | `event_service` | `event_tasks` | Sugerarea/agregarea automată a mероприятий din surse deschise (afișe oraș), cu moderare ulterioară. |

Toate serviciile AI sunt apelate prin `integrations/` (clienți externi) sau prin modele interne, astfel încât furnizorul concret (ex. Rekognition vs alt provider — vezi întrebările deschise din TZ 12) poate fi schimbat fără a atinge logica de business.

---

## 4. Fluxul unui request (exemplu: swipe → match)

1. `POST /api/v1/swipe/like` ajunge la `api/v1/swipe.py`, validat cu schema `LikeCreate`.
2. `Depends(get_current_user)` (din `core/deps.py`) rezolvă utilizatorul din JWT (detalii în `security.md`).
3. Routerul apelează `swipe_service.create_like(...)`.
4. Serviciul persistă `Like`, verifică reciprocitatea; dacă există like invers → creează `Match` + `Chat`, face vizibil mesajul deferred (TZ 4.7).
5. Pune în coadă `push_tasks.send_match_notification` (Celery) pentru ambii utilizatori.
6. Returnează `MatchResponse` (sau confirmare de like), serializat de Pydantic.

Feed-ul, în schimb, e servit din Redis (pre-calculat de `feed_service` + `compatibility_tasks`) ca să respecte limita de 10 și fereastra glisantă fără a lovi DB la fiecare swipe.
