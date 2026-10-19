"""humor: setari globale + glumele testului de umor, editabile din panou

Creeaza:
  * `humor_settings`  — rand SINGLETON (id=1): comutatorul global + textul
                        ecranului de introducere (ro/ru/en). Inserat cu testul
                        OPRIT (`enabled=false`), la cererea proprietarului.
  * `humor_questions` — glumele testului, seed-uite cu cele 7 glume istorice
                        (cheile „c1".."c7" pastrate, ca un client aflat in
                        mijlocul testului sa poata trimite raspunsurile).

Aditiva: nu atinge `profiles.humor_vector`; vectorii deja salvati raman valizi
(sunt pe cele 7 TIPURI de umor, nu pe glume). Downgrade = tabelele dispar, iar
codul vechi (glume hard-codate) nu depinde de ele.

Revision ID: b6e1d4a7c3f2
Revises: d3f8a1c5e2b9
Create Date: 2026-10-19 12:00:00.000000
"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b6e1d4a7c3f2"
down_revision: Union[str, None] = "d3f8a1c5e2b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Copie INGHETATA a datelor de seed (o migratie nu importa din `app`: codul
# aplicatiei se schimba, migratia trebuie sa ramana reproductibila).
_QUESTIONS = [
    ("c1", "sarcasm",
     "Super, încă o luni. Exact ce ceream de la viață.",
     "Прекрасно, ещё один понедельник. Именно то, о чём я мечтал.",
     "Oh good, another Monday. Exactly what I put on my wish list."),
    ("c2", "dark",
     "Eu și plantele mele avem multe în comun: murim încet, pe dinăuntru.",
     "У меня с растениями много общего: мы одинаково медленно вянем внутри.",
     "My plants and I have a lot in common: we're both slowly dying inside."),
    ("c3", "memes",
     "Eu, făcând pe ocupatul, în timp ce rotița de încărcare muncește pentru amândoi.",
     "Я, изображающий бурную деятельность, пока полоска загрузки работает за меня.",
     "Me looking busy while the loading spinner does all the actual work."),
    ("c4", "intellectual",
     "Am spus o glumă despre chimie. Zero reacție.",
     "Рассказал шутку про химию — реакции ноль.",
     "I told a chemistry joke, but there was no reaction."),
    ("c5", "absurd",
     "Un cal intră într-un bar și comandă un pahar cu apă. Atât.",
     "Заходит конь в бар и заказывает стакан воды. Всё.",
     "A horse walks into a bar and orders a glass of water. That's it."),
    ("c6", "wholesome",
     "Un cățel s-a apucat să-și prindă coada și a adormit din prima tură.",
     "Щенок гнался за своим хвостом, устал и уснул прямо на первом круге.",
     "A puppy chased its own tail and fell asleep on the very first lap."),
    ("c7", "physical",
     "A alunecat pe o coajă de banană — ca în desene, cu brațele ca o morișcă.",
     "Поскользнулся на банановой кожуре — как в мультике, руками мельницу изобразил.",
     "He slipped on a banana peel — cartoon-style, arms flailing and all."),
]

_INTRO_RO = (
    "De ce acest test? Îți arătăm câteva glume scurte și ne spui dacă te-au "
    "amuzat. Așa aflăm ce fel de umor ai și îți arătăm mai des oameni cu un "
    "simț al umorului compatibil, iar scorul de chimie devine mai precis.\n\n"
    "Durează 1–2 minute și nu există răspunsuri greșite. Răspunsurile nu apar "
    "în profilul tău și nu le vede nimeni: le folosim doar ca să calculăm "
    "potrivirea."
)
_INTRO_RU = (
    "Зачем этот тест? Мы покажем несколько коротких шуток, а ты отметишь, "
    "смешно ли тебе. Так мы поймём твоё чувство юмора, чаще будем показывать "
    "людей с похожим юмором, а оценка «химии» станет точнее.\n\n"
    "Это займёт 1–2 минуты, неправильных ответов нет. Ответы не видны в твоём "
    "профиле и никому не показываются: мы используем их только для подбора."
)
_INTRO_EN = (
    "Why this test? We'll show you a few short jokes and you tell us whether "
    "they made you laugh. That's how we learn your sense of humor, show you "
    "more people whose humor clicks with yours, and make the chemistry score "
    "more accurate.\n\n"
    "It takes 1–2 minutes and there are no wrong answers. Your answers don't "
    "appear on your profile and nobody sees them: we only use them for matching."
)


def upgrade() -> None:
    settings_table = op.create_table(
        "humor_settings",
        sa.Column("id", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("intro_ro", sa.Text(), server_default="", nullable=False),
        sa.Column("intro_ru", sa.Text(), server_default="", nullable=False),
        sa.Column("intro_en", sa.Text(), server_default="", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    questions_table = op.create_table(
        "humor_questions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("humor_type", sa.String(length=32), nullable=False),
        sa.Column("text_ro", sa.String(length=500), nullable=False),
        sa.Column("text_ru", sa.String(length=500), nullable=False),
        sa.Column("text_en", sa.String(length=500), nullable=False),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key"),
    )
    op.create_index(
        "ix_humor_questions_position", "humor_questions", ["position"], unique=False
    )

    # Testul pleaca OPRIT: proprietarul vrea sa-l porneasca din panou cand
    # glumele sunt pe placul lui.
    op.bulk_insert(
        settings_table,
        [
            {
                "id": 1,
                "enabled": False,
                "intro_ro": _INTRO_RO,
                "intro_ru": _INTRO_RU,
                "intro_en": _INTRO_EN,
            }
        ],
    )
    op.bulk_insert(
        questions_table,
        [
            {
                "id": uuid.uuid4(),
                "key": key,
                "humor_type": humor_type,
                "text_ro": text_ro,
                "text_ru": text_ru,
                "text_en": text_en,
                "position": position,
                "active": True,
            }
            for position, (key, humor_type, text_ro, text_ru, text_en) in enumerate(
                _QUESTIONS
            )
        ],
    )


def downgrade() -> None:
    op.drop_index("ix_humor_questions_position", table_name="humor_questions")
    op.drop_table("humor_questions")
    op.drop_table("humor_settings")
