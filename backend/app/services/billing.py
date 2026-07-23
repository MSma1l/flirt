"""Monetizare (TZ 9) — catalog de planuri + validarea REALĂ a achizițiilor.

Provider-ul se alege din `settings.billing_provider`:
- 'stub' (implicit, dev): `purchase` „cumpără" imediat, fără plată reală.
- 'app_store': verificare LOCALĂ a JWS-ului StoreKit 2 (vezi mai jos).
- 'play': `purchases.subscriptionsv2.get` cu un service account Google.
- 'stripe': verificarea sesiunii de checkout (web, în afara magazinelor).

DE CE VERIFICARE LOCALĂ (StoreKit 2), NU `verifyReceipt`
--------------------------------------------------------
`verifyReceipt` e API-ul LEGACY al Apple: cere un secret partajat, un apel de rețea
în calea critică a fiecărei achiziții și, în plus, primea un receipt base64 pe care
clientul nostru (StoreKit 2 / `expo-iap`) nici măcar nu-l mai produce — el trimite un
JWS SEMNAT (`jwsRepresentationIos`). Abordarea modernă recomandată de Apple e
verificarea semnăturii offline: decodăm header-ul JWS, luăm lanțul de certificate
`x5c` și îl verificăm până la Apple Root CA G3. Fără verificarea LANȚULUI, un JWS
decodat e doar un JSON pe care oricine îl poate fabrica.

BIBLIOTECA: `app-store-server-library` (oficială Apple, PyPI). Am ales-o în locul unei
implementări proprii pe `cryptography` + `pyjwt` pentru că verificarea lanțului are
capcane care se plătesc scump dacă le greșești (OID-urile Apple de pe leaf/intermediar,
validarea la data SEMNĂRII nu la `now`, checks stricte X509, OCSP). S-a instalat curat
în venv, fără conflicte (`pip check` OK). Importul e tolerant: dacă biblioteca lipsește
din mediu, providerul `app_store` întoarce 503 cu mesaj clar, nu un crash la pornire.

Entitlements-urile (drepturile) sunt derivate din planul abonamentului activ,
fără hardcodare la nivel de endpoint.
"""
from __future__ import annotations

import glob
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.billing import PurchaseReceipt, Subscription
from app.models.user import User
from app.schemas.billing import EntitlementsOut, PlanOut, SubscriptionOut

logger = logging.getLogger("app.billing")

# Biblioteca oficială Apple e opțională la IMPORT: un mediu care rulează pe 'stub'
# (dev, CI) nu trebuie să crape doar pentru că nu are dependența de producție.
try:  # pragma: no cover - depinde de mediul de instalare
    from appstoreserverlibrary.models.Environment import Environment as AppleEnvironment
    from appstoreserverlibrary.signed_data_verifier import (
        SignedDataVerifier,
        VerificationException,
        VerificationStatus,
    )

    _APPLE_LIB_AVAILABLE = True
except ImportError:  # pragma: no cover
    _APPLE_LIB_AVAILABLE = False

# Durata unui ciclu de abonament (zile). Folosită DOAR când providerul nu întoarce o
# dată de expirare proprie (stub, Stripe). La App Store / Play folosim data REALĂ:
# altfel un abonament anulat rămânea activ 30 de zile, plătit de noi.
_STUB_PERIOD_DAYS = 30

# Timeout comun pentru apelurile HTTP către provideri (secunde).
_HTTP_TIMEOUT = 10.0

# Endpoint-uri oficiale (o singură sursă de adevăr, fără hardcodare la apel).
_STRIPE_SESSION_URL = "https://api.stripe.com/v1/checkout/sessions"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_PLAY_API = "https://androidpublisher.googleapis.com/androidpublisher/v3"
_GOOGLE_PLAY_SCOPE = "https://www.googleapis.com/auth/androidpublisher"

# Stripe: statusuri care confirmă o plată reușită.
_STRIPE_PAID_STATES = {"paid", "complete", "succeeded"}

# Google Play: stări de abonament care dau dreptul la conținut. `ON_HOLD`/`PAUSED`/
# `EXPIRED`/`CANCELED` NU intră aici — utilizatorul nu mai plătește.
_PLAY_ACTIVE_STATES = {
    "SUBSCRIPTION_STATE_ACTIVE",
    "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
}

# Catalogul de planuri (TZ 9). Cheia = codul planului stocat pe Subscription.
# Descriptiv (titlu + features); PREȚURILE vin din `settings` (vezi `_PLAN_PRICE_ATTRS`).
# Fiecare plan mapează la drepturi via `_PLAN_ENTITLEMENTS` de mai jos.
PLANS: dict[str, dict] = {
    "premium": {
        "code": "premium",
        "title": "Premium",
        "features": [
            "Swipe nelimitat",
            "Fără timer și fără reclamă",
            "Undo nelimitat",
            "Prioritate în feed",
        ],
    },
    "no_ads": {
        "code": "no_ads",
        "title": "Fără reclamă",
        "features": [
            "Dezactivează bannerele și reclama video",
            "Fără ridicarea limitei de swipe",
        ],
    },
    "ai_bot": {
        "code": "ai_bot",
        "title": "AI-bot în chat",
        "features": [
            "Sugestii de mesaje extinse",
            "Analiză de compatibilitate peste limita free",
        ],
    },
    "all_inclusive": {
        "code": "all_inclusive",
        "title": "Totul inclus",
        "features": [
            "Premium complet",
            "Fără reclamă",
            "AI-bot în chat",
            "Reduceri la evenimente",
            "Preț redus față de cumpărarea separată",
        ],
    },
    "card_5": {
        "code": "card_5",
        "title": "Card reduceri — 5 intrări",
        "features": [
            "Acces la reducerile de la evenimente",
            "5 intrări (check-in-uri) cu reducere",
            "Se consumă câte o intrare la fiecare check-in",
        ],
    },
    "card_10": {
        "code": "card_10",
        "title": "Card reduceri — 10 intrări",
        "features": [
            "Acces la reducerile de la evenimente",
            "10 intrări (check-in-uri) cu reducere",
            "Se consumă câte o intrare la fiecare check-in",
        ],
    },
}

# Câte intrări (check-in-uri cu reducere) dă fiecare card. Un plan care NU e aici
# nu e un card ⇒ nu ține evidența intrărilor (entries_* rămân NULL).
_CARD_PLAN_ENTRIES: dict[str, int] = {
    "card_5": 5,
    "card_10": 10,
}

# Maparea plan -> câmpul de preț din `settings` (o singură sursă de adevăr).
_PLAN_PRICE_ATTRS: dict[str, str] = {
    "premium": "price_premium",
    "no_ads": "price_no_ads",
    "ai_bot": "price_ai_bot",
    "all_inclusive": "price_all_inclusive",
    "card_5": "price_card_5",
    "card_10": "price_card_10",
}

# Absența oricărui drept (fără abonament activ, sau plan necunoscut).
_NO_ENTITLEMENTS: dict[str, bool] = {
    "premium": False,
    "no_ads": False,
    "ai_bot": False,
    "event_discount": False,
}

# Maparea plan -> drepturi. `all_inclusive` cumulează toate flag-urile; cardurile de
# reduceri dau DOAR `event_discount` (accesul la promo-ul evenimentelor).
_PLAN_ENTITLEMENTS: dict[str, dict[str, bool]] = {
    "premium": {"premium": True, "no_ads": True, "ai_bot": False, "event_discount": False},
    "no_ads": {"premium": False, "no_ads": True, "ai_bot": False, "event_discount": False},
    "ai_bot": {"premium": False, "no_ads": False, "ai_bot": True, "event_discount": False},
    "all_inclusive": {"premium": True, "no_ads": True, "ai_bot": True, "event_discount": True},
    "card_5": {"premium": False, "no_ads": False, "ai_bot": False, "event_discount": True},
    "card_10": {"premium": False, "no_ads": False, "ai_bot": False, "event_discount": True},
}


def card_entries_for_plan(plan: str) -> int | None:
    """Numărul de intrări pe care le dă un plan card, sau None dacă nu e card."""
    return _CARD_PLAN_ENTRIES.get(plan)


@dataclass(frozen=True)
class VerifiedPurchase:
    """O tranzacție DOVEDITĂ criptografic (sau de API-ul magazinului).

    Tot ce e aici vine din date semnate de magazin — nimic din ce a spus clientul.
    Asta e diferența dintre „userul zice că a cumpărat all_inclusive" și „Apple a
    semnat că a cumpărat produsul X, care expiră la data Y".
    """

    provider: str
    transaction_id: str
    original_transaction_id: str
    product_id: str
    plan: str
    environment: str
    expires_at: datetime


def list_plans() -> list[PlanOut]:
    """Catalogul public de planuri; prețurile vin din `settings`."""
    return [
        PlanOut(price_eur=getattr(settings, _PLAN_PRICE_ATTRS[code]), **plan)
        for code, plan in PLANS.items()
    ]


def _is_active(sub: Subscription | None) -> bool:
    """True dacă abonamentul e 'active' și nu a expirat."""
    if sub is None or sub.status != "active":
        return False
    if sub.expires_at is not None:
        expires = sub.expires_at
        # RO: unele backend-uri (ex. SQLite) întorc datetime naive; îl tratăm UTC.
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires <= datetime.now(timezone.utc):
            return False
    return True


async def get_subscription(db: AsyncSession, user: User) -> SubscriptionOut | None:
    """Abonamentul curent al userului (cel mai recent), sau None."""
    result = await db.execute(
        select(Subscription)
        .where(Subscription.user_id == user.id)
        .order_by(Subscription.created_at.desc())
    )
    sub = result.scalars().first()
    if sub is None:
        return None
    return SubscriptionOut(
        plan=sub.plan,
        status=sub.status,
        expires_at=sub.expires_at,
        entries_total=sub.entries_total,
        entries_remaining=sub.entries_remaining,
    )


def _payment_required(detail: str) -> HTTPException:
    """Eroare uniformă când validarea plății eșuează la un provider live."""
    return HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=detail)


async def _verify_stripe(receipt: str | None) -> None:
    """Verifică o plată Stripe după id-ul sesiunii de checkout (`receipt`).

    Face GET la Stripe API cu basic auth (`stripe_secret_key` ca username) și
    acceptă doar dacă `payment_status`/`status` indică o plată reușită.
    """
    if not receipt:
        raise _payment_required("Lipsește id-ul sesiunii de plată Stripe.")

    url = f"{_STRIPE_SESSION_URL}/{receipt}"
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(url, auth=(settings.stripe_secret_key, ""))
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:  # RO: rețea / status HTTP != 2xx
        logger.warning("Stripe verify failed: %s", exc)
        raise _payment_required("Verificarea plății Stripe a eșuat.") from exc

    # Acceptăm dacă oricare dintre indicatorii de status confirmă plata.
    states = {
        str(data.get("payment_status", "")).lower(),
        str(data.get("status", "")).lower(),
    }
    if not (states & _STRIPE_PAID_STATES):
        raise _payment_required("Plata Stripe nu este confirmată (neplătită).")


# --- App Store: verificare locală a JWS-ului StoreKit 2 -----------------------


def _misconfigured(detail: str) -> HTTPException:
    """503 când LIPSEȘTE configurarea providerului.

    Nu e vina userului că n-am pus cheile pe server ⇒ nu 402 („plătește altfel"),
    dar nici 500 gol: un mesaj clar în log și în răspuns spune exact ce lipsește.
    """
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail
    )


# Cache pentru certificatele root și pentru verificatoare: citirea de pe disc și
# parsarea certificatelor la FIECARE achiziție ar fi o risipă inutilă.
_root_certs_cache: dict[str, tuple[bytes, ...]] = {}
_verifier_cache: dict[tuple, "SignedDataVerifier"] = {}


def _apple_root_certificates() -> tuple[bytes, ...]:
    """Certificatele root Apple (DER), din directorul configurat.

    Se descarcă de la https://www.apple.com/certificateauthority/ (`AppleRootCA-G3.cer`).
    NU le ținem în repo: sunt date de infrastructură, nu cod, iar dacă Apple rotește
    root-ul trebuie schimbat un fișier, nu făcut un release.
    """
    certs_dir = settings.app_store_root_certs_dir
    if not certs_dir:
        raise _misconfigured(
            "APP_STORE_ROOT_CERTS_DIR nu e setat: fără certificatele root Apple "
            "(AppleRootCA-G3.cer) lanțul de semnare nu poate fi verificat."
        )
    if certs_dir in _root_certs_cache:
        return _root_certs_cache[certs_dir]

    if not os.path.isdir(certs_dir):
        raise _misconfigured(
            f"APP_STORE_ROOT_CERTS_DIR='{certs_dir}' nu e un director existent."
        )

    certs: list[bytes] = []
    for path in sorted(glob.glob(os.path.join(certs_dir, "*"))):
        if not os.path.isfile(path):
            continue
        if not path.lower().endswith((".cer", ".der", ".pem", ".crt")):
            continue
        with open(path, "rb") as fh:
            raw = fh.read()
        # Apple livrează DER (.cer). Acceptăm și PEM, convertindu-l: biblioteca
        # cere strict DER, iar un PEM pus din greșeală ar da o eroare obscură.
        if raw.lstrip().startswith(b"-----BEGIN"):
            from cryptography import x509
            from cryptography.hazmat.primitives.serialization import Encoding

            raw = x509.load_pem_x509_certificate(raw).public_bytes(Encoding.DER)
        certs.append(raw)

    if not certs:
        raise _misconfigured(
            f"APP_STORE_ROOT_CERTS_DIR='{certs_dir}' nu conține niciun certificat "
            "(.cer/.der/.pem). Descarcă AppleRootCA-G3.cer de la "
            "https://www.apple.com/certificateauthority/"
        )
    _root_certs_cache[certs_dir] = tuple(certs)
    return _root_certs_cache[certs_dir]


def _allowed_apple_environments() -> list["AppleEnvironment"]:
    """Mediile App Store acceptate, în ordinea încercării.

    Sandbox e acceptat DOAR în afara producției: o tranzacție de sandbox e gratuită
    și o poate genera oricine cu un cont de tester — în producție ar fi premium pe
    gratis. Invers, hardcodarea pe Production (bug-ul vechi) făcea testarea în
    sandbox IMPOSIBILĂ: Apple întorcea 21007 și verificarea pica mereu.
    """
    envs: list[AppleEnvironment] = []
    # Verificatorul de Production cere `app_apple_id` (constrângere a bibliotecii);
    # fără el nu-l putem construi, deci nu-l oferim ca variantă.
    if settings.app_store_app_apple_id is not None:
        envs.append(AppleEnvironment.PRODUCTION)
    if settings.environment != "production":
        envs.append(AppleEnvironment.SANDBOX)
    if not envs:
        raise _misconfigured(
            "App Store: niciun mediu de verificare disponibil. Setează "
            "APP_STORE_APP_APPLE_ID (obligatoriu pentru Production)."
        )
    return envs


def _apple_verifier(env: "AppleEnvironment") -> "SignedDataVerifier":
    """Verificator pentru un mediu, memorat (construcția parsează certificatele)."""
    key = (
        settings.app_store_root_certs_dir,
        settings.app_store_bundle_id,
        settings.app_store_app_apple_id,
        settings.app_store_enable_online_checks,
        env,
    )
    if key not in _verifier_cache:
        _verifier_cache[key] = SignedDataVerifier(
            root_certificates=list(_apple_root_certificates()),
            enable_online_checks=settings.app_store_enable_online_checks,
            environment=env,
            bundle_id=settings.app_store_bundle_id,
            app_apple_id=settings.app_store_app_apple_id,
        )
    return _verifier_cache[key]


def _ms_to_datetime(value: int | None) -> datetime | None:
    """Apple/Google dau timestamp-uri în milisecunde epoch."""
    if value is None:
        return None
    return datetime.fromtimestamp(int(value) / 1000, tz=timezone.utc)


def _plan_for_product(product_id: str) -> str:
    """Planul pe care îl DĂ produsul semnat de magazin (sursa de adevăr).

    Un `productId` necunoscut nu are voie să acorde nimic: ar putea fi un produs
    dintr-un alt build, retras, sau pur și simplu inventat.
    """
    plan = settings.iap_product_to_plan.get(product_id)
    if plan is None or plan not in PLANS:
        raise _payment_required(f"Produs necunoscut: '{product_id}'.")
    return plan


async def _verify_app_store(receipt: str | None, plan: str) -> "VerifiedPurchase":
    """Verifică LOCAL JWS-ul StoreKit 2 și întoarce tranzacția de încredere.

    Nu face niciun apel de rețea (OCSP e opțional): semnătura Apple se verifică
    criptografic, până la root-ul Apple de pe disc.
    """
    if not _APPLE_LIB_AVAILABLE:  # pragma: no cover - depinde de mediu
        raise _misconfigured(
            "Biblioteca `app-store-server-library` lipsește din mediu: "
            "instaleaz-o (pip install app-store-server-library)."
        )
    if not receipt:
        raise _payment_required("Lipsește dovada de achiziție (jwsRepresentationIos).")

    statuses: list[VerificationStatus] = []
    transaction = None
    for env in _allowed_apple_environments():
        try:
            transaction = _apple_verifier(env).verify_and_decode_signed_transaction(
                receipt
            )
            break
        except VerificationException as exc:
            # Mediul greșit nu e o eroare de semnătură: JWS-ul poate fi valid, dar
            # emis în celălalt mediu. Încercăm următorul verificator.
            statuses.append(exc.status)

    if transaction is None:
        if VerificationStatus.INVALID_ENVIRONMENT in statuses:
            raise _payment_required(
                "Tranzacție dintr-un mediu neacceptat (Sandbox nu e permis în "
                "producție)."
            )
        if VerificationStatus.INVALID_APP_IDENTIFIER in statuses:
            # Bundle-ul semnat de Apple e al ALTEI aplicații.
            raise _payment_required(
                "Tranzacția nu aparține acestei aplicații (bundle id diferit)."
            )
        logger.warning("App Store JWS verification failed: %s", [s.name for s in statuses])
        raise _payment_required("Semnătura tranzacției App Store nu poate fi verificată.")

    # Verificare EXPLICITĂ a bundle-ului. Biblioteca o face deja, dar dubla verificare
    # costă o comparație de string-uri și ne apără de o schimbare tăcută în bibliotecă.
    if transaction.bundleId != settings.app_store_bundle_id:
        raise _payment_required(
            "Tranzacția nu aparține acestei aplicații (bundle id diferit)."
        )

    # Abonament rambursat / retras de Apple ⇒ userul NU mai are dreptul la conținut.
    if transaction.revocationDate is not None:
        raise _payment_required("Tranzacție revocată (rambursare).")

    product_id = transaction.productId or ""
    granted_plan = _plan_for_product(product_id)
    # AICI se închide escaladarea de privilegii: clientul cere `all_inclusive` dar
    # a plătit `no_ads` ⇒ refuz. Planul cerut nu are nicio autoritate.
    if granted_plan != plan:
        raise _payment_required(
            f"Produsul cumpărat ('{product_id}') dă planul '{granted_plan}', "
            f"nu '{plan}'."
        )

    expires_at = _ms_to_datetime(transaction.expiresDate)
    if expires_at is None:
        # Toate produsele noastre sunt abonamente lunare: fără `expiresDate` nu știm
        # până când e valabil, iar „presupunem 30 de zile" e exact bug-ul reparat.
        raise _payment_required("Tranzacția nu conține o dată de expirare.")
    if expires_at <= datetime.now(timezone.utc):
        raise _payment_required("Abonamentul a expirat deja.")

    environment = (
        transaction.environment.value
        if transaction.environment is not None
        else "Unknown"
    )
    return VerifiedPurchase(
        provider="app_store",
        transaction_id=str(transaction.transactionId),
        original_transaction_id=str(
            transaction.originalTransactionId or transaction.transactionId
        ),
        product_id=product_id,
        plan=granted_plan,
        environment=environment,
        expires_at=expires_at,
    )


# --- Google Play: purchases.subscriptionsv2.get -------------------------------


async def _google_access_token() -> str:
    """Token OAuth2 pentru Play Developer API, prin service account (JWT bearer).

    Facem schimbul de token manual (PyJWT + httpx) în loc să adăugăm `google-auth`
    și `google-api-python-client`: e un singur JWT semnat RS256 și un POST — nu
    merită încă ~20 MB de dependențe tranzitive pentru atât.
    """
    key_file = settings.google_play_service_account_file
    if not key_file:
        raise _misconfigured(
            "GOOGLE_PLAY_SERVICE_ACCOUNT_FILE nu e setat: fără cheia service "
            "account-ului nu putem interoga Google Play."
        )
    if not os.path.isfile(key_file):
        raise _misconfigured(
            f"GOOGLE_PLAY_SERVICE_ACCOUNT_FILE='{key_file}' nu există pe disc."
        )

    import json

    import jwt as pyjwt

    with open(key_file, "r", encoding="utf-8") as fh:
        creds = json.load(fh)
    if not creds.get("client_email") or not creds.get("private_key"):
        raise _misconfigured(
            "Fișierul service account e invalid (lipsesc `client_email` / `private_key`)."
        )

    now = int(time.time())
    assertion = pyjwt.encode(
        {
            "iss": creds["client_email"],
            "scope": _GOOGLE_PLAY_SCOPE,
            "aud": creds.get("token_uri", _GOOGLE_TOKEN_URL),
            "iat": now,
            "exp": now + 3600,
        },
        creds["private_key"],
        algorithm="RS256",
    )
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.post(
                creds.get("token_uri", _GOOGLE_TOKEN_URL),
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    "assertion": assertion,
                },
            )
            resp.raise_for_status()
            token = resp.json().get("access_token")
    except httpx.HTTPError as exc:
        logger.warning("Google token exchange failed: %s", exc)
        raise _payment_required("Autentificarea la Google Play a eșuat.") from exc

    if not token:
        raise _payment_required("Google Play nu a întors un access token.")
    return token


async def _verify_play(receipt: str | None, plan: str) -> "VerifiedPurchase":
    """Verifică un `purchaseToken` Android prin `purchases.subscriptionsv2.get`."""
    if not receipt:
        raise _payment_required("Lipsește purchase token-ul Google Play.")
    package = settings.google_play_package
    if not package:
        raise _misconfigured("GOOGLE_PLAY_PACKAGE nu e setat.")

    token = await _google_access_token()
    url = (
        f"{_GOOGLE_PLAY_API}/applications/{package}"
        f"/purchases/subscriptionsv2/tokens/{receipt}"
    )
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(
                url, headers={"Authorization": f"Bearer {token}"}
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        logger.warning("Google Play verify failed: %s", exc)
        raise _payment_required("Verificarea achiziției Google Play a eșuat.") from exc

    state = str(data.get("subscriptionState", ""))
    if state not in _PLAY_ACTIVE_STATES:
        raise _payment_required(f"Abonament Google Play inactiv (stare: {state}).")

    # `testPurchase` prezent ⇒ achiziție din licența de test (bani zero).
    environment = "Sandbox" if data.get("testPurchase") is not None else "Production"
    if environment == "Sandbox" and settings.environment == "production":
        raise _payment_required(
            "Achiziție de test Google Play refuzată în producție."
        )

    line_items = data.get("lineItems") or []
    if not line_items:
        raise _payment_required("Achiziția Google Play nu conține niciun produs.")

    # Căutăm produsul care corespunde planului cerut; dacă nu-l găsim, refuzăm.
    # (Un abonament poate conține mai multe line items — ex. upgrade în curs.)
    matched = None
    for item in line_items:
        product_id = str(item.get("productId", ""))
        if settings.iap_product_to_plan.get(product_id) == plan:
            matched = item
            break
    if matched is None:
        bought = [str(i.get("productId", "")) for i in line_items]
        raise _payment_required(
            f"Produsele cumpărate {bought} nu dau planul '{plan}'."
        )

    expiry_raw = matched.get("expiryTime")
    if not expiry_raw:
        raise _payment_required("Achiziția Google Play nu conține o dată de expirare.")
    # Google întoarce RFC3339 („2026-08-01T10:00:00.123Z").
    try:
        expires_at = datetime.fromisoformat(str(expiry_raw).replace("Z", "+00:00"))
    except ValueError as exc:
        raise _payment_required("Dată de expirare invalidă de la Google Play.") from exc
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        raise _payment_required("Abonamentul Google Play a expirat deja.")

    # `latestOrderId` se schimbă la fiecare reînnoire („GPA.1234-..-0", „..-1"),
    # deci e echivalentul lui `transactionId`. Rădăcina (înainte de „..") e
    # echivalentul lui `originalTransactionId`. Dacă lipsește, cădem pe token-ul de
    # achiziție — care e oricum unic per abonament.
    latest_order = str(data.get("latestOrderId") or receipt)
    original_order = latest_order.split("..")[0]

    return VerifiedPurchase(
        provider="play",
        transaction_id=latest_order,
        original_transaction_id=original_order,
        product_id=str(matched.get("productId", "")),
        plan=plan,
        environment=environment,
        expires_at=expires_at,
    )


async def _verify_purchase(
    provider: str, receipt: str | None, plan: str
) -> "VerifiedPurchase | None":
    """Validează achiziția reală (ridică 402 la eșec).

    Întoarce tranzacția verificată la magazinele care o pot dovedi (App Store, Play)
    sau None la Stripe, unde nu avem un id de tranzacție de magazin de dedus.
    """
    if provider == "stripe":
        await _verify_stripe(receipt)
        return None
    if provider == "app_store":
        return await _verify_app_store(receipt, plan)
    if provider == "play":
        return await _verify_play(receipt, plan)
    raise _misconfigured(
        f"BILLING_PROVIDER='{provider}' nu este suportat "
        "(valori valide: stub, stripe, app_store, play)."
    )


async def _claim_transaction(
    db: AsyncSession, user: User, verified: VerifiedPurchase
) -> None:
    """Consumă tranzacția o SINGURĂ dată, global (anti-replay).

    Fără asta, un singur receipt valid — cumpărat o dată, de un singur om — putea fi
    trimis de oricâte conturi și le deschidea premium tuturor. Bariera reală e
    constrângerea UNIQUE din DB: o verificare `SELECT` în Python ar fi pierdut cursa
    între două cereri concurente.

    Idempotent pentru PROPRIETAR: același user care retrimite același receipt (ex.
    „Restore purchases", sau un retry de rețea) nu primește eroare.
    """
    existing = (
        await db.execute(
            select(PurchaseReceipt).where(
                PurchaseReceipt.transaction_id == verified.transaction_id
            )
        )
    ).scalars().first()
    if existing is not None:
        if existing.user_id != user.id:
            logger.warning(
                "Replay de tranzacție: %s aparține altui user", verified.transaction_id
            )
            raise _payment_required(
                "Această tranzacție a fost deja folosită de alt cont."
            )
        return  # același user, aceeași tranzacție → re-activare idempotentă

    # Același ABONAMENT (lanț de reînnoiri) revendicat de alt cont: un cont Apple
    # partajat între useri e tot replay, doar cu alt `transaction_id`.
    other_owner = (
        await db.execute(
            select(PurchaseReceipt).where(
                PurchaseReceipt.original_transaction_id
                == verified.original_transaction_id,
                PurchaseReceipt.user_id != user.id,
            )
        )
    ).scalars().first()
    if other_owner is not None:
        logger.warning(
            "Replay de abonament: original_transaction_id=%s aparține altui user",
            verified.original_transaction_id,
        )
        raise _payment_required(
            "Acest abonament este deja folosit de alt cont."
        )

    db.add(
        PurchaseReceipt(
            user_id=user.id,
            provider=verified.provider,
            transaction_id=verified.transaction_id,
            original_transaction_id=verified.original_transaction_id,
            product_id=verified.product_id,
            plan=verified.plan,
            environment=verified.environment,
            expires_at=verified.expires_at,
        )
    )
    try:
        await db.flush()
    except IntegrityError as exc:
        # Cursa pierdută: alt request a înregistrat tranzacția între SELECT și INSERT.
        # Constrângerea UNIQUE a făcut exact ce trebuia.
        await db.rollback()
        logger.warning("Replay concurent blocat de UNIQUE: %s", verified.transaction_id)
        raise _payment_required(
            "Această tranzacție a fost deja folosită de alt cont."
        ) from exc


async def _activate(
    db: AsyncSession,
    user: User,
    plan: str,
    provider: str,
    expires_at: datetime | None = None,
) -> SubscriptionOut:
    """Creează/actualizează abonamentul activ al userului (upsert).

    `expires_at` vine de la magazin când îl știm. Doar în lipsa lui (stub/Stripe)
    cădem pe „acum + o perioadă".
    """
    if expires_at is None:
        expires_at = datetime.now(timezone.utc) + timedelta(days=_STUB_PERIOD_DAYS)

    # Upsert: reutilizăm rândul existent al userului dacă există, altfel creăm.
    result = await db.execute(
        select(Subscription)
        .where(Subscription.user_id == user.id)
        .order_by(Subscription.created_at.desc())
    )
    sub = result.scalars().first()
    if sub is None:
        sub = Subscription(user_id=user.id)
        db.add(sub)

    sub.plan = plan
    sub.status = "active"
    sub.provider = provider
    sub.expires_at = expires_at
    # Cardurile de reduceri își (re)încarcă intrările la activare; orice alt plan
    # șterge evidența (NULL) — un abonament „premium" nu are intrări de eveniment.
    entries = card_entries_for_plan(plan)
    sub.entries_total = entries
    sub.entries_remaining = entries

    await db.commit()
    await db.refresh(sub)
    return SubscriptionOut(
        plan=sub.plan,
        status=sub.status,
        expires_at=sub.expires_at,
        entries_total=sub.entries_total,
        entries_remaining=sub.entries_remaining,
    )


async def purchase(
    db: AsyncSession, user: User, plan: str, receipt: str | None = None
) -> SubscriptionOut:
    """Cumpără/activează un plan.

    În modul 'stub' (dev) activează imediat, fără plată reală. La providerii live
    validează întâi dovada de plată, apoi CONSUMĂ tranzacția (anti-replay) și abia
    apoi activează abonamentul — cu data de expirare RAPORTATĂ DE MAGAZIN.

    Ordinea contează: dacă am activa înainte de a revendica tranzacția, un replay
    respins ar lăsa în urmă un abonament activ.
    """
    if plan not in PLANS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Plan necunoscut: '{plan}'.",
        )

    provider = settings.billing_provider
    if provider == "stub":
        return await _activate(db, user, plan, provider)

    verified = await _verify_purchase(provider, receipt, plan)
    if verified is None:  # Stripe: fără id de tranzacție de magazin
        return await _activate(db, user, plan, provider)

    await _claim_transaction(db, user, verified)
    return await _activate(
        db, user, verified.plan, provider, expires_at=verified.expires_at
    )


async def entitlements(db: AsyncSession, user: User) -> EntitlementsOut:
    """Drepturile userului, derivate din abonamentul activ."""
    result = await db.execute(
        select(Subscription)
        .where(Subscription.user_id == user.id)
        .order_by(Subscription.created_at.desc())
    )
    sub = result.scalars().first()

    # Fără abonament activ → toate flag-urile false, fără intrări.
    if not _is_active(sub):
        return EntitlementsOut(**_NO_ENTITLEMENTS)

    flags = _PLAN_ENTITLEMENTS.get(sub.plan, _NO_ENTITLEMENTS)
    return EntitlementsOut(
        **flags,
        entries_remaining=sub.entries_remaining,
        entries_total=sub.entries_total,
    )


async def consume_event_entry(db: AsyncSession, user: User) -> None:
    """Consumă o intrare din cardul de reduceri activ la un check-in (defensiv).

    Cardul e un BONUS de reducere, nu o condiție de check-in: dacă userul n-are
    card activ, ori a rămas fără intrări, funcția nu face nimic (check-in-ul merge
    mai departe). Nu decrementează niciodată sub 0. NU face commit — lasă caller-ul
    (fluxul de check-in) să persiste totul într-o singură tranzacție.
    """
    result = await db.execute(
        select(Subscription)
        .where(Subscription.user_id == user.id)
        .order_by(Subscription.created_at.desc())
    )
    sub = result.scalars().first()
    if not _is_active(sub):
        return
    if sub.entries_remaining is None or sub.entries_remaining <= 0:
        return
    sub.entries_remaining -= 1
