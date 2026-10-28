"""nginx: antetele de securitate NU se pierd în `location`-uri + limita de corp.

DEFECTUL (confirmat live pe panoul de admin)
--------------------------------------------
În nginx, `add_header` NU se cumulează între niveluri: un `location` care
declară MĂCAR UN `add_header` (ex. `Cache-Control`) pierde TOATE antetele
declarate la nivel de `server`. Panoul de admin avea `add_header Cache-Control`
în `location /assets/` și `location = /index.html` — adică tot ce servea —
deci pleca fără CSP, X-Frame-Options, HSTS, nosniff și Referrer-Policy.

REGULA PĂZITĂ AICI, generic, pe TOATE serverele publice:
  orice `location` cu `add_header` repetă TOATE antetele de securitate ale
  serverului său (aceeași valoare, cu `always`).

Sursa de adevăr (din 28.10.2026, k3s): șablonul nginx al imaginii `flirt-web`,
deploy/k8s/images/web/nginx.conf.template, randat ca în entrypoint-ul imaginii.
TLS-ul îl termină Traefik, dar HSTS & co. se trimit în continuare din nginx.

Plus: CSP `sandbox` pe /media, Cache-Control lung fără `always`,
Permissions-Policy pe Mini App și `client_max_body_size` 1m implicit / 55m
doar pe rutele de upload (lista sincronizată cu routerele FastAPI).
"""
from __future__ import annotations

import inspect
import re

import pytest

from tests.test_nginx_ratelimit_zones import (  # noqa: F401  (fixture importat)
    ADMIN_DOMAIN,
    BACKEND,
    DOMAIN,
    MINIAPP_DOMAIN,
    TEMPLATE,
    _block_body,
    rendered,
    rendered_raw,
)

REPO = BACKEND.parent

NOSNIFF = "X-Content-Type-Options"
XFO = "X-Frame-Options"
REFERRER = "Referrer-Policy"
HSTS = "Strict-Transport-Security"
CSP = "Content-Security-Policy"
PERMS = "Permissions-Policy"

REQUIRED = {
    DOMAIN: {NOSNIFF, XFO, REFERRER, HSTS},
    ADMIN_DOMAIN: {NOSNIFF, XFO, REFERRER, HSTS, CSP},
    MINIAPP_DOMAIN: {NOSNIFF, REFERRER, HSTS, CSP, PERMS},
}


# --------------------------------------------------------------------------- #
# Parser (server / location / add_header), inclusiv location-uri regex
# --------------------------------------------------------------------------- #


def _strip_comments(text: str) -> str:
    return "\n".join(
        re.sub(r"(^|\s)#.*$", "", line) for line in text.splitlines()
    )


def _servers(conf: str) -> dict[str, str]:
    """{server_name: corp} pentru serverele cu nume (fără `_`)."""
    out = {}
    clean = _strip_comments(conf)
    for match in re.finditer(r"^server\s*\{", clean, re.MULTILINE):
        body, _ = _block_body(clean, match.end() - 1)
        name = re.search(r"^\s*server_name\s+(\S+);", body, re.MULTILINE)
        if name and name.group(1) != "_":
            out[name.group(1)] = body
    return out


def _top_level(body: str) -> str:
    """Doar directivele de la adâncimea 0 a blocului (fără sub-blocuri)."""
    out, depth = [], 0
    for ch in body:
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            continue
        if depth == 0:
            out.append(ch)
    return "".join(out)


def _locations(server_body: str) -> list[tuple[str, str, str]]:
    """(modificator, cale/regex, corp) — inclusiv `=`, `~`, `~*`, `^~`."""
    found = []
    for match in re.finditer(
        r"^\s*location\s+(?:(=|~\*?|\^~)\s+)?(\S+)\s*\{", server_body, re.MULTILINE
    ):
        body, _ = _block_body(server_body, match.end() - 1)
        found.append((match.group(1) or "", match.group(2), body))
    return found


def _headers(text: str) -> dict[str, tuple[str, bool]]:
    """`add_header` de la nivelul dat → {nume: (valoare, always)}."""
    out = {}
    for m in re.finditer(
        r'^\s*add_header\s+(\S+)\s+("[^"]*"|\S+?)(\s+always)?\s*;',
        _top_level(text),
        re.MULTILINE,
    ):
        out[m.group(1)] = (m.group(2).strip('"'), bool(m.group(3)))
    return out


def _effective(server_body: str, loc_body: str) -> dict[str, tuple[str, bool]]:
    """Antetele efective: ale location-ului dacă are vreunul, altfel ale serverului."""
    own = _headers(loc_body)
    return own if own else _headers(server_body)


# --------------------------------------------------------------------------- #
# 1. Moștenirea add_header — regula generică
# --------------------------------------------------------------------------- #


def test_toate_serverele_publice_sunt_gasite(rendered):
    assert set(_servers(rendered)) == set(REQUIRED)


@pytest.mark.parametrize("name", sorted(REQUIRED))
def test_serverul_declara_antetele_de_securitate(rendered, name):
    server = _servers(rendered)[name]
    headers = _headers(server)
    for header in REQUIRED[name]:
        assert header in headers, f"{name}: lipsește {header} la nivel de server"
        assert headers[header][1], f"{name}: {header} fără `always`"


@pytest.mark.parametrize("name", sorted(REQUIRED))
def test_location_cu_add_header_repeta_antetele_serverului(rendered, name):
    """Defectul original: `add_header` în location anula CSP/XFO/HSTS/..."""
    server = _servers(rendered)[name]
    server_headers = _headers(server)
    security = {h: v for h, v in server_headers.items() if h != "Cache-Control"}

    checked = 0
    for mod, path, body in _locations(server):
        own = _headers(body)
        if not own:
            continue
        checked += 1
        for header, (value, always) in security.items():
            assert header in own, f"{name} location {mod} {path}: pierde {header}"
            assert own[header] == (value, always), (
                f"{name} location {path}: {header} diferă de nivelul server"
            )
    assert checked, f"{name}: niciun location cu add_header (testul n-ar verifica nimic)"


@pytest.mark.parametrize("name", sorted(REQUIRED))
def test_fiecare_location_are_efectiv_setul_cerut(rendered, name):
    server = _servers(rendered)[name]
    for mod, path, body in _locations(server):
        effective = _effective(server, body)
        missing = REQUIRED[name] - set(effective)
        assert not missing, f"{name} location {mod} {path}: lipsesc {sorted(missing)}"


def test_control_negativ_regula_prinde_location_fara_antete(rendered):
    """Reintroducem defectul original și verificăm că parserul îl vede."""
    stricat = rendered.replace(
        'add_header Cache-Control "no-store" always;\n        add_header X-Content-Type-Options',
        'add_header Cache-Control "no-store" always;\n        add_header X-Dummy',
        1,
    )
    assert stricat != rendered
    admin = _servers(stricat)[ADMIN_DOMAIN]
    index = next(body for mod, path, body in _locations(admin) if path == "/index.html")
    assert NOSNIFF not in _headers(index)


def test_admin_nu_poate_fi_incadrat(rendered):
    admin = _servers(rendered)[ADMIN_DOMAIN]
    for _, path, body in _locations(admin):
        eff = _effective(admin, body)
        assert eff[XFO][0] == "DENY", path
        assert "frame-ancestors 'none'" in eff[CSP][0], path


def test_miniapp_fara_x_frame_options(rendered):
    """Mini App-ul rulează în iframe-ul web.telegram.org: XFO l-ar rupe."""
    mini = _servers(rendered)[MINIAPP_DOMAIN]
    assert XFO not in _headers(mini)
    for _, path, body in _locations(mini):
        assert XFO not in _effective(mini, body), path


# --------------------------------------------------------------------------- #
# 2. Cache-Control lung: fără `always`, un singur antet
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("name", sorted(REQUIRED))
def test_cache_lung_nu_se_aplica_pe_erori(rendered, name):
    server = _servers(rendered)[name]
    for _, path, body in _locations(server):
        cc = _headers(body).get("Cache-Control")
        if cc and ("immutable" in cc[0] or "max-age=31536000" in cc[0]):
            assert not cc[1], f"{name} {path}: cache de 1 an cu `always` (cachează 404)"
            assert not re.search(r"^\s*expires\b", body, re.MULTILINE), (
                f"{name} {path}: `expires` + add_header = două Cache-Control"
            )


# --------------------------------------------------------------------------- #
# 3. /media: CSP sandbox
# --------------------------------------------------------------------------- #


def _media(rendered) -> str:
    api = _servers(rendered)[DOMAIN]
    return next(body for mod, path, body in _locations(api) if mod == "" and path == "/media/")


def test_media_are_csp_sandbox(rendered):
    headers = _headers(_media(rendered))
    assert headers[CSP] == ("default-src 'none'; sandbox", True)


def test_csp_miniapp_permite_media_de_pe_api(rendered):
    """CSP-ul de pe /media nu contează la încorporare; contează cel al Mini
    App-ului, care trebuie să permită https: pentru img/media (API = alt domeniu)."""
    mini = _servers(rendered)[MINIAPP_DOMAIN]
    csp = _headers(mini)[CSP][0]
    assert re.search(r"img-src [^;]*https:", csp)
    assert re.search(r"media-src [^;]*https:", csp)


# --------------------------------------------------------------------------- #
# 4. Permissions-Policy (Mini App)
# --------------------------------------------------------------------------- #


def _policy(value: str) -> dict[str, str]:
    return dict(
        part.strip().split("=", 1) for part in value.split(",") if part.strip()
    )


def test_miniapp_permissions_policy(rendered):
    mini = _servers(rendered)[MINIAPP_DOMAIN]
    policy = _policy(_headers(mini)[PERMS][0])
    assert policy["camera"] == "(self)", "video notițe / story / selfie au nevoie de cameră"
    assert policy["microphone"] == "(self)", "vocalele au nevoie de microfon"
    assert policy["geolocation"] == "()"
    for feature in ("payment", "usb", "display-capture"):
        assert policy[feature] == "()"


def test_miniapp_nu_foloseste_geolocatia_browserului():
    """Dacă cineva adaugă navigator.geolocation, Permissions-Policy trebuie
    actualizat (altfel API-ul e blocat tăcut)."""
    src = REPO / "miniapp" / "src"
    if not src.is_dir():
        pytest.skip("miniapp/ lipsește")
    for path in src.rglob("*.ts*"):
        if ".test." in path.name:
            continue
        assert "navigator.geolocation" not in path.read_text(encoding="utf-8"), path


# --------------------------------------------------------------------------- #
# 5. client_max_body_size: 1m implicit, 55m doar pe upload
# --------------------------------------------------------------------------- #


def _upload_location(rendered) -> tuple[str, str]:
    api = _servers(rendered)[DOMAIN]
    big = [
        (mod, path, body)
        for mod, path, body in _locations(api)
        if re.search(r"^\s*client_max_body_size\s+55m;", body, re.MULTILINE)
    ]
    assert len(big) == 1, "exact UN location are voie la corp mare"
    mod, path, body = big[0]
    assert mod == "~", "location-ul de upload e un regex ancorat"
    return path, body


def test_limita_implicita_este_1m(rendered):
    api = _top_level(_servers(rendered)[DOMAIN])
    assert re.search(r"^\s*client_max_body_size\s+1m;", api, re.MULTILINE)
    assert not re.search(r"client_max_body_size\s+55m", api)


def test_location_upload_e_proxat_corect(rendered):
    _, body = _upload_location(rendered)
    # Snippet-ul comun proxy-api.conf e expandat de fixture (cum îl vede nginx).
    assert re.search(r"^\s*proxy_pass http://flirt_api;", body, re.MULTILINE)
    assert "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;" in body
    assert "proxy_set_header X-Forwarded-Proto $flirt_fwd_proto;" in body
    assert re.search(r"^\s*limit_req zone=flirt_general\b", body, re.MULTILINE)


UPLOAD_URIS = [
    "/api/v1/profiles/photos",
    "/api/v1/profiles/verify-face",
    "/api/v1/stories/media",
    "/api/v1/chats/0f8fad5b-d9cb-469f-a165-70867728950e/attachments",
    "/api/v1/ticket-requests/0f8fad5b-d9cb-469f-a165-70867728950e/payment-proof",
    "/api/v1/ticket-orders/0f8fad5b-d9cb-469f-a165-70867728950e/payment-proof",
    "/api/v1/admin/ads/media",
    "/api/v1/admin/events/cover",
    "/api/v1/admin/payment-settings/mia-qr",
]

SMALL_URIS = [
    "/api/v1/auth/login",
    "/api/v1/auth/telegram",
    "/api/v1/telegram/webhook",
    "/api/v1/profiles/me",
    "/api/v1/profiles/photos/order",
    "/api/v1/chats/abc/messages",
    "/api/v1/chats/abc/attachments/x",
    "/api/v1/stories/",
    "/api/v1/admin/users",
    "/media/photos/x.jpg",
    "/media/ticket-proofs/x/y.jpg",
    "/x/api/v1/profiles/photos",
]


@pytest.mark.parametrize("uri", UPLOAD_URIS)
def test_rutele_de_upload_primesc_55m(rendered, uri):
    pattern, _ = _upload_location(rendered)
    assert re.search(pattern, uri), uri


@pytest.mark.parametrize("uri", SMALL_URIS)
def test_restul_rutelor_raman_la_1m(rendered, uri):
    pattern, _ = _upload_location(rendered)
    assert not re.search(pattern, uri), uri


def test_lista_de_upload_acopera_toate_rutele_multipart_din_api(rendered):
    """Sincronizare cu codul: orice rută FastAPI care citește un formular
    multipart trebuie să cadă pe location-ul de 55m (altfel upload → 413)."""
    import importlib
    import pkgutil

    import app.api as api_pkg
    from app.main import app

    pattern, _ = _upload_location(rendered)
    markers = ("request.form()", "read_proof_form(", "handle_admin_upload(")

    # 1) Endpoint-urile (decorate cu @router.post/put/patch) care citesc multipart.
    upload_endpoints: set[str] = set()
    for info in pkgutil.walk_packages(api_pkg.__path__, "app.api."):
        module = importlib.import_module(info.name)
        for name, obj in vars(module).items():
            if not inspect.iscoroutinefunction(obj) or obj.__module__ != module.__name__:
                continue
            source = inspect.getsource(obj)
            if re.search(r"@router\.(post|put|patch)\(", source) and any(
                marker in source for marker in markers
            ):
                upload_endpoints.add(name)
    assert len(upload_endpoints) >= len(UPLOAD_URIS), upload_endpoints

    # 2) Calea lor COMPLETĂ (cu prefixele din router.py) din schema OpenAPI:
    #    operationId implicit = `<nume_funcție>_<cale>_<metodă>`.
    found = []
    for path, operations in app.openapi()["paths"].items():
        for method, op in operations.items():
            if method.upper() not in {"POST", "PUT", "PATCH"}:
                continue
            if any(op.get("operationId", "").startswith(f"{n}_") for n in upload_endpoints):
                uri = re.sub(r"\{[^}]+\}", "0f8fad5b-d9cb-469f-a165-70867728950e", path)
                found.append(uri)
                assert re.search(pattern, uri), f"ruta de upload {path} ar primi 413"
    assert len(found) >= len(UPLOAD_URIS), found


def test_template_nu_mai_are_55m_global():
    text = TEMPLATE.read_text(encoding="utf-8")
    assert len(re.findall(r"^\s*client_max_body_size\s+55m;", text, re.MULTILINE)) == 1


# --------------------------------------------------------------------------- #
# 6. Host necunoscut → 444 (doar /nginx-health pentru probele kubelet)
# --------------------------------------------------------------------------- #


def test_host_necunoscut_primeste_444(rendered):
    """Serverul implicit nu servește nimic pentru un Host străin (scanere, DNS
    rebinding): conexiune închisă. Singura excepție: `/nginx-health` (exact)."""
    clean = _strip_comments(rendered)
    defaults = []
    for match in re.finditer(r"^server\s*\{", clean, re.MULTILINE):
        body, _ = _block_body(clean, match.end() - 1)
        if re.search(r"^\s*listen\s+\S+\s+default_server;", body, re.MULTILINE):
            defaults.append(body)
    assert len(defaults) == 1, "exact UN server implicit"
    body = defaults[0]
    assert re.search(r"^\s*server_name\s+_;", body, re.MULTILINE)

    locations = {(mod, path): loc for mod, path, loc in _locations(body)}
    assert set(locations) == {("=", "/nginx-health"), ("", "/")}
    assert re.search(r"^\s*return 444;", locations[("", "/")], re.MULTILINE)
    assert "proxy_pass" not in body and "root" not in body
