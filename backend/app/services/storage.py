"""Schelet de storage foto (TZ 2.4) — abstracție Storage + implementări.

Provider-ul se alege din `settings.storage_provider`:
- 'stub' (implicit): nu scrie pe disc/rețea, întoarce un URL determinist.
- 's3': stochează în AWS S3 prin boto3 (import LAZY, doar când e folosit).
"""
from typing import Protocol
from urllib.parse import urlparse
from uuid import uuid4

from app.core.config import settings


class Storage(Protocol):
    """Contractul minim de storage foto folosit de servicii/endpoint-uri."""

    async def save(self, filename: str, content: bytes, content_type: str) -> str:
        """Salvează conținutul și întoarce URL-ul public al fișierului."""
        ...

    async def delete(self, url: str) -> None:
        """Șterge fișierul asociat unui URL (idempotent)."""
        ...


class StubStorage:
    """Storage fals pentru dezvoltare/teste: nu atinge disc/rețea.

    Generează un URL determinist ca formă (bazat pe `storage_base_url`),
    dar unic prin `uuid4`. `delete` este no-op.
    """

    async def save(self, filename: str, content: bytes, content_type: str) -> str:
        """Întoarce un URL fără a persista nimic (RO: doar pentru stub)."""
        # RO: nu citim/scriem `content` — semnătura rămâne compatibilă cu S3.
        return f"{settings.storage_base_url}/photos/{uuid4().hex}/{filename}"

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

    async def save(self, filename: str, content: bytes, content_type: str) -> str:
        """Urcă `content` în bucket sub o cheie unică și întoarce URL-ul public."""
        # RO: cheie unică (uuid) sub prefixul photos/, păstrând numele fișierului.
        key = f"photos/{uuid4().hex}/{filename}"
        self._client().put_object(
            Bucket=settings.s3_bucket,
            Key=key,
            Body=content,
            ContentType=content_type,
        )
        return self._public_url(key)

    async def delete(self, url: str) -> None:
        """Șterge obiectul din bucket, derivând cheia din URL (idempotent)."""
        key = urlparse(url).path.lstrip("/")
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
