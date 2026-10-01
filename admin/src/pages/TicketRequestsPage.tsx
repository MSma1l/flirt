import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import {
  fetchTicketRequest,
  fetchTicketRequestProof,
  fetchTicketRequests,
  reviewTicketRequest,
} from '../api/admin';
import type {
  TicketRequest,
  TicketRequestFilters,
  TicketRequestReviewInput,
  TicketRequestStatus,
} from '../api/types';
import { Modal } from '../components/Modal';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Select,
  TextArea,
  TextInput,
  type BadgeTone,
} from '../components/ui';
import { useLanguage, useMessages, type Language } from '../i18n/LanguageContext';
import { ticketsMessages } from '../i18n/messages/tickets';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';

// Eticheta statusului vine din dicționar (`ticketsMessages.requests.status`).
const STATUS_TONE: Record<TicketRequestStatus, BadgeTone> = {
  pending_payment: 'neutral',
  payment_proof_submitted: 'accent',
  under_review: 'warning',
  approved: 'success',
  rejected: 'danger',
  additional_information_required: 'warning',
  cancelled: 'neutral',
};

const AMOUNT_LOCALE: Record<Language, string> = { ro: 'ro-MD', ru: 'ru-RU' };

function amount(value: number, language: Language): string {
  return new Intl.NumberFormat(AMOUNT_LOCALE[language], { maximumFractionDigits: 2 }).format(value);
}

function reviewable(status: TicketRequestStatus): boolean {
  return status === 'payment_proof_submitted' || status === 'under_review';
}

export function TicketRequestsPage(): JSX.Element {
  const m = useMessages(ticketsMessages).requests;
  const common = useMessages(ticketsMessages).common;
  const { language } = useLanguage();
  const client = useQueryClient();
  const [filters, setFilters] = useState<TicketRequestFilters>({ status: 'all' });
  const [selected, setSelected] = useState<TicketRequest | null>(null);

  const query = useQuery({
    queryKey: ['ticket-requests', filters],
    queryFn: () => fetchTicketRequests(filters),
    refetchInterval: 60_000,
  });
  const requests = query.data ?? [];
  const eventOptions = useMemo(
    () => Array.from(new Map(requests.map((request) => [request.event_id, { id: request.event_id, title: request.event_title }])).values()),
    [requests],
  );

  const setFilter = <K extends keyof TicketRequestFilters>(key: K, value: TicketRequestFilters[K]): void =>
    setFilters((current) => ({ ...current, [key]: value || undefined }));

  return (
    <Card title={m.title}>
      <p className="muted" style={{ marginTop: 0 }}>
        {m.intro}
      </p>
      <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
        <Field label={common.status} htmlFor="ticket-request-status">
          <Select
            id="ticket-request-status"
            value={filters.status ?? 'all'}
            onChange={(event) => setFilter('status', event.target.value as TicketRequestFilters['status'])}
          >
            <option value="all">{m.allStatuses}</option>
            {(Object.keys(STATUS_TONE) as TicketRequestStatus[]).map((value) => (
              <option key={value} value={value}>{m.status[value]}</option>
            ))}
          </Select>
        </Field>
        <Field label={common.event} htmlFor="ticket-request-event">
          <Select
            id="ticket-request-event"
            value={filters.event_id ?? ''}
            onChange={(event) => setFilter('event_id', event.target.value)}
          >
            <option value="">{m.allEvents}</option>
            {eventOptions.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
          </Select>
        </Field>
        <Field label={m.createdFrom} htmlFor="ticket-request-from">
          <TextInput id="ticket-request-from" type="date" value={filters.created_from ?? ''} onChange={(event) => setFilter('created_from', event.target.value)} />
        </Field>
        <Field label={m.createdTo} htmlFor="ticket-request-to">
          <TextInput id="ticket-request-to" type="date" value={filters.created_to ?? ''} onChange={(event) => setFilter('created_to', event.target.value)} />
        </Field>
      </div>

      {query.isPending ? <LoadingState label={m.loading} /> : null}
      {query.isError ? <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} /> : null}
      {!query.isPending && !query.isError && requests.length === 0 ? (
        <EmptyState title={m.emptyTitle} hint={m.emptyHint} />
      ) : null}
      {requests.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{m.colId}</th><th>{m.colClient}</th><th>{m.colPhone}</th><th>{common.event}</th><th>{m.colTickets}</th><th>{m.colTotal}</th><th>{common.created}</th><th>{common.status}</th><th>{m.colProof}</th><th aria-label={common.actions} /></tr></thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id}>
                  <td className="mono">{request.id.slice(0, 8)}</td>
                  <td><div>{request.full_name ?? '—'}</div><div className="muted">{request.email ?? '—'}</div></td>
                  <td className="mono">{request.phone ?? '—'}</td>
                  <td><div>{request.event_title}</div><div className="muted">{formatDateTime(request.event_starts_at)}</div></td>
                  <td>{request.ticket_quantity}</td>
                  <td className="mono">{amount(request.total_amount, language)}</td>
                  <td className="muted mono">{formatDateTime(request.created_at)}</td>
                  <td><Badge tone={STATUS_TONE[request.status]}>{m.status[request.status]}</Badge></td>
                  <td>{request.payment_proof_uploaded ? m.proofAvailable : <span className="muted">—</span>}</td>
                  <td><Button small onClick={() => setSelected(request)}>{m.open}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {selected ? (
        <TicketRequestDetail
          request={selected}
          onClose={() => setSelected(null)}
          onChanged={async () => {
            await client.invalidateQueries({ queryKey: ['ticket-requests'] });
            setSelected(null);
          }}
        />
      ) : null}
    </Card>
  );
}

function TicketRequestDetail({ request, onClose, onChanged }: { request: TicketRequest; onClose: () => void; onChanged: () => Promise<void> }): JSX.Element {
  const m = useMessages(ticketsMessages).requests;
  const common = useMessages(ticketsMessages).common;
  const { language } = useLanguage();
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [action, setAction] = useState<TicketRequestReviewInput['status'] | null>(null);
  const details = useQuery({ queryKey: ['ticket-request', request.id], queryFn: () => fetchTicketRequest(request.id) });
  const current = details.data ?? request;

  useEffect(() => {
    if (!current.payment_proof_uploaded) return;
    let url: string | null = null;
    void fetchTicketRequestProof(current.id)
      .then((blob) => { url = URL.createObjectURL(blob); setProofUrl(url); })
      .catch((error: unknown) => setProofError(errorMessage(error)));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [current.id, current.payment_proof_uploaded]);

  return (
    <Modal title={m.detailTitle(current.id.slice(0, 8))} wide onClose={onClose}>
      <div className="modal__body">
        {details.isPending ? <LoadingState label={m.loadingDetails} /> : null}
        {details.isError ? <ErrorState message={errorMessage(details.error)} /> : null}
        <div className="form-grid">
          <Detail label={m.colClient} value={`${current.full_name ?? '—'}${current.email ? ` · ${current.email}` : ''}`} />
          <Detail label={m.colPhone} value={current.phone ?? '—'} />
          <Detail label={common.event} value={`${current.event_title} · ${formatDateTime(current.event_starts_at)}`} />
          <Detail label={m.ticketsTotal} value={`${current.ticket_quantity} / ${amount(current.total_amount, language)}`} />
          <Detail label={m.transferDescription} value={current.payment_description} />
          <Detail label={m.clientMessage} value={current.client_message ?? '—'} />
          <Detail label={m.adminComment} value={current.admin_comment ?? '—'} />
        </div>
        {current.payment_proof_uploaded ? (
          <section aria-label={m.proofTitle}>
            <h3 className="card__title">{m.proofTitle}</h3>
            {proofError ? <div className="alert" role="alert">{proofError}</div> : null}
            {!proofUrl && !proofError ? <LoadingState label={m.loadingProof} /> : null}
            {proofUrl ? <img src={proofUrl} alt={m.proofAlt} style={{ display: 'block', maxWidth: '100%', maxHeight: 520, margin: '0 auto', borderRadius: 'var(--radius-input)' }} /> : null}
          </section>
        ) : <p className="muted">{m.noProof}</p>}
        {reviewable(current.status) ? (
          <div className="modal__actions">
            <Button onClick={() => setAction('under_review')}>{m.markUnderReview}</Button>
            <Button onClick={() => setAction('additional_information_required')}>{m.askInfo}</Button>
            <Button variant="danger" onClick={() => setAction('rejected')}>{m.refuse}</Button>
            <Button variant="primary" onClick={() => setAction('approved')}>{m.acceptPayment}</Button>
          </div>
        ) : null}
      </div>
      {action ? <ReviewModal request={current} status={action} onCancel={() => setAction(null)} onDone={onChanged} /> : null}
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: string }): JSX.Element { return <div><div className="muted">{label}</div><div>{value}</div></div>; }

function ReviewModal({ request, status, onCancel, onDone }: { request: TicketRequest; status: TicketRequestReviewInput['status']; onCancel: () => void; onDone: () => Promise<void> }): JSX.Element {
  const m = useMessages(ticketsMessages).requests;
  const common = useMessages(ticketsMessages).common;
  const [comment, setComment] = useState('');
  const mutation = useMutation({ mutationFn: () => reviewTicketRequest(request.id, { status, admin_comment: comment }), onSuccess: () => void onDone() });
  const label = status === 'approved' ? m.acceptPayment : status === 'rejected' ? m.refuseRequest : status === 'additional_information_required' ? m.requestInfo : m.markUnderReview;
  const submit = (event: FormEvent): void => { event.preventDefault(); if (!mutation.isPending) mutation.mutate(); };
  return <Modal title={label} onClose={onCancel}><form className="modal__body" onSubmit={submit}>
    <p style={{ margin: 0 }}>{status === 'approved' ? m.approveWarning : m.commentNotice}</p>
    <Field label={m.commentLabel} htmlFor="ticket-request-comment"><TextArea id="ticket-request-comment" value={comment} maxLength={500} onChange={(event) => setComment(event.target.value)} placeholder={status === 'rejected' ? m.refuseReasonPlaceholder : m.optionalComment} /></Field>
    {mutation.isError ? <div className="alert" role="alert">{errorMessage(mutation.error)}</div> : null}
    <div className="modal__actions"><Button variant="ghost" onClick={onCancel} disabled={mutation.isPending}>{common.cancel}</Button><Button type="submit" variant={status === 'rejected' ? 'danger' : 'primary'} disabled={mutation.isPending}>{mutation.isPending ? common.saving : label}</Button></div>
  </form></Modal>;
}
