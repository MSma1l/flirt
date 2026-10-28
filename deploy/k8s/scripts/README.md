# FLIRT pe k3s — runbook

Un singur nod k3s pe serverul de producție (`ssh flirt`, repo în `/opt/flirt`) —
**singurul** mod de a rula producția.

> ⛔ **NU rula `docker compose` pe server** (nici `up`, nici `make up`).
> `backend/docker-compose.yml` e doar pentru dezvoltare locală; API-ul refuză oricum
> să pornească cu `ENVIRONMENT=production` în afara Kubernetes.

Toate comenzile de mai jos rulează **ca root, pe server, din `/opt/flirt`**.
`kubectl` = `k3s kubectl` (nu există kubectl separat); prescurtare utilă:

```sh
alias k='k3s kubectl -n flirt'
```

| Fișier | Rol |
|---|---|
| `install-k3s.sh phase1\|phase2\|status` | instalare k3s + cert-manager; phase2 = Traefik/ServiceLB pornite |
| `deploy.sh` | deploy zilnic zero-downtime cu rollback automat (`--rollback`, `--prepare`, `--no-pull`) |
| `lib.sh` | funcții comune (curățarea `.env`, secret, migrații, imagini) |
| `../images/web/` | imaginea `flirt-web` (admin + Mini App + nginx, non-root, :8080) |
| `../manifests/` | manifestele kustomize (namespace `flirt`) |

Jurnale: `/var/log/flirt-deploy.log`.
Stare: `/var/lib/flirt/` (istoricul tag-urilor).

---

## 1. Instalare (o singură dată)

```sh
deploy/k8s/scripts/install-k3s.sh phase1
```

- k3s fixat (`K3S_VERSION`, implicit `v1.36.5+k3s1`): binarul din GitHub Releases,
  verificat cu `sha256sum-<arch>.txt`, apoi `install.sh` de la același tag cu
  `INSTALL_K3S_SKIP_DOWNLOAD=true`. **Fără `curl | sh`.**
- `/etc/rancher/k3s/config.yaml`: `write-kubeconfig-mode: "0600"`,
  `secrets-encryption: true`, `disable: [traefik, servicelb]` (80/443 rămân
  libere până la phase2).
- ufw: permis `10.42.0.0/16` (poduri) și `10.43.0.0/16` (servicii). **6443 rămâne închis.**
- cert-manager fixat (`CERT_MANAGER_VERSION`, implicit `v1.21.3`), din manifestul
  oficial al release-ului; apoi storageclass, traefik-config și ClusterIssuer-ele
  (`__ACME_EMAIL__` ← `CERTBOT_EMAIL` din `.env`).
- Idempotent: ce e deja instalat la versiunea fixată e sărit.

## 2. Primul deploy pe un server nou, apoi Traefik

```sh
cp backend/.env.production.example backend/.env && chmod 600 backend/.env   # completează
deploy/k8s/scripts/deploy.sh                     # instalare nouă: build, migrate, rollout
deploy/k8s/scripts/install-k3s.sh phase2         # Traefik + ServiceLB preiau 80/443
```

Restaurarea datelor pe un server nou: §7. **Istoric:** serverul actual a fost mutat
din docker compose pe k3s printr-un cutover unic, făcut pe **28.10.2026** (scriptul
de migrare a fost scos din repo după aceea).

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

Nu există „întoarcere la docker compose": stack-ul vechi a fost retras. Dacă și
codul anterior e stricat, restaurezi datele din backup (§7).

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
`/opt/flirt-backups` pe host. Sincronizează directorul **off-site** (un backup pe
același disc dispare odată cu discul).

```sh
k create job --from=cronjob/backup-db backup-manual     # backup acum
ls -lt /opt/flirt-backups | head

# Restaurare DB — oprește întâi scrierile (api la 0 + purge suspendat):
k3s kubectl -n flirt scale deploy/api --replicas=0
k3s kubectl -n flirt patch cronjob purge -p '{"spec":{"suspend":true}}'
gunzip -c /opt/flirt-backups/flirt-<stamp>.sql.gz \
  | k3s kubectl -n flirt exec -i db-0 -c postgres -- \
      sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
k3s kubectl -n flirt patch cronjob purge -p '{"spec":{"suspend":false}}'
k3s kubectl -n flirt scale deploy/api --replicas=2     # HPA preia de aici

# Restaurare media: dezarhivează în directorul PV-ului media
PV=$(k get pvc media -o jsonpath='{.spec.volumeName}')
DIR=$(k3s kubectl get pv "$PV" -o jsonpath='{.spec.hostPath.path}{.spec.local.path}')
tar -xzf /opt/flirt-backups/media/media-<stamp>.tar.gz -C "$DIR" --strip-components=2
chown -R 1000:1000 "$DIR"
```

Dump-urile `backup-db` conțin `--clean --if-exists` (suprascriu tabelele existente).
