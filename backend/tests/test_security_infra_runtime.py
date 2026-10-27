"""Hardening de infrastructură: gunicorn, Redis, certbot, resurse, backup, push.

CE VERIFICĂM
------------
1. gunicorn NU mai are încredere în X-Forwarded-* de la oricine (`*`): implicit
   doar subrețeaua Docker a containerului (detectată din /proc/net/route).
2. Redis: parolă OPȚIONALĂ — fără REDIS_PASSWORD totul rămâne ca înainte.
3. certbot pe versiune fixă; `api` cu limite de CPU/RAM.
4. Backup-uri: umask 077, implicit în afara repo-ului, dump-ul nu mai e în git.
5. Push: tokenurile nu mai apar întregi în log-uri.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import textwrap

import httpx
import pytest

from tests.test_nginx_ratelimit_zones import BACKEND

REPO = BACKEND.parent
ENTRYPOINT = BACKEND / "entrypoint.sh"
COMPOSE = BACKEND / "docker-compose.yml"


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
# 3. certbot fix + limite pe api
# --------------------------------------------------------------------------- #


def test_certbot_pe_versiune_fixa():
    image = re.search(r"^\s+image:\s*(\S+)", _service("certbot"), re.MULTILINE).group(1)
    assert re.fullmatch(r"certbot/certbot:v\d+\.\d+\.\d+", image), image


def test_nicio_imagine_latest():
    assert not re.search(r"^\s+image:\s*\S+:latest\s*$", COMPOSE.read_text(encoding="utf-8"), re.MULTILINE)


def test_api_are_limite_de_resurse():
    api = _service("api")
    assert re.search(r"^    cpus: \$\{API_CPUS:-2\.0\}$", api, re.MULTILINE)
    assert re.search(r"^    mem_limit: \$\{API_MEM_LIMIT:-1536m\}$", api, re.MULTILINE)


# --------------------------------------------------------------------------- #
# 4. Backup-uri
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("script", ["backup_db.sh", "backup_media.sh"])
def test_backup_scrie_cu_umask_077(script):
    text = (BACKEND / "scripts" / script).read_text(encoding="utf-8")
    umask = re.search(r"^umask 077$", text, re.MULTILINE)
    assert umask, f"{script}: lipsește `umask 077`"
    assert umask.start() < text.index("mkdir -p"), "umask trebuie setat înainte de orice scriere"


@pytest.mark.parametrize("service", ["backup", "backup-media"])
def test_backup_implicit_in_afara_repo(service):
    body = _service(service)
    assert "${BACKUP_HOST_DIR:-/opt/flirt-backups}:/backups" in body
    assert "${BACKUP_HOST_DIR:-./backups}" not in body


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
# 5. Push: tokenurile mascate în log-uri
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
