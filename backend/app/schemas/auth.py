"""Scheme Pydantic v2 pentru fluxul de autentificare."""
from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


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
