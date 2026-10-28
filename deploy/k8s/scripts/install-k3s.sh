#!/usr/bin/env bash
# FLIRT — instalarea k3s (un singur nod), singurul mod de a rula producția.
#
#   install-k3s.sh phase1   k3s + cert-manager + resurse de cluster, cu Traefik și
#                           ServiceLB OPRITE (aplicația se poate pregăti fără să
#                           ocupe încă 80/443). Idempotent: ce e deja instalat
#                           (la versiunea fixată) e sărit.
#   install-k3s.sh phase2   scoate lista `disable:` din config și repornește k3s
#                           → Traefik + ServiceLB preiau 80/443. Cere porturile
#                           80/443 LIBERE.
#   install-k3s.sh host-hardening
#                           configurarea hostului (idempotent, rulat și la finalul
#                           phase1): rotația log-urilor în kubelet, retenția
#                           journald, timer-ul flirt-log-retention (LOG_RETENTION_DAYS
#                           promis în Politica de confidențialitate), /opt/flirt-backups
#                           al uid 1000 (CronJob-urile de backup rulează non-root).
#                           Repornește k3s DOAR dacă config.yaml s-a schimbat.
#   install-k3s.sh status   ce e instalat.
#
# Server nou: phase1 → deploy.sh → phase2 (runbook: deploy/k8s/scripts/README.md).
# Pe serverul actual, cutover-ul din docker compose s-a făcut pe 28.10.2026.
#
# Fără `curl | sh`: binarul k3s fixat se descarcă din GitHub Releases și se
# verifică cu sha256sum-<arch>.txt din ACEEAȘI versiune; install.sh e luat de la
# tag-ul fixat și rulat cu INSTALL_K3S_SKIP_DOWNLOAD=true.
set -euo pipefail

LOG_TAG=install-k3s
# shellcheck source=lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

K3S_VERSION="${K3S_VERSION:-v1.36.5+k3s1}"
CERT_MANAGER_VERSION="${CERT_MANAGER_VERSION:-v1.21.3}"
K3S_CONFIG=/etc/rancher/k3s/config.yaml
HOST_DIR="$REPO_ROOT/deploy/k8s/host"
BACKUP_HOST_DIR="${BACKUP_HOST_DIR:-/opt/flirt-backups}"
ARCHIVE_DIR="${ARCHIVE_DIR:-/opt/flirt-arhiva-compose}"
BACKUP_UID="${BACKUP_UID:-1000}"
BACKUP_GID="${BACKUP_GID:-1000}"
# Rotația după mărime a log-urilor de containere (kubelet). Limita în TIMP o
# aplică flirt-log-retention.timer (host-hardening).
KUBELET_LOG_ARGS=(container-log-max-size=10Mi container-log-max-files=5)

# Configul phase1. `secrets-encryption`: Secret-urile (inclusiv flirt-env cu
# parola DB și cheia JWT) sunt criptate în datastore. Kubeconfig doar pentru root.
# API-ul k3s (6443) NU se deschide în ufw — kubectl se folosește doar local.
write_config_phase1() {
    if [ -f "$K3S_CONFIG" ]; then
        log "$K3S_CONFIG există deja → nu-l suprascriu"
        grep -q 'secrets-encryption: *true' "$K3S_CONFIG" || warn "secrets-encryption nu e activat în $K3S_CONFIG"
        return 0
    fi
    install -d -m 0755 /etc/rancher/k3s
    (umask 077 && cat > "$K3S_CONFIG" <<'YAML'
# FLIRT — config k3s (vezi deploy/k8s/scripts/install-k3s.sh)
write-kubeconfig-mode: "0600"
secrets-encryption: true
# Rotația log-urilor de containere (după mărime); retenția în timp: host-hardening.
kubelet-arg:
  - "container-log-max-size=10Mi"
  - "container-log-max-files=5"
# phase1: Traefik + ServiceLB OPRITE până la phase2 (80/443 încă neocupate).
# `install-k3s.sh phase2` scoate lista de mai jos și repornește k3s.
disable:
  - traefik
  - servicelb
YAML
    )
    log "am scris $K3S_CONFIG"
}

wait_node_ready() {
    local _
    for _ in $(seq 1 60); do
        if kc get nodes --no-headers 2>/dev/null | awk '{print $2}' | grep -qx Ready; then
            log "nodul k3s e Ready"
            return 0
        fi
        sleep 5
    done
    die "nodul k3s nu e Ready după 5 minute (journalctl -u k3s)"
}

install_k3s() {
    if command -v k3s >/dev/null 2>&1 && k3s --version 2>/dev/null | grep -qF "$K3S_VERSION" \
        && systemctl is-active --quiet k3s; then
        log "k3s $K3S_VERSION e deja instalat și activ → sar"
        return 0
    fi
    if command -v k3s >/dev/null 2>&1 && [ "${K3S_FORCE:-0}" != 1 ]; then
        die "e instalat alt k3s ($(k3s --version | head -1)); K3S_FORCE=1 ca să instalez $K3S_VERSION"
    fi

    local arch suffix tmp enc
    case "$(uname -m)" in
        x86_64|amd64)  arch=amd64; suffix="" ;;
        aarch64|arm64) arch=arm64; suffix="-arm64" ;;
        *) die "arhitectură nesuportată: $(uname -m)" ;;
    esac
    enc="${K3S_VERSION//+/%2B}"
    tmp="$(mktemp -d)"

    log "descarc k3s $K3S_VERSION ($arch) + sume de control"
    curl -fsSL --retry 3 -o "$tmp/k3s$suffix" "https://github.com/k3s-io/k3s/releases/download/$enc/k3s$suffix"
    curl -fsSL --retry 3 -o "$tmp/sha256sum-$arch.txt" "https://github.com/k3s-io/k3s/releases/download/$enc/sha256sum-$arch.txt"
    ( cd "$tmp" && grep -E "[[:space:]]k3s${suffix}\$" "sha256sum-$arch.txt" | sha256sum -c - ) \
        || die "sha256 NU corespunde pentru k3s$suffix — opresc"
    install -m 0755 "$tmp/k3s$suffix" /usr/local/bin/k3s

    curl -fsSL --retry 3 -o "$tmp/install.sh" "https://raw.githubusercontent.com/k3s-io/k3s/$enc/install.sh"
    log "rulez install.sh ($K3S_VERSION, fără descărcare; citește $K3S_CONFIG)"
    INSTALL_K3S_SKIP_DOWNLOAD=true INSTALL_K3S_VERSION="$K3S_VERSION" sh "$tmp/install.sh"
    rm -rf "$tmp"
}

# Rețelele de poduri (10.42/16) și servicii (10.43/16) trebuie să treacă de ufw,
# altfel DNS-ul din cluster și traficul pod→service cad tăcut.
configure_ufw() {
    if ! command -v ufw >/dev/null 2>&1 || ! ufw status | grep -q 'Status: active'; then
        log "ufw inactiv/absent → nimic de configurat"
        return 0
    fi
    ufw allow from 10.42.0.0/16 to any comment 'k3s pods' >/dev/null
    ufw allow from 10.43.0.0/16 to any comment 'k3s services' >/dev/null
    log "ufw: permis 10.42.0.0/16 și 10.43.0.0/16"
    if ufw status | grep -E '^6443[/ ]' | grep -q 'Anywhere'; then
        warn "portul 6443 (API k3s) e DESCHIS public în ufw — închide-l: ufw delete allow 6443"
    fi
}

install_cert_manager() {
    local cur
    cur="$(kc -n cert-manager get deploy cert-manager -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
    if [[ "$cur" == *":$CERT_MANAGER_VERSION" ]]; then
        log "cert-manager $CERT_MANAGER_VERSION e deja instalat → sar"
    else
        [ -n "$cur" ] && log "cert-manager existent: $cur → aplic $CERT_MANAGER_VERSION"
        local f
        f="$(mktemp)"
        curl -fsSL --retry 3 -o "$f" \
            "https://github.com/cert-manager/cert-manager/releases/download/$CERT_MANAGER_VERSION/cert-manager.yaml"
        kc apply -f "$f"
        rm -f "$f"
    fi
    log "aștept cert-manager"
    kc -n cert-manager rollout status deploy/cert-manager deploy/cert-manager-webhook deploy/cert-manager-cainjector --timeout=300s
}

phase1() {
    require_root
    require_cmd curl sha256sum systemctl
    write_config_phase1
    install_k3s
    wait_node_ready
    configure_ufw
    install_cert_manager
    if [ -r "$ENV_FILE" ]; then
        apply_cluster
    else
        warn "$ENV_FILE lipsește → resursele de cluster se aplică la primul deploy.sh"
    fi
    host_hardening
    log "phase1 GATA. Urmează: deploy/k8s/scripts/deploy.sh, apoi install-k3s.sh phase2"
}

# Scoate `disable:` (listă bloc sau inline) din config.
strip_disable() {
    awk '
        /^disable:[[:space:]]*$/ { skip = 1; next }
        /^disable:/              { next }
        skip && /^[[:space:]]+-/ { next }
        { skip = 0; print }
    ' "$1"
}

ports_free() {
    local busy
    busy="$(ss -ltnH '( sport = :80 or sport = :443 )' 2>/dev/null || true)"
    if [ -n "$busy" ]; then
        printf '%s\n' "$busy" >&2
        return 1
    fi
}

phase2() {
    require_root
    require_cmd ss systemctl
    [ -f "$K3S_CONFIG" ] || die "$K3S_CONFIG lipsește — rulează întâi phase1"
    if ! grep -q '^disable:' "$K3S_CONFIG"; then
        log "$K3S_CONFIG nu mai are lista disable → Traefik/ServiceLB deja activate"
    else
        ports_free || die "porturile 80/443 sunt încă ocupate de alt proces (vezi lista de mai sus)"
        cp -p "$K3S_CONFIG" "$K3S_CONFIG.phase1.bak"
        strip_disable "$K3S_CONFIG.phase1.bak" > "$K3S_CONFIG.new"
        chmod 0600 "$K3S_CONFIG.new"
        mv "$K3S_CONFIG.new" "$K3S_CONFIG"
        log "am scos lista disable (copie: $K3S_CONFIG.phase1.bak); repornesc k3s"
        # Pod-urile NU se opresc la repornirea serviciului k3s (containerd-shim).
        systemctl restart k3s
        wait_node_ready
    fi
    log "aștept Traefik"
    local _
    for _ in $(seq 1 60); do
        kc -n kube-system get deploy traefik >/dev/null 2>&1 && break
        sleep 5
    done
    kc -n kube-system rollout status deploy/traefik --timeout=300s
    for _ in $(seq 1 60); do
        if kc -n kube-system get svc traefik -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null | grep -q .; then
            log "Traefik LoadBalancer: $(kc -n kube-system get svc traefik -o jsonpath='{.status.loadBalancer.ingress[*].ip}')"
            log "phase2 GATA"
            return 0
        fi
        sleep 5
    done
    die "Service-ul traefik nu a primit IP de la ServiceLB (kubectl -n kube-system get pods | grep svclb)"
}

# --------------------------------------------------------------------------- #
# host-hardening
# --------------------------------------------------------------------------- #
# Valoarea unei chei din .env (curățat ca pentru secret, FĂRĂ validare: merge și
# pe un server nou cu .env incomplet). Gol dacă .env lipsește.
host_env() {
    [ -r "$ENV_FILE" ] || return 0
    local t v
    t="$(umask 077 && mktemp)"
    env_clean "$ENV_FILE" "$t" 2>/dev/null || true
    v="$(env_get "$t" "$1")"
    rm -f "$t"
    printf '%s' "$v"
}

retention_days() {
    local d
    d="$(host_env LOG_RETENTION_DAYS)"
    d="${d:-30}"
    case "$d" in *[!0-9]*) die "LOG_RETENTION_DAYS invalid în $ENV_FILE: $d" ;; esac
    [ "$d" -ge 2 ] || die "LOG_RETENTION_DAYS trebuie să fie >= 2"
    printf '%s' "$d"
}

# Adaugă/corectează intrările KUBELET_LOG_ARGS în lista bloc `kubelet-arg:` din
# config.yaml (o creează dacă lipsește); restul fișierului rămâne neatins, stilul
# de ghilimele și indentarea listei existente se păstrează. Refuză o listă inline
# (`kubelet-arg: [...]`) — de corectat manual. Scrie rezultatul pe stdout.
kubelet_args_render() {
    python3 - "$@" <<'PYEOF'
import re, sys

path, wanted = sys.argv[1], sys.argv[2:]
want = dict(a.split("=", 1) for a in wanted)
lines = open(path, encoding="utf-8").read().splitlines()

def unquote(v):
    v = re.sub(r"\s+#.*$", "", v).strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        v = v[1:-1]
    return v

idx = next((i for i, l in enumerate(lines) if re.match(r"^kubelet-arg\s*:", l)), None)
if idx is None:
    if lines and lines[-1].strip():
        lines.append("")
    lines.append("# Rotația log-urilor de containere (install-k3s.sh host-hardening).")
    lines.append("kubelet-arg:")
    lines += ['  - "%s=%s"' % kv for kv in want.items()]
else:
    rest = re.sub(r"\s*#.*$", "", lines[idx].split(":", 1)[1]).strip()
    if rest:
        sys.exit("kubelet-arg nu e listă bloc (`kubelet-arg: %s`) — corectează manual" % rest)
    indent, quote, last, seen, first = "  ", '"', idx, set(), True
    j = idx + 1
    while j < len(lines):
        l = lines[j]
        m = re.match(r"^(\s*)-(\s+(.*))?$", l)
        if m:
            raw = (m.group(3) or "").strip()
            if first:
                indent, first = m.group(1), False
                quote = raw[0] if raw[:1] in ("'", '"') else ""
            val = unquote(raw)
            key = val.split("=", 1)[0]
            if key in want:
                seen.add(key)
                if val != "%s=%s" % (key, want[key]):
                    lines[j] = "%s- %s%s=%s%s" % (m.group(1), quote, key, want[key], quote)
            last = j
        elif l.strip() and not l.lstrip().startswith("#"):
            break
        j += 1
    lines[last + 1:last + 1] = [
        "%s- %s%s=%s%s" % (indent, quote, k, v, quote) for k, v in want.items() if k not in seen
    ]

sys.stdout.write("\n".join(lines) + "\n")
PYEOF
}

# (a) Rotația log-urilor în kubelet. Repornește k3s DOAR dacă fișierul s-a schimbat.
# Podurile NU se opresc la repornirea serviciului k3s (containerd-shim le ține în
# viață); kubelet aplică noile limite și containerelor deja pornite.
ensure_kubelet_log_rotation() {
    [ -f "$K3S_CONFIG" ] || die "$K3S_CONFIG lipsește — rulează întâi phase1"
    local new bak
    new="$(umask 077 && mktemp)"
    if ! kubelet_args_render "$K3S_CONFIG" "${KUBELET_LOG_ARGS[@]}" > "$new"; then
        rm -f "$new"
        die "nu pot actualiza kubelet-arg în $K3S_CONFIG"
    fi
    if cmp -s "$new" "$K3S_CONFIG"; then
        rm -f "$new"
        log "kubelet-arg: rotația log-urilor deja configurată (${KUBELET_LOG_ARGS[*]})"
        return 0
    fi
    bak="$K3S_CONFIG.bak.$(date +%Y%m%d-%H%M%S)"
    cp -p "$K3S_CONFIG" "$bak"
    install -m 0600 "$new" "$K3S_CONFIG"
    rm -f "$new"
    log "kubelet-arg actualizat în $K3S_CONFIG (copie: $bak):"
    diff -u "$bak" "$K3S_CONFIG" >&2 || true
    if systemctl is-active --quiet k3s; then
        log "repornesc k3s (podurile continuă să ruleze)"
        systemctl restart k3s
        wait_node_ready
    fi
}

# (b) journald, aceeași limită în timp. journald șterge fișiere ÎNTREGI ⇒
# MaxFileSec=1day (un fișier pe zi) + o zi de marjă: nicio intrare nu trece de termen.
configure_journald() {
    local days="$1" dst=/etc/systemd/journald.conf.d/flirt-retention.conf new
    new="$(mktemp)"
    cat > "$new" <<EOF
# FLIRT — retenția jurnalelor (LOG_RETENTION_DAYS=$days). Gestionat de
# deploy/k8s/scripts/install-k3s.sh host-hardening — nu edita manual.
[Journal]
MaxRetentionSec=$((days - 1))day
MaxFileSec=1day
SystemMaxUse=1G
EOF
    if cmp -s "$new" "$dst"; then
        rm -f "$new"
        log "journald: retenția e deja configurată ($dst)"
        return 0
    fi
    install -d -m 0755 "$(dirname "$dst")"
    install -m 0644 "$new" "$dst"
    rm -f "$new"
    systemctl restart systemd-journald
    log "journald: MaxRetentionSec=$((days - 1))day MaxFileSec=1day SystemMaxUse=1G ($dst)"
}

# Copiază $1 în $2 (mod $3) doar dacă diferă. 0 = a copiat.
install_if_changed() {
    cmp -s "$1" "$2" && return 1
    install -m "$3" "$1" "$2"
}

# (c)+(d) Timer-ul zilnic de retenție (sursele în deploy/k8s/host/).
install_log_retention() {
    local days="$1" changed=0 new
    install_if_changed "$HOST_DIR/flirt-log-retention.sh" /usr/local/sbin/flirt-log-retention 0755 && changed=1
    install_if_changed "$HOST_DIR/flirt-log-retention.service" /etc/systemd/system/flirt-log-retention.service 0644 && changed=1
    install_if_changed "$HOST_DIR/flirt-log-retention.timer" /etc/systemd/system/flirt-log-retention.timer 0644 && changed=1
    new="$(mktemp)"
    printf '# Gestionat de install-k3s.sh host-hardening (LOG_RETENTION_DAYS din .env).\nLOG_RETENTION_DAYS=%s\n' "$days" > "$new"
    install_if_changed "$new" /etc/default/flirt-log-retention 0644 && changed=1
    rm -f "$new"
    systemctl daemon-reload
    systemctl enable --now flirt-log-retention.timer >/dev/null 2>&1 \
        || die "nu pot activa flirt-log-retention.timer (journalctl -xe)"
    if [ "$changed" = 1 ]; then
        log "flirt-log-retention instalat/actualizat → rulez o dată acum"
        systemctl start flirt-log-retention.service \
            || warn "flirt-log-retention a eșuat (journalctl -u flirt-log-retention)"
        journalctl -u flirt-log-retention -n 1 -o cat --no-pager >&2 2>/dev/null || true
    else
        log "flirt-log-retention: neschimbat, timer activ"
    fi
}

# CronJob-urile backup-db / backup-media rulează ca uid/gid 1000 și scriu/șterg în
# /opt/flirt-backups doar `<POSTGRES_DB>-*.sql.gz` (+ `.partial`) la rădăcină și
# `media/media-*.tar.gz` (+ `.partial`). Doar acestea trec la 1000.
# Arhiva sistemului compose (cutover 28.10.2026) stă ÎN AFARA acestui director,
# în $ARCHIVE_DIR (root, 0700): un subdirector root-only aici face `find`-ul de
# retenție din joburi (busybox) să eșueze cu „Permission denied”, iar uid 1000
# l-ar putea redenumi. O mutăm automat dacă o găsim în locul vechi.
prepare_backup_dir() {
    local d="$BACKUP_HOST_DIR" db n
    [ -L "$d" ] && die "$d e symlink — refuz chown"
    [ -L "$d/media" ] && die "$d/media e symlink — refuz chown"
    db="$(host_env POSTGRES_DB)"
    db="${db:-flirt}"
    mkdir -p "$d/media"
    chown "$BACKUP_UID:$BACKUP_GID" "$d"
    chmod 0750 "$d"
    n="$(find "$d" -maxdepth 1 -type f \( -name "${db}-*.sql.gz*" -o -name 'flirt-*.sql.gz*' \) \
        ! -user "$BACKUP_UID" -print -exec chown "$BACKUP_UID:$BACKUP_GID" {} + | wc -l)"
    chown -R -h "$BACKUP_UID:$BACKUP_GID" "$d/media"
    chmod 0750 "$d/media"
    if [ -d "$d/arhiva-compose" ] && [ ! -L "$d/arhiva-compose" ]; then
        [ -e "$ARCHIVE_DIR" ] && die "$d/arhiva-compose și $ARCHIVE_DIR există amândouă — unește-le manual"
        mv "$d/arhiva-compose" "$ARCHIVE_DIR"
        log "arhiva compose mutată: $d/arhiva-compose → $ARCHIVE_DIR"
    fi
    if [ -d "$ARCHIVE_DIR" ] && [ ! -L "$ARCHIVE_DIR" ]; then
        chown -R root:root "$ARCHIVE_DIR"
        chmod 0700 "$ARCHIVE_DIR"
    fi
    log "backup-uri: $d → $BACKUP_UID:$BACKUP_GID 0750 ($n dump-uri trecute la $BACKUP_UID, media/ recursiv; arhiva: $ARCHIVE_DIR root 0700)"
}

# backup-media (uid 1000, fără capabilități) arhivează volumul `media`: un fișier
# root 0600 acolo ar face tar-ul să eșueze. api rulează tot ca 1000 ⇒ chown sigur.
K3S_STORAGE="${K3S_STORAGE:-/var/lib/rancher/k3s/storage}"
fix_media_pv_owner() {
    local dir n found=0
    while IFS= read -r -d '' dir; do
        found=1
        n="$(find "$dir" \( ! -user "$BACKUP_UID" -o ! -group "$BACKUP_GID" \) -print \
            -exec chown -h "$BACKUP_UID:$BACKUP_GID" {} + | wc -l)"
        log "media PV $dir: $n intrări trecute la $BACKUP_UID:$BACKUP_GID"
    done < <(find "$K3S_STORAGE" -mindepth 1 -maxdepth 1 -type d -name '*_flirt_media' -print0 2>/dev/null)
    [ "$found" = 1 ] || log "media PV: niciun director *_flirt_media în $K3S_STORAGE (încă nu există) → sar"
}

host_hardening() {
    require_root
    require_cmd python3 systemctl install cmp diff journalctl
    local days
    days="$(retention_days)"
    log "host-hardening (LOG_RETENTION_DAYS=$days)"
    ensure_kubelet_log_rotation
    configure_journald "$days"
    install_log_retention "$days"
    prepare_backup_dir
    fix_media_pv_owner
    log "host-hardening GATA"
}

status() {
    k3s --version 2>/dev/null | head -1 || echo "k3s: neinstalat"
    systemctl is-active k3s 2>/dev/null || true
    [ -f "$K3S_CONFIG" ] && { echo "--- $K3S_CONFIG"; cat "$K3S_CONFIG"; }
    kc get nodes -o wide 2>/dev/null || true
    kc -n cert-manager get deploy 2>/dev/null || true
    kc -n kube-system get deploy traefik svc traefik 2>/dev/null || true
    systemctl list-timers flirt-log-retention.timer --no-pager 2>/dev/null || true
    ls -ld "$BACKUP_HOST_DIR" 2>/dev/null || true
}

case "${1:-}" in
    phase1) phase1 ;;
    phase2) phase2 ;;
    host-hardening) host_hardening ;;
    status) status ;;
    *) echo "utilizare: $0 phase1|phase2|host-hardening|status" >&2; exit 2 ;;
esac
