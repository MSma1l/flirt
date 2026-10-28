# FLIRT pe k3s — manifeste

Cluster k3s cu **un singur nod** (6 CPU, ~10 GB RAM). **Singurul** mod de a rula producția.
Scripturile de instalare/build/deploy sunt documentate în `deploy/k8s/scripts/README.md`.

> ⛔ **NU rula `docker compose` pe server.** `backend/docker-compose.yml` e doar pentru
> dezvoltare locală (db + redis + api); API-ul refuză să pornească cu
> `ENVIRONMENT=production` în afara Kubernetes.
>
> Istoric: producția a rulat pe docker compose până la cutover-ul spre k3s, făcut pe
> **28.10.2026** (scriptul unic de migrare a fost scos din repo după aceea).

## Structură

```
deploy/k8s/manifests/
├── kustomization.yaml     # baza: kubectl apply -k deploy/k8s/manifests  (namespace flirt)
├── namespace.yaml         # ns flirt, Pod Security: enforce=baseline, warn/audit=restricted
├── priorityclass.yaml     # flirt-data (db, redis evacuate ultimele) — nivel de cluster
├── media-pvc.yaml         # PVC media 10Gi (fost volum mediadata)
├── backups.yaml           # PV static flirt-backups → /opt/flirt-backups pe host + PVC backups
├── db.yaml                # Service db:5432 + StatefulSet db (postgres:16-alpine, PVC 20Gi)
├── redis.yaml             # Service redis:6379 + StatefulSet redis (redis:7-alpine, PVC 1Gi)
├── api.yaml               # Deployment/Service/HPA(2–6)/PDB api (flirt-api, :8000)
├── web.yaml               # Deployment/Service/HPA(2–4)/PDB web (flirt-web nginx, :8080 → svc :80)
├── ingress.yaml           # Ingress flirt → web:80 + IngressRoute flirt-api-limits — SINGURUL loc cu domeniile publice
├── ratelimit.yaml         # Middleware-uri Traefik rl-* (limite per IP la margine)
├── cronjobs.yaml          # purge (orar), backup-db (la 6h), backup-media (zilnic 03:30)
├── networkpolicies.yaml   # default-deny ingress ȘI egress + excepții explicite
├── jobs/migrate-job.yaml  # șablon Job alembic (__IMAGE__) — NU e în kustomization
└── cluster/               # nivel de cluster — NU sunt în kustomization
    ├── storageclass.yaml  # local-path-retain (reclaimPolicy Retain)
    ├── issuers.yaml       # ClusterIssuer letsencrypt-prod / letsencrypt-staging (__ACME_EMAIL__)
    └── traefik-config.yaml# HelmChartConfig: redirect HTTP→HTTPS, IP real client, timeouts
```

## Ordinea de aplicare (prima dată)

1. Pe nod: Traefik + servicelb activate; cert-manager instalat (CRD-uri).
2. `kubectl apply -f cluster/storageclass.yaml` — ÎNAINTEA bazei (PVC-urile îl cer).
3. `kubectl apply -f cluster/traefik-config.yaml`
4. `sed "s/__ACME_EMAIL__/<email>/" cluster/issuers.yaml | kubectl apply -f -`
5. Secretul `flirt-env` (din `.env`-ul serverului, NU e în git) în namespace-ul `flirt`.
6. `kubectl apply -k deploy/k8s/manifests`
7. Job-ul `migrate` (șablonul cu tag-ul imaginii), apoi rollout api/web.

## Trafic

```
client ─▶ Traefik (kube-system, TLS, redirect 80→443) ─▶ web:80 (nginx, rutare pe Host)
                                                          ├─ static admin / miniapp
                                                          ├─ /media  (din PVC media, readOnly)
                                                          └─ /api ─▶ api:8000 ─▶ db:5432, redis:6379
```

NetworkPolicy, ingress: kube-system → web:8080 (+ solver ACME :8089), web → api:8000,
{api, migrate, purge, backup-db} → db:5432, {api, purge} → redis:6379.
Egress **default-deny**: toate podurile → doar DNS (CoreDNS); api → db, redis și internet
TCP 443 *exceptând* rețelele private (10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10,
127/8); web → api:8000; migrate/backup-db → db; purge → db + redis; backup-media, db,
redis → nimic. O integrare nouă pe alt port decât 443 (ex. `APP_STORE_ENABLE_ONLINE_CHECKS=1`
= OCSP pe 80, un GEO/OPENROUTER self-hosted) cere extinderea politicii `api-egress`.

Toate podurile din `flirt` respectă Pod Security `restricted` (namespace-ul impune încă
`baseline`); web/api/migrate/purge/backup-uri au `readOnlyRootFilesystem` cu `/tmp` emptyDir.

**Rate limit la margine (Traefik, exact, o singură replică):** `ratelimit.yaml` — `rl-general`
20/s (burst 41), `rl-media` 100/s (201), `rl-tg-auth` 60/min (31), `rl-session` 120/min (121),
`rl-auth` 5/min (11); `ipStrategy.depth 0` = IP-ul real (Service traefik cu
`externalTrafficPolicy: Local`). IngressRoute `flirt-api-limits` le aplică rutelor
auth/session/media de pe hostul api (fără OPTIONS). Zonele nginx rămân a doua linie, per pod:
**un prag se schimbă în AMBELE** `ratelimit.yaml` și `images/web/nginx.conf.template` (un test
verifică paritatea). Traefik scalat la >1 replică ⇒ limitele devin iar de N× mai largi
(soluție: `rateLimit.redis` în Traefik).

## Stabilitate

- **Rollout fără downtime**: `maxSurge 1 / maxUnavailable 0`, `minReadySeconds 10`, readiness
  real (`/health/ready` verifică DB), `preStop` + `terminationGracePeriodSeconds` pentru drenare.
  Un rollout care nu devine Ready în 300s e marcat eșuat (scriptul face `rollout undo`).
- **Auto-vindecare**: startup/liveness pe `/health` (fără DB → o cădere Postgres nu restartează
  API-ul în cascadă), probe `pg_isready` / `redis-cli ping`.
- **Autoscalare**: HPA pe CPU (+ memorie la api); urcare rapidă, coborâre după 5 min stabil.
- **Migrații**: în Job separat (`RUN_MIGRATIONS=0` pe api) — nu rulează de N ori în paralel.
  Trebuie să fie compatibile înapoi (podurile vechi rulează pe schema nouă în timpul rollout-ului).

## Date și backup

- PVC-urile (`data-db-0`, `data-redis-0`, `media`) folosesc `local-path-retain`: ștergerea
  unui PVC sau a namespace-ului **NU** șterge datele. Directorul rămâne în
  `/var/lib/rancher/k3s/storage/pvc-<uid>_flirt_<nume>`; PV-ul trece în `Released`.
  Re-legare: șterge `spec.claimRef` din PV (`kubectl patch pv <pv> --type json -p '[{"op":"remove","path":"/spec/claimRef"}]'`)
  și creează PVC-ul cu `volumeName: <pv>`.
- Backup-uri în `/opt/flirt-backups` pe host: `flirt-AAAALLZZ-HHMMSS.sql.gz` (la 6h) și
  `media/media-AAAALLZZ-HHMMSS.tar.gz` (zilnic), retenție 14 zile (cheile
  `BACKUP_RETENTION_DAYS` / `MEDIA_BACKUP_RETENTION_DAYS` din `flirt-env`, opționale).
  Logica e inline în `cronjobs.yaml` (sursa unică de adevăr).
- `/opt/flirt-backups` e al uid/gid 1000 (`0750`), ca CronJob-urile de backup să ruleze
  non-root; pregătit de `install-k3s.sh host-hardening`.
- Backup manual imediat: `kubectl -n flirt create job --from=cronjob/backup-db backup-manual-$(date +%s)`.

## Loguri

Kubelet rotește logurile containerelor după mărime (10Mi × 5); limita în **timp**
(`LOG_RETENTION_DAYS`, promisă în Politica de confidențialitate) o aplică pe host
timer-ul `flirt-log-retention` + journald, instalate de `install-k3s.sh host-hardening`
(detalii: `deploy/k8s/scripts/README.md` §1).

## Comenzi utile

```sh
kubectl -n flirt get pods,hpa,pdb,cronjobs,jobs
kubectl -n flirt rollout status deploy/api
kubectl -n flirt logs deploy/api -f
kubectl -n flirt exec -it db-0 -c postgres -- sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
kubectl -n flirt get certificate,certificaterequest,challenge   # starea TLS
```

Schimbi un domeniu → `ingress.yaml` (rules + tls) **și** `.env` (DOMAIN / ADMIN_DOMAIN / MINIAPP_DOMAIN).
