"""Moderare automată a imaginilor (detecție NSFW) — cerință Apple Guideline 1.2.

Provider-ul se alege din `settings.photo_moderation_provider`:
- 'stub' (implicit): nu atinge rețeaua, întoarce mereu allowed=True.
- 'anthropic': Claude vision (structured outputs → JSON garantat).
- 'rekognition': AWS `detect_moderation_labels`. Import boto3 LAZY, ca în face_verify.

FAIL-OPEN (decizie deliberată)
------------------------------
Dacă providerul cade (timeout, 5xx, rate limit, cheie greșită), NU blocăm uploadul:
o pană la Anthropic/AWS ar face aplicația inutilizabilă. Logăm cu `logger.warning` /
`logger.error` și lăsăm poza să treacă, marcată pentru review uman (`needs_review`).
Doar un verdict EXPLICIT negativ al modelului respinge poza (422 în endpoint).
"""
from __future__ import annotations

import base64
import json
import logging
from dataclasses import dataclass
from typing import Protocol

from app.core.config import settings

logger = logging.getLogger("app.photo_moderation")

# Categoriile pe care le raportăm în sus (`ModerationVerdict.reason`).
CATEGORY_SAFE = "safe"
CATEGORY_NUDITY = "nudity"
CATEGORY_SEXUAL_ACTIVITY = "sexual_activity"
CATEGORY_VIOLENCE = "violence"
CATEGORY_MINOR = "minor"
CATEGORY_OTHER = "other"

# RO: prompt-ul e în ENGLEZĂ (modelul e antrenat mai bine așa) și e EXPLICIT că e o
# aplicație de dating: fără contextul ăsta modelul respinge poze de plajă perfect
# normale, iar produsul devine inutilizabil.
_PROMPT = """\
You are a content moderator for FLIRT, an 18+ dating app. Users upload profile \
photos of themselves. Beach, gym, and nightlife photos are completely normal and \
expected on a dating app — do NOT reject them.

REJECT the photo (allowed=false) only if it clearly contains any of:
- nudity: exposed genitals, exposed female breasts/nipples, or exposed buttocks;
- sexual_activity: any depicted sexual act, masturbation, or sex toys in use;
- minor: any person who appears to be under 18 depicted in a sexualized way \
(swimwear/underwear, suggestive pose, or sexual context);
- violence: graphic violence, gore, wounds, blood, weapons used against a person.

ALLOW the photo (allowed=true) for anything else, including:
- swimwear, bikinis, beach and pool photos;
- underwear/lingerie worn normally (as clothing, not in a sexual act);
- cleavage, bare male chest/torso, tight or revealing clothing;
- sport, gym, dance, and fitness photos;
- tattoos, body art, piercings, body paint;
- artistic or fashion photography without explicit nudity.

When in doubt about an adult photo, ALLOW it. Be strict only about the four \
rejection categories above.

Answer with the JSON object only."""

# Schema pentru structured outputs — garantează un JSON parsabil, fără prompt-
# engineering fragil („răspunde doar cu JSON, te rog").
_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "allowed": {"type": "boolean"},
        "category": {
            "type": "string",
            "enum": [
                CATEGORY_SAFE,
                CATEGORY_NUDITY,
                CATEGORY_SEXUAL_ACTIVITY,
                CATEGORY_VIOLENCE,
                CATEGORY_MINOR,
                CATEGORY_OTHER,
            ],
        },
    },
    "required": ["allowed", "category"],
    "additionalProperties": False,
}

# Etichetele Rekognition (top-level `detect_moderation_labels`) → categoriile noastre.
# Cheia e verificată pe `ParentName` sau `Name`, case-insensitive.
_REKOGNITION_CATEGORY_MAP = {
    "explicit nudity": CATEGORY_NUDITY,
    "explicit": CATEGORY_NUDITY,
    "non-explicit nudity of intimate parts and kissing": CATEGORY_NUDITY,
    "sexual activity": CATEGORY_SEXUAL_ACTIVITY,
    "violence": CATEGORY_VIOLENCE,
    "visually disturbing": CATEGORY_VIOLENCE,
    "graphic violence": CATEGORY_VIOLENCE,
}

# RO: etichetele Rekognition pe care le IGNORĂM: sunt normale pe un app de dating
# (poze la plajă, lenjerie purtată, alcool într-un bar). Fără lista asta providerul
# ar respinge jumătate din pozele legitime.
_REKOGNITION_IGNORED = {
    "swimwear or underwear",
    "revealing clothes",
    "female swimwear or underwear",
    "male swimwear or underwear",
    "partially exposed buttocks",
    "implied nudity",
    "obstructed intimate parts",
    "alcohol",
    "drinking",
    "alcoholic beverages",
    "tobacco",
    "smoking",
    "gambling",
    "rude gestures",
    "middle finger",
    "drugs & tobacco",
    "alcohol beverages",
}


@dataclass
class ModerationVerdict:
    """Verdictul moderării unei imagini.

    - `allowed`: poza poate fi publicată?
    - `reason`: categoria respingerii ('nudity' | 'sexual_activity' | 'violence' |
      'minor' | 'other'), None dacă e permisă;
    - `raw_label`: eticheta brută a providerului (pentru loguri/debug);
    - `needs_review`: providerul a căzut și am aplicat FAIL-OPEN — poza a trecut, dar
      un om ar trebui să se uite la ea.
    """

    allowed: bool
    reason: str | None = None
    raw_label: str | None = None
    needs_review: bool = False


class PhotoModerator(Protocol):
    """Contractul minim de moderare a imaginilor folosit de endpoint-uri."""

    async def check(self, image: bytes, media_type: str) -> ModerationVerdict:
        """Verifică o imagine și întoarce verdictul.

        `media_type` e tipul-conținut canonic ('image/jpeg' | 'image/png' |
        'image/webp'), forțat server-side din magic-bytes.
        """
        ...


class StubPhotoModerator:
    """Moderator fals pentru dezvoltare/teste: nu atinge rețeaua."""

    async def check(self, image: bytes, media_type: str) -> ModerationVerdict:
        """Întoarce mereu allowed=True, fără rețea (RO: doar stub)."""
        return ModerationVerdict(allowed=True)


class AnthropicPhotoModerator:
    """Moderator pe Claude vision. Import `anthropic` LAZY (ca boto3 în face_verify).

    Folosește structured outputs (`output_config.format`) ca răspunsul să fie JSON
    garantat — fără parsare de text liber. SDK-ul reîncearcă singur 429/5xx.
    """

    def _client(self):
        """Client async Anthropic (import LAZY, cheia din settings)."""
        from anthropic import AsyncAnthropic  # RO: import LAZY.

        return AsyncAnthropic(api_key=settings.anthropic_api_key)

    async def check(self, image: bytes, media_type: str) -> ModerationVerdict:
        """Cere modelului un verdict; FAIL-OPEN la orice eroare de rețea/API."""
        import anthropic  # RO: import LAZY — doar când folosim providerul.

        data = base64.standard_b64encode(image).decode("utf-8")
        try:
            response = await self._client().messages.create(
                model=settings.photo_moderation_model,
                max_tokens=256,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": data,
                                },
                            },
                            {"type": "text", "text": _PROMPT},
                        ],
                    }
                ],
                output_config={
                    "format": {"type": "json_schema", "schema": _OUTPUT_SCHEMA}
                },
            )
        except anthropic.RateLimitError:
            # RO: FAIL-OPEN — o limitare temporară nu are voie să blocheze uploadul.
            logger.warning(
                "photo_moderation: Anthropic rate limit — FAIL-OPEN, poza trece "
                "și e marcată pentru review uman."
            )
            return _fail_open("rate_limit")
        except anthropic.APIConnectionError:
            logger.warning(
                "photo_moderation: Anthropic inaccesibil (rețea) — FAIL-OPEN."
            )
            return _fail_open("connection_error")
        except anthropic.APIStatusError as exc:
            logger.error(
                "photo_moderation: Anthropic a răspuns %s — FAIL-OPEN.",
                exc.status_code,
            )
            return _fail_open(f"api_status_{exc.status_code}")
        except Exception:  # noqa: BLE001 — orice altceva: tot FAIL-OPEN.
            logger.exception("photo_moderation: eroare neașteptată — FAIL-OPEN.")
            return _fail_open("unexpected_error")

        # RO: `output_config.format` garantează un bloc de text cu JSON valid; dacă
        # totuși lipsește sau e stricat, tot FAIL-OPEN (nu blocăm userul).
        try:
            text = next(b.text for b in response.content if b.type == "text")
            payload = json.loads(text)
            allowed = bool(payload["allowed"])
            category = str(payload["category"])
        except (StopIteration, KeyError, TypeError, ValueError):
            logger.error(
                "photo_moderation: răspuns Anthropic neparsabil — FAIL-OPEN."
            )
            return _fail_open("unparsable_response")

        if allowed or category == CATEGORY_SAFE:
            return ModerationVerdict(allowed=True, raw_label=category)
        return ModerationVerdict(
            allowed=False, reason=category, raw_label=category
        )


class RekognitionPhotoModerator:
    """Moderator pe AWS Rekognition (`detect_moderation_labels`). Import boto3 LAZY.

    Refolosește cheile AWS și regiunea din settings (aceleași ca S3/face_verify).
    Respinge doar etichetele peste `settings.nsfw_confidence_threshold` care se
    mapează pe una dintre categoriile noastre; restul (swimwear, alcool etc.) sunt
    ignorate — sunt normale pe un app de dating.
    """

    def _client(self):
        """Client Rekognition boto3 (import LAZY, config din settings)."""
        import boto3  # RO: import LAZY — doar când folosim Rekognition.

        return boto3.client(
            "rekognition",
            region_name=settings.s3_region,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
        )

    async def check(self, image: bytes, media_type: str) -> ModerationVerdict:
        """Cere Rekognition etichetele de moderare; FAIL-OPEN la orice eroare."""
        try:
            response = self._client().detect_moderation_labels(
                Image={"Bytes": image},
                MinConfidence=settings.nsfw_confidence_threshold,
            )
        except Exception:  # noqa: BLE001 — boto3 ridică zeci de tipuri; FAIL-OPEN.
            logger.exception("photo_moderation: eroare Rekognition — FAIL-OPEN.")
            return _fail_open("rekognition_error")

        for label in response.get("ModerationLabels") or []:
            name = str(label.get("Name") or "")
            parent = str(label.get("ParentName") or "")
            confidence = float(label.get("Confidence") or 0.0)
            if confidence < settings.nsfw_confidence_threshold:
                continue
            if name.lower() in _REKOGNITION_IGNORED:
                continue
            category = _REKOGNITION_CATEGORY_MAP.get(
                parent.lower()
            ) or _REKOGNITION_CATEGORY_MAP.get(name.lower())
            if category is None:
                continue
            return ModerationVerdict(
                allowed=False,
                reason=category,
                raw_label=f"{parent}/{name}" if parent else name,
            )

        return ModerationVerdict(allowed=True)


def _fail_open(label: str) -> ModerationVerdict:
    """Verdict FAIL-OPEN: poza trece, dar e marcată pentru review uman."""
    return ModerationVerdict(allowed=True, raw_label=label, needs_review=True)


def get_photo_moderator() -> PhotoModerator:
    """Fabrică de moderator în funcție de `settings.photo_moderation_provider`."""
    provider = settings.photo_moderation_provider
    if provider == "stub":
        return StubPhotoModerator()
    if provider == "anthropic":
        return AnthropicPhotoModerator()
    if provider == "rekognition":
        return RekognitionPhotoModerator()
    raise NotImplementedError(
        f"Provider de moderare foto necunoscut: '{provider}'. "
        "Valori permise: 'stub', 'anthropic', 'rekognition'."
    )
