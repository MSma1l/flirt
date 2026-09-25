import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { formatEventDate } from '@/features/events/eventFormat';
import { fetchEvent, type EventItem } from '@/features/events/eventsApi';

import { fetchMyTicketRequests, createTicketRequest, uploadPaymentProof, validatePaymentProof, type TicketRequest, type TicketRequestStatus } from './ticketRequestsApi';

import './ticketRequests.css';

const labels: Record<TicketRequestStatus, string> = {
  pending_payment: 'În așteptarea plății', payment_proof_submitted: 'Dovadă trimisă / În verificare', under_review: 'În verificare', approved: 'Acceptată', rejected: 'Refuzată', additional_information_required: 'Necesită informații suplimentare', cancelled: 'Anulată',
};

function money(value: number, currency?: string | null) { return `${value.toFixed(2)} ${currency ?? 'lei'}`; }

function RequestSummary({ request }: { request: TicketRequest }) {
  const [file, setFile] = useState<File>();
  const [fileError, setFileError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const mutation = useMutation({ mutationFn: () => uploadPaymentProof(request.id, file!), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['ticket-requests'] }) });
  const needsProof = request.status === 'pending_payment' || (request.status === 'rejected' && request.can_resubmit_proof) || request.status === 'additional_information_required';
  const selectFile = (next?: File) => { const error = validatePaymentProof(next); setFileError(error); setFile(error ? undefined : next); };
  return <article className="tr-card" data-testid={`ticket-request-${request.id}`}>
    <div className="tr-card__heading"><strong>{request.event_title}</strong><span className={`tr-status tr-status--${request.status}`}>{labels[request.status]}</span></div>
    <p className="caption">{formatEventDate(request.event_starts_at)} · {request.ticket_quantity} bilete · {money(request.total_amount, request.currency)}</p>
    {request.status === 'approved' ? <p className="tr-success">Plata a fost confirmată. Cererea ta pentru bilet a fost acceptată.</p> : null}
    {request.admin_comment ? <p className="tr-comment"><strong>Mesaj administrator:</strong> {request.admin_comment}</p> : null}
    {request.payment && request.status === 'pending_payment' ? <section className="tr-payment" aria-label="Instrucțiuni de plată">
      <h2 className="tr-payment__title">Instrucțiuni de plată</h2>
      <p>Achită exact <strong>{money(request.total_amount, request.currency)}</strong> prin transfer manual.</p>
      {request.payment.phone ? <p><strong>Telefon transfer:</strong> <span className="tr-selectable">{request.payment.phone}</span></p> : null}
      {request.payment.account_details ? <p><strong>Cont / card:</strong> <span className="tr-selectable">{request.payment.account_details}</span></p> : null}
      <p><strong>Descriere obligatorie:</strong> <span className="tr-selectable">{request.payment.payment_description}</span></p>
      {request.payment.instructions ? <p>{request.payment.instructions}</p> : null}
    </section> : null}
    {needsProof ? <div className="tr-proof">
      <label className="field__label" htmlFor={`proof-${request.id}`}>Dovada plății</label>
      <input id={`proof-${request.id}`} className="input" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={(e) => selectFile(e.currentTarget.files?.[0])} />
      <p className="field__hint">JPG, JPEG, PNG sau WEBP · maximum 8 MB.</p>
      {fileError ? <p className="field__error" role="alert">{fileError}</p> : null}
      {mutation.isError ? <p className="field__error" role="alert">Nu am putut încărca dovada. Încearcă din nou.</p> : null}
      <button type="button" className="button" disabled={!file || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? 'Se încarcă…' : 'Trimite dovada plății'}</button>
    </div> : null}
  </article>;
}

export function TicketRequestScreen() {
  const eventId = useParams().eventId ?? '';
  const navigate = useNavigate();
  const client = useQueryClient();
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', ticketQuantity: '1', clientMessage: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { data: event, isPending: eventPending, isError: eventError } = useQuery<EventItem>({ queryKey: ['event', eventId], queryFn: () => fetchEvent(eventId), enabled: Boolean(eventId) });
  const { data: requests, isPending: requestsPending, isError: requestsError, refetch } = useQuery({ queryKey: ['ticket-requests'], queryFn: fetchMyTicketRequests });
  const ownForEvent = useMemo(() => (requests ?? []).filter((r) => r.event_id === eventId), [eventId, requests]);
  const create = useMutation({ mutationFn: () => createTicketRequest(eventId, { ...form, ticketQuantity: Number(form.ticketQuantity) }), onSuccess: () => { void client.invalidateQueries({ queryKey: ['ticket-requests'] }); } });
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (e: React.FormEvent) => { e.preventDefault(); const next: Record<string, string> = {}; if (form.fullName.trim().length < 2) next.fullName = 'Introdu numele complet.'; if (form.phone.trim().length < 6) next.phone = 'Introdu un număr de telefon valid.'; if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) next.email = 'Emailul nu este valid.'; const quantity = Number(form.ticketQuantity); if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) next.ticketQuantity = 'Alege între 1 și 20 de bilete.'; setErrors(next); if (!Object.keys(next).length) create.mutate(); };
  if (eventPending || requestsPending) return <div className="tr-state"><div className="spinner" role="status" aria-label="Se încarcă" /></div>;
  if (eventError || !event) return <div className="tr-state"><p className="error-text">Nu am putut încărca evenimentul.</p><button type="button" className="button" onClick={() => void navigate(-1)}>Înapoi</button></div>;
  if (requestsError) return <div className="tr-state"><p className="error-text">Nu am putut încărca cererile tale.</p><button type="button" className="button" onClick={() => void refetch()}>Reîncearcă</button></div>;
  const quantity = Number(form.ticketQuantity) || 0;
  const displayedRequests = ownForEvent.length > 0 ? ownForEvent : create.data ? [create.data] : [];
  return <div className="tr-screen"><h1 className="title">Cerere de procurare bilet</h1>
    {displayedRequests.map((request) => <RequestSummary key={request.id} request={request} />)}
    {displayedRequests.length > 0 ? null : <form className="form tr-form" noValidate onSubmit={submit}>
      <section className="tr-card"><h2 className="tr-card__title">{event.title}</h2><p>{formatEventDate(event.startsAt)}</p><p>{event.venue} · {event.city}</p><dl className="tr-totals"><dt>Preț pe bilet</dt><dd>{money(event.ticketPrice ?? 0, event.ticketCurrency)}</dd><dt>Număr de bilete</dt><dd>{quantity}</dd><dt>Total de achitat</dt><dd>{money((event.ticketPrice ?? 0) * quantity, event.ticketCurrency)}</dd></dl></section>
      <label className="field"><span className="field__label">Nume complet <span className="field__required">*</span></span><input className="input" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} aria-invalid={Boolean(errors.fullName)} />{errors.fullName ? <span className="field__error">{errors.fullName}</span> : null}</label>
      <label className="field"><span className="field__label">Telefon <span className="field__required">*</span></span><input className="input" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} aria-invalid={Boolean(errors.phone)} />{errors.phone ? <span className="field__error">{errors.phone}</span> : null}</label>
      <label className="field"><span className="field__label">Email (opțional)</span><input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} aria-invalid={Boolean(errors.email)} />{errors.email ? <span className="field__error">{errors.email}</span> : null}</label>
      <label className="field"><span className="field__label">Număr de bilete <span className="field__required">*</span></span><input className="input" type="number" min="1" max="20" inputMode="numeric" value={form.ticketQuantity} onChange={(e) => set('ticketQuantity', e.target.value)} aria-invalid={Boolean(errors.ticketQuantity)} />{errors.ticketQuantity ? <span className="field__error">{errors.ticketQuantity}</span> : null}</label>
      <label className="field"><span className="field__label">Mesaj / comentariu (opțional)</span><textarea className="input input--multiline" maxLength={500} value={form.clientMessage} onChange={(e) => set('clientMessage', e.target.value)} /></label>
      {create.isError ? <p className="error-text" role="alert">Nu am putut trimite cererea. Verifică datele și încearcă din nou.</p> : null}<button className="button" type="submit" disabled={create.isPending}>{create.isPending ? 'Se trimite…' : 'Trimite cererea'}</button>
    </form>}
  </div>;
}
