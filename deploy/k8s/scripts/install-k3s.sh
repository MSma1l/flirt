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

status() {
    k3s --version 2>/dev/null | head -1 || echo "k3s: neinstalat"
    systemctl is-active k3s 2>/dev/null || true
    [ -f "$K3S_CONFIG" ] && { echo "--- $K3S_CONFIG"; cat "$K3S_CONFIG"; }
    kc get nodes -o wide 2>/dev/null || true
    kc -n cert-manager get deploy 2>/dev/null || true
    kc -n kube-system get deploy traefik svc traefik 2>/dev/null || true
}

case "${1:-}" in
    phase1) phase1 ;;
    phase2) phase2 ;;
    status) status ;;
    *) echo "utilizare: $0 phase1|phase2|status" >&2; exit 2 ;;
esac
