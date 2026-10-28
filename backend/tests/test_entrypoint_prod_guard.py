"""Guardul din entrypoint.sh: producția pornește DOAR în Kubernetes (k3s).

Din 28.10.2026 producția rulează pe k3s (deploy/k8s/). Un `docker compose up`
rătăcit pe server, cu .env-ul de producție, ar porni un al doilea API peste o
bază veche. entrypoint.sh refuză ENVIRONMENT=production fără
KUBERNETES_SERVICE_HOST (injectat de k8s în orice pod), cu ieșire de urgență
ALLOW_PROD_OUTSIDE_K8S=1.

Scriptul rulează cu un `gunicorn` fals în PATH, ca să nu pornească nimic real.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
ENTRYPOINT = BACKEND / "entrypoint.sh"
FAKE_PEM = "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----"

pytestmark = pytest.mark.skipif(shutil.which("sh") is None, reason="fără /bin/sh")


def _run(tmp_path: Path, **env: str) -> subprocess.CompletedProcess[str]:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir(exist_ok=True)
    gunicorn = fake_bin / "gunicorn"
    gunicorn.write_text("#!/bin/sh\necho GUNICORN_PORNIT\n", encoding="utf-8")
    gunicorn.chmod(0o755)
    base = {
        "PATH": f"{fake_bin}{os.pathsep}{os.environ.get('PATH', '/usr/bin:/bin')}",
        # Sărim peste migrații și detecții: testăm DOAR guardul.
        "RUN_MIGRATIONS": "0",
        "WEB_CONCURRENCY": "2",
        "FORWARDED_ALLOW_IPS": "127.0.0.1",
    }
    base.update(env)
    return subprocess.run(
        ["sh", str(ENTRYPOINT)],
        env=base,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )


def test_productie_in_afara_k8s_e_refuzata(tmp_path):
    r = _run(tmp_path, ENVIRONMENT="production", JWT_PRIVATE_KEY=FAKE_PEM)
    assert r.returncode == 1, r.stdout + r.stderr
    assert "deploy/k8s/scripts/deploy.sh" in r.stdout
    assert "docker compose e DOAR pentru dezvoltare" in r.stdout
    assert "GUNICORN_PORNIT" not in r.stdout


def test_productie_in_k8s_porneste(tmp_path):
    r = _run(
        tmp_path,
        ENVIRONMENT="production",
        JWT_PRIVATE_KEY=FAKE_PEM,
        KUBERNETES_SERVICE_HOST="10.43.0.1",
    )
    assert r.returncode == 0, r.stdout + r.stderr
    assert "GUNICORN_PORNIT" in r.stdout


def test_iesirea_de_urgenta_explicita(tmp_path):
    r = _run(
        tmp_path,
        ENVIRONMENT="production",
        JWT_PRIVATE_KEY=FAKE_PEM,
        ALLOW_PROD_OUTSIDE_K8S="1",
    )
    assert r.returncode == 0, r.stdout + r.stderr
    assert "GUNICORN_PORNIT" in r.stdout


def test_dezvoltarea_cu_compose_nu_e_afectata(tmp_path):
    r = _run(tmp_path, ENVIRONMENT="development")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "GUNICORN_PORNIT" in r.stdout
