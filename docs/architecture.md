# Arhitectura sistemului — FLIRT

Document de nivel înalt (end-to-end) al arhitecturii FLIRT: componente, fluxuri de date
pentru scenariile cheie și modul de comunicare frontend ↔ backend.

Stack de referință: **Mobile React Native + Expo** · **Backend Python FastAPI** ·
**PostgreSQL + PostGIS** · **Redis** · **Celery** · autentificare **JWT**.

---

## 1. Diagrama de componente

```
                                   ┌─────────────────────────────────────┐
                                   │        SERVICII EXTERNE             │
                                   │  Apple / Google auth                │
                                   │  Geocoding (Google Maps / Mapbox)   │
                                   │  Push (APNs / FCM)                  │
                                   │  Ad network                         │
                                   │  Payment (App Store / Google Play)  │
                                   └──────────────┬──────────────────────┘
                                                  │
┌───────────────────────┐        HTTPS/JSON      │
│   MOBILE APP (Expo)    │        JWT Bearer      │
│  React Native          │◄───────────────────────┤
│  - React Query (cache) │        WebSocket       │
│  - Swipe / Chat / Feed │◄──────────┐            │
│  - Push token          │           │            │
└───────────┬───────────┘           │            │
            │  REST / WS             │            │
            ▼                        ▼            ▼
   ┌──────────────────────────────────────────────────────────┐
   │            API GATEWAY / FastAPI (backend)                │
   │  Auth · Profiles · Feed · Match · Chat(WS) · Events ·     │
   │  Payments · Moderation · Admin API                        │
   └───┬───────────┬───────────┬──────────┬───────────┬───────┘
       │           │           │          │           │
       ▼           ▼           ▼          ▼           ▼
 ┌──────────┐ ┌─────────┐ ┌─────────┐ ┌────────┐ ┌──────────────┐
 │PostgreSQL│ │  Redis  │ │  S3 /   │ │ Celery │ │  SERVICII AI │
 │+ PostGIS │ │ cache / │ │ storage │ │workers │ │ face-match   │
 │ (geo,    │ │ sessions│ │  foto   │ │ (async)│ │ NLP chat     │
 │  users,  │ │ /queues │ │ / video │ │        │ │ compatibility│
 │  matches)│ │ /pub-sub│ │         │ │        │ │  engine      │
 └──────────┘ └─────────┘ └─────────┘ └───┬────┘ └──────┬───────┘
                                          │             │
                                          └─────────────┘
                              (task-uri async: verificare foto,
                               scoring compat., NLP umor, push,
                               moderare, geocoding, agregare evenimente)
```

### Rolurile componentelor

| Componentă | Rol |
|---|---|
| **Mobile App (Expo)** | UI, gesturi swipe, chat realtime, cache local prin React Query, stochează JWT și push token. |
| **API Gateway / FastAPI** | Punct unic de intrare; autentificare JWT, rutare pe module (auth, feed, match, chat, events, payments, moderation, admin). |
| **PostgreSQL + PostGIS** | Sursa de adevăr: utilizatori, profiluri, foto meta, matches, mesaje, evenimente, coordonate geo (interogări de distanță). |
| **Redis** | Cache feed, sesiuni, rate-limit (limita de 10 profiluri/sesiune), cozi și pub/sub pentru WebSocket. |
| **S3 / object storage** | Fotografii și video de verificare (URL-uri semnate; datele biometrice tratate separat, GDPR). |
| **Celery workers** | Task-uri asincrone: face-match, calcul Compatibility/Chemistry Score, NLP umor, geocoding, push, moderare, agregare evenimente. |
| **Servicii AI** | `face-match` (liveness + comparație selfie↔foto), `NLP` (mascare contacte, profil umor), `compatibility engine` (scoring). |
| **Servicii externe** | Apple/Google OAuth, geocoding, push (APNs/FCM), ad network, plăți in-app. |

---

## 2. Fluxuri de date — scenarii cheie

### (a) Login + verificare de identitate

```
App ──(Apple/Google/email/OTP)──► FastAPI /auth
   FastAPI ──verifică cu Apple/Google──► emite JWT (access + refresh)
App ◄──── JWT ────
App ──(selfie/liveness video)──► FastAPI /verify ──► S3 (upload)
   FastAPI ──enqueue──► Celery ──► serviciu face-match (liveness + compară cu foto profil)
   rezultat ──► PostgreSQL: status "verificat" / "respins"
App ◄──push (APNs/FCM)── "Profil verificat ✓"   (badge în feed)
```
Până la verificare, profilul are vizibilitate redusă în feed (configurabil din backend).

### (b) Swipe → Match → Chat

```
App ──GET /feed (JWT)──► FastAPI ──► Redis (cache) / PostGIS (candidați după rază, vârstă, gen)
                                     + compatibility engine → Compatibility Score / card
App ◄── 10 carduri ──   (free: limită + timer 15s reclamă între porții)
App ──POST /swipe {like}──► FastAPI ──► PostgreSQL (like stocat)
   dacă like reciproc ──► creează Match ──► Redis pub/sub + push către ambii
App ◄── "Match / Connect!" ──
   mesajul trimis la like devine vizibil abia după like-ul reciproc
Chat: App ◄──WebSocket──► FastAPI (mesaje realtime) ──► PostgreSQL (persistență)
```

### (c) AI chat hint

```
Trigger: după match nimeni nu scrie X minute  SAU  conversație "stinsă" >24h
Celery (scheduled) ──► NLP / AI engine:
   - alege temă din bancă (~100) sau generează din interese ∩ status ∩ umor comun
   - analizează istoricul (NLP) → actualizează vector umor + Chemistry Score
FastAPI ──► App: plăcuță "AI — temă de conversație" (NU se trimite automat)
   sau push 1–2×/zi pentru relansare
   + banner "Mergeți împreună la [eveniment]" dacă AI găsește potrivire
```

### (d) Check-in eveniment → Flirt Passport

```
App (la eveniment) ──scan QR / geo-check-in──► FastAPI /events/{id}/checkin
   FastAPI ──validează (QR valid / coordonate în perimetru + fereastră de timp)──► PostgreSQL
   ──► adaugă ștampilă "Flirt Passport" la profil
App ◄── ștampilă nouă în profil ──
Efect: crește încrederea/prioritatea în feed (semnal comportamental, secțiune 4.6 TZ)
Harta Live Events: FastAPI agregă contorul de utilizatori înscriși/eveniment (PostGIS)
```

---

## 3. Comunicarea frontend ↔ backend

- **Protocol**: REST / JSON peste HTTPS. Autorizare prin **JWT Bearer** (`Authorization:
  Bearer <access_token>`), cu access token scurt + refresh token pentru reînnoire.
- **Client de date**: **React Query** pe mobil pentru fetching, caching, invalidare și
  retry (ex. feed, profil, listă chat-uri).
- **Realtime chat**: **WebSocket** persistent pentru mesaje și indicatori (online/typing),
  cu **Redis pub/sub** pentru difuzarea între instanțele backend. **Push notifications**
  (APNs/FCM) pentru evenimente când appul e în background (match, mesaj nou, AI hint,
  eveniment).
- **Media**: upload foto/video prin URL-uri semnate către S3; backendul stochează doar
  metadatele și referințele.
- **Config dinamic**: ponderile scorului, limitele și feature-urile sunt controlate din
  backend (feature flags / remote config) fără release de aplicație.

---

## 4. Referințe încrucișate

- Frontend (React Native + Expo): [`./frontend/README.md`](./frontend/README.md)
- Backend (FastAPI, modele, servicii): [`./backend/README.md`](./backend/README.md)
- Securitate backend (JWT, verificare, moderare, GDPR): [`./backend/security.md`](./backend/security.md)
- Design system (culori, tipografie, tokens): [`./design-system/colors.md`](./design-system/colors.md)
- Prezentare produs: [`./01-overview.md`](./01-overview.md)
- Index general: [`./README.md`](./README.md)
