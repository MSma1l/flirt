# FLIRT — Schema bazei de date (Data Models)

> Schema bazei de date FLIRT. Documentul distinge **✅ Implementat (MVP)** — modelele care există în `app/models/*.py` — de **🔜 Planificat (din TZ, neimplementat)** — tabelele din blueprint care încă nu au fost create. Pentru starea proiectului vezi [`PROGRESS.md`](../../PROGRESS.md).

Stack de persistență: **SQLAlchemy 2.0 async**, migrat cu **Alembic**. În producție rulează pe **PostgreSQL 16** (vezi `docker-compose.yml`), iar testele pe SQLite in-memory — de aceea listele/vectorii se stochează ca **`JSON` portabil**, nu ca tipuri specifice Postgres. **Nu se folosește PostGIS/GiST** în MVP: coordonatele sunt `Float` simple, iar distanța se poate calcula în aplicație (Haversine).

**Convenții comune (mixin `Base` din `app/db/base.py`):**
- Cheia primară `id`: `UUID` (`uuid4`).
- `created_at`, `updated_at`: `timestamptz`, populate automat.
- În MVP **nu există soft-delete pe rânduri** (`deleted_at`) — ștergerea contului e gestionată printr-un tabel separat `AccountDeletionRequest` cu perioadă de grație.

---

## Diagrama relațiilor — ✅ modele reale (MVP)

```
User 1─1 Profile           (Profile deține birth_date, poze[], humor_vector, dating_statuses)
User 1─* RefreshSession
Profile *─* Interest        (profile_interests)
User 1─* Like (from / to)   (Like.is_like: True=like, False=dislike; Like.deferred_message opțional)
Like⇄Like ─> Match 1─1 Chat 1─* Message   (Message.reaction opțional)
User 1─1 UserSettings
User *─* Favorite           (separat de Like)
User *─* Block
User 1─1 Ticket             (code + used)
User 1─1 AccountDeletionRequest
User 1─* EventAttendance *─1 Event
User 1─* FlirtPassportStamp *─1 Event
User 1─* Story              (expiră la 24h)
User *─* Report             (reporter → reported, cu auto-ban la prag)
User 1─* Subscription       (abonament + entitlements — stub billing)
User 1─* PushDevice         (token push per dispozitiv — stub)
```

---

# ✅ Implementat (MVP)

## 1. User (`app/models/user.py`)

Contul de autentificare — **minimal** în MVP: doar email + hash parolă + flag anketă.

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `email` | `String(255)` UNIQUE NOT NULL | login email (indexat) |
| `password_hash` | `String(255)` NOT NULL | doar hash (Argon2), niciodată parola brută |
| `profile_completed` | `bool` | `False` până la completarea anketei |
| `created_at` / `updated_at` | `timestamptz` | |

**Relație:** `profile` (1:1, `viewonly`, `lazy=selectin`). Nu există `phone`, `apple_sub`, `google_sub`, `role`, `status`, `verification_status`, `date_of_birth` sau `deleted_at` — vezi „Planificat".

> **Notă:** `date_of_birth` din blueprint **nu** e pe User; câmpul real `birth_date` trăiește pe **Profile** (vezi mai jos).

---

## 2. RefreshSession (`app/models/session.py`)

Sesiuni de refresh cu rotație + reuse detection. **Detaliile JWT sunt în [`security.md`](./security.md)**.

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → User | indexat |
| `jti` | `String(64)` UNIQUE | id-ul token-ului curent din familie |
| `family_id` | `String(64)` | comun tuturor rotațiilor sesiunii |
| `token_hash` | `String(64)` | SHA-256 hex al refresh token-ului brut |
| `expires_at` | `timestamptz` | |
| `revoked` | `bool` | |

---

## 3. Profile (`app/models/profile.py`)

Anketa (TZ 2.4–2.7). Relație 1:1 cu User. Deține `birth_date`, pozele (JSON) și vectorul de umor (JSON).

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → User UNIQUE | indexat, `ondelete=CASCADE` |
| `name` | `String(120)` NOT NULL | obligatoriu (TZ 2.4) |
| `birth_date` | `Date` NOT NULL | vârsta se derivă la răspuns (`age`) |
| `gender` | `String(16)` NOT NULL | `male` / `female` / `other` |
| `height_cm` | `int` NOT NULL | |
| `city` | `String(120)` NOT NULL | |
| `street` | `String(200)` NULL | opțional |
| `nationality` | `String(120)` NULL | opțional |
| `languages` | `JSON` (list) | min 1 la nivel de produs |
| `about` | `String(500)` NULL | ≤500 caractere |
| `dating_statuses` | `JSON` (list) | multiselect (TZ 2.6) |
| `humor_vector` | `JSON` (dict) NULL | completat mai târziu de test/AI (TZ 2.7) |
| `photos` | `JSON` (list) | listă de URL-uri (upload real — planificat) |
| `completed` | `bool` | anketă completată integral |

**Diferențe față de blueprint:** nu există coloana PostGIS `location`, `hidden`, `search_radius_km` sau `attending_event_id` pe Profile. `hidden` (ca `profile_hidden`) și `search_radius_km` trăiesc pe **UserSettings**. Câmpul „despre mine" se numește `about` (nu `bio`), iar statusurile `dating_statuses` (nu `relationship_statuses`).

---

## 4. Interest + profile_interests (`app/models/interest.py`)

Catalog extensibil (TZ 2.5) + M2M cu profilul.

**Interest**

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `slug` | `String(64)` UNIQUE | ex. `sport`, `travel`, `music` (indexat) |
| `label_ru` | `String(120)` | etichetă RU |
| `label_ro` | `String(120)` | etichetă RO |

**ProfileInterest** (M2M): `profile_id` FK, `interest_id` FK, `UniqueConstraint(profile_id, interest_id)`.

> Diferă de blueprint: PK e `uuid` (nu `int`), etichetele sunt două coloane `label_ru`/`label_ro` (nu `jsonb`), nu există câmpul `icon`/`active`.

---

## 5. Like + Match (`app/models/swipe.py`)

**Like** — un swipe direcțional (TZ 4.4). Favorite este un **model separat** (`Favorite`), nu un tip de Like.

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `from_user_id` | `uuid` FK → User | cel care dă swipe (indexat) |
| `to_user_id` | `uuid` FK → User | ținta (indexat) |
| `is_like` | `bool` NOT NULL | `True` = like, `False` = dislike |
| `deferred_message` | `Text` NULL | mesaj inițial trimis la like (TZ 4.7); livrat în chat doar la match reciproc |

`UniqueConstraint(from_user_id, to_user_id)` — un singur swipe per pereche direcțională (upsert la re-swipe). Dislike-urile **se persistă** (nu doar Redis) ca să nu re-apară în feed.

**Match** — like reciproc (TZ 4.7). Perechea e normalizată: `user_a_id` = UUID mai mic, `user_b_id` = mai mare.

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `user_a_id` | `uuid` FK → User | indexat |
| `user_b_id` | `uuid` FK → User | indexat |

`UniqueConstraint(user_a_id, user_b_id)`. Chat-ul referă `Match` (vezi mai jos), nu invers.

---

## 6. Chat + Message (`app/models/chat.py`)

**Chat** — un dialog per match (relație 1:1).

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `match_id` | `uuid` FK → Match UNIQUE | indexat |
| `user_a_id` / `user_b_id` | `uuid` FK → User | participanții (aceeași normalizare) |

**Message** — un mesaj; `body` conține **deja** textul mascat (TZ 5.5).

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `chat_id` | `uuid` FK → Chat | indexat |
| `sender_id` | `uuid` FK → User | |
| `body` | `Text` NOT NULL | conținut după `mask_contacts` |
| `was_masked` | `bool` | mascarea a modificat ceva → afișăm pastila |
| `is_read` | `bool` | destinatarul a deschis conversația |
| `reaction` | `String(16)` NULL | reacție emoji la mesaj (TZ 5.2); `null` = fără reacție |

> Nu există (încă): `chemistry_score`, `last_message_at`, `archived_by` pe Chat; `type` pe Message. Mesajul deferred de la like trăiește pe `Like.deferred_message` (nu ca flag `visible` pe Message).

---

## 7. UserSettings, Favorite, Block, Ticket, AccountDeletionRequest (`app/models/account.py`)

**UserSettings** (1:1 cu User):

| Câmp | Tip | Note |
|---|---|---|
| `user_id` | `uuid` FK → User UNIQUE | |
| `theme` | `String(16)` | `system` / `light` / `dark` |
| `search_radius_km` | `int` NOT NULL | implicit din config la creare |
| `notifications` | `JSON` (dict) | flag-uri: match/messages/ai_hints/events/promos |
| `profile_hidden` | `bool` | ascunde profilul din feed |
| `region` | `String(120)` NULL | regiune preferată |

**Favorite** — `user_id` a marcat `target_user_id`; `UniqueConstraint(user_id, target_user_id)`.
**Block** — `blocker_id` l-a blocat pe `blocked_id`; `UniqueConstraint(blocker_id, blocked_id)`.

**Ticket** — bilet one-time Flirt Party (1:1 cu User):

| Câmp | Tip | Note |
|---|---|---|
| `user_id` | `uuid` FK → User UNIQUE | un bilet per user |
| `code` | `String(64)` UNIQUE | conținut QR / ID |
| `used` | `bool` | folosit la intrare (fără expirare până atunci) |

> Diferă de blueprint: câmpul de stare e `used: bool` (nu `status` enum), fără `redeemed_at`/`redeemed_event_id`.

**AccountDeletionRequest** — ștergere cu grație (1:1 cu User):

| Câmp | Tip | Note |
|---|---|---|
| `user_id` | `uuid` FK → User UNIQUE | |
| `requested_at` | `timestamptz` | momentul cererii |
| `purge_after` | `timestamptz` | `requested_at + account_deletion_grace_days` |

---

## 8. Event, EventAttendance, FlirtPassportStamp (`app/models/event.py`)

**Event** — coordonate ca `Float` simple (fără PostGIS).

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `title` | `String(200)` NOT NULL | |
| `description` | `Text` NULL | |
| `starts_at` | `timestamptz` NOT NULL | filtrare „viitor" |
| `city` | `String(120)` NOT NULL | |
| `venue` | `String(200)` NULL | |
| `lat` / `lng` | `Float` NULL | pin hartă (opțional) |
| `kind` | `String(32)` | `flirt_party` / `concert` / `other` |
| `cover_url` | `String(500)` NULL | |

> Fără `source`/`moderation_status` (agregare AI + moderare — planificat).

**EventAttendance** — marcaj „merg" (TZ 8.2); `UniqueConstraint(event_id, user_id)`, câmp `going: bool`.

**FlirtPassportStamp** — ștampilă după check-in (TZ 8.4); `UniqueConstraint(event_id, user_id)`, câmp `stamped_at: timestamptz`. (Fără `method` qr/geo — check-in-ul e simplu în MVP.)

---

## 9. Story (`app/models/story.py`)

Poveste efemeră (TZ secț. 11, adusă în MVP). Expiră la 24h.

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → User | autorul (indexat) |
| `media_url` | `String(500)` NOT NULL | URL foto/video (upload separat) |
| `caption` | `String(500)` NULL | text opțional |
| `expires_at` | `timestamptz` NOT NULL | `created_at + story_ttl_hours` (24h) |

Vizibilitate: autor + userii cu care are Match; filtrarea expirării se face în service.

---

## 10. Report (`app/models/moderation.py`)

Raportare de utilizator pentru moderare (TZ 5.5 + 10). La atingerea pragului de raportori distincți (config) se declanșează **auto-ban** → profilul raportat e ascuns din feed.

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `reporter_id` | `uuid` FK → User | cine raportează (indexat) |
| `reported_id` | `uuid` FK → User | cine e raportat (indexat) |
| `category` | `String(32)` NOT NULL | `spam` / `fake` / `offensive` / `obscene` |
| `chat_id` | `uuid` NULL | chatul din care s-a raportat (opțional, fără FK strict) |
| `note` | `String(500)` NULL | notă liberă a raportorului |
| `status` | `String(16)` | `open` / `auto_banned` / `reviewed` (implicit `open`) |

`UniqueConstraint(reporter_id, reported_id, category)` — un singur raport per motiv, per pereche. Coada de moderare manuală (admin) rămâne planificată.

---

## 11. Subscription (`app/models/billing.py`)

Abonament de monetizare (TZ 9). Un rând per abonament al userului. **Achiziția e stub** (provider fals), gata de comutat pe Stripe/App Store/Play din `.env` — vezi [`../INTEGRATIONS.md`](../INTEGRATIONS.md).

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → User | proprietarul (indexat) |
| `plan` | `String(32)` NOT NULL | `premium` / `no_ads` / `ai_bot` / `all_inclusive` |
| `status` | `String(16)` | `active` / `canceled` / `expired` (implicit `active`) |
| `provider` | `String(16)` NOT NULL | `stub` / `stripe` / `app_store` / `play` |
| `expires_at` | `timestamptz` NULL | în stub: `acum + 30 zile` |

---

## 12. PushDevice (`app/models/device.py`)

Token de notificare push per dispozitiv (TZ 6.3). Trimiterea e abstractizată (`StubPush`, gata de Expo/FCM/APNs — vezi [`../INTEGRATIONS.md`](../INTEGRATIONS.md)).

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → User | proprietarul (indexat) |
| `token` | `String(255)` NOT NULL | token Expo/FCM, opac pentru backend |
| `platform` | `String(16)` NOT NULL | `ios` / `android` |

`UniqueConstraint(user_id, token)` — upsert idempotent la re-înregistrare.

---

## Compatibility Score (✅ calculat, în feed)

Formula din **TZ 4.6**, implementată în serviciul de feed. Ponderile trăiesc în `core/config.py` (nu remote config, în MVP) și însumează `1.0`:

| Factor | Pondere | Config |
|---|---|---|
| Interese | **30%** | `compat_w_interests` |
| Status cunoștință | **15%** | `compat_w_status` |
| Profil de umor | **20%** | `compat_w_humor` |
| Distanță / geo | **15%** | `compat_w_distance` |
| Limbi comune | **10%** | `compat_w_languages` |
| Comportament | **10%** | `compat_w_behavior` |

Rezultatul e normalizat la `0–100` și servit **inline** în fiecare `FeedCard` (câmpul `compatibility`). Culoare badge (TZ 4.2): `>80` verde, `50–80` galben, `<50` gri. **Nu există endpoint `/compatibility` separat** în MVP.

---

# 🔜 Planificat (din TZ, neimplementat)

Următoarele tabele apar în blueprint dar **nu există** în `app/models/`. Endpoint-urile lor sunt listate în [`api-spec.md`](./api-spec.md#-planificat-din-tz-neimplementat).

| Tabel planificat | Rol | Observație |
|---|---|---|
| **Photo** (dedicat) | Tabel foto cu poziție + badge verificat (TZ 2.4) | În MVP pozele sunt o listă de URL-uri (`Profile.photos` JSON), gestionată prin `/profiles/photos*` peste storage (stub). Tabelul dedicat rămâne opțional |
| **HumorProfile** (dedicat) | Vector de umor separat + rafinare NLP din conversații (TZ 5.4) | În MVP vectorul e `Profile.humor_vector` (JSON), populat de testul de umor `/humor/*` (✅ implementat); rafinarea NLP e planificată |

> **Moderarea și monetizarea SUNT implementate:** modelele `Report` (secț. 10), `Subscription` (secț. 11) și `PushDevice` (secț. 12) există în cod. `Subscription`/`PushDevice` folosesc provideri **stub** (gata de chei). Rămâne planificată doar coada de moderare manuală (admin) și validarea reală de receipt IAP.

**Alte elemente de blueprint neimplementate:**
- Câmpuri User: `phone`, `apple_sub`/`google_sub`, `role`, `status`, `verification_status`, `date_of_birth`, `deleted_at`. (Auth social/OTP funcționează prin get-or-create pe email, fără coloane dedicate pe User.)
- **PostGIS / GiST** pe `location` — codul folosește `Float` (`lat`/`lng`) portabil; distanța Haversine se calculează în aplicație, nu în DB.
- `pgvector` pentru similaritatea vectorului de umor — `humor_vector` rămâne JSON.
- Pe Chat/Message: `chemistry_score`, `last_message_at`, `archived_by`, `type`. (`Message.reaction` și mesajul deferred la like — `Like.deferred_message` — sunt ✅ implementate.)
- Pe Ticket: stare `status`/`redeemed_at`; pe Stamp: `method` (qr/geo); pe Event: `source`/`moderation_status`.
