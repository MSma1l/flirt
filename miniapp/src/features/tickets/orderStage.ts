/**
 * Logica pură a fluxului de bilet: în ce ETAPĂ e o comandă, ce mai are omul de
 * făcut, ce stare are biletul la intrare și cum se citește un refuz cu cod.
 *
 * Două fluxuri împart același tabel pe server (vezi `ticketsApi.ts`):
 *   cumpărare directă:  awaiting_payment → payment_declared → approved | rejected
 *   cerere cu dovadă:   pending_payment → payment_proof_submitted → under_review
 *                       → approved | rejected | additional_information_required
 *                       | cancelled
 * Ecranele nu se uită la stări, ci la etape — patru pași pe care omul îi
 * înțelege: Comandat → Plătit → Aprobat → Bilet.
 */
import { formatInEventZone } from '@/features/events/eventFormat';

import type { Ticket, TicketPassStatus } from './ticketsApi';

export type OrderStage = 'ordered' | 'review' | 'approved' | 'rejected' | 'cancelled';

export function orderStage(status: string): OrderStage {
  switch (status) {
    case 'payment_declared':
    case 'payment_proof_submitted':
    case 'under_review':
      return 'review';
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'rejected';
    case 'cancelled':
      return 'cancelled';
    default:
      // awaiting_payment, pending_payment, additional_information_required și
      // orice stare necunoscută: omul mai are ceva de făcut.
      return 'ordered';
  }
}

/** Ordinea de relevanță când un eveniment are mai multe comenzi. */
export const STAGE_RANK: Record<OrderStage, number> = {
  approved: 0,
  review: 1,
  ordered: 2,
  rejected: 3,
  cancelled: 4,
};

/** Stările care există DOAR în fluxul de cerere manuală (cu dovadă de plată). */
const REQUEST_ONLY = new Set([
  'pending_payment',
  'payment_proof_submitted',
  'under_review',
  'additional_information_required',
  'cancelled',
]);

export function isRequestOnlyStatus(status: string): boolean {
  return REQUEST_ONLY.has(status);
}

/** Pașii vizibili ai stepperului. */
export const STEPS = ['ordered', 'paid', 'approved', 'ticket'] as const;
export type StepKey = (typeof STEPS)[number];
export type StepState = 'done' | 'current' | 'upcoming' | 'failed';

/** Starea fiecărui pas pentru o etapă dată. */
export function stepStates(stage: OrderStage, hasCode: boolean): Record<StepKey, StepState> {
  switch (stage) {
    case 'ordered':
      return { ordered: 'done', paid: 'current', approved: 'upcoming', ticket: 'upcoming' };
    case 'review':
      return { ordered: 'done', paid: 'done', approved: 'current', ticket: 'upcoming' };
    case 'approved':
      return { ordered: 'done', paid: 'done', approved: 'done', ticket: hasCode ? 'done' : 'current' };
    case 'rejected':
      return { ordered: 'done', paid: 'done', approved: 'failed', ticket: 'upcoming' };
    case 'cancelled':
      return { ordered: 'failed', paid: 'upcoming', approved: 'upcoming', ticket: 'upcoming' };
  }
}

/**
 * Starea biletului la intrare. Pe un server vechi (fără `status`), cade pe
 * vechiul `used`: `valid` sau `used`.
 */
export function passStatusOf(ticket: Pick<Ticket, 'status' | 'used'>): TicketPassStatus {
  if (ticket.status) return ticket.status;
  return ticket.used ? 'used' : 'valid';
}

/** Ultimele 8 caractere, grupate 4 + 4: „ABCD EFGH" — codul de citit cu ochiul. */
export function shortTicketCode(code: string): string {
  const tail = code.slice(-8).toUpperCase();
  return tail.length > 4 ? `${tail.slice(0, 4)} ${tail.slice(4)}` : tail;
}

/**
 * Ora (fără dată) în limba interfeței, pe ora Chișinăului — ca ora intrării să
 * se potrivească cu ora evenimentului de pe același bilet. Un șir nevalid se
 * întoarce gol.
 */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return formatInEventZone(date, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/**
 * Evenimentul a început (după ceasul local)? De atunci serverul refuză orice
 * pas de plată pe o comandă (`409 event_started`), deci ecranul nu mai cere
 * nimic — spune doar că biletul se cumpără la intrare. Un șir nevalid sau lipsă
 * → `false`: mai bine lăsăm serverul să decidă decât să blocăm pe ghicite.
 */
export function hasEventStarted(startsAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!startsAt) return false;
  const time = new Date(startsAt).getTime();
  return Number.isFinite(time) && now >= time;
}

/**
 * Tonul vizual al unei comenzi (culoare + text, niciodată doar culoare):
 *   action — omul are ceva de făcut (plată, chitanță);
 *   review — așteaptă verificarea noastră;
 *   ok     — biletul e bun de folosit (sau tocmai a fost folosit la intrare);
 *   muted  — s-a terminat firesc (folosit, expirat, plata online închisă);
 *   danger — refuz sau anulare.
 */
export type OrderTone = 'action' | 'review' | 'ok' | 'muted' | 'danger';

/**
 * Starea unei comenzi spusă omului: o etichetă scurtă și pasul următor, ambele
 * chei din `screens:tickets.status.*` / `screens:tickets.next.*`.
 */
export type OrderStatusKey =
  | 'awaiting'
  | 'moreInfo'
  | 'review'
  | 'ready'
  | 'generating'
  | 'admitted'
  | 'used'
  | 'expired'
  | 'ticketCancelled'
  | 'rejected'
  | 'cancelled'
  | 'closed'
  | 'unknown';

export interface OrderSummary {
  key: OrderStatusKey;
  tone: OrderTone;
}

const KNOWN_ORDER_STATUSES = new Set([
  'awaiting_payment',
  'payment_declared',
  'approved',
  'rejected',
  'pending_payment',
  'payment_proof_submitted',
  'under_review',
  'additional_information_required',
  'cancelled',
]);

/**
 * „În ce stare e comanda mea și ce fac acum?" — dintr-o singură privire.
 *
 * Pentru o comandă aprobată contează starea BILETULUI (valid / admis / folosit
 * / expirat / anulat), nu doar a plății. O comandă încă neplătită la un
 * eveniment deja început nu mai are pași online (`closed`).
 */
export function summarizeOrder(
  order: { status: string; ticketStatus?: TicketPassStatus | null; ticketCode?: string | null },
  eventStarted = false,
): OrderSummary {
  if (!KNOWN_ORDER_STATUSES.has(order.status)) return { key: 'unknown', tone: 'review' };
  const stage = orderStage(order.status);
  switch (stage) {
    case 'ordered':
      if (eventStarted) return { key: 'closed', tone: 'muted' };
      return order.status === 'additional_information_required'
        ? { key: 'moreInfo', tone: 'action' }
        : { key: 'awaiting', tone: 'action' };
    case 'review':
      return { key: 'review', tone: 'review' };
    case 'approved':
      if (!order.ticketCode) return { key: 'generating', tone: 'ok' };
      switch (order.ticketStatus) {
        case 'admitted':
          return { key: 'admitted', tone: 'ok' };
        case 'used':
          return { key: 'used', tone: 'muted' };
        case 'expired':
          return { key: 'expired', tone: 'muted' };
        case 'cancelled':
          return { key: 'ticketCancelled', tone: 'danger' };
        default:
          return { key: 'ready', tone: 'ok' };
      }
    case 'rejected':
      return { key: 'rejected', tone: 'danger' };
    case 'cancelled':
      return { key: 'cancelled', tone: 'danger' };
  }
}

/**
 * Codul stabil al unui refuz de la API (`app/core/errors.py`): `{detail, code}`
 * la rădăcină. Acceptăm și `detail.code`, forma FastAPI cu `detail` obiect.
 */
export function apiErrorCode(error: unknown): { status?: number; code?: string } {
  const response = (error as { response?: { status?: number; data?: unknown } })?.response;
  const body = response?.data as { code?: unknown; detail?: unknown } | undefined;
  let code: string | undefined = typeof body?.code === 'string' ? body.code : undefined;
  if (!code && body?.detail && typeof body.detail === 'object') {
    const nested = (body.detail as { code?: unknown }).code;
    if (typeof nested === 'string') code = nested;
  }
  return { status: response?.status, code };
}

/**
 * Codul trimis când vânzarea online s-a închis: 409 după ora de închidere, 400
 * dacă evenimentul a și început. Se decide DOAR după cod, nu după status.
 */
export const TICKET_SALES_CLOSED = 'ticket_sales_closed';

/** Codul trimis (409) la dovadă / declarare după începerea evenimentului. */
export const EVENT_STARTED = 'event_started';

export function isTicketSalesClosedError(error: unknown): boolean {
  return apiErrorCode(error).code === TICKET_SALES_CLOSED;
}

export function isEventStartedError(error: unknown): boolean {
  return apiErrorCode(error).code === EVENT_STARTED;
}

/**
 * Refuzul „nu mai sunt bilete" la crearea unei comenzi / cereri: 409 FĂRĂ cod
 * (singurul 409 necodat al rutelor de creare — închiderea vânzării vine cu
 * `ticket_sales_closed`). Când serverul îi va da un cod stabil, se citește
 * și acela.
 */
export const TICKETS_SOLD_OUT = 'tickets_sold_out';

export function isSoldOutError(error: unknown): boolean {
  const { status, code } = apiErrorCode(error);
  return code === TICKETS_SOLD_OUT || (status === 409 && code === undefined);
}
