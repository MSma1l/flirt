"""Model AdminAuditLog — jurnalul de audit al panoului de administrare.

DE CE EXISTĂ: un admin poate bana, ascunde și ȘTERGE conturi (GDPR, ireversibil),
poate acorda abonamente și poate crea evenimente. Fără un jurnal, o acțiune
distructivă nu are autor, nu are moment și nu are motiv — nici pentru anchetă
internă (cont de admin compromis), nici pentru un audit extern (GDPR art. 5(2),
principiul responsabilității).

REGULI:
  * Se scrie în ACEEAȘI tranzacție cu acțiunea auditată — dacă acțiunea eșuează,
    nu rămâne o intrare fantomă; dacă jurnalul eșuează, acțiunea nu se comite.
  * Este APPEND-ONLY: nu există niciun endpoint de ștergere sau editare.
  * `actor_id` NU are `ON DELETE CASCADE`: ștergerea unui cont de admin nu are
    voie să șteargă istoria acțiunilor lui (`SET NULL` păstrează urma, cu
    `actor_email` denormalizat ca să rămână lizibilă).
  * `meta` NU conține niciodată secrete (parole, hash-uri, tokenuri) — doar
    parametrii deciziei (motivul banului, planul acordat etc.).
"""
from __future__ import annotations

import uuid

from sqlalchemy import JSON, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.db.base import Base

# Acțiunile auditate (o singură sursă de adevăr; folosite de admin_service).
ACTION_LOGIN = "admin.login"
ACTION_USER_BAN = "user.ban"
ACTION_USER_UNBAN = "user.unban"
ACTION_USER_HIDE = "user.hide"
ACTION_USER_DELETE = "user.delete"
ACTION_REPORT_RESOLVE = "report.resolve"
ACTION_EVENT_CREATE = "event.create"
ACTION_EVENT_UPDATE = "event.update"
ACTION_EVENT_DELETE = "event.delete"
ACTION_SUBSCRIPTION_GRANT = "subscription.grant"
ACTION_SUBSCRIPTION_REVOKE = "subscription.revoke"


class AdminAuditLog(Base):
    """O acțiune de admin: cine, ce, asupra cui, când, de la ce IP."""

    __tablename__ = "admin_audit_logs"
    __table_args__ = (
        # Listarea jurnalului e mereu „cele mai noi întâi", paginat pe cursor.
        Index("ix_admin_audit_created", "created_at"),
        # Istoricul acțiunilor asupra unei ținte (ex. „ce s-a făcut cu userul X").
        Index("ix_admin_audit_target", "target_type", "target_id"),
    )

    # Adminul care a executat acțiunea. SET NULL la ștergerea contului de admin:
    # urma rămâne, doar legătura se pierde (vezi `actor_email`).
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    # Emailul adminului la momentul acțiunii — denormalizat INTENȚIONAT, ca
    # jurnalul să rămână citibil chiar dacă contul dispare.
    actor_email: Mapped[str] = mapped_column(String(255), nullable=False)

    # Ce s-a făcut (una dintre constantele ACTION_* de mai sus).
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # Asupra cui: tipul entității ('user' | 'report' | 'event' | 'subscription').
    target_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Id-ul entității. UUID simplu, FĂRĂ constrângere de cheie externă: ținta
    # poate fi ȘTEARSĂ (chiar de acțiunea auditată — vezi `user.delete`), iar un
    # FK ar face imposibilă tocmai înregistrarea ștergerii.
    target_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)

    # Context structurat al deciziei (motiv, plan, câmpuri modificate). Fără secrete.
    meta: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # IP-ul de la care a venit cererea (respectă X-Forwarded-For prin reverse proxy).
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
