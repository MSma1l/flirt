# Deployment — de la server gol la `api.flrt.md` live

Backend-ul FLIRT (FastAPI + Postgres + Redis + nginx/TLS) și panoul de admin.
Aplicația mobilă e separată și nu face parte din acest stack.

**Deploy-ul, în întregime:**

```bash
cd /opt/flirt && git pull
cd backend && docker compose up --build -d
```

Atât. Migrațiile rulează singure, certificatul TLS se emite singur, panoul de admin
se construiește singur. Singurul pas manual e completarea fișierului `.env` — **o
singură dată, înainte de primul deploy** (secțiunea 3).

---

## 0. Ce rulează, de fapt

| Serviciu      | Rol                                                                   | Expus public   |
|---------------|-----------------------------------------------------------------------|----------------|
| `nginx`       | TLS (443), redirect 80→443, rate limiting la margine, reverse proxy    | **da** (80,443)|
| `api`         | FastAPI pe gunicorn (4 workeri uvicorn); rulează migrațiile la pornire | nu (prin nginx)|
| `db`          | Postgres 16, volum `pgdata`                                            | **nu**         |
| `redis`       | rate limiting partajat între workeri + store OTP                       | **nu**         |
| `certbot`     | emite **și** reînnoiește certificatul Let's Encrypt, automat           | nu             |
| `admin-build` | construiește panoul de admin (`admin/`) și îl publică pentru nginx     | nu             |
| `purge`       | purjare GDPR (conturi cu grația expirată)                              | nu             |
| `backup`      | `pg_dump` periodic + retenție                                          | nu             |

**Postgres și Redis nu au niciun port publicat pe host** — trăiesc exclusiv în
rețeaua internă Docker. Un Redis expus pe internet e preluat în minute (nu are
autentificare implicită, iar `CONFIG SET` duce la execuție de cod pe server).
Singura ușă către exterior e nginx.

### Cele două domenii

| Nume             | Ce servește                                  |
|------------------|----------------------------------------------|
| `api.flrt.md`   | API-ul (aplicația mobilă vorbește doar aici) |
| `admin-flirt-paty.flrt.md` | panoul de admin (SPA static, build Vite)     |

Ambele stau pe **același server, același nginx, același certificat** (un singur
certificat Let's Encrypt cu ambele nume în SAN).

---

## 1. Cerințe de server

Estimare onestă, pe baza a ce rulează efectiv (Postgres + Redis + 4 workeri
gunicorn + nginx + 2 procese auxiliare + daemonul Docker):

| Resursă | Minim (merge, dar strâmt)     | **Recomandat**            | De ce                                                                                                        |
|---------|-------------------------------|---------------------------|--------------------------------------------------------------------------------------------------------------|
| RAM     | 2 GB **+ 2 GB swap**          | **4 GB**                  | 4 workeri gunicorn ≈ 800 MB–1 GB (boto3/httpx sunt grei), Postgres ≈ 250 MB, restul ≈ 250 MB, Docker+OS ≈ 400 MB. La 2 GB **build-ul** (pip + `npm run build` pentru admin) e cel care te omoară, nu rularea — de aici swap-ul. |
| CPU     | 1 vCPU                        | **2 vCPU**                | `WEB_CONCURRENCY=4` presupune ~2 vCPU (regula: 2 × vCPU + 1). Cu 1 vCPU, scade la `WEB_CONCURRENCY=2`.         |
| Disk    | 25 GB SSD                     | **40 GB SSD**             | imagini Docker ≈ 2–3 GB, Postgres crește cu userii, backup-uri = 14 × dump zilnic. **Fotografiile NU stau pe disc** (merg în S3), deci DB-ul rămâne mic mult timp. |
| Rețea   | IP public, porturi 80+443     | idem                      | Portul **80 e obligatoriu**: fără el Let's Encrypt nu poate valida domeniul (HTTP-01) și rămâi fără certificat.|

Un VPS de ~5–8 €/lună (2 vCPU / 4 GB — Hetzner CX22, Contabo, DigitalOcean) e
suficient pentru primii utilizatori. Ce cedează primul, la creștere: **Postgres**
(mută-l pe o instanță gestionată) și **RAM-ul** (crește `WEB_CONCURRENCY` doar
odată cu vCPU-urile).

Software: Ubuntu 22.04/24.04, Docker Engine + plugin `docker compose` (v2).
`scripts/bootstrap_server.sh` le instalează singur.

---

## 2. DNS (înainte de orice)

Creează **două** înregistrări `A` către IP-ul serverului:

| Tip | Nume                | Domeniul rezultat            | TTL |
|-----|---------------------|------------------------------|-----|
| A   | `api`               | `api.flrt.md`                | 300 |
| A   | `admin-flirt-paty`  | `admin-flirt-paty.flrt.md`   | 300 |

(La registrarul lui `flrt.md`. Dacă serverul are IPv6, adaugă și `AAAA`.)

> Atenție la al doilea nume: e `admin-flirt-paty`, **nu** `admin`. Trebuie să corespundă exact
> cu `ADMIN_DOMAIN` din `.env` — nginx randează `server_name` din acea variabilă, iar certbot
> cere certificatul pentru exact acel nume. Un `A` pe `admin` ar lăsa panoul inaccesibil și
> certificatul fără al doilea SAN.

```bash
# check — ambele TREBUIE să întoarcă IP-ul serverului
dig +short api.flrt.md
dig +short admin-flirt-paty.flrt.md
```

> Fără DNS corect, Let's Encrypt **nu poate** emite certificatul, iar aplicația
> mobilă nu se poate conecta (iOS refuză certificatele self-signed). Dacă DNS-ul
> pentru `admin` întârzie, nu-i nimic: certbot emite certificatul doar pentru
> `api.flrt.md` și adaugă `admin` automat la un ciclu următor.

---

## 3. `.env` — singurul pas manual

```bash
cd backend
cp .env.production.example .env
chmod 600 .env
nano .env        # completează tot ce e marcat cu  <<< COMPLETEAZĂ >>>
```

`.env.production.example` conține **toate** variabilele cerute de guardul de
producție (`app/core/config.py`), fiecare cu explicație și cu URL-ul de unde se ia
cheia. Rezumat al valorilor pe care **trebuie** să le pui tu:

| Variabilă                                      | De unde o iei                                                          |
|------------------------------------------------|------------------------------------------------------------------------|
| `POSTGRES_PASSWORD`                            | `openssl rand -base64 32` (bootstrap-ul o generează singur)            |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`           | `openssl genrsa` — vezi mai jos (bootstrap-ul le generează singur)     |
| `CERTBOT_EMAIL`                                | email real al tău (avertizări de expirare)                             |
| `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | consola AWS (S3 + IAM). Aceleași chei servesc și verificarea facială (Rekognition) |
| `GEO_USER_AGENT`                               | pune un **email real** — Nominatim/OSM blochează valoarea implicită     |
| `GOOGLE_CLIENT_ID` / `APPLE_CLIENT_ID`         | Google Cloud Console / Apple Developer (Sign in with Apple)            |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | consola Twilio (SMS-urile OTP costă bani per mesaj)           |
| `APP_STORE_SHARED_SECRET`                      | App Store Connect → App Information → App-Specific Shared Secret       |

Deja completate corect în șablon (nu le schimba fără motiv): `DOMAIN=api.flrt.md`,
`ADMIN_DOMAIN=admin-flirt-paty.flrt.md`, `CORS_ORIGINS=https://admin-flirt-paty.flrt.md`,
`REDIS_URL=redis://redis:6379/0`, `ENVIRONMENT=production`, `DEBUG=false`,
`GEO_PROVIDER=nominatim` (gratuit, fără cheie), `PUSH_PROVIDER=expo` (fără cheie).

### Cheile JWT (RS256)

Se generează **pe server**; cheia privată nu pleacă niciodată de acolo.

```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem

# generează exact liniile de lipit în .env (PEM pe o linie, cu \n literal)
echo "JWT_PRIVATE_KEY=$(awk '{printf "%s\\n", $0}' private.pem)"
echo "JWT_PUBLIC_KEY=$(awk  '{printf "%s\\n", $0}' public.pem)"
```

> Rotația cheii invalidează **toate** tokenurile emise (toți userii se reloghează).

### Check

```bash
make config      # sau: docker compose run --rm --no-deps api \
                 #        python -c "from app.core.config import Settings; Settings(); print('OK')"
```

Dacă lipsește ceva, primești o listă explicită de probleme, nu o pornire tăcută.
Iar dacă ai uitat un `<<< COMPLETEAZĂ >>>` în `.env`, containerul `api` refuză să
pornească și îți spune exact care variabilă e necompletată.

---

## 4. Pornirea

```bash
docker compose up --build -d
```

Ce se întâmplă, în ordine, **fără intervenția ta**:

1. `db` și `redis` pornesc și devin healthy.
2. `api` rulează `alembic upgrade head` (migrațiile) și abia apoi pornește gunicorn.
   Dacă migrațiile eșuează, containerul **nu** servește trafic cu o schemă necunoscută.
3. `nginx` randează configul cu `DOMAIN`/`ADMIN_DOMAIN` din `.env`, își generează un
   certificat **self-signed** temporar (ca să poată porni deloc) și începe să servească
   provocarea ACME pe portul 80.
4. `certbot` cere certificatul **real** pentru `api.flrt.md` + `admin-flirt-paty.flrt.md`.
5. `nginx` observă certificatul nou (verifică din minut în minut) și dă `reload`.
   **Fără downtime.** De aici încolo, TLS-ul e real.
6. `admin-build` construiește panoul de admin din `admin/` și îl publică. Dacă
   folderul nu există sau build-ul pică, **backend-ul nu e afectat** — se servește
   o pagină explicativă pe `admin-flirt-paty.flrt.md`, iar API-ul merge normal.

Prima pornire durează câteva minute (build-uri + emiterea certificatului).

```bash
docker compose ps         # toate 'running'; `api` → 'healthy'; `admin-build` → 'exited (0)'
docker compose logs -f certbot   # urmărește emiterea certificatului
```

### Dacă certificatul nu apare

Aproape întotdeauna e DNS-ul sau firewall-ul:

```bash
docker compose logs certbot | tail -30
dig +short api.flrt.md          # arată IP-ul ACESTUI server?
curl -I http://api.flrt.md/.well-known/acme-challenge/test   # portul 80 e accesibil din afară?
```

Certbot reîncearcă singur la fiecare oră. Dacă vrei să forțezi acum, după ce ai
reparat DNS-ul, o singură comandă:

```bash
docker compose restart certbot
```

### Primul cont de admin — obligatoriu, altfel panoul e inaccesibil

Toate rutele `/admin/*` cer rolul `admin`, iar rolul `admin` se acordă doar... din panou.
Într-o bază proaspătă **nu există niciun administrator** ⇒ nimeni nu se poate loga ⇒ nimeni nu
poate promova pe nimeni. Fără acest pas, panoul rămâne **inaccesibil pentru totdeauna**.

```bash
docker compose exec api python scripts/create_admin.py admin@flrt.md
# parola se cere la terminal, cu ecoul oprit (min. 12 caractere, literă mare + cifră)
```

Idempotent: re-rularea promovează un cont existent. Ai pierdut parola?
`... create_admin.py admin@flrt.md --reset-password`.

> **De ce un script și nu „primul user care se înregistrează devine admin":** e o cursă clasică.
> Dacă cineva nimerește instanța înaintea ta, devine administratorul **producției**. Un script
> cere acces la infrastructură — exact garanția pe care o vrem.

---

## 5. Verificarea că merge cu adevărat

```bash
# 1. liveness + certificat REAL (fără -k! dacă merge fără -k, TLS-ul e valid)
curl -I https://api.flrt.md/health

# 2. readiness REAL (SELECT 1 pe Postgres + PING pe Redis)
curl -s https://api.flrt.md/health/ready
# → {"status":"ready","checks":{"database":"ok","redis":"ok"}}

# 3. redirect + HSTS
curl -I http://api.flrt.md/health | grep -i location          # → https://...
curl -sI https://api.flrt.md/health | grep -i strict-transport-security

# 4. emitentul certificatului (trebuie Let's Encrypt, NU self-signed)
echo | openssl s_client -connect api.flrt.md:443 -servername api.flrt.md 2>/dev/null \
  | openssl x509 -noout -issuer -dates

# 5. cu DB oprit, readiness TREBUIE să dea 503 (nu 200)
docker compose stop db
curl -s -o /dev/null -w '%{http_code}\n' https://api.flrt.md/health/ready   # → 503
docker compose start db

# 6. rate limiting partajat: al 6-lea login greșit într-un minut → 429
for i in $(seq 1 6); do
  curl -s -o /dev/null -w '%{http_code} ' -X POST https://api.flrt.md/api/v1/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"nobody@example.com","password":"wrong-password"}'
done; echo

# 7. panoul de admin
curl -I https://admin-flirt-paty.flrt.md/                 # → 200
curl -I https://admin-flirt-paty.flrt.md/users            # → 200 (fallback SPA, nu 404)

# 8. serverul NU răspunde pe Host necunoscut (scanere pe IP brut)
curl -sk -o /dev/null -w '%{http_code}\n' https://<IP-ul-serverului>/    # → conexiune închisă (444)
```

Sau, scurt: `make check`.

### ✅ Ce a fost validat efectiv pe stiva reală

Nu pe SQLite și nu „în teorie" — pe **Docker + Postgres 16 + Redis 7 + nginx**, rulând împreună:

| Verificare | Rezultat |
|---|---|
| Migrațiile rulează automat la pornire (`alembic upgrade head` în `entrypoint.sh`) | ✔ |
| `/health/ready` întoarce **503** cu `db` oprit (nu 200) | ✔ |
| nginx redirecționează **HTTP → HTTPS** (301) | ✔ |
| End-to-end: `register → JWT → anketă → feed` | ✔ |
| Rate-limiting pe Redis: **429** după 5 încercări, **partajat între cei 4 workeri** | ✔ |
| Imaginea Docker se construiește (înainte **nu se construia deloc** — vezi `SECURITY.md` P11) | ✔ |

Ce **nu** a fost validat pe un server public real: emiterea certificatului Let's Encrypt end-to-end
(necesită DNS public propagat). Mecanismul e implementat și testat local cu certificat self-signed +
reload automat al nginx la apariția certificatului real.

---

## 6. `make` — comenzile uzuale

```bash
make up        # docker compose up --build -d + așteaptă 'healthy'  (= deploy-ul)
make down      # oprește tot (datele rămân în volume)
make logs      # log-urile, live
make ps        # starea serviciilor
make check     # readiness prin nginx + emitentul certificatului
make config    # validează .env pentru producție, fără să pornească nimic
make migrate   # migrații manuale (normal se fac singure la `up`)
make backup    # backup ACUM
make restore FILE=/backups/flirt-....sql.gz            # restore de TEST
make restore FILE=/backups/flirt-....sql.gz FORCE=1    # restore PESTE producție
```

---

## 7. Observabilitate

- **Log-uri**: JSON pe stdout, colectate de Docker, **rotite** la 10 MB × 5 fișiere
  per serviciu (fără rotație, log-urile umplu discul, iar când discul e plin cade
  Postgres — adică tot produsul).
- Fiecare cerere are un `request_id`, întors și în antetul `X-Request-ID`.
- Nu se loghează niciodată: tokenuri, parole, mesaje de chat, PII.

```bash
docker compose logs api | grep <request_id>
```

Pentru agregare centralizată (Loki/ELK), trimite stdout-ul containerelor — formatul
e deja JSON, nu mai trebuie parsat.

---

## 8. Backup și restore

Serviciul `backup` face `pg_dump` comprimat la `BACKUP_INTERVAL_SECONDS` (implicit
zilnic), în `BACKUP_HOST_DIR` (implicit `./backups`), cu retenție
`BACKUP_RETENTION_DAYS` (implicit 14 zile).

> Pune `BACKUP_HOST_DIR` pe un **disc separat** sau sincronizează-l off-site (S3,
> Backblaze). Un backup pe același disc cu baza de date dispare odată cu discul.

### Testul de restore — fă-l lunar/trimestrial

Un backup pe care nu l-ai restaurat niciodată **nu e un backup, e o presupunere.**

```bash
make backup                                     # sau: docker compose exec backup sh /scripts/backup_db.sh
docker compose exec backup ls -1 /backups       # alege un dump

make restore FILE=/backups/flirt-20260713-030000.sql.gz
# → restaurează într-o bază de TEST (flirt_restore_test), NU atinge producția,
#   și afișează numărul de utilizatori. Dacă numărul e plauzibil → backup-ul e bun.
```

### Restore real (dezastru)

```bash
make restore FILE=/backups/<dump>.sql.gz FORCE=1
# oprește api+purge, restaurează peste producție, repornește, verifică readiness
```

`restore_db.sh` refuză baza de producție fără `--force` (protecție anti-degete-grase)
și se oprește la prima eroare (`ON_ERROR_STOP`), ca să nu rămâi cu un restore „pe
jumătate reușit" pe care să-l crezi complet. Dacă dump-ul e dintr-o schemă mai veche,
rulează după el `make migrate`.

---

## 9. Update (versiune nouă)

```bash
make backup                      # ÎNTOTDEAUNA înainte de un deploy cu migrații
git pull
docker compose up --build -d     # migrațiile rulează în entrypoint
make check
```

## 10. Rollback

```bash
# 1. Codul: înapoi la commit-ul/tag-ul anterior
git checkout <tag_anterior>
docker compose up --build -d

# 2. Schema — DOAR dacă versiunea nouă a adus migrații incompatibile:
docker compose exec api alembic downgrade -1        # sau: alembic downgrade <revizie>

# 3. Dacă schema nu se poate coborî curat → restore din backup (secțiunea 8),
#    apoi redeploy versiunea veche.

make check
```

Certificatul TLS **nu** e afectat de rollback (trăiește în volumul `letsencrypt`).

---

## 11. GDPR — purjarea conturilor șterse

Serviciul `purge` rulează `scripts/gdpr_purge.py --loop`: la fiecare
`GDPR_PURGE_INTERVAL_SECONDS` (implicit o oră) șterge definitiv conturile a căror
perioadă de grație (`ACCOUNT_DELETION_GRACE_DAYS`, implicit 30 de zile) a expirat.

Rulează într-un proces **separat**, nu în API: `entrypoint.sh` pornește 4 workeri
gunicorn, iar un task în lifespan s-ar executa de 4 ori în paralel.

```bash
docker compose logs purge --tail 20
docker compose exec api python scripts/gdpr_purge.py   # o singură trecere, manual
```

---

## 12. Server nou, de la zero (opțional)

`scripts/bootstrap_server.sh` face pașii 1→4 automat: instalează Docker, deschide
porturile, clonează repo-ul, generează parola Postgres și cheile JWT, apoi se oprește
și îți cere să completezi cheile externe din `.env`.

```bash
sudo REPO_URL=https://github.com/<org>/flirt.git bash backend/scripts/bootstrap_server.sh
nano /opt/flirt/backend/.env        # completează <<< COMPLETEAZĂ >>>
sudo bash backend/scripts/bootstrap_server.sh    # rulează-l din nou: pornește stack-ul
```

E idempotent: nu suprascrie `.env`, nu regenerează cheile JWT, nu reinstalează Docker.

---

## 13. Checklist final — înainte de a lăsa useri reali înăuntru

**Configurare**
- [ ] `ENVIRONMENT=production`, `DEBUG=false`
- [ ] Niciun `<<< COMPLETEAZĂ >>>` rămas în `.env` (`grep COMPLETEAZĂ .env` → nimic)
- [ ] `make config` → OK
- [ ] Parola Postgres nu e `change_me`; `.env` e `chmod 600`
- [ ] Cheia privată JWT există DOAR pe server (nu în git)
- [ ] `GEO_USER_AGENT` are un email real (altfel OSM blochează geocodarea)
- [ ] Niciun provider de integrare pe `stub`

**Rețea și TLS**
- [ ] `dig +short api.flrt.md` și `admin-flirt-paty.flrt.md` → IP-ul serverului
- [ ] `curl -I https://api.flrt.md/health` → 200 **fără `-k`** (certificat real)
- [ ] Emitentul certificatului e Let's Encrypt (nu self-signed)
- [ ] `http://api.flrt.md` → 301 spre HTTPS; HSTS prezent
- [ ] `https://<IP>/` → conexiune închisă (444), nu API-ul

**Funcționare**
- [ ] `/health/ready` → 200 cu `database: ok`, `redis: ok`
- [ ] `/health/ready` → **503** cu DB oprit (l-ai testat, nu îl presupui)
- [ ] Al 6-lea login greșit într-un minut → 429 (rate limiting partajat, prin Redis)
- [ ] `https://admin-flirt-paty.flrt.md/<rută-internă>` → 200 (fallback SPA), nu 404
- [ ] **Primul cont de admin creat** (`create_admin.py`) și te poți loga în panou
- [ ] Ai creat **cel puțin un eveniment** din panou — altfel secțiunea „Evenimente" din
      aplicație se lansează goală (`POST /events` nu există în API-ul public)
- [ ] Dacă lansezi pe Android: **`BILLING_PROVIDER=play` NU e implementat** — trece de guard,
      dar dă 500 la prima achiziție. Vezi [`INTEGRATIONS.md`](./INTEGRATIONS.md).

**Securitate operațională**
- [ ] `docker compose ps` — **doar** `nginx` are porturi publicate (80, 443)
- [ ] Postgres și Redis: **fără** porturi pe host
- [ ] Firewall: doar 22, 80, 443 deschise (și în panoul providerului, nu doar `ufw`)

**Date**
- [ ] Un backup a rulat **și a fost restaurat** cu succes într-o bază de test
- [ ] `BACKUP_HOST_DIR` e pe alt disc / sincronizat off-site
- [ ] Serviciul `purge` rulează (`docker compose logs purge`)

**Mobil**
- [ ] `mobile/eas.json`, profilul `production`: `EXPO_PUBLIC_API_URL=https://api.flrt.md/api/v1`
