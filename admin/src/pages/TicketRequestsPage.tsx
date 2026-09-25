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
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';

const STATUS_META: Record<TicketRequestStatus, { label: string; tone: BadgeTone }> = {
  pending_payment: { label: 'În așteptarea plății', tone: 'neutral' },
  payment_proof_submitted: { label: 'Dovadă trimisă', tone: 'accent' },
  under_review: { label: 'În verificare', tone: 'warning' },
  approved: { label: 'Acceptată', tone: 'success' },
  rejected: { label: 'Refuzată', tone: 'danger' },
  additional_information_required: { label: 'Necesită informații', tone: 'warning' },
  cancelled: { label: 'Anulată', tone: 'neutral' },
};

function amount(value: number): string {
  return new Intl.NumberFormat('ro-MD', { maximumFractionDigits: 2 }).format(value);
}

function reviewable(status: TicketRequestStatus): boolean {
  return status === 'payment_proof_submitted' || status === 'under_review';
}

export function TicketRequestsPage(): JSX.Element {
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
    <Card title="Cereri bilete">
      <p className="muted" style={{ marginTop: 0 }}>
        Verifică manual dovada transferului înainte de acceptare. Confirmarea actualizează
        disponibilitatea evenimentului numai pe server.
      </p>
      <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
        <Field label="Status" htmlFor="ticket-request-status">
          <Select
            id="ticket-request-status"
            value={filters.status ?? 'all'}
            onChange={(event) => setFilter('status', event.target.value as TicketRequestFilters['status'])}
          >
            <option value="all">Toate statusurile</option>
            {Object.entries(STATUS_META).map(([value, meta]) => (
              <option key={value} value={value}>{meta.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Eveniment" htmlFor="ticket-request-event">
          <Select
            id="ticket-request-event"
            value={filters.event_id ?? ''}
            onChange={(event) => setFilter('event_id', event.target.value)}
          >
            <option value="">Toate evenimentele</option>
            {eventOptions.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
          </Select>
        </Field>
        <Field label="De la data cererii" htmlFor="ticket-request-from">
          <TextInput id="ticket-request-from" type="date" value={filters.created_from ?? ''} onChange={(event) => setFilter('created_from', event.target.value)} />
        </Field>
        <Field label="Până la data cererii" htmlFor="ticket-request-to">
          <TextInput id="ticket-request-to" type="date" value={filters.created_to ?? ''} onChange={(event) => setFilter('created_to', event.target.value)} />
        </Field>
      </div>

      {query.isPending ? <LoadingState label="Se încarcă cererile…" /> : null}
      {query.isError ? <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} /> : null}
      {!query.isPending && !query.isError && requests.length === 0 ? (
        <EmptyState title="Nicio cerere" hint="Nu există cereri pentru filtrele selectate." />
      ) : null}
      {requests.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>ID</th><th>Client</th><th>Telefon</th><th>Eveniment</th><th>Bilete</th><th>Total</th><th>Creată</th><th>Status</th><th>Dovadă</th><th aria-label="Acțiuni" /></tr></thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id}>
                  <td className="mono">{request.id.slice(0, 8)}</td>
                  <td><div>{request.full_name ?? '—'}</div><div className="muted">{request.email ?? '—'}</div></td>
                  <td className="mono">{request.phone ?? '—'}</td>
                  <td><div>{request.event_title}</div><div className="muted">{formatDateTime(request.event_starts_at)}</div></td>
                  <td>{request.ticket_quantity}</td>
                  <td className="mono">{amount(request.total_amount)}</td>
                  <td className="muted mono">{formatDateTime(request.created_at)}</td>
                  <td><Badge tone={STATUS_META[request.status].tone}>{STATUS_META[request.status].label}</Badge></td>
                  <td>{request.payment_proof_uploaded ? 'Disponibilă' : <span className="muted">—</span>}</td>
                  <td><Button small onClick={() => setSelected(request)}>Deschide</Button></td>
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
    <Modal title={`Cerere ${current.id.slice(0, 8)}`} wide onClose={onClose}>
      <div className="modal__body">
        {details.isPending ? <LoadingState label="Se încarcă detaliile…" /> : null}
        {details.isError ? <ErrorState message={errorMessage(details.error)} /> : null}
        <div className="form-grid">
          <Detail label="Client" value={`${current.full_name ?? '—'}${current.email ? ` · ${current.email}` : ''}`} />
          <Detail label="Telefon" value={current.phone ?? '—'} />
          <Detail label="Eveniment" value={`${current.event_title} · ${formatDateTime(current.event_starts_at)}`} />
          <Detail label="Bilete / total" value={`${current.ticket_quantity} / ${amount(current.total_amount)}`} />
          <Detail label="Descriere transfer" value={current.payment_description} />
          <Detail label="Mesaj client" value={current.client_message ?? '—'} />
          <Detail label="Comentariu admin" value={current.admin_comment ?? '—'} />
        </div>
        {current.payment_proof_uploaded ? (
          <section aria-label="Dovada plății">
            <h3 className="card__title">Dovada plății</h3>
            {proofError ? <div className="alert" role="alert">{proofError}</div> : null}
            {!proofUrl && !proofError ? <LoadingState label="Se încarcă dovada protejată…" /> : null}
            {proofUrl ? <img src={proofUrl} alt="Dovada plății încărcată de client" style={{ display: 'block', maxWidth: '100%', maxHeight: 520, margin: '0 auto', borderRadius: 'var(--radius-input)' }} /> : null}
          </section>
        ) : <p className="muted">Clientul nu a încărcat încă o dovadă.</p>}
        {reviewable(current.status) ? (
          <div className="modal__actions">
            <Button onClick={() => setAction('under_review')}>Marchează în verificare</Button>
            <Button onClick={() => setAction('additional_information_required')}>Cere informații</Button>
            <Button variant="danger" onClick={() => setAction('rejected')}>Refuză</Button>
            <Button variant="primary" onClick={() => setAction('approved')}>Acceptă plata</Button>
          </div>
        ) : null}
      </div>
      {action ? <ReviewModal request={current} status={action} onCancel={() => setAction(null)} onDone={onChanged} /> : null}
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: string }): JSX.Element { return <div><div className="muted">{label}</div><div>{value}</div></div>; }

function ReviewModal({ request, status, onCancel, onDone }: { request: TicketRequest; status: TicketRequestReviewInput['status']; onCancel: () => void; onDone: () => Promise<void> }): JSX.Element {
  const [comment, setComment] = useState('');
  const mutation = useMutation({ mutationFn: () => reviewTicketRequest(request.id, { status, admin_comment: comment }), onSuccess: () => void onDone() });
  const label = status === 'approved' ? 'Acceptă plata' : status === 'rejected' ? 'Refuză cererea' : status === 'additional_information_required' ? 'Solicită informații' : 'Marchează în verificare';
  const submit = (event: FormEvent): void => { event.preventDefault(); if (!mutation.isPending) mutation.mutate(); };
  return <Modal title={label} onClose={onCancel}><form className="modal__body" onSubmit={submit}>
    <p style={{ margin: 0 }}>{status === 'approved' ? 'Confirmi manual că plata este validă? Această acțiune rezervă biletele pe server.' : 'Comentariul este afișat clientului și păstrat în audit.'}</p>
    <Field label="Comentariu pentru client" htmlFor="ticket-request-comment"><TextArea id="ticket-request-comment" value={comment} maxLength={500} onChange={(event) => setComment(event.target.value)} placeholder={status === 'rejected' ? 'Motivul refuzului' : 'Comentariu opțional'} /></Field>
    {mutation.isError ? <div className="alert" role="alert">{errorMessage(mutation.error)}</div> : null}
    <div className="modal__actions"><Button variant="ghost" onClick={onCancel} disabled={mutation.isPending}>Anulează</Button><Button type="submit" variant={status === 'rejected' ? 'danger' : 'primary'} disabled={mutation.isPending}>{mutation.isPending ? 'Se salvează…' : label}</Button></div>
  </form></Modal>;
}
