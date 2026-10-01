/**
 * Modelul unei comenzi de bilet (tipuri + mapare snake_case → camelCase) și
 * lista „comenzile mele". Separat de `ticketsApi.ts` ca și pagina evenimentului
 * să citească EXACT aceeași formă sub aceeași cheie de cache (`['ticket-orders']`)
 * — două mapări diferite sub aceeași cheie și-ar strica reciproc datele.
 *
 * Mapperul mobil aruncă `event_title`, `admin_note`, `created_at` și nu
 * cunoaște stările cererilor manuale, care stau în ACELAȘI tabel.
 */
import { api } from '@/api/client';

/**
 * Toate stările unei comenzi, din ambele fluxuri care împart tabelul:
 * cumpărarea directă (`awaiting_payment` → `payment_declared`) și cererea
 * manuală cu dovadă (`pending_payment` → `payment_proof_submitted` → …).
 */
export type TicketOrderStatus =
  | 'awaiting_payment'
  | 'payment_declared'
  | 'approved'
  | 'rejected'
  | 'pending_payment'
  | 'payment_proof_submitted'
  | 'under_review'
  | 'additional_information_required'
  | 'cancelled';

/** Starea biletului la intrare (contractul scanerului). */
export type TicketPassStatus = 'valid' | 'admitted' | 'used' | 'expired' | 'cancelled';

const PASS_STATUSES: readonly TicketPassStatus[] = [
  'valid',
  'admitted',
  'used',
  'expired',
  'cancelled',
];

/** `null` pentru orice valoare necunoscută — inclusiv lipsa câmpului. */
export function parsePassStatus(value: unknown): TicketPassStatus | null {
  return typeof value === 'string' && (PASS_STATUSES as readonly string[]).includes(value)
    ? (value as TicketPassStatus)
    : null;
}

/** Biletul propriu Flirt Party. */
export interface Ticket {
  code: string;
  used: boolean;
  /** Lipsește pe serverele vechi → se folosește `used`. */
  status?: TicketPassStatus | null;
  admittedAt?: string | null;
}

/** O comandă de bilet. Câmpurile opționale lipsesc pe serverele vechi. */
export interface TicketOrder {
  id: string;
  eventId: string | null;
  status: TicketOrderStatus;
  price: number | null;
  currency: string | null;
  /** Prezent doar pe comenzile `approved`. */
  ticketCode: string | null;
  /** Motivul refuzului / mesajul adminului. */
  adminNote?: string | null;
  /** Starea biletului la intrare, dacă serverul o trimite pe comandă. */
  ticketStatus?: TicketPassStatus | null;
  admittedAt?: string | null;
  /** Chitanța a fost încărcată (lipsește pe serverele vechi). */
  paymentProofUploaded?: boolean;
}

/** O comandă din listă, cu evenimentul alăturat. */
export interface TicketOrderListItem extends TicketOrder {
  eventTitle: string;
  eventStartsAt: string;
  /** Referința userului (`U-XXXXXXXX`). */
  reference: string;
  createdAt: string;
}

type Raw = Record<string, unknown>;

export const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Starea biletului de pe o comandă. Contractul spune doar „orice ieșire care
 * poartă biletul"; acceptăm ambele forme plauzibile — `ticket_status` plat sau
 * un obiect `ticket` imbricat. `status` de pe comandă NU e starea biletului.
 */
function orderTicketFields(o: Raw): Pick<TicketOrder, 'ticketStatus' | 'admittedAt'> {
  const nested = (o.ticket && typeof o.ticket === 'object' ? o.ticket : {}) as Raw;
  return {
    ticketStatus: parsePassStatus(o.ticket_status) ?? parsePassStatus(nested.status),
    admittedAt: str(o.admitted_at) ?? str(nested.admitted_at),
  };
}

export function mapOrder(o: Raw): TicketOrder {
  return {
    id: String(o.id ?? ''),
    eventId: str(o.event_id),
    status: String(o.status ?? '') as TicketOrderStatus,
    price: num(o.price),
    currency: str(o.currency),
    ticketCode: str(o.ticket_code),
    adminNote: str(o.admin_note),
    paymentProofUploaded: o.payment_proof_uploaded === true,
    ...orderTicketFields(o),
  };
}

export function mapListItem(o: Raw): TicketOrderListItem {
  return {
    ...mapOrder(o),
    eventTitle: String(o.event_title ?? ''),
    eventStartsAt: String(o.event_starts_at ?? ''),
    reference: String(o.reference ?? ''),
    createdAt: String(o.created_at ?? ''),
  };
}

/** Comenzile utilizatorului (cea mai recentă prima — ordinea o dă backendul). */
export async function fetchMyTicketOrdersWithEvent(): Promise<TicketOrderListItem[]> {
  const { data } = await api.get<Raw[]>('/ticket-orders/mine');
  return (data ?? []).map(mapListItem);
}

