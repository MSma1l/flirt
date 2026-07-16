# FLIRT — Panoul de administrare (backend)

> Arhitectura API-ului de administrare (`/api/v1/admin/*`): de ce există, cum e protejat, ce garanții oferă și cum se creează primul cont de admin.
> Specificația completă a rutelor este în [`api.md`](./api.md).

Documente conexe:
- [`api.md`](./api.md) — specificația rutelor `/api/v1/admin/*` (21 rute).
- [`frontend.md`](./frontend.md) — **SPA-ul React + Vite**: pagini, autentificare, build, servire.
- [`../backend/README.md`](../backend/README.md) — arhitectura generală a backend-ului.
- [`../backend/security.md`](../backend/security.md) — autentificare, JWT, sesiuni.
- [`../backend/api-spec.md`](../backend/api-spec.md) — API-ul public (mobil).

---

## Cuprins

1. [De ce există panoul](#1-de-ce-există-panoul)
2. [Cum se creează primul cont de admin](#2-cum-se-creează-primul-cont-de-admin)
3. [Modelul de securitate](#3-modelul-de-securitate)
4. [Jurnalul de audit](#4-jurnalul-de-audit)
5. [Structura codului](#5-structura-codului)
6. [Performanță: totul e agregat în SQL](#6-performanță-totul-e-agregat-în-sql)
7. [Ce NU face panoul](#7-ce-nu-face-panoul)

---

## 1. De ce există panoul

Panoul nu e un „nice to have". Rezolvă trei probleme care blochează lansarea:

### a) Moderarea — cerință App Store, nu preferință

Apple **Guideline 1.2 (User-Generated Content)** cere ca o aplicație cu conținut generat de utilizatori să aibă un mecanism de raportare **și un răspuns în ≤24h**. Până acum, `POST /reports` scria rânduri în tabela `reports` pe care **nu le citea nimeni, niciodată** — nu exista nicio interfață prin care un om să vadă o reclamație. Cerința era imposibil de îndeplinit, nu doar neîndeplinită.

Coada de moderare (`GET /admin/reports`) e sortată cu **rapoartele în așteptare primele**. Nu e cosmetică: într-o coadă strict cronologică, un raport nerezolvat de acum trei zile ajunge la pagina 4, împins de rapoartele deja rezolvate de ieri — exact cazul pe care SLA-ul de 24h îl interzice.

### b) Evenimentele — un gol funcțional real

`POST /events` **nu există** în API-ul public, iar seed-ul demo (`event_service.seed_events`) se oprește explicit când `environment == "production"`. Concluzia: **producția nu avea nicio cale de a crea un eveniment.** Secțiunea „Evenimente" s-ar fi lansat goală și ar fi rămas goală. `POST /admin/events` e singura cale prin care un eveniment real ajunge în baza de producție.

### c) Suportul — ban, deblocare, ștergere GDPR, compensații

Fără panou, orice intervenție operațională (un spammer de banat, un cont de șters la cererea userului, o compensație de acordat) însemna `psql` pe baza de producție, manual, fără urmă și fără plasă de siguranță.

---

## 2. Cum se creează primul cont de admin

**Problema oului și a găinii:** toate rutele `/admin/*` cer rolul `admin`, iar rolul `admin` se acordă doar... din panou. Într-o bază proaspătă de producție nu există niciun administrator ⇒ nimeni nu se poate loga ⇒ nimeni nu poate promova pe nimeni. Fără o cale de bootstrap, panoul e **inaccesibil pentru totdeauna** după deploy.

Calea e un script rulat manual, din interiorul mașinii/containerului:

```bash
# Interactiv (recomandat) — parola se cere la terminal, cu ecoul oprit:
python scripts/create_admin.py admin@flrt.md

# Neinteractiv (CI / provisioning) — parola dintr-o variabilă de mediu:
ADMIN_PASSWORD='...' python scripts/create_admin.py admin@flrt.md --from-env

# În Docker:
docker compose exec api python scripts/create_admin.py admin@flrt.md

# Am pierdut parola de admin:
python scripts/create_admin.py admin@flrt.md --reset-password
```

**De ce un script și nu un endpoint „primul user devine admin":** e o cursă clasică. Dacă cineva nimerește instanța înaintea ta — sau baza e resetată din greșeală — primul care se înregistrează devine administratorul **producției**. Un script cere acces la infrastructură, adică exact garanția pe care o vrem.

**De ce parola nu se dă ca argument:** `--password X` ar ajunge în istoricul shell-ului, în `ps aux` (vizibil oricărui user de pe mașină) și în log-urile orchestratorului. Scriptul o citește cu `getpass` sau dintr-o variabilă de mediu.

**Proprietăți:** idempotent (re-rularea promovează un cont existent, nu strică nimic), cere parole de minim 12 caractere cu literă mare + cifră (mai strict decât la un user obișnuit — aici nu există „doar contul meu"), și ridică automat un eventual ban de pe contul promovat (altfel `require_admin` l-ar respinge cu un 403 inexplicabil după un script „reușit").

---

## 3. Modelul de securitate

### Poarta de acces se pune pe ROUTER, nu pe rută

```python
# app/api/v1/admin/__init__.py
_admin_only = [Depends(require_admin)]

router.include_router(auth.router)                              # /admin/login — public
router.include_router(stats.router, dependencies=_admin_only)   # tot restul: protejat
router.include_router(users.router, dependencies=_admin_only)
...
```

Apărarea „ține minte să adaugi dependency-ul pe fiecare handler" funcționează exact până când cineva adaugă a 21-a rută într-o vineri seara. O rută de admin uitată **nu dă eroare, nu pică niciun test scris înainte de ea și nu se vede în code review** — pur și simplu servește date de moderare oricui are un token valid de utilizator obișnuit. Aplicată pe router, o rută nouă e protejată **prin construcție**: trebuie să te străduiești ca să o expui, nu ca să o aperi.

Testul de securitate merge mai departe: lista rutelor verificate **nu e scrisă de mână**, ci derivată din OpenAPI-ul aplicației. O rută adăugată mâine e testată automat, fără să-și amintească nimeni să o adauge în test.

### Contractul de răspunsuri

| Situație | Cod |
|---|---|
| Fără token / token invalid / expirat / `alg=none` | `401` |
| Token valid de **user obișnuit** | `403` |
| Token valid de **admin banat** | `403` |
| Rol retras între două cereri | `403` **imediat** |
| Admin valid | `200` |

**Revocarea e instantanee** pentru că rolul se citește **din DB la fiecare cerere**, nu dintr-un claim din JWT. Dacă rolul ar fi fost în token, un admin demis ar fi rămas admin până la expirarea lui — o fereastră de 15 minute în care un om căruia tocmai i-ai retras drepturile le mai are.

### Banul e real, nu un flag

Un „ban" care setează doar `banned_at` e teatru de securitate. Banul complet face **trei** lucruri, în aceeași tranzacție:

1. **`banned_at` + motiv** → login refuzat (`auth_service`), orice cerere autentificată respinsă cu 403 (`get_current_user` verifică DB-ul);
2. **revocarea sesiunilor de refresh** → refresh token-ul devine inutilizabil **acum**. Fără asta, access token-ul expiră în 15 minute, dar refresh token-ul e o creanță de **7 zile**: un cont banat care poate roti refresh-ul continuă să folosească aplicația o săptămână;
3. **`profile_hidden`** → profilul dispare din feed-ul celorlalți.

### Zero secrete în răspunsuri

Schemele Pydantic din `app/schemas/admin.py` enumeră **explicit** fiecare câmp expus — niciun `from_attributes` peste un model ORM întreg. `User` are `password_hash`, `RefreshSession` are `token_hash`: o schemă care serializează modelul „în bloc" ar trimite hash-urile în JSON-ul panoului, de acolo în cache-ul browserului, în log-urile proxy-ului și în orice screenshot făcut de suport.

Testul caută în **JSON-ul brut**, nu în câmpuri anume — și caută **valoarea reală** a hash-ului din DB, nu doar numele câmpului: o scurgere sub alt nume nu ar fi prinsă de o listă de chei interzise.

### Protecții de input

- **Plafoane de paginare** — `?limit=999999` primește `422` **înainte** de a atinge baza. Un cont de admin compromis nu are voie să ceară „toate cele 2 milioane de rânduri".
- **Fără SQL prin string formatting** — numele, bio-urile și textele de căutare vin de la utilizatori și ajung în `WHERE`-uri. Totul e parametru legat; `%` și `_` dintr-un termen de căutare sunt **escapate explicit** (fără asta, o căutare de `%` întoarce toată tabela — un DoS declanșat dintr-un câmp de căutare).
- **Metricile de timeseries** vin dintr-un dicționar-allowlist de coloane, niciodată interpolate.
- **Anti-XSS stocat** — textele scrise din panou (motive de ban, descrieri de evenimente) trec prin validatorii proiectului: fără HTML, fără caractere de control.
- **Rate limit pe login-ul de admin** — `rate_limit_admin_login_per_min` (3/min) vs 5/min la login-ul obișnuit, pe un bucket separat. Numărul de admini e mic și cunoscut, deci un prag mic nu deranjează pe nimeni legitim — dar fereastra de brute-force pe conturile cele mai valoroase trebuie să fie cât mai îngustă.
- **Auto-lockout imposibil** — un admin nu se poate bana și nu se poate șterge pe sine (`400`).

---

## 4. Jurnalul de audit

**Orice** acțiune care schimbă starea scrie în `AdminAuditLog`: ban, unban, ștergere, rezolvare de raport, creare/editare/ștergere de eveniment, acordare de abonament, autentificare de admin. Fără excepții, fără „acțiuni mici" nelogate.

| Câmp | Rol |
|---|---|
| `actor_id`, `actor_email` | Cine. `actor_email` e **denormalizat** ca urma să rămână lizibilă chiar dacă adminul își șterge contul (`actor_id` are `ON DELETE SET NULL`, nu CASCADE). |
| `action` | Ce (`user.ban`, `report.resolve`, `event.create`, …). |
| `target_type`, `target_id` | Asupra cui. `target_id` e un UUID **fără cheie externă**: ținta poate fi ștearsă chiar de acțiunea auditată (`user.delete`), iar un FK ar fi făcut imposibilă tocmai înregistrarea ștergerii. |
| `meta` | Parametrii deciziei (motiv, plan, câmpuri modificate). **Niciodată secrete.** |
| `ip` | De unde (respectă `X-Forwarded-For` — același helper ca rate-limiting-ul, ca să nu logăm IP-ul lui nginx). |

**Append-only prin construcție:** nu există rută de ștergere sau editare a jurnalului, iar singurul cod care scrie în tabelă e `admin_service.audit()`. Un jurnal pe care adminul suspect îl poate curăța nu e un jurnal, e o decorațiune — exact persoana pe care ar trebui să o incrimineze e cea care ar avea acces să îl golească.

Auditul se scrie **în aceeași tranzacție** cu acțiunea: dacă acțiunea eșuează nu rămâne o intrare fantomă; dacă jurnalul eșuează, acțiunea nu se comite.

---

## 5. Structura codului

```
backend/app/
  api/v1/admin/
    __init__.py        # agregatorul + poarta `require_admin` pe fiecare sub-router
    auth.py            # POST /admin/login (SINGURA rută publică; rate limit strict)
    stats.py           # GET /admin/me, /stats, /stats/timeseries[/{metric}]
    users.py           # listare, detalii, ban, unban, ștergere GDPR, rapoarte/user
    moderation.py      # coada de rapoarte + rezolvare
    events.py          # CRUD evenimente (golul funcțional)
    subscriptions.py   # listare + acordare manuală
    audit.py           # GET /admin/audit-log (doar citire)
  services/
    admin_service.py   # TOATĂ logica: agregate SQL, audit, ban, moderare, CRUD
  schemas/
    admin.py           # DTO-uri explicite — niciun secret expus
  models/
    admin.py           # AdminAuditLog (append-only)
backend/scripts/
    create_admin.py    # bootstrap-ul primului admin
```

Codul respectă separarea pe straturi a proiectului: **rutele** nu conțin logică de business, **serviciul** nu știe despre HTTP, **schemele** nu ating DB-ul.

Reutilizări deliberate (nu rescrieri):
- **paginarea** — cursorul opac + `X-Next-Cursor` din `services/pagination.py` (aceeași convenție ca `/feed`, `/chats`, `/events`);
- **ștergerea GDPR** — `account_service.purge_user_data`, exact funcția pe care o rulează și cron-ul de purjare. Două implementări ale ștergerii GDPR ar diverge, iar cea uitată ar lăsa date personale în urmă;
- **prețurile** — din `settings` prin catalogul `billing`, zero hardcodare;
- **IP-ul clientului** — `core/ratelimit.client_ip`, ca auditul și rate-limiting-ul să vadă același IP în spatele proxy-ului.

---

## 6. Performanță: totul e agregat în SQL

Proiectul a plătit deja lecția N+1 pe `GET /chats` (**604 query-uri → 6**). Panoul nu o repetă:

- **`GET /admin/stats`** execută un număr **constant** (~11) de query-uri agregate — `COUNT` / `SUM(CASE …)` / `GROUP BY` — indiferent dacă baza are 100 sau 10.000.000 de rânduri. Un dashboard care ar face `select(User)` și ar număra în Python ar încărca toată tabela `users` în memoria procesului la fiecare refresh, devenind cel mai scump endpoint al aplicației — și ar cădea exact când produsul merge bine. Există un test de regresie care numără efectiv statement-urile SQL și cade dacă numărul crește cu volumul datelor.
- **Listările** aduc profilurile, contoarele și raportorii cu `WHERE … IN (:page_ids)` — un query pentru toată pagina, nu unul per rând.
- **Rapoartele** vin cu profilul raportat deja alăturat (`reported`), ca panoul să nu facă un fetch per rând — adică N+1-ul mutat în client.

---

## 7. Ce NU face panoul

Limite conștiente, ca să nu existe surprize:

- **Nu are RBAC granular.** Există `user` și `admin`, atât. Coloana `role` e TEXT (nu un boolean `is_admin`) tocmai ca adăugarea unui rol nou (`moderator`, `support`) să fie o migrație de **date**, nu o rescriere a modelului.
- **Nu editează profilurile userilor.** Un admin poate ascunde, bana sau șterge un cont — nu îi poate rescrie bio-ul. Puterea de a modifica conținutul cuiva fără urmă vizibilă pentru el e o putere pe care un panou de moderare nu trebuie să o aibă.
- **Nu citește conversațiile private.** Statisticile numără mesajele; nu le arată. Rapoartele pot referi un `chat_id`, dar corpul mesajelor nu e expus prin API-ul de admin.
- **Nu șterge din jurnalul de audit.** Prin construcție (vezi secțiunea 4).
- **Venitul e o estimare, nu contabilitate.** `Σ(abonamente active × prețul planului din config)` — fără proration, taxe sau refund-uri.
