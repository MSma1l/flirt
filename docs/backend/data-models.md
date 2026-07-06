# FLIRT — Schema bazei de date (Data Models)

> Schema completă a bazei de date FLIRT: entități, câmpuri, tipuri, relații și indexuri. Mapată pe [Sarcina Tehnică (TZ)](../../.context/TZ.txt).

Stack de persistență: **PostgreSQL 15+ cu PostGIS**, mapat cu **SQLAlchemy 2.0** (async) și migrat cu **Alembic** (vezi [`README.md`](./README.md)). Numele entităților corespund modelelor din `app/models/` și endpoint-urilor din [`api-spec.md`](./api-spec.md).

**Convenții comune tuturor tabelelor:**
- Cheia primară `id`: `UUID` (`uuid4`), tip PostgreSQL `uuid`.
- `created_at`, `updated_at`: `timestamptz`, populate automat (mixin `TimestampMixin`).
- Ștergerile sensibile (User, Profile) sunt **soft-delete** (`deleted_at timestamptz NULL`) pentru perioada de recuperare de 30 zile (TZ 6.3).
- Enum-urile (gender, relationship_status, humor types, report category, plan) sunt stocate ca `text` cu `CHECK` sau ca tip `enum` PostgreSQL; listele extensibile din admin (interese, tipuri de umor, statusuri) sunt tabele de referință.

---

## Diagrama relațiilor (rezumat)

```
User 1─1 Profile 1─* Photo
User 1─1 Session (multiple)
Profile *─* Interest        (profile_interests)
Profile 1─1 HumorProfile
User 1─* Like (as liker / as target)
Like/Like ─> Match 1─1 Chat 1─* Message
User 1─* EventAttendance *─1 Event
User 1─* FlirtPassportStamp *─1 Event
User 1─1 Ticket
User 1─* Report (as reporter / as target)
User *─* Block (blocker / blocked)
User 1─* Subscription
```

---

## 1. User

Contul de bază (autentificare, rol, stare). Detaliile de credențiale/sesiuni sunt tratate în [`security.md`](./security.md).

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `email` | `text` UNIQUE NULL | pentru login email |
| `phone` | `text` UNIQUE NULL | pentru login OTP |
| `password_hash` | `text` NULL | doar la login email (detalii `security.md`) |
| `apple_sub` | `text` UNIQUE NULL | subject Apple ID |
| `google_sub` | `text` UNIQUE NULL | subject Google |
| `date_of_birth` | `date` NOT NULL | validează ≥16 ani (TZ 2.3) |
| `age_group` | `text` | derivat: `16_17` / `18_plus` (TZ 2.3) |
| `role` | `text` | `user` / `moderator` / `admin` |
| `status` | `text` | `active` / `banned` / `hidden` / `pending_delete` |
| `verification_status` | `text` | `pending` / `verified` / `rejected` (TZ 2.2) |
| `deleted_at` | `timestamptz` NULL | soft-delete + grație 30 zile |
| `created_at` / `updated_at` | `timestamptz` | |

**Indexuri:** UNIQUE pe `email`, `phone`, `apple_sub`, `google_sub`; index pe `age_group`, `status`, `verification_status` (folosit intens la construirea feed-ului).

---

## 2. Session

Sesiuni active / refresh tokens. **Schema completă și logica JWT sunt în [`security.md`](./security.md)** — aici doar forma tabelului pentru integritate referențială.

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → User | |
| `refresh_token_hash` | `text` | (detalii `security.md`) |
| `device` | `text` | iOS / Android + info device |
| `expires_at` | `timestamptz` | |
| `created_at` | `timestamptz` | |

**Indexuri:** FK index pe `user_id`; index pe `expires_at` pentru curățare.

---

## 3. Profile

Anketa publică (TZ 2.4). Relație 1–1 cu User.

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → User UNIQUE | |
| `name` | `text` NOT NULL | obligatoriu (TZ 2.4) |
| `gender` | `text` | `male` / `female` / `other` |
| `height_cm` | `int` | obligatoriu |
| `city` | `text` NOT NULL | geolocație de bază |
| `district` | `text` NULL | opțional, precizie distanță |
| `nationality` | `text` NULL | |
| `languages` | `text[]` | `ru` / `ro` / `en` / custom (min 1) |
| `bio` | `text` | max 500 caractere |
| `relationship_statuses` | `text[]` | multiselect (TZ 2.6) |
| `location` | `geography(Point,4326)` | lat/lng geocodate (PostGIS) |
| `hidden` | `boolean` | invizibilitate temporară (TZ 6.3) |
| `search_radius_km` | `int` | radius căutare (TZ 6.3, 7) |
| `attending_event_id` | `uuid` FK → Event NULL | mероприятие marcat (TZ 4.3 / 8.2) |
| `deleted_at` | `timestamptz` NULL | |

**Enum `relationship_statuses`** (TZ 2.6): `serious`, `meet`, `friendship`, `events_together`, `casual` (ultimul indisponibil 16–17).

**Indexuri:**
- UNIQUE pe `user_id`.
- **GiST pe `location`** — critic pentru filtrarea pe rază și calculul Haversine (TZ 7).
- GIN pe `languages` și `relationship_statuses` (intersecții rapide pentru Compatibility).
- Index pe `attending_event_id`.

---

## 4. Photo

Fotografiile anketei (TZ 2.4: min 3, max 9).

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `profile_id` | `uuid` FK → Profile | |
| `url` | `text` | cheie/URL în object storage |
| `position` | `int` | ordinea de afișare (Stories-like) |
| `is_verified_badge` | `boolean` | afișează bageul „✓" (TZ 2.2/2.4) |
| `created_at` | `timestamptz` | |

**Indexuri:** FK index pe `profile_id`; UNIQUE compus `(profile_id, position)`.

---

## 5. Interest + profile_interests

Listă de referință extensibilă din admin (TZ 2.5).

**Interest**

| Câmp | Tip | Note |
|---|---|---|
| `id` | `int` PK | |
| `code` | `text` UNIQUE | ex. `sport`, `travel`, `music` |
| `label` | `jsonb` | traduceri RU/RO/EN |
| `icon` | `text` | referință icon |
| `active` | `boolean` | dezactivare fără release |

**profile_interests** (M2M): `profile_id` FK, `interest_id` FK, PK compus. Index GIN implicit prin tabela de legătură pentru Jaccard rapid.

---

## 6. HumorProfile

Vectorul de umor al utilizatorului (TZ 2.7 + 5.4). Relație 1–1 cu User.

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → User UNIQUE | |
| `vector` | `jsonb` | ponderi pe categorii de umor (vezi mai jos) |
| `quiz_completed` | `boolean` | testul inițial trecut |
| `updated_at` | `timestamptz` | rafinat continuu de NLP |

**Stocarea vectorului de umor.** Categoriile din TZ 2.7: `sarcasm`, `dark`, `memes`, `intellectual`, `absurd`, `wholesome`, `physical`. Vectorul e un dicționar de ponderi normalizate (sumă ~1.0):

```json
{
  "sarcasm": 0.28, "dark": 0.10, "memes": 0.22,
  "intellectual": 0.18, "absurd": 0.09, "wholesome": 0.08, "physical": 0.05
}
```

Se inițializează din quiz (`POST /profiles/me/humor`) și se **actualizează incremental** de `nlp_tasks` pe măsura conversațiilor (TZ 5.4). Vectorul intră direct în componenta „umor" a Compatibility Score prin **similaritate cosinus**.

> **Alternativă de stocare** pentru interogări de similaritate la scară: dacă volumul cere, vectorul poate fi materializat și într-o coloană `vector(7)` folosind extensia `pgvector`, cu index `ivfflat` pe cosinus. `jsonb` rămâne sursa lizibilă/audit; `pgvector` e optimizarea de performanță.

---

## 7. Like

Acțiunile de swipe dreapta / favorite (TZ 4.4, 4.7).

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `liker_id` | `uuid` FK → User | cel care dă like |
| `target_id` | `uuid` FK → User | cel care primește |
| `type` | `text` | `like` / `favorite` (favorite = fără like/dislike) |
| `deferred_message` | `text` NULL | mesaj trimis odată cu like-ul (TZ 4.7), vizibil la reciprocitate |
| `created_at` | `timestamptz` | |

**Indexuri:** UNIQUE compus `(liker_id, target_id)` — un singur like per pereche direcțională; index pe `target_id` (căutare reciprocitate) și pe `liker_id`. Dislike-urile pot fi stocate separat sau într-un tabel efemer Redis (feed) — nu necesită persistență lungă, doar pentru a nu re-afișa anketa.

---

## 8. Match

Rezultatul unui like reciproc (TZ 4.7).

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `user_a_id` | `uuid` FK → User | ordonat (a < b) pentru unicitate |
| `user_b_id` | `uuid` FK → User | |
| `chat_id` | `uuid` FK → Chat | dialogul creat |
| `created_at` | `timestamptz` | |

**Indexuri:** UNIQUE compus `(user_a_id, user_b_id)`; index pe fiecare user pentru listare.

---

## 9. Chat

Dialogul dintre doi useri matchuiți (TZ 5.1).

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `match_id` | `uuid` FK → Match UNIQUE | |
| `chemistry_score` | `numeric(5,2)` NULL | Chemistry Score curent (TZ 5.4) |
| `last_message_at` | `timestamptz` NULL | pentru sortare + detectarea „stins" |
| `archived_by` | `uuid[]` | userii care au arhivat |
| `created_at` | `timestamptz` | |

**Indexuri:** UNIQUE pe `match_id`; index pe `last_message_at`.

### Chemistry Score — stocare & calcul (TZ 5.4)

Chemistry Score se calculează **doar în interiorul unei conversații active** (spre deosebire de Compatibility, care e pre-conversație). Se recalculează de `chemistry_service` / `nlp_tasks` pe baza semnalelor:

- viteza de răspuns (latența medie),
- lungimea mesajelor,
- potrivirea tonului emoțional,
- folosirea reciprocă a aceluiași tip de umor,
- numărul de emoji / reacții.

Se stochează ca `chemistry_score` (0–100) pe `Chat`. Rol dublu: (1) prioritizează AI hints (TZ 5.3), (2) rafinează `HumorProfile.vector` al userului, ceea ce **influențează feed-ul viitor** prin componenta „comportament" (10%) a Compatibility Score.

---

## 10. Message

Mesajele dintr-un chat (TZ 5.2, 5.5).

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `chat_id` | `uuid` FK → Chat | |
| `sender_id` | `uuid` FK → User | |
| `type` | `text` | `text` / `emoji` / `photo` |
| `body` | `text` | conținut **după** mascarea NLP (TZ 5.5) |
| `masked` | `boolean` | contacte ascunse (TZ 5.5) |
| `visible` | `boolean` | `false` pentru mesaj deferred până la reciprocitate (TZ 4.7) |
| `reactions` | `jsonb` | reacții/like-uri per user |
| `read_at` | `timestamptz` NULL | |
| `created_at` | `timestamptz` | |

**Indexuri:** index compus `(chat_id, created_at)` pentru paginarea istoricului; index pe `sender_id`.

---

## 11. Event

Мероприятия / Live Events (TZ 8.1).

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `title` | `text` | |
| `description` | `text` | |
| `type` | `text` | `flirt_party` / `concert` / `other` |
| `starts_at` | `timestamptz` | dată/oră |
| `venue` | `text` | loc |
| `location` | `geography(Point,4326)` | pin pe hartă (PostGIS) |
| `cover_url` | `text` | foto cover |
| `source` | `text` | `admin` / `ai_aggregated` (TZ 8.1) |
| `moderation_status` | `text` | `approved` / `pending` (pt. sursele AI) |
| `created_at` | `timestamptz` | |

**Indexuri:** **GiST pe `location`** (harta Live Events, apropiere); index pe `starts_at`, pe `type`, pe `moderation_status`.

---

## 12. EventAttendance

Marcaj „иду" (TZ 8.2, 8.3).

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → User | |
| `event_id` | `uuid` FK → Event | |
| `created_at` | `timestamptz` | |

**Indexuri:** UNIQUE compus `(user_id, event_id)`; index pe `event_id` pentru numărarea agregată (badge cu numărul de useri, TZ 8.3).

---

## 13. FlirtPassportStamp

Ștampile digitale pentru vizite confirmate (TZ 8.4).

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → User | |
| `event_id` | `uuid` FK → Event | |
| `method` | `text` | `qr` / `geo` (cum a fost confirmată prezența) |
| `stamped_at` | `timestamptz` | |

**Indexuri:** UNIQUE compus `(user_id, event_id)`; index pe `user_id`. Numărul de ștampile crește încrederea/prioritatea în feed (semnal comportamental).

---

## 14. Ticket

Biletul gratuit one-time Flirt Party (TZ 6.2).

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → User UNIQUE | un bilet per user |
| `code` | `text` UNIQUE | ID unic / conținut QR |
| `status` | `text` | `active` / `redeemed` |
| `redeemed_at` | `timestamptz` NULL | fără expirare până la redeem (TZ 6.2) |
| `redeemed_event_id` | `uuid` FK → Event NULL | |
| `created_at` | `timestamptz` | |

**Indexuri:** UNIQUE pe `user_id` și pe `code`.

---

## 15. Report

Jalobe (TZ 5.5, 10).

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `reporter_id` | `uuid` FK → User | |
| `target_id` | `uuid` FK → User | |
| `category` | `text` | `spam` / `fake_profile` / `abuse` / `obscene_photo` |
| `context_type` | `text` NULL | `chat` / `profile` |
| `context_id` | `uuid` NULL | id-ul contextului |
| `comment` | `text` NULL | |
| `confidence` | `numeric(4,3)` | scor de încredere calculat de moderare |
| `status` | `text` | `queued` / `resolved` / `auto_actioned` |
| `auto_action` | `text` NULL | `ban` dacă auto-ban la încredere mare (TZ 10) |
| `created_at` | `timestamptz` | |

**Indexuri:** index pe `target_id` (agregarea mai multor jalobe independente → auto-ban), pe `status`, pe `reporter_id`.

---

## 16. Block

Lista neagră / utilizatori blocați (TZ 6.3).

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `blocker_id` | `uuid` FK → User | |
| `blocked_id` | `uuid` FK → User | |
| `created_at` | `timestamptz` | |

**Indexuri:** UNIQUE compus `(blocker_id, blocked_id)`; index pe ambele coloane (exclude din feed și din vizibilitate reciprocă).

---

## 17. Subscription

Abonamente și entitlements (TZ 9).

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → User | |
| `plan` | `text` | `premium` / `no_ads` / `ai_bot` / `all_inclusive` |
| `status` | `text` | `active` / `canceled` / `expired` |
| `platform` | `text` | `apple` / `google` |
| `entitlements` | `jsonb` | flag-uri: `unlimited_swipes`, `no_ads`, `unlimited_undo`, `feed_priority`, `ai_bot_extended` |
| `original_transaction_id` | `text` | referință IAP |
| `renews_at` | `timestamptz` NULL | |
| `created_at` / `updated_at` | `timestamptz` | |

**Indexuri:** index pe `user_id`, pe `status`; UNIQUE pe `original_transaction_id`. Entitlements-urile controlează limita de feed (10 ankete), timerul de reclamă de 15s, undo-ul și limita de AI hints.

---

## Compatibility Score

Formula de similaritate din **TZ 4.6**. Rezultatul e normalizat la 0–100% și calculat de `compatibility_service`. Componentele și ponderile (feature-flag în remote config, modificabile fără release):

| Factor | Pondere | Cum se calculează |
|---|---|---|
| **Interese** | **30%** | indice **Jaccard** pe seturile de interese: `|A ∩ B| / |A ∪ B|` |
| **Status cunoștință** | **15%** | potrivire completă = maxim; intersecție parțială = proporțional cu suprapunerea statusurilor |
| **Profil de umor** | **20%** | **similaritate cosinus** între vectorii `HumorProfile.vector` (din quiz + NLP) |
| **Distanță / geo** | **15%** | funcție descrescătoare pe distanța Haversine (PostGIS); mai aproape = scor mai mare, tăiat la `search_radius_km` |
| **Limbi comune** | **10%** | **cel puțin o limbă comună obligatoriu**; puncte suplimentare pentru mai multe limbi comune |
| **Comportament** | **10%** | istoric de like-uri reciproce cu ankete similare, activitate, **Chemistry Score** din chaturi (TZ 5.4) |

### Formula

```
Score = 0.30·Interests
      + 0.15·Status
      + 0.20·Humor
      + 0.15·Distance
      + 0.10·Languages
      + 0.10·Behavior
```

- Fiecare componentă e normalizată în `[0, 1]` înainte de ponderare; rezultatul `×100`, rotunjit la procent întreg.
- **Gate hard:** dacă nu există nicio limbă comună (`Languages = 0`), perechea e filtrată din feed (cerință TZ 4.6: „наличие минимум одного общего языка обязательно").
- **Culoare badge** (TZ 4.2): `>80` verde, `50–80` galben, `<50` gri.
- Ponderile trăiesc în `core/config.py` / remote config → schimbabile fără release de app (TZ 4.6).

### Unde se calculează

Feed-ul pre-calculează scorurile în batch (`compatibility_tasks`) și le cache-uiește în Redis pentru servire rapidă (respectând limita de 10 și fereastra glisantă). Endpoint-ul on-demand `GET /compatibility/{user_id}` (vezi [`api-spec.md`](./api-spec.md#4-compatibility)) recalculează și expune breakdown-ul pe componente.
