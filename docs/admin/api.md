# FLIRT — Specificația API de administrare

> Endpoint-urile panoului de administrare. Arhitectura, modelul de securitate și bootstrap-ul primului admin sunt în [`README.md`](./README.md).

Toate rutele au prefixul `/api/v1/admin`. Formatul de schimb este JSON.

**Convenții:**
- 🔒 **Admin** — necesită Bearer JWT al unui cont cu `role == "admin"`. **Toate** rutele de mai jos, cu o singură excepție (`POST /admin/login`, marcată 🔓).
- Erori: `401` fără token / token invalid · `403` user obișnuit sau admin banat · `404` resursă inexistentă · `422` payload invalid / limită depășită · `429` rate limit.
- Formatul erorilor: `{ "detail": "..." }` (sau listă de erori de validare Pydantic la `422`).
- **Paginare:** corpul e o **listă simplă**; cursorul paginii următoare vine în header-ul **`X-Next-Cursor`** (aceeași convenție ca `/feed`, `/chats`, `/events`). Absența header-ului = ultima pagină.
- **Plafoane:** `?limit=` e plafonat la `ADMIN_MAX_LIMIT` (implicit 100); implicit `ADMIN_PAGE_LIMIT` (25). Peste plafon → `422`.

---

## Cuprins

1. [Auth](#1-auth) · 2. [Statistici](#2-statistici) · 3. [Moderare](#3-moderare) · 4. [Useri](#4-useri) · 5. [Evenimente](#5-evenimente) · 6. [Abonamente](#6-abonamente) · 7. [Jurnal de audit](#7-jurnal-de-audit)

---

## 1. Auth

| Metodă | Path | Scop | Auth | Răspuns |
|---|---|---|---|---|
| `POST` | `/admin/login` | Login de admin, cu rate limit **strict** (`rate_limit_admin_login_per_min`, implicit 3/min) și audit (`admin.login`) | 🔓 | `200` → `TokenPair` |
| `GET` | `/admin/me` | Cine sunt și ce rol am | 🔒 | `200` → `AdminMe` |

`POST /admin/login` — `401` la credențiale greșite (identic pentru „email inexistent" și „parolă greșită" — fără oracol de enumerare), `403` dacă credențialele sunt corecte dar contul **nu e admin**. Verificarea rolului se face **după** parolă (altfel ar fi un oracol: „acest email e admin", oferit fără nicio credențială) și **înainte** de emiterea token-urilor (un login de admin respins nu lasă în urmă o sesiune de refresh valabilă 30 de zile).

> `POST /auth/login` (ruta obișnuită) funcționează și el pentru un admin, dar cu rate limit-ul normal (5/min) și **fără** intrare în jurnalul de audit. Panoul ar trebui să folosească `/admin/login`.

**`AdminMe`:** `{ "id": "...", "email": "...", "role": "admin" }`

`GET /admin/me` există pentru că `GET /auth/me` (`UserOut`) **nu expune `role`** — panoul nu are din ce să decidă dacă utilizatorul logat e administrator. Fiind în spatele lui `require_admin`, un `200` e în sine dovada rolului.

---

## 2. Statistici

| Metodă | Path | Scop | Auth | Răspuns |
|---|---|---|---|---|
| `GET` | `/admin/stats` | Dashboard complet (număr **constant** de query-uri agregate) | 🔒 | `200` → `AdminStats` |
| `GET` | `/admin/stats/timeseries?days=N` | Seriile zilnice ale dashboard-ului, toate într-un apel | 🔒 | `200` → `TimeseriesPoint[]` |
| `GET` | `/admin/stats/timeseries/{metric}?days=N` | Serie temporală pentru **o** metrică (analiză ad-hoc) | 🔒 | `200` → `MetricSeries` |

### `AdminStats` — două straturi

Răspunsul are **cifrele plate** (cardurile din capul panoului) **și** obiectele detaliate. Aceleași agregate SQL le alimentează pe amândouă — zero query-uri în plus.

```jsonc
{
  // Stratul PLAT (contractul panoului React)
  "users_total": 1284, "users_active_24h": 310, "users_new_7d": 96, "users_banned": 7,
  "matches_total": 2140, "matches_24h": 63,
  "reports_pending": 4,
  "subscriptions_active": 88, "revenue_estimated_eur": 879.12,

  // Stratul DETALIAT
  "users":    { "total": 1284, "new_today": 12, "new_7d": 96, "new_30d": 402,
                "active_24h": 310, "active": 640, "banned": 7,
                "pending_deletion": 3, "admins": 2 },
  "profiles": { "total": 1100, "completed": 980, "incomplete": 304, "verified": 210, "hidden": 15 },
  "swipes":   { "swipes": 9800, "likes": 6100, "dislikes": 3700,
                "matches": 2140, "matches_24h": 63, "match_rate": 35.08 },
  "chats":    { "chats": 2100, "messages": 41000, "masked_messages": 320 },
  "reports":  { "total": 51, "pending": 4, "resolved": 47,
                "by_category": { "spam": 30, "fake": 12, "offensive": 6, "obscene": 3 } },
  "subscriptions": { "active": 88, "by_plan": { "premium": 60, "all_inclusive": 28 },
                     "estimated_revenue_eur": 879.12 },
  "events":   { "total": 14, "upcoming": 5, "attendances": 230 },
  "generated_at": "2026-07-13T10:00:00Z"
}
```

Note:
- **`active_24h` / `active`** — `last_active_at` în ultimele 24h, respectiv în fereastra din config (`admin_active_window_days`, implicit 7 zile).
- **`profiles.incomplete`** se raportează la **toți** userii, nu doar la cei cu un rând în `profiles`: un cont fără niciun profil e cea mai incompletă anketă cu putință. Dacă i-am fi numărat doar pe cei cu rând, funnel-ul de onboarding ar fi arătat perfect exact când e cel mai rupt.
- **`match_rate`** = `matches / likes × 100`. Un match consumă două like-uri, dar raportăm față de like-urile trimise — e metrica pe care o citește produsul („din 100 de like-uri, câte devin match?").
- **`estimated_revenue_eur`** = `Σ(abonamente active pe plan × prețul planului din config)`. **Estimare**, nu contabilitate: fără proration, taxe sau refund-uri.

### `TimeseriesPoint[]`

```jsonc
[
  { "date": "2026-07-12", "users": 8, "matches": 21, "reports": 1, "revenue_eur": 19.98,
    "swipes": 140, "messages": 610 },
  { "date": "2026-07-13", "users": 12, "matches": 63, "reports": 0, "revenue_eur": 0.0,
    "swipes": 190, "messages": 720 }
]
```

Toate seriile într-**un singur apel**: un endpoint „o metrică per cerere" ar fi cerut 4 round-trip-uri ca să deseneze un ecran care se deschide o dată, pentru exact aceleași agregări `GROUP BY`. **Zilele fără activitate apar ca `0`, nu lipsesc** — un grafic care sare peste zilele goale minte vizual (o zi cu zero înregistrări ar dispărea din axă în loc să apară ca o vale).

`?days=` e plafonat la `admin_timeseries_max_days` (implicit 365); implicit `admin_timeseries_default_days` (30). Peste plafon → `422` (fiecare zi e un bucket agregat — `?days=1000000` ar fi un DoS gratuit).

### `MetricSeries` — o singură metrică

`GET /admin/stats/timeseries/{metric}` → `{ "metric": "users", "days": 30, "points": [{ "date": "...", "count": 8 }], "total": 96 }`

Metrici acceptate: `users` · `swipes` · `matches` · `messages` · `chats` · `reports` · `subscriptions` · `events`.
`metric` e validată contra unei **allowlist** (`422` dacă e necunoscută) — nu ajunge niciodată interpolată într-un SQL.

---

## 3. Moderare

> **Cea mai importantă secțiune operațional.** Apple Guideline 1.2 cere răspuns la raportările de conținut abuziv în **≤24h**.

| Metodă | Path | Scop | Auth | Răspuns |
|---|---|---|---|---|
| `GET` | `/admin/reports` | Coada de moderare (**în așteptare primele**), paginată | 🔒 | `200` → `AdminReport[]` |
| `POST` | `/admin/reports/{id}/resolve` | Decizia umană asupra unui raport | 🔒 | `200` → `AdminReport` |
| `GET` | `/admin/users/{id}/reports` | Istoricul rapoartelor **împotriva** unui user | 🔒 | `200` → `AdminReport[]` |

**Query params (`GET /admin/reports`):** `status` (`open` \| `resolved` \| `dismissed`) · `limit` · `cursor`.

### `AdminReport`

```jsonc
{
  "id": "…", "reporter_id": "…", "reported_id": "…",
  "category": "spam",              // spam | fake | offensive | obscene
  "note": "trimite linkuri",
  "status": "open",                // open | resolved | dismissed
  "created_at": "2026-07-13T09:00:00Z",
  "reporters_count": 3,            // raportori DISTINCȚI, nu rapoarte
  "reported": {                    // profilul raportat, deja alăturat
    "user_id": "…", "email": "…", "name": "Ana", "age": 26,
    "city": "Chișinău", "about": "…", "photos": ["…"], "banned_at": null
  },
  "chat_id": null, "total_reports": 4, "pending": true
}
```

- **`reporters_count`** numără raportorii **distincți**: trei rapoarte de la același om nu înseamnă nimic; trei rapoarte de la trei oameni înseamnă foarte mult.
- **`reported`** vine alăturat ca panoul să nu facă un fetch per rând — adică N+1-ul mutat în client.

### Stările raportului

| În DB | În API | Sens |
|---|---|---|
| `open` | `open` | Raport nou, nimeni nu s-a uitat la el. |
| `auto_banned` | **`open`** | Pragul de raportori distincți a declanșat auto-ascunderea (`moderation_service`). **Rămâne în coadă:** auto-ascunderea e o măsură automată de urgență, nu un răspuns uman — iar Apple cere unul. Altfel exact cazurile cele mai grave ar fi dispărut din coada moderatorului. |
| `resolved` | `resolved` | Un om a decis și a aplicat o măsură. |
| `dismissed` | `dismissed` | Un om a decis că raportul e nefondat. |

### `POST /admin/reports/{id}/resolve`

```jsonc
// request
{ "action": "ban", "reason": "Conținut abuziv repetat" }
```

| `action` | Sinonim acceptat | Efect |
|---|---|---|
| `ban` | `ban_user` | Banează contul raportat: revocă sesiunile, îl scoate din feed, refuză login-ul. |
| `hide` | `hide_profile` | Îl ascunde din feed **fără** a-i tăia accesul (măsură blândă). |
| `dismiss` | — | Raport nefondat, nicio măsură asupra contului. |

- Rezolvarea **închide toate rapoartele în așteptare împotriva aceluiași user**, nu doar rândul pe care s-a dat click: altfel cinci reclamații despre aceeași persoană ar cere cinci decizii identice, iar coada — singura măsură a SLA-ului — ar rămâne artificial plină după ce cazul a fost deja judecat.
- `ban` scrie **două** intrări de audit (`report.resolve` + `user.ban`): o căutare pe `target=user` trebuie să arate banul, indiferent pe unde a fost declanșat.
- `400` dacă adminul încearcă să se banească/ascundă pe sine printr-un raport.

---

## 4. Useri

| Metodă | Path | Scop | Auth | Răspuns |
|---|---|---|---|---|
| `GET` | `/admin/users` | Căutare + filtrare + paginare | 🔒 | `200` → `AdminUser[]` |
| `GET` | `/admin/users/{id}` | Fișa completă | 🔒 | `200` → `AdminUserDetail` |
| `POST` | `/admin/users/{id}/ban` | Banează (revocă sesiunile + ascunde profilul) | 🔒 | `200` → `AdminUserDetail` |
| `POST` | `/admin/users/{id}/unban` | Ridică banul | 🔒 | `200` → `AdminUserDetail` |
| `DELETE` | `/admin/users/{id}` | **Ștergere GDPR ireversibilă** | 🔒 | `204` |

**Query params (`GET /admin/users`):** `q` (email **sau** nume din anketă) · `status` (`active` \| `banned` \| `reported`) · `role` · `banned` · `verified` · `completed` · `limit` · `cursor`.

`status=reported` = are cel puțin un raport împotriva lui — starea pe care un moderator o caută cel mai des.

`q` lovește emailul **și** numele printr-un OUTER JOIN: userii fără profil trebuie să rămână găsibili după email. `%` și `_` sunt escapate — o căutare de `%` **nu** întoarce toată tabela.

### `AdminUser` / `AdminUserDetail`

```jsonc
// AdminUser (rând de tabel)
{ "id": "…", "email": "…", "role": "user", "created_at": "…", "last_active_at": "…",
  "banned_at": null, "ban_reason": null, "profile_completed": true,
  "name": "Ana", "city": "Chișinău", "reports_count": 0,
  "age": 26, "gender": "female", "verified": true, "photos_count": 3 }

// AdminUserDetail adaugă:
{ "about": "…", "photos": ["…"], "matches_count": 12, "subscription_plan": "premium",
  "languages": ["ro","en"], "dating_statuses": ["serious"], "profile_hidden": false,
  "distinct_reporters": 0, "likes_sent": 140, "messages_sent": 610,
  "active_sessions": 2, "subscription_status": "active", "subscription_expires_at": "…" }
```

**Niciun câmp nu conține parole, hash-uri sau token-uri.** Sesiunile apar doar ca **număr** (`active_sessions`), niciodată cu `token_hash` sau `jti`.

### `POST /admin/users/{id}/ban`

```jsonc
{ "reason": "Spam repetat în chat" }   // motivul e OBLIGATORIU (intră în audit)
```

Banul face trei lucruri în aceeași tranzacție: `banned_at` + motiv, **revocarea sesiunilor de refresh**, `profile_hidden`. Vezi [`README.md §3`](./README.md#3-modelul-de-securitate).
`400` la auto-ban (adminul s-ar încuia singur afară din panou).

### `POST /admin/users/{id}/unban`

Contul redevine funcțional și reapare în feed (`profile_hidden=false` — banul e cel care l-a ascuns). Sesiunile revocate **nu** se „dez-revocă": userul se autentifică din nou. A reînvia o sesiune revocată ar însemna să reactivăm token-uri care au circulat cât timp contul era banat.

### `DELETE /admin/users/{id}`

Corp **opțional**: `{ "reason": "..." }` (intră în audit când e trimis).

Refolosește `account_service.purge_user_data` — exact logica pe care o rulează și cron-ul GDPR la expirarea perioadei de grație. Contul nu dispare din tabelă: e **anonimizat** (email `@deleted.invalid`, hash de parolă invalid), ca să nu rupă cheile externe păstrate.
`400` la auto-ștergere.

---

## 5. Evenimente

> **Golul funcțional pe care îl închide panoul:** `POST /events` nu există în API-ul public, iar seed-ul demo e blocat în producție. Rutele astea sunt **singura** cale prin care un eveniment real ajunge în baza de producție.

| Metodă | Path | Scop | Auth | Răspuns |
|---|---|---|---|---|
| `GET` | `/admin/events` | Toate evenimentele, **inclusiv cele trecute** | 🔒 | `200` → `AdminEvent[]` |
| `POST` | `/admin/events` | Creează un eveniment | 🔒 | `201` → `AdminEvent` |
| `PUT` | `/admin/events/{id}` | Editare **parțială** | 🔒 | `200` → `AdminEvent` |
| `DELETE` | `/admin/events/{id}` | Șterge evenimentul + participările + ștampilele | 🔒 | `204` |

`GET /events` (public) arată doar viitorul — userul nu are ce face cu o petrecere de acum trei luni. Adminul are: o editează, o șterge, o refolosește.

```jsonc
// POST /admin/events
{ "title": "Flirt Party Downtown", "starts_at": "2026-08-01T20:00:00Z",
  "city": "Chișinău", "kind": "party", "description": "…", "venue": "Club Nova",
  "lat": 47.0245, "lng": 28.8322, "cover_url": null }
```

- `kind`: `flirt_party` \| `party` \| `concert` \| `bar` \| `sport` \| `culture` \| `other`.
- `lat` / `lng` validate în intervalele geografice reale (o latitudine de 500 nu e o eroare de utilizator, e o eroare de date) → `422`.
- Textele trec prin validatorii anti-XSS ai proiectului (fără HTML) → `422`.
- **`PUT` e parțial** (`exclude_unset`): un PUT care schimbă doar ora **nu** șterge descrierea.
- `DELETE` șterge copiii **explicit** — pe SQLite cheile externe sunt dezactivate implicit, deci `ON DELETE CASCADE` nu s-ar declanșa și ar rămâne participări orfane.

---

## 6. Abonamente

| Metodă | Path | Scop | Auth | Răspuns |
|---|---|---|---|---|
| `GET` | `/admin/subscriptions` | Listare paginată (cu `user_email` prin JOIN) | 🔒 | `200` → `AdminSubscription[]` |
| `POST` | `/admin/subscriptions` | Acordare manuală **după email** | 🔒 | `200` → `AdminSubscription` |
| `POST` | `/admin/users/{id}/grant-subscription` | Acordare manuală **după id** | 🔒 | `200` → `AdminSubscription` |

**Query params (`GET`):** `plan` · `status` · `limit` · `cursor`.

```jsonc
// POST /admin/subscriptions
{ "email": "vip@example.com", "plan": "premium", "days": 30, "reason": "Compensație suport" }

// POST /admin/users/{id}/grant-subscription
{ "plan": "premium", "days": 30, "reason": "Compensație suport" }
```

- **`plan` e validat contra catalogului real** (`billing.PLANS`: `premium` · `no_ads` · `ai_bot` · `all_inclusive`) → `400` la un plan inventat, care ar fi produs un abonament fără niciun drept asociat.
- **`days` e plafonat** la `admin_grant_max_days` (implicit 365): un `days=36500` scris din greșeală într-un formular de suport nu are voie să devină un abonament pe viață. Implicit: `admin_grant_default_days` (30).
- **`provider` = `manual`** — abonamentele **dăruite** nu se amestecă cu cele **plătite** în raportarea de venit.
- `404` dacă emailul nu există (mesaj clar, nu o acordare tăcută către nimeni).

---

## 7. Jurnal de audit

| Metodă | Path | Scop | Auth | Răspuns |
|---|---|---|---|---|
| `GET` | `/admin/audit-log` | Cine, ce, asupra cui, când, de la ce IP | 🔒 | `200` → `AuditLog[]` |

**Query params:** `action` · `target_id` · `limit` · `cursor`.

**Citire și atât.** Nu există `DELETE`, `PUT` sau „curăță jurnalul" — orice altă metodă întoarce `405`. Un jurnal pe care adminul suspect îl poate șterge nu e un jurnal.

```jsonc
{ "id": "…", "actor_id": "…", "actor_email": "admin@flirt.md",
  "action": "user.ban", "target_type": "user", "target_id": "…",
  "meta": { "reason": "Spam repetat", "email": "spammer@example.com" },
  "ip": "203.0.113.7", "created_at": "2026-07-13T10:00:00Z" }
```

**Acțiuni înregistrate:** `admin.login` · `user.ban` · `user.unban` · `user.hide` · `user.delete` · `report.resolve` · `event.create` · `event.update` · `event.delete` · `subscription.grant`.

`meta` conține parametrii deciziei — **niciodată** secrete. `target_id` nu are cheie externă: ținta poate fi ștearsă chiar de acțiunea auditată (`user.delete`), iar un FK ar fi făcut imposibilă tocmai înregistrarea ștergerii.
