# FLIRT — Schema bazei de date (Data Models)

> Schema bazei de date FLIRT. Documentul distinge **✅ Implementat** — modelele care există în `app/models/*.py` — de **🔜 Planificat / ❌ Amânat**. Pentru starea proiectului vezi [`PROGRESS.md`](../../PROGRESS.md).

Stack de persistență: **SQLAlchemy 2.0 async**, migrat cu **Alembic**. În producție rulează pe **PostgreSQL 16** (vezi `docker-compose.yml`), iar testele pe SQLite in-memory — de aceea listele/vectorii se stochează ca **`JSON` portabil**, nu ca tipuri specifice Postgres.

**Astăzi: 22 de tabele, 13 migrații.**

| # | Tabel | # | Tabel |
|---|---|---|---|
| 1 | `users` | 12 | `messages` |
| 2 | `refresh_sessions` | 13 | `user_settings` |
| 3 | `profiles` | 14 | `favorites` |
| 4 | `interests` | 15 | `blocks` |
| 5 | `profile_interests` | 16 | `tickets` |
| 6 | `likes` | 17 | `account_deletion_requests` |
| 7 | `matches` | 18 | `stories` |
| 8 | `events` | 19 | `reports` |
| 9 | `event_attendances` | 20 | `subscriptions` |
| 10 | `flirt_passport_stamps` | 21 | `push_devices` |
| 11 | `chats` | 22 | **`admin_audit_logs`** |

**Convenții comune (mixin `Base` din `app/db/base.py`):**
- Cheia primară `id`: `UUID` (`uuid4`).
- `created_at`, `updated_at`: `timestamptz`, populate automat.
- **Nu există soft-delete pe rânduri** (`deleted_at`) — ștergerea contului e gestionată printr-un tabel separat `AccountDeletionRequest` cu perioadă de grație.

---

## Diagrama relațiilor — ✅ modele reale

```
User 1─1 Profile           (Profile deține birth_date, lat/lng, poze[], humor_vector, verified)
User 1─* RefreshSession
Profile *─* Interest        (profile_interests)
User 1─* Like (from / to)   (Like.is_like: True=like, False=dislike; Like.deferred_message opțional)
Like⇄Like ─> Match 1─1 Chat 1─* Message   (Message.reaction opțional)
User 1─1 UserSettings       (temă + notificări + PREFERINȚE DE CĂUTARE — filtrele dure ale feed-ului)
User *─* Favorite           (separat de Like)
User *─* Block
User 1─1 Ticket             (code + used)
User 1─1 AccountDeletionRequest
User 1─* EventAttendance *─1 Event
User 1─* FlirtPassportStamp *─1 Event
User 1─* Story              (expiră la 24h)
User *─* Report             (reporter → reported, cu auto-ASCUNDERE la prag)
User 1─* Subscription       (abonament + entitlements)
User 1─* PushDevice         (token push per dispozitiv)
User 1─* AdminAuditLog      (actor_id, ON DELETE SET NULL — append-only)
```

---

# ✅ Implementat

## 1. User (`app/models/user.py`)

Contul de autentificare. **Nu mai e minimal** — are rol, ban și semnal de activitate.

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `email` | `String(255)` UNIQUE NOT NULL | login email (indexat) |
| `password_hash` | `String(255)` NOT NULL | doar hash (Argon2), niciodată parola brută |
| `profile_completed` | `bool` | `False` până la completarea anketei |
| **`role`** | `String(16)` NOT NULL, **indexat** | `user` (implicit) \| `admin` |
| **`banned_at`** | `timestamptz` NULL, **indexat** | `NULL` = cont în regulă |
| **`ban_reason`** | `String(500)` NULL | motivul, scris de moderator |
| **`last_active_at`** | `timestamptz` NULL, **indexat** | ultima cerere autentificată |
| `created_at` / `updated_at` | `timestamptz` | |

**Proprietăți helper:** `is_admin` (`role == "admin"`), `is_banned` (`banned_at is not None`). Sursa de adevăr rămâne coloana.

### `role` — de ce TEXT și nu `is_admin: bool`
Adăugarea unui rol nou (`moderator`, `support`) devine o **migrație de date**, nu o rescriere a modelului. Azi implementăm doar `user` vs `admin`; un RBAC granular se face mai târziu, dacă e nevoie.

**⚠️ Rolul se citește din DB la FIECARE cerere, NU din JWT.** Un rol pus în token ar rămâne valid până la expirarea lui — adică un admin căruia i s-a retras rolul (sau al cărui cont a fost compromis) ar rămâne admin ore în șir. Citirea din DB face **revocarea instantanee**. `role` **nu e expus** în niciun API public (`UserOut` nu-l conține) — doar în `/api/v1/admin/*`.

### `banned_at` / `ban_reason` — ban REAL
Când e setat:
- login-ul e **refuzat**;
- orice token existent devine inutilizabil (`get_current_user` → `403`);
- **sesiunile de refresh sunt revocate** (altfel banatul ar continua să-și reînnoiască accesul 30 de zile);
- profilul dispare din feed.

> Nu confunda cu `Report.status = "auto_banned"` — aceea e doar **auto-ascundere**. Vezi [secțiunea Report](#10-report-appmodelsmoderationpy).

### `last_active_at` — semnal de calitate
Feed-ul îl folosește ca filtru dur (conturi inactive de peste `feed_max_inactive_days = 30` **ies din feed**) și ca ordonare la retrieval; statisticile de admin îl folosesc pentru „useri activi". Scris **rar** (prag `last_active_touch_minutes = 15`), deci nu adaugă un `UPDATE` la fiecare request. `NULL` = cont vechi/nefolosit încă → tratat ca **ACTIV** (nu ascundem retroactiv pe cineva pentru o coloană introdusă abia acum).

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
| `revoked` | `bool` | setat în masă de banul din admin |

---

## 3. Profile (`app/models/profile.py`)

Anketa (TZ 2.4–2.7). Relație 1:1 cu User. Deține `birth_date`, coordonatele, pozele și vectorul de umor.

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → User UNIQUE | indexat, `ondelete=CASCADE` |
| `name` | `String(120)` NOT NULL | obligatoriu (TZ 2.4) |
| `birth_date` | `Date` NOT NULL, **indexat** | vârsta se derivă la răspuns (`age`); **gate dur 18+** |
| `gender` | `String(16)` NOT NULL, **indexat** | `male` / `female` / `other` |
| `height_cm` | `int` NOT NULL | |
| `city` | `String(120)` NOT NULL, indexat | |
| `street` | `String(200)` NULL | opțional |
| `nationality` | `String(120)` NULL | opțional |
| **`lat`** | `Float` NULL | coordonată geocodată |
| **`lng`** | `Float` NULL | coordonată geocodată |
| `languages` | `JSON` (list) | min 1 la nivel de produs |
| `about` | `String(500)` NULL | ≤500 caractere |
| `dating_statuses` | `JSON` (list) | multiselect (TZ 2.6) |
| `humor_vector` | `JSON` (dict) NULL | 7 tipuri de umor, scris de `/humor/submit` |
| `photos` | `JSON` (list) | listă de URL-uri (peste storage abstractizat) |
| `completed` | `bool`, **indexat** | predicatul principal al feed-ului |
| **`verified`** | `bool` NOT NULL, default `False` | verificare facială reușită (setat de `POST /profiles/verify-face`) |

**Index compus `ix_profiles_lat_lng`** — susține bounding-box-ul din filtrul pe rază. Fără el, filtrarea geografică ar face seq scan.

### `lat`/`lng` — geocodare O SINGURĂ DATĂ
Coordonatele se calculează la **salvarea anketei** (`profile_service.upsert_anketa`), **NU** la fiecare cerere de feed. Consecințe:
- filtrarea pe rază se face **în SQL** (bounding-box pe indexul compus);
- distanța reală intră în scor **fără niciun apel de rețea per candidat**;
- `None` = oraș negeocodabil (provider indisponibil, plafon atins) ⇒ distanță necunoscută ⇒ **scor neutru**, fără penalizare.

Provider implicit recomandat: **Nominatim (OpenStreetMap) — gratuit, fără cheie API și fără card**.

**Ce NU are Profile:** coloană PostGIS `location`, `hidden`, `search_radius_km`, `attending_event_id`. `hidden` (ca `profile_hidden`) și preferințele de căutare trăiesc pe **UserSettings**. Câmpul „despre mine" se numește `about` (nu `bio`), iar statusurile `dating_statuses` (nu `relationship_statuses`).

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

> Diferă de blueprint: PK e `uuid` (nu `int`), etichetele sunt două coloane `label_ru`/`label_ro` (nu `jsonb`), nu există `icon`/`active`.

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

### UserSettings (1:1 cu User)

Ține **și preferințele de căutare** — filtrele DURE aplicate de feed.

| Câmp | Tip | Note |
|---|---|---|
| `user_id` | `uuid` FK → User UNIQUE | |
| `theme` | `String(16)` | `system` / `light` / `dark` |
| `search_radius_km` | `int` NOT NULL | implicit din config (50 km); plafon 1000 km |
| `notifications` | `JSON` (dict) | flag-uri: match/messages/ai_hints/events/promos |
| `profile_hidden` | `bool` | ascunde profilul din feed |
| `region` | `String(120)` NULL | regiune preferată |
| **`interested_in`** | `JSON` (list) NOT NULL | **genurile căutate** (subset din catalog). Listă **goală** = fără restricție de gen |
| **`age_min`** | `int` NULL | `NULL` → default din config (18). **Nu poate coborî sub `adult_age`** |
| **`age_max`** | `int` NULL | `NULL` → default din config (99); plafon absolut 120 |

**⚠️ `interested_in` NU EXISTA înainte.** Consecința era brutală și vizibilă: *un bărbat heterosexual primea bărbați în feed*. Nu exista niciun filtru de gen/orientare — feed-ul întorcea toate profilurile completate.

**⚠️ `search_radius_km` se salva și se IGNORA.** Setarea era pur decorativă: userul o muta de la 5 km la 500 km și feed-ul rămânea identic. Acum se aplică efectiv (bounding-box SQL + haversine exact).

**De ce aici și nu într-un model nou `SearchPreference`:** relația e tot 1:1 cu userul, `search_radius_km` (tot preferință de căutare) trăia deja aici, iar tabela e deja expusă prin `GET/PUT /settings`. Un tabel separat ar fi adus un JOIN în plus **pe calea critică a feed-ului** și un al doilea ciclu de viață (creare/ștergere/GDPR) fără niciun câștig — preferințele nu au cardinalitate proprie și nu se versionează.

### Favorite / Block
**Favorite** — `user_id` a marcat `target_user_id`; `UniqueConstraint(user_id, target_user_id)`.
**Block** — `blocker_id` l-a blocat pe `blocked_id`; `UniqueConstraint(blocker_id, blocked_id)`. Feed-ul îl aplică **în ambele direcții**.

### Ticket — bilet one-time Flirt Party (1:1 cu User)

| Câmp | Tip | Note |
|---|---|---|
| `user_id` | `uuid` FK → User UNIQUE | un bilet per user |
| `code` | `String(64)` UNIQUE | conținut QR / ID |
| `used` | `bool` | folosit la intrare (fără expirare până atunci) |

> Diferă de blueprint: câmpul de stare e `used: bool` (nu `status` enum), fără `redeemed_at`/`redeemed_event_id`.

### AccountDeletionRequest — ștergere cu grație (1:1 cu User)

| Câmp | Tip | Note |
|---|---|---|
| `user_id` | `uuid` FK → User UNIQUE | |
| `requested_at` | `timestamptz` | momentul cererii |
| `purge_after` | `timestamptz` | `requested_at + account_deletion_grace_days` (30 zile) |

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

> **Evenimentele se creează exclusiv din admin** (`POST /api/v1/admin/events`) — API-ul public nu are `POST /events`. Fără panoul de admin, producția nu avea nicio cale să creeze un eveniment în afară de un `INSERT` manual în DB.
> Fără `source`/`moderation_status` — agregarea AI a evenimentelor (TZ 8.1) rămâne planificată; CRUD-ul manual **există**.

**EventAttendance** — marcaj „merg" (TZ 8.2); `UniqueConstraint(event_id, user_id)`, câmp `going: bool`.

**FlirtPassportStamp** — ștampilă după check-in (TZ 8.4); `UniqueConstraint(event_id, user_id)`, câmp `stamped_at: timestamptz`. (Fără `method` qr/geo — check-in-ul e simplu.)

---

## 9. Story (`app/models/story.py`)

Poveste efemeră. Expiră la 24h.

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → User | autorul (indexat) |
| `media_url` | `String(500)` NOT NULL | URL foto/video |
| `caption` | `String(500)` NULL | text opțional |
| `expires_at` | `timestamptz` NOT NULL | `created_at + story_ttl_hours` (24h) |

Vizibilitate: autor + userii cu care are Match; filtrarea expirării se face în service.

---

## 10. Report (`app/models/moderation.py`)

Raportare de utilizator pentru moderare (TZ 5.5 + 10).

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `reporter_id` | `uuid` FK → User | cine raportează (indexat) |
| `reported_id` | `uuid` FK → User | cine e raportat (indexat) |
| `category` | `String(32)` NOT NULL | `spam` / `fake` / `offensive` / `obscene` |
| `chat_id` | `uuid` NULL | chatul din care s-a raportat (fără FK strict) |
| `note` | `String(500)` NULL | notă liberă a raportorului |
| `status` | `String(16)` | `open` / `auto_banned` / `resolved` / `dismissed` (implicit `open`) |

`UniqueConstraint(reporter_id, reported_id, category)` — un singur raport per motiv, per pereche.

### Stările raportului

| Stare (DB) | Cine o pune | Ce înseamnă | Cum apare în admin |
|---|---|---|---|
| `open` | sistemul, la depunere | așteaptă decizie umană | `open` |
| **`auto_banned`** | **automat**, la prag (`report_autoban_threshold = 3` raportori **distincți**) | **auto-ASCUNDERE** | tot **`open`** — cere decizie umană |
| `resolved` | un **om** (admin) | s-a aplicat o măsură | `resolved` |
| `dismissed` | un **om** (admin) | raport nefondat | `dismissed` |

**⚠️ `auto_banned` NU E UN BAN.** Efectul lui e strict: `UserSettings.profile_hidden = True` → profilul **iese din feed**. Contul raportat **se poate încă loga** și își poate folosi chat-urile. Nu se atinge `User.banned_at`, nu se revocă nicio sesiune.

**Banul adevărat** (login refuzat + `403` pe orice rută + **sesiuni de refresh revocate**) se dă **doar din admin**: `POST /api/v1/admin/users/{id}/ban`.

**De ce `auto_banned` rămâne ÎN COADĂ** (mapat la `open` în API-ul de admin): auto-ascunderea e o măsură automată **temporară**, luată pe un semnal statistic (3 oameni s-au plâns), nu o decizie finală. DSA cere ca raportările de conținut abuziv să fie tratate de un **om** în ≤24h. Dacă `auto_banned` ar fi o stare finală, coada de moderare ar fi goală exact pentru cazurile cele mai grave.

---

## 11. Subscription (`app/models/billing.py`)

Abonament de monetizare (TZ 9). Un rând per abonament al userului.

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → User | proprietarul (indexat) |
| `plan` | `String(32)` NOT NULL | `premium` / `no_ads` / `ai_bot` / `all_inclusive` |
| `status` | `String(16)` | `active` / `canceled` / `expired` (implicit `active`) |
| `provider` | `String(16)` NOT NULL | `stub` / `stripe` / `app_store` / `play` |
| `expires_at` | `timestamptz` NULL | ciclu de 30 de zile |

> **Validarea de receipt e implementată pe backend** (App Store `verifyReceipt` + Stripe checkout session), dar **`PurchaseIn` nu transportă receipt-ul** — deci cu un provider live achiziția întoarce `402`. Vezi [`api-spec.md`, secțiunea 12](./api-spec.md#12-subscriptions-). Un abonament poate fi **acordat manual** din admin (`POST /admin/subscriptions`), cu intrare în jurnalul de audit.

---

## 12. PushDevice (`app/models/device.py`)

Token de notificare push per dispozitiv (TZ 6.3). Trimiterea e abstractizată (`StubPush`, gata de Expo/FCM/APNs).

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → User | proprietarul (indexat) |
| `token` | `String(255)` NOT NULL | token Expo/FCM, opac pentru backend |
| `platform` | `String(16)` NOT NULL | `ios` / `android` |

`UniqueConstraint(user_id, token)` — upsert idempotent la re-înregistrare.

---

## 13. AdminAuditLog (`app/models/admin.py`) 🆕

Jurnalul de audit al panoului de administrare. **Append-only.**

| Câmp | Tip | Note |
|---|---|---|
| `id` | `uuid` PK | |
| `actor_id` | `uuid` FK → User, **`ON DELETE SET NULL`** | adminul care a executat acțiunea |
| `actor_email` | `String(255)` NOT NULL | **denormalizat intenționat** |
| `action` | `String(64)` NOT NULL, indexat | `admin.login`, `user.ban`, `user.unban`, `user.hide`, `user.delete`, `report.resolve`, `event.create`, `event.update`, `event.delete`, `subscription.grant`, `subscription.revoke` |
| `target_type` | `String(32)` NULL | `user` \| `report` \| `event` \| `subscription` |
| `target_id` | `uuid` NULL, **FĂRĂ FK** | id-ul entității afectate |
| `meta` | `JSON` NOT NULL | contextul deciziei (motiv, plan, câmpuri modificate). **Niciodată secrete** |
| `ip` | `String(64)` NULL | IP-ul cererii (respectă `X-Forwarded-For` prin reverse proxy) |

**Indexuri:** `ix_admin_audit_created` (listarea e mereu „cele mai noi întâi", paginat pe cursor) și `ix_admin_audit_target` pe `(target_type, target_id)` („ce s-a făcut cu userul X").

### De ce fiecare decizie de proiectare

| Decizie | DE CE |
|---|---|
| **Există** | Un admin poate bana, ascunde și **ȘTERGE** conturi (GDPR, ireversibil), poate acorda abonamente, poate crea evenimente. Fără jurnal, o acțiune distructivă nu are autor, nu are moment și nu are motiv — nici pentru o anchetă internă (cont de admin compromis), nici pentru un audit extern (GDPR art. 5(2), principiul responsabilității) |
| Scris în **aceeași tranzacție** cu acțiunea | Dacă acțiunea eșuează, nu rămâne o intrare fantomă. Dacă jurnalul eșuează, **acțiunea nu se comite** |
| **Append-only** | Nu există niciun endpoint de ștergere sau editare. Un jurnal editabil de cel pe care îl auditează nu e un jurnal |
| `actor_id` cu **`SET NULL`**, nu `CASCADE` | Ștergerea unui cont de admin **nu are voie** să șteargă istoria acțiunilor lui. Altfel, „șterge-ți contul" ar fi butonul de curățat urmele |
| `actor_email` **denormalizat** | Ca jurnalul să rămână **lizibil** după ce contul de admin dispare (`actor_id` devine `NULL`, dar rândul spune încă *cine* a fost) |
| `target_id` **fără FK** | Ținta poate fi **ȘTEARSĂ chiar de acțiunea auditată** (`user.delete`). Un FK ar face imposibilă tocmai înregistrarea ștergerii |
| `meta` fără secrete | Niciodată parole, hash-uri, tokenuri — doar parametrii deciziei |

---

## Compatibility Score (✅ calculat, în feed)

Formula din **TZ 4.6**, implementată în `services/compatibility.py` — **funcție pură, fără I/O**. Ponderile trăiesc în `core/config.py` și însumează `1.0`:

| Factor | Pondere | Config | Cum se calculează |
|---|---|---|---|
| Interese | **30%** | `compat_w_interests` | **Jaccard** pe slug-urile de interese: `\|A∩B\| / \|A∪B\|` |
| Profil de umor | **20%** | `compat_w_humor` | **Cosine similarity** pe `Profile.humor_vector` (7 tipuri de umor), aliniat pe cheile comune. Vector lipsă la vreunul → **0.5 neutru** |
| Status cunoștință | **15%** | `compat_w_status` | Jaccard pe `dating_statuses` |
| **Distanță** | **15%** | `compat_w_distance` | **`scor = 1 − (km / 300)`**, plafonat în `[0, 1]` |
| Limbi comune | **10%** | `compat_w_languages` | **GATE DUR**: zero limbi comune → **scor 0** pe acest factor. Cu ≥1 comună: `\|comune\| / min(\|A\|, \|B\|)`, plafonat la 1.0 |
| Comportament | **10%** | `compat_w_behavior` | ⚠️ **constantă `0.5`** — istoricul comportamental **nu e încă implementat** |

Rezultatul e normalizat la `0–100` și servit **inline** în fiecare `FeedCard` (câmpul `compatibility`). Culoare badge (TZ 4.2): `>80` verde, `50–80` galben, `<50` gri. **Nu există endpoint `/compatibility` separat.**

### Distanța — de la binar la REAL

`compat_distance_decay_km = 300` · `compat_distance_neutral = 0.5`

```
d = 0 km      → 1.0
d = 150 km    → 0.5
d ≥ 300 km    → 0.0
d = necunoscut → 0.5  (neutru: nu penalizăm, nu premiem)
```

**⚠️ Înainte factorul era BINAR:** același oraș = `1.0`, alt oraș = `0.4`. Adică **Chișinău↔Bălți (~127 km) și Chișinău↔Moscova (~1100 km) primeau EXACT același scor de distanță** (`0.4`). Acum funcția e strict descrescătoare în `d`: mai aproape ⇒ scor mai mare, cum ar fi trebuit să fie de la început.

`distance_km = None` (oraș negeocodabil, provider indisponibil) ⇒ `compat_distance_neutral`. Nu penalizăm și nu premiem un candidat pentru care pur și simplu **nu știm**.

### Onestitate: ce e încă placeholder
- **Comportamentul (10%)** — constantă `0.5` pentru **toată lumea**. Practic factorul e azi un offset fix de `+5 puncte` pe scorul final, nu un semnal. Devine real când există istoric de swipe/chat.
- **Umorul**, când vectorul lipsește la cel puțin unul dintre profiluri — `0.5` neutru (nu `0`: absența testului nu e o incompatibilitate).

---

## Geo — fără PostGIS, dar distanța e reală

**Nu se folosește PostGIS/GiST.** Coordonatele sunt `Float` simple (`Profile.lat`/`lng`, `Event.lat`/`lng`), portabile între Postgres și SQLite (testele rulează pe SQLite in-memory).

Filtrarea pe rază se face în **două trepte**:

1. **În SQL — bounding-box.** Din `(lat, lng, radius_km)` se calculează un dreptunghi `[min_lat, max_lat] × [min_lng, max_lng]` (`geo.bounding_box`), aplicat ca predicat pe **indexul compus `ix_profiles_lat_lng`**. Rapid, dar e un **pătrat**: un superset al cercului (colțurile sunt mai departe decât raza).
2. **În Python — haversine exact.** Peste fereastra retrievată, `geo.haversine_km` taie exact pe cerc. Zero apeluri de rețea (coordonatele sunt deja persistate).

Un `WHERE haversine(...) < r` direct în SQL ar fi corect, dar **nu ar putea folosi niciun index** — ar face seq scan pe tot tabelul. Bounding-box-ul e ce face filtrul geografic *SARGable*.

---

# 🔜 Planificat / ❌ Amânat

| Tabel / element | Rol | Stare |
|---|---|---|
| **Photo** (tabel dedicat) | Foto cu poziție + badge verificat (TZ 2.4) | 🔜 Pozele sunt `Profile.photos` (JSON), gestionate prin `/profiles/photos*` peste storage. Tabelul dedicat rămâne **opțional** |
| **HumorProfile** (tabel dedicat) | Vector separat + rafinare NLP din conversații (TZ 5.4) | 🔜 Vectorul e `Profile.humor_vector` (JSON), populat de `/humor/*` (✅). **Rafinarea NLP** e planificată |
| **PostGIS / GiST** pe `location` | Interogări geo native | ❌ Nu e nevoie: `Float` + bounding-box + haversine acoperă cazul, portabil pe SQLite |
| **pgvector** pe `humor_vector` | Similaritate vectorială în DB | ❌ 7 dimensiuni — cosine în Python e suficient |
| Câmpuri User: `phone`, `apple_sub`/`google_sub`, `status`, `verification_status`, `deleted_at` | | 🔜 Auth social/OTP funcționează prin get-or-create pe email, fără coloane dedicate. `date_of_birth` e intenționat pe **Profile** (`birth_date`) |
| Pe Chat/Message: `chemistry_score`, `last_message_at`, `archived_by`, `type` | | 🔜 |
| Pe Ticket: `status`/`redeemed_at` · pe Stamp: `method` (qr/geo) · pe Event: `source`/`moderation_status` | | 🔜 |
| Semnal **comportamental** pentru Compatibility Score | | 🔜 Azi constantă `0.5` |

> **Ce NU mai e planificat — EXISTĂ:**
> - **Coada de moderare manuală** → `GET /admin/reports` + `POST /admin/reports/{id}/resolve` ✅
> - **CRUD evenimente** → `/admin/events` (GET/POST/PUT/DELETE) ✅ — singura cale de a crea un eveniment
> - **Verificare facială** → `POST /profiles/verify-face`, cu **AWS Rekognition** ✅ pe backend (❌ captura pe mobil e amânată)
> - **`role` pe User** → există, indexat, citit din DB la fiecare cerere ✅
> - **Ban real + audit log** → `banned_at`/`ban_reason` + `admin_audit_logs` ✅
> - **Preferințe de căutare (gen/vârstă/rază)** → `UserSettings.interested_in`/`age_min`/`age_max`/`search_radius_km` ✅
