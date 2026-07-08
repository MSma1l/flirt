/** Tipuri pentru Abonamente / Paywall (TZ secț. 9). Câmpuri interne în camelCase. */

/** Un plan de abonament afișat în paywall. */
export interface Plan {
  code: string;
  title: string;
  /** Preț lunar în EUR. */
  priceEur: number;
  /** Beneficiile incluse, listate cu bifă în UI. */
  features: string[];
}

/** Abonamentul curent al utilizatorului (sau `null` dacă nu are unul). */
export interface Subscription {
  plan: string;
  status: string;
  /** Data expirării în format ISO. */
  expiresAt: string;
}

/** Drepturile (entitlements) deblocate de abonamentul activ. */
export interface Entitlements {
  premium: boolean;
  noAds: boolean;
  aiBot: boolean;
}
