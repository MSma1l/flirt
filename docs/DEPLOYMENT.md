# Deployment — de la server gol la aplicație live

Procedura completă pentru backend-ul FLIRT (FastAPI + Postgres + Redis + nginx/TLS).
Mobilul e o aplicație separată și nu face parte din acest stack.

Tot ce urmează pornește din `backend/` și e verificabil: fiecare pas are un
**check** care spune dacă a mers sau nu.

---

## 0. Ce rulează, de fapt

| Serviciu  | Rol | Expus public |
|-----------|-----|--------------|
| `nginx`   | TLS (443), redirect 80→443, rate limiting la margine, reverse proxy | da (80, 443) |
| `api`     | FastAPI pe gunicorn (4 workeri uvicorn), migrații Alembic la pornire | nu (doar prin nginx) |
| `db`      | Postgres 16, volum `pgdata` | nu |
| `redis`   | rate limiting partajat + store OTP live | nu |
| `certbot` | emite/reînnoiește certificatul Let's Encrypt | nu |
| `purge`   | purjare GDPR periodică (conturi cu grația expirată) | nu |
| `backup`  | `pg_dump` periodic + retenție | nu |

---

## 1. Cerințe pe server

- Docker Engine + plugin `docker compose` (v2).
- Porturile **80** și **443** libere și deschise în firewall.
- Un **domeniu** cu record DNS `A`/`AAAA` care arată către IP-ul serverului.
  Fără DNS corect, Let's Encrypt **nu poate** emite certificatul.

```bash
# check DNS (trebuie să întoarcă IP-ul serverului)
dig +short api.exemplu.com
```

---

## 2. Cheile JWT (RS256)

API-ul semnează tokenurile cu RS256; fără chei, `ENVIRONMENT=production` refuză
să pornească (guardrail din `app/core/config.py`).

```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

Pune-le în `.env` pe o singură linie, cu `\n` literal:

```bash
# generează exact liniile de pus în .env
echo "JWT_PRIVATE_KEY=$(awk '{printf "%s\\n", $0}' private.pem)"
echo "JWT_PUBLIC_KEY=$(awk '{printf "%s\\n", $0}' public.pem)"
```

Config-ul normalizează `\n` în linii reale (`_normalize_pem`).

> Cheia privată nu se comite NICIODATĂ și nu iese de pe server. Rotația ei
> invalidează toate tokenurile emise (userii trebuie să se relogheze).

---

## 3. `.env`

```bash
cd backend
cp .env.example .env
```

Setează **obligatoriu** (altfel config-ul refuză să pornească în producție):

| Cheie | Valoare |
|-------|---------|
| `ENVIRONMENT` | `production` |
| `DEBUG` | `false` |
| `POSTGRES_PASSWORD` | parolă generată (`openssl rand -base64 32`) |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | de la pasul 2 |
| `CORS_ORIGINS` | originile reale ale clientului (fără `*`) |
| `DOMAIN` | domeniul public (ex. `api.exemplu.com`) |
| `CERTBOT_EMAIL` | email real (avertizări de expirare) |
| `REDIS_URL` | lasă gol — compose îl setează la `redis://redis:6379/0` |

Și providerii de integrare (config-ul refuză modul `stub` în producție):
`STORAGE_PROVIDER`, `GEO_PROVIDER`, `SOCIAL_AUTH_MODE`, `OTP_MODE`,
`BILLING_PROVIDER`, `FACE_VERIFY_PROVIDER`, `PUSH_PROVIDER` — fiecare cu cheile
lui (vezi `docs/INTEGRATIONS.md`).

```bash
# check: config-ul e valid pentru producție?
docker compose run --rm api python -c "from app.core.config import Settings; Settings(); print('config OK')"
```
Dacă lipsește ceva, primești o listă explicită de probleme, nu o pornire tăcută.

---

## 4. Prima pornire + certificat TLS

```bash
docker compose up -d db redis api nginx
```

La pornire, nginx nu are încă certificat Let's Encrypt, așa că
`nginx/40-ensure-cert.sh` generează unul **self-signed** — exact cât să pornească
și să poată servi provocarea ACME pe `:80` (fără el ai un ou-și-găina: nginx nu
pornește fără cert, certbot nu emite cert fără nginx).

Emite certificatul REAL (o singură dată):

```bash
docker compose run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d "$DOMAIN" \
  --email "$CERTBOT_EMAIL" --agree-tos --no-eff-email

# nginx preia certificatul (relink + reload)
docker compose exec nginx sh /usr/local/bin/ensure-cert.sh
docker compose exec nginx nginx -s reload
```

Reînnoirea e automată: serviciul `certbot` rulează `certbot renew` la 12h, iar
`nginx` re-verifică certificatul și dă `reload` tot la 12h.

```bash
# check TLS
curl -I https://$DOMAIN/health                  # 200, fără avertisment de certificat
curl -I http://$DOMAIN/health                   # 301 → https
curl -sI https://$DOMAIN/health | grep -i strict-transport-security   # HSTS prezent
```

---

## 5. Migrațiile

Rulează **automat** la pornirea containerului `api` (`entrypoint.sh` →
`alembic upgrade head`). Manual, dacă e nevoie:

```bash
docker compose exec api alembic upgrade head
docker compose exec api alembic current      # check: revizia curentă
```

---

## 6. Pornirea completă

```bash
docker compose up -d          # inclusiv certbot, purge, backup
docker compose ps             # toate `running`; `api` trebuie să fie `healthy`
```

### Verificarea că merge cu adevărat

```bash
# 1. liveness (procesul e viu)
curl -fsS https://$DOMAIN/health

# 2. readiness REAL (SELECT 1 pe Postgres + PING pe Redis)
curl -fsS https://$DOMAIN/health/ready
# → {"status":"ready","checks":{"database":"ok","redis":"ok"}}

# 3. cu DB oprit, readiness TREBUIE să dea 503 (nu 200)
docker compose stop db
curl -s -o /dev/null -w '%{http_code}\n' https://$DOMAIN/health/ready   # → 503
docker compose start db

# 4. log-uri structurate (o linie JSON per cerere, cu request_id)
docker compose logs api --tail 20

# 5. rate limiting partajat: al 6-lea login greșit într-un minut → 429
for i in $(seq 1 6); do
  curl -s -o /dev/null -w '%{http_code} ' -X POST https://$DOMAIN/api/v1/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"nobody@example.com","password":"wrong-password"}'
done; echo
```

---

## 7. Observabilitate

- **Log-uri**: JSON pe stdout (`LOG_FORMAT=json`), colectate de Docker. Fiecare
  cerere are `request_id` — corelabil cu antetul `X-Request-ID` din răspuns.
- Nu se loghează niciodată: tokenuri, parole, mesaje de chat, query string-uri, PII.
- Un client care raportează o eroare îți dă `request_id`-ul din răspunsul 500;
  cauți direct:

```bash
docker compose logs api | grep <request_id>
```

Pentru agregare centralizată, trimite stdout-ul containerelor către Loki/ELK
(driver de logging Docker) — formatul e deja JSON, nu mai trebuie parsat.

---

## 8. Backup și restore

Backup automat: serviciul `backup` face `pg_dump` comprimat la
`BACKUP_INTERVAL_SECONDS` (implicit zilnic), în `BACKUP_HOST_DIR` (implicit
`./backups`), cu retenție `BACKUP_RETENTION_DAYS` (implicit 14 zile).

```bash
# backup manual, acum
docker compose exec backup sh /scripts/backup_db.sh
ls -lh backups/
```

> Pune `BACKUP_HOST_DIR` pe un disc/volum SEPARAT (sau sincronizează-l off-site:
> S3, Backblaze). Un backup pe același disc cu DB-ul dispare odată cu discul.

### Restore (procedura testabilă)

**Testul de restore (fă-l lunar/trimestrial — un backup nerestaurat nu e backup):**

```bash
docker compose run --rm -e PGDATABASE=flirt_restore_test backup \
  sh /scripts/restore_db.sh /backups/flirt-20260712-030000.sql.gz
# → restaurează într-o bază de TEST și afișează numărul de utilizatori
```

**Restore real (dezastru, pierdere de date):**

```bash
docker compose stop api purge          # oprim scrierile
docker compose run --rm backup \
  sh /scripts/restore_db.sh /backups/<dump>.sql.gz --force
docker compose exec api alembic upgrade head   # dacă dump-ul e dintr-o schemă mai veche
docker compose start api purge
curl -fsS https://$DOMAIN/health/ready
```

`restore_db.sh` refuză implicit baza de producție fără `--force` (protecție
anti-degete-grase) și se oprește la prima eroare (`ON_ERROR_STOP`), ca să nu
rămâi cu un restore „pe jumătate reușit" pe care să-l crezi complet.

---

## 9. GDPR — purjarea conturilor șterse

Serviciul `purge` rulează `scripts/gdpr_purge.py --loop`: la fiecare
`GDPR_PURGE_INTERVAL_SECONDS` (implicit o oră) șterge definitiv conturile a căror
perioadă de grație (`ACCOUNT_DELETION_GRACE_DAYS`, implicit 30 de zile) a expirat.

Rulează într-un proces SEPARAT, nu în API: `entrypoint.sh` pornește 4 workeri
gunicorn, iar un task în lifespan s-ar executa de 4 ori în paralel.

```bash
# purjare manuală, o singură trecere
docker compose exec api python scripts/gdpr_purge.py
# → "Conturi purjate: N"

docker compose logs purge --tail 20
```

---

## 10. Update (deploy de versiune nouă)

```bash
git pull
docker compose build api
docker compose up -d api          # migrațiile rulează în entrypoint
docker compose ps                 # `api` → healthy
curl -fsS https://$DOMAIN/health/ready
```

## 11. Rollback

```bash
# 1. Codul: revino la commit-ul/tag-ul anterior
git checkout <tag_anterior>
docker compose build api
docker compose up -d api

# 2. Schema (DOAR dacă noua versiune a adus migrații incompatibile):
docker compose exec api alembic downgrade -1     # sau: alembic downgrade <revizie>

# 3. Dacă schema nu se poate coborî curat → restore din backup (secțiunea 8),
#    apoi redeploy versiunea veche.

# check
curl -fsS https://$DOMAIN/health/ready
```

> Înainte de orice deploy cu migrații: **fă un backup manual**
> (`docker compose exec backup sh /scripts/backup_db.sh`). E singura cale de
> întoarcere dacă migrația distruge date.

---

## 12. Checklist final (înainte de a lăsa useri reali înăuntru)

- [ ] `ENVIRONMENT=production`, `DEBUG=false`
- [ ] `https://$DOMAIN/health` → 200, certificat valid (nu self-signed)
- [ ] `http://$DOMAIN/...` → 301 către HTTPS; HSTS prezent
- [ ] `/health/ready` → 200 cu `database: ok`, `redis: ok`
- [ ] `/health/ready` → 503 cu DB oprit (l-ai testat, nu îl presupui)
- [ ] `REDIS_URL` setat → rate limiting partajat între cei 4 workeri
- [ ] Niciun provider de integrare în modul `stub`
- [ ] Backup rulat cel puțin o dată **și restaurat** cu succes într-o bază de test
- [ ] Serviciul `purge` rulează (verifică log-urile)
- [ ] Cheia privată JWT există DOAR pe server (nu în git)
- [ ] Parola Postgres nu e `change_me`
