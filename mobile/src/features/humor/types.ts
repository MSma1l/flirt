/** Tipuri pentru Testul de umor (TZ secț. 2.7). Câmpuri interne în camelCase. */

/**
 * Un card de glumă afișat în test.
 *
 * Textele vin localizate de la server în cele 4 limbi (`text_ro`, `text_ru`,
 * `text_uk`, `text_en`) — exact tiparul `label_ro/ru/uk/en` de la
 * `GET /profiles/reference`: serverul trimite toate variantele, clientul alege
 * limba activă. NU le duplicăm în cataloagele i18n.
 *
 * Toate câmpurile de text sunt OPȚIONALE aici, deși schema serverului le cere:
 * un client publicat poate vorbi cu un server mai vechi (care trimitea doar
 * `text`) sau invers. `cardText()` rezolvă orice combinație, cu fallback pe `ro`.
 */
export interface HumorCard {
  id: string;
  /** Categoria de umor (ex. `sarcasm`, `dark`, `absurd`). */
  type: string;
  text_ro?: string;
  text_ru?: string;
  text_uk?: string;
  text_en?: string;
  /** DEPRECAT — aliasul serverului pe `text_ro`, păstrat pentru compatibilitate. */
  text?: string;
}

/** Răspunsul utilizatorului la un card: dacă i s-a părut amuzant. */
export interface HumorAnswer {
  cardId: string;
  funny: boolean;
}

/** Profilul de umor calculat: pondere pe fiecare tip de umor. */
export interface HumorProfile {
  vector: Record<string, number>;
}
