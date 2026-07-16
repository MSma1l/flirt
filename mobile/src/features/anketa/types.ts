/** Tipuri pentru wizardul de anketă (chestionar de înregistrare). */

/** O opțiune de interes venită din backend (slug intern + etichetă afișată). */
export interface InterestOption {
  slug: string;
  label: string;
}

/**
 * O opțiune de referință: valoarea internă trimisă înapoi la backend + eticheta
 * localizată deja afișabilă. Backend-ul întoarce `{value, label_ru, label_ro}`;
 * stratul de API alege eticheta potrivită limbii (vezi `anketaApi.ts`).
 */
export interface OptionItem {
  value: string;
  label: string;
}

/** Datele de referință pentru anketă, aduse din backend (fără hardcodare). */
export interface Reference {
  genders: OptionItem[];
  datingStatuses: OptionItem[];
  languages: OptionItem[];
  interests: InterestOption[];
}

/** Draftul complet al anketei (câmpurile din TZ 2.4–2.6). */
export interface AnketaDraft {
  name: string;
  /** Data nașterii în format ISO (YYYY-MM-DD). */
  birthDate: string;
  gender: string;
  heightCm: number;
  city: string;
  street?: string;
  nationality?: string;
  languages: string[];
  about?: string;
  datingStatuses: string[];
  interests: string[];
  /**
   * Preferințele de căutare (TZ 4) — „pe cine cauți".
   *
   * Sunt culese în wizard, dar backend-ul le PERSISTĂ în `UserSettings` (aceeași
   * sursă ca `PUT /settings`), nu în profil. De aceea sunt OPȚIONALE: `undefined`
   * ⇒ câmpul nu se trimite ⇒ backend-ul nu le atinge. Ecranul de editare a
   * profilului se bazează pe asta: el nu întreabă de preferințe, deci nu are
   * cum să le rescrie din greșeală (schimbarea lor se face din Setări).
   */
  /** Genurile căutate (valori din referință). Listă goală = fără restricție de gen. */
  interestedIn?: string[];
  /** Vârsta minimă căutată — niciodată sub 18 (aplicația este 18+ ONLY). */
  ageMin?: number;
  /** Vârsta maximă căutată. */
  ageMax?: number;
  /**
   * URL-urile pozelor DEJA încărcate pe server, în ordinea afișării.
   *
   * ATENȚIE: `PUT /profiles/me` REESCRIE lista de poze a profilului
   * (`profile.photos = data.photos`). Dacă trimitem lista goală la o simplă
   * editare de profil, backend-ul ȘTERGE toate pozele. De aceea ecranul de
   * editare trimite mereu URL-urile curente aici.
   *
   * În wizard câmpul rămâne gol: profilul încă nu există, deci pozele nu au cum
   * să fie încărcate înainte de salvare — se urcă imediat după.
   */
  photos?: string[];
}
