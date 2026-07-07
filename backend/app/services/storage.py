"""Schelet de storage foto (TZ 2.4) — abstracție Storage + implementări.

Provider-ul se alege din `settings.storage_provider`:
- 'stub' (implicit): nu scrie pe disc/rețea, întoarce un URL determinist.
- 's3': stochează în AWS S3 prin boto3 (import LAZY, doar când e folosit).
"""
from typing import Protocol
from urllib.parse import urlparse
from uuid import uuid4

from app.core.config import settings

# RO: mapare tip-conținut → extensie (allowlist intrinsecă, aliniată cu
# settings.allowed_image_types). Sursa de adevăr pentru extensia sigură a cheii.
_CONTENT_TYPE_EXT: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


def ext_for_content_type(content_type: str) -> str | None:
    """Extensia sigură pentru un tip de conținut permis (None dacă nepermis)."""
    if content_type not in settings.allowed_image_types_set:
        return None
    return _CONTENT_TYPE_EXT.get(content_type)


def allowed_hosts() -> set[str]:
    """Domeniile permise pentru URL-urile de poze (storage propriu + bucket S3).

    Se derivă exclusiv din settings (fără hardcodare): host-ul din
    `storage_base_url` și, dacă e configurat S3, domeniul standard al bucketului.
    """
    hosts: set[str] = set()
    base_host = urlparse(settings.storage_base_url).netloc
    if base_host:
        hosts.add(base_host)
    if settings.s3_bucket and settings.s3_region:
        hosts.add(f"{settings.s3_bucket}.s3.{settings.s3_region}.amazonaws.com")
    return hosts


def photo_prefix(profile_id) -> str:
    """Prefixul de cheie S3 rezervat pozelor unui profil."""
    return f"photos/{profile_id}/"


def build_photo_key(profile_id, content_type: str) -> str:
    """Cheie S3 sigură, generată server-side: `photos/{profile_id}/{uuid}.{ext}`.

    Numele NU provine din `filename` controlat de user (anti path traversal);
    extensia vine din `content_type` validat față de allowlist (ValueError altfel).
    """
    ext = ext_for_content_type(content_type)
    if ext is None:
        raise ValueError(f"Tip de conținut nepermis: {content_type!r}")
    return f"{photo_prefix(profile_id)}{uuid4().hex}.{ext}"


def key_from_own_url(url: str, profile_id) -> str | None:
    """Întoarce cheia S3 dacă `url` e în storage-ul nostru ȘI sub prefixul
    `photos/{profile_id}/` al userului curent; altfel None (respins).

    Blochează ștergerea/citirea arbitrară de obiecte prin URL controlat de user
    (inclusiv cheile altui profil din același bucket).
    """
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc not in allowed_hosts():
        return None
    key = parsed.path.lstrip("/")
    if not key.startswith(photo_prefix(profile_id)):
        return None
    return key


def key_within_namespace(url: str) -> str | None:
    """Defense-in-depth: cheia dacă host-ul e al nostru și cheia e sub `photos/`.

    Nu leagă de un profil anume — folosit în layerul de storage/verify unde
    `profile_id` nu e disponibil, pentru a refuza chei în afara namespace-ului.
    """
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc not in allowed_hosts():
        return None
    key = parsed.path.lstrip("/")
    if not key.startswith("photos/"):
        return None
    return key


class Storage(Protocol):
    """Contractul minim de storage foto folosit de servicii/endpoint-uri."""

    async def save(self, key: str, content: bytes, content_type: str) -> str:
        """Salvează `content` sub cheia (deja sigură) `key` și întoarce URL-ul.

        Cheia e calculată de apelant cu `build_photo_key` (uuid + extensie
        validă, prefix `photos/{profile_id}/`) — niciodată din `filename` brut.
        """
        ...

    async def delete(self, url: str) -> None:
        """Șterge fișierul asociat unui URL (idempotent)."""
        ...


class StubStorage:
    """Storage fals pentru dezvoltare/teste: nu atinge disc/rețea.

    Generează un URL determinist ca formă (bazat pe `storage_base_url`),
    dar unic prin `uuid4`. `delete` este no-op.
    """

    async def save(self, key: str, content: bytes, content_type: str) -> str:
        """Întoarce un URL determinist ca formă din `key`, fără a persista."""
        # RO: nu citim/scriem `content` — semnătura rămâne compatibilă cu S3.
        return f"{settings.storage_base_url}/{key.lstrip('/')}"

    async def delete(self, url: str) -> None:
        """No-op în stub — nimic de șters."""
        return None


class S3Storage:
    """Storage live pe AWS S3 (TZ 2.4). Import boto3 LAZY, din interiorul metodelor.

    Astfel stub-ul și restul aplicației nu depind de boto3 la import.
    Credențialele/regiunea/bucket-ul vin exclusiv din `settings`.
    """

    def _client(self):
        """Construiește un client S3 boto3 (import LAZY, config din settings)."""
        import boto3  # RO: import LAZY — doar când chiar folosim S3.

        return boto3.client(
            "s3",
            region_name=settings.s3_region,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
        )

    def _public_url(self, key: str) -> str:
        """URL-ul public standard S3 pentru o cheie dată."""
        return (
            f"https://{settings.s3_bucket}.s3.{settings.s3_region}"
            f".amazonaws.com/{key}"
        )

    async def save(self, key: str, content: bytes, content_type: str) -> str:
        """Urcă `content` sub cheia sigură `key` (calculată de apelant).

        `ContentType` e forțat dintr-o listă sigură de apelant (nu din header-ul
        de upload direct). Cheia nu conține `filename` brut de la user.
        """
        self._client().put_object(
            Bucket=settings.s3_bucket,
            Key=key.lstrip("/"),
            Body=content,
            ContentType=content_type,
        )
        return self._public_url(key.lstrip("/"))

    async def delete(self, url: str) -> None:
        """Șterge obiectul din bucket doar dacă cheia e în namespace-ul nostru.

        Derivă cheia din URL, dar refuză (no-op) orice URL în afara host-ului
        propriu sau a prefixului `photos/` — anti ștergere arbitrară de obiecte.
        """
        key = key_within_namespace(url)
        if not key:
            return None
        self._client().delete_object(Bucket=settings.s3_bucket, Key=key)
        return None


def get_storage() -> Storage:
    """Fabrică de storage în funcție de `settings.storage_provider`."""
    provider = settings.storage_provider
    if provider == "stub":
        return StubStorage()
    if provider == "s3":
        return S3Storage()
    raise NotImplementedError(
        f"Provider de storage necunoscut: '{provider}'. Valori permise: 'stub', 's3'."
    )
