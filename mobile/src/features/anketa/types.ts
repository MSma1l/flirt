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

/** Draftul complet al anketei (câmpurile din TZ 2.4–2.6, fără poze/telefon). */
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
}
