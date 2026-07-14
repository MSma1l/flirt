/** Tipuri pentru wizardul de anketă (chestionar de înregistrare). */

/** O opțiune de interes venită din backend (slug intern + etichetă afișată). */
export interface InterestOption {
  slug: string;
  label: string;
}

/** Datele de referință pentru anketă, aduse din backend (fără hardcodare). */
export interface Reference {
  genders: string[];
  datingStatuses: string[];
  languages: string[];
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
