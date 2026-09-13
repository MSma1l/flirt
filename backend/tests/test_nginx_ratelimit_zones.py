"""Limitarea de cereri din nginx: ce rută cade pe ce zonă.

DEFECTUL
--------
`location /api/v1/auth/` folosește zona `flirt_auth` — 5 cereri pe MINUT, cheia
pe adresa clientului. Pragul e gândit pentru login cu PAROLĂ (rar, scump de
ghicit). Sub același prefix cad însă și rutele de SESIUNE ale Mini App-ului:

  - `GET  /api/v1/auth/me`      — chemată la FIECARE pornire a aplicației;
  - `POST /api/v1/auth/refresh` — chemată la fiecare reînnoire de sesiune.

SCENARIUL DE EȘEC (deja întâmplat o dată, pe `/api/v1/auth/telegram`)
---------------------------------------------------------------------
Pe o rețea de operator mobil (CGNAT) mii de abonați ies în internet prin ACEEAȘI
adresă publică. Cheia de limitare fiind adresa, toți împart același buget de 5
cereri pe minut: al șaselea utilizator care deschide aplicația în minutul ăla
primește 429 DE LA PROXY. Răspunsul generat de nginx nu poartă antetele CORS,
deci browserul nici măcar nu poate citi statusul — utilizatorul vede
„fără conexiune", nu „prea multe cereri". Aplicația pare picată, deși API-ul e
sănătos.

Ruta de autentificare Telegram a primit deja o zonă proprie, mai generoasă.
Rutele de sesiune au rămas pe cea strictă. Aici le mutăm, cu ACELAȘI tipar.

CE NU ARE VOIE SĂ SE RELAXEZE
-----------------------------
Login-ul cu parolă (`/api/v1/auth/login`) rămâne pe `flirt_auth`, la 5r/m —
verificat EXPLICIT mai jos, ca „reparația" să nu deschidă brute-force-ul.
"""
from __future__ import annotations

import re
import shlex
import shutil
import subprocess
import textwrap
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
TEMPLATE = BACKEND / "nginx" / "nginx.conf"
ENTRYPOINT = BACKEND / "nginx" / "entrypoint.sh"

DOMAIN = "api.test.invalid"
ADMIN_DOMAIN = "admin.test.invalid"
MINIAPP_DOMAIN = "miniapp.test.invalid"


# --------------------------------------------------------------------------- #
# Randarea șablonului — cu codul REAL din entrypoint.sh
# --------------------------------------------------------------------------- #


def _render_command() -> str:
    """Extrage EXACT invocarea `sed` de randare din `nginx/entrypoint.sh`.

    Nu rescriem substituția în test: dacă cineva schimbă lista de variabile din
    entrypoint (adaugă un domeniu nou, schimbă delimitatorul), testul trebuie să
    randeze la fel ca producția, nu ca o copie ruginită a ei.
    """
    script = ENTRYPOINT.read_text(encoding="utf-8")
    match = re.search(
        r"^sed \\\n(?:.*\\\n)*?\s*\"\$TEMPLATE\" > \"\$RENDERED\"$",
        script,
        re.MULTILINE,
    )
    assert match, "nu am găsit blocul `sed ... > $RENDERED` în nginx/entrypoint.sh"
    return match.group(0)


@pytest.fixture(scope="module")
def rendered(tmp_path_factory) -> str:
    """Configurația randată, prin scriptul real de pornire."""
    out = tmp_path_factory.mktemp("nginx") / "default.conf"
    script = textwrap.dedent(
        f"""
        set -eu
        DOMAIN={DOMAIN}
        ADMIN_DOMAIN={ADMIN_DOMAIN}
        MINIAPP_DOMAIN={MINIAPP_DOMAIN}
        TEMPLATE={shlex.quote(str(TEMPLATE))}
        RENDERED={shlex.quote(str(out))}
        """
    ) + _render_command()
    subprocess.run(["/bin/sh", "-c", script], check=True)

    text = out.read_text(encoding="utf-8")
    assert "${DOMAIN}" not in text, "randarea a lăsat variabile ne-înlocuite"
    return text


# --------------------------------------------------------------------------- #
# Un parser minimal de blocuri (suficient pentru `server` / `location`)
# --------------------------------------------------------------------------- #


def _block_body(conf: str, open_brace: int) -> tuple[str, int]:
    """Corpul blocului care începe la `{` de pe poziția dată + poziția de după."""
    depth = 0
    for i in range(open_brace, len(conf)):
        if conf[i] == "{":
            depth += 1
        elif conf[i] == "}":
            depth -= 1
            if depth == 0:
                return conf[open_brace + 1 : i], i + 1
    raise AssertionError("acoladă neînchisă în configurație")


def _api_server(conf: str) -> str:
    """Corpul blocului `server` care servește API-ul (`server_name <DOMAIN>`)."""
    for match in re.finditer(r"^server\s*\{", conf, re.MULTILINE):
        body, _ = _block_body(conf, match.end() - 1)
        if re.search(rf"^\s*server_name\s+{re.escape(DOMAIN)};", body, re.MULTILINE):
            return body
    raise AssertionError(f"niciun server cu server_name {DOMAIN}")


def _locations(server_body: str) -> list[tuple[str, str, str]]:
    """Toate `location`-urile: (modificator, cale, corp)."""
    found = []
    for match in re.finditer(r"^\s*location\s+(=\s+)?(\S+)\s*\{", server_body, re.MULTILINE):
        body, _ = _block_body(server_body, match.end() - 1)
        found.append(("=" if match.group(1) else "", match.group(2), body))
    return found


def _match_location(locations, uri: str) -> tuple[str, str, str]:
    """Ce `location` alege nginx pentru un URI (exact, apoi cel mai lung prefix).

    Configurația noastră nu folosește `location ~` (regex), deci regula se
    reduce la: potrivirea exactă câștigă; altfel cel mai LUNG prefix.
    """
    for mod, path, body in locations:
        if mod == "=" and path == uri:
            return mod, path, body
    candidates = [loc for loc in locations if loc[0] == "" and uri.startswith(loc[1])]
    assert candidates, f"niciun location nu potrivește {uri}"
    return max(candidates, key=lambda loc: len(loc[1]))


def _zones(conf: str) -> dict[str, dict[str, str]]:
    """`limit_req_zone` → {nume: {key, rate}}."""
    zones = {}
    for key, name, rate in re.findall(
        r"limit_req_zone\s+(\S+)\s+zone=(\w+):\S+\s+rate=(\d+r/[sm]);", conf
    ):
        zones[name] = {"key": key, "rate": rate}
    return zones


def _per_minute(rate: str) -> float:
    value, unit = rate.split("r/")
    return float(value) * (60 if unit == "s" else 1)


def _zone_of(location_body: str) -> str:
    """Zona de `limit_req` a unui location; "" dacă nu are niciuna (ex. /health)."""
    match = re.search(r"limit_req\s+zone=(\w+)", location_body)
    return match.group(1) if match else ""


# --------------------------------------------------------------------------- #
# 1. Rutele de sesiune NU mai cad pe zona de login cu parolă
# --------------------------------------------------------------------------- #

SESSION_URIS = ["/api/v1/auth/me", "/api/v1/auth/refresh"]


@pytest.mark.parametrize("uri", SESSION_URIS)
def test_ruta_de_sesiune_are_zona_proprie(rendered, uri):
    """`/me` și `/refresh` nu mai împart bugetul cu login-ul cu parolă."""
    locations = _locations(_api_server(rendered))
    mod, path, body = _match_location(locations, uri)

    assert (mod, path) == ("=", uri), (
        f"{uri} cade pe `location {mod} {path}` — adică pe prefixul de auth, "
        "deci pe zona strictă de login."
    )
    zone = _zone_of(body)
    assert zone, f"{uri} a rămas complet fără `limit_req` — nu asta am cerut"
    assert zone != "flirt_auth"


@pytest.mark.parametrize("uri", SESSION_URIS)
def test_zona_rutelor_de_sesiune_e_mult_mai_generoasa(rendered, uri):
    """Pragul trebuie să suporte o rețea CGNAT, nu un singur utilizator.

    Referință: ruta de autentificare Telegram, care a avut exact aceeași
    problemă, a primit 60r/m. Rutele de sesiune sunt chemate cel puțin la fel de
    des (`/me` la fiecare pornire a aplicației), deci nu au voie să fie mai
    strânse decât ea.
    """
    zones = _zones(rendered)
    locations = _locations(_api_server(rendered))
    zone = _zone_of(_match_location(locations, uri)[2])

    assert zone in zones, f"zona {zone} nu e declarată prin limit_req_zone"
    assert _per_minute(zones[zone]["rate"]) >= _per_minute(zones["flirt_tg_auth"]["rate"])


@pytest.mark.parametrize("uri", SESSION_URIS)
def test_preflightul_browserului_ramane_necontorizat(rendered, uri):
    """Cheia zonei trebuie să fie `$flirt_auth_key`, nu `$binary_remote_addr`.

    `map $request_method $flirt_auth_key` întoarce o cheie GOALĂ pentru OPTIONS,
    iar nginx nu numără cererile cu cheie goală. Verificarea preliminară CORS e
    trimisă automat de browser înaintea fiecărei cereri cross-origin: numărată,
    ar consuma jumătate din buget degeaba. Mecanismul există deja — reparația de
    față nu are voie să-l ocolească.
    """
    zones = _zones(rendered)
    locations = _locations(_api_server(rendered))
    zone = _zone_of(_match_location(locations, uri)[2])

    assert zones[zone]["key"] == "$flirt_auth_key"
    assert re.search(r'OPTIONS\s+"";', rendered), "maparea pentru OPTIONS a dispărut"


@pytest.mark.parametrize("uri", SESSION_URIS)
def test_ruta_de_sesiune_pastreaza_antetele_de_proxy(rendered, uri):
    """Un `location` nou nu moștenește `proxy_set_header` — trebuie repetate.

    `X-Forwarded-For $proxy_add_x_forwarded_for` e obligatoriu: aplicația
    determină adresa clientului din ULTIMA intrare a acestui antet
    (`app/core/ratelimit.py`). Fără el, rate limiting-ul din aplicație și
    jurnalul de audit ar vedea IP-ul lui nginx pentru toată lumea.
    """
    locations = _locations(_api_server(rendered))
    body = _match_location(locations, uri)[2]

    assert "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;" in body
    assert "proxy_set_header X-Real-IP $remote_addr;" in body
    assert "proxy_set_header Host $host;" in body
    assert "proxy_set_header X-Forwarded-Proto $scheme;" in body
    assert re.search(r"proxy_pass\s+http://\$", body), (
        "proxy_pass trebuie să folosească o VARIABILĂ (re-rezolvare DNS după "
        "restartul containerului `api`)"
    )


# --------------------------------------------------------------------------- #
# 2. Login-ul cu parolă rămâne LA FEL de strict
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "uri",
    [
        "/api/v1/auth/login",
        "/api/v1/auth/register",
        "/api/v1/auth/google",
        "/api/v1/auth/apple",
    ],
)
def test_rutele_de_acreditare_raman_pe_zona_stricta(rendered, uri):
    locations = _locations(_api_server(rendered))
    mod, path, body = _match_location(locations, uri)

    assert (mod, path) == ("", "/api/v1/auth/"), f"{uri} a fost scos de sub prefixul strict"
    assert _zone_of(body) == "flirt_auth"


def test_pragul_zonei_stricte_este_neschimbat(rendered):
    """5 cereri pe minut, cheia pe adresă (prin `$flirt_auth_key`), burst 10."""
    zones = _zones(rendered)
    assert zones["flirt_auth"]["rate"] == "5r/m"
    assert zones["flirt_auth"]["key"] == "$flirt_auth_key"

    locations = _locations(_api_server(rendered))
    body = _match_location(locations, "/api/v1/auth/login")[2]
    assert "limit_req zone=flirt_auth burst=10 nodelay;" in body


def test_zona_stricta_nu_e_refolosita_pentru_altceva(rendered):
    """`flirt_auth` rămâne exclusiv pentru prefixul de acreditări."""
    users = [
        path
        for _, path, body in _locations(_api_server(rendered))
        if _zone_of(body) == "flirt_auth"
    ]
    assert users == ["/api/v1/auth/"]


# --------------------------------------------------------------------------- #
# 3. Sintaxă — parser `crossplane` (nginx nu e disponibil local)
# --------------------------------------------------------------------------- #


def _parse(conf_dir: Path, fragment: str) -> dict:
    """Parsează fragmentul nostru într-un `http {}` minimal, ca în producție."""
    crossplane = pytest.importorskip(
        "crossplane", reason="parserul nginx nu e instalat (pip install crossplane)"
    )
    (conf_dir / "fragment.conf").write_text(fragment, encoding="utf-8")
    root = conf_dir / "nginx.conf"
    root.write_text(
        "events {}\n"
        "http {\n"
        f"    include {conf_dir / 'fragment.conf'};\n"
        "}\n",
        encoding="utf-8",
    )
    return crossplane.parse(str(root), catch_errors=True, combine=True)


def test_configuratia_randata_e_valida_sintactic(rendered, tmp_path):
    payload = _parse(tmp_path, rendered)
    assert payload["status"] == "ok", payload["errors"]


def test_control_negativ_parserul_chiar_prinde_o_eroare(rendered, tmp_path):
    """Fără asta, testul de mai sus ar putea trece pentru că nu verifică nimic."""
    stricat = rendered.replace("server_tokens off;", "server_tokens off", 1)
    assert stricat != rendered, "controlul negativ nu a modificat nimic"

    payload = _parse(tmp_path, stricat)
    assert payload["status"] == "failed"
    assert payload["errors"]


def test_nginx_t_daca_binarul_exista(rendered, tmp_path):
    """Dacă `nginx` chiar e instalat local, folosim validatorul REAL."""
    binary = shutil.which("nginx")
    if not binary:
        pytest.skip("nginx nu e instalat local (validăm cu crossplane)")

    (tmp_path / "fragment.conf").write_text(rendered, encoding="utf-8")
    root = tmp_path / "nginx.conf"
    root.write_text(
        f"events {{}}\nhttp {{\n    include {tmp_path / 'fragment.conf'};\n}}\n",
        encoding="utf-8",
    )
    result = subprocess.run(
        [binary, "-t", "-c", str(root)], capture_output=True, text=True
    )
    assert result.returncode == 0, result.stderr
