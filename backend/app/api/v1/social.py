"""Rute favorite + black list — sub prefixul /api/v1/social (TZ secț. 6)."""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.account import (
    BlockOut,
    FavoriteOut,
    LikePendingOut,
    LikeSentOut,
    TargetIn,
)
from app.schemas.social import LikeReceivedOut
from app.services import account_service, social_service
from app.services.pagination import MAX_CURSOR_LENGTH, SOCIAL_MAX_LIMIT

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]

LimitQuery = Annotated[int | None, Query(ge=1, le=SOCIAL_MAX_LIMIT)]
CursorQuery = Annotated[str | None, Query(max_length=MAX_CURSOR_LENGTH)]


# --- Favorite ----------------------------------------------------------------
@router.get("/favorites", response_model=list[FavoriteOut])
async def list_favorites(
    db: DbDep,
    user: UserDep,
    response: Response,
    limit: LimitQuery = None,
    cursor: CursorQuery = None,
) -> list[FavoriteOut]:
    """Lista de favorite a userului curent (protejat), paginată pe cursor.

    Cursorul paginii următoare vine în header-ul `X-Next-Cursor` (convenția
    `/feed`).
    """
    page = await account_service.list_favorites(db, user, limit=limit, cursor=cursor)
    if page.next_cursor:
        response.headers["X-Next-Cursor"] = page.next_cursor
    return page.items


@router.post("/favorites", status_code=status.HTTP_201_CREATED)
async def add_favorite(
    data: TargetIn, db: DbDep, user: UserDep
) -> Response:
    """Adaugă un user la favorite (protejat)."""
    await account_service.add_favorite(db, user, data.target_user_id)
    return Response(status_code=status.HTTP_201_CREATED)


@router.delete("/favorites/{target_user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_favorite(
    target_user_id: uuid.UUID, db: DbDep, user: UserDep
) -> Response:
    """Scoate un user din favorite (protejat)."""
    await account_service.remove_favorite(db, user, target_user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Like-uri trimise --------------------------------------------------------
@router.get("/likes/sent", response_model=list[LikeSentOut])
async def list_likes_sent(
    db: DbDep,
    user: UserDep,
    response: Response,
    limit: LimitQuery = None,
    cursor: CursorQuery = None,
) -> list[LikeSentOut]:
    """Profilurile cărora userul curent le-a dat LIKE în deck (protejat), paginat.

    `/likes/sent` (nu `/likes`): direcția e explicită în URL, deci un viitor
    „cine mi-a dat mie like" devine `/likes/received`, fără să rescriem ruta asta.

    Cursorul paginii următoare vine în header-ul `X-Next-Cursor` (convenția
    `/feed`), la fel ca `/favorites` și `/blocks`.
    """
    page = await account_service.list_likes_sent(db, user, limit=limit, cursor=cursor)
    if page.next_cursor:
        response.headers["X-Next-Cursor"] = page.next_cursor
    return page.items


@router.get("/likes/pending", response_model=list[LikePendingOut])
async def list_likes_pending(
    db: DbDep,
    user: UserDep,
    response: Response,
    limit: LimitQuery = None,
    cursor: CursorQuery = None,
) -> list[LikePendingOut]:
    """Like-urile MELE „în așteptare": trimise, dar ÎNCĂ fără like reciproc.

    Diferă de `/likes/sent` (care întoarce TOATE like-urile mele): aici excludem
    perechile devenite deja match — când celălalt îmi dă like, conversația trece
    în chaturi, deci profilul DISPARE din așteptare. Fiecare card poartă în plus
    `is_super` (badge super like) și `my_message` (mesajul scris de MINE la like,
    ascuns de destinatar până la match, dar al meu).

    Cursorul paginii următoare vine în header-ul `X-Next-Cursor` (convenția
    `/feed`), la fel ca `/favorites`, `/likes/sent` și `/blocks`.
    """
    page = await account_service.list_likes_pending(
        db, user, limit=limit, cursor=cursor
    )
    if page.next_cursor:
        response.headers["X-Next-Cursor"] = page.next_cursor
    return page.items


# --- Like-uri PRIMITE (cine mi-a dat MIE like) -------------------------------
@router.get("/likes/received", response_model=list[LikeReceivedOut])
async def list_likes_received(
    db: DbDep,
    user: UserDep,
    response: Response,
    limit: LimitQuery = None,
    cursor: CursorQuery = None,
) -> list[LikeReceivedOut]:
    """Like-urile PRIMITE la care ÎNCĂ NU am răspuns — inbox-ul de „cereri".

    Simetricul lui `/likes/sent` (direcția e explicită în URL): aici sunt userii
    care MI-AU DAT MIE like (normal sau super) și la care eu nu am reacționat încă
    (nici like reciproc — ar fi deja match, în chaturi —, nici dislike). Fiecare
    element poartă `is_super`, `message` (mesajul autorului, mascat de contacte),
    `created_at` și `profile` (cardul de anketă), ca userul să deschidă ancheta și
    să răspundă cu `POST /feed/swipe` → match + chat, ambele mesaje livrate.

    Cursorul paginii următoare vine în header-ul `X-Next-Cursor` (convenția
    `/feed`), la fel ca `/likes/sent`, `/likes/pending`, `/favorites` și `/blocks`.
    """
    page = await social_service.list_likes_received(
        db, user, limit=limit, cursor=cursor
    )
    if page.next_cursor:
        response.headers["X-Next-Cursor"] = page.next_cursor
    return page.items


# --- Black list --------------------------------------------------------------
@router.get("/blocks", response_model=list[BlockOut])
async def list_blocks(
    db: DbDep,
    user: UserDep,
    response: Response,
    limit: LimitQuery = None,
    cursor: CursorQuery = None,
) -> list[BlockOut]:
    """Lista de useri blocați (protejat), paginată pe cursor.

    Cursorul paginii următoare vine în header-ul `X-Next-Cursor`.
    """
    page = await account_service.list_blocks(db, user, limit=limit, cursor=cursor)
    if page.next_cursor:
        response.headers["X-Next-Cursor"] = page.next_cursor
    return page.items


@router.post("/blocks", status_code=status.HTTP_201_CREATED)
async def add_block(
    data: TargetIn, db: DbDep, user: UserDep
) -> Response:
    """Blochează un user (protejat)."""
    await account_service.add_block(db, user, data.target_user_id)
    return Response(status_code=status.HTTP_201_CREATED)


@router.delete("/blocks/{target_user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_block(
    target_user_id: uuid.UUID, db: DbDep, user: UserDep
) -> Response:
    """Deblochează un user (protejat)."""
    await account_service.remove_block(db, user, target_user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
