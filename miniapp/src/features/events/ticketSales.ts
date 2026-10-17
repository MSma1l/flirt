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
 *
 * EPUIZAT vs ÎNCHIS: serverul pune `ticket_sales_open = false` și când s-a
 * atins capacitatea (`Event.ticket_sales_open()`). Dacă spune „închis" deși ora
 * de închidere e încă în viitor, singurul motiv posibil e sold-out-ul — iar
 * omului îi spunem asta, nu „vânzarea s-a închis".
 *
 * PAUZĂ GLOBALĂ (`ticket_sales_paused`, opțional): adminul poate opri vânzarea
 * online pentru toate evenimentele. Serverul trimite atunci `ticket_sales_open =
 * false` + `ticket_sales_paused = true` — deci „închis" fără ca ora să fi trecut,
 * exact semnătura sold-out-ului. Pauza câștigă: altfel i-am spune omului că
 * biletele s-au epuizat. Un server vechi nu trimite câmpul → nu e pauză.
 *
 * MOTIVUL BLOCĂRII (`SalesBlock`) e singurul lucru pe care ecranele îl citesc ca
 * să aleagă mesajul: `paused` / `soldOut` / `closed`. Refuzurile serverului (409
 * la creare) se traduc în același model prin `salesRefusal`, iar `salesNotice`
 * dă titlul și textul — niciun ecran nu-și compune singur mesajele.
 */
import { useEffect, useState } from 'react';

import {
  isOnlineSalesDisabledError,
  isSoldOutError,
  isTicketSalesClosedError,
} from '@/features/tickets/orderStage';

const HOUR = 60 * 60 * 1000;
export const COUNTDOWN_WINDOW_MS = 24 * HOUR;

export interface SalesFields {
  ticketSalesEndAt?: string | null;
  ticketSalesOpen?: boolean | null;
  /** Vânzarea online e oprită global de admin (server nou; lipsă = nu). */
  ticketSalesPaused?: boolean | null;
}

/** De ce nu se poate cumpăra acum online: pauză, epuizat sau închis. */
export type SalesBlock = 'paused' | 'soldOut' | 'closed';

export interface SalesState {
  /** Momentul închiderii, dacă serverul l-a anunțat și e o dată validă. */
  endAt: Date | null;
  closed: boolean;
  /** Închis pentru că s-au terminat biletele (nu pentru că a trecut ora). */
  soldOut: boolean;
  /** Vânzarea online e oprită temporar (comutatorul global al adminului). */
  paused: boolean;
  /** Motivul blocării, sau `null` cât timp se poate cumpăra. */
  block: SalesBlock | null;
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
  // Ora a trecut → vânzarea s-a încheiat oricum; pauza nu mai e informație.
  const paused = fields.ticketSalesPaused === true && !closedByClock;
  const closed = closedByServer || closedByClock || paused;
  const soldOut = !paused && closedByServer && !closedByClock && endAt !== null;
  const msLeft = !closed && endAt ? endAt.getTime() - now : null;
  return {
    endAt,
    closed,
    soldOut,
    paused,
    block: paused ? 'paused' : soldOut ? 'soldOut' : closed ? 'closed' : null,
    msLeft,
    showCountdown: msLeft !== null && msLeft < COUNTDOWN_WINDOW_MS,
  };
}

/**
 * Refuzul serverului la crearea unei comenzi / cereri, în modelul de mai sus.
 * `null` = altă eroare (rețea, validare) — ecranul arată mesajul generic.
 */
export function salesRefusal(error: unknown): SalesBlock | null {
  if (isOnlineSalesDisabledError(error)) return 'paused';
  if (isTicketSalesClosedError(error)) return 'closed';
  if (isSoldOutError(error)) return 'soldOut';
  return null;
}

/** Cheile de traducere (namespace `screens`) ale mesajului pentru o blocare. */
export interface SalesNotice {
  title: string;
  body: string;
}

/**
 * Mesajul pentru o blocare. `refused` = serverul tocmai a refuzat comanda:
 * pentru „închis" spunem atunci că s-a închis ACUM, nu că e închis demult.
 */
export function salesNotice(block: SalesBlock, refused = false): SalesNotice {
  switch (block) {
    case 'paused':
      return { title: 'screens:events.sales.pausedTitle', body: 'screens:events.sales.pausedBody' };
    case 'soldOut':
      return { title: 'screens:events.sales.soldOutTitle', body: 'screens:events.sales.soldOutBody' };
    case 'closed':
      return {
        title: 'screens:events.sales.closedTitle',
        body: refused ? 'screens:events.sales.closedError' : 'screens:events.sales.closedBody',
      };
  }
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
