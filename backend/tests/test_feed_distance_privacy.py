"""Distanta din feed e GRUPATA pe intervale (anti-triangulare), tot ca numar."""
from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import pytest

from app.services import feed_service
from app.services.feed_service import public_distance_km


# --------------------------------------------------------------------------- #
# Distanta grupata (anti-triangulare)
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    ("exact", "shown"),
    [
        (None, None),
        (0.0, 2),
        (0.3, 2),
        (1.4, 2),
        (1.99, 2),
        (2.0, 2),
        (2.49, 2),
        (2.5, 3),
        (3.4, 3),
        (7.6, 8),
        (9.6, 10),
        (10.0, 10),
        (10.4, 10),
        (12.4, 10),
        (12.5, 15),
        (17.4, 15),
        (17.6, 20),
        (243.0, 245),
        (-1.0, 2),
    ],
)
def test_public_distance_km_buckets(exact, shown):
    assert public_distance_km(exact) == shown


def test_public_distance_hides_small_moves():
    """Sub 2 km toate pozitiile arata la fel; peste 10 km pasul e de 5 km."""
    assert {public_distance_km(d / 10) for d in range(0, 20)} == {2}
    assert {public_distance_km(d / 10) for d in range(125, 175)} == {15}
    assert all(isinstance(public_distance_km(d / 7), int) for d in range(0, 2000))


def test_feed_card_uses_bucketed_distance():
    """Cartela din feed expune distanta GRUPATA, tot ca numar (int)."""
    profile = SimpleNamespace(
        user_id="00000000-0000-0000-0000-000000000001",
        name="Ana",
        birth_date=date(2000, 1, 1),
        gender="female",
        city="Chisinau",
        about=None,
        languages=["ro"],
        photos=[],
    )
    card = feed_service._make_card(50, profile, set(), 0.7)
    assert card.distance_km == 2
    card = feed_service._make_card(50, profile, set(), 13.2)
    assert card.distance_km == 15
    card = feed_service._make_card(50, profile, set(), None)
    assert card.distance_km is None
