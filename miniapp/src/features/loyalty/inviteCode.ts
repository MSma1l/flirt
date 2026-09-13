/**
 * Normalizarea codului de invitație tastat de utilizator.
 *
 * OGLINDA EXACTĂ a lui `normalize_code` din `backend/app/services/loyalty.py`:
 *     "".join(ch for ch in code.strip().upper() if ch not in " -_\t\n")
 *
 * DE CE o facem și în client, dacă serverul o face oricum: câmpul trebuie să
 * arate exact ce pleacă spre server. Un cod dictat la telefon ajunge scris
 * „abcd-efgh ijkl"; dacă îl lăsăm așa în câmp și îl acceptăm în tăcere, omul nu
 * învață niciodată forma corectă, iar la o eventuală eroare se uită la un text
 * care nu e cel trimis. În plus, așa putem decide LOCAL că nu are rost să
 * trimitem un câmp gol — o cerere sigur respinsă, contorizată de limitatorul de
 * rată al rutei, e o cerere pe care i-o furăm utilizatorului.
 *
 * Alfabetul serverului (`_CODE_ALPHABET`) nu conține litere mici, deci ridicarea
 * la majuscule nu poate crea coliziuni.
 */

/** Plafonul din `CODE_MAX_LENGTH` (`backend/app/schemas/loyalty.py`). */
export const INVITE_CODE_MAX_LENGTH = 64;

/** Caracterele pe care serverul le aruncă: spațiu, cratimă, underscore, tab, linie nouă. */
const IGNORED = new Set([' ', '-', '_', '\t', '\n']);

/**
 * Forma canonică a unui cod: fără spații, fără cratime, majuscule.
 *
 * Se aplică și caracterelor invizibile pe care tastaturile mobile le lipesc din
 * clipboard (`\r`, spațiul insecabil): nu sunt în lista serverului, dar sunt tot
 * spațiu alb, iar un cod cu un ` ` invizibil la mijloc ar fi respins cu
 * „cod inexistent", cel mai derutant mesaj posibil.
 */
export function normalizeInviteCode(raw: string): string {
  return [...raw]
    .filter((ch) => !IGNORED.has(ch) && !/\s/.test(ch))
    .join('')
    .toUpperCase()
    .slice(0, INVITE_CODE_MAX_LENGTH);
}
