"""Verificare facială (TZ 2.2) — abstracție FaceVerifier + implementări.

Provider-ul se alege din `settings.face_verify_provider`:
- 'stub' (implicit): nu atinge rețeaua, întoarce mereu (True, 99.0).
- 'rekognition': compară selfie-ul cu prima poză de referință via AWS
  Rekognition (`compare_faces`). Import boto3 LAZY, doar când e folosit.
"""
from typing import Protocol
from urllib.parse import urlparse

from app.core.config import settings


class FaceVerifier(Protocol):
    """Contractul minim de verificare facială folosit de servicii/endpoint-uri."""

    async def compare(
        self, selfie: bytes, reference_urls: list[str]
    ) -> tuple[bool, float]:
        """Compară un selfie cu pozele de referință.

        Întoarce `(verificat, scor)` unde scorul e similaritatea 0-100.
        """
        ...


class StubFaceVerifier:
    """Verificator fals pentru dezvoltare/teste: nu atinge rețeaua."""

    async def compare(
        self, selfie: bytes, reference_urls: list[str]
    ) -> tuple[bool, float]:
        """Întoarce mereu un rezultat pozitiv, fără rețea (RO: doar stub)."""
        return (True, 99.0)


class RekognitionFaceVerifier:
    """Verificator live pe AWS Rekognition (TZ 2.2). Import boto3 LAZY.

    Compară selfie-ul cu prima poză de referință (descărcată din S3).
    `verificat = SimilarityScore ≥ settings.face_match_threshold`.
    """

    def _rekognition_client(self):
        """Client Rekognition boto3 (import LAZY, config din settings)."""
        import boto3  # RO: import LAZY — doar când folosim Rekognition.

        return boto3.client(
            "rekognition",
            region_name=settings.s3_region,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
        )

    def _s3_client(self):
        """Client S3 boto3 pentru a descărca poza de referință (import LAZY)."""
        import boto3  # RO: import LAZY.

        return boto3.client(
            "s3",
            region_name=settings.s3_region,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
        )

    def _download_reference(self, url: str) -> bytes:
        """Descarcă bytes-ii primei poze de referință din S3 (cheie din URL)."""
        key = urlparse(url).path.lstrip("/")
        obj = self._s3_client().get_object(Bucket=settings.s3_bucket, Key=key)
        return obj["Body"].read()

    async def compare(
        self, selfie: bytes, reference_urls: list[str]
    ) -> tuple[bool, float]:
        """Compară selfie-ul cu prima poză de referință via Rekognition."""
        # RO: fără poze de referință nu putem verifica nimic.
        if not reference_urls:
            return (False, 0.0)

        reference = self._download_reference(reference_urls[0])
        response = self._rekognition_client().compare_faces(
            SourceImage={"Bytes": selfie},
            TargetImage={"Bytes": reference},
            SimilarityThreshold=settings.face_match_threshold,
        )

        matches = response.get("FaceMatches") or []
        if not matches:
            return (False, 0.0)

        score = float(matches[0].get("Similarity", 0.0))
        verified = score >= settings.face_match_threshold
        return (verified, score)


def get_face_verifier() -> FaceVerifier:
    """Fabrică de verificator facial în funcție de `settings.face_verify_provider`."""
    provider = settings.face_verify_provider
    if provider == "stub":
        return StubFaceVerifier()
    if provider == "rekognition":
        return RekognitionFaceVerifier()
    raise NotImplementedError(
        f"Provider de verificare facială necunoscut: '{provider}'. "
        "Valori permise: 'stub', 'rekognition'."
    )
