# FLIRT pe k3s — runbook

Un singur nod k3s pe serverul de producție (`ssh flirt`, repo în `/opt/flirt`).
Toate comenzile de mai jos rulează **ca root, pe server, din `/opt/flirt`**.
`kubectl` = `k3s kubectl` (nu există kubectl separat); prescurtare utilă:

```sh
alias k='k3s kubectl -n flirt'
```

| Fișier | Rol |
|---|---|
| `install-k3s.sh phase1\|phase2\|status` | instalare k3s + cert-manager; phase2 = Traefik/ServiceLB pornite |
| `deploy.sh` | deploy zilnic zero-downtime cu rollback automat (`--rollback`, `--prepare`, `--no-pull`) |
| `migrate-from-compose.sh` | cutover unic docker compose → k3s |
| `lib.sh` | funcții comune (curățarea `.env`, secret, migrații, imagini) |
| `../images/web/` | imaginea `flirt-web` (admin + Mini App + nginx, non-root, :8080) |
| `../manifests/` | manifestele kustomize (namespace `flirt`) |

Jurnale: `/var/log/flirt-deploy.log`, `/var/log/flirt-cutover.log`.
Stare: `/var/lib/flirt/` (istoricul tag-urilor, marcajele cutover-ului).

---

## 1. Instalare (o singură dată)

```sh
deploy/k8s/scripts/install-k3s.sh phase1
```

- k3s fixat (`K3S_VERSION`, implicit `v1.36.5+k3s1`): binarul din GitHub Releases,
  verificat cu `sha256sum-<arch>.txt`, apoi `install.sh` de la același tag cu
  `INSTALL_K3S_SKIP_DOWNLOAD=true`. **Fără `curl | sh`.**
- `/etc/rancher/k3s/config.yaml`: `write-kubeconfig-mode: "0600"`,
  `secrets-encryption: true`, `disable: [traefik, servicelb]` (porturile 80/443
  sunt încă ale nginx-ului din compose).
- ufw: permis `10.42.0.0/16` (poduri) și `10.43.0.0/16` (servicii). **6443 rămâne închis.**
- cert-manager fixat (`CERT_MANAGER_VERSION`, implicit `v1.21.3`), din manifestul
  oficial al release-ului; apoi storageclass, traefik-config și ClusterIssuer-ele
  (`__ACME_EMAIL__` ← `CERTBOT_EMAIL` din `.env`).
- Idempotent: ce e deja instalat la versiunea fixată e sărit.

## 2. Cutover din docker compose (o singură dată)

```sh
deploy/k8s/scripts/deploy.sh --prepare           # build + import imagini, secret flirt-env
deploy/k8s/scripts/migrate-from-compose.sh       # întreabă înainte de pașii cu impact
```

Ce face `migrate-from-compose.sh` (detalii în antetul scriptului):

1. verificări: nod Ready, cert-manager, `flirt-api:current`/`flirt-web:current` în containerd, secretul `flirt-env`, uid-ul `api` (1000);
2. **fără downtime**: resursele de cluster, certificatul Let's Encrypt din compose importat ca secretul `flirt-tls` (dacă acoperă toate cele 3 nume), `apply -k`, `api` la 0 replici și cronjob-urile suspendate;
3. **downtime începe**: `docker compose stop api purge`;
4. `pg_dump` → `/opt/flirt-backups/cutover-<dată>.sql.gz`, restaurat în `db-0` **doar dacă baza din k8s e goală**, verificare cu numărul exact de rânduri din fiecare tabel, apoi Job-ul `migrate`;
5. media: volumul `flirt_mediadata` → directorul PV-ului `media` (`chown 1000:1000`);
6. `api`/`web` pornite în k8s → `docker compose stop nginx certbot backup backup-media` → `install-k3s.sh phase2` (Traefik + ServiceLB preiau 80/443);
7. teste de fum pe `https://<domeniu>` (cod 200 + antete de securitate), apoi instrucțiunile de rollback.

Re-rularea e sigură: pașii terminați (restaurare, phase2) sunt marcați în
`/var/lib/flirt/cutover/` și săriți. **Nu se rulează niciodată `docker compose down -v`.**

## 3. Deploy zilnic

```sh
ssh flirt 'cd /opt/flirt && deploy/k8s/scripts/deploy.sh'
```

`git pull --ff-only` → `docker build` (`flirt-api:<sha>`, `flirt-web:<sha>`) →
import în containerd → cluster + secret din `.env` → `apply -k` (cu imaginile
care rulează deja) → **Job `migrate`** → rollout `api` (+ cronjob `purge`) →
rollout `web` → `:current` mutat pe noul tag → păstrăm ultimele 3 tag-uri.

- Migrațiile eșuează → scriptul se oprește **înainte** de a atinge Deployment-urile; versiunea veche rămâne online.
- Rollout eșuat (pod-uri care nu devin Ready în 300s) → `kubectl rollout undo` automat pentru acel Deployment + diagnostic în log.
- **Migrațiile trebuie să fie compatibile înapoi (expand/contract)**: pod-urile vechi servesc trafic în timpul rollout-ului și după un rollback. Ștergeri/redenumiri de coloane: în deploy-ul *următor*, după ce codul nu le mai folosește.
- Schimbare doar în `.env`: rulează tot `deploy.sh` — secretul se actualizează și pod-urile se recreează (adnotarea `flirt.md/env-sha`).

## 4. Rollback

```sh
deploy/k8s/scripts/deploy.sh --rollback          # api + web la revizia anterioară, purge aliniat
k rollout history deploy/api                     # revizii (change-cause = "deploy <sha>")
k3s kubectl -n flirt rollout undo deploy/api --to-revision=N
```

Doar ultimele 3 imagini sunt păstrate în containerd; pentru o versiune mai
veche: `git checkout <sha>` într-o copie separată și `deploy.sh --no-pull`.
Migrațiile **nu** se anulează la rollback.

Înapoi la docker compose (de urgență; datele scrise după cutover rămân în k8s —
exportă-le întâi cu `pg_dump` din `db-0`):

```sh
k scale deploy/api deploy/web --replicas=0
systemctl stop k3s && /usr/local/bin/k3s-killall.sh
cd /opt/flirt/backend && docker compose up -d     # NICIODATĂ `down -v`
```

## 5. Loguri și stare

```sh
k get pods -o wide
k logs deploy/api -f                      # API (JSON, cu request-id)
k logs deploy/web -f                      # nginx (IP-uri trunchiate)
k logs job/migrate                        # ultima migrare
k get events --sort-by=.lastTimestamp | tail -20
k get certificate,ingress                 # TLS (cert-manager)
k top pods                                # CPU/RAM (metrics-server din k3s)
```

## 6. Scalare

`api` (2–6) și `web` (2–4) au HPA pe CPU/RAM. Manual, temporar:

```sh
k patch hpa api -p '{"spec":{"minReplicas":3}}'   # permanent: în manifests/api.yaml
```

`k scale` pe un Deployment cu HPA e suprascris de HPA. Limitele de rată din nginx
sunt **per pod `web`** (N replici ≈ N× limita la margine; limitele fine rămân în API).

## 7. Backup și restaurare

CronJob-urile `backup-db` (la 6 ore) și `backup-media` (zilnic) scriu în
`/opt/flirt-backups` pe host (același director ca în compose).

```sh
k create job --from=cronjob/backup-db backup-manual     # backup acum
ls -lt /opt/flirt-backups | head

# Restaurare DB (oprește scrierile întâi):
k scale deploy/api --replicas=0
gunzip -c /opt/flirt-backups/flirt-<stamp>.sql.gz \
  | k exec -i db-0 -c postgres -- sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
k scale deploy/api --replicas=2

# Restaurare media: dezarhivează în directorul PV-ului media
PV=$(k get pvc media -o jsonpath='{.spec.volumeName}')
DIR=$(k3s kubectl get pv "$PV" -o jsonpath='{.spec.hostPath.path}{.spec.local.path}')
tar -xzf /opt/flirt-backups/media/media-<stamp>.tar.gz -C "$DIR" --strip-components=2
chown -R 1000:1000 "$DIR"
```

Dump-urile `backup-db` conțin `--clean --if-exists` (suprascriu tabelele existente).
