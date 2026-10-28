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
import shutil
import subprocess
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
# Sursa de adevăr din 28.10.2026 (migrarea pe k3s): imaginea `flirt-web`.
WEB_IMAGE = REPO / "deploy" / "k8s" / "images" / "web"
TEMPLATE = WEB_IMAGE / "nginx.conf.template"
MAIN_CONF = WEB_IMAGE / "nginx.conf"
ENTRYPOINT = WEB_IMAGE / "entrypoint.sh"
DOCKERFILE = WEB_IMAGE / "Dockerfile"

DOMAIN = "api.test.invalid"
ADMIN_DOMAIN = "admin.test.invalid"
MINIAPP_DOMAIN = "miniapp.test.invalid"
TEST_ENV = {"DOMAIN": DOMAIN, "ADMIN_DOMAIN": ADMIN_DOMAIN, "MINIAPP_DOMAIN": MINIAPP_DOMAIN}


# --------------------------------------------------------------------------- #
# Randarea șablonului — cu lista REALĂ de variabile din entrypoint.sh
# --------------------------------------------------------------------------- #


def _envsubst_invocation() -> tuple[list[str], str, str]:
    """(variabile, șablon, destinație) din apelul `envsubst` al entrypoint-ului.

    Nu rescriem lista în test: dacă cineva adaugă un domeniu nou în entrypoint
    (sau, mai rău, scoate lista fixă și lasă envsubst să înlocuiască ORICE
    `$var`, inclusiv `$host`/`$uri` ale nginx), testul randează ca producția.
    """
    script = ENTRYPOINT.read_text(encoding="utf-8")
    match = re.search(
        r"^envsubst\s+'([^']+)'\s*\\?\s*<\s*(\S+)\s*>\s*(\S+)\s*$",
        script,
        re.MULTILINE,
    )
    assert match, "nu am găsit apelul `envsubst '<listă>' < șablon > config` în entrypoint.sh"
    names = re.findall(r"\$\{(\w+)\}", match.group(1))
    assert names, "envsubst fără listă fixă de variabile ar strica $host, $uri..."
    return names, match.group(2), match.group(3)


def _envsubst(text: str, names: list[str], env: dict[str, str]) -> str:
    """Emulare fidelă a `envsubst 'SHELL-FORMAT'`: DOAR variabilele din listă,
    în ambele forme (`$VAR` și `${VAR}`); restul `$...` rămâne neatins."""
    for name in names:
        value = env.get(name, "")
        text = text.replace("${" + name + "}", value)
        text = re.sub(rf"\${re.escape(name)}(?!\w)", lambda _m, v=value: v, text)
    return text


def _copy_map() -> dict[str, Path]:
    """`COPY deploy/k8s/images/web/<fișier> <cale în imagine>` din Dockerfile →
    {cale în imagine: fișier din repo}. Așa `include`-urile se rezolvă exact
    cum le vede nginx în container."""
    out = {}
    for src, dest in re.findall(
        r"^COPY\s+deploy/k8s/images/web/(\S+)\s+(\S+)\s*$",
        DOCKERFILE.read_text(encoding="utf-8"),
        re.MULTILINE,
    ):
        out[dest] = WEB_IMAGE / src
    return out


def _inline_includes(conf: str) -> str:
    """Înlocuiește `include <fișier din imagine>;` cu conținutul lui (ce vede
    nginx efectiv într-un `location`: antetele de proxy din snippet)."""
    files = _copy_map()

    def repl(match: re.Match) -> str:
        path = files.get(match.group(2))
        if path is None:
            return match.group(0)
        indent = match.group(1)
        body = path.read_text(encoding="utf-8")
        return "\n".join(indent + line if line.strip() else line for line in body.splitlines())

    return re.sub(r"^([ \t]*)include\s+(\S+);[ \t]*$", repl, conf, flags=re.MULTILINE)


@pytest.fixture(scope="module")
def rendered_raw() -> str:
    """Șablonul randat EXACT ca la pornirea podului (cu `include`-urile intacte)."""
    names, _, _ = _envsubst_invocation()
    text = _envsubst(TEMPLATE.read_text(encoding="utf-8"), names, TEST_ENV)
    assert "${DOMAIN}" not in text, "randarea a lăsat variabile ne-înlocuite"
    return text


@pytest.fixture(scope="module")
def rendered(rendered_raw) -> str:
    """Configurația randată, cu snippet-urile incluse expandate în `location`-uri."""
    return _inline_includes(rendered_raw)


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
    # TLS e terminat de Traefik: `$scheme` ar fi mereu „http". Schema reală vine
    # din map-ul filtrat $flirt_fwd_proto (vezi testul de mai jos).
    assert "proxy_set_header X-Forwarded-Proto $flirt_fwd_proto;" in body
    # În k8s `api` e un Service cu ClusterIP STABIL → `upstream` clasic (cu
    # keepalive); nu mai e nevoie de variabilă + resolver ca în compose.
    assert re.search(r"^\s*proxy_pass\s+http://flirt_api;", body, re.MULTILINE)


def test_upstream_api_e_serviceul_api():
    """`upstream flirt_api` → Service-ul `api` pe portul lui din api.yaml."""
    import yaml

    api_yaml = REPO / "deploy" / "k8s" / "manifests" / "api.yaml"
    service = next(
        doc
        for doc in yaml.safe_load_all(api_yaml.read_text(encoding="utf-8"))
        if doc and doc["kind"] == "Service" and doc["metadata"]["name"] == "api"
    )
    port = service["spec"]["ports"][0]["port"]

    upstream = re.search(r"^upstream flirt_api\s*\{([^}]*)\}", TEMPLATE.read_text(encoding="utf-8"), re.MULTILINE)
    assert upstream, "lipsește `upstream flirt_api`"
    servers = re.findall(r"^\s*server\s+(\S+?)(?:\s+[^;]*)?;", upstream.group(1), re.MULTILINE)
    assert servers == [f"api:{port}"]


def test_schema_forwardata_accepta_doar_https():
    """X-Forwarded-Proto spre API: DOAR `https` e preluat din antetul lui
    Traefik; orice altceva (lipsă, gunoi injectat) → schema conexiunii."""
    text = TEMPLATE.read_text(encoding="utf-8")
    match = re.search(r"^map \$http_x_forwarded_proto \$flirt_fwd_proto\s*\{([^}]*)\}", text, re.MULTILINE)
    assert match, "lipsește map-ul $flirt_fwd_proto"
    entries = dict(
        line.split(None, 1)
        for line in (part.strip() for part in match.group(1).split(";"))
        if line
    )
    assert entries == {"default": "$scheme", "https": "https"}


def test_ip_real_doar_din_reteaua_de_poduri():
    """`real_ip` are încredere în X-Forwarded-For DOAR de la rețeaua de poduri
    (Traefik). O sursă prea largă (0.0.0.0/0) = oricine își alege IP-ul →
    ocolește rate limiting-ul. Aceeași rețea ca FORWARDED_ALLOW_IPS din api.yaml."""
    import yaml

    text = TEMPLATE.read_text(encoding="utf-8")
    sources = re.findall(r"^set_real_ip_from\s+(\S+);", text, re.MULTILINE)
    assert sources == ["10.42.0.0/16"], sources
    assert re.search(r"^real_ip_header X-Forwarded-For;", text, re.MULTILINE)
    assert re.search(r"^real_ip_recursive on;", text, re.MULTILINE)

    api_yaml = REPO / "deploy" / "k8s" / "manifests" / "api.yaml"
    deploy = next(
        doc
        for doc in yaml.safe_load_all(api_yaml.read_text(encoding="utf-8"))
        if doc and doc["kind"] == "Deployment"
    )
    env = {e["name"]: e.get("value") for e in deploy["spec"]["template"]["spec"]["containers"][0]["env"]}
    assert env["FORWARDED_ALLOW_IPS"] == sources[0]


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
# 3. Structura imaginii: șablon → config randat → inclus de nginx.conf
# --------------------------------------------------------------------------- #


def test_entrypoint_randeaza_ce_include_nginx_conf():
    """Lanțul Dockerfile → entrypoint → nginx.conf e coerent: șablonul citit de
    envsubst e cel copiat în imagine, iar ieșirea e inclusă în blocul `http`."""
    _, template_path, out_path = _envsubst_invocation()
    copies = _copy_map()
    assert copies.get(template_path) == TEMPLATE, f"{template_path} nu e șablonul din repo"
    assert copies.get("/etc/nginx/nginx.conf") == MAIN_CONF

    main = MAIN_CONF.read_text(encoding="utf-8")
    http = re.search(r"^http\s*\{", main, re.MULTILINE)
    assert http, "nginx.conf principal fără bloc `http`"
    body, _ = _block_body(main, http.end() - 1)
    assert re.search(rf"^\s*include\s+{re.escape(out_path)};", body, re.MULTILINE)


def test_entrypoint_valideaza_config_inainte_de_pornire():
    """`nginx -t` ÎNAINTE de `exec nginx`: un config stricat oprește podul (iar
    rollout-ul cu maxUnavailable: 0 păstrează podurile vechi online)."""
    script = ENTRYPOINT.read_text(encoding="utf-8")
    assert re.search(r"^set -eu$", script, re.MULTILINE)
    check = script.index("nginx -t")
    start = script.index("exec nginx")
    assert check < start


def test_envsubst_nu_atinge_variabilele_nginx():
    """Lista fixă conține doar numele noastre, nu variabile nginx."""
    names, _, _ = _envsubst_invocation()
    assert set(names) == {"DOMAIN", "ADMIN_DOMAIN", "MINIAPP_DOMAIN"}


@pytest.mark.parametrize(
    "value",
    ["api.x.md;evil", 'api.x.md"', "api.x.md }", "api x", "$host"],
)
def test_entrypoint_refuza_hostname_cu_caractere_de_config(value):
    """Domeniile intră direct în `server_name`/CSP: un `;`, `"` sau `}` venit din
    secret ar injecta directive nginx. Entrypoint-ul trebuie să refuze ÎNAINTE
    de a scrie ceva (iese la validare, fără mkdir/envsubst)."""
    env = {"PATH": "/usr/bin:/bin", **TEST_ENV, "DOMAIN": value}
    result = subprocess.run(
        ["/bin/sh", str(ENTRYPOINT)], env=env, capture_output=True, text=True, timeout=10
    )
    assert result.returncode == 1, result.stdout + result.stderr
    assert "nu e un hostname valid" in result.stdout + result.stderr


@pytest.mark.skipif(shutil.which("envsubst") is None, reason="envsubst (gettext) nu e instalat")
def test_randarea_identica_cu_envsubst_real(rendered_raw):
    """Emularea din test == `envsubst` real (în CI, ubuntu are gettext-base)."""
    names, _, _ = _envsubst_invocation()
    shell_format = " ".join("${" + n + "}" for n in names)
    result = subprocess.run(
        ["envsubst", shell_format],
        input=TEMPLATE.read_text(encoding="utf-8"),
        env={"PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", **TEST_ENV},
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout == rendered_raw


# --------------------------------------------------------------------------- #
# 4. Sintaxă — parser `crossplane` (nginx nu e disponibil local)
# --------------------------------------------------------------------------- #


def _tree(root: Path, fragment: str, *, upstream_host: str | None = None) -> Path:
    """Reproduce sub `root` arborele din imagine: nginx.conf principal, configul
    randat și snippet-urile, cu `include`-urile absolute rescrise sub `root`.
    `upstream_host` înlocuiește `api` (echivalentul `--add-host api:...`)."""
    _, _, out_path = _envsubst_invocation()

    def place(abs_path: str, text: str) -> None:
        target = root / abs_path.lstrip("/")
        target.parent.mkdir(parents=True, exist_ok=True)
        text = re.sub(
            r"^(\s*include\s+)/(\S+);",
            lambda m: f"{m.group(1)}{root / m.group(2)};",
            text,
            flags=re.MULTILINE,
        )
        target.write_text(text, encoding="utf-8")

    if upstream_host:
        fragment = re.sub(r"(\bserver\s+)api(:\d+;)", rf"\g<1>{upstream_host}\2", fragment)
    for dest, src in _copy_map().items():
        if dest.endswith(".conf") and dest != "/etc/nginx/nginx.conf":
            place(dest, src.read_text(encoding="utf-8"))
    place(out_path, fragment)
    place("/etc/nginx/mime.types", "types {\n    text/html html;\n}\n")
    main = MAIN_CONF.read_text(encoding="utf-8")
    place("/etc/nginx/nginx.conf", main)
    return root / "etc" / "nginx" / "nginx.conf"


def _parse(conf_dir: Path, fragment: str) -> dict:
    """Parsează configul randat prin nginx.conf-ul principal REAL al imaginii."""
    crossplane = pytest.importorskip(
        "crossplane", reason="parserul nginx nu e instalat (pip install crossplane)"
    )
    root = _tree(conf_dir, fragment)
    return crossplane.parse(str(root), catch_errors=True, combine=True)


def test_configuratia_randata_e_valida_sintactic(rendered_raw, tmp_path):
    payload = _parse(tmp_path, rendered_raw)
    assert payload["status"] == "ok", payload["errors"]


def test_control_negativ_parserul_chiar_prinde_o_eroare(rendered_raw, tmp_path):
    """Fără asta, testul de mai sus ar putea trece pentru că nu verifică nimic."""
    stricat = rendered_raw.replace("server_tokens off;", "server_tokens off", 1)
    assert stricat != rendered_raw, "controlul negativ nu a modificat nimic"

    payload = _parse(tmp_path, stricat)
    assert payload["status"] == "failed"
    assert payload["errors"]


def test_nginx_t_daca_binarul_exista(rendered_raw, tmp_path):
    """Dacă `nginx` chiar e instalat local, folosim validatorul REAL (CI-ul îl
    rulează oricum în imaginea de bază a Dockerfile-ului)."""
    binary = shutil.which("nginx")
    if not binary:
        pytest.skip("nginx nu e instalat local (validăm cu crossplane + CI)")

    root = _tree(tmp_path, rendered_raw, upstream_host="127.0.0.1")
    result = subprocess.run(
        [binary, "-t", "-p", str(tmp_path), "-c", str(root)], capture_output=True, text=True
    )
    assert result.returncode == 0, result.stderr
