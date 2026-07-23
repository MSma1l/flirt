"""Import central al modelelor pentru ca Alembic să vadă toate tabelele.

Fiecare fișier de model definește clase care moștenesc `app.db.base.Base`.
"""
from app.models.user import User  # noqa: F401
from app.models.session import RefreshSession  # noqa: F401
from app.models.profile import Profile  # noqa: F401
from app.models.interest import Interest, ProfileInterest  # noqa: F401
from app.models.swipe import Like, Match  # noqa: F401
from app.models.chat import Chat, Message  # noqa: F401
from app.models.account import (  # noqa: F401
    UserSettings,
    Favorite,
    Block,
    Ticket,
    AccountDeletionRequest,
)
from app.models.event import (  # noqa: F401
    Event,
    EventAttendance,
    FlirtPassportStamp,
)
from app.models.story import Story  # noqa: F401
from app.models.moderation import Report  # noqa: F401
from app.models.billing import PurchaseReceipt, Subscription  # noqa: F401
from app.models.device import PushDevice  # noqa: F401
from app.models.admin import AdminAuditLog  # noqa: F401
from app.models.ad import Ad, AdSettings  # noqa: F401
from app.models.ticket_order import (  # noqa: F401
    PaymentSettings,
    TicketOrder,
)
