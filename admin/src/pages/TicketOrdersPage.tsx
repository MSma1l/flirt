/**
 * Comenzi bilete: verificarea manuală a plăților (MIA sau transfer IBAN).
 *
 * Fluxul: userul comandă un bilet, plătește folosind CODUL DE PLATĂ (`reference`)
 * în comentariul transferului, încarcă chitanța → status „de verificat". Adminul
 * caută plata în extrasul bancar după cod, deschide comanda (chitanța MARE lângă
 * sumă/cod/client) și APROBĂ (se emite biletul), RESPINGE sau CERE INFORMAȚII.
 *
 * Ce cere acțiune iese în evidență: filtrul „De verificat" are contor galben, iar
 * rândurile lui au bara galbenă în stânga. Lista e paginată pe cursor („Încarcă
 * mai multe") — backend-ul trimite cele de verificat primele.
 *
 * Datele de plată (MIA / IBAN) sunt configurate în cardul de SUB coadă.
 * DEASUPRA cozii stă comutatorul global al vânzării online (toate evenimentele).
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import {
  approveTicketOrder,
  changeTicketOrderStatus,
  deleteMiaQr,
  fetchPaymentSettings,
  fetchTicketOrder,
  fetchTicketOrderCounts,
  fetchTicketOrderProof,
  fetchTicketOrdersPage,
  isOnlineSalesOff,
  rejectTicketOrder,
  setOnlineSalesEnabled,
  sumCounts,
  updatePaymentSettings,
  uploadMiaQr,
} from '../api/admin';
import { ApiError } from '../api/client';
import type {
  PaymentSettings,
  PaymentSettingsInput,
  TicketOrder,
  TicketOrderStatus,
} from '../api/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CopyButton } from '../components/CopyButton';
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
import { formatDateTime, formatMoney } from '../lib/format';
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

/* ------------------------------ Ajutoare ---------------------------- */

type FilterKey = 'all' | 'toVerify' | 'needsInfo' | 'awaiting' | 'approved' | 'rejected' | 'cancelled';

/** Filtrul din UI → stările trimise backend-ului (`?status=a,b`). */
const FILTER_STATUSES: Record<FilterKey, readonly TicketOrderStatus[]> = {
  all: [],
  toVerify: TO_VERIFY,
  awaiting: ['awaiting_payment', 'pending_payment'],
  needsInfo: ['additional_information_required'],
  approved: ['approved'],
  rejected: ['rejected'],
  cancelled: ['cancelled'],
};

const FILTER_KEYS: readonly FilterKey[] = [
  'all',
  'toVerify',
  'needsInfo',
  'awaiting',
  'approved',
  'rejected',
  'cancelled',
];

/** Câte comenzi aduce o pagină din coadă. */
export const PAGE_SIZE = 50;

/** Pauza după ultima tastă înainte de căutare (nu o cerere la fiecare cifră). */
export const SEARCH_DEBOUNCE_MS = 350;

/** Statusurile pentru care avem butoane dedicate în detaliu (restul: „Schimbă statusul"). */
const PRIMARY_ACTIONS: readonly TicketOrderStatus[] = [
  'approved',
  'additional_information_required',
  'rejected',
];

function statusLabel(labels: Record<string, string>, status: string): string {
  return labels[status] ?? status;
}

/** Suma de plată a comenzii (totalul pentru mai multe bilete), cu moneda. */
export function orderAmount(order: TicketOrder): string {
  const quantity = order.ticket_quantity ?? 1;
  return formatMoney(order.total_amount ?? order.price * quantity, order.currency);
}

function StatusBadge({ status }: { status: TicketOrderStatus }): JSX.Element {
  const m = useMessages(ticketsMessages).orders;
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{statusLabel(m.status, status)}</Badge>;
}

/* -------------------------------- Pagina ---------------------------- */

export function TicketOrdersPage(): JSX.Element {
  const t = useMessages(ticketsMessages);
  const m = t.orders;
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [eventId, setEventId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [toApprove, setToApprove] = useState<TicketOrder | null>(null);
  const [toReject, setToReject] = useState<TicketOrder | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Garda sincronă contra dublu-click-ului (înainte ca butonul să apuce să se dezactiveze).
  const inFlight = useRef(false);
  const actionErrorText = useTicketActionError();
  const events = useEventOptions();

  // Codul de plată din comentariul extrasului bancar → comanda (`?q=`).
  useEffect(() => {
    const next = searchInput.trim();
    const timer = window.setTimeout(() => setSearch(next), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const list = useInfiniteQuery({
    queryKey: ['ticket-orders', 'list', filter, eventId, search],
    queryFn: ({ pageParam }) =>
      fetchTicketOrdersPage({
        statuses: FILTER_STATUSES[filter],
        q: search,
        eventId: eventId || undefined,
        cursor: pageParam,
        limit: PAGE_SIZE,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    refetchInterval: 60_000,
  });

  // Contoarele EXACTE pe stare, pentru același eveniment / cod ca lista.
  // Fără filtre, cheia e aceeași ca badge-ul din meniu → o singură cerere.
  const counts = useQuery({
    queryKey: ['ticket-orders', 'counts', eventId, search],
    queryFn: () => fetchTicketOrderCounts({ eventId: eventId || undefined, q: search }),
    refetchInterval: 60_000,
  });
  const countLabel = (key: FilterKey): string | null => {
    if (!counts.data) return null;
    return String(key === 'all' ? counts.data.total : sumCounts(counts.data, FILTER_STATUSES[key]));
  };

  // O comandă mutată între pagini la reîmprospătare nu apare de două ori.
  const orders = useMemo(() => {
    const seen = new Map<string, TicketOrder>();
    for (const page of list.data?.pages ?? []) {
      for (const order of page.items) if (!seen.has(order.id)) seen.set(order.id, order);
    }
    return Array.from(seen.values());
  }, [list.data]);

  const onDecided = async (updated: TicketOrder): Promise<void> => {
    queryClient.setQueryData(['ticket-order', updated.id], updated);
    await refreshTicketQueries(queryClient);
  };

  const approve = useMutation({
    mutationFn: (id: string) => approveTicketOrder(id),
    onSuccess: async (updated) => {
      setToApprove(null);
      setActionError(null);
      await onDecided(updated);
    },
    onError: (error: unknown) => setActionError(actionErrorText(error)),
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => rejectTicketOrder(id, reason),
    onSuccess: async (updated) => {
      setToReject(null);
      setActionError(null);
      await onDecided(updated);
    },
    onError: (error: unknown) => setActionError(errorMessage(error)),
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const run = (action: () => void): void => {
    if (inFlight.current) return;
    inFlight.current = true;
    action();
  };

  const chipOptions = FILTER_KEYS.map((key) => ({
    key,
    label: m.filter[key],
    count: countLabel(key),
    urgent: key === 'toVerify',
  }));

  return (
    <>
      <OnlineSalesCard />

      <Card title={m.title}>
        <p className="muted ticket-intro">{m.intro}</p>
        <div className="ticket-toolbar">
          <StatusChips label={m.filterLabel} options={chipOptions} value={filter} onChange={setFilter} />
          <Field label={t.common.event} htmlFor="ticket-orders-event">
            <Select
              id="ticket-orders-event"
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
            >
              <option value="">{t.common.allEvents}</option>
              {events.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={m.searchLabel} htmlFor="ticket-orders-search">
            <TextInput
              id="ticket-orders-search"
              type="search"
              inputMode="numeric"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={m.searchPlaceholder}
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
            />
          </Field>
        </div>
        {list.isPending ? (
          <LoadingState label={m.loading} />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
        ) : orders.length === 0 ? (
          <EmptyState
            title={
              search
                ? m.searchEmpty(search)
                : filter === 'all' && !eventId
                  ? m.emptyTitle
                  : m.emptyFiltered(
                      filter === 'all'
                        ? (events.options.find((o) => o.id === eventId)?.label ?? t.common.event)
                        : m.filter[filter],
                    )
            }
            hint={search ? undefined : filter === 'toVerify' ? m.emptyToVerify : m.emptyHint}
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t.common.status}</th>
                    <th>{m.colReference}</th>
                    <th>{m.colAmount}</th>
                    <th>{m.colUser}</th>
                    <th>{t.common.event}</th>
                    <th>{m.colProof}</th>
                    <th>{t.common.created}</th>
                    <th aria-label={t.common.actions} />
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => {
                    const action = needsAction(order.status);
                    // Butoanele rapide doar pe comenzile directe: o cerere are regulile ei
                    // (ex. nu se aprobă fără dovadă) și se decide din detaliu.
                    const quick = action && !order.is_request;
                    return (
                      <tr
                        key={order.id}
                        data-testid={`ticket-order-row-${order.id}`}
                        className={['ticket-row', action ? 'ticket-row--action' : ''].filter(Boolean).join(' ')}
                        onClick={() => setOpenId(order.id)}
                      >
                        <td>
                          <div className="ticket-cell">
                            <StatusBadge status={order.status} />
                            <TicketStatusBadge status={order.ticket_status} admittedAt={order.admitted_at} />
                          </div>
                        </td>
                        <td>
                          <span className="mono ticket-ref">{order.reference}</span>
                        </td>
                        <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                          <div>{orderAmount(order)}</div>
                          {(order.ticket_quantity ?? 1) > 1 ? (
                            <div className="muted">{m.quantity(order.ticket_quantity ?? 1)}</div>
                          ) : null}
                          {order.ticket_tier_name ? (
                            <div data-testid="order-tier">
                              <Badge tone="neutral">{order.ticket_tier_name}</Badge>
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <div>{order.user.email}</div>
                          {order.user_note ? (
                            <div className="muted ticket-note" title={order.user_note}>
                              „{order.user_note}"
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <div>{order.event.title}</div>
                          <div className="muted mono">{formatDateTime(order.event.starts_at)}</div>
                        </td>
                        <td>
                          {order.payment_proof_uploaded ? (
                            <Badge tone="accent">
                              <span aria-label={m.proofAttached} title={m.proofAttached}>
                                {order.payment_proof_kind === 'pdf' ? m.proofPdf : m.proofBadge}
                              </span>
                            </Badge>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="muted mono">{formatDateTime(order.created_at)}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="table__actions">
                            {quick ? (
                              <>
                                <Button
                                  small
                                  variant="primary"
                                  onClick={() => {
                                    setActionError(null);
                                    setToApprove(order);
                                  }}
                                >
                                  {m.approve}
                                </Button>
                                <Button
                                  small
                                  variant="danger"
                                  onClick={() => {
                                    setActionError(null);
                                    setToReject(order);
                                  }}
                                >
                                  {m.reject}
                                </Button>
                              </>
                            ) : null}
                            <Button small variant="ghost" onClick={() => setOpenId(order.id)}>
                              {m.open}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {list.hasNextPage ? (
              <div className="ticket-more">
                <Button onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                  {list.isFetchingNextPage ? t.common.loadingMore : t.common.loadMore}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Card>

      <PaymentSettingsCard />

      {openId ? (
        <TicketOrderDetail
          orderId={openId}
          fallback={orders.find((o) => o.id === openId) ?? null}
          onClose={() => setOpenId(null)}
          onDecided={onDecided}
        />
      ) : null}

      {toApprove ? (
        <ConfirmDialog
          title={m.approveTitle}
          message={[
            m.approveMessage(toApprove.reference, orderAmount(toApprove), toApprove.user.email),
            toApprove.payment_proof_uploaded ? '' : m.approveNoProof,
          ]
            .filter(Boolean)
            .join(' ')}
          confirmLabel={m.approveConfirm}
          danger={false}
          busy={approve.isPending}
          errorMessage={actionError}
          onCancel={() => {
            setToApprove(null);
            setActionError(null);
          }}
          onConfirm={() => run(() => approve.mutate(toApprove.id))}
        />
      ) : null}

      {toReject ? (
        <RejectModal
          order={toReject}
          busy={reject.isPending}
          errorMessage={actionError}
          onCancel={() => {
            setToReject(null);
            setActionError(null);
          }}
          onSubmit={(reason) => run(() => reject.mutate({ id: toReject.id, reason }))}
        />
      ) : null}
    </>
  );
}

/* --------------------------- Detaliul comenzii ---------------------- */

function TicketOrderDetail({
  orderId,
  fallback,
  onClose,
  onDecided,
}: {
  orderId: string;
  fallback: TicketOrder | null;
  onClose: () => void;
  onDecided: (updated: TicketOrder) => Promise<void>;
}): JSX.Element {
  const t = useMessages(ticketsMessages);
  const m = t.orders;
  const [pending, setPending] = useState<TicketOrderStatus | null>(null);
  const [picked, setPicked] = useState<TicketOrderStatus | ''>('');

  const details = useQuery({
    queryKey: ['ticket-order', orderId],
    queryFn: () => fetchTicketOrder(orderId),
  });
  const order = details.data ?? fallback;
  // Acțiunile pornesc doar din datele PROASPETE ale detaliului (lista poate fi veche).
  const allowed = details.data?.allowed_statuses ?? [];
  const others = allowed.filter((status) => !PRIMARY_ACTIONS.includes(status));
  const gone = details.error instanceof ApiError && details.error.status === 404;
  // O cerere (date de contact) nu se poate aproba fără dovada plății (409 pe backend).
  const approveBlocked = Boolean(order?.is_request && !order.payment_proof_uploaded);

  const done = async (updated: TicketOrder): Promise<void> => {
    setPending(null);
    setPicked('');
    await onDecided(updated);
  };

  const title = order ? m.detailTitle(order.reference) : m.loadingDetails;
  const method = order?.payment_method ? m.method[order.payment_method] : m.method.unknown;

  return (
    <Modal title={title} wide className="modal--ticket" onClose={onClose}>
      <div className="modal__body">
        {details.isPending && !order ? <LoadingState label={m.loadingDetails} /> : null}
        {details.isError ? (
          <ErrorState
            message={gone ? m.orderMissing : errorMessage(details.error)}
            onRetry={gone ? undefined : () => void details.refetch()}
          />
        ) : null}
        {order && !gone ? (
          <div className="ticket-detail">
            <div>
              {order.payment_proof_uploaded ? (
                <ProofViewer
                  load={() => fetchTicketOrderProof(order.id)}
                  kind={order.payment_proof_kind}
                  version={`${order.id}:${order.payment_declared_at ?? ''}`}
                />
              ) : (
                <div className="ticket-proof__empty muted">{m.noProof}</div>
              )}
            </div>

            <div className="ticket-detail__side">
              <div className="ticket-badges">
                <StatusBadge status={order.status} />
                <TicketStatusBadge status={order.ticket_status} admittedAt={order.admitted_at} />
                {order.is_request ? <Badge tone="neutral">{m.kindRequest}</Badge> : null}
              </div>

              <div className="ticket-summary">
                <div>
                  <div className="ticket-summary__label">{m.fieldAmount}</div>
                  <div className="ticket-summary__value mono" data-testid="order-amount">
                    {orderAmount(order)}
                  </div>
                  {(order.ticket_quantity ?? 1) > 1 ? (
                    <div className="muted">
                      {m.perTicket(order.ticket_quantity ?? 1, formatMoney(order.price, order.currency))}
                    </div>
                  ) : null}
                </div>
                {order.ticket_tier_name ? (
                  <div>
                    <div className="ticket-summary__label">{m.fieldTier}</div>
                    <div className="ticket-summary__value" data-testid="order-detail-tier">
                      {order.ticket_tier_name}
                    </div>
                  </div>
                ) : null}
                <div>
                  <div className="ticket-summary__label">{m.fieldReference}</div>
                  <div className="ticket-summary__value mono">{order.reference}</div>
                  <CopyButton value={order.reference} />
                </div>
                <div>
                  <div className="ticket-summary__label">{m.fieldMethod}</div>
                  <div style={{ fontWeight: 700 }}>{method}</div>
                </div>
              </div>

              {needsAction(order.status) ? (
                <p className="ticket-hint">{m.verifyHint(order.reference, orderAmount(order))}</p>
              ) : null}

              <dl className="ticket-facts">
                <DetailRow label={m.fieldUser} value={order.user.email} />
                <DetailRow
                  label={t.common.event}
                  value={`${order.event.title} · ${formatDateTime(order.event.starts_at)}`}
                />
                <DetailRow label={m.fieldCreated} value={formatDateTime(order.created_at)} />
                <DetailRow
                  label={m.fieldPaid}
                  value={order.payment_declared_at ? formatDateTime(order.payment_declared_at) : '—'}
                />
                <DetailRow
                  label={m.fieldDecided}
                  value={order.decided_at ? formatDateTime(order.decided_at) : '—'}
                />
                {order.ticket_code ? (
                  <DetailRow label={m.fieldTicket} value={<span className="mono">{order.ticket_code}</span>} />
                ) : null}
                <DetailRow label={m.fieldUserNote} value={order.user_note ?? '—'} />
                <DetailRow label={m.fieldAdminNote} value={order.admin_note ?? '—'} />
              </dl>

              {details.isPending ? null : allowed.length === 0 ? (
                <p className="muted" data-testid="order-final">
                  {m.finalState}
                </p>
              ) : (
                <>
                  {approveBlocked && allowed.includes('approved') ? (
                    <p className="ticket-hint">{m.requestNeedsProof}</p>
                  ) : null}
                  <div className="ticket-actions">
                    {allowed.includes('approved') ? (
                      <Button
                        variant="primary"
                        disabled={approveBlocked}
                        onClick={() => setPending('approved')}
                      >
                        {m.approveAction}
                      </Button>
                    ) : null}
                    {allowed.includes('additional_information_required') ? (
                      <Button onClick={() => setPending('additional_information_required')}>
                        {m.askInfo}
                      </Button>
                    ) : null}
                    {allowed.includes('rejected') ? (
                      <Button variant="danger" onClick={() => setPending('rejected')}>
                        {m.reject}
                      </Button>
                    ) : null}
                  </div>
                  {others.length > 0 ? (
                    <div className="ticket-more-actions">
                      <Field label={m.changeStatus} htmlFor="ticket-order-status">
                        <Select
                          id="ticket-order-status"
                          value={picked}
                          onChange={(e) => setPicked(e.target.value as TicketOrderStatus | '')}
                        >
                          <option value="">{m.changeStatusPick}</option>
                          {others.map((st) => (
                            <option key={st} value={st}>
                              {statusLabel(m.status, st)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Button disabled={picked === ''} onClick={() => picked && setPending(picked)}>
                        {m.apply}
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
      {pending && order ? (
        <StatusChangeModal
          order={order}
          status={pending}
          onCancel={() => setPending(null)}
          onDone={done}
        />
      ) : null}
    </Modal>
  );
}

function StatusChangeModal({
  order,
  status,
  onCancel,
  onDone,
}: {
  order: TicketOrder;
  status: TicketOrderStatus;
  onCancel: () => void;
  onDone: (updated: TicketOrder) => Promise<void>;
}): JSX.Element {
  const t = useMessages(ticketsMessages);
  const m = t.orders;
  const [note, setNote] = useState('');
  const actionErrorText = useTicketActionError();
  const noteRequired = status === 'rejected' || status === 'additional_information_required';
  const mutation = useMutation({
    mutationFn: () => changeTicketOrderStatus(order.id, { status, note }),
    onSuccess: (updated) => void onDone(updated),
  });
  const label = m.confirmStatus(statusLabel(m.status, status));
  const destructive = status === 'rejected' || status === 'cancelled';
  const warning =
    status === 'approved'
      ? m.statusWarning.approved(order.reference, orderAmount(order), order.user.email)
      : status === 'cancelled'
        ? order.status === 'approved'
          ? m.statusWarning.cancelTicket
          : m.statusWarning.cancelled
        : status === 'rejected'
          ? m.statusWarning.rejected
          : null;
  const blocked = mutation.isPending || (noteRequired && note.trim() === '');
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (blocked) return;
    mutation.mutate();
  };
  return (
    <Modal title={label} onClose={mutation.isPending ? () => undefined : onCancel}>
      <form className="modal__body" onSubmit={submit}>
        {warning ? (
          <p className={destructive ? 'alert' : 'ticket-hint'} style={{ margin: 0 }}>
            {warning}
          </p>
        ) : null}
        <p className="muted" style={{ margin: 0 }}>
          {m.noteNotice}
        </p>
        <Field label={noteRequired ? m.noteRequiredLabel : m.noteLabel} htmlFor="ticket-order-note">
          <TextArea
            id="ticket-order-note"
            value={note}
            maxLength={500}
            required={noteRequired}
            onChange={(e) => setNote(e.target.value)}
            placeholder={m.notePlaceholder}
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
            {mutation.isPending ? t.common.saving : m.apply}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RejectModal({
  order,
  busy,
  errorMessage: error,
  onCancel,
  onSubmit,
}: {
  order: TicketOrder;
  busy: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onSubmit: (reason?: string) => void;
}): JSX.Element {
  const t = useMessages(ticketsMessages);
  const [reason, setReason] = useState('');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (busy) return;
    onSubmit(reason.trim() === '' ? undefined : reason.trim());
  };

  return (
    <Modal title={t.orders.rejectTitle} onClose={busy ? () => undefined : onCancel}>
      <form className="modal__body" onSubmit={submit}>
        <p style={{ margin: 0 }}>
          {t.orders.rejectIntro(order.reference, orderAmount(order), order.user.email)}
        </p>

        <Field label={t.orders.rejectReason} htmlFor="reject-reason">
          <TextArea
            id="reject-reason"
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t.orders.rejectPlaceholder}
          />
        </Field>

        {error ? (
          <div className="alert" role="alert">
            {error}
          </div>
        ) : null}

        <div className="modal__actions">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t.common.cancel}
          </Button>
          <Button type="submit" variant="danger" disabled={busy}>
            {busy ? t.orders.rejecting : t.orders.rejectTitle}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ----------------------------- Date de plată ------------------------ */

interface BankForm {
  bank_beneficiary: string;
  bank_iban: string;
  bank_name: string;
  instructions: string;
  mia_phone: string;
  mia_recipient_name: string;
}

function toBankForm(settings: PaymentSettings): BankForm {
  return {
    bank_beneficiary: settings.bank_beneficiary ?? '',
    bank_iban: settings.bank_iban ?? '',
    bank_name: settings.bank_name ?? '',
    instructions: settings.instructions ?? '',
    mia_phone: settings.mia_phone ?? '',
    mia_recipient_name: settings.mia_recipient_name ?? '',
  };
}

/**
 * Normalizează un număr moldovenesc la `+373XXXXXXXX` — oglinda validării din
 * backend (`normalize_md_phone`). Acceptă `069123456`, `69123456`,
 * `+373 69 123 456`, `37369123456`, `0037369123456`; altfel → null.
 */
export function normalizeMdPhone(raw: string): string | null {
  const v = raw.replace(/[\s\-.()]/g, '');
  let local: string;
  if (v.startsWith('+373')) local = v.slice(4);
  else if (v.startsWith('00373')) local = v.slice(5);
  else if (v.startsWith('373') && v.length === 11) local = v.slice(3);
  else if (v.startsWith('0') && v.length === 9) local = v.slice(1);
  else local = v;
  return /^\d{8}$/.test(local) ? `+373${local}` : null;
}

/** Text gol după trim → null (backend-ul refuză string-urile goale pe câmpurile opționale). */
function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Titlu de sub-secțiune + explicație scurtă, în interiorul cardului. */
function SectionHeading({ title, hint }: { title: string; hint: string }): JSX.Element {
  return (
    <div>
      <h3 style={{ margin: 0, fontSize: '1rem' }}>{title}</h3>
      <p className="muted" style={{ margin: '4px 0 0' }}>
        {hint}
      </p>
    </div>
  );
}

const QR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const QR_MAX_BYTES = 5 * 1024 * 1024;

/** Codul QR MIA: previzualizarea celui curent + Încarcă/Înlocuiește și Șterge (cu confirmare). */
function MiaQrField({ qrUrl }: { qrUrl: string | null }): JSX.Element {
  const m = useMessages(ticketsMessages);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const onSaved = (settings: PaymentSettings): void => {
    setError(null);
    setConfirmRemove(false);
    queryClient.setQueryData(['payment-settings'], settings);
  };
  const upload = useMutation({
    mutationFn: (file: File) => uploadMiaQr(file),
    onSuccess: onSaved,
    onError: (err: unknown) => setError(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => deleteMiaQr(),
    onSuccess: onSaved,
    onError: (err: unknown) => setError(errorMessage(err)),
  });
  const busy = upload.isPending || remove.isPending;

  const pick = (file: File | undefined): void => {
    if (!file || busy) return;
    if (!QR_TYPES.includes(file.type)) {
      setError(m.bank.miaQrBadType);
      return;
    }
    if (file.size > QR_MAX_BYTES) {
      setError(m.bank.miaQrTooLarge);
      return;
    }
    upload.mutate(file);
  };

  return (
    <div className="field">
      <span className="field__label">{m.bank.miaQr}</span>
      <p className="muted" style={{ margin: '0 0 8px' }}>
        {m.bank.miaQrHint}
      </p>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        {qrUrl ? (
          <img
            src={qrUrl}
            alt={m.bank.miaQrAlt}
            data-testid="mia-qr-preview"
            style={{
              width: 140,
              height: 140,
              objectFit: 'contain',
              background: '#ffffff',
              padding: 8,
              borderRadius: 12,
              border: '1px solid var(--color-border)',
            }}
          />
        ) : (
          <span className="muted">{m.bank.miaQrNone}</span>
        )}
        <div className="table__actions">
          <label className="btn" htmlFor="mia-qr-input" aria-disabled={busy || undefined}>
            {upload.isPending ? m.bank.miaQrUploading : qrUrl ? m.bank.miaQrReplace : m.bank.miaQrUpload}
          </label>
          <input
            id="mia-qr-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            aria-label={qrUrl ? m.bank.miaQrReplace : m.bank.miaQrUpload}
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {qrUrl ? (
            <Button
              small
              variant="danger"
              disabled={busy}
              onClick={() => {
                setError(null);
                setConfirmRemove(true);
              }}
            >
              {m.bank.miaQrRemove}
            </Button>
          ) : null}
        </div>
      </div>
      {error && !confirmRemove ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}
      {confirmRemove ? (
        <ConfirmDialog
          title={m.bank.miaQrRemoveTitle}
          message={m.bank.miaQrRemoveMessage}
          confirmLabel={m.bank.miaQrRemove}
          busy={remove.isPending}
          errorMessage={error}
          onCancel={() => {
            setConfirmRemove(false);
            setError(null);
          }}
          onConfirm={() => {
            if (!remove.isPending) remove.mutate();
          }}
        />
      ) : null}
    </div>
  );
}

/* ---------------------- Vânzarea online: ON / OFF ------------------ */

/**
 * Comutatorul GLOBAL al vânzării online (toate evenimentele odată). Oprirea cere
 * confirmare — userii nu mai pot cumpăra bilete noi; pornirea e imediată.
 * Starea vine din aceeași interogare ca datele de plată (`['payment-settings']`),
 * deci bara laterală vede schimbarea pe loc.
 */
function OnlineSalesCard(): JSX.Element {
  const m = useMessages(ticketsMessages).onlineSales;
  const queryClient = useQueryClient();
  const [confirmOff, setConfirmOff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({ queryKey: ['payment-settings'], queryFn: fetchPaymentSettings });

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setOnlineSalesEnabled(enabled),
    onSuccess: async (settings) => {
      setError(null);
      setConfirmOff(false);
      queryClient.setQueryData<PaymentSettings>(['payment-settings'], settings);
      // Evenimentele pot afișa disponibilitatea vânzării — le reîncărcăm.
      await queryClient.invalidateQueries({ queryKey: ['events'] });
    },
    onError: (mutationError: unknown) => setError(errorMessage(mutationError)),
  });

  const off = isOnlineSalesOff(query.data);
  const busy = toggle.isPending;

  const onToggle = (): void => {
    if (busy) return;
    setError(null);
    if (off) toggle.mutate(true);
    else setConfirmOff(true);
  };

  return (
    <>
      <Card className={off ? 'sales-switch sales-switch--off' : 'sales-switch sales-switch--on'}>
        {query.isPending ? (
          <LoadingState label={m.title} />
        ) : query.isError ? (
          <div className="alert sales-switch__load-error">
            <span>{m.loadError}</span>
            <Button small onClick={() => void query.refetch()}>
              {m.retry}
            </Button>
          </div>
        ) : (
          <>
            <div className="sales-switch__row">
              <div className="sales-switch__text">
                <div className="sales-switch__status" data-testid="online-sales-status">
                  <span className="sales-switch__dot" aria-hidden="true" />
                  <span>{m.label}:</span>
                  <strong>{off ? m.stopped : m.active}</strong>
                </div>
                <p className="muted sales-switch__hint">{off ? m.hintOff : m.hintOn}</p>
              </div>
              <Button variant={off ? 'primary' : 'danger'} disabled={busy} onClick={onToggle}>
                {busy && !confirmOff ? m.busy : off ? m.turnOn : m.turnOff}
              </Button>
            </div>
            {error && !confirmOff ? (
              <div className="alert" role="alert">
                {error}
              </div>
            ) : null}
          </>
        )}
      </Card>

      {confirmOff ? (
        <ConfirmDialog
          title={m.confirmTitle}
          message={m.confirmMessage}
          confirmLabel={m.confirmButton}
          busy={busy}
          errorMessage={error}
          onCancel={() => {
            setConfirmOff(false);
            setError(null);
          }}
          onConfirm={() => {
            if (!busy) toggle.mutate(false);
          }}
        />
      ) : null}
    </>
  );
}

function PaymentSettingsCard(): JSX.Element {
  const m = useMessages(ticketsMessages);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<BankForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Doar faptul că s-a salvat; textul vine din dicționar, deci urmează limba activă.
  const [saved, setSaved] = useState(false);

  const query = useQuery({ queryKey: ['payment-settings'], queryFn: fetchPaymentSettings });

  // Sincronizează formularul cu datele de la backend o singură dată, la sosire.
  useEffect(() => {
    if (query.data && form === null) setForm(toBankForm(query.data));
  }, [query.data, form]);

  const save = useMutation({
    mutationFn: (body: PaymentSettingsInput) => updatePaymentSettings(body),
    onSuccess: async (settings) => {
      setError(null);
      setSaved(true);
      setForm(toBankForm(settings));
      await queryClient.invalidateQueries({ queryKey: ['payment-settings'] });
    },
    onError: (mutationError: unknown) => setError(errorMessage(mutationError)),
  });

  const set = <K extends keyof BankForm>(key: K, value: BankForm[K]): void => {
    setSaved(false);
    setForm((current) => (current ? { ...current, [key]: value } : current));
  };

  // Validare — oglinda backend-ului: cel puțin o metodă (telefon MIA valid SAU
  // beneficiar + IBAN); dacă e completat IBAN-ul, beneficiarul e obligatoriu.
  const miaPhoneRaw = form?.mia_phone.trim() ?? '';
  const miaPhone = miaPhoneRaw === '' ? null : normalizeMdPhone(miaPhoneRaw);
  const phoneInvalid = miaPhoneRaw !== '' && miaPhone === null;
  const beneficiary = form?.bank_beneficiary.trim() ?? '';
  const iban = form?.bank_iban.trim() ?? '';
  const hasIban = beneficiary !== '' && iban !== '';
  // MIA e configurat cu telefon SAU cu un cod QR deja încărcat.
  const qrUrl = query.data?.mia_qr_url ?? null;
  const ibanRequired = miaPhoneRaw === '' && !qrUrl;
  const beneficiaryMissing = iban !== '' && beneficiary === '';
  const noMethod = miaPhone === null && !qrUrl && !hasIban;
  const valid = form !== null && !phoneInvalid && !beneficiaryMissing && !noMethod;

  const submit = (submitEvent: FormEvent): void => {
    submitEvent.preventDefault();
    if (!form || !valid || save.isPending) return;
    setSaved(false);
    save.mutate({
      bank_beneficiary: beneficiary,
      bank_iban: iban,
      bank_name: orNull(form.bank_name),
      instructions: orNull(form.instructions),
      mia_phone: miaPhone,
      mia_recipient_name: orNull(form.mia_recipient_name),
    });
  };

  const required = (label: string, isRequired: boolean): string =>
    isRequired ? `${label}${m.bank.required}` : label;

  return (
    <Card title={m.bank.title}>
      {/* Eroarea întâi: fără date, formularul rămâne null și am arăta „se încarcă" la nesfârșit. */}
      {query.isError && form === null ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : query.isPending || form === null ? (
        <LoadingState label={m.bank.loading} />
      ) : (
        <form className="modal__body" onSubmit={submit}>
          <p className="muted" style={{ margin: 0 }}>
            {m.bank.intro}
          </p>

          {/* --- MIA – plăți instant (după numărul de telefon) --- */}
          <SectionHeading title={m.bank.miaTitle} hint={m.bank.miaHint} />
          <div className="form-grid">
            <Field label={m.bank.miaPhone} htmlFor="mia-phone">
              <TextInput
                id="mia-phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={form.mia_phone}
                maxLength={20}
                placeholder={m.bank.miaPhonePlaceholder}
                aria-invalid={phoneInvalid || undefined}
                onChange={(e) => set('mia_phone', e.target.value)}
              />
            </Field>
            <Field label={m.bank.miaRecipient} htmlFor="mia-recipient">
              <TextInput
                id="mia-recipient"
                value={form.mia_recipient_name}
                maxLength={200}
                onChange={(e) => set('mia_recipient_name', e.target.value)}
              />
            </Field>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            {m.bank.miaRecipientHint}
          </p>
          {phoneInvalid ? (
            <div className="alert" role="alert">
              {m.bank.miaPhoneInvalid}
            </div>
          ) : null}
          <MiaQrField qrUrl={qrUrl} />

          {/* --- Transfer bancar (IBAN) --- */}
          <SectionHeading
            title={m.bank.ibanTitle}
            hint={ibanRequired ? m.bank.needMethod : m.bank.ibanOptional}
          />
          <div className="form-grid">
            <Field
              label={required(m.bank.beneficiary, ibanRequired || iban !== '')}
              htmlFor="bank-beneficiary"
            >
              <TextInput
                id="bank-beneficiary"
                value={form.bank_beneficiary}
                maxLength={200}
                required={ibanRequired || iban !== ''}
                onChange={(e) => set('bank_beneficiary', e.target.value)}
              />
            </Field>
            <Field label={m.bank.bankName} htmlFor="bank-name">
              <TextInput
                id="bank-name"
                value={form.bank_name}
                maxLength={200}
                onChange={(e) => set('bank_name', e.target.value)}
              />
            </Field>
          </div>

          <Field label={required(m.bank.iban, ibanRequired)} htmlFor="bank-iban">
            <TextInput
              id="bank-iban"
              value={form.bank_iban}
              maxLength={64}
              required={ibanRequired}
              onChange={(e) => set('bank_iban', e.target.value)}
            />
          </Field>
          {beneficiaryMissing ? (
            <div className="alert" role="alert">
              {m.bank.beneficiaryRequired}
            </div>
          ) : null}

          <Field label={m.bank.instructions} htmlFor="bank-instructions">
            <TextArea
              id="bank-instructions"
              value={form.instructions}
              maxLength={2000}
              onChange={(e) => set('instructions', e.target.value)}
              placeholder={m.bank.instructionsPlaceholder}
            />
          </Field>

          {error ? (
            <div className="alert" role="alert">
              {error}
            </div>
          ) : null}
          {saved ? (
            <div className="alert alert--success" role="status">
              {m.bank.saved}
            </div>
          ) : null}

          <div className="modal__actions">
            <Button type="submit" variant="primary" disabled={!valid || save.isPending}>
              {save.isPending ? m.common.saving : m.bank.save}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
