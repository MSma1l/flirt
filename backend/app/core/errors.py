"""Coduri de eroare STABILE, pentru ca un client să nu decidă după text.

Problema pe care o rezolvă. Refuzurile de la `POST /feed/swipe` au mesaje
distincte tocmai ca aplicația să știe UNDE să ducă utilizatorul: la testul de
umor, la poze, sau la completarea profilului. Dar singurul semnal era textul
mesajului, în română, pe care clientul îl compara exact.

Asta s-a rupt deja în practică: Mini App-ul nu recunoștea niciun caz, afișa o
eroare generică, iar utilizatorii rămâneau blocați fără să afle ce li se cere.
Aceeași capcană ne-a costat de două ori până acum, la clasificarea erorilor de
autentificare și la motivele de refuz al invitațiilor.

Un text se traduce, se rescrie la o corectură de exprimare, sau primește o
virgulă în plus. Un cod nu. De aceea codul e contractul, iar textul rămâne ce a
fost mereu: un mesaj pentru oameni.

COMPATIBILITATE: `detail` NU se schimbă. Aplicația nativă, aflată în producție,
compară textul și trebuie să continue să funcționeze neatinsă. Codul se adaugă
ca un câmp NOU în răspuns, pe care clienții vechi îl ignoră.
"""
from fastapi import HTTPException


class ErrorCode:
    """Codurile pe care le poate întoarce API-ul. Se adaugă, nu se redenumesc.

    Redenumirea unui cod are exact efectul pe care încercăm să-l evităm: rupe
    tăcut clienții deja publicați, care nu se pot actualiza odată cu serverul.
    """

    # Refuzuri la acțiunea de swipe — fiecare duce utilizatorul în alt loc.
    SELF_SWIPE = "self_swipe"
    PROFILE_INCOMPLETE = "profile_incomplete"
    PHOTOS_REQUIRED = "photos_required"
    HUMOR_REQUIRED = "humor_required"
    UNDERAGE = "underage"
    INTERACTION_BLOCKED = "interaction_blocked"


class CodedHTTPException(HTTPException):
    """`HTTPException` cu un cod stabil, citibil de mașină.

    Se serializează ca `{"detail": "...", "code": "..."}` — vezi handlerul din
    `app/main.py`. Fără handler, s-ar comporta exact ca `HTTPException`, deci o
    eventuală scoatere a handlerului degradează, nu rupe.
    """

    def __init__(self, status_code: int, detail: str, code: str) -> None:
        super().__init__(status_code=status_code, detail=detail)
        self.code = code
