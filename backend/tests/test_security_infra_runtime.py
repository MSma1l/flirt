"""Hardening de infrastructură: gunicorn, Redis, imagini, resurse, rețea, backup, push.

Din 28.10.2026 producția rulează pe k3s: sursele de adevăr sunt
deploy/k8s/manifests/*.yaml (+ deploy/k8s/images/web/). backend/docker-compose.yml
a rămas DOAR pentru dezvoltare (db + redis + api).

CE VERIFICĂM
------------
1. gunicorn NU mai are încredere în X-Forwarded-* de la oricine (`*`): implicit
   doar subrețeaua Docker a containerului (detectată din /proc/net/route).
2. Redis: parolă OPȚIONALĂ — fără REDIS_PASSWORD totul rămâne ca înainte
   (compose de dev ȘI StatefulSet-ul k8s).
3. Imagini pe versiune fixă (fără `:latest`); `api` (și orice container) cu
   limite de CPU/RAM; compose-ul de dev nu publică db/redis.
4. Rețea k8s: db/redis/api doar ClusterIP, fără hostPort/hostNetwork,
   NetworkPolicy default-deny pe ingress ȘI egress + reguli explicite (doar api
   iese în internet, pe :443, fără rangurile private/metadata); containere fără
   privilegii, compatibile Pod Security `restricted`, rădăcină read-only.
5. Backup-uri (CronJob-uri): non-root (1000:1000, fără capabilități), umask 077,
   în afara repo-ului (/opt/flirt-backups prin PVC-ul `backups`, Retain),
   retenție limitată la tiparul propriu.
6. Push: tokenurile nu mai apar întregi în log-uri.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import textwrap

import httpx
import pytest
import yaml

from tests.test_nginx_ratelimit_zones import BACKEND

REPO = BACKEND.parent
ENTRYPOINT = BACKEND / "entrypoint.sh"
COMPOSE = BACKEND / "docker-compose.yml"
K8S = REPO / "deploy" / "k8s"
MANIFESTS = K8S / "manifests"


def _docs() -> list[tuple[str, dict]]:
    """Toate resursele k8s din manifests/ (inclusiv jobs/ și cluster/)."""
    out = []
    for path in sorted(MANIFESTS.rglob("*.yaml")):
        for doc in yaml.safe_load_all(path.read_text(encoding="utf-8")):
            if doc and "kind" in doc:
                out.append((str(path.relative_to(MANIFESTS)), doc))
    return out


def _resource(kind: str, name: str) -> dict:
    for _, doc in _docs():
        if doc["kind"] == kind and doc["metadata"]["name"] == name:
            return doc
    raise AssertionError(f"{kind}/{name} lipsește din deploy/k8s/manifests")


def _pod_spec(doc: dict) -> dict | None:
    """Spec-ul de pod al unui workload (Deployment/StatefulSet/Job/CronJob)."""
    spec = doc.get("spec", {})
    if doc["kind"] == "CronJob":
        spec = spec["jobTemplate"]["spec"]
    template = spec.get("template")
    return template["spec"] if template else None


def _workloads() -> list[tuple[str, dict]]:
    """(Kind/nume, pod spec) pentru toate workload-urile."""
    return [
        (f"{doc['kind']}/{doc['metadata']['name']}", spec)
        for _, doc in _docs()
        if (spec := _pod_spec(doc)) is not None
    ]


def _containers() -> list[tuple[str, dict]]:
    out = []
    for name, spec in _workloads():
        for container in spec.get("initContainers", []) + spec["containers"]:
            out.append((f"{name}/{container['name']}", container))
    return out


def _service(name: str) -> str:
    compose = COMPOSE.read_text(encoding="utf-8")
    match = re.search(rf"^  {re.escape(name)}:\n((?:    .*\n|\s*\n)+)", compose, re.MULTILINE)
    assert match, f"serviciul {name} lipsește din docker-compose.yml"
    return match.group(1)


# --------------------------------------------------------------------------- #
# 1. --forwarded-allow-ips
# --------------------------------------------------------------------------- #


def _entry() -> str:
    return ENTRYPOINT.read_text(encoding="utf-8")


def _route_parser() -> str:
    match = re.search(r"<<'PY'[^\n]*\n(.*?)\nPY\n", _entry(), re.DOTALL)
    assert match, "parserul /proc/net/route lipsește din entrypoint.sh"
    return match.group(1)


def test_gunicorn_nu_mai_are_incredere_in_oricine():
    text = _entry()
    assert '"${FORWARDED_ALLOW_IPS:-*}"' not in text
    assert '--forwarded-allow-ips "${FORWARDED_ALLOW_IPS}"' in text


ROUTE_TABLE = textwrap.dedent(
    """\
    Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT
    eth0\t00000000\t010012AC\t0003\t0\t0\t0\t00000000\t0\t0\t0
    eth0\t000012AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0
    eth1\t0000A8C0\t00000000\t0001\t0\t0\t0\t00F0FFFF\t0\t0\t0
    eth0\t08080808\t010012AC\t0003\t0\t0\t0\tFFFFFFFF\t0\t0\t0
    """
)


def test_detectia_subretelei_docker(tmp_path):
    """Rutele directe (fără gateway) → subrețelele compose; ruta implicită și
    rutele prin gateway NU intră (altfel am avea încredere în internet)."""
    route = tmp_path / "route"
    route.write_text(ROUTE_TABLE, encoding="ascii")
    out = subprocess.run(
        ["python3", "-", str(route)],
        input=_route_parser(),
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    assert out == "127.0.0.1,172.18.0.0/16,192.168.0.0/20"


def _run_forwarded_block(env: dict[str, str]) -> str:
    """Rulează DOAR blocul FORWARDED_ALLOW_IPS din entrypoint (sh real)."""
    text = _entry()
    start = text.index('if [ "${FORWARDED_ALLOW_IPS:-}" = "*" ]; then')
    end = text.index('echo "→ Proxy-uri de încredere')
    script = "set -e\n" + text[start:end] + 'printf "%s" "$FORWARDED_ALLOW_IPS"\n'
    full_env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), **env}
    return subprocess.run(
        ["/bin/sh", "-c", script], env=full_env, capture_output=True, text=True, check=True
    ).stdout


@pytest.mark.skipif(os.path.exists("/proc/net/route"), reason="testează fallback-ul (fără /proc)")
@pytest.mark.parametrize("value", ["", "*"])
def test_fara_valoare_sau_stea_nu_ramane_wildcard(value):
    out = _run_forwarded_block({"FORWARDED_ALLOW_IPS": value} if value else {})
    entries = out.strip().splitlines()[-1].split(",")
    assert entries and "*" not in entries
    assert "0.0.0.0/0" not in entries


def test_valoarea_explicita_e_respectata():
    out = _run_forwarded_block({"FORWARDED_ALLOW_IPS": "172.30.0.0/24,127.0.0.1"})
    assert out.strip().splitlines()[-1] == "172.30.0.0/24,127.0.0.1"


def test_workerii_respecta_limita_cgroup():
    text = _entry()
    assert "/sys/fs/cgroup/memory.max" in text
    assert "/sys/fs/cgroup/cpu.max" in text


# --------------------------------------------------------------------------- #
# 2. Redis cu parolă opțională
# --------------------------------------------------------------------------- #


def test_redis_requirepass_doar_daca_e_setata_parola():
    redis = _service("redis")
    assert "REDIS_PASSWORD: ${REDIS_PASSWORD:-}" in redis
    # `$$` → expandat de shell-ul din container; `:+` → nimic când e gol.
    assert '$${REDIS_PASSWORD:+--requirepass "$$REDIS_PASSWORD"}' in redis
    assert "REDISCLI_AUTH" in redis and "grep -q PONG" in redis


def test_redis_url_implicit_include_parola_cand_exista():
    api = _service("api")
    assert "REDIS_URL: ${REDIS_URL:-redis://${REDIS_PASSWORD:+:${REDIS_PASSWORD}@}redis:6379/0}" in api


@pytest.mark.parametrize(
    ("password", "expected"),
    [("", "redis-server --save 60 1"), ("abc", "redis-server --save 60 1 --requirepass abc")],
)
def test_comanda_redis_expandata_de_shell(password, expected):
    redis = _service("redis")
    cmd = re.search(r"- '(exec redis-server[^']*)'", redis).group(1).replace("$$", "$")
    script = cmd.replace("exec redis-server", 'printf "%s " redis-server', 1)
    out = subprocess.run(
        ["/bin/sh", "-c", script],
        env={"PATH": "/usr/bin:/bin", "REDIS_PASSWORD": password},
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    assert out == expected


@pytest.mark.parametrize(
    ("password", "expected"),
    [("", "redis-server --save 60 1"), ("abc", "redis-server --save 60 1 --requirepass abc")],
)
def test_comanda_redis_k8s_expandata_de_shell(password, expected):
    """Același comportament în StatefulSet-ul `redis`: parola vine din secret
    (cheie OPȚIONALĂ), iar `${...}` e expandat de shell-ul din container."""
    spec = _pod_spec(_resource("StatefulSet", "redis"))
    container = spec["containers"][0]
    env = {e["name"]: e for e in container["env"]}
    ref = env["REDIS_PASSWORD"]["valueFrom"]["secretKeyRef"]
    assert ref["name"] == "flirt-env" and ref.get("optional") is True

    command = container["command"]
    assert command[:2] == ["/bin/sh", "-c"]
    script = command[2].replace("exec redis-server", 'printf "%s " redis-server', 1)
    out = subprocess.run(
        ["/bin/sh", "-c", script],
        env={"PATH": "/usr/bin:/bin", "REDIS_PASSWORD": password},
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    assert out == expected


@pytest.mark.skipif(shutil.which("docker") is None, reason="docker nu e instalat")
def test_compose_config_valid(tmp_path):
    """`docker compose config` pe o COPIE (cu un .env gol alături): validează
    sintaxa/interpolarea fără să atingă repo-ul."""
    shutil.copy(COMPOSE, tmp_path / "docker-compose.yml")
    (tmp_path / ".env").write_text("", encoding="utf-8")
    env = tmp_path / "env"
    env.write_text("DOMAIN=api.test.invalid\nREDIS_PASSWORD=abc\n", encoding="utf-8")
    result = subprocess.run(
        [
            "docker", "compose", "-f", str(tmp_path / "docker-compose.yml"),
            "--env-file", str(env), "config",
        ],
        capture_output=True,
        text=True,
    )
    if "not a docker command" in result.stderr or "unknown command" in result.stderr:
        pytest.skip(result.stderr.strip())
    assert result.returncode == 0, result.stderr
    assert "REDIS_URL: redis://:abc@redis:6379/0" in result.stdout


# --------------------------------------------------------------------------- #
# 3. Imagini fixe + limite de resurse + compose-ul de dev
# --------------------------------------------------------------------------- #

# Pulled din registry → versiune explicită (cu cifre), niciodată `latest`.
PINNED = re.compile(r"^[a-z0-9./_-]+:(?!latest$)[A-Za-z0-9._-]*\d[A-Za-z0-9._-]*$")
# Construite local și importate în containerd (imagePullPolicy: Never): tag-ul
# e mutat de deploy.sh pe commit-ul livrat (`current`) / substituit (`__IMAGE__`).
LOCAL = re.compile(r"^flirt-(api|web):(current|__IMAGE__)$")


def test_dev_compose_are_doar_db_redis_api():
    services = yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))["services"]
    assert set(services) == {"db", "redis", "api"}, (
        "compose e DOAR pentru dezvoltare; nginx/certbot/backup trăiesc în deploy/k8s/"
    )


@pytest.mark.parametrize("service", ["db", "redis"])
def test_dev_compose_nu_publica_db_redis(service):
    """Un Redis/Postgres publicat pe 0.0.0.0 e preluat în minute; pe laptop se
    publică explicit pe 127.0.0.1 din override, nu din fișierul de bază."""
    body = yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))["services"][service]
    assert "ports" not in body
    assert "network_mode" not in body


def test_nicio_imagine_latest():
    assert not re.search(r"^\s+image:\s*\S+:latest\s*$", COMPOSE.read_text(encoding="utf-8"), re.MULTILINE)
    for name, container in _containers():
        image = container["image"]
        assert not image.endswith(":latest") and ":" in image, f"{name}: {image}"


def test_imaginile_k8s_sunt_pe_versiune_fixa():
    """Echivalentul vechiului „certbot pe versiune fixă": un `kubectl rollout
    restart` nu are voie să tragă o versiune nouă, netestată, din registry."""
    for name, container in _containers():
        image = container["image"]
        if container.get("imagePullPolicy") == "Never":
            assert LOCAL.match(image), f"{name}: imagine locală neașteptată {image}"
        else:
            assert PINNED.match(image), f"{name}: imagine fără versiune fixă {image}"


def test_imaginile_de_baza_din_dockerfile_sunt_fixe():
    for dockerfile in (K8S / "images" / "web" / "Dockerfile", BACKEND / "Dockerfile"):
        if not dockerfile.exists():
            continue
        for image in re.findall(r"^FROM\s+(\S+)", dockerfile.read_text(encoding="utf-8"), re.MULTILINE):
            assert PINNED.match(image), f"{dockerfile.name}: FROM {image}"


def test_api_are_limite_de_resurse():
    spec = _pod_spec(_resource("Deployment", "api"))
    resources = spec["containers"][0]["resources"]
    for key in ("cpu", "memory"):
        assert resources["limits"].get(key), f"api fără limits.{key}"
        assert resources["requests"].get(key), f"api fără requests.{key} (HPA/scheduler)"


def test_toate_containerele_au_limite():
    """Un container fără limită poate înfometa nodul (unul singur!) — inclusiv db."""
    for name, container in _containers():
        limits = container.get("resources", {}).get("limits", {})
        assert limits.get("cpu") and limits.get("memory"), f"{name} fără limits cpu/memory"


# --------------------------------------------------------------------------- #
# 4. Rețea + privilegii (k8s)
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("name", ["db", "redis", "api", "web"])
def test_serviceurile_interne_sunt_clusterip(name):
    """Nimic nu e expus direct în afara clusterului; doar Traefik (Ingress → web)."""
    spec = _resource("Service", name)["spec"]
    assert spec.get("type", "ClusterIP") == "ClusterIP"
    assert "externalIPs" not in spec
    for port in spec["ports"]:
        assert "nodePort" not in port


def test_niciun_service_nodeport_sau_loadbalancer():
    for path, doc in _docs():
        if doc["kind"] == "Service":
            assert doc["spec"].get("type", "ClusterIP") == "ClusterIP", f"{path}: {doc['metadata']['name']}"


def test_niciun_pod_pe_reteaua_sau_namespace_ul_hostului():
    for name, spec in _workloads():
        for key in ("hostNetwork", "hostPID", "hostIPC"):
            assert not spec.get(key), f"{name}: {key}"
        for volume in spec.get("volumes", []):
            assert "hostPath" not in volume, f"{name}: hostPath direct în pod ({volume['name']})"
    for name, container in _containers():
        for port in container.get("ports", []):
            assert "hostPort" not in port, f"{name}: hostPort {port}"


def test_containerele_fara_privilegii():
    for name, container in _containers():
        ctx = container.get("securityContext", {})
        assert ctx.get("allowPrivilegeEscalation") is False, f"{name}: allowPrivilegeEscalation"
        assert not ctx.get("privileged"), f"{name}: privileged"
        assert ctx.get("capabilities", {}).get("drop") == ["ALL"], f"{name}: capabilities.drop != ALL"


def test_podurile_nu_monteaza_tokenul_de_serviceaccount():
    """Niciun pod nu vorbește cu API-ul Kubernetes: un RCE în aplicație nu
    trebuie să primească și un token de cluster."""
    for name, spec in _workloads():
        assert spec.get("automountServiceAccountToken") is False, name


@pytest.mark.parametrize(
    ("kind", "name"),
    [("Deployment", "api"), ("Deployment", "web"), ("StatefulSet", "db"),
     ("StatefulSet", "redis"), ("CronJob", "purge"), ("CronJob", "backup-db"),
     ("CronJob", "backup-media"), ("Job", "migrate")],
)
def test_workload_urile_aplicatiei_ruleaza_non_root(kind, name):
    ctx = _pod_spec(_resource(kind, name))["securityContext"]
    assert ctx.get("runAsNonRoot") is True
    # uid numeric explicit: kubelet nu poate verifica runAsNonRoot pe `USER nume`.
    assert isinstance(ctx.get("runAsUser"), int) and ctx["runAsUser"] > 0


# Volumele permise de Pod Security `restricted` (hostPath etc. interzise).
_RESTRICTED_VOLUMES = {
    "configMap", "csi", "downwardAPI", "emptyDir", "ephemeral",
    "persistentVolumeClaim", "projected", "secret",
}


def test_toate_podurile_respecta_pod_security_restricted():
    """Toate workload-urile noastre trec de profilul `restricted` (namespace-ul
    impune doar `baseline`, dar raportează `restricted`): non-root, seccomp
    RuntimeDefault, drop ALL fără capabilități adăugate, volume permise."""
    for name, spec in _workloads():
        pod_ctx = spec.get("securityContext", {})
        assert pod_ctx.get("seccompProfile", {}).get("type") == "RuntimeDefault", name
        for volume in spec.get("volumes", []):
            kinds = set(volume) - {"name"}
            assert kinds <= _RESTRICTED_VOLUMES, f"{name}: volum nepermis {kinds}"
        for container in spec.get("initContainers", []) + spec["containers"]:
            ctx = container.get("securityContext", {})
            non_root = ctx.get("runAsNonRoot", pod_ctx.get("runAsNonRoot"))
            assert non_root is True, f"{name}/{container['name']}: runAsNonRoot"
            assert ctx.get("runAsUser", pod_ctx.get("runAsUser")) != 0, name
            added = set(ctx.get("capabilities", {}).get("add", []))
            assert added <= {"NET_BIND_SERVICE"}, f"{name}/{container['name']}: capabilități {added}"


def _container(kind: str, name: str) -> tuple[dict, dict]:
    spec = _pod_spec(_resource(kind, name))
    return spec, spec["containers"][0]


def _tmp_emptydir(spec: dict, container: dict) -> dict:
    mount = next((m for m in container.get("volumeMounts", []) if m["mountPath"] == "/tmp"), None)
    assert mount, f"{container['name']}: /tmp nu e montat (root read-only → fără loc de scriere)"
    volume = next(v for v in spec["volumes"] if v["name"] == mount["name"])
    assert "emptyDir" in volume and volume["emptyDir"].get("sizeLimit"), volume
    return volume["emptyDir"]


@pytest.mark.parametrize(
    ("kind", "name"),
    [("Deployment", "web"), ("Deployment", "api"), ("Job", "migrate"),
     ("CronJob", "purge"), ("CronJob", "backup-db")],
)
def test_root_read_only_cu_tmp_emptydir(kind, name):
    """Rădăcina imaginii read-only: un RCE nu poate rescrie codul/configul;
    scrierile temporare merg într-un emptyDir plafonat."""
    spec, container = _container(kind, name)
    assert container["securityContext"].get("readOnlyRootFilesystem") is True
    _tmp_emptydir(spec, container)


def test_backup_media_root_read_only():
    _, container = _container("CronJob", "backup-media")
    assert container["securityContext"].get("readOnlyRootFilesystem") is True


@pytest.mark.parametrize(("kind", "name"), [("Deployment", "api"), ("CronJob", "purge"), ("Job", "migrate")])
def test_imaginea_api_scrie_temporarele_in_tmp(kind, name):
    _, container = _container(kind, name)
    env = {e["name"]: e.get("value") for e in container.get("env", [])}
    assert env.get("TMPDIR") == "/tmp"


def test_tmp_api_e_pe_disc_nu_in_ram():
    """Upload-uri de 55m + ffmpeg: un emptyDir `medium: Memory` s-ar contoriza în
    limita de memorie a podului (OOM-kill)."""
    spec, container = _container("Deployment", "api")
    assert _tmp_emptydir(spec, container).get("medium") != "Memory"


@pytest.mark.parametrize("cronjob", ["backup-db", "backup-media"])
def test_backup_non_root_fara_capabilitati(cronjob):
    """Backup-urile rulează ca 1000:1000 (proprietarul media și al
    /opt/flirt-backups) — fără root și fără DAC_OVERRIDE."""
    spec, container = _container("CronJob", cronjob)
    ctx = spec["securityContext"]
    assert ctx.get("runAsNonRoot") is True
    assert ctx.get("runAsUser") == 1000 and ctx.get("runAsGroup") == 1000
    caps = container["securityContext"].get("capabilities", {})
    assert caps.get("drop") == ["ALL"]
    assert not caps.get("add"), f"{cronjob}: capabilități adăugate {caps.get('add')}"


def test_namespace_impune_pod_security():
    labels = _resource("Namespace", "flirt")["metadata"]["labels"]
    assert labels.get("pod-security.kubernetes.io/enforce") in {"baseline", "restricted"}


def _policies() -> dict[str, dict]:
    return {
        doc["metadata"]["name"]: doc["spec"]
        for _, doc in _docs()
        if doc["kind"] == "NetworkPolicy"
    }


def test_networkpolicy_default_deny_ingress():
    deny = [
        spec for spec in _policies().values()
        if spec["podSelector"] == {} and spec.get("policyTypes") == ["Ingress"] and not spec.get("ingress")
    ]
    assert deny, "lipsește NetworkPolicy default-deny (podSelector: {}, fără reguli ingress)"
    kustomization = yaml.safe_load((MANIFESTS / "kustomization.yaml").read_text(encoding="utf-8"))
    assert "networkpolicies.yaml" in kustomization["resources"]


def _allowed(target: str) -> tuple[set[str], set[int]]:
    """(etichete `app.kubernetes.io/name` permise, porturi) spre podurile `target`."""
    names: set[str] = set()
    ports: set[int] = set()
    for spec in _policies().values():
        if spec["podSelector"].get("matchLabels", {}).get("app.kubernetes.io/name") != target:
            continue
        for rule in spec.get("ingress", []):
            assert rule.get("ports"), f"regulă spre {target} fără restricție de port"
            ports |= {p["port"] for p in rule["ports"]}
            for peer in rule.get("from", []):
                assert "ipBlock" not in peer, f"{target}: ipBlock (deschide spre IP-uri arbitrare)"
                sel = peer.get("podSelector")
                if sel is None:
                    names.add(f"ns:{peer['namespaceSelector']['matchLabels']['kubernetes.io/metadata.name']}")
                    continue
                assert sel, f"{target}: podSelector gol = TOATE podurile"
                names |= set(sel.get("matchLabels", {}).values())
                for expr in sel.get("matchExpressions", []):
                    assert expr["key"] == "app.kubernetes.io/name" and expr["operator"] == "In"
                    names |= set(expr["values"])
    return names, ports


@pytest.mark.parametrize(
    ("target", "clients", "port"),
    [
        ("db", {"api", "migrate", "purge", "backup-db"}, 5432),
        ("redis", {"api", "purge"}, 6379),
        ("api", {"web"}, 8000),
        ("web", {"ns:kube-system"}, 8080),
    ],
)
def test_networkpolicy_doar_clientii_necesari(target, clients, port):
    """db/redis accesibile DOAR din podurile care chiar le folosesc; api doar
    prin nginx (rate limiting + blocarea ticket-proofs); web doar de la Traefik."""
    names, ports = _allowed(target)
    assert names == clients
    assert ports == {port}


# --- Egress ----------------------------------------------------------------- #

_PRIVATE_RANGES = {
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
    "169.254.0.0/16", "100.64.0.0/10", "127.0.0.0/8",
}


def _selects(selector: dict, name: str) -> bool:
    """Selectorul de pod alege podurile cu `app.kubernetes.io/name=name`?"""
    if selector == {}:
        return True
    if selector.get("matchLabels", {}).get("app.kubernetes.io/name") == name:
        return True
    return any(
        e["key"] == "app.kubernetes.io/name" and e["operator"] == "In" and name in e["values"]
        for e in selector.get("matchExpressions", [])
    )


def _egress_rules(source: str) -> list[dict]:
    """Regulile de egress care se aplică podurilor `source` (inclusiv cele globale)."""
    rules = []
    for spec in _policies().values():
        if "Egress" in spec.get("policyTypes", []) and _selects(spec["podSelector"], source):
            rules += spec.get("egress", [])
    return rules


def _is_dns_rule(rule: dict) -> bool:
    peers = rule.get("to", [])
    return bool(peers) and all(
        p.get("namespaceSelector", {}).get("matchLabels", {}).get("kubernetes.io/metadata.name") == "kube-system"
        and p.get("podSelector", {}).get("matchLabels", {}).get("k8s-app") == "kube-dns"
        for p in peers
    ) and {(p.get("protocol", "TCP"), p["port"]) for p in rule["ports"]} <= {("UDP", 53), ("TCP", 53)}


def _egress_destinations(source: str) -> set[tuple[str, int]]:
    """(destinație, port) permise pentru `source`, fără DNS. Destinația e
    eticheta podului sau `internet` pentru ipBlock."""
    out: set[tuple[str, int]] = set()
    for rule in _egress_rules(source):
        if _is_dns_rule(rule):
            continue
        assert rule.get("to"), f"{source}: regulă de egress fără `to` = ORICE destinație"
        assert rule.get("ports"), f"{source}: regulă de egress fără restricție de port"
        ports = {p["port"] for p in rule["ports"]}
        for peer in rule["to"]:
            if "ipBlock" in peer:
                dest = "internet"
            else:
                assert "namespaceSelector" not in peer, f"{source}: egress spre alt namespace"
                sel = peer["podSelector"]
                assert sel, f"{source}: podSelector gol = TOATE podurile"
                dest = sel["matchLabels"]["app.kubernetes.io/name"]
            out |= {(dest, port) for port in ports}
    return out


def test_networkpolicy_default_deny_egress():
    deny = [
        spec for spec in _policies().values()
        if spec["podSelector"] == {} and spec.get("policyTypes") == ["Egress"] and not spec.get("egress")
    ]
    assert deny, "lipsește NetworkPolicy default-deny egress (podSelector: {}, fără reguli egress)"


def test_dns_permis_doar_spre_coredns():
    """Fără DNS nimic nu rezolvă `db`/`api`; dar DOAR spre CoreDNS din kube-system."""
    dns = [
        spec for spec in _policies().values()
        if spec["podSelector"] == {} and any(_is_dns_rule(r) for r in spec.get("egress", []))
    ]
    assert dns, "lipsește egress-ul DNS pentru toate podurile"
    for spec in dns:
        assert all(_is_dns_rule(r) for r in spec["egress"]), "politica globală deschide mai mult decât DNS"
        ports = {(p["protocol"], p["port"]) for r in spec["egress"] for p in r["ports"]}
        assert ports == {("UDP", 53), ("TCP", 53)}


@pytest.mark.parametrize(
    ("source", "destinations"),
    [
        ("api", {("db", 5432), ("redis", 6379), ("internet", 443)}),
        ("web", {("api", 8000)}),
        ("migrate", {("db", 5432)}),
        ("purge", {("db", 5432), ("redis", 6379)}),
        ("backup-db", {("db", 5432)}),
        ("backup-media", set()),
        ("db", set()),
        ("redis", set()),
    ],
)
def test_networkpolicy_egress_doar_destinatiile_necesare(source, destinations):
    """Doar api iese în internet; web doar spre api; db/redis/backup-media
    nicăieri (în afară de DNS)."""
    assert _egress_destinations(source) == destinations


def test_api_internet_doar_https_fara_ranguri_interne():
    """SSRF: api nu poate lovi rețele interne, Service-uri/poduri k3s sau metadata
    cloud (169.254.169.254) prin regula de internet."""
    blocks = [
        (peer["ipBlock"], rule)
        for rule in _egress_rules("api")
        for peer in rule.get("to", [])
        if "ipBlock" in peer
    ]
    assert blocks, "api nu are egress spre internet"
    for block, rule in blocks:
        assert block["cidr"] == "0.0.0.0/0"
        assert _PRIVATE_RANGES <= set(block.get("except", [])), block
        assert {(p.get("protocol", "TCP"), p["port"]) for p in rule["ports"]} == {("TCP", 443)}


@pytest.mark.parametrize("source", ["web", "db", "redis", "migrate", "purge", "backup-db", "backup-media"])
def test_fara_internet_in_afara_de_api(source):
    for rule in _egress_rules(source):
        for peer in rule.get("to", []):
            assert "ipBlock" not in peer, f"{source}: egress ipBlock (internet)"


# --------------------------------------------------------------------------- #
# 5. Backup-uri (CronJob-uri k8s)
# --------------------------------------------------------------------------- #


def _backup_script(name: str) -> str:
    container = _pod_spec(_resource("CronJob", name))["containers"][0]
    command = container["command"]
    assert command[:2] == ["/bin/sh", "-c"]
    return command[2]


@pytest.mark.parametrize("cronjob", ["backup-db", "backup-media"])
def test_backup_scrie_cu_umask_077(cronjob):
    text = _backup_script(cronjob)
    assert re.search(r"^set -eu$", text, re.MULTILINE)
    umask = re.search(r"^umask 077$", text, re.MULTILINE)
    assert umask, f"{cronjob}: lipsește `umask 077`"
    assert umask.start() < text.index("mkdir -p"), "umask trebuie setat înainte de orice scriere"


@pytest.mark.parametrize("cronjob", ["backup-db", "backup-media"])
def test_backup_atomic_si_retentie_pe_tiparul_propriu(cronjob):
    """Arhiva se scrie în `.partial` și se redenumește doar la succes; retenția
    șterge DOAR fișierele proprii, fără recursivitate."""
    text = _backup_script(cronjob)
    assert '.partial"' in text and re.search(r'^\s*mv "\$tmp" "\$target"$', text, re.MULTILINE)
    find = re.search(r"^.*find .*-delete.*$", text, re.MULTILINE)
    assert find, f"{cronjob}: lipsește retenția"
    line = find.group(0)
    assert "-maxdepth 1" in line and "-type f" in line and "-mtime" in line
    assert re.search(r'-name "\$\{\w+\}-\*\.(sql|tar)\.gz"', line), line


def test_backup_db_nu_mascheaza_esecul_pg_dump():
    text = _backup_script("backup-db")
    assert text.index("set -o pipefail") < text.index("pg_dump --clean")


def test_backup_media_citeste_media_read_only():
    spec = _pod_spec(_resource("CronJob", "backup-media"))
    mount = next(m for m in spec["containers"][0]["volumeMounts"] if m["name"] == "media")
    volume = next(v for v in spec["volumes"] if v["name"] == "media")
    assert mount.get("readOnly") is True
    assert volume["persistentVolumeClaim"].get("readOnly") is True


@pytest.mark.parametrize("cronjob", ["backup-db", "backup-media"])
def test_backup_implicit_in_afara_repo(cronjob):
    """Echivalentul `BACKUP_HOST_DIR:-/opt/flirt-backups`: PVC-ul `backups` e
    legat de un PV hostPath /opt/flirt-backups cu Retain (nu în checkout-ul git,
    nu în stocarea k3s, nu se șterge odată cu namespace-ul)."""
    spec = _pod_spec(_resource("CronJob", cronjob))
    mount = next(m for m in spec["containers"][0]["volumeMounts"] if m["name"] == "backups")
    assert mount["mountPath"] == "/backups"
    volume = next(v for v in spec["volumes"] if v["name"] == "backups")
    claim = volume["persistentVolumeClaim"]["claimName"]

    pvc = _resource("PersistentVolumeClaim", claim)
    pv = _resource("PersistentVolume", pvc["spec"]["volumeName"])
    assert pv["spec"]["hostPath"]["path"] == "/opt/flirt-backups"
    assert pv["spec"]["persistentVolumeReclaimPolicy"] == "Retain"
    assert pv["spec"]["claimRef"]["name"] == claim
    assert not pv["spec"]["hostPath"]["path"].startswith(str(REPO))


@pytest.mark.parametrize("cronjob", ["backup-db", "backup-media"])
def test_backup_programat_fara_suprapuneri(cronjob):
    spec = _resource("CronJob", cronjob)["spec"]
    assert spec["concurrencyPolicy"] == "Forbid"
    assert spec.get("suspend") is not True


def test_backups_ignorate_si_nevesionate():
    gitignore = (REPO / ".gitignore").read_text(encoding="utf-8")
    assert re.search(r"^backend/backups/$", gitignore, re.MULTILINE)
    if shutil.which("git") is None:
        pytest.skip("git lipsește")
    tracked = subprocess.run(
        ["git", "ls-files", "backend/backups"], cwd=REPO, capture_output=True, text=True
    )
    if tracked.returncode != 0:
        pytest.skip("nu e un checkout git")
    assert tracked.stdout.strip() == "", f"dump-uri încă versionate: {tracked.stdout}"


# --------------------------------------------------------------------------- #
# 6. Push: tokenurile mascate în log-uri
# --------------------------------------------------------------------------- #


def test_mask_token():
    from app.services.push import _mask_token

    assert _mask_token("ExponentPushToken[abcdefghijklmnop]") == "…lmnop]"
    assert _mask_token("abc") == "…"


@pytest.mark.parametrize("sender_name", ["ExpoPush", "FcmPush"])
async def test_log_de_eroare_nu_contine_tokenul_intreg(monkeypatch, caplog, sender_name):
    from app.services import push

    token = "ExponentPushToken[SECRET-DEVICE-TOKEN-123456]"

    async def boom(self, *args, **kwargs):
        raise httpx.ConnectError("boom")

    monkeypatch.setattr(httpx.AsyncClient, "post", boom)
    caplog.set_level("WARNING", logger="app.push")

    await getattr(push, sender_name)().send([token], "t", "b")

    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert "failed for token" in logged
    assert token not in logged
    assert "SECRET-DEVICE" not in logged
    assert token[-6:] in logged
