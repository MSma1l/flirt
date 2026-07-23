/** Tipuri pentru Evenimente / Live Events + Flirt Passport (TZ secț. 8). Toate câmpurile în camelCase. */

/** Un eveniment live afișat în listă sau detaliu. */
export interface EventItem {
  id: string;
  title: string;
  description: string;
  /** Data/ora de start în format ISO 8601. */
  startsAt: string;
  city: string;
  venue: string;
  /** Coordonate pentru harta placeholder (opționale). */
  lat?: number;
  lng?: number;
  /** Tipul evenimentului (ex. `flirt_party`, `concert`). */
  kind: string;
  /** URL-ul imaginii de copertă (opțional). */
  coverUrl?: string;
  /** Numărul de participanți confirmați. */
  attendeeCount: number;
  /** Dacă utilizatorul curent a confirmat participarea. */
  iAmGoing: boolean;
  /** Procentul de reducere la intrare, arătat cu codul promo. `null` dacă nu are promo. */
  promoDiscountPercent: number | null;
  /** Codul promo de arătat la intrare. `null` dacă nu are promo. */
  promoCode: string | null;
  /** Descrierea reducerii (condiții etc.). `null` dacă nu are promo. */
  promoDescription: string | null;
  /** Prețul biletului online. `null` dacă evenimentul nu vinde bilete online. */
  ticketPrice: number | null;
  /** Moneda prețului de bilet (ex. „lei"). `null` dacă nu are preț. */
  ticketCurrency: string | null;
}

/** O ștampilă din Flirt Passport, primită la check-in-ul unui eveniment. */
export interface PassportStamp {
  eventId: string;
  eventTitle: string;
  city: string;
  /** Momentul ștampilării în format ISO 8601. */
  stampedAt: string;
}
