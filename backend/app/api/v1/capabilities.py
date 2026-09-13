"""`GET /api/v1/capabilities` — ce funcții merg CU ADEVĂRAT pe acest server.

DE CE. Produsul a migrat în Telegram Mini App, iar câteva integrări au rămas în
modul de dezvoltare fiindcă funcțiile pe care le deserveau au ieșit din scop
(login Google/Apple, cod pe telefon, plăți native, push nativ, verificare
facială). Regula proprietarului e clară: o astfel de funcție se declară
INDISPONIBILĂ, nu se servește cu un rezultat fals. Ruta asta e declarația.

PUBLICĂ, fără token. Trei motive, în ordinea greutății:
 1. Clientul are nevoie de răspuns ÎNAINTE de a avea un token: exact lista de
    metode de intrare (Telegram / Google / telefon) se decide pe ecranul de
    login, unde prin definiție nu ești autentificat. O rută autentificată ar
    răspunde la întrebare abia după ce ai răspuns-o singur.
 2. Nu spune nimic secret: doar `true/false` pe funcții de produs, niciun nume
    de provider, nicio versiune, niciun mesaj de eroare. Un atacator află
    exact atât cât ar afla apăsând butonul — adică nimic în plus.
 3. Nu atinge baza de date și nu depinde de cine întreabă, deci nu e nici o
    cale de scurgere de date, nici o țintă interesantă de abuz (răspunsul e
    același pentru toată lumea și poate fi cache-uit de client).

Sursa adevărului e `Settings.capabilities`, ACEEAȘI pe care garda de producție
o folosește ca să decidă dacă are voie să pornească (vezi `_guard_production`).
Nu există o a doua listă care s-ar putea desincroniza tăcut de prima.
"""
from fastapi import APIRouter

from app.core.config import settings
from app.schemas.capabilities import CapabilitiesOut

router = APIRouter()


@router.get(
    "/capabilities",
    response_model=CapabilitiesOut,
    tags=["meta"],
    summary="Ce funcții de produs sunt disponibile real pe acest server",
)
async def capabilities() -> CapabilitiesOut:
    """Da/nu pentru fiecare funcție de produs. Fără detalii de infrastructură."""
    # Citit la FIECARE cerere, nu la pornire: în teste și în dezvoltare
    # providerii se schimbă din mers, iar un răspuns înghețat la import ar
    # raporta altceva decât face serverul în acel moment.
    return CapabilitiesOut(**settings.capabilities)
