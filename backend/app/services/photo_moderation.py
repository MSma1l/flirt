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

FAIL-OPEN (decizie deliberată) + REZERVĂ LOCALĂ
------------------------------------------------
Dacă providerul cade (timeout, 5xx, rate limit, cheie greșită, răspuns neparsabil),
NU blocăm uploadul orbește: o pană la Anthropic/OpenRouter/AWS ar face aplicația
inutilizabilă. DAR, înainte de fail-open, pe providerele care merg pe rețea
(`OpenRouterPhotoModerator`, `AnthropicPhotoModerator`) intră `LocalPhotoModerator` —
un clasificator euristic FĂRĂ rețea (ton de piele în YCbCr, decodare la ≤64px). E o
REZERVĂ, nu un înlocuitor: fluxul normal (providerul răspunde) NU îl atinge deloc.
Local respinge DOAR pe semnal puternic și clar (cadru aproape integral piele); la
orice dubiu sau imagine nedecodabilă → păstrăm exact fail-open-ul de dinainte (poza
trece, marcată pentru review uman, `needs_review`). Se poate stinge din config
(`settings.ai_local_fallback`) fără redeploy. Doar un verdict EXPLICIT negativ (al
modelului sau al rezervei locale) respinge poza (422 în endpoint).
"""
from __future__ import annotations

import asyncio
import base64
import io
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

# --- Rezerva LOCALĂ: praguri de detecție „ton de piele" în YCbCr --------------
# DE CE YCbCr și nu RGB: în RGB, tonul de piele se împrăștie pe toată axa de
# luminozitate (piele deschisă vs închisă) și e greu de izolat cu un prag simplu.
# YCbCr separă luminanța (Y) de crominanță (Cb, Cr); tonurile de piele — de la foarte
# deschis la foarte închis — se STRÂNG într-un dreptunghi mic și stabil în planul
# (Cb, Cr), aproape independent de cât de luminată e poza. Folosim regula clasică
# Chai & Ngan (1999), una dintre cele mai citate în literatura de segmentare a feței:
# Cb ∈ [77, 127] și Cr ∈ [133, 173]. E robustă pe game largi de ten fiindcă lucrează
# pe crominanță, nu pe culoarea brută.
_SKIN_CB_MIN, _SKIN_CB_MAX = 77, 127
_SKIN_CR_MIN, _SKIN_CR_MAX = 133, 173
# Decodăm imaginea la cel mult ATÂȚIA pixeli pe latură înainte de analiză. La 64px,
# decodarea + conversia YCbCr costă câțiva ms și <1 MB RAM (cu `draft()` pe JPEG,
# decoderul întoarce direct o versiune mică) — neglijabil pe serverul nostru strâns
# la RAM. Raportul de piele pe o miniatură e practic același ca pe imaginea mare.
_LOCAL_MAX_SIDE = 64

# --- Imaginea trimisă providerelor de rețea ---------------------------------
# Modelul vision nu vede mai mult de ~1-1.5 MP oricum; trimiteam base64 din
# fișiere de până la 8 MB (latență + cost de upload, pe un server strâns). Peste
# pragurile astea micșorăm la ≤1024px JPEG q80 înainte de apel.
MODERATION_MAX_SIDE = 1024
MODERATION_JPEG_QUALITY = 80
# O imagine deja mică (latură ≤1024 și ≤ pragul ăsta) pleacă neschimbată.
_MODERATION_PASSTHROUGH_BYTES = 1024 * 1024


def downscale_for_moderation(image: bytes, media_type: str) -> tuple[bytes, str]:
    """(bytes, media_type) de trimis providerului: ≤1024px JPEG q80.

    Sincron (Pillow) — se cheamă prin `prepare_for_provider` / `to_thread`. La
    orice eroare de decodare întoarce intrarea neschimbată: verdictul (sau
    fail-open-ul) rămâne treaba providerului, nu a acestui pas de optimizare.
    """
    from PIL import Image, ImageOps

    try:
        with Image.open(io.BytesIO(image)) as img:
            width, height = img.size
            if (
                max(width, height) <= MODERATION_MAX_SIDE
                and len(image) <= _MODERATION_PASSTHROUGH_BYTES
            ):
                return image, media_type
            # JPEG: decoderul întoarce direct o versiune redusă (RAM/CPU mic).
            img.draft("RGB", (MODERATION_MAX_SIDE, MODERATION_MAX_SIDE))
            img.load()
            small = ImageOps.exif_transpose(img)
            if small.mode in ("RGBA", "LA", "P"):
                small = small.convert("RGBA")
                background = Image.new("RGB", small.size, (255, 255, 255))
                background.paste(small, mask=small.getchannel("A"))
                small = background
            elif small.mode != "RGB":
                small = small.convert("RGB")
            small.thumbnail((MODERATION_MAX_SIDE, MODERATION_MAX_SIDE), Image.Resampling.LANCZOS)
            out = io.BytesIO()
            small.save(out, format="JPEG", quality=MODERATION_JPEG_QUALITY, optimize=True)
            return out.getvalue(), "image/jpeg"
    except Exception:  # noqa: BLE001 — optimizare best-effort, nu poartă de validare
        return image, media_type


async def prepare_for_provider(image: bytes, media_type: str) -> tuple[bytes, str]:
    """`downscale_for_moderation` în firul de lucru (nu blochează event loop-ul)."""
    return await asyncio.to_thread(downscale_for_moderation, image, media_type)


# RO: prompt-ul e în ENGLEZĂ (modelul e antrenat mai bine așa) și e EXPLICIT că e o
# aplicație de dating: fără contextul ăsta modelul respinge poze de plajă perfect
# normale, iar produsul devine inutilizabil.
#
# DE CE e atât de insistent pe „minor": aceeași funcție moderează și pozele de
# STORY, care arată momente obișnuite (o sală de curs, o stradă, prieteni). În
# testare, modelul a respins o poză cu studenți fotografiați din spate într-un
# amfiteatru ca „minor" — doar fiindcă oamenii păreau tineri. Regula „minor" are
# sens DOAR combinată cu nuditate / context sexual; vârsta aparentă singură nu e
# niciodată motiv de respingere. Promptul cere și `confidence` + `sexual_content`,
# iar `_verdict_from_payload` aplică regulile în cod, nu doar în text.
_PROMPT = """\
You are a content moderator for FLIRT, an 18+ dating app. Users upload profile \
photos of themselves and 24-hour "stories" with everyday moments: friends, groups, \
classrooms and lecture halls, offices, streets, cafes, food, pets, landscapes, \
events. Beach, gym, and nightlife photos are completely normal and expected on a \
dating app — do NOT reject them.

REJECT the photo (allowed=false) only if it clearly and explicitly contains any of:
- nudity: exposed genitals, exposed female breasts/nipples, or fully exposed buttocks;
- sexual_activity: any depicted sexual act, masturbation, or sex toys in use;
- minor: a person who clearly appears to be a child or young teenager AND the \
photo is sexualized (nudity, underwear/swimwear shown in a suggestive way, a \
sexual pose, or a sexual context). Both conditions must be true;
- violence: graphic violence, gore, wounds, blood, weapons used against a person.

ALLOW the photo (allowed=true) for anything else, including:
- swimwear, bikinis, beach and pool photos;
- underwear/lingerie worn normally (as clothing, not in a sexual act);
- cleavage, bare male chest/torso, tight or revealing clothing;
- sport, gym, dance, and fitness photos;
- tattoos, body art, piercings, body paint;
- artistic or fashion photography without explicit nudity;
- fully clothed people of ANY apparent age in ordinary, non-sexual situations: \
students in a classroom or lecture hall, people seen from behind, crowds, \
families, school or university settings, young-looking adults.

Looking young, being in a school or university, or being in a group is NEVER by \
itself a reason to reject. When in doubt, ALLOW the photo. Reject only when you \
are highly confident one of the four categories above clearly applies.

Answer with ONLY a JSON object, no prose, in exactly this shape:
{"allowed": true or false, "category": one of \
"safe", "nudity", "sexual_activity", "minor", "violence", \
"confidence": a number from 0 to 1 — how certain you are that the category applies, \
"sexual_content": true only if the photo shows nudity or sexual content, else false}
Use "safe" as the category whenever allowed is true."""

# Sub pragul ăsta de încredere declarată de model, un verdict negativ NU respinge
# poza: trece, marcată pentru review uman (`needs_review`). Respingem doar ce
# modelul vede CLAR — o poză legitimă respinsă e un user pierdut, iar un caz
# limită rămâne oricum în fața unui om, prin log.
_REJECT_MIN_CONFIDENCE = 0.8

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
        "confidence": {"type": "number"},
        "sexual_content": {"type": "boolean"},
    },
    "required": ["allowed", "category", "confidence", "sexual_content"],
    "additionalProperties": False,
}

# Etichetele Rekognition (top-level `detect_moderation_labels`) → categoriile noastre.
# Cheia e verificată pe `ParentName` sau `Name`, case-insensitive.
# RO: familia „Non-Explicit Nudity of Intimate Parts and Kissing" (sărut, spate gol,
# piept de bărbat, nuditate DOAR sugerată) NU mai respinge: pe un app de dating e
# conținut normal, iar respingerea trebuie să rămână pentru ce e cu adevărat
# EXPLICIT (familia „Explicit").
_REKOGNITION_CATEGORY_MAP = {
    "explicit nudity": CATEGORY_NUDITY,
    "explicit": CATEGORY_NUDITY,
    "explicit sexual activity": CATEGORY_SEXUAL_ACTIVITY,
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

        image, media_type = await prepare_for_provider(image, media_type)
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
            # RO: pe TOATE căile de pană (limitare/rețea/status/neașteptat) încercăm
            # întâi rezerva LOCALĂ, apoi fail-open — la fel ca la OpenRouter.
            logger.warning(
                "photo_moderation: Anthropic rate limit — încerc rezerva LOCALĂ."
            )
            return await _local_fallback(image, media_type, "rate_limit")
        except anthropic.APIConnectionError:
            logger.warning(
                "photo_moderation: Anthropic inaccesibil (rețea) — încerc rezerva LOCALĂ."
            )
            return await _local_fallback(image, media_type, "connection_error")
        except anthropic.APIStatusError as exc:
            logger.error(
                "photo_moderation: Anthropic a răspuns %s — încerc rezerva LOCALĂ.",
                exc.status_code,
            )
            return await _local_fallback(
                image, media_type, f"api_status_{exc.status_code}"
            )
        except Exception:  # noqa: BLE001 — orice altceva: rezervă locală, apoi fail-open.
            logger.exception("photo_moderation: eroare neașteptată — încerc rezerva LOCALĂ.")
            return await _local_fallback(image, media_type, "unexpected_error")

        # RO: `output_config.format` garantează un bloc de text cu JSON valid; dacă
        # totuși lipsește sau e stricat, tot FAIL-OPEN (nu blocăm userul).
        try:
            text = next(b.text for b in response.content if b.type == "text")
            payload = json.loads(text)
            if not isinstance(payload, dict) or "allowed" not in payload:
                raise ValueError("lipsește câmpul 'allowed'")
        except (StopIteration, KeyError, TypeError, ValueError):
            logger.error(
                "photo_moderation: răspuns Anthropic neparsabil — încerc rezerva LOCALĂ."
            )
            return await _local_fallback(image, media_type, "unparsable_response")

        return _verdict_from_payload(payload)


class OpenRouterPhotoModerator:
    """Moderator pe Claude vision, prin OpenRouter. Refolosește `services/ai.py`.

    Diferența față de `AnthropicPhotoModerator` e DOAR transportul (OpenRouter,
    protocol OpenAI-compatibil, `httpx`) — promptul, schema și regulile de verdict
    sunt aceleași. `ai.complete_vision` nu ridică excepții: orice eroare vine ca
    `AIResult.error`, pe care îl transformăm direct în FAIL-OPEN.
    """

    async def check(self, image: bytes, media_type: str) -> ModerationVerdict:
        """Cere modelului un verdict; FAIL-OPEN la orice eroare (inclusiv 429)."""
        image, media_type = await prepare_for_provider(image, media_type)
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
            # RO: OpenRouter indisponibil (pană/limitare/restart). ÎNAINTE de fail-open
            # orb, dăm o șansă rezervei LOCALE (fără rețea) să prindă nuditatea evidentă.
            logger.warning(
                "photo_moderation: OpenRouter indisponibil (%s) — încerc rezerva LOCALĂ "
                "înainte de FAIL-OPEN.",
                result.error,
            )
            return await _local_fallback(
                image, media_type, result.error or "openrouter_error"
            )

        try:
            payload = json.loads(_strip_code_fence(result.text or ""))
            if not isinstance(payload, dict) or "allowed" not in payload:
                raise ValueError("lipsește câmpul 'allowed'")
        except (TypeError, ValueError):
            # RO: `allowed` e câmpul PORTANT. Fără el nu putem decide → rezervă locală,
            # apoi fail-open (ca pe calea de rețea căzută).
            logger.error(
                "photo_moderation: răspuns OpenRouter neparsabil — încerc rezerva LOCALĂ."
            )
            return await _local_fallback(image, media_type, "unparsable_response")

        return _verdict_from_payload(payload)


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
        image, _media_type = await prepare_for_provider(image, media_type)
        try:
            # boto3 e sincron (HTTP blocant) → firul de lucru.
            response = await asyncio.to_thread(
                lambda: self._client().detect_moderation_labels(
                    Image={"Bytes": image},
                    MinConfidence=settings.nsfw_confidence_threshold,
                )
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


class LocalPhotoModerator:
    """Moderator euristic LOCAL, fără NICIUN apel de rețea — REZERVĂ pentru fereastra
    de pană a providerului principal (OpenRouter/Anthropic).

    Ce POATE: doar un singur semnal — „raport mare de ton de piele" ⇒ posibilă
    nuditate. Decodează imaginea la ≤64px, o trece în YCbCr și numără pixelii care
    cad în dreptunghiul de crominanță al pielii (vezi constantele de mai sus).

    Ce NU POATE (limite oneste, ca să nu inventăm categorii): NU vede act sexual,
    violență/sânge, minori, arme, context. Un detector de piele nu deosebește o poză
    la plajă de una porno decât după CÂTĂ piele e în cadru — de aceea e pornit doar
    ca rezervă și respinge DOAR peste un prag foarte mare, conservator. Acele
    categorii rămân exclusiv pe seama providerului principal (Claude vision).

    Verdict:
    - piele ≥ prag (`settings.ai_local_skin_reject_ratio`) → allowed=False, nuditate;
    - sub prag → allowed=True (poza e probabil ok);
    - imagine nedecodabilă → allowed=True, dar NU decide nimic (raw_label marchează
      cazul); apelantul o tratează ca „local n-a putut ajuta" și păstrează fail-open.
    """

    async def check(self, image: bytes, media_type: str) -> ModerationVerdict:
        """Verdict pe raportul de ton de piele; la orice eroare de decodare NU decide."""
        try:
            ratio = await asyncio.to_thread(self._skin_ratio, image)
        except Exception:  # noqa: BLE001 — bytes invalizi/format nesuportat: NU decidem.
            logger.warning(
                "photo_moderation local: imagine nedecodabilă — nu decid, las fail-open."
            )
            return ModerationVerdict(allowed=True, raw_label="local_undecodable")

        threshold = settings.ai_local_skin_reject_ratio
        if ratio >= threshold:
            # RO: semnal CLAR și puternic (cadru aproape integral piele). Doar aici
            # respingem — sub prag lăsăm poza să treacă (vezi DE CE la constante).
            logger.warning(
                "photo_moderation local: raport piele %.2f ≥ %.2f — RESPING ca "
                "posibilă nuditate (rezervă offline, în locul fail-open-ului orb).",
                ratio,
                threshold,
            )
            return ModerationVerdict(
                allowed=False,
                reason=CATEGORY_NUDITY,
                raw_label=f"local_skin_{ratio:.2f}",
            )
        return ModerationVerdict(allowed=True, raw_label=f"local_skin_{ratio:.2f}")

    def _skin_ratio(self, image: bytes) -> float:
        """Raportul de pixeli „ton de piele" (0..1) pe o miniatură ≤64px, în YCbCr.

        Import Pillow LAZY (ca boto3 în Rekognition) — nu-l încarcă cine nu folosește
        rezerva. Numărarea e la nivel de C (point + multiply + histogram), fără buclă
        Python pe pixeli, deci rămâne ieftină.
        """
        from PIL import Image, ImageChops  # RO: import LAZY — doar în calea de rezervă.

        with Image.open(io.BytesIO(image)) as img:
            # `draft()`: pentru JPEG cere decoderului direct o versiune mică — nu mai
            # decodează cadrul la rezoluție integrală (esențial pt RAM/CPU). No-op pe
            # PNG/WebP, dar acolo `thumbnail` reduce oricum imediat după.
            img.draft("RGB", (_LOCAL_MAX_SIDE, _LOCAL_MAX_SIDE))
            img = img.convert("RGB")
            img.thumbnail((_LOCAL_MAX_SIDE, _LOCAL_MAX_SIDE))
            ycbcr = img.convert("YCbCr")
            # Mască 0/255 pe fiecare canal de crominanță, apoi AND prin înmulțire:
            # 255 doar acolo unde ȘI Cb ȘI Cr sunt în intervalul pielii.
            cb = ycbcr.getchannel(1).point(
                lambda v: 255 if _SKIN_CB_MIN <= v <= _SKIN_CB_MAX else 0
            )
            cr = ycbcr.getchannel(2).point(
                lambda v: 255 if _SKIN_CR_MIN <= v <= _SKIN_CR_MAX else 0
            )
            mask = ImageChops.multiply(cb, cr)
            total = mask.size[0] * mask.size[1]
            if total == 0:
                raise ValueError("imagine goală (0 pixeli)")
            return mask.histogram()[255] / total


async def _local_fallback(image: bytes, media_type: str, label: str) -> ModerationVerdict:
    """Rezerva offline pe calea care ACUM face fail-open orb.

    Când providerul principal e indisponibil (rețea căzută la restart, 429, răspuns
    neparsabil), în loc să lăsăm poza să treacă NEverificată, dăm o ȘANSĂ moderatorului
    LOCAL. Dacă local prinde nuditate EVIDENTĂ → respingem. Altfel (local zice ok sau
    nu poate decoda) → păstrăm EXACT comportamentul de dinainte: `_fail_open`, poza
    trece marcată pentru review uman. Deci rezerva doar ADAUGĂ o șansă de a prinde
    nuditatea evidentă; nu înrăutățește niciun caz legitim.
    """
    if not settings.ai_local_fallback:
        # RO: rezerva e stinsă din config (kill-switch fără redeploy) → fail-open ca înainte.
        return _fail_open(label)
    verdict = await LocalPhotoModerator().check(image, media_type)
    if not verdict.allowed:
        logger.warning(
            "photo_moderation: provider principal indisponibil (%s) — rezerva LOCALĂ "
            "a RESPINS poza (%s).",
            label,
            verdict.raw_label,
        )
        return verdict
    # RO: local a permis SAU n-a putut decoda → nu s-a schimbat nimic față de acum.
    return _fail_open(label)


def _confidence(value: object) -> float | None:
    """Încrederea declarată de model, adusă în [0, 1]; None dacă lipsește/e invalidă.

    Unele modele răspund pe scara 0–100 în loc de 0–1 — le normalizăm, altfel un
    „95" ar fi tratat ca încredere maximă doar din noroc, iar un „0.95" scris ca
    „95%" ar strica parsarea.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        number = float(str(value).strip().rstrip("%"))
    except ValueError:
        return None
    if number != number or number < 0:  # NaN sau negativ
        return None
    if number > 1:
        number = number / 100 if number <= 100 else 1.0
    return number


def _verdict_from_payload(payload: dict) -> ModerationVerdict:
    """Transformă răspunsul JSON al modelului (Anthropic SAU OpenRouter) în verdict.

    Regulile sunt în COD, nu doar în prompt — un model prea prudent nu mai poate
    respinge singur o poză obișnuită:

    1. `allowed=true` sau categoria 'safe' → permisă.
    2. `category` e SECUNDARĂ — doar eticheta respingerii. Modelele de pe
       OpenRouter uneori o omit sau o numesc altfel (`reason`). NU cădem în
       fail-open pentru asta: ar lăsa o poză RESPINSĂ să treacă doar fiindcă
       modelul n-a numit categoria. Lipsă → 'other'.
    3. Încredere declarată SUB `_REJECT_MIN_CONFIDENCE` → poza trece, marcată
       pentru review uman. Fără câmpul `confidence` (model care îl ignoră) NU
       relaxăm: verdictul negativ rămâne valabil, ca înainte.
    4. 'minor' respinge DOAR împreună cu `sexual_content=true`. „Pare tânăr"
       singur (o sală de curs, un grup de studenți) → trece, cu review uman: nu
       stingem protecția, doar mutăm cazul limită de la respingere automată la om.
    """
    allowed = bool(payload.get("allowed"))
    raw = payload.get("category") or payload.get("reason")
    category = str(raw) if raw else (CATEGORY_SAFE if allowed else CATEGORY_OTHER)

    if allowed or category == CATEGORY_SAFE:
        return ModerationVerdict(allowed=True, raw_label=category)

    confidence = _confidence(payload.get("confidence"))
    if confidence is not None and confidence < _REJECT_MIN_CONFIDENCE:
        return ModerationVerdict(
            allowed=True,
            raw_label=f"{category}_low_confidence_{confidence:.2f}",
            needs_review=True,
        )

    if category == CATEGORY_MINOR and payload.get("sexual_content") is not True:
        return ModerationVerdict(
            allowed=True,
            raw_label="minor_without_sexual_content",
            needs_review=True,
        )

    return ModerationVerdict(allowed=False, reason=category, raw_label=category)


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
