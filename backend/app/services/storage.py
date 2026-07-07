"""Schelet de storage foto (TZ 2.4) — abstracție Storage + implementare STUB.

Provider-ul se alege din `settings.storage_provider`:
- 'stub' (implicit): nu scrie pe disc/rețea, întoarce un URL determinist.
- 's3': punct de conectare pentru boto3 (nu e implementat încă).
"""
from typing import Protocol
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


def get_storage() -> Storage:
    """Fabrică de storage în funcție de `settings.storage_provider`."""
    provider = settings.storage_provider
    if provider == "stub":
        return StubStorage()
    if provider == "s3":
        # RO: aici se adaugă S3Storage cu boto3 (client S3), folosind
        # settings.s3_bucket / s3_region / aws_access_key_id / aws_secret_access_key.
        # save(): boto3 put_object(Bucket=..., Key=..., Body=content,
        #         ContentType=content_type) → întoarce URL-ul public/CDN.
        # delete(): boto3 delete_object(Bucket=..., Key=...) derivat din URL.
        raise NotImplementedError(
            "Storage S3 nu este implementat încă. Setează AWS_* "
            "(AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET, S3_REGION) "
            "și adaugă implementarea boto3."
        )
    raise NotImplementedError(
        f"Provider de storage necunoscut: '{provider}'. Valori permise: 'stub', 's3'."
    )
