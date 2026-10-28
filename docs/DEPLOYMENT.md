# Deployment — producția FLIRT pe k3s

Din **28.10.2026** producția rulează pe **k3s cu un singur nod** (`deploy/k8s/`).
Acest fișier e rezumatul; detaliile, comandă cu comandă, sunt în runbook:
**[`deploy/k8s/scripts/README.md`](../deploy/k8s/scripts/README.md)** (manifeste și
arhitectură: [`deploy/k8s/README.md`](../deploy/k8s/README.md)).

> ## ⚠️ NU rula `docker compose` pe server.
> `backend/docker-compose.yml` e **doar pentru dezvoltare locală** (db, redis, api;
> proiectul `flirt-dev`). Pe server ar porni o a doua bază de date, goală, lângă cea
> din k8s. `backend/entrypoint.sh` refuză oricum să pornească API-ul cu
> `ENVIRONMENT=production` în afara Kubernetes (ocolire doar conștient, la urgență:
> `ALLOW_PROD_OUTSIDE_K8S=1`).

**Deploy-ul, în întregime:**

```bash
ssh flirt 'cd /opt/flirt && deploy/k8s/scripts/deploy.sh'
```

`git pull` → build imagini (`flirt-api`, `flirt-web`) → Job `migrate` → rollout fără
downtime → rollback automat dacă podurile noi nu devin Ready.

Toate comenzile de mai jos rulează **ca root, pe server, din `/opt/flirt`**, cu:

```bash
alias k='k3s kubectl -n flirt'
```

---

## 0. Ce rulează (namespace `flirt`)

| Resursă | Rol | Expus public |
|---|---|---|
| Traefik (kube-system) + cert-manager | TLS Let's Encrypt, redirect 80→443 | **da** (80, 443) — singura ușă |
| `web` (Deployment, HPA 2–4) | nginx: panoul de admin + Mini App (static), `/media`, proxy `/api`, rate limit la margine | nu (prin Traefik) |
| `api` (Deployment, HPA 2–6) | FastAPI pe gunicorn | nu (doar prin `web`) |
| `db` (StatefulSet) | Postgres 16, PVC 20 Gi | **nu** (ClusterIP) |
| `redis` (StatefulSet) | rate limiting partajat + store OTP | **nu** (ClusterIP) |
| Job `migrate` | `alembic upgrade head`, rulat de `deploy.sh` înainte de rollout | — |
| CronJob `purge` | purjare GDPR, orar | — |
| CronJob `backup-db` / `backup-media` | la 6 ore / zilnic → `/opt/flirt-backups` pe host | — |

NetworkPolicy `default-deny` + excepții explicite: doar Traefik → `web`, `web` → `api`,
`api`/`migrate`/`purge`/`backup-db` → `db`, `api`/`purge` → `redis`. Un Redis sau
Postgres expus pe internet e preluat în minute — aici nu au nici port pe host, nici
Service public.

### Domeniile

| Nume | Ce servește |
|---|---|
| `api.flrt.md` | API-ul (aplicația mobilă vorbește doar aici) |
| `admin-flirt-paty.flrt.md` | panoul de admin (SPA, build Vite) |
| `miniapp.flrt.md` | Telegram Mini App (SPA) |

Toate trei: același nod, același Ingress (`deploy/k8s/manifests/ingress.yaml`),
**un singur certificat** (SAN) în secretul `flirt-tls`. Schimbi un domeniu →
`ingress.yaml` **și** `.env` (`DOMAIN` / `ADMIN_DOMAIN` / `MINIAPP_DOMAIN`).

---

## 1. Server și DNS

- Nodul actual: 6 CPU, ~10 GB RAM. Software: Ubuntu, `git`, **Docker Engine**
  (doar pentru `docker build` în `deploy.sh` — nu pentru rulare). k3s și cert-manager
  le instalează `install-k3s.sh`.
- Firewall: doar **22, 80, 443** (și în panoul providerului, nu doar `ufw`).
  Portul **80 e obligatoriu** (validarea HTTP-01 Let's Encrypt). **6443 (API k3s)
  rămâne închis** — `kubectl` se folosește doar local.

Câte o înregistrare `A` (TTL 300) către IP-ul serverului, la registrarul `flrt.md`
(plus `AAAA` dacă serverul are IPv6):

| Tip | Nume | Domeniul rezultat |
|---|---|---|
| A | `api` | `api.flrt.md` |
| A | `admin-flirt-paty` | `admin-flirt-paty.flrt.md` |
| A | `miniapp` | `miniapp.flrt.md` |

> Al doilea nume e `admin-flirt-paty`, **nu** `admin` — trebuie să corespundă exact
> cu `ADMIN_DOMAIN` din `.env` și cu `ingress.yaml`. Certificatul e unul singur pentru
> toate trei numele: dacă DNS-ul unuia lipsește, emiterea eșuează (vezi §4).

```bash
dig +short api.flrt.md; dig +short admin-flirt-paty.flrt.md; dig +short miniapp.flrt.md
```

---

## 2. `.env` → secretul `flirt-env`

```bash
cd /opt/flirt/backend
cp .env.production.example .env
chmod 600 .env
nano .env        # completează tot ce e marcat cu  <<< COMPLETEAZĂ >>>
```

`.env` rămâne doar pe server (nu e în git); `deploy.sh` îl transformă la fiecare rulare
în secretul `flirt-env` (k3s are `secrets-encryption` activ). **Schimbare doar în
`.env` → rulează tot `deploy.sh`**: secretul se actualizează și podurile se recreează.

| Variabilă | De unde o iei |
|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -base64 32` |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | `openssl genrsa` — vezi mai jos |
| `CERTBOT_EMAIL` | email real — numele cheii a rămas istoric; e emailul ACME pentru ClusterIssuer-ul Let's Encrypt |
| `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | consola AWS (S3 + IAM; aceleași chei pentru Rekognition) |
| `GEO_USER_AGENT` | un **email real** — Nominatim/OSM blochează valoarea implicită |
| `GOOGLE_CLIENT_ID` / `APPLE_CLIENT_ID` | Google Cloud Console / Apple Developer |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | consola Twilio |
| `APP_STORE_SHARED_SECRET` | App Store Connect → App Information → App-Specific Shared Secret |
| `OPERATOR_LEGAL_NAME` | numele juridic real al operatorului (PFA / SRL) — vezi mai jos |

Deja corecte în șablon: `DOMAIN`, `ADMIN_DOMAIN`, `MINIAPP_DOMAIN`, `CORS_ORIGINS`,
`ENVIRONMENT=production`, `DEBUG=false`, `GEO_PROVIDER=nominatim`, `PUSH_PROVIDER=expo`.
Opționale: `BACKUP_RETENTION_DAYS` / `MEDIA_BACKUP_RETENTION_DAYS` (implicit 14 zile).

Dacă lipsește ceva, guardul de producție (`app/core/config.py`) refuză pornirea și
listează exact variabilele: `k logs job/migrate` / `k logs deploy/api`. Podurile nu
devin Ready, iar `deploy.sh` lasă versiunea veche online.

### Cheile JWT (RS256)

Se generează **pe server**; cheia privată nu pleacă niciodată de acolo.

```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem

# liniile de lipit în .env (PEM pe o linie, cu \n literal)
echo "JWT_PRIVATE_KEY=$(awk '{printf "%s\\n", $0}' private.pem)"
echo "JWT_PUBLIC_KEY=$(awk  '{printf "%s\\n", $0}' public.pem)"
```

> Rotația cheii invalidează **toate** tokenurile (toți userii se reloghează).

### Numele operatorului legal

`OPERATOR_LEGAL_NAME` apare în Termeni și în Politica de confidențialitate (ambele
limbi). **Nu blochează pornirea**: cât timp e gol, paginile legale afișează vizibil
**„DE COMPLETAT: numele complet al operatorului"** — mai bine un gol vizibil decât o
denumire inventată. Se poate face deploy fără el, dar **nu submit în App Store**.

```bash
# în backend/.env, pe server
OPERATOR_LEGAL_NAME=Popescu Ion Întreprindere Individuală
deploy/k8s/scripts/deploy.sh          # podurile se recreează (paginile legale sunt cache-uite în proces)

curl -s https://api.flrt.md/legal/terms | grep -c "DE COMPLETAT"    # → 0
```

---

## 3. Instalare de la zero (o singură dată)

Pe scurt (detalii: runbook §1):

```bash
git clone <repo> /opt/flirt && cd /opt/flirt
# completează backend/.env (§2) — CERTBOT_EMAIL e necesar pentru ClusterIssuer
deploy/k8s/scripts/install-k3s.sh phase1    # k3s fixat + verificat sha256, cert-manager, storageclass, issuers
deploy/k8s/scripts/install-k3s.sh phase2    # Traefik + ServiceLB preiau 80/443 (porturile trebuie să fie libere)
deploy/k8s/scripts/deploy.sh                # instalare nouă: build, secret, manifeste, migrate, rollout
deploy/k8s/scripts/install-k3s.sh status
```

Apoi **primul cont de admin** (§5) — altfel panoul rămâne inaccesibil.

---

## 4. TLS (Traefik + cert-manager)

cert-manager emite și reînnoiește singur certificatul Let's Encrypt (`flirt-tls`) pentru
cele trei nume; Traefik face redirectul 80→443. Nu există certbot.

```bash
k get certificate,certificaterequest,challenge      # starea emiterii
k describe challenge                                # de ce eșuează (aproape mereu DNS sau portul 80)
curl -I http://api.flrt.md/.well-known/acme-challenge/test   # portul 80 accesibil din afară?
```

---

## 5. Operare zilnică

| Ce | Comandă |
|---|---|
| Deploy | `ssh flirt 'cd /opt/flirt && deploy/k8s/scripts/deploy.sh'` |
| Rollback (cod) | `deploy/k8s/scripts/deploy.sh --rollback` |
| Stare | `k get pods,hpa,cronjobs,jobs` |
| Loguri API / nginx | `k logs deploy/api -f` / `k logs deploy/web -f` |
| Ultima migrare | `k logs job/migrate` |
| Jurnalul deploy-urilor | `/var/log/flirt-deploy.log` |
| Comandă unică în API | `k exec deploy/api -- python scripts/<script>.py` |

**Migrațiile trebuie să fie compatibile înapoi (expand/contract)**: podurile vechi servesc
trafic în timpul rollout-ului și după un rollback, iar rollback-ul **nu** anulează
migrațiile. Ștergi/redenumești o coloană abia în deploy-ul *următor*. Dacă schema chiar
trebuie coborâtă: restore din backup (§6). Detalii: runbook §3–§4.

### Primul cont de admin — obligatoriu

Rutele `/admin/*` cer rolul `admin`, care se acordă doar din panou ⇒ într-o bază
proaspătă nimeni nu se poate loga. Scriptul cere acces la infrastructură (deliberat:
nu „primul user înregistrat devine admin").

```bash
k3s kubectl -n flirt exec -it deploy/api -- python scripts/create_admin.py admin@flrt.md
# parola se cere la terminal (min. 12 caractere, literă mare + cifră)
# idempotent; parolă pierdută: ... create_admin.py admin@flrt.md --reset-password
```

### Observabilitate

- Loguri JSON pe stdout, cu `request_id` (și în antetul `X-Request-ID`):
  `k logs deploy/api | grep <request_id>`. Nu se loghează tokenuri, parole, mesaje, PII.
- IP trunchiat în jurnalele de acces (nginx `flirt_anon`, API `client_ip` /24, IPv6 /48);
  rate limiting-ul folosește IP-ul complet doar în memorie/Redis.
- Logurile containerelor sunt rotite de kubelet după mărime. ⚠️ Retenția în timp
  promisă în Politica de confidențialitate (`LOG_RETENTION_DAYS`, implicit 30) nu mai are
  un cron dedicat după migrare — de verificat.

---

## 6. Backup și restaurare

CronJob-urile scriu pe host, în **`/opt/flirt-backups`**: `flirt-AAAALLZZ-HHMMSS.sql.gz`
(la 6 ore) și `media/media-AAAALLZZ-HHMMSS.tar.gz` (zilnic), retenție 14 zile.

> Sincronizează `/opt/flirt-backups` **off-site** (S3, Backblaze). Un backup pe același
> disc cu baza de date dispare odată cu discul.

```bash
k create job --from=cronjob/backup-db backup-manual     # backup acum (ÎNAINTE de deploy-uri riscante)
ls -lt /opt/flirt-backups | head

# Restaurare DB (oprește scrierile întâi; dump-ul are --clean --if-exists):
k scale deploy/api --replicas=0
gunzip -c /opt/flirt-backups/flirt-<stamp>.sql.gz \
  | k exec -i db-0 -c postgres -- sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
k scale deploy/api --replicas=2
```

Restaurarea media și detaliile: runbook §7. Un backup pe care nu l-ai restaurat
niciodată (măcar într-o bază de test) **nu e un backup, e o presupunere** — testează
periodic.

PVC-urile folosesc `local-path-retain`: ștergerea unui PVC sau a namespace-ului **nu**
șterge datele (re-legare: `deploy/k8s/README.md`).

---

## 7. GDPR — purjarea conturilor șterse

CronJob-ul `purge` rulează `scripts/gdpr_purge.py` o dată pe oră (proces separat de API)
și șterge definitiv conturile cu grația expirată (`ACCOUNT_DELETION_GRACE_DAYS`, implicit
30 de zile): datele și **fișierele** (poze, povești, atașamente — de aceea montează PVC-ul
`media`) și **anonimizează** comenzile de bilet (suma, moneda, referința, evenimentul,
datele și statusul rămân — evidență contabilă). La fiecare trecere aplică și retenția
dovezilor de plată: `PAYMENT_PROOF_RETENTION_DAYS` (implicit 1825 = 5 ani) și
`REJECTED_PAYMENT_PROOF_RETENTION_DAYS` (implicit 90).

```bash
k get cronjob purge; k get pods -l app.kubernetes.io/name=purge   # ultimele rulări
k logs -l app.kubernetes.io/name=purge --tail 20
k create job --from=cronjob/purge purge-manual                   # o trecere acum
```

---

## 8. Checklist — înainte de useri reali

**Configurare**
- [ ] `ENVIRONMENT=production`, `DEBUG=false`; niciun `<<< COMPLETEAZĂ >>>` în `.env`
- [ ] Parola Postgres nu e `change_me`; `.env` e `chmod 600`; cheia privată JWT doar pe server
- [ ] `GEO_USER_AGENT` cu email real; niciun provider de integrare pe `stub`
- [ ] `OPERATOR_LEGAL_NAME` completat înainte de submit în App Store

**Rețea și TLS**
- [ ] `dig` pe cele trei nume → IP-ul serverului
- [ ] `curl -I https://api.flrt.md/health` → 200 **fără `-k`**; emitentul e Let's Encrypt
- [ ] `http://api.flrt.md` → redirect spre HTTPS; HSTS prezent
- [ ] `https://<IP>/` → nu răspunde API-ul (Traefik nu are rută pentru IP; nginx dă 444 pe Host necunoscut)
- [ ] **Doar Traefik** ascultă pe 80/443 (`ss -ltnp`); `db`/`redis` sunt ClusterIP, fără porturi pe host
- [ ] NetworkPolicies aplicate (`k get networkpolicy`); 6443 închis; firewall doar 22/80/443

**Funcționare**
- [ ] `curl -s https://api.flrt.md/health/ready` → `database: ok`, `redis: ok`
- [ ] Al 6-lea login greșit într-un minut → 429
- [ ] `https://admin-flirt-paty.flrt.md/<rută-internă>` → 200 (fallback SPA); `https://miniapp.flrt.md/` → 200
- [ ] **Primul cont de admin creat** și te poți loga în panou
- [ ] Cel puțin **un eveniment** creat din panou (altfel „Evenimente" se lansează goală)
- [ ] Android: **`BILLING_PROVIDER=play` NU e implementat** — vezi [`INTEGRATIONS.md`](./INTEGRATIONS.md)

**Date**
- [ ] Un backup a rulat **și a fost restaurat** cu succes într-o bază de test
- [ ] `/opt/flirt-backups` sincronizat off-site
- [ ] CronJob-ul `purge` rulează fără erori

**Mobil**
- [ ] `mobile/eas.json`, profilul `production`: `EXPO_PUBLIC_API_URL=https://api.flrt.md/api/v1`
