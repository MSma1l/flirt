import { api } from '@/api/client';

export const PAYMENT_PROOF_MAX_BYTES = 8 * 1024 * 1024;
export const PAYMENT_PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type TicketRequestStatus =
  | 'pending_payment'
  | 'payment_proof_submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'additional_information_required'
  | 'cancelled';

export interface PaymentDetails {
  phone?: string | null;
  account_details?: string | null;
  instructions?: string | null;
  payment_description: string;
}

export interface TicketRequest {
  id: string;
  event_id: string;
  event_title: string;
  event_starts_at: string;
  event_venue?: string | null;
  ticket_quantity: number;
  ticket_price: number;
  total_amount: number;
  currency?: string | null;
  full_name: string;
  phone: string;
  email?: string | null;
  status: TicketRequestStatus;
  payment_proof_url?: string | null;
  payment?: PaymentDetails | null;
  client_message?: string | null;
  admin_comment?: string | null;
  can_resubmit_proof?: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateTicketRequestInput {
  fullName: string;
  phone: string;
  email?: string;
  ticketQuantity: number;
  clientMessage?: string;
}

function fromApi(value: Record<string, unknown>): TicketRequest {
  const payment = value.payment as Record<string, unknown> | null | undefined;
  const paymentDescription = String(value.payment_description ?? value.paymentDescription ?? payment?.comment_template ?? '');
  return {
    ...(value as unknown as TicketRequest),
    event_id: String(value.event_id ?? value.eventId ?? ''),
    event_title: String(value.event_title ?? value.eventTitle ?? ''),
    event_starts_at: String(value.event_starts_at ?? value.eventStartsAt ?? ''),
    ticket_quantity: Number(value.ticket_quantity ?? value.ticketQuantity ?? 0),
    ticket_price: Number(value.ticket_price ?? value.ticketPrice ?? 0),
    total_amount: Number(value.total_amount ?? value.totalAmount ?? 0),
    payment_proof_url: (value.payment_proof_url ?? value.paymentProofUrl ?? null) as string | null,
    admin_comment: (value.admin_comment ?? value.adminComment ?? null) as string | null,
    can_resubmit_proof: Boolean(value.can_resubmit_proof ?? value.canResubmitProof ?? value.status === 'rejected'),
    payment: payment ? {
      phone: (payment.phone ?? null) as string | null,
      account_details: (payment.account_details ?? payment.accountDetails ?? ([payment.beneficiary, payment.iban].filter(Boolean).join(' · ') || null)) as string | null,
      instructions: (payment.instructions ?? null) as string | null,
      payment_description: paymentDescription,
    } : paymentDescription ? { payment_description: paymentDescription } : null,
    created_at: String(value.created_at ?? value.createdAt ?? ''),
    updated_at: String(value.updated_at ?? value.updatedAt ?? ''),
  };
}

export async function createTicketRequest(eventId: string, input: CreateTicketRequestInput): Promise<TicketRequest> {
  const { data } = await api.post<Record<string, unknown>>(`/events/${encodeURIComponent(eventId)}/ticket-requests`, {
    full_name: input.fullName.trim(),
    phone: input.phone.trim(),
    email: input.email?.trim() || null,
    ticket_quantity: input.ticketQuantity,
    client_message: input.clientMessage?.trim() || null,
  });
  // Contractul de creare învelește cererea, ca instrucțiunile să nu devină parte
  // din lista istorică; ecranul are însă nevoie de ambele imediat după trimitere.
  const payload = data as { request?: Record<string, unknown>; payment?: Record<string, unknown> };
  return fromApi({ ...(payload.request ?? data), payment: payload.payment });
}

export async function fetchMyTicketRequests(): Promise<TicketRequest[]> {
  const { data } = await api.get<Record<string, unknown>[]>('/ticket-requests/mine');
  return (data ?? []).map(fromApi);
}

export async function uploadPaymentProof(requestId: string, file: File): Promise<TicketRequest> {
  const form = new FormData();
  form.append('file', file, file.name);
  const { data } = await api.post<Record<string, unknown>>(
    `/ticket-requests/${encodeURIComponent(requestId)}/payment-proof`, form,
  );
  return fromApi(data);
}

export function validatePaymentProof(file: File | undefined): string | null {
  if (!file) return 'Alege dovada plății.';
  if (!PAYMENT_PROOF_TYPES.includes(file.type as (typeof PAYMENT_PROOF_TYPES)[number])) {
    return 'Acceptăm doar imagini JPG, JPEG, PNG sau WEBP.';
  }
  if (file.size > PAYMENT_PROOF_MAX_BYTES) return 'Fișierul depășește limita de 8 MB.';
  return null;
}
