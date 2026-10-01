/**
 * Fereastra de vânzare online a biletelor unui eveniment.
 *
 * Contractul (adăugat pe server în paralel, deci TOLERANT la lipsă):
 *   `ticket_sales_end_at` — momentul efectiv de închidere (ISO);
 *   `ticket_sales_open`   — verdictul serverului, acum.
 * Un server vechi nu trimite niciunul → vânzarea e deschisă, ca înainte.
 *
 * Verdictul serverului câștigă când spune „închis"; ceasul local închide doar
 * când trece momentul anunțat (serverul confirmă oricum cu 409 la comandă).
 */
import { useEffect, useState } from 'react';

const HOUR = 60 * 60 * 1000;
export const COUNTDOWN_WINDOW_MS = 24 * HOUR;

export interface SalesFields {
  ticketSalesEndAt?: string | null;
  ticketSalesOpen?: boolean | null;
}

export interface SalesState {
  /** Momentul închiderii, dacă serverul l-a anunțat și e o dată validă. */
  endAt: Date | null;
  closed: boolean;
  /** Milisecunde rămase până la închidere (doar când e deschis și știm ora). */
  msLeft: number | null;
  /** Mai puțin de 24 h → numărătoare inversă. */
  showCountdown: boolean;
}

export function computeSalesState(fields: SalesFields, now: number): SalesState {
  const parsed = fields.ticketSalesEndAt ? new Date(fields.ticketSalesEndAt) : null;
  const endAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  const closedByServer = fields.ticketSalesOpen === false;
  const closedByClock = endAt !== null && now >= endAt.getTime();
  const closed = closedByServer || closedByClock;
  const msLeft = !closed && endAt ? endAt.getTime() - now : null;
  return {
    endAt,
    closed,
    msLeft,
    showCountdown: msLeft !== null && msLeft < COUNTDOWN_WINDOW_MS,
  };
}

/** „05:07:09" — ore:minute:secunde, fără zile (numărătoarea apare sub 24 h). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

/**
 * Starea vânzării, ținută la zi de un ceas. Ceasul bate la o secundă doar în
 * ultimele 24 h (când se vede numărătoarea); înainte, la un minut — destul ca
 * pragul de 24 h să fie prins. Fără dată de închidere nu pornește niciun ceas.
 */
export function useSalesState(fields: SalesFields): SalesState {
  const [now, setNow] = useState(() => Date.now());
  const state = computeSalesState(fields, now);
  const ticking = state.msLeft !== null;
  const fast = state.showCountdown;

  useEffect(() => {
    if (!ticking) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), fast ? 1000 : 60_000);
    return () => window.clearInterval(id);
  }, [ticking, fast]);

  return state;
}
