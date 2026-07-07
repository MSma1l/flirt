/** Tipuri pentru Testul de umor (TZ secț. 2.7). Câmpuri interne în camelCase. */

/** Un card de glumă afișat în test. */
export interface HumorCard {
  id: string;
  text: string;
  /** Categoria de umor (ex. `absurd`, `sarcastic`, `pun`). */
  type: string;
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
