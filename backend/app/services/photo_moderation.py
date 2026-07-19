"""Moderare automată a imaginilor (detecție NSFW) — cerință Apple Guideline 1.2.

Provider-ul se alege din `settings.photo_moderation_provider`:
- 'stub' (implicit): nu atinge rețeaua, întoarce mereu allowed=True.
- 'anthropic': Claude vision direct, prin SDK-ul Anthropic (cere o cheie Anthropic
  REALĂ). Rămâne suportat, dar NU e providerul nostru — vezi mai jos.
- 'openrouter': ACELAȘI model Claude vision, dar prin OpenRouter (`services/ai.py`).
  Ăsta e providerul folosit efectiv: cheia de care dispunem e OpenRouter, iar pe
  api.anthropic.com dă 401, deci providerul 'anthropic' e mort în practică pentru
  noi (dar valid pentru oricine are o cheie Anthropic).
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
from app.services import ai

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

Answer with ONLY a JSON object, no prose, in exactly this shape:
{"allowed": true or false, "category": one of \
"safe", "nudity", "sexual_activity", "minor", "violence"}
Use "safe" as the category whenever allowed is true."""

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


class OpenRouterPhotoModerator:
    """Moderator pe Claude vision, prin OpenRouter. Refolosește `services/ai.py`.

    Diferența față de `AnthropicPhotoModerator` e DOAR transportul (OpenRouter,
    protocol OpenAI-compatibil, `httpx`) — promptul, schema și regulile de verdict
    sunt aceleași. `ai.complete_vision` nu ridică excepții: orice eroare vine ca
    `AIResult.error`, pe care îl transformăm direct în FAIL-OPEN.
    """

    async def check(self, image: bytes, media_type: str) -> ModerationVerdict:
        """Cere modelului un verdict; FAIL-OPEN la orice eroare (inclusiv 429)."""
        result = await ai.complete_vision(
            _PROMPT,
            image,
            media_type,
            model=settings.ai_vision_model,
            max_tokens=256,
            # RO: cerem JSON garantat. `json_schema` nu e suportat de toate
            # modelele de pe OpenRouter, dar `json_object` da — iar promptul cere
            # deja explicit „doar obiectul JSON". Parsarea de mai jos e oricum
            # defensivă, deci un model care ignoră câmpul nu ne strică.
            response_format={"type": "json_object"},
        )
        if not result.ok:
            # RO: FAIL-OPEN — o pană/limitare la OpenRouter nu blochează uploadul.
            logger.warning(
                "photo_moderation: OpenRouter indisponibil (%s) — FAIL-OPEN, poza "
                "trece și e marcată pentru review uman.",
                result.error,
            )
            return _fail_open(result.error or "openrouter_error")

        try:
            payload = json.loads(_strip_code_fence(result.text or ""))
            if not isinstance(payload, dict) or "allowed" not in payload:
                raise ValueError("lipsește câmpul 'allowed'")
            allowed = bool(payload["allowed"])
        except (TypeError, ValueError):
            # RO: `allowed` e câmpul PORTANT. Fără el nu putem decide → fail-open.
            logger.error(
                "photo_moderation: răspuns OpenRouter neparsabil — FAIL-OPEN."
            )
            return _fail_open("unparsable_response")

        # RO: `category` e SECUNDARĂ — doar eticheta respingerii. Modelele de pe
        # OpenRouter uneori o omit sau o numesc altfel (`reason`). NU cădem în
        # fail-open pentru asta: ar lăsa o poză RESPINSĂ (`allowed=false`) să
        # treacă doar fiindcă modelul n-a numit categoria. Derivăm o etichetă
        # sigură când lipsește: poză permisă → 'safe', respinsă → 'other'.
        raw = payload.get("category") or payload.get("reason")
        category = str(raw) if raw else (CATEGORY_SAFE if allowed else "other")

        if allowed or category == CATEGORY_SAFE:
            return ModerationVerdict(allowed=True, raw_label=category)
        return ModerationVerdict(allowed=False, reason=category, raw_label=category)


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


def _strip_code_fence(text: str) -> str:
    """Scoate un eventual gard ```json ... ``` din jurul răspunsului.

    Modelele care nu respectă `response_format` întorc JSON-ul împachetat în
    markdown. E o linie de cod care salvează un FAIL-OPEN inutil (adică o poză
    NEmoderată) de fiecare dată când se întâmplă.
    """
    text = text.strip()
    if not text.startswith("```"):
        return text
    body = text[3:]
    if body.lower().startswith("json"):
        body = body[4:]
    return body.rsplit("```", 1)[0].strip()


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
    if provider == "openrouter":
        return OpenRouterPhotoModerator()
    if provider == "rekognition":
        return RekognitionPhotoModerator()
    raise NotImplementedError(
        f"Provider de moderare foto necunoscut: '{provider}'. "
        "Valori permise: 'stub', 'anthropic', 'openrouter', 'rekognition'."
    )
