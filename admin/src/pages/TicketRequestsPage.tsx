/**
 * Cereri de bilete (cu nume/telefon, una sau mai multe bilete): clientul trimite
 * dovada transferului, adminul o verifică și ACCEPTĂ (biletele se rezervă pe
 * server, cu verificarea capacității), REFUZĂ, CERE INFORMAȚII sau ANULEAZĂ.
 *
 * Toate filtrele (stare, eveniment, dată) pleacă la server; lista e paginată pe
 * cursor („Încarcă mai multe"), iar contoarele de pe filtre vin exacte din
 * `/admin/ticket-requests/counts`.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type FormEvent } from 'react';

import {
  fetchTicketRequest,
  fetchTicketRequestCounts,
  fetchTicketRequestProof,
  fetchTicketRequestsPage,
  reviewTicketRequest,
  sumCounts,
} from '../api/admin';
import { ApiError } from '../api/client';
import type {
  TicketRequest,
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
} from '../components/ui';
import { useMessages } from '../i18n/LanguageContext';
import { ticketsMessages } from '../i18n/messages/tickets';
import { errorMessage } from '../lib/errors';
import { dayBoundaryIso, formatDateTime, formatMoney } from '../lib/format';
import {
  DetailRow,
  ProofViewer,
  STATUS_TONE,
  StatusChips,
  TO_VERIFY,
  TicketStatusBadge,
  needsAction,
  refreshTicketQueries,
  useEventOptions,
  useTicketActionError,
} from './ticketShared';
import './tickets.css';

type ReviewStatus = TicketRequestReviewInput['status'];
type StatusFilter = 'all' | 'toVerify' | TicketRequestStatus;

const FILTERS: readonly StatusFilter[] = [
  'all',
  'toVerify',
  'additional_information_required',
  'pending_payment',
  'approved',
  'rejected',
  'cancelled',
];

/** O cerere acceptată sau anulată e închisă definitiv (409 pe backend). */
function isClosed(status: TicketRequestStatus): boolean {
  return status === 'approved' || status === 'cancelled';
}

/** Filtrul din UI → stările trimise backend-ului (`?status=a,b`). */
function filterStatuses(filter: StatusFilter): readonly string[] {
  if (filter === 'all') return [];
  if (filter === 'toVerify') return TO_VERIFY;
  return [filter];
}

/** Statusurile care cer un mesaj pentru client (altfel primește un text generic). */
function commentRequired(status: ReviewStatus): boolean {
  return status === 'rejected' || status === 'additional_information_required' || status === 'cancelled';
}

/** Câte cereri aduce o pagină din coadă. */
export const PAGE_SIZE = 50;

interface Filters {
  status: StatusFilter;
  event_id: string;
  from: string;
  to: string;
}

export function TicketRequestsPage(): JSX.Element {
  const t = useMessages(ticketsMessages);
  const m = t.requests;
  const [filters, setFilters] = useState<Filters>({ status: 'all', event_id: '', from: '', to: '' });
  const [selected, setSelected] = useState<TicketRequest | null>(null);

  const serverFilters = {
    statuses: filterStatuses(filters.status),
    event_id: filters.event_id || undefined,
    // Zilele alese sunt zile din Chișinău; „până la" include toată ziua.
    created_from: filters.from ? dayBoundaryIso(filters.from) || undefined : undefined,
    created_to: filters.to ? dayBoundaryIso(filters.to, true) || undefined : undefined,
  };
  const query = useInfiniteQuery({
    queryKey: ['ticket-requests', 'list', serverFilters],
    queryFn: ({ pageParam }) =>
      fetchTicketRequestsPage({ ...serverFilters, cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    refetchInterval: 60_000,
  });
  // O cerere mutată între pagini la reîmprospătare nu apare de două ori.
  const requests = useMemo(() => {
    const seen = new Map<string, TicketRequest>();
    for (const page of query.data?.pages ?? []) {
      for (const request of page.items) if (!seen.has(request.id)) seen.set(request.id, request);
    }
    return Array.from(seen.values());
  }, [query.data]);

  // Contoarele EXACTE pe stare (pentru evenimentul ales). Endpoint-ul nu știe de
  // filtrele pe dată → cu o dată aleasă, contoarele nu se arată (ar minți).
  const datesActive = filters.from !== '' || filters.to !== '';
  const counts = useQuery({
    queryKey: ['ticket-requests', 'counts', filters.event_id],
    queryFn: () => fetchTicketRequestCounts({ eventId: filters.event_id || undefined }),
    refetchInterval: 60_000,
    enabled: !datesActive,
  });

  // Evenimentele din filtru: cele recente + cele văzute în cereri (altfel un
  // eveniment mai vechi, odată ales, ar dispărea din listă).
  const seenEvents = useRef(new Map<string, { id: string; title: string; starts_at: string }>());
  const extraEvents = useMemo(() => {
    for (const request of requests) {
      if (!seenEvents.current.has(request.event_id)) {
        seenEvents.current.set(request.event_id, {
          id: request.event_id,
          title: request.event_title,
          starts_at: request.event_starts_at,
        });
      }
    }
    return Array.from(seenEvents.current.values());
  }, [requests]);
  const eventOptions = useEventOptions(extraEvents).options;

  const set = <K extends keyof Filters>(key: K, value: Filters[K]): void => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const count = (filter: StatusFilter): string | null => {
    if (datesActive || !counts.data) return null;
    return String(filter === 'all' ? counts.data.total : sumCounts(counts.data, filterStatuses(filter)));
  };
  const chipOptions = FILTERS.map((key) => ({
    key,
    label: key === 'all' ? m.allStatuses : key === 'toVerify' ? m.toVerify : m.status[key],
    count: count(key),
    urgent: key === 'toVerify',
  }));

  return (
    <Card title={m.title}>
      <p className="muted ticket-intro">{m.intro}</p>
      <div className="ticket-toolbar">
        <StatusChips
          label={t.common.status}
          options={chipOptions}
          value={filters.status}
          onChange={(value) => set('status', value)}
        />
      </div>
      <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
        <Field label={t.common.event} htmlFor="ticket-request-event">
          <Select
            id="ticket-request-event"
            value={filters.event_id}
            onChange={(event) => set('event_id', event.target.value)}
          >
            <option value="">{m.allEvents}</option>
            {eventOptions.map((event) => (
              <option key={event.id} value={event.id}>
                {event.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={m.createdFrom} htmlFor="ticket-request-from">
          <TextInput
            id="ticket-request-from"
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(event) => set('from', event.target.value)}
          />
        </Field>
        <Field label={m.createdTo} htmlFor="ticket-request-to">
          <TextInput
            id="ticket-request-to"
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(event) => set('to', event.target.value)}
          />
        </Field>
      </div>

      {query.isPending ? <LoadingState label={m.loading} /> : null}
      {query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : null}
      {!query.isPending && !query.isError && requests.length === 0 ? (
        <EmptyState title={m.emptyTitle} hint={m.emptyHint} />
      ) : null}
      {requests.length > 0 ? (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.common.status}</th>
                  <th>{m.colClient}</th>
                  <th>{t.common.event}</th>
                  <th>{m.colTotal}</th>
                  <th>{m.colProof}</th>
                  <th>{t.common.created}</th>
                  <th aria-label={t.common.actions} />
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr
                    key={request.id}
                    data-testid={`ticket-request-row-${request.id}`}
                    className={['ticket-row', needsAction(request.status) ? 'ticket-row--action' : '']
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => setSelected(request)}
                  >
                    <td>
                      <div className="ticket-cell">
                        <Badge tone={STATUS_TONE[request.status] ?? 'neutral'}>
                          {m.status[request.status] ?? request.status}
                        </Badge>
                        <TicketStatusBadge status={request.ticket_status} admittedAt={request.admitted_at} />
                      </div>
                    </td>
                    <td>
                      <div>{request.full_name ?? '—'}</div>
                      <div className="muted mono">{request.phone ?? '—'}</div>
                      {request.email ? <div className="muted">{request.email}</div> : null}
                    </td>
                    <td>
                      <div>{request.event_title}</div>
                      <div className="muted mono">{formatDateTime(request.event_starts_at)}</div>
                    </td>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                      <div>{formatMoney(request.total_amount, request.currency)}</div>
                      <div className="muted">
                        {m.perTicket(request.ticket_quantity, formatMoney(request.ticket_price, request.currency))}
                      </div>
                      {request.ticket_tier_name ? (
                        <div data-testid="request-tier">
                          <Badge tone="neutral">{request.ticket_tier_name}</Badge>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {request.payment_proof_uploaded ? (
                        <Badge tone="accent">{m.proofAvailable}</Badge>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="muted mono">{formatDateTime(request.created_at)}</td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <div className="table__actions">
                        <Button
                          small
                          variant={needsAction(request.status) ? 'primary' : 'ghost'}
                          onClick={() => setSelected(request)}
                        >
                          {needsAction(request.status) ? m.verify : m.open}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {query.hasNextPage ? (
            <div className="ticket-more">
              <Button onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                {query.isFetchingNextPage ? t.common.loadingMore : t.common.loadMore}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      {selected ? (
        <TicketRequestDetail request={selected} onClose={() => setSelected(null)} onDone={() => setSelected(null)} />
      ) : null}
    </Card>
  );
}

function TicketRequestDetail({
  request,
  onClose,
  onDone,
}: {
  request: TicketRequest;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const t = useMessages(ticketsMessages);
  const m = t.requests;
  const [action, setAction] = useState<ReviewStatus | null>(null);
  const details = useQuery({
    queryKey: ['ticket-request', request.id],
    queryFn: () => fetchTicketRequest(request.id),
  });
  const current = details.data ?? request;
  const gone = details.error instanceof ApiError && details.error.status === 404;
  const closed = isClosed(current.status);
  const hasProof = current.payment_proof_uploaded;

  return (
    <Modal title={m.detailTitle(current.id.slice(0, 8))} wide className="modal--ticket" onClose={onClose}>
      <div className="modal__body">
        {details.isError ? (
          <ErrorState
            message={gone ? m.requestMissing : errorMessage(details.error)}
            onRetry={gone ? undefined : () => void details.refetch()}
          />
        ) : null}
        {gone ? null : (
          <div className="ticket-detail">
            <div>
              {hasProof ? (
                <ProofViewer
                  load={() => fetchTicketRequestProof(current.id)}
                  kind={null}
                  version={current.id}
                />
              ) : (
                <div className="ticket-proof__empty muted">{m.noProof}</div>
              )}
            </div>

            <div className="ticket-detail__side">
              <div className="ticket-badges">
                <Badge tone={STATUS_TONE[current.status] ?? 'neutral'}>
                  {m.status[current.status] ?? current.status}
                </Badge>
                <TicketStatusBadge status={current.ticket_status} admittedAt={current.admitted_at} />
              </div>

              <div className="ticket-summary">
                <div>
                  <div className="ticket-summary__label">{m.colTotal}</div>
                  <div className="ticket-summary__value mono" data-testid="request-total">
                    {formatMoney(current.total_amount, current.currency)}
                  </div>
                  <div className="muted">
                    {m.perTicket(current.ticket_quantity, formatMoney(current.ticket_price, current.currency))}
                  </div>
                </div>
                {current.ticket_tier_name ? (
                  <div>
                    <div className="ticket-summary__label">{m.fieldTier}</div>
                    <div className="ticket-summary__value" data-testid="request-detail-tier">
                      {current.ticket_tier_name}
                    </div>
                  </div>
                ) : null}
                <div>
                  <div className="ticket-summary__label">{m.colClient}</div>
                  <div style={{ fontWeight: 700 }}>{current.full_name ?? '—'}</div>
                  <div className="mono">{current.phone ?? '—'}</div>
                </div>
              </div>

              {needsAction(current.status) ? <p className="ticket-hint">{m.verifyHint}</p> : null}

              <dl className="ticket-facts">
                <DetailRow label={m.email} value={current.email ?? '—'} />
                <DetailRow
                  label={t.common.event}
                  value={`${current.event_title} · ${formatDateTime(current.event_starts_at)}${
                    current.event_venue ? ` · ${current.event_venue}` : ''
                  }`}
                />
                <DetailRow label={m.transferDescription} value={current.payment_description || '—'} />
                <DetailRow label={t.common.created} value={formatDateTime(current.created_at)} />
                <DetailRow label={m.reviewedAt} value={formatDateTime(current.reviewed_at)} />
                {current.ticket_code ? (
                  <DetailRow label={m.ticketCode} value={<span className="mono">{current.ticket_code}</span>} />
                ) : null}
                <DetailRow label={m.clientMessage} value={current.client_message ?? '—'} />
                <DetailRow label={m.adminComment} value={current.admin_comment ?? '—'} />
              </dl>

              {details.isPending ? (
                <LoadingState label={m.loadingDetails} />
              ) : closed ? (
                <p className="muted" data-testid="request-final">
                  {m.finalState}
                </p>
              ) : (
                <>
                  {!hasProof ? <p className="ticket-hint">{m.needsProof}</p> : null}
                  <div className="ticket-actions">
                    <Button variant="primary" disabled={!hasProof} onClick={() => setAction('approved')}>
                      {m.acceptPayment}
                    </Button>
                    <Button onClick={() => setAction('additional_information_required')}>{m.askInfo}</Button>
                    {current.status !== 'under_review' ? (
                      <Button onClick={() => setAction('under_review')}>{m.markUnderReview}</Button>
                    ) : null}
                    {current.status !== 'rejected' ? (
                      <Button variant="danger" onClick={() => setAction('rejected')}>
                        {m.refuse}
                      </Button>
                    ) : null}
                  </div>
                  <div className="ticket-more-actions">
                    <Button variant="ghost" onClick={() => setAction('cancelled')}>
                      {m.cancelRequest}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      {action ? (
        <ReviewModal request={current} status={action} onCancel={() => setAction(null)} onDone={onDone} />
      ) : null}
    </Modal>
  );
}

function ReviewModal({
  request,
  status,
  onCancel,
  onDone,
}: {
  request: TicketRequest;
  status: ReviewStatus;
  onCancel: () => void;
  onDone: () => void;
}): JSX.Element {
  const t = useMessages(ticketsMessages);
  const m = t.requests;
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const actionErrorText = useTicketActionError();
  const required = commentRequired(status);
  const mutation = useMutation({
    mutationFn: () => reviewTicketRequest(request.id, { status, admin_comment: comment }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['ticket-request', request.id], updated);
      await refreshTicketQueries(queryClient);
      onDone();
    },
  });
  const label = m.actionTitle[status];
  const destructive = status === 'rejected' || status === 'cancelled';
  const intro =
    status === 'approved'
      ? m.approveWarning(
          request.ticket_quantity,
          formatMoney(request.total_amount, request.currency),
          request.full_name ?? '—',
        )
      : status === 'cancelled'
        ? m.cancelWarning
        : m.commentNotice;
  const blocked = mutation.isPending || (required && comment.trim() === '');
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!blocked) mutation.mutate();
  };
  return (
    <Modal title={label} onClose={mutation.isPending ? () => undefined : onCancel}>
      <form className="modal__body" onSubmit={submit}>
        <p className={destructive ? 'alert' : status === 'approved' ? 'ticket-hint' : undefined} style={{ margin: 0 }}>
          {intro}
        </p>
        <Field label={required ? m.commentRequiredLabel : m.commentLabel} htmlFor="ticket-request-comment">
          <TextArea
            id="ticket-request-comment"
            value={comment}
            maxLength={500}
            required={required}
            onChange={(event) => setComment(event.target.value)}
            placeholder={status === 'rejected' ? m.refuseReasonPlaceholder : m.optionalComment}
          />
        </Field>
        {mutation.isError ? (
          <div className="alert" role="alert">
            {actionErrorText(mutation.error)}
          </div>
        ) : null}
        <div className="modal__actions">
          <Button variant="ghost" onClick={onCancel} disabled={mutation.isPending}>
            {t.common.cancel}
          </Button>
          <Button type="submit" variant={destructive ? 'danger' : 'primary'} disabled={blocked}>
            {mutation.isPending ? t.common.saving : label}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
