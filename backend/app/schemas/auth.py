"""Scheme Pydantic v2 pentru fluxul de autentificare."""
from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

# Domenii REZERVATE pentru emailurile sintetice generate de server:
#   * `ext.flirt`       — identități externe (`telegram_{id}@`, `google_{sub}@`,
#                         `apple_{sub}@`, `phone_{msisdn}@`), vezi `auth_service`;
#   * `deleted.invalid` — conturi anonimizate la ștergerea GDPR (`account_service`).
# Un client nu are voie să înregistreze / să se logheze cu parolă pe ele: altfel
# atacatorul își face din timp contul `telegram_<idVictimei>@ext.flirt` cu parolă,
# iar când victima intră din Mini App, identitatea ei se leagă de contul lui.
# Refuzăm tot TLD-ul `.flirt` și `.invalid` (nu există emailuri reale acolo).
_RESERVED_EMAIL_SUFFIXES = (".flirt", ".invalid")


def is_reserved_email(email: str) -> bool:
    """True dacă emailul aparține unui domeniu sintetic rezervat serverului."""
    domain = email.strip().lower().rpartition("@")[2].rstrip(".")
    return any(
        domain == suffix[1:] or domain.endswith(suffix)
        for suffix in _RESERVED_EMAIL_SUFFIXES
    )


def _reject_reserved(email: str) -> str:
    if is_reserved_email(email):
        # Mesaj generic: nu explicăm de ce domeniul e special.
        raise ValueError("value is not a valid email address")
    return email


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)

    _no_reserved = field_validator("email")(_reject_reserved)


class LoginIn(BaseModel):
    email: EmailStr
    password: str

    _no_reserved = field_validator("email")(_reject_reserved)


class RefreshIn(BaseModel):
    refresh_token: str


class LogoutIn(BaseModel):
    refresh_token: str


class SocialLoginIn(BaseModel):
    """Payload pentru Apple/Google Sign-In: `id_token` emis de provider."""

    id_token: str = Field(min_length=1)


class TelegramAuthIn(BaseModel):
    """Payload pentru Telegram Mini App: șirul `initData` semnat de Telegram.

    `max_length` nu e cosmetic: `initData` real are câteva sute de octeți, dar
    verificarea construiește `data_check_string` din TOATE câmpurile primite,
    deci un șir arbitrar de lung ar fi muncă gratuită de sortat și de hash-uit,
    pe un endpoint neautentificat. 4096 lasă loc berechet (`photo_url` lung,
    `start_param`) și taie abuzul.
    """

    init_data: str = Field(min_length=1, max_length=4096)


class PhoneRequestIn(BaseModel):
    """Cerere de trimitere OTP către un număr de telefon."""

    phone: str = Field(min_length=3)


class PhoneVerifyIn(BaseModel):
    """Verificare OTP: numărul de telefon + codul primit."""

    phone: str = Field(min_length=3)
    code: str = Field(min_length=1)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    profile_completed: bool
    # Aditiv (Legea nr. 195/2024): true = userul trebuie să accepte versiunea
    # curentă a Termenilor / Politicii de confidențialitate (vezi /legal/consent-status).
    consent_required: bool = False
