"""Import central al modelelor pentru ca Alembic să vadă toate tabelele.

Fiecare fișier de model definește clase care moștenesc `app.db.base.Base`.
"""
from app.models.user import User  # noqa: F401
from app.models.session import RefreshSession  # noqa: F401
from app.models.profile import Profile  # noqa: F401
from app.models.interest import Interest, ProfileInterest  # noqa: F401
from app.models.swipe import Like, Match  # noqa: F401
