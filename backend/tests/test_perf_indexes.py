"""Valul 2 de performanta: indexurile noi — declarate in model si create/sterse
corect de migratia 7e583da3cefa (up/down pe Postgres real)."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import text

from app.db.base import Base

BACKEND = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND / "alembic" / "versions" / "7e583da3cefa_perf_indexes_unread_partial_user_lists.py"

NEW_INDEXES = {
    "ix_messages_unread_chat_sender": "messages",
    "ix_stories_user_expires": "stories",
    "ix_ticket_orders_user_created": "ticket_orders",
    "ix_favorites_user_created": "favorites",
    "ix_blocks_blocker_created": "blocks",
}
OLD_UNREAD_INDEX = "ix_messages_chat_sender_unread"


def _load_migration():
    spec = importlib.util.spec_from_file_location("mig_7e583da3cefa", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def _indexes(conn) -> dict[str, str]:
    rows = await conn.execute(
        text("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema()")
    )
    return {name: definition for name, definition in rows.all()}


# --------------------------------------------------------------------------- #
# Modelul = sursa de adevar
# --------------------------------------------------------------------------- #
def test_models_declare_new_indexes():
    declared = {
        index.name: table.name
        for table in Base.metadata.tables.values()
        for index in table.indexes
    }
    for name, table in NEW_INDEXES.items():
        assert declared.get(name) == table, name
    assert OLD_UNREAD_INDEX not in declared
    # likes(to_user_id, created_at) exista deja din valul 1 — nu se dubleaza.
    assert declared.get("ix_likes_to_user_created") == "likes"
    likes_cols = [
        tuple(c.name for c in i.columns)
        for i in Base.metadata.tables["likes"].indexes
    ]
    assert likes_cols.count(("to_user_id", "created_at")) == 1


def test_migration_is_single_head_on_top_of_ticket_tiers():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    script = ScriptDirectory.from_config(cfg)
    heads = script.get_heads()
    assert len(heads) == 1
    assert "7e583da3cefa" in {r.revision for r in script.walk_revisions("base", heads[0])}
    assert script.get_revision("7e583da3cefa").down_revision == "a6c2e9d41f73"


@pytest.mark.asyncio
async def test_unread_index_is_partial_in_db(engine):
    async with engine.connect() as conn:
        indexes = await _indexes(conn)
    definition = indexes["ix_messages_unread_chat_sender"]
    assert "(chat_id, sender_id)" in definition
    assert "WHERE (is_read = false)" in definition
    assert OLD_UNREAD_INDEX not in indexes


# --------------------------------------------------------------------------- #
# Migratia: downgrade -> upgrade pe schema reala (Postgres)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_migration_downgrade_then_upgrade(engine):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    migration = _load_migration()

    def _run(sync_conn, step: str) -> None:
        ctx = MigrationContext.configure(sync_conn)
        with Operations.context(ctx):
            getattr(migration, step)()

    async with engine.begin() as conn:
        await conn.run_sync(_run, "downgrade")
        after_down = await _indexes(conn)
    try:
        for name in NEW_INDEXES:
            assert name not in after_down, name
        assert OLD_UNREAD_INDEX in after_down
        assert "(chat_id, sender_id, is_read)" in after_down[OLD_UNREAD_INDEX]
    finally:
        # Schema de test e comuna tuturor testelor — revenim mereu la head.
        async with engine.begin() as conn:
            await conn.run_sync(_run, "upgrade")
            after_up = await _indexes(conn)

    for name in NEW_INDEXES:
        assert name in after_up, name
    assert OLD_UNREAD_INDEX not in after_up
    assert "WHERE (is_read = false)" in after_up["ix_messages_unread_chat_sender"]
    assert "(user_id, expires_at)" in after_up["ix_stories_user_expires"]
    assert "(blocker_id, created_at)" in after_up["ix_blocks_blocker_created"]
