/**
 * Tipurile de bilet ale unui eveniment (Early bird / Standard / VIP …).
 *
 * Contractul (`GET /events/{id}` → `ticket_tiers`, server nou, opțional): listă
 * goală sau lipsă = preț unic (`ticket_price`), fluxul de dinainte. Cu UN singur
 * tip nu există pas de alegere (serverul îl alege singur); cu mai multe, omul
 * alege un card. Prețul NU se calculează aici: cotația și comanda vin de la
 * server, cu reducerile aplicate peste prețul tipului.
 */

export interface TicketTier {
  id: string;
  name: string;
  description: string | null;
  price: number;
  /** Nu se mai pot cere bilete de acest tip (plafonul tipului sau al evenimentului). */
  soldOut: boolean;
}

type Raw = Record<string, unknown>;

/** `ticket_tiers` din răspunsul serverului → modelul local (tolerant la lipsă). */
export function mapTicketTiers(value: unknown): TicketTier[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Raw => typeof item === 'object' && item !== null)
    .map((item) => ({
      id: String(item.id ?? ''),
      name: String(item.name ?? ''),
      description: typeof item.description === 'string' && item.description !== '' ? item.description : null,
      price: typeof item.price === 'number' ? item.price : 0,
      soldOut: item.sold_out === true,
    }))
    .filter((tier) => tier.id !== '');
}

/** Există alegere de făcut (mai mult de un tip)? */
export function needsTierChoice(tiers: readonly TicketTier[] | undefined): boolean {
  return (tiers?.length ?? 0) > 1;
}

/**
 * Tipul efectiv selectat: alegerea omului dacă e încă disponibilă, altfel
 * primul tip neepuizat (preselectat, ca butonul de cumpărare să aibă mereu un
 * preț real). `null` = eveniment fără tipuri sau toate epuizate.
 */
export function resolveTier(tiers: readonly TicketTier[] | undefined, chosenId: string | null): TicketTier | null {
  const list = tiers ?? [];
  const chosen = chosenId ? list.find((tier) => tier.id === chosenId && !tier.soldOut) : undefined;
  return chosen ?? list.find((tier) => !tier.soldOut) ?? null;
}

/** Prețul minim dintre tipurile disponibile („de la X"); `null` fără tipuri. */
export function lowestTierPrice(tiers: readonly TicketTier[] | undefined): number | null {
  const prices = (tiers ?? []).filter((tier) => !tier.soldOut).map((tier) => tier.price);
  return prices.length > 0 ? Math.min(...prices) : null;
}
