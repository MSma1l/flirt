# Arhitectura sistemului — FLIRT

Arhitectura **reală**, end-to-end: ce rulează efectiv, cum circulă datele în scenariile
cheie, cum comunică mobilul cu backendul.

> **Notă de onestitate.** Versiunea anterioară a acestui document descria un blueprint care
> **nu a fost construit niciodată**: Celery, PostGIS, WebSocket, Redis pub/sub, ad network.
> **Nimic din acestea nu există în cod.** Documentul de mai jos descrie sistemul care rulează
> azi. Tehnologiile abandonate sau amânate sunt strânse la final, în
> [§6 Evoluții planificate](#6--evoluții-planificate-neimplementate), clar marcate ca
> **neimplementate**.

**Stack real:** **Expo (React Native)** · **FastAPI** (gunicorn, 4 workeri uvicorn) ·
**PostgreSQL 16** (fără PostGIS) · **Redis** · **nginx** (TLS) · **Alembic** · **JWT**.

---

## 1. Diagrama de componente (ce există)

```
┌──────────────────────┐   ┌──────────────────────┐
│  MOBILE APP (Expo)   │   │  ADMIN SPA           │
│  expo-router · TS    │   │  React + Vite        │
│  React Query (server)│   │  react-router        │
│  Zustand (client)    │   │  build static        │
│  axios · JWT Bearer  │   └──────────┬───────────┘
│  WebView + Leaflet   │              │
└──────────┬───────────┘              │
           │  HTTPS / JSON  (polling — FĂRĂ WebSocket)
           └───────────────┬──────────┘
                           ▼
              ┌─────────────────────────┐
              │        nginx            │   ← TLS, redirect 80→443,
              │  reverse proxy + TLS    │     rate-limit la margine,
              │  servește admin SPA     │     servește /admin static
              └────────────┬────────────┘
                           ▼
   ┌───────────────────────────────────────────────────┐
   │        FastAPI  (gunicorn · 4 workeri uvicorn)     │
   │  auth · profiles · feed · match · chat · events ·  │
   │  humor · stories · reports · subscriptions ·       │
   │  admin (/api/v1/admin/*)                           │
   │                                                    │
   │  În proces (sincron, în request):                  │
   │   · compatibility engine  · haversine              │
   │   · contact masker        · moderation             │
   │  Middleware: request_id · JSON logging · rate-limit│
   └────┬──────────────────┬───────────────────┬────────┘
        │                  │                   │
        ▼                  ▼                   ▼
 ┌─────────────┐   ┌──────────────┐   ┌──────────────────────┐
 │ PostgreSQL  │   │    Redis     │   │  SERVICII EXTERNE    │
 │     16      │   │              │   │  S3 (boto3) — foto   │
 │ 22 tabele   │   │ rate-limit   │   │  AWS Rekognition     │
 │ 13 migrații │   │  (partajat   │   │  Nominatim (OSM)     │
 │             │   │   între      │   │  Expo Push / FCM     │
 │ lat/lng =   │   │   workeri)   │   │  Stripe · App Store  │
 │ Float       │   │ store OTP    │   │  tiles OSM (hărți)   │
 │ FĂRĂ PostGIS│   │  (auto-exp.) │   │                      │
 └─────────────┘   └──────────────┘   └──────────────────────┘

        FĂRĂ Celery · FĂRĂ broker · FĂRĂ cozi · FĂRĂ pub/sub
```

### Servicii Docker Compose

| Serviciu | Rol |
|---|---|
| `api` | FastAPI sub gunicorn (4 workeri uvicorn). Rulează migrațiile Alembic la pornire. |
| `db` | PostgreSQL 16. |
| `redis` | Rate-limiting partajat + store OTP. |
| `nginx` | TLS, redirect 80→443, rate-limit la margine, servește SPA-ul de admin. |
| `certbot` | Emite și reînnoiește certificatul TLS **automat**. |
| `admin-build` | Buildează SPA-ul de admin într-un volum comun cu nginx. |
| `purge` | Job GDPR — șterge definitiv conturile după grația de 30 de zile. |
| `backup` | `pg_dump` periodic. |

Deploy complet: [`DEPLOYMENT.md`](./DEPLOYMENT.md).

### Rolurile componentelor

| Componentă | Rol |
|---|---|
| **Mobile (Expo)** | UI, gesturi de swipe, **polling** chat, cache prin **React Query** (state server) + **Zustand** (state client), `axios` cu JWT. Hărțile: `react-native-webview` + **Leaflet** + tiles **OpenStreetMap**. |
| **Admin SPA** | React + Vite + react-router; **static**, servit de nginx; consumă `/api/v1/admin/*`. |
| **nginx** | Singurul lucru expus public. TLS, rate-limit de margine, proxy către `api`, servire statică. |
| **FastAPI** | Toată logica. **Sincron, în request** — nu există workeri de fundal. |
| **PostgreSQL 16** | Sursa de adevăr. `lat`/`lng` sunt **`Float`**, iar distanța se calculează cu **haversine în aplicație**. |
| **Redis** | **Rate-limiting partajat** (cei 4 workeri trebuie să vadă același contor — în memorie ar fi fost 4 limite separate) și **store OTP** (codurile expiră singure, nu poluează DB-ul). |

> **De ce nu PostGIS.** La scara reală a aplicației, filtrarea pe rază se face pe un set deja
> îngustat de candidați (`FEED_SCAN_LIMIT`), iar haversine în Python e suficient. PostGIS ar
> fi adăugat o extensie, o dependență de imagine și o clasă de migrații — pentru un câștig
> pe care nu-l simțim încă. Când feed-ul va cere index geospațial real, se poate adăuga.

---

## 2. Observabilitate (ce vezi când pică ceva)

- **Logging JSON structurat pe stdout** — direct consumabil de orice agregator, fără parsere.
- **`request_id`** — generat sau preluat din `X-Request-ID`, prezent în fiecare linie de log.
  O cerere se poate urmări cap-coadă.
- **`/health`** — **liveness**. Răspunde dacă procesul trăiește.
- **`/health/ready`** — **readiness REAL**: `SELECT 1` pe Postgres + `PING` pe Redis.
  Dacă vreuna pică → **503**. Nu e un `return {"ok": true}` decorativ: load balancerul chiar
  scoate instanța din rotație când dependențele sunt moarte.

---

## 3. Fluxuri de date — scenarii cheie

### (a) Register → JWT → anketă → feed

```
App ──POST /auth/register (email+parolă | telefon+OTP)──► FastAPI
   rate-limit (Redis) · vârstă ≥ 18 (config: refuză boot dacă pragul e mai mic)
   ◄── JWT (access + refresh) ──

App ──POST /profiles (anketă)──► FastAPI
   oraș ──► Nominatim (OSM, gratuit, cache) ──► lat/lng
   lat/lng PERSISTATE pe profil  ← fără asta, distanța nu se poate calcula la scară
   ──► PostgreSQL

App ──GET /feed?cursor=...──► FastAPI
   1. filtrare pe GEN + ORIENTARE          ← înainte NU exista deloc
   2. filtrare pe vârstă (≥ 18, intervalul căutat)
   3. RAZA de căutare aplicată efectiv     ← înainte se salva și se IGNORA
   4. exclude: inactivi >30 zile (last_active_at), blocați, auto-ascunși, deja swipe-uiți
   5. haversine (în aplicație) → distance_km
   6. compatibility engine → scor 0–100
   7. ORDER BY determinist + cursor        ← fără el, paginarea repeta/sărea profiluri
   ◄── carduri + distance_km + compatibility ──
```

### (b) Swipe → Match → Chat

```
App ──POST /feed/swipe {like, deferred_message?}──► FastAPI
   limită free: 50 like-uri/zi (non-premium)
   ──► PostgreSQL (Like; mesajul de la like stă pe Like.deferred_message, NELIVRAT)

   dacă like RECIPROC:
      ──► creează Match
      ──► livrează deferred_message ambilor   (TZ 4.7)
      ──► push (Expo/FCM), sincron în request  ← NU printr-o coadă
   ◄── "Match / Connect!" ──

Chat:
App ──GET /chats, GET /chats/{id}/messages──► FastAPI ──► PostgreSQL
   POLLING la ~5s (React Query).  NU e WebSocket.
App ──POST .../messages──► contact masker (Instagram/telefon/email/link → ****)
   ──► PostgreSQL ──► push destinatarului
```

> **De ce polling și nu WebSocket.** WebSocket cu 4 workeri gunicorn ar fi cerut Redis
> pub/sub pentru difuzare între procese — adică infrastructură în plus pentru un chat care,
> la volumul actual, funcționează corect cu un poll la 5 secunde. E o datorie **asumată**, nu
> uitată: vezi §6.

### (c) Check-in eveniment → Flirt Passport

```
Admin ──POST /api/v1/admin/events──► creează evenimentul
   (în API-ul PUBLIC nu există POST /events — de asta panoul de admin
    nu e opțional: fără el, nimeni nu putea crea niciun eveniment)

App ──GET /events──► listă + hartă (WebView + Leaflet + tiles OSM, fără cheie API)
App ──POST /events/{id}/attend──► marcaj "merg" (contor participanți)

App (la eveniment) ──POST /events/{id}/checkin──► FastAPI
   validează: fereastră de timp + coordonate în perimetru (haversine)
   ──► PostgreSQL: ștampilă "Flirt Passport" pe profil
   ◄── ștampilă nouă ──
```

### (d) Raportare → moderare → admin

```
App ──POST /reports/ {spam|fake|offensive|obscene}──► FastAPI ──► PostgreSQL

   la 3 RAPORTORI DISTINCȚI (REPORT_AUTOBAN_THRESHOLD):
      ──► AUTO-ASCUNDERE: profilul iese din feed
          ! contul se poate LOGA în continuare — nu e ban
          ! automatul doar pune în carantină; altfel 3 useri coordonați
            ar putea exclude pe oricine din aplicație

Admin SPA ──GET /api/v1/admin/reports──► coada de moderare
   rol `role` citit din DB LA FIECARE CERERE (nu din JWT — un admin
   retrogradat își pierde puterile instant, nu la expirarea tokenului)

Admin ──POST /api/v1/admin/users/{id}/ban──► BAN REAL
   ──► revocă SESIUNILE utilizatorului
   ──► scrie în JURNALUL DE AUDIT (append-only: cine, ce, când)
```

---

## 4. Comunicarea frontend ↔ backend

- **Protocol**: REST / JSON peste HTTPS (TLS terminat în nginx). Autorizare **JWT Bearer**
  (`Authorization: Bearer <access_token>`), access token scurt + refresh token.
- **Client de date**: **axios** + **React Query** (fetching, cache, invalidare, retry) pentru
  starea de server; **Zustand** pentru starea de client (sesiune, UI). TypeScript **strict**.
- **Realtime**: **nu există.** Chat-ul și lista de dialoguri se actualizează prin **polling**
  (React Query, ~5s). **Push notifications** (Expo / FCM) pentru match și mesaj nou —
  trimise **sincron în request**, nu dintr-o coadă.
- **Media**: upload foto către **S3** (boto3); backendul păstrează metadatele și referințele.
- **Hărți**: **fără cheie API** — `react-native-webview` + Leaflet + tiles OpenStreetMap.
- **Config dinamic**: ponderile scorului, limitele și pragurile vin din config-ul de backend
  (`.env`), fără release de aplicație. Configul **refuză să pornească** la valori ilegale
  (ex. prag de vârstă sub 18).

---

## 5. Cifre

| | |
|---|---|
| API | **79 operațiuni** pe **68 căi** (58 aplicație + 21 admin) |
| Bază de date | **22 tabele**, **13 migrații** Alembic |
| Teste backend | **445** (**83%** acoperire) |
| Teste mobile | **340** / **57 suite** |
| Teste admin | **19** |

---

## 6. 🔜 Evoluții planificate (NEIMPLEMENTATE)

Tot ce urmează **nu există în cod**. E listat ca opțiune viitoare, cu declanșatorul care ar
justifica-o — nu ca parte din sistem.

| Tehnologie | Ce ar rezolva | Când ar merita |
|---|---|---|
| **WebSocket** (+ Redis pub/sub) | Chat realtime, typing, status online. Înlocuiește polling-ul. | Când polling-ul la 5s devine costisitor sau latența deranjează vizibil. |
| **Celery** (+ broker) | Task-uri async: verificare facială, push în masă, NLP umor, agregare evenimente. | Când un task depășește durata acceptabilă a unui request. Azi **totul e sincron** și e suficient. |
| **PostGIS** | Index geospațial real, interogări de rază în SQL. | Când `FEED_SCAN_LIMIT` + haversine în aplicație nu mai scalează. |
| **AI** — hint chat, **Chemistry Score**, rafinare NLP a vectorului de umor | Pilonul „AI" din TZ. | **Neînceput.** |
| **Treapta 2** a algoritmului de recomandare | Cei **10%** „semnale comportamentale" din Compatibility Score sunt azi o **constantă `0.5`** — nu diferențiază pe nimeni. | Când există destul istoric de swipe-uri de învățat. |
| **SDK de reclame** | Limita free din TZ 4.5 (10/sesiune + timer 15s). Azi: **50 like-uri/zi**, fără reclame. | Doar dacă modelul cu reclame se reia. |

**❌ Amânat prin decizie de produs** (nu e datorie tehnică, e alegere — vezi
[`01-overview.md`](./01-overview.md)): **plăți IAP native** (blochează submit-ul la App
Store, Guideline 3.1.1) · **cameră/selfie** (backendul Rekognition e gata, lipsește captura) ·
**login social nativ** (stub; la activarea Google devine obligatoriu Sign in with Apple,
Guideline 4.8).

---

## 7. Referințe încrucișate

- Prezentare produs (real, cu ✅/🔜/❌): [`./01-overview.md`](./01-overview.md)
- Frontend (React Native + Expo): [`./frontend/README.md`](./frontend/README.md)
- Backend (FastAPI, modele, servicii): [`./backend/README.md`](./backend/README.md)
- API public: [`./backend/api-spec.md`](./backend/api-spec.md) · Modele de date: [`./backend/data-models.md`](./backend/data-models.md)
- Securitate backend (JWT, sesiuni, moderare, GDPR): [`./backend/security.md`](./backend/security.md)
- Panou de admin: [`./admin/README.md`](./admin/README.md) · [`./admin/api.md`](./admin/api.md)
- Integrări externe (S3, Rekognition, Nominatim, push, billing): [`./INTEGRATIONS.md`](./INTEGRATIONS.md)
- Deployment (TLS, Compose, `.env`): [`./DEPLOYMENT.md`](./DEPLOYMENT.md)
- Design system: [`./design-system/colors.md`](./design-system/colors.md)
- Index general: [`./README.md`](./README.md)
