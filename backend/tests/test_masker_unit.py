"""Unit teste pentru mascarea datelor de contact (funcție pură)."""
from app.services.contact_masker import MASK, mask_contacts


# --- Cazuri care TREBUIE mascate ---------------------------------------------
def test_email_is_masked():
    masked, changed = mask_contacts("scrie-mi la ion.pop@gmail.com te rog")
    assert changed is True
    assert "gmail.com" not in masked
    assert MASK in masked


def test_url_https_is_masked():
    masked, changed = mask_contacts("vezi aici https://example.com/profil")
    assert changed is True
    assert "https://example.com" not in masked


def test_www_url_is_masked():
    masked, changed = mask_contacts("intra pe www.site.ru acum")
    assert changed is True
    assert "www.site.ru" not in masked


def test_bare_domain_is_masked():
    masked, changed = mask_contacts("gaseste-ma pe insta.gg/nick")
    assert changed is True
    assert MASK in masked


def test_phone_with_separators_is_masked():
    masked, changed = mask_contacts("suna-ma +373 60 123 456 diseara")
    assert changed is True
    assert "123" not in masked


def test_phone_plain_digits_is_masked():
    masked, changed = mask_contacts("numarul meu 0791234567")
    assert changed is True
    assert MASK in masked


def test_handle_is_masked():
    masked, changed = mask_contacts("da-mi follow @andrei_official")
    assert changed is True
    assert "@andrei_official" not in masked


def test_messenger_mention_keeps_keyword_masks_nick():
    masked, changed = mask_contacts("scrie pe telegram @secret_nick99")
    assert changed is True
    # Cuvântul-cheie rămâne, nick-ul e ascuns.
    assert "telegram" in masked.lower()
    assert "secret_nick99" not in masked
    assert MASK in masked


def test_multiple_contacts_masked_together():
    text = "mail a@b.com si tel 069123456"
    masked, changed = mask_contacts(text)
    assert changed is True
    assert "a@b.com" not in masked
    assert "069123456" not in masked


# --- Cazuri care NU trebuie atinse -------------------------------------------
def test_plain_text_untouched():
    text = "Salut, ce mai faci? Hai la o cafea maine."
    masked, changed = mask_contacts(text)
    assert changed is False
    assert masked == text


def test_short_number_not_treated_as_phone():
    # Sub pragul MIN_PHONE_DIGITS (7) — de ex. un an sau un pret.
    text = "am 2 caini si 3 pisici"
    masked, changed = mask_contacts(text)
    assert changed is False
    assert masked == text


def test_empty_string_returns_unchanged():
    masked, changed = mask_contacts("")
    assert changed is False
    assert masked == ""


def test_none_like_falsy_returns_unchanged():
    # Funcția tratează falsy explicit (text gol) → nu crapă.
    masked, changed = mask_contacts("")
    assert (masked, changed) == ("", False)


def test_word_with_dot_not_a_domain():
    # „etc." nu are TLD valid din lista → nu se mascheaza.
    text = "mancare, filme, etc. si multe altele"
    masked, changed = mask_contacts(text)
    assert changed is False
    assert masked == text
