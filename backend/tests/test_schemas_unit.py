"""Unit teste pentru validările schemelor Pydantic (input greșit → ValidationError)."""
from datetime import date

import pytest
from pydantic import ValidationError

from app.core.config import settings
from app.schemas.auth import RegisterIn
from app.schemas.moderation import ReportIn
from app.schemas.profile import AnketaIn, PhotoUrlIn


# --- Auth --------------------------------------------------------------------
def test_register_invalid_email_rejected():
    with pytest.raises(ValidationError):
        RegisterIn(email="not-an-email", password="Str0ng-Passw0rd!")


def test_register_short_password_rejected():
    with pytest.raises(ValidationError):
        RegisterIn(email="ok@example.com", password="scurt")  # < 8


def test_register_valid_ok():
    r = RegisterIn(email="ok@example.com", password="Str0ng-Passw0rd!")
    assert r.email == "ok@example.com"


# --- Anketa ------------------------------------------------------------------
def _anketa_kwargs(**kw):
    base = dict(
        name="Ion",
        birth_date=date(1990, 1, 1),
        gender="male",
        height_cm=180,
        city="Chișinău",
    )
    base.update(kw)
    return base


def test_anketa_empty_name_rejected():
    with pytest.raises(ValidationError):
        AnketaIn(**_anketa_kwargs(name=""))


def test_anketa_height_out_of_range_rejected():
    with pytest.raises(ValidationError):
        AnketaIn(**_anketa_kwargs(height_cm=0))
    with pytest.raises(ValidationError):
        AnketaIn(**_anketa_kwargs(height_cm=400))


def test_anketa_about_too_long_rejected():
    with pytest.raises(ValidationError):
        AnketaIn(**_anketa_kwargs(about="x" * (settings.about_max_length + 1)))


def test_anketa_missing_required_field_rejected():
    with pytest.raises(ValidationError):
        AnketaIn(name="Ion", gender="male", height_cm=180, city="X")  # fără birth_date


def test_anketa_valid_defaults_lists():
    a = AnketaIn(**_anketa_kwargs())
    assert a.languages == []
    assert a.interests == []
    assert a.photos == []


# --- Photo -------------------------------------------------------------------
def test_photo_url_empty_rejected():
    with pytest.raises(ValidationError):
        PhotoUrlIn(url="")


# --- Report ------------------------------------------------------------------
def test_report_invalid_category_rejected():
    import uuid

    with pytest.raises(ValidationError):
        ReportIn(reported_user_id=uuid.uuid4(), category="not-a-category")


def test_report_valid_category_ok():
    import uuid

    r = ReportIn(reported_user_id=uuid.uuid4(), category="spam")
    assert r.category == "spam"
    assert r.chat_id is None
