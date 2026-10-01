import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import { formatEventDate } from '@/features/events/eventFormat';
import { fetchEvent, type EventItem } from '@/features/events/eventsApi';

import { fetchMyTicketRequests, createTicketRequest, PAYMENT_PROOF_MAX_LABEL, uploadPaymentProof, validatePaymentProof, type TicketRequest } from './ticketRequestsApi';

import './ticketRequests.css';

/** Limitele cantității de bilete acceptate de formular. */
const MIN_TICKETS = 1;
const MAX_TICKETS = 20;

function money(value: number, currency?: string | null) { return `${value.toFixed(2)} ${currency ?? 'lei'}`; }

function RequestSummary({ request }: { request: TicketRequest }) {
  const { t } = useTranslation('screens');
  const [file, setFile] = useState<File>();
  const [fileError, setFileError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const mutation = useMutation({ mutationFn: () => uploadPaymentProof(request.id, file!), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['ticket-requests'] }) });
  const needsProof = request.status === 'pending_payment' || (request.status === 'rejected' && request.can_resubmit_proof) || request.status === 'additional_information_required';
  const selectFile = (next?: File) => { const error = validatePaymentProof(next); setFileError(error); setFile(error ? undefined : next); };
  return <article className="tr-card" data-testid={`ticket-request-${request.id}`}>
    <div className="tr-card__heading"><strong>{request.event_title}</strong><span className={`tr-status tr-status--${request.status}`}>{t(`ticketRequests.status.${request.status}`)}</span></div>
    <p className="caption">{formatEventDate(request.event_starts_at)} · {t('ticketRequests.ticketsCount', { count: request.ticket_quantity })} · {money(request.total_amount, request.currency)}</p>
    {request.status === 'approved' ? <p className="tr-success">{t('ticketRequests.approvedNote')}</p> : null}
    {request.admin_comment ? <p className="tr-comment"><strong>{t('ticketRequests.adminMessage')}</strong> {request.admin_comment}</p> : null}
    {request.payment && request.status === 'pending_payment' ? <section className="tr-payment" aria-label={t('ticketRequests.payment.title')}>
      <h2 className="tr-payment__title">{t('ticketRequests.payment.title')}</h2>
      <p><Trans t={t} i18nKey="ticketRequests.payment.payExact" values={{ amount: money(request.total_amount, request.currency) }} components={{ b: <strong /> }} /></p>
      {request.payment.phone ? <p><strong>{t('ticketRequests.payment.phone')}</strong> <span className="tr-selectable">{request.payment.phone}</span></p> : null}
      {request.payment.account_details ? <p><strong>{t('ticketRequests.payment.account')}</strong> <span className="tr-selectable">{request.payment.account_details}</span></p> : null}
      <p><strong>{t('ticketRequests.payment.description')}</strong> <span className="tr-selectable">{request.payment.payment_description}</span></p>
      {request.payment.instructions ? <p>{request.payment.instructions}</p> : null}
    </section> : null}
    {needsProof ? <div className="tr-proof">
      <label className="field__label" htmlFor={`proof-${request.id}`}>{t('ticketRequests.proof.label')}</label>
      <input id={`proof-${request.id}`} className="input" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={(e) => selectFile(e.currentTarget.files?.[0])} />
      <p className="field__hint">{t('ticketRequests.proof.hint', { limit: PAYMENT_PROOF_MAX_LABEL })}</p>
      {fileError ? <p className="field__error" role="alert">{fileError}</p> : null}
      {mutation.isError ? <p className="field__error" role="alert">{t('ticketRequests.proof.uploadFailed')}</p> : null}
      <button type="button" className="button" disabled={!file || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? t('ticketRequests.proof.uploading') : t('ticketRequests.proof.submit')}</button>
    </div> : null}
  </article>;
}

export function TicketRequestScreen() {
  const eventId = useParams().eventId ?? '';
  const navigate = useNavigate();
  const { t } = useTranslation('screens');
  const client = useQueryClient();
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', ticketQuantity: '1', clientMessage: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { data: event, isPending: eventPending, isError: eventError } = useQuery<EventItem>({ queryKey: ['event', eventId], queryFn: () => fetchEvent(eventId), enabled: Boolean(eventId) });
  const { data: requests, isPending: requestsPending, isError: requestsError, refetch } = useQuery({ queryKey: ['ticket-requests'], queryFn: fetchMyTicketRequests });
  const ownForEvent = useMemo(() => (requests ?? []).filter((r) => r.event_id === eventId), [eventId, requests]);
  const create = useMutation({ mutationFn: () => createTicketRequest(eventId, { ...form, ticketQuantity: Number(form.ticketQuantity) }), onSuccess: () => { void client.invalidateQueries({ queryKey: ['ticket-requests'] }); } });
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (e: React.FormEvent) => { e.preventDefault(); const next: Record<string, string> = {}; if (form.fullName.trim().length < 2) next.fullName = t('ticketRequests.errors.fullName'); if (form.phone.trim().length < 6) next.phone = t('ticketRequests.errors.phone'); if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) next.email = t('ticketRequests.errors.email'); const quantity = Number(form.ticketQuantity); if (!Number.isInteger(quantity) || quantity < MIN_TICKETS || quantity > MAX_TICKETS) next.ticketQuantity = t('ticketRequests.errors.quantity', { min: MIN_TICKETS, max: MAX_TICKETS }); setErrors(next); if (!Object.keys(next).length) create.mutate(); };
  if (eventPending || requestsPending) return <div className="tr-state"><div className="spinner" role="status" aria-label={t('ticketRequests.loading')} /></div>;
  if (eventError || !event) return <div className="tr-state"><p className="error-text">{t('ticketRequests.eventLoadError')}</p><button type="button" className="button" onClick={() => void navigate(-1)}>{t('common:actions.back')}</button></div>;
  if (requestsError) return <div className="tr-state"><p className="error-text">{t('ticketRequests.requestsLoadError')}</p><button type="button" className="button" onClick={() => void refetch()}>{t('common:actions.retry')}</button></div>;
  const quantity = Number(form.ticketQuantity) || 0;
  const displayedRequests = ownForEvent.length > 0 ? ownForEvent : create.data ? [create.data] : [];
  return <div className="tr-screen"><h1 className="title">{t('ticketRequests.title')}</h1>
    {displayedRequests.map((request) => <RequestSummary key={request.id} request={request} />)}
    {displayedRequests.length > 0 ? null : <form className="form tr-form" noValidate onSubmit={submit}>
      <section className="tr-card"><h2 className="tr-card__title">{event.title}</h2><p>{formatEventDate(event.startsAt)}</p><p>{event.venue} · {event.city}</p><dl className="tr-totals"><dt>{t('ticketRequests.form.pricePerTicket')}</dt><dd>{money(event.ticketPrice ?? 0, event.ticketCurrency)}</dd><dt>{t('ticketRequests.form.quantity')}</dt><dd>{quantity}</dd><dt>{t('ticketRequests.form.total')}</dt><dd>{money((event.ticketPrice ?? 0) * quantity, event.ticketCurrency)}</dd></dl></section>
      <label className="field"><span className="field__label">{t('ticketRequests.form.fullName')} <span className="field__required">*</span></span><input className="input" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} aria-invalid={Boolean(errors.fullName)} />{errors.fullName ? <span className="field__error">{errors.fullName}</span> : null}</label>
      <label className="field"><span className="field__label">{t('ticketRequests.form.phone')} <span className="field__required">*</span></span><input className="input" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} aria-invalid={Boolean(errors.phone)} />{errors.phone ? <span className="field__error">{errors.phone}</span> : null}</label>
      <label className="field"><span className="field__label">{t('ticketRequests.form.emailOptional')}</span><input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} aria-invalid={Boolean(errors.email)} />{errors.email ? <span className="field__error">{errors.email}</span> : null}</label>
      <label className="field"><span className="field__label">{t('ticketRequests.form.quantity')} <span className="field__required">*</span></span><input className="input" type="number" min={MIN_TICKETS} max={MAX_TICKETS} inputMode="numeric" value={form.ticketQuantity} onChange={(e) => set('ticketQuantity', e.target.value)} aria-invalid={Boolean(errors.ticketQuantity)} />{errors.ticketQuantity ? <span className="field__error">{errors.ticketQuantity}</span> : null}</label>
      <label className="field"><span className="field__label">{t('ticketRequests.form.messageOptional')}</span><textarea className="input input--multiline" maxLength={500} value={form.clientMessage} onChange={(e) => set('clientMessage', e.target.value)} /></label>
      {create.isError ? <p className="error-text" role="alert">{t('ticketRequests.form.submitFailed')}</p> : null}<button className="button" type="submit" disabled={create.isPending}>{create.isPending ? t('ticketRequests.form.submitting') : t('ticketRequests.form.submit')}</button>
    </form>}
  </div>;
}
