# FLIRT — Specificația API REST

> Specificația endpoint-urilor REST ale backend-ului FLIRT, mapate pe [Sarcina Tehnică (TZ)](../../.context/TZ.txt) și grupate pe domeniu.

Toate rutele au prefixul `/api/v1`. Formatul de schimb este JSON. Autentificarea se face prin Bearer JWT (detalii complete în [`security.md`](./security.md)); aici indicăm doar dacă un endpoint **necesită auth** sau este public. Numele modelelor referite (User, Profile, Like, Match, Chat, Message, Event, Ticket, Report, Block, Subscription etc.) corespund celor din [`data-models.md`](./data-models.md).

**Convenții:**
- `🔓 Public` — nu necesită token. `🔒 Auth` — necesită Bearer JWT valid. `👮 Admin` — rol de administrator/moderator.
- Erorile folosesc formatul standard `{ "detail": "..." }` (sau listă de erori de validare Pydantic).
- Paginarea listelor: query params `?limit=&cursor=` (cursor-based), răspuns `{ "items": [...], "next_cursor": "..." }`.

---

## Cuprins pe domenii

1. [Auth](#1-auth) · 2. [Profiles](#2-profiles) · 3. [Swipe / Feed](#3-swipe--feed) · 4. [Compatibility](#4-compatibility) · 5. [Chat](#5-chat) · 6. [Events](#6-events) · 7. [Settings](#7-settings) · 8. [Moderation](#8-moderation) · 9. [Subscriptions](#9-subscriptions)

---

## 1. Auth

Înregistrare/login prin Apple, Google, email+parolă, telefon+OTP; plus pasul obligatoriu de **verificare facială** (TZ 2.2). Detaliile de token/refresh sunt în `security.md`.

| Metodă | Path | Scop | Auth |
|---|---|---|---|
| `POST` | `/auth/apple` | Sign in with Apple (schimb `identity_token`) | 🔓 |
| `POST` | `/auth/google` | Google Sign-In (schimb `id_token`) | 🔓 |
| `POST` | `/auth/email/register` | Înregistrare email + parolă + dată naștere | 🔓 |
| `POST` | `/auth/email/login` | Login email + parolă | 🔓 |
| `POST` | `/auth/phone/request-otp` | Trimite cod OTP prin SMS | 🔓 |
| `POST` | `/auth/phone/verify-otp` | Verifică OTP, creează/loghează cont | 🔓 |
| `POST` | `/auth/refresh` | Reînnoire access token (vezi `security.md`) | 🔓 |
| `POST` | `/auth/logout` | Invalidează sesiunea curentă | 🔒 |
| `POST` | `/auth/verification/face` | Upload selfie/video liveness pentru face-match | 🔒 |
| `GET` | `/auth/verification/status` | Starea verificării faciale (`pending`/`verified`/`rejected`) | 🔒 |

**Notă:** `dată naștere` validează minimul de 16 ani și determină gruparea de vârstă (16–17 / 18+) conform TZ 2.3. Verificarea facială pune un task `face_tasks` în coadă; până la finalizare, profilul are `verification_status = pending` și vizibilitate redusă în feed (TZ 2.2).

**Exemplu — `POST /auth/phone/verify-otp`:**
```json
// request
{ "phone": "+37360123456", "code": "482913" }
// response 200
{
  "access_token": "eyJhbGci...",
  "refresh_token": "eyJhbGci...",
  "token_type": "bearer",
  "is_new_user": true,
  "user_id": "9f1c...",
  "onboarding_required": true
}
```

**Exemplu — `POST /auth/verification/face`** (multipart: `selfie` + opțional `liveness_video`):
```json
// response 202 (procesare async)
{ "verification_status": "pending", "task_id": "b7a2..." }
```

---

## 2. Profiles

CRUD anketă, fotografii, interese, status de cunoștință, profil de umor (TZ 2.4–2.7). Modelul de date: `Profile`, `Photo`, `Interest`, `HumorProfile`.

| Metodă | Path | Scop | Auth |
|---|---|---|---|
| `GET` | `/profiles/me` | Anketa proprie completă | 🔒 |
| `PUT` | `/profiles/me` | Actualizare câmpuri anketă (nume, înălțime, oraș, limbi, „despre mine"...) | 🔒 |
| `PATCH` | `/profiles/me/status` | Schimbă statusul de cunoștință (unul sau mai multe) | 🔒 |
| `GET` | `/profiles/{user_id}` | Anketa publică a altui utilizator | 🔒 |
| `POST` | `/profiles/me/photos` | Upload fotografie (min 3, max 9) | 🔒 |
| `DELETE` | `/profiles/me/photos/{photo_id}` | Șterge o fotografie | 🔒 |
| `PUT` | `/profiles/me/photos/order` | Reordonează fotografiile | 🔒 |
| `GET` | `/interests` | Lista de interese disponibile (icoane, extensibilă din admin) | 🔒 |
| `PUT` | `/profiles/me/interests` | Setează interesele selectate (multiselect) | 🔒 |
| `GET` | `/humor/quiz` | Cardurile testului de umor (5–7 carduri) | 🔒 |
| `POST` | `/profiles/me/humor` | Trimite răspunsurile testului → vector de umor inițial | 🔒 |
| `GET` | `/profiles/me/favorites` | Lista anketelor adăugate la favorite | 🔒 |

**Notă:** interesele (TZ 2.5), statusurile de cunoștință (TZ 2.6) și tipurile de umor (TZ 2.7) sunt liste config, extensibile din admin fără release. Vectorul de umor (`HumorProfile.vector`) se inițializează din quiz și se rafinează ulterior de NLP-ul din chat (TZ 5.4).

**Exemplu — `PUT /profiles/me`:**
```json
// request
{
  "name": "Ana",
  "height_cm": 168,
  "gender": "female",
  "city": "Chișinău",
  "district": "Centru",
  "nationality": "Moldovan",
  "languages": ["ru", "ro", "en"],
  "bio": "Cafea, drumeții, jazz.",
  "relationship_statuses": ["serious", "friendship"]
}
// response 200 → obiectul Profile actualizat, inclusiv verification_status și compatibility-ready flags
```

---

## 3. Swipe / Feed

Ecranul principal de swipe: feed cu limită de 10 ankete/sesiune, like/dislike/favorite, undo, detectare match (TZ 4.1–4.7). Modele: `Like`, `Match`.

| Metodă | Path | Scop | Auth |
|---|---|---|---|
| `GET` | `/feed` | Următoarea porție de max 10 ankete (fereastră glisantă) | 🔒 |
| `GET` | `/feed/status` | Starea sesiunii: câte rămase, timer reclamă (15s) activ, tip abonament | 🔒 |
| `POST` | `/swipe/like` | Like (swipe dreapta), opțional cu mesaj inițial | 🔒 |
| `POST` | `/swipe/dislike` | Dislike / skip (swipe stânga) | 🔒 |
| `POST` | `/swipe/favorite` | Adaugă la favorite (long-press / ★), fără like/dislike | 🔒 |
| `POST` | `/swipe/undo` | Revine la anketa anterioară (1 pas free, nelimitat premium) | 🔒 |
| `DELETE` | `/swipe/favorite/{user_id}` | Elimină din favorite | 🔒 |

**Notă limită & reclamă (TZ 4.5):** utilizatorul free primește 10 ankete per sesiune; după procesarea celor 10 → `GET /feed` întoarce `429`-like flag `ad_wait` cu `retry_after: 15`; premium: nelimitat, fără timer. Starea se ține în Redis. `GET /feed` întoarce pentru fiecare card și **Compatibility Score** precalculat (TZ 4.2) plus flag de mероприятие (TZ 4.3).

**Exemplu — `GET /feed` (răspuns):**
```json
{
  "items": [
    {
      "user_id": "3d2a...",
      "name": "Ana", "age": 27,
      "distance_km": 3,
      "bio": "Cafea, drumeții, jazz.",
      "photos": ["https://cdn/.../1.jpg", "..."],
      "top_interests": ["music", "travel", "coffee"],
      "compatibility_score": 87,
      "verified": true,
      "event_badge": { "event_id": "e91...", "title": "Flirt Party #4", "date": "2026-07-12T20:00:00Z" }
    }
  ],
  "remaining": 9,
  "ad_wait": false,
  "next_cursor": "..."
}
```

**Exemplu — `POST /swipe/like`:**
```json
// request (mesaj inițial deferred — TZ 4.7)
{ "target_user_id": "3d2a...", "message": "Привет 👋" }
// response — match imediat
{ "is_match": true, "match_id": "m17...", "chat_id": "c22...", "matched_user": { "user_id": "3d2a...", "name": "Ana", "photo": "https://cdn/.../1.jpg" } }
// response — like deferred (fără reciprocitate încă)
{ "is_match": false, "pending": true }
```

---

## 4. Compatibility

Calculul procentului de similaritate (TZ 4.6). Serviciul: `compatibility_service`. Formula și ponderile complete în [`data-models.md`](./data-models.md#compatibility-score).

| Metodă | Path | Scop | Auth |
|---|---|---|---|
| `GET` | `/compatibility/{user_id}` | Compatibility Score între utilizatorul curent și țintă, cu breakdown | 🔒 |

**Exemplu — `GET /compatibility/{user_id}`:**
```json
{
  "user_id": "3d2a...",
  "score": 87,
  "breakdown": {
    "interests": 0.30, "status": 0.12, "humor": 0.18,
    "distance": 0.13, "languages": 0.10, "behavior": 0.04
  },
  "color": "green"   // green >80, yellow 50–80, gray <50 (TZ 4.2)
}
```

**Notă:** valoarea `score` e de obicei servită deja în `/feed` și în header-ul de chat, dar acest endpoint permite recalcul on-demand și afișarea breakdown-ului. Ponderile sunt feature-flag (remote config), fără release (TZ 4.6).

---

## 5. Chat

Dialoguri, mesaje, AI hints, Chemistry Score, mascare contacte (TZ 5.1–5.5). Modele: `Chat`, `Message`.

| Metodă | Path | Scop | Auth |
|---|---|---|---|
| `GET` | `/chats` | Lista dialogurilor (foto, nume, ultim mesaj, badge necitite) | 🔒 |
| `GET` | `/chats/{chat_id}` | Header chat: interlocutor, online status, Compatibility Score | 🔒 |
| `GET` | `/chats/{chat_id}/messages` | Istoric mesaje (paginat) | 🔒 |
| `POST` | `/chats/{chat_id}/messages` | Trimite mesaj (text/emoji/foto) — trece prin mascare NLP | 🔒 |
| `POST` | `/chats/{chat_id}/messages/{id}/react` | Reacție/like pe un mesaj | 🔒 |
| `POST` | `/chats/{chat_id}/read` | Marchează ca citit | 🔒 |
| `POST` | `/chats/{chat_id}/archive` | Arhivează dialogul | 🔒 |
| `DELETE` | `/chats/{chat_id}` | Șterge dialogul | 🔒 |
| `GET` | `/chats/{chat_id}/hint` | Sugestie AI de temă de conversație (nu se trimite automat) | 🔒 |
| `GET` | `/chats/{chat_id}/chemistry` | Chemistry Score curent al dialogului | 🔒 |
| `GET` | `/chats/{chat_id}/event-suggestion` | Banner AI „mergeți împreună la [event]" dacă există potrivire | 🔒 |

**Notă mascare contacte (TZ 5.5):** la `POST .../messages`, `masking_service` scanează textul (nickname-uri IG/Telegram, telefon, email, linkuri) și returnează mesajul cu date mascate (`*****`) + un flag explicativ. Mesajul stocat e cel mascat.

**Notă deferred likes (TZ 4.7):** mesajele trimise la like fără reciprocitate devin vizibile în chat automat când cealaltă parte dă like înapoi.

**Notă AI hints (TZ 5.3):** `hint_service` combină banca de ~100 teme cu generare pe baza intersecției interese/status/umor. Endpoint-ul de bază e gratuit cu limită zilnică; extinderea e opțiune plătită (vezi Subscriptions). Push-urile de re-engagement (conversație stinsă) sunt trimise de `hint_tasks`, nu de un endpoint.

**Exemplu — `POST /chats/{chat_id}/messages`:**
```json
// request
{ "type": "text", "body": "hai pe telegram @ana_flirt" }
// response 201 (contact mascat automat)
{
  "id": "msg88...",
  "type": "text",
  "body": "hai pe telegram *********",
  "masked": true,
  "masked_reason": "Datele de contact sunt ascunse pentru siguranța ta.",
  "created_at": "2026-07-06T18:20:00Z"
}
```

**Exemplu — `GET /chats/{chat_id}/hint`:**
```json
{ "hint": "Spune-i despre ultima ta călătorie — amândoi iubiți travel ✈️", "source": "generated", "based_on": ["interests:travel"] }
```

---

## 6. Events

Listă mероприятия, hartă Live Events, marcaj „иду", Flirt Passport, bilet QR (TZ 6.2, 8.1–8.4). Modele: `Event`, `EventAttendance`, `FlirtPassportStamp`, `Ticket`.

| Metodă | Path | Scop | Auth |
|---|---|---|---|
| `GET` | `/events` | Lista mероприятий apropiate (filtrabile după tip, dată) | 🔒 |
| `GET` | `/events/map` | Mероприятия pe hartă + număr de useri FLIRT care merg | 🔒 |
| `GET` | `/events/{event_id}` | Detalii mероприятие (titlu, dată, loc, descriere, cover) | 🔒 |
| `POST` | `/events/{event_id}/attend` | Marchează „иду" (apare badge lângă Compatibility) | 🔒 |
| `DELETE` | `/events/{event_id}/attend` | Retrage marcajul „иду" | 🔒 |
| `GET` | `/events/{event_id}/attendees` | Câți/care useri FLIRT merg (agregat) | 🔒 |
| `GET` | `/tickets/me` | Biletul gratuit Flirt Party (QR / ID unic) | 🔒 |
| `POST` | `/tickets/{ticket_id}/redeem` | Validare bilet la intrare (scanare QR) | 👮 |
| `GET` | `/passport/me` | Ștampilele Flirt Passport ale utilizatorului | 🔒 |
| `POST` | `/passport/checkin` | Check-in la mероприятие (QR/geo) → generează ștampilă | 🔒 |
| `POST` | `/events` | Creează mероприятие (admin) | 👮 |
| `PUT` | `/events/{event_id}` | Editează mероприятие (admin) | 👮 |

**Notă bilet (TZ 6.2):** fiecare utilizator nou primește un `Ticket` unic, one-time, fără expirare, până la redeem. **Notă passport (TZ 8.4):** după vizită confirmată (redeem QR sau geo-checkin), se creează `FlirtPassportStamp` care crește încrederea/prioritatea în feed. **Notă agregare (TZ 8.1):** mероприятия pot fi și agregate automat de AI din surse deschise, apoi moderate (`event_tasks`).

**Exemplu — `GET /events/map`:**
```json
{
  "events": [
    { "event_id": "e91...", "title": "Flirt Party #4", "type": "flirt_party",
      "date": "2026-07-12T20:00:00Z", "lat": 47.024, "lng": 28.832,
      "attendees_count": 42 }
  ]
}
```

**Exemplu — `GET /tickets/me`:**
```json
{ "ticket_id": "t555...", "code": "FLIRT-9X3K-22QP", "qr_url": "https://cdn/.../qr/t555.png", "status": "active", "expires_at": null }
```

---

## 7. Settings

Profil, temă, notificări, blacklist, ascundere profil, ștergere cont, radius, limbi/regiune (TZ 6.1–6.3). Modele: `User`, `Block`, `Profile`.

| Metodă | Path | Scop | Auth |
|---|---|---|---|
| `GET` | `/settings` | Toate setările curente | 🔒 |
| `PATCH` | `/settings/theme` | Temă: `light` / `dark` / `system` | 🔒 |
| `PATCH` | `/settings/notifications` | Toggle push pe categorii (match, mesaje, hints, events, ads) | 🔒 |
| `PATCH` | `/settings/discovery` | Radius de căutare (km), limbi, regiune de afișare | 🔒 |
| `PATCH` | `/settings/visibility` | Ascunde/afișează profilul în feed (invizibilitate temporară) | 🔒 |
| `GET` | `/settings/blacklist` | Lista utilizatorilor blocați | 🔒 |
| `POST` | `/settings/blacklist/{user_id}` | Blochează un utilizator | 🔒 |
| `DELETE` | `/settings/blacklist/{user_id}` | Deblochează | 🔒 |
| `GET` | `/settings/linked-accounts` | Conturile legate (Apple/Google/phone/email) | 🔒 |
| `POST` | `/settings/linked-accounts` | Adaugă/schimbă metodă de login | 🔒 |
| `POST` | `/account/delete` | Cerere ștergere cont (soft, 30 zile recuperare) | 🔒 |
| `POST` | `/account/restore` | Anulează ștergerea în perioada de grație | 🔒 |

**Notă:** ascunderea profilului nu afectează conversațiile curente (TZ 6.3). Ștergerea contului e soft-delete cu perioadă de recuperare (30 zile), după care datele biometrice se șterg (TZ 6.3 + întrebarea deschisă 12 privind biometria).

---

## 8. Moderation

Jalobe, ban, cozi de moderare (TZ 5.5, 10). Modele: `Report`, `Block`, `User`.

| Metodă | Path | Scop | Auth |
|---|---|---|---|
| `POST` | `/reports` | Trimite jalobă (spam / fake / abuz / foto obscene) | 🔒 |
| `GET` | `/moderation/queue` | Coada de moderare manuală (cazuri ambigue) | 👮 |
| `POST` | `/moderation/reports/{report_id}/resolve` | Rezolvă o jalobă (ban / dismiss) | 👮 |
| `POST` | `/moderation/users/{user_id}/ban` | Ban manual utilizator | 👮 |
| `POST` | `/moderation/users/{user_id}/unban` | Ridică ban | 👮 |

**Notă (TZ 5.5 / 10):** `moderation_service` scorează jaloabele; la încredere mare (match cu bază de conținut interzis sau mai multe jalobe independente) → **auto-ban** fără verificare manuală; cazurile spornе intră în `/moderation/queue`. Categoriile de jalobă: `spam`, `fake_profile`, `abuse`, `obscene_photo`.

**Exemplu — `POST /reports`:**
```json
{ "target_user_id": "3d2a...", "category": "obscene_photo", "context_type": "chat", "context_id": "c22...", "comment": "foto nepotrivit" }
// response 201
{ "report_id": "r77...", "status": "queued", "auto_action": null }
```

---

## 9. Subscriptions

Premium, no-ads, AI-bot, „всё включено", purchases (TZ 9). Model: `Subscription`.

| Metodă | Path | Scop | Auth |
|---|---|---|---|
| `GET` | `/subscriptions/plans` | Planurile disponibile și ce includ | 🔒 |
| `GET` | `/subscriptions/me` | Abonamentul curent + entitlements active | 🔒 |
| `POST` | `/subscriptions/purchase` | Validează o achiziție (Apple/Google IAP receipt) | 🔒 |
| `POST` | `/subscriptions/cancel` | Anulează reînnoirea | 🔒 |
| `POST` | `/subscriptions/webhook/apple` | Webhook server-to-server App Store | 🔓* |
| `POST` | `/subscriptions/webhook/google` | Webhook Google Play RTDN | 🔓* |

\* webhook-urile sunt publice dar verificate criptografic (semnătură provider), nu cu JWT.

**Notă (TZ 9):** planuri — `premium` (fără limita de 10 + fără timer reclamă + undo nelimitat + prioritate în feed), `no_ads` (doar fără reclame), `ai_bot` (AI hints extinse peste limita zilnică gratuită), `all_inclusive` (combo). Entitlements-urile controlează limita de feed (§3), timerul de reclamă, undo (§3) și limita de hints (§5). Purchases viitoare (boost anketă, super-lakes) — roadmap TZ 9/11.

**Exemplu — `GET /subscriptions/me`:**
```json
{
  "plan": "premium",
  "status": "active",
  "entitlements": { "unlimited_swipes": true, "no_ads": true, "unlimited_undo": true, "feed_priority": true, "ai_bot_extended": false },
  "renews_at": "2026-08-06T00:00:00Z"
}
```
