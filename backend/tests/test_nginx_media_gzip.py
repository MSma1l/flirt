"""nginx: media servită direct, gzip, limită pe /health.

CE VERIFICĂM
------------
1. `/media/*` e servit de nginx din volumul montat (nu proxat la Python), pe o
   zonă de limitare PROPRIE (nu `flirt_general`, care rupea pozele cu 429), cu
   cache lung `immutable` și cu antetele de securitate repetate (un `add_header`
   în location anulează moștenirea celor de la nivel de server).
2. Dovezile de plată (`/media/ticket-proofs/*`) NU sunt servite: aceeași regulă
   ca `_PublicMediaFiles` din app/main.py.
3. Deployment-ul `web` (deploy/k8s/manifests/web.yaml) montează PVC-ul de
   media READ-ONLY exact la rădăcina folosită de `location /media/`, iar `api`
   scrie în ACELAȘI PVC.
4. gzip e activ la nivel de `http`, cu JSON în listă.
5. `/health` are limită (era complet nelimitat).

Folosim parserul și randarea din `test_nginx_ratelimit_zones.py` (aceeași
randare ca producția, prin entrypoint-ul imaginii deploy/k8s/images/web/).
"""
from __future__ import annotations

import re

import pytest
import yaml

from tests.test_nginx_ratelimit_zones import (  # noqa: F401  (fixture importat)
    DOCKERFILE,
    REPO,
    _api_server,
    _locations,
    _match_location,
    _zone_of,
    _zones,
    rendered,
    rendered_raw,
)

MANIFESTS = REPO / "deploy" / "k8s" / "manifests"

SECURITY_HEADERS = [
    "add_header X-Content-Type-Options nosniff always;",
    "add_header X-Frame-Options DENY always;",
    "add_header Referrer-Policy no-referrer always;",
    'add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;',
]

MEDIA_URIS = [
    "/media/photos/1b4e28ba-2fa1-11d2-883f-0016d3cca427/0f8fad5bcf8a4c2e9d1b.jpg",
    "/media/stories/1b4e28ba/abc.mp4",
    "/media/chat-media/x/y.webp",
]


def _http_level(conf: str) -> str:
    """Directivele din afara oricărui bloc `server { ... }` (nivelul `http`)."""
    out, depth = [], 0
    for line in conf.splitlines():
        stripped = line.split("#", 1)[0]
        if depth == 0 and re.match(r"^\s*(map|server)\b", stripped) is None:
            out.append(stripped)
        depth += stripped.count("{") - stripped.count("}")
    return "\n".join(out)


# --------------------------------------------------------------------------- #
# 1. /media servit de nginx
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("uri", MEDIA_URIS)
def test_media_e_servita_din_disc_nu_proxata(rendered, uri):
    mod, path, body = _match_location(_locations(_api_server(rendered)), uri)

    assert (mod, path) == ("", "/media/")
    assert "proxy_pass" not in body, "media nu mai are voie să treacă prin Python"
    assert re.search(r"^\s*root /var/www;", body, re.MULTILINE)
    assert "try_files $uri =404;" in body


def test_media_are_zona_proprie_larga(rendered):
    body = _match_location(_locations(_api_server(rendered)), MEDIA_URIS[0])[2]
    zones = _zones(rendered)

    zone = _zone_of(body)
    assert zone == "flirt_media", "media a rămas pe zona generală (429 = poze rupte)"
    assert zones[zone]["rate"] == "100r/s"
    assert "limit_req zone=flirt_media burst=200 nodelay;" in body


def test_media_are_cache_lung_imuabil(rendered):
    body = _match_location(_locations(_api_server(rendered)), MEDIA_URIS[0])[2]

    # FĂRĂ `always`: un 404 pe /media nu are voie să fie cachat un an.
    assert 'add_header Cache-Control "public, max-age=31536000, immutable";' in body
    # `expires` ar adăuga un al doilea antet Cache-Control.
    assert not re.search(r"^\s*expires\b", body, re.MULTILINE)


def test_media_repeta_antetele_de_securitate(rendered):
    body = _match_location(_locations(_api_server(rendered)), MEDIA_URIS[0])[2]
    for header in SECURITY_HEADERS:
        assert header in body, f"lipsește din /media/: {header}"


def _media_types(body: str) -> dict[str, str]:
    """Blocul `types { ... }` din /media/ → {extensie: tip MIME}."""
    match = re.search(r"\btypes\s*\{([^}]*)\}", body)
    assert match, "/media/ nu are un bloc `types` explicit"
    out: dict[str, str] = {}
    for line in match.group(1).split(";"):
        parts = line.split("#", 1)[0].split()
        if parts:
            for ext in parts[1:]:
                out[ext] = parts[0]
    return out


def test_media_are_tipurile_mime_corecte_pentru_audio(rendered):
    """`mime.types` din nginx nu știe `.weba`/`.aac` (→ octet-stream, pe care
    WebView-ul iOS nu-l redă) și dă `.m4a` ca `audio/x-m4a`."""
    body = _match_location(_locations(_api_server(rendered)), MEDIA_URIS[0])[2]
    types = _media_types(body)

    assert types["m4a"] == "audio/mp4"
    assert types["aac"] == "audio/aac"
    assert types["mp3"] == "audio/mpeg"
    assert types["ogg"] == "audio/ogg"
    assert types["weba"] == "audio/webm"


def test_media_tipurile_acopera_toate_extensiile_generate_de_server(rendered):
    """`types` înlocuiește tabela întreagă în /media/: o extensie uitată ar fi
    servită ca octet-stream (poze/video rupte)."""
    from app.services.chat_media import _MIME_EXT
    from app.services.image_variants import VARIANT_EXT

    body = _match_location(_locations(_api_server(rendered)), MEDIA_URIS[0])[2]
    types = _media_types(body)
    for mime, ext in _MIME_EXT.items():
        assert types.get(ext) == mime, f".{ext} trebuie servit ca {mime}"
    for ext in ("jpg", "jpeg", "png", "webp", VARIANT_EXT):
        assert ext in types, f".{ext} lipsește din /media/ types"
    assert re.search(r"^\s*default_type application/octet-stream;", body, re.MULTILINE)


def test_media_nu_dezactiveaza_byte_range(rendered):
    """iOS redă audio/video DOAR cu cereri byte-range (206)."""
    body = _match_location(_locations(_api_server(rendered)), MEDIA_URIS[0])[2]
    assert not re.search(r"^\s*max_ranges\b", body, re.MULTILINE)
    assert not re.search(r"^\s*gzip\s+on\b", body, re.MULTILINE)


# --------------------------------------------------------------------------- #
# 2. Dovezile de plată NU sunt publice
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "uri",
    [
        "/media/ticket-proofs",
        "/media/ticket-proofs/",
        "/media/ticket-proofs/0f8fad5b/abc.jpg",
    ],
)
def test_dovezile_de_plata_dau_404(rendered, uri):
    mod, path, body = _match_location(_locations(_api_server(rendered)), uri)

    assert path.startswith("/media/ticket-proofs"), f"{uri} cade pe {path}"
    assert re.search(r"^\s*return 404;", body, re.MULTILINE)
    assert "root" not in body and "try_files" not in body


def test_nu_exista_location_regex_care_ar_putea_ocoli_blocarea(rendered):
    """Un `location ~` câștigă în fața prefixelor și ar putea servi
    `/media/ticket-proofs/...`. Singurul regex permis în serverul API e cel de
    upload (corp 55m), ANCORAT pe `^/api/v1/` — nu poate potrivi niciodată o
    cale `/media/...`, deci regula de mai sus rămâne valabilă."""
    regexes = re.findall(
        r"^\s*location\s+~\*?\s+(\S+)\s*\{", _api_server(rendered), re.MULTILINE
    )
    for pattern in regexes:
        assert pattern.startswith("^/api/v1/"), f"regex neancorat pe /api/v1/: {pattern}"
        for uri in ("/media/ticket-proofs/0f8fad5b/abc.jpg", "/media/photos/x.jpg"):
            assert not re.search(pattern, uri), f"{pattern} potrivește {uri}"


# --------------------------------------------------------------------------- #
# 3. Volumul de media e montat în nginx
# --------------------------------------------------------------------------- #


def _pod_spec(manifest: str, kind: str, name: str) -> dict:
    for doc in yaml.safe_load_all((MANIFESTS / manifest).read_text(encoding="utf-8")):
        if doc and doc["kind"] == kind and doc["metadata"]["name"] == name:
            return doc["spec"]["template"]["spec"]
    raise AssertionError(f"{kind}/{name} lipsește din {manifest}")


def _mount(spec: dict, container: str, path: str) -> tuple[dict, dict]:
    """(volumeMount, volum) pentru containerul dat la calea dată."""
    cont = next(c for c in spec["containers"] if c["name"] == container)
    mount = next((m for m in cont.get("volumeMounts", []) if m["mountPath"] == path), None)
    assert mount, f"{container}: nimic montat la {path}"
    volume = next(v for v in spec["volumes"] if v["name"] == mount["name"])
    return mount, volume


def test_web_monteaza_media_read_only(rendered):
    body = _match_location(_locations(_api_server(rendered)), MEDIA_URIS[0])[2]
    root = re.search(r"^\s*root\s+(\S+);", body, re.MULTILINE).group(1)
    media_dir = root.rstrip("/") + "/media"  # `location /media/` + `root` → <root>/media

    mount, volume = _mount(_pod_spec("web.yaml", "Deployment", "web"), "web", media_dir)
    # Read-only pe AMBELE niveluri: un nginx compromis nu poate scrie/înlocui media.
    assert mount.get("readOnly") is True
    assert volume["persistentVolumeClaim"].get("readOnly") is True
    assert volume["persistentVolumeClaim"]["claimName"] == "media"
    # Punctul de montare există în imagine (altfel nginx ar servi un dir gol).
    assert media_dir in DOCKERFILE.read_text(encoding="utf-8")


def test_api_scrie_in_acelasi_pvc_de_media():
    mount, volume = _mount(_pod_spec("api.yaml", "Deployment", "api"), "api", "/data/media")
    assert not mount.get("readOnly")
    assert volume["persistentVolumeClaim"]["claimName"] == "media"


# --------------------------------------------------------------------------- #
# 4. gzip
# --------------------------------------------------------------------------- #


def test_gzip_activ_la_nivel_http(rendered):
    http = _http_level(rendered)

    assert re.search(r"^gzip on;", http, re.MULTILINE)
    assert re.search(r"^gzip_proxied any;", http, re.MULTILINE), (
        "fără gzip_proxied, răspunsurile proxate (API-ul) nu se comprimă"
    )
    assert re.search(r"^gzip_vary on;", http, re.MULTILINE)
    types = re.search(r"^gzip_types (.+);", http, re.MULTILINE)
    assert types, "lipsește gzip_types"
    for mime in ("application/json", "application/javascript", "text/css"):
        assert mime in types.group(1).split()


# --------------------------------------------------------------------------- #
# 5. /health limitat
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("uri", ["/health", "/health/ready"])
def test_health_are_limita(rendered, uri):
    body = _match_location(_locations(_api_server(rendered)), uri)[2]

    assert _zone_of(body) == "flirt_general"
    assert re.search(r"limit_req zone=flirt_general burst=10\b", body)
