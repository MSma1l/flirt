/**
 * Stratul de rețea al programului de FIDELITATE (Flirt Passport) și al
 * INVITAȚIILOR speciale.
 *
 * DE CE nu re-exportă din `@mobile/` ca vecinii lui (`eventsApi`, `ticketsApi`):
 * aplicația Expo nu are încă niciun modul pentru rutele `/loyalty/*`, deci nu
 * există ce reutiliza. Maparea snake_case → camelCase e scrisă aici, o singură
 * dată, exact pe câmpurile din `backend/app/schemas/loyalty.py`.
 *
 * Rutele acoperite (`backend/app/api/v1/loyalty.py`):
 *   GET  /loyalty/me                          → LoyaltyStatusOut
 *   GET  /loyalty/events/{id}/ticket-quote    → TicketQuoteOut
 *   POST /loyalty/invites/redeem              → RedeemOut
 *
 * REGULA CARE NU SE NEGOCIAZĂ, moștenită din contractul backendului: aplicația
 * NU calculează niciun preț și niciun procent. Tot ce e afișat aici vine gata
 * calculat de pe server. Singurul lucru pe care îl trimitem e codul invitației.
 * Un procent recalculat în client ar fi a doua sursă de adevăr și s-ar
 * desincroniza în tăcere de prețul real de pe comandă.
 */
import { api } from '@/api/client';

/** O treaptă de fidelitate, așa cum o configurează adminul. */
export interface LoyaltyTier {
  /** Codul stabil al treptei (`silver`, `gold`…), folosit ca identitate. */
  code: string;
  /** Numele afișabil, așa cum l-a scris adminul. */
  name: string;
  /** De la câte ștampile începe treapta. */
  minStamps: number;
  /** Reducerea pe care o dă treapta. */
  discountPercent: number;
}

/** `GET /loyalty/me` — unde sunt și ce îmi mai trebuie. */
export interface LoyaltyStatus {
  /** Evenimente DISTINCTE cu check-in confirmat. */
  stamps: number;
  /** Treapta atinsă; `null` cât timp nu e atinsă nici prima. */
  tier: LoyaltyTier | null;
  /** Reducerea treptei curente (0 fără treaptă). */
  discountPercent: number;
  /** Treapta următoare; `null` când userul e pe ULTIMA treaptă. */
  nextTier: LoyaltyTier | null;
  /** Câte ștampile mai trebuie; `null` pe ultima treaptă. */
  stampsToNextTier: number | null;
  /** Scara completă. GOALĂ = program de fidelitate neconfigurat pe server. */
  tiers: LoyaltyTier[];
  /** Plafonul total de reducere configurat. */
  maxTotalDiscountPercent: number;
}

/** De unde vine reducerea efectiv aplicată pe un bilet. */
export type QuoteSource = 'loyalty' | 'promo' | 'invite' | 'none';

/** `GET /loyalty/events/{id}/ticket-quote` — cât plătesc EU pe biletul ăsta. */
export interface TicketQuote {
  eventId: string;
  /** Prețul de listă (cel tăiat pe ecran). */
  basePrice: number;
  currency: string;
  loyaltyPercent: number;
  promoPercent: number;
  invitePercent: number;
  /** Ce s-a aplicat efectiv, după regula de combinare și după plafon. */
  appliedPercent: number;
  appliedSource: QuoteSource;
  /** `true` când cea mai bună reducere a fost tăiată de plafon. */
  capped: boolean;
  discountAmount: number;
  /** Prețul pe care îl plătește utilizatorul. */
  finalPrice: number;
  /** Treapta care a produs reducerea de fidelitate (dacă există). */
  tier: LoyaltyTier | null;
}

/** `POST /loyalty/invites/redeem` — rezultatul folosirii unei invitații. */
export interface InviteRedemption {
  inviteId: string;
  eventId: string;
  eventTitle: string;
  eventStartsAt: string;
  discountPercent: number;
  redeemedAt: string;
  /**
   * `false` când utilizatorul folosise DEJA aceeași invitație: cererea reușește
   * idempotent, dar nu s-a consumat o folosire nouă. Ecranul spune „o ai deja",
   * nu „felicitări", ca omul să nu creadă că a mai primit ceva.
   */
  consumedNewUse: boolean;
}

/* ----------------------------------------------------- formele brute (server) */

interface TierResponse {
  code: string;
  name: string;
  min_stamps: number;
  discount_percent: number;
}

interface LoyaltyStatusResponse {
  stamps: number;
  tier?: TierResponse | null;
  discount_percent: number;
  next_tier?: TierResponse | null;
  stamps_to_next_tier?: number | null;
  tiers?: TierResponse[] | null;
  max_total_discount_percent: number;
}

interface TicketQuoteResponse {
  event_id: string;
  base_price: number;
  currency: string;
  loyalty_percent: number;
  promo_percent: number;
  invite_percent: number;
  applied_percent: number;
  applied_source: string;
  capped: boolean;
  discount_amount: number;
  final_price: number;
  tier?: TierResponse | null;
}

interface RedeemResponse {
  invite_id: string;
  event_id: string;
  event_title: string;
  event_starts_at: string;
  discount_percent: number;
  redeemed_at: string;
  consumed_new_use: boolean;
}

function toTier(raw: TierResponse | null | undefined): LoyaltyTier | null {
  if (!raw) return null;
  return {
    code: raw.code,
    name: raw.name,
    minStamps: raw.min_stamps,
    discountPercent: raw.discount_percent,
  };
}

/** Sursele pe care le cunoaștem; orice altceva devine `none` (fără reducere). */
const SOURCES: readonly QuoteSource[] = ['loyalty', 'promo', 'invite', 'none'];

function toSource(raw: string): QuoteSource {
  return SOURCES.includes(raw as QuoteSource) ? (raw as QuoteSource) : 'none';
}

/* ------------------------------------------------------------------- cereri */

/** Treapta mea, ștampilele mele și cât mai am până la următoarea treaptă. */
export async function fetchLoyaltyStatus(): Promise<LoyaltyStatus> {
  const { data } = await api.get<LoyaltyStatusResponse>('/loyalty/me');
  return {
    stamps: data.stamps,
    tier: toTier(data.tier),
    discountPercent: data.discount_percent,
    nextTier: toTier(data.next_tier),
    stampsToNextTier: data.stamps_to_next_tier ?? null,
    tiers: (data.tiers ?? []).map((t) => toTier(t)).filter((t): t is LoyaltyTier => t !== null),
    maxTotalDiscountPercent: data.max_total_discount_percent,
  };
}

/**
 * Cotația de preț a biletului unui eveniment, pentru utilizatorul curent.
 *
 * 400 dacă evenimentul nu vinde bilete online, 404 dacă nu există — ambele sunt
 * lăsate să iasă ca eroare: ecranul cade atunci pe prețul de listă, care e deja
 * pe el.
 */
export async function fetchTicketQuote(eventId: string): Promise<TicketQuote> {
  const { data } = await api.get<TicketQuoteResponse>(
    `/loyalty/events/${eventId}/ticket-quote`,
  );
  return {
    eventId: data.event_id,
    basePrice: data.base_price,
    currency: data.currency,
    loyaltyPercent: data.loyalty_percent,
    promoPercent: data.promo_percent,
    invitePercent: data.invite_percent,
    appliedPercent: data.applied_percent,
    appliedSource: toSource(data.applied_source),
    capped: data.capped,
    discountAmount: data.discount_amount,
    finalPrice: data.final_price,
    tier: toTier(data.tier),
  };
}

/**
 * Folosește un cod de invitație. Codul trebuie NORMALIZAT înainte
 * (`normalizeInviteCode`) — serverul normalizează și el, dar noi trimitem deja
 * forma canonică, ca ce se vede în câmp să fie exact ce a plecat.
 */
export async function redeemInvite(code: string): Promise<InviteRedemption> {
  const { data } = await api.post<RedeemResponse>('/loyalty/invites/redeem', { code });
  return {
    inviteId: data.invite_id,
    eventId: data.event_id,
    eventTitle: data.event_title,
    eventStartsAt: data.event_starts_at,
    discountPercent: data.discount_percent,
    redeemedAt: data.redeemed_at,
    consumedNewUse: data.consumed_new_use,
  };
}
