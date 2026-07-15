"""Teste de SECURITATE pentru validarea achizițiilor App Store (StoreKit 2).

Fiecare test de aici demonstrează o breșă REALĂ, exploatabilă, din implementarea
veche (`verifyReceipt` + „acceptă orice dacă status == 0"):

- `test_jws_fabricat_de_atacator_este_respins`   → JWS nesemnat de Apple (lanț fals)
- `test_receipt_din_ALTA_aplicatie_este_respins` → bundleId neverificat
- `test_produs_ieftin_nu_poate_cere_plan_scump`  → productId neverificat (escaladare)
- `test_replay_acelasi_receipt_alt_user_respins` → fără dedup pe transaction_id
- `test_replay_acelasi_abonament_alt_user_respins`
- `test_expires_at_vine_de_la_apple_nu_30_de_zile` → expirare inventată
- `test_sandbox_acceptat_in_dev` / `..._respins_in_productie` → URL hardcodat pe prod

NU mock-uim verificarea criptografică: construim un lanț REAL de certificate (root →
intermediar → leaf, cu OID-urile Apple), semnăm un JWS ES256 real și lăsăm biblioteca
oficială să verifice lanțul până la root-ul nostru de test. Un test care ar mock-ui
`verify_and_decode_signed_transaction` nu ar demonstra absolut nimic — exact semnătura
e ce trebuie să apere.
"""
import base64
import datetime as dt
import uuid

import jwt as pyjwt
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID
from fastapi import HTTPException
from sqlalchemy import select

from app.models.billing import PurchaseReceipt
from app.services import billing

API = "/api/v1"

# OID-urile pe care biblioteca Apple le cere obligatoriu în lanț (marker de
# certificat de semnare App Store).
_LEAF_OID = x509.ObjectIdentifier("1.2.840.113635.100.6.11.1")
_INTERMEDIATE_OID = x509.ObjectIdentifier("1.2.840.113635.100.6.2.1")

BUNDLE_ID = "eu.flirt.app"
PRODUCT_PREMIUM = "eu.flirt.app.premium.monthly"
PRODUCT_NO_ADS = "eu.flirt.app.noads.monthly"


# --- Infrastructură de test: un „Apple" fals, dar criptografic real ------------


def _name(cn: str) -> x509.Name:
    return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])


def _ca_key_usage() -> x509.KeyUsage:
    return x509.KeyUsage(
        digital_signature=False,
        content_commitment=False,
        key_encipherment=False,
        data_encipherment=False,
        key_agreement=False,
        key_cert_sign=True,
        crl_sign=True,
        encipher_only=False,
        decipher_only=False,
    )


def _leaf_key_usage() -> x509.KeyUsage:
    return x509.KeyUsage(
        digital_signature=True,
        content_commitment=False,
        key_encipherment=False,
        data_encipherment=False,
        key_agreement=False,
        key_cert_sign=False,
        crl_sign=False,
        encipher_only=False,
        decipher_only=False,
    )


class FakeAppleCA:
    """Un lanț root → intermediar → leaf, ca cel cu care Apple semnează tranzacțiile."""

    def __init__(self) -> None:
        now = dt.datetime.now(dt.timezone.utc)
        self.root_key = ec.generate_private_key(ec.SECP256R1())
        self.root_cert = (
            x509.CertificateBuilder()
            .subject_name(_name("Test Apple Root CA G3"))
            .issuer_name(_name("Test Apple Root CA G3"))
            .public_key(self.root_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - dt.timedelta(days=1))
            .not_valid_after(now + dt.timedelta(days=365))
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .add_extension(_ca_key_usage(), critical=True)
            .add_extension(
                x509.SubjectKeyIdentifier.from_public_key(self.root_key.public_key()),
                critical=False,
            )
            .sign(self.root_key, hashes.SHA256())
        )

        int_key = ec.generate_private_key(ec.SECP256R1())
        int_cert = (
            x509.CertificateBuilder()
            .subject_name(_name("Test Apple WWDR CA"))
            .issuer_name(self.root_cert.subject)
            .public_key(int_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - dt.timedelta(days=1))
            .not_valid_after(now + dt.timedelta(days=200))
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
            .add_extension(_ca_key_usage(), critical=True)
            .add_extension(
                x509.SubjectKeyIdentifier.from_public_key(int_key.public_key()),
                critical=False,
            )
            .add_extension(
                x509.AuthorityKeyIdentifier.from_issuer_public_key(
                    self.root_key.public_key()
                ),
                critical=False,
            )
            .add_extension(
                x509.UnrecognizedExtension(_INTERMEDIATE_OID, b"\x05\x00"), critical=False
            )
            .sign(self.root_key, hashes.SHA256())
        )

        self.leaf_key = ec.generate_private_key(ec.SECP256R1())
        leaf_cert = (
            x509.CertificateBuilder()
            .subject_name(_name("Test Apple Signing Leaf"))
            .issuer_name(int_cert.subject)
            .public_key(self.leaf_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - dt.timedelta(days=1))
            .not_valid_after(now + dt.timedelta(days=100))
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(_leaf_key_usage(), critical=True)
            .add_extension(
                x509.SubjectKeyIdentifier.from_public_key(self.leaf_key.public_key()),
                critical=False,
            )
            .add_extension(
                x509.AuthorityKeyIdentifier.from_issuer_public_key(int_key.public_key()),
                critical=False,
            )
            .add_extension(
                x509.UnrecognizedExtension(_LEAF_OID, b"\x05\x00"), critical=False
            )
            .sign(int_key, hashes.SHA256())
        )

        self.x5c = [
            base64.b64encode(c.public_bytes(serialization.Encoding.DER)).decode()
            for c in (leaf_cert, int_cert, self.root_cert)
        ]
        self.leaf_pem = self.leaf_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )

    def root_der(self) -> bytes:
        return self.root_cert.public_bytes(serialization.Encoding.DER)

    def sign_transaction(
        self,
        *,
        product_id: str = PRODUCT_PREMIUM,
        bundle_id: str = BUNDLE_ID,
        environment: str = "Sandbox",
        transaction_id: str = "2000000000000001",
        original_transaction_id: str | None = None,
        expires_in_days: int = 30,
        revoked: bool = False,
    ) -> str:
        """Semnează o tranzacție ca Apple: JWS ES256 cu lanțul x5c în header."""
        now = dt.datetime.now(dt.timezone.utc)
        now_ms = int(now.timestamp() * 1000)
        payload = {
            "transactionId": transaction_id,
            "originalTransactionId": original_transaction_id or transaction_id,
            "bundleId": bundle_id,
            "productId": product_id,
            "purchaseDate": now_ms,
            "originalPurchaseDate": now_ms,
            "expiresDate": now_ms + int(expires_in_days * 24 * 3600 * 1000),
            "quantity": 1,
            "type": "Auto-Renewable Subscription",
            "inAppOwnershipType": "PURCHASED",
            "signedDate": now_ms,
            "environment": environment,
        }
        if revoked:
            payload["revocationDate"] = now_ms - 3600 * 1000
            payload["revocationReason"] = 0
        return pyjwt.encode(
            payload, self.leaf_pem, algorithm="ES256", headers={"x5c": self.x5c}
        )


@pytest.fixture
def apple(tmp_path, monkeypatch):
    """Comută billing-ul pe App Store, cu root-ul nostru de test pe disc."""
    ca = FakeAppleCA()
    certs_dir = tmp_path / "apple-roots"
    certs_dir.mkdir()
    (certs_dir / "AppleRootCA-G3.cer").write_bytes(ca.root_der())

    # Cache-urile sunt globale (per proces) — le golim ca testele să nu se contamineze.
    billing._root_certs_cache.clear()
    billing._verifier_cache.clear()

    monkeypatch.setattr(billing.settings, "billing_provider", "app_store")
    monkeypatch.setattr(billing.settings, "app_store_bundle_id", BUNDLE_ID)
    monkeypatch.setattr(billing.settings, "app_store_root_certs_dir", str(certs_dir))
    monkeypatch.setattr(billing.settings, "app_store_app_apple_id", None)
    monkeypatch.setattr(billing.settings, "app_store_enable_online_checks", False)
    monkeypatch.setattr(billing.settings, "environment", "development")
    yield ca
    billing._root_certs_cache.clear()
    billing._verifier_cache.clear()


def _extract_token(payload: dict) -> str | None:
    for key in ("access_token", "accessToken", "token"):
        if isinstance(payload.get(key), str):
            return payload[key]
    return None


async def _new_user(client, db_session, email: str):
    from app.models.user import User

    resp = await client.post(
        f"{API}/auth/register", json={"email": email, "password": "Str0ng-Passw0rd!"}
    )
    assert resp.status_code in (200, 201), resp.text
    headers = {"Authorization": f"Bearer {_extract_token(resp.json())}"}
    me = await client.get(f"{API}/auth/me", headers=headers)
    return await db_session.get(User, uuid.UUID(me.json()["id"]))


# --- Cazul fericit -------------------------------------------------------------


@pytest.mark.asyncio
async def test_jws_valid_activeaza_si_inregistreaza_tranzactia(
    apple, client, db_session
):
    """Un JWS semnat corect activează planul și lasă urma tranzacției în DB."""
    user = await _new_user(client, db_session, "ok@example.com")
    jws = apple.sign_transaction(product_id=PRODUCT_PREMIUM)

    sub = await billing.purchase(db_session, user, "premium", receipt=jws)
    assert sub.plan == "premium"
    assert sub.status == "active"

    row = (
        await db_session.execute(
            select(PurchaseReceipt).where(PurchaseReceipt.user_id == user.id)
        )
    ).scalars().first()
    assert row is not None
    assert row.transaction_id == "2000000000000001"
    assert row.product_id == PRODUCT_PREMIUM
    assert row.plan == "premium"
    assert row.environment == "Sandbox"


# --- BREȘA: JWS neverificat (oricine poate fabrica unul) -----------------------


@pytest.mark.asyncio
async def test_jws_fabricat_de_atacator_este_respins(apple, client, db_session):
    """Un JWS semnat cu un lanț PROPRIU (nu al Apple) → 402.

    Ăsta e testul care ține tot restul în picioare: dacă lanțul x5c nu e verificat
    până la root-ul Apple, un atacator își generează singur certificatele, semnează
    orice payload vrea (`all_inclusive`, expirare în 2099) și primește premium pe
    gratis. Payload-ul e IDENTIC cu unul legitim — doar semnătura e a altcuiva.
    """
    user = await _new_user(client, db_session, "forger@example.com")
    atacator = FakeAppleCA()  # alt root, necunoscut serverului
    jws = atacator.sign_transaction(product_id=PRODUCT_PREMIUM)

    with pytest.raises(HTTPException) as exc:
        await billing.purchase(db_session, user, "premium", receipt=jws)
    assert exc.value.status_code == 402

    assert await billing.get_subscription(db_session, user) is None


@pytest.mark.asyncio
async def test_jws_cu_semnatura_stricata_este_respins(apple, client, db_session):
    """Payload modificat după semnare (semnătura nu mai se potrivește) → 402."""
    user = await _new_user(client, db_session, "tamper@example.com")
    jws = apple.sign_transaction(product_id=PRODUCT_NO_ADS)

    header, payload, signature = jws.split(".")
    # Rescriem payload-ul: no_ads → all_inclusive, păstrând semnătura veche.
    import json

    decoded = json.loads(base64.urlsafe_b64decode(payload + "=="))
    decoded["productId"] = "eu.flirt.app.allinclusive.monthly"
    forged_payload = (
        base64.urlsafe_b64encode(json.dumps(decoded).encode()).decode().rstrip("=")
    )
    tampered = f"{header}.{forged_payload}.{signature}"

    with pytest.raises(HTTPException) as exc:
        await billing.purchase(db_session, user, "all_inclusive", receipt=tampered)
    assert exc.value.status_code == 402


# --- BREȘA 2: bundle_id neverificat -------------------------------------------


@pytest.mark.asyncio
async def test_receipt_din_ALTA_aplicatie_este_respins(apple, client, db_session):
    """Tranzacție semnată de Apple, dar pentru ALTĂ aplicație → 402.

    Vechea verificare accepta orice receipt cu `status == 0`: un abonament de 0,99 €
    cumpărat în oricare altă aplicație din App Store deschidea premium la noi.
    Semnătura e perfect validă — doar că nu e a aplicației noastre.
    """
    user = await _new_user(client, db_session, "otherapp@example.com")
    jws = apple.sign_transaction(bundle_id="com.altcineva.jocul", product_id=PRODUCT_PREMIUM)

    with pytest.raises(HTTPException) as exc:
        await billing.purchase(db_session, user, "premium", receipt=jws)
    assert exc.value.status_code == 402
    assert "bundle" in exc.value.detail.lower()

    assert await billing.get_subscription(db_session, user) is None


# --- BREȘA 3: product_id neverificat (escaladare de privilegii contra bani) ----


@pytest.mark.asyncio
async def test_produs_ieftin_nu_poate_cere_plan_scump(apple, client, db_session):
    """Cumpără `no_ads` (3,99 €), cere `all_inclusive` (14,99 €) → 402.

    Vechea implementare lua planul din CE CEREA CLIENTUL și ignora complet ce produs
    a semnat Apple. Diferența de preț era plătită de noi.
    """
    user = await _new_user(client, db_session, "escalate@example.com")
    jws = apple.sign_transaction(product_id=PRODUCT_NO_ADS)

    with pytest.raises(HTTPException) as exc:
        await billing.purchase(db_session, user, "all_inclusive", receipt=jws)
    assert exc.value.status_code == 402
    assert "no_ads" in exc.value.detail

    assert await billing.get_subscription(db_session, user) is None
    # Nici drepturile nu s-au aprins.
    ent = await billing.entitlements(db_session, user)
    assert ent.ai_bot is False and ent.premium is False


@pytest.mark.asyncio
async def test_produs_necunoscut_este_respins(apple, client, db_session):
    """Un `productId` care nu e în catalogul nostru → 402 (nu acordă nimic)."""
    user = await _new_user(client, db_session, "unknown-product@example.com")
    jws = apple.sign_transaction(product_id="eu.flirt.app.inventat.gratis")

    with pytest.raises(HTTPException) as exc:
        await billing.purchase(db_session, user, "premium", receipt=jws)
    assert exc.value.status_code == 402
    assert "necunoscut" in exc.value.detail.lower()


# --- BREȘA 4: replay (fără dedup pe transaction_id) ---------------------------


@pytest.mark.asyncio
async def test_replay_acelasi_receipt_alt_user_respins(apple, client, db_session):
    """UN receipt cumpărat o dată nu poate deschide premium la DOI useri → 402.

    Fără dedup, un singur abonament plătit putea fi partajat (sau revândut) la oricâte
    conturi: semnătura Apple rămâne validă la infinit, ea dovedește doar că tranzacția
    e REALĂ, nu că e A TA și nefolosită.
    """
    victima = await _new_user(client, db_session, "buyer@example.com")
    profitorul = await _new_user(client, db_session, "freeloader@example.com")
    jws = apple.sign_transaction(product_id=PRODUCT_PREMIUM)

    # Cumpărătorul legitim: OK.
    sub = await billing.purchase(db_session, victima, "premium", receipt=jws)
    assert sub.status == "active"

    # Al doilea cont, ACELAȘI receipt: refuzat.
    with pytest.raises(HTTPException) as exc:
        await billing.purchase(db_session, profitorul, "premium", receipt=jws)
    assert exc.value.status_code == 402
    assert "alt cont" in exc.value.detail.lower()

    assert await billing.get_subscription(db_session, profitorul) is None


@pytest.mark.asyncio
async def test_replay_acelasi_abonament_alt_user_respins(apple, client, db_session):
    """Altă tranzacție (reînnoire), dar ACELAȘI abonament Apple, la alt cont → 402.

    Un cont Apple partajat între mai mulți useri produce `transactionId` diferiți, dar
    același `originalTransactionId`. Dedup-ul doar pe `transactionId` ar fi lăsat gaura
    deschisă.
    """
    proprietar = await _new_user(client, db_session, "owner@example.com")
    strain = await _new_user(client, db_session, "stranger@example.com")

    jws1 = apple.sign_transaction(
        transaction_id="3000000000000001", original_transaction_id="3000000000000001"
    )
    await billing.purchase(db_session, proprietar, "premium", receipt=jws1)

    # Reînnoire: alt transaction_id, același original.
    jws2 = apple.sign_transaction(
        transaction_id="3000000000000002", original_transaction_id="3000000000000001"
    )
    with pytest.raises(HTTPException) as exc:
        await billing.purchase(db_session, strain, "premium", receipt=jws2)
    assert exc.value.status_code == 402
    assert "alt cont" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_acelasi_user_poate_restaura_aceeasi_tranzactie(
    apple, client, db_session
):
    """„Restore purchases" al PROPRIETARULUI nu trebuie să dea eroare (idempotent)."""
    user = await _new_user(client, db_session, "restore@example.com")
    jws = apple.sign_transaction(product_id=PRODUCT_PREMIUM)

    first = await billing.purchase(db_session, user, "premium", receipt=jws)
    second = await billing.purchase(db_session, user, "premium", receipt=jws)
    assert first.plan == second.plan == "premium"
    assert second.status == "active"

    # O singură înregistrare, nu două.
    rows = (
        await db_session.execute(
            select(PurchaseReceipt).where(PurchaseReceipt.user_id == user.id)
        )
    ).scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_unicitatea_tranzactiei_e_o_constrangere_de_DB(apple, client, db_session):
    """`transaction_id` e UNIQUE în Postgres, nu doar verificat în Python.

    O verificare `SELECT`-then-`INSERT` în cod pierde cursa între două cereri
    concurente (niciuna nu vede rândul celeilalte până la COMMIT). Doar constrângerea
    din DB arbitrează corect. Testul o dovedește la nivel de motor.
    """
    from sqlalchemy.exc import IntegrityError

    u1 = await _new_user(client, db_session, "db1@example.com")
    u2 = await _new_user(client, db_session, "db2@example.com")

    common = {
        "provider": "app_store",
        "transaction_id": "9000000000000001",
        "original_transaction_id": "9000000000000001",
        "product_id": PRODUCT_PREMIUM,
        "plan": "premium",
        "environment": "Sandbox",
    }
    db_session.add(PurchaseReceipt(user_id=u1.id, **common))
    await db_session.commit()

    db_session.add(PurchaseReceipt(user_id=u2.id, **common))
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


# --- BREȘA 5: expires_at inventat („acum + 30 de zile") -----------------------


@pytest.mark.asyncio
async def test_expires_at_vine_de_la_apple_nu_30_de_zile(apple, client, db_session):
    """Expirarea abonamentului = cea semnată de Apple, nu una inventată de noi.

    Vechiul cod scria mereu `acum + 30 de zile`, indiferent ce spunea Apple: un
    abonament anulat sau cu perioadă promoțională de 7 zile rămânea activ o lună.
    """
    user = await _new_user(client, db_session, "expiry@example.com")
    jws = apple.sign_transaction(product_id=PRODUCT_PREMIUM, expires_in_days=7)

    sub = await billing.purchase(db_session, user, "premium", receipt=jws)

    now = dt.datetime.now(dt.timezone.utc)
    delta = sub.expires_at - now
    # ~7 zile (nu 30). Marjă largă ca testul să nu fie fragil.
    assert dt.timedelta(days=6) < delta < dt.timedelta(days=8), delta


@pytest.mark.asyncio
async def test_tranzactie_expirata_este_respinsa(apple, client, db_session):
    """Un abonament deja expirat nu (re)activează nimic → 402."""
    user = await _new_user(client, db_session, "expired@example.com")
    jws = apple.sign_transaction(product_id=PRODUCT_PREMIUM, expires_in_days=-1)

    with pytest.raises(HTTPException) as exc:
        await billing.purchase(db_session, user, "premium", receipt=jws)
    assert exc.value.status_code == 402
    assert "expirat" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_tranzactie_revocata_este_respinsa(apple, client, db_session):
    """Abonament rambursat de Apple (`revocationDate`) → 402.

    Fără verificarea revocării, un user putea cumpăra, cere refund de la Apple și
    păstra premium: banii înapoi la el, conținutul tot la el.
    """
    user = await _new_user(client, db_session, "refund@example.com")
    jws = apple.sign_transaction(product_id=PRODUCT_PREMIUM, revoked=True)

    with pytest.raises(HTTPException) as exc:
        await billing.purchase(db_session, user, "premium", receipt=jws)
    assert exc.value.status_code == 402
    assert "revocat" in exc.value.detail.lower()


# --- BREȘA 1: mediu (URL hardcodat pe producție) ------------------------------


@pytest.mark.asyncio
async def test_sandbox_acceptat_in_dev(apple, client, db_session):
    """În dev/staging, o tranzacție de Sandbox TREBUIE acceptată.

    Vechea implementare lovea hardcodat `buy.itunes.apple.com`: orice receipt de
    sandbox primea status 21007 și pica ⇒ testarea achizițiilor era IMPOSIBILĂ.
    """
    user = await _new_user(client, db_session, "sandbox-dev@example.com")
    jws = apple.sign_transaction(environment="Sandbox")

    sub = await billing.purchase(db_session, user, "premium", receipt=jws)
    assert sub.status == "active"


@pytest.mark.asyncio
async def test_sandbox_respins_in_productie(apple, client, db_session, monkeypatch):
    """În producție, o tranzacție de Sandbox e refuzată → 402.

    Reversul medaliei: tranzacțiile de sandbox sunt gratuite și le poate genera orice
    tester. Acceptate în producție = premium pe gratis pentru oricine.
    """
    monkeypatch.setattr(billing.settings, "environment", "production")
    monkeypatch.setattr(billing.settings, "app_store_app_apple_id", 1234567890)
    billing._verifier_cache.clear()

    user = await _new_user(client, db_session, "sandbox-prod@example.com")
    jws = apple.sign_transaction(environment="Sandbox")

    with pytest.raises(HTTPException) as exc:
        await billing.purchase(db_session, user, "premium", receipt=jws)
    assert exc.value.status_code == 402
    assert "sandbox" in exc.value.detail.lower()

    assert await billing.get_subscription(db_session, user) is None


@pytest.mark.asyncio
async def test_productie_accepta_tranzactie_de_productie(
    apple, client, db_session, monkeypatch
):
    """În producție, o tranzacție de Production trece (nu am rupt cazul normal)."""
    monkeypatch.setattr(billing.settings, "environment", "production")
    monkeypatch.setattr(billing.settings, "app_store_app_apple_id", 1234567890)
    billing._verifier_cache.clear()

    user = await _new_user(client, db_session, "prod-ok@example.com")
    jws = apple.sign_transaction(environment="Production")

    sub = await billing.purchase(db_session, user, "premium", receipt=jws)
    assert sub.status == "active"

    row = (
        await db_session.execute(
            select(PurchaseReceipt).where(PurchaseReceipt.user_id == user.id)
        )
    ).scalars().first()
    assert row.environment == "Production"


# --- Configurare lipsă: mesaj clar, nu 500 ------------------------------------


@pytest.mark.asyncio
async def test_fara_certificate_root_raspunde_503_nu_500(
    apple, client, db_session, monkeypatch
):
    """Fără APP_STORE_ROOT_CERTS_DIR → 503 cu mesaj clar (nu crash)."""
    monkeypatch.setattr(billing.settings, "app_store_root_certs_dir", "")
    billing._root_certs_cache.clear()
    billing._verifier_cache.clear()

    user = await _new_user(client, db_session, "nocerts@example.com")
    jws = apple.sign_transaction()

    with pytest.raises(HTTPException) as exc:
        await billing.purchase(db_session, user, "premium", receipt=jws)
    assert exc.value.status_code == 503
    assert "APP_STORE_ROOT_CERTS_DIR" in exc.value.detail


@pytest.mark.asyncio
async def test_fara_receipt_raspunde_402(apple, client, db_session):
    """Cerere fără dovadă de achiziție → 402."""
    user = await _new_user(client, db_session, "noreceipt@example.com")
    with pytest.raises(HTTPException) as exc:
        await billing.purchase(db_session, user, "premium")
    assert exc.value.status_code == 402


# --- Ruta HTTP: clientul mobil trimite `jwsRepresentationIos` ------------------


@pytest.mark.asyncio
async def test_ruta_accepta_campul_jwsRepresentationIos(apple, client, db_session):
    """`expo-iap` trimite `jwsRepresentationIos`, nu `receipt` — schema îl acceptă."""
    user = await _new_user(client, db_session, "route@example.com")
    # Autentificăm ca acel user prin ruta reală.
    resp = await client.post(
        f"{API}/auth/login",
        json={"email": "route@example.com", "password": "Str0ng-Passw0rd!"},
    )
    headers = {"Authorization": f"Bearer {_extract_token(resp.json())}"}

    jws = apple.sign_transaction(product_id=PRODUCT_PREMIUM)
    r = await client.post(
        f"{API}/subscriptions/purchase",
        json={"plan": "premium", "jwsRepresentationIos": jws},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["plan"] == "premium"
    assert r.json()["status"] == "active"

    # Iar escaladarea de plan e refuzată și prin rută (nu doar în serviciu): 402.
    jws_cheap = apple.sign_transaction(
        product_id=PRODUCT_NO_ADS, transaction_id="4000000000000009"
    )
    r2 = await client.post(
        f"{API}/subscriptions/purchase",
        json={"plan": "all_inclusive", "jwsRepresentationIos": jws_cheap},
        headers=headers,
    )
    assert r2.status_code == 402, r2.text
