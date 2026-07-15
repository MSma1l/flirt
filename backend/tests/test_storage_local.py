"""Teste pentru providerul de storage LOCAL (pe disc, fără AWS)."""
import pytest

from app.services import storage
from app.services.storage import LocalStorage, get_storage


@pytest.fixture
def local(tmp_path, monkeypatch):
    """Configurează providerul local pe un director temporar + base_url cu path."""
    monkeypatch.setattr(storage.settings, "storage_provider", "local")
    monkeypatch.setattr(storage.settings, "storage_local_dir", str(tmp_path))
    monkeypatch.setattr(storage.settings, "storage_base_url", "https://api.flrt.md/media")
    # allowed_hosts se derivă din base_url → api.flrt.md
    return tmp_path


@pytest.mark.asyncio
async def test_save_scrie_fisier_si_intoarce_url_public(local):
    st = LocalStorage()
    key = "photos/u1/abc.jpg"
    url = await st.save(key, b"\xff\xd8\xff datele imaginii", "image/jpeg")

    # URL-ul e sub domeniul propriu, la /media, cu cheia păstrată.
    assert url == "https://api.flrt.md/media/photos/u1/abc.jpg"
    # Fișierul chiar există pe disc, cu conținutul dat.
    assert (local / "photos" / "u1" / "abc.jpg").read_bytes() == b"\xff\xd8\xff datele imaginii"


@pytest.mark.asyncio
async def test_save_video_story(local):
    st = LocalStorage()
    url = await st.save("stories/u1/clip.mp4", b"\x00\x00\x00\x18ftypmp42", "video/mp4")
    assert url == "https://api.flrt.md/media/stories/u1/clip.mp4"
    assert (local / "stories" / "u1" / "clip.mp4").exists()


@pytest.mark.asyncio
async def test_delete_sterge_fisierul(local):
    st = LocalStorage()
    url = await st.save("photos/u1/x.png", b"date", "image/png")
    assert (local / "photos" / "u1" / "x.png").exists()

    await st.delete(url)
    assert not (local / "photos" / "u1" / "x.png").exists()


@pytest.mark.asyncio
async def test_delete_url_strain_e_ignorat(local):
    st = LocalStorage()
    await st.save("photos/u1/x.png", b"date", "image/png")
    # URL de pe alt domeniu → no-op, fișierul rămâne.
    await st.delete("https://evil.example.com/media/photos/u1/x.png")
    assert (local / "photos" / "u1" / "x.png").exists()


@pytest.mark.asyncio
async def test_path_traversal_respins(local):
    """O cheie care iese din rădăcină (../) e refuzată, nu scrie în afara dir-ului."""
    st = LocalStorage()
    with pytest.raises(ValueError):
        await st.save("../../etc/evil", b"x", "image/png")


def test_get_storage_local(local):
    assert isinstance(get_storage(), LocalStorage)
