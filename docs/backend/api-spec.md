# FLIRT — Specificația API REST

> Specificația endpoint-urilor REST ale backend-ului FLIRT. Documentul este împărțit în **✅ Implementat (MVP)** — rutele care există efectiv în cod (`app/api/v1/*.py`) — și **🔜 Planificat (din TZ, neimplementat)** — rutele din blueprint-ul inițial care încă nu au fost scrise. Pentru starea generală a proiectului vezi [`PROGRESS.md`](../../PROGRESS.md).

Toate rutele au prefixul `/api/v1`. Formatul de schimb este JSON. Autentificarea se face prin Bearer JWT (detalii complete în [`security.md`](./security.md)); aici indicăm doar dacă un endpoint **necesită auth** sau este public. Numele modelelor referite corespund celor din [`data-models.md`](./data-models.md).

**Convenții:**
- `🔓 Public` — nu necesită token. `🔒 Auth` — necesită Bearer JWT valid.
- Erorile folosesc formatul standard `{ "detail": "..." }` (sau listă de erori de validare Pydantic 422).
- Listele întorc în MVP un **array JSON simplu** (fără paginare cursor). Paginarea/cursor-ul este planificat (vezi secțiunea de roadmap).

---

## Cuprins

**✅ Implementat (MVP):** [Auth](#1-auth-) · [Profiles](#2-profiles-) · [Feed / Swipe](#3-feed--swipe-) · [Chat](#4-chat-) · [Settings](#5-settings-) · [Social (favorites / blocks)](#6-social--favorites--blocks-) · [Ticket](#7-ticket-) · [Events + Flirt Passport](#8-events--flirt-passport-) · [Stories](#9-stories-)

**🔜 Planificat:** [Roadmap din TZ, neimplementat](#-planificat-din-tz-neimplementat)

---

# ✅ Implementat (MVP)

Rutele de mai jos există în cod și sunt acoperite de teste (`backend/tests/`). Autentificarea se face exclusiv prin **email + parolă** (fără social/OTP/verificare facială în MVP).

---

## 1. Auth ✅

Montate sub `/api/v1/auth` (`app/api/v1/auth.py`). Detaliile de token/rotație/refresh sunt în [`security.md`](./security.md).

| Metodă | Path | Scop | Auth | Răspuns |
|---|---|---|---|---|
| `POST` | `/auth/register` | Înregistrare email + parolă (min 8 caractere) | 🔓 | `201` → `TokenPair` |
| `POST` | `/auth/login` | Login email + parolă (`401` la credențiale greșite) | 🔓 | `200` → `TokenPair` |
| `POST` | `/auth/refresh` | Rotește refresh token-ul (cu reuse detection pe `family_id`) | 🔓 | `200` → `TokenPair` |
| `POST` | `/auth/logout` | Revocă sesiunea de refresh | 🔒* | `204` |
| `GET` | `/auth/me` | Userul curent (`id`, `email`, `profile_completed`) | 🔒 | `200` → `UserOut` |

\* `logout` primește `refresh_token` în body și revocă sesiunea.

**`TokenPair`:** `{ "access_token": "...", "refresh_token": "...", "token_type": "bearer" }`

**Exemplu — `POST /auth/register`:**
```json
// request
{ "email": "ana@example.com", "password": "parola-sigura" }
// response 201
{ "access_token": "eyJhbGci...", "refresh_token": "eyJhbGci...", "token_type": "bearer" }
```

---

## 2. Profiles ✅

Montate sub `/api/v1/profiles` (`app/api/v1/profiles.py`). Anketa este **upsert** printr-un singur `PUT`; nu există (încă) upload de poze, quiz de umor sau vizualizarea altui user.

| Metodă | Path | Scop | Auth | Răspuns |
|---|---|---|---|---|
| `GET` | `/profiles/reference` | Opțiuni de referință: genuri, statusuri de cunoștință, limbi, interese (etichete RU/RO) | 🔓 | `200` → `ReferenceOut` |
| `GET` | `/profiles/me` | Anketa proprie completă (`404` dacă nu a fost completată) | 🔒 | `200` → `ProfileOut` |
| `PUT` | `/profiles/me` | Creează/actualizează anketa; o marchează completată | 🔒 | `200` → `ProfileOut` |

**Notă:** `birth_date` trăiește pe **Profile** (nu pe User). `age` se calculează din `birth_date` la răspuns. `interests` sunt slug-uri validate față de catalog. `photos` este doar o listă de URL-uri (upload real — planificat).

**Exemplu — `PUT /profiles/me`:**
```json
// request
{
  "name": "Ana",
  "birth_date": "1998-04-12",
  "gender": "female",
  "height_cm": 168,
  "city": "Chișinău",
  "street": "Centru",
  "nationality": "Moldovan",
  "languages": ["ru", "ro", "en"],
  "about": "Cafea, drumeții, jazz.",
  "dating_statuses": ["serious", "friendship"],
  "interests": ["music", "travel", "coffee"],
  "photos": ["https://.../1.jpg"]
}
// response 200 → ProfileOut (include `age`, `humor_vector`, `completed`)
```

---

## 3. Feed / Swipe ✅

Montate sub `/api/v1/feed` (`app/api/v1/feed.py`). Compatibility Score este **precalculat și servit inline** pe fiecare card (`compatibility`, 0–100); ponderile sunt în `core/config.py` (vezi [`data-models.md`](./data-models.md#compatibility-score)). Nu există endpoint dedicat `/compatibility` — scorul vine în feed.

| Metodă | Path | Scop | Auth | Răspuns |
|---|---|---|---|---|
| `GET` | `/feed/` | Candidatele pentru swipe, sortate după compatibilitate (exclude self, deja-swipe-uiți, separare vârstă 16–17 / 18+) | 🔒 | `200` → `list[FeedCard]` |
| `POST` | `/feed/swipe` | Înregistrează un `like`/`dislike`; întoarce dacă a produs match reciproc | 🔒 | `200` → `SwipeResult` |
| `GET` | `/feed/matches` | Lista match-urilor userului curent | 🔒 | `200` → `list[MatchOut]` |

**`FeedCard`:** `user_id, name, age, gender, city, distance_km?, about?, top_interests[], languages[], compatibility, photos[]`.

**Exemplu — `POST /feed/swipe`:**
```json
// request
{ "target_user_id": "3d2a...", "action": "like" }
// response — match imediat
{ "matched": true, "match_id": "m17...", "chat_id": "c22..." }
// response — like fără reciprocitate
{ "matched": false, "match_id": null, "chat_id": null }
```

---

## 4. Chat ✅

Montate sub `/api/v1/chats` (`app/api/v1/chat.py`). Toate protejate. Un chat există per match. **Mascarea contactelor** (TZ 5.5) se aplică la trimitere: `body`-ul stocat este cel mascat, iar `was_masked` semnalează UI-ul.

| Metodă | Path | Scop | Auth | Răspuns |
|---|---|---|---|---|
| `GET` | `/chats/` | Lista dialogurilor (interlocutor, ultim mesaj, `unread_count`) | 🔒 | `200` → `list[ChatSummary]` |
| `GET` | `/chats/{chat_id}/messages` | Istoricul mesajelor; marchează primite ca citite | 🔒 | `200` → `list[MessageOut]` |
| `POST` | `/chats/{chat_id}/messages` | Trimite mesaj (`body`); contactele sunt mascate automat | 🔒 | `201` → `MessageOut` |
| `POST` | `/chats/{chat_id}/read` | Marchează citite mesajele primite | 🔒 | `204` |

**Exemplu — `POST /chats/{chat_id}/messages`:**
```json
// request
{ "body": "hai pe telegram @ana_flirt" }
// response 201 (contact mascat automat)
{
  "id": "msg88...",
  "sender_id": "9f1c...",
  "body": "hai pe telegram *********",
  "was_masked": true,
  "is_read": false,
  "created_at": "2026-07-06T18:20:00Z"
}
```

---

## 5. Settings ✅

Montate sub `/api/v1/settings` (`app/api/v1/settings.py`). Un singur `GET`/`PUT` pentru toate setările (temă, rază, notificări, ascundere profil, regiune) + ștergere cont cu perioadă de grație (`account_deletion_grace_days` din config).

| Metodă | Path | Scop | Auth | Răspuns |
|---|---|---|---|---|
| `GET` | `/settings/` | Toate setările curente (valori implicite dacă lipsesc) | 🔒 | `200` → `SettingsOut` |
| `PUT` | `/settings/` | Actualizare **parțială** (toate câmpurile opționale) | 🔒 | `200` → `SettingsOut` |
| `POST` | `/settings/account/delete` | Cerere ștergere cont (soft, cu perioadă de grație) | 🔒 | `200` → `AccountDeletionOut` |
| `POST` | `/settings/account/delete/cancel` | Anulează cererea de ștergere | 🔒 | `204` |

**`SettingsOut`:** `theme, search_radius_km, notifications{}, profile_hidden, region?`.

---

## 6. Social — favorites / blocks ✅

Montate sub `/api/v1/social` (`app/api/v1/social.py`). Favorite și black list, ambele idempotente pe pereche.

| Metodă | Path | Scop | Auth | Răspuns |
|---|---|---|---|---|
| `GET` | `/social/favorites` | Lista de favorite (cu date de profil) | 🔒 | `200` → `list[FavoriteOut]` |
| `POST` | `/social/favorites` | Adaugă un user la favorite (`{ target_user_id }`) | 🔒 | `201` |
| `DELETE` | `/social/favorites/{target_user_id}` | Scoate din favorite | 🔒 | `204` |
| `GET` | `/social/blocks` | Lista de useri blocați | 🔒 | `200` → `list[BlockOut]` |
| `POST` | `/social/blocks` | Blochează un user (`{ target_user_id }`) | 🔒 | `201` |
| `DELETE` | `/social/blocks/{target_user_id}` | Deblochează | 🔒 | `204` |

---

## 7. Ticket ✅

Montat sub `/api/v1/ticket` (`app/api/v1/ticket.py`). Biletul one-time Flirt Party este **emis lazy** la prima cerere.

| Metodă | Path | Scop | Auth | Răspuns |
|---|---|---|---|---|
| `GET` | `/ticket/` | Biletul userului; îl emite dacă lipsește (`{ code, used }`) | 🔒 | `200` → `TicketOut` |

**Notă:** redeem/validare la intrare (rol admin) — planificat.

---

## 8. Events + Flirt Passport ✅

Montate sub `/api/v1/events` (`app/api/v1/events.py`). Include marcaj „merg", check-in (ștampilă idempotentă) și listarea ștampilelor. Coordonatele `lat`/`lng` sunt stocate ca `Float` (fără PostGIS) și pot lipsi.

| Metodă | Path | Scop | Auth | Răspuns |
|---|---|---|---|---|
| `GET` | `/events/` | Evenimentele viitoare (`attendee_count`, `i_am_going`) | 🔒 | `200` → `list[EventOut]` |
| `GET` | `/events/passport` | Ștampilele Flirt Passport ale userului | 🔒 | `200` → `list[PassportStampOut]` |
| `GET` | `/events/{event_id}` | Detaliile unui eveniment (`404` altfel) | 🔒 | `200` → `EventOut` |
| `POST` | `/events/{event_id}/going` | Marchează / anulează participarea (`{ going }`) | 🔒 | `200` → `EventOut` |
| `POST` | `/events/{event_id}/checkin` | Check-in → ștampilă Flirt Passport (idempotentă) | 🔒 | `201` → `PassportStampOut` |

> Ruta `/passport` e declarată înaintea rutei parametrizate `/{event_id}` ca să nu fie „înghițită".

**Exemplu — `GET /events/` (element):**
```json
{
  "id": "e91...", "title": "Flirt Party #4", "description": "...",
  "starts_at": "2026-07-12T20:00:00Z", "city": "Chișinău", "venue": "Loft",
  "lat": 47.024, "lng": 28.832, "kind": "flirt_party", "cover_url": "https://.../c.jpg",
  "attendee_count": 42, "i_am_going": true
}
```

---

## 9. Stories ✅

Montate sub `/api/v1/stories` (`app/api/v1/stories.py`). Poveștile expiră la 24h (`story_ttl_hours` din config) și sunt vizibile autorului + userilor cu care are Match.

| Metodă | Path | Scop | Auth | Răspuns |
|---|---|---|---|---|
| `POST` | `/stories/` | Publică o poveste (`{ media_url, caption? }`) care expiră peste 24h | 🔒 | `201` → `StoryOut` |
| `GET` | `/stories/` | Poveștile active proprii + ale match-urilor, grupate pe user | 🔒 | `200` → `list[UserStories]` |
| `GET` | `/stories/mine` | Poveștile active proprii | 🔒 | `200` → `list[StoryOut]` |
| `DELETE` | `/stories/{story_id}` | Șterge o poveste proprie (`403`/`404` altfel) | 🔒 | `204` |

**`UserStories`:** `user_id, name, story_count, stories[]`. **`StoryOut`:** `id, user_id, media_url, caption?, created_at, expires_at`.

---

# 🔜 Planificat (din TZ, neimplementat)

Rutele de mai jos apar în blueprint-ul inițial din TZ, dar **nu există încă** în cod. Sunt păstrate ca referință de roadmap. Modelele lor (Photo, HumorProfile, Report, Subscription etc.) sunt marcate „planificat" în [`data-models.md`](./data-models.md).

### Auth extins
| Metodă | Path | Scop |
|---|---|---|
| `POST` | `/auth/apple` · `/auth/google` | Sign in with Apple / Google (TZ 2.1) |
| `POST` | `/auth/phone/request-otp` · `/auth/phone/verify-otp` | Login telefon + OTP (TZ 2.1) |
| `POST` | `/auth/verification/face` · `GET /auth/verification/status` | Verificare facială / liveness (TZ 2.2) |
| `GET`/`POST` | `/settings/linked-accounts` | Conturi legate (Apple/Google/phone/email) |

### Profiles extins
| Metodă | Path | Scop |
|---|---|---|
| `GET` | `/profiles/{user_id}` | Anketa publică a altui user |
| `PATCH` | `/profiles/me/status` | Schimbă statusul de cunoștință punctual |
| `POST`/`DELETE`/`PUT` | `/profiles/me/photos*` | Upload / ștergere / reordonare foto (min 3, max 9 — TZ 2.4) |
| `GET` | `/interests` | (există ca parte din `/profiles/reference`; endpoint separat — opțional) |
| `GET` | `/humor/quiz` · `POST /profiles/me/humor` | Testul de umor → vector inițial (TZ 2.7) |

### Compatibility
| Metodă | Path | Scop |
|---|---|---|
| `GET` | `/compatibility/{user_id}` | Score on-demand cu breakdown pe componente (în MVP scorul e servit inline în `/feed`) |

### Feed / Swipe extins
| Metodă | Path | Scop |
|---|---|---|
| `GET` | `/feed/status` | Stare sesiune: rămase, timer reclamă 15s, tip abonament (TZ 4.5) |
| `POST` | `/swipe/favorite` · `POST /swipe/undo` | Favorite din swipe + undo (1 pas free / nelimitat premium) — în MVP favorite trăiește sub `/social` |
| — | mesaj inițial la like (deferred, TZ 4.7) | livrare amânată a primului mesaj |

### Chat extins
| Metodă | Path | Scop |
|---|---|---|
| `GET` | `/chats/{chat_id}` | Header chat: online status, Compatibility Score |
| `POST` | `/chats/{chat_id}/messages/{id}/react` | Reacție/like pe mesaj |
| `POST` | `/chats/{chat_id}/archive` · `DELETE /chats/{chat_id}` | Arhivare / ștergere dialog |
| `GET` | `/chats/{chat_id}/hint` | Sugestie AI de temă (TZ 5.3) |
| `GET` | `/chats/{chat_id}/chemistry` · `/event-suggestion` | Chemistry Score + banner eveniment comun (TZ 5.4) |

### Events extins
| Metodă | Path | Scop |
|---|---|---|
| `GET` | `/events/map` | Evenimente pe hartă + contor useri (TZ 8.3) |
| `GET` | `/events/{event_id}/attendees` | Agregat participanți |
| `POST` | `/tickets/{ticket_id}/redeem` | Validare bilet la intrare (👮 admin) |
| `POST`/`PUT` | `/events` (admin) | CRUD evenimente + agregare AI moderată (TZ 8.1) |

### Moderation (TZ 5.5, 10)
| Metodă | Path | Scop |
|---|---|---|
| `POST` | `/reports` | Jalobă (spam / fake / abuz / foto obscene) |
| `GET`/`POST` | `/moderation/*` | Coadă moderare, resolve, ban/unban (👮) |

### Subscriptions (TZ 9)
| Metodă | Path | Scop |
|---|---|---|
| `GET` | `/subscriptions/plans` · `/subscriptions/me` | Planuri + entitlements |
| `POST` | `/subscriptions/purchase` · `/cancel` | Validare achiziție IAP / anulare |
| `POST` | `/subscriptions/webhook/{apple,google}` | Webhook server-to-server |
