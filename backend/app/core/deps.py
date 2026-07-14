"""Dependențe FastAPI pentru autentificare — extragerea userului curent."""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import decode_token
from app.db.session import get_db
from app.models.user import ROLE_ADMIN, User

# tokenUrl e doar informativ pentru OpenAPI; login-ul real e la /api/v1/auth/login.
oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.api_v1_prefix}/auth/login",
    auto_error=True,
)

_credentials_exc = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)

# Cont banat: 403, nu 401 — token-ul E valid, dar contul nu mai are voie. Un 401
# ar face clientul să încerce la nesfârșit un refresh care nu rezolvă nimic.
_banned_exc = HTTPException(
    status_code=status.HTTP_403_FORBIDDEN,
    detail="Account is banned",
)


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Decodează access token-ul, validează tipul și încarcă userul din DB."""
    try:
        payload = decode_token(token)
    except JWTError:
        raise _credentials_exc

    # Acceptăm strict token-uri de tip "access".
    if payload.get("type") != "access":
        raise _credentials_exc

    sub = payload.get("sub")
    if not sub:
        raise _credentials_exc

    try:
        user_id = uuid.UUID(str(sub))
    except (ValueError, TypeError):
        raise _credentials_exc

    user = await db.get(User, user_id)
    if user is None:
        raise _credentials_exc

    # ȘTERGERE GDPR: un cont purjat (`purge_user_data`) rămâne în tabelă doar
    # anonimizat, deci `db.get` îl găsește. Dar access token-ul stateless emis
    # înainte de purjare e încă valid criptografic (~15 min). Fără verificarea
    # asta, un cont „șters ireversibil" ar continua să facă cereri autentificate
    # și chiar și-ar RE-CREA date (ex. rândul `user_settings`). Îl tratăm ca pe un
    # subiect care nu mai există: 401, ca la un user negăsit.
    if user.is_deleted:
        raise _credentials_exc

    # BAN: token-ul rămâne criptografic valid până la expirare (15 min), deci
    # fără verificarea asta un cont banat ar continua să lovească API-ul cu
    # tokenul emis înainte de ban. Verificăm starea în DB la fiecare cerere.
    if user.is_banned:
        raise _banned_exc
    return user


async def require_admin(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Poartă de acces pentru TOATE rutele `/api/v1/admin/*`.

    Contract:
      * fără token / token invalid / expirat → 401 (din `get_current_user`);
      * token valid dar cont banat            → 403 (din `get_current_user`);
      * token valid de user NORMAL            → 403 aici;
      * doar `role == 'admin'`                → trece.

    Rolul e citit din DB la fiecare cerere, NU dintr-un claim din JWT: dacă
    citeam rolul din token, retragerea drepturilor unui admin ar fi intrat în
    vigoare abia la expirarea tokenului (o fereastră de 15 minute în care un
    admin demis rămâne admin). Așa, revocarea e instantanee.
    """
    if current_user.role != ROLE_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator privileges required",
        )
    return current_user


# Alias pentru injectare rapidă în rute.
CurrentUser = Annotated[User, Depends(get_current_user)]
# Alias pentru rutele de admin — folosește-l în TOATE rutele din api/v1/admin.
CurrentAdmin = Annotated[User, Depends(require_admin)]
