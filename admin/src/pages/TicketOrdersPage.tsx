/**
 * Comenzi bilete: verificarea manuală a plăților prin transfer bancar.
 *
 * Fluxul: userul comandă un bilet, plătește prin MIA (după telefon) sau prin
 * transfer în contul global (setate SUS, în cardul „Date de plată") folosind `reference` ca detaliu de plată, apoi marchează
 * „am plătit" (status `payment_declared`). Adminul caută transferul în extrasul
 * bancar DUPĂ `reference`, apoi APROBĂ (se generează biletul) sau RESPINGE.
 *
 * Comenzile `payment_declared` sunt cele care cer acțiune — backend-ul le trimite
 * primele, iar aici ies în evidență (badge de accent + acțiuni pe rând).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import {
  approveTicketOrder,
  changeTicketOrderStatus,
  deleteMiaQr,
  fetchPaymentSettings,
  fetchTicketOrder,
  fetchTicketOrderProof,
  fetchTicketOrdersByStatus,
  rejectTicketOrder,
  updatePaymentSettings,
  uploadMiaQr,
} from '../api/admin';
import type {
  PaymentSettings,
  PaymentSettingsInput,
  TicketOrder,
  TicketOrderStatus,
} from '../api/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
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
import { INTL_LOCALE, useLanguage, useMessages } from '../i18n/LanguageContext';
import { ticketsMessages } from '../i18n/messages/tickets';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';

/* ------------------------------ Ajutoare ---------------------------- */

/** Suma + moneda, formatate. Cade elegant pe „12 EUR" dacă moneda e necunoscută. */
function formatPrice(price: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).format(price);
  } catch {
    return `${price} ${currency}`;
  }
}

// Eticheta statusului vine din dicționar (`ticketsMessages.orders.status`).
// „De verificat" (chitanță încărcată) iese în evidență cu tonul de avertizare.
const STATUS_TONE: Record<TicketOrderStatus, BadgeTone> = {
  awaiting_payment: 'neutral',
  pending_payment: 'neutral',
  payment_declared: 'warning',
  payment_proof_submitted: 'warning',
  under_review: 'accent',
  additional_information_required: 'accent',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

/** Stările care cer acțiunea adminului (chitanță de verificat). */
const TO_VERIFY: readonly TicketOrderStatus[] = [
  'payment_declared',
  'payment_proof_submitted',
  'under_review',
];

type FilterKey = 'all' | 'toVerify' | 'awaiting' | 'needsInfo' | 'approved' | 'rejected' | 'cancelled';

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
  'awaiting',
  'needsInfo',
  'approved',
  'rejected',
  'cancelled',
];

/** Pauza după ultima tastă înainte de căutare (nu o cerere la fiecare cifră). */
export const SEARCH_DEBOUNCE_MS = 350;

function statusLabel(labels: Record<string, string>, status: string): string {
  return labels[status] ?? status;
}

/* -------------------------------- Pagina ---------------------------- */

export function TicketOrdersPage(): JSX.Element {
  const m = useMessages(ticketsMessages);
  const locale = INTL_LOCALE[useLanguage().language];
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [toApprove, setToApprove] = useState<TicketOrder | null>(null);
  const [toReject, setToReject] = useState<TicketOrder | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Codul de plată din comentariul extrasului bancar → comanda (`?q=`).
  useEffect(() => {
    const next = searchInput.trim();
    const timer = window.setTimeout(() => setSearch(next), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const query = useQuery({
    queryKey: ['ticket-orders', filter, search],
    queryFn: () => fetchTicketOrdersByStatus(FILTER_STATUSES[filter], search),
  });

  const invalidate = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ['ticket-orders'] }).then(() => undefined);

  const approve = useMutation({
    mutationFn: (id: string) => approveTicketOrder(id),
    onSuccess: async () => {
      setToApprove(null);
      setActionError(null);
      await invalidate();
    },
    onError: (error: unknown) => setActionError(errorMessage(error)),
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      rejectTicketOrder(id, reason),
    onSuccess: async () => {
      setToReject(null);
      setActionError(null);
      await invalidate();
    },
    onError: (error: unknown) => setActionError(errorMessage(error)),
  });

  const orders = query.data ?? [];

  return (
    <>
      <PaymentSettingsCard />

      <Card title={m.orders.title}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
            gap: 12,
            marginBottom: 12,
          }}
        >
          <Field label={m.orders.searchLabel} htmlFor="ticket-orders-search">
            <TextInput
              id="ticket-orders-search"
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={m.orders.searchPlaceholder}
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
            />
          </Field>
          <Field label={m.orders.filterLabel} htmlFor="ticket-orders-filter">
            <Select
              id="ticket-orders-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterKey)}
            >
              {FILTER_KEYS.map((key) => (
                <option key={key} value={key}>
                  {m.orders.filter[key]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {query.isPending ? (
          <LoadingState label={m.orders.loading} />
        ) : query.isError ? (
          <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : orders.length === 0 ? (
          <EmptyState
            title={search ? m.orders.searchEmpty(search) : m.orders.emptyTitle}
            hint={search ? undefined : m.orders.emptyHint}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{m.orders.colUser}</th>
                  <th>{m.common.event}</th>
                  <th>{m.orders.colAmount}</th>
                  <th>{m.orders.colReference}</th>
                  <th>{m.orders.colProof}</th>
                  <th>{m.orders.colNote}</th>
                  <th>{m.common.status}</th>
                  <th>{m.common.created}</th>
                  <th aria-label={m.common.actions} />
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const needsReview = TO_VERIFY.includes(order.status) && !order.is_request;
                  return (
                    <tr
                      key={order.id}
                      data-testid={`ticket-order-row-${order.id}`}
                      onClick={() => setOpenId(order.id)}
                      style={{
                        cursor: 'pointer',
                        fontWeight: TO_VERIFY.includes(order.status) ? 600 : undefined,
                      }}
                    >
                      <td>
                        <div>{order.user.email}</div>
                        {order.user.payment_ref ? (
                          <div className="muted mono">{order.user.payment_ref}</div>
                        ) : null}
                      </td>
                      <td>
                        <div>{order.event.title}</div>
                        <div className="muted mono">{formatDateTime(order.event.starts_at)}</div>
                      </td>
                      <td className="mono">
                        {formatPrice(order.total_amount ?? order.price, order.currency, locale)}
                      </td>
                      <td>
                        <span className="badge badge--count mono">{order.reference}</span>
                      </td>
                      <td>
                        {order.payment_proof_uploaded ? (
                          <span role="img" aria-label={m.orders.proofAttached} title={m.orders.proofAttached}>
                            📎
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>{order.user_note ? order.user_note : <span className="muted">—</span>}</td>
                      <td>
                        <Badge tone={STATUS_TONE[order.status] ?? 'neutral'}>
                          {statusLabel(m.orders.status, order.status)}
                        </Badge>
                      </td>
                      <td className="muted mono">{formatDateTime(order.created_at)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="table__actions">
                          {needsReview ? (
                            <>
                              <Button
                                small
                                variant="primary"
                                onClick={() => {
                                  setActionError(null);
                                  setToApprove(order);
                                }}
                              >
                                {m.orders.approve}
                              </Button>
                              <Button
                                small
                                variant="danger"
                                onClick={() => {
                                  setActionError(null);
                                  setToReject(order);
                                }}
                              >
                                {m.orders.reject}
                              </Button>
                            </>
                          ) : order.ticket_code ? (
                            <span className="mono muted">{order.ticket_code}</span>
                          ) : null}
                          <Button small variant="ghost" onClick={() => setOpenId(order.id)}>
                            {m.orders.open}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {openId ? (
        <TicketOrderDetail
          orderId={openId}
          fallback={orders.find((o) => o.id === openId) ?? null}
          onClose={() => setOpenId(null)}
          onChanged={invalidate}
        />
      ) : null}

      {toApprove ? (
        <ConfirmDialog
          title={m.orders.approveTitle}
          message={m.orders.approveMessage(
            toApprove.reference,
            formatPrice(toApprove.price, toApprove.currency, locale),
            toApprove.user.email,
          )}
          confirmLabel={m.orders.approveConfirm}
          danger={false}
          busy={approve.isPending}
          errorMessage={actionError}
          onCancel={() => {
            setToApprove(null);
            setActionError(null);
          }}
          onConfirm={() => approve.mutate(toApprove.id)}
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
          onSubmit={(reason) => reject.mutate({ id: toReject.id, reason })}
        />
      ) : null}
    </>
  );
}

/* --------------------------- Detaliul comenzii ---------------------- */

function DetailRow({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div>
      <div className="muted">{label}</div>
      <div>{value}</div>
    </div>
  );
}

/** Chitanța: imagine cu zoom sau link spre PDF — citită autentificat ca Blob. */
function ProofViewer({ order }: { order: TicketOrder }): JSX.Element {
  const m = useMessages(ticketsMessages).orders;
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const isPdf = order.payment_proof_kind === 'pdf';

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    setError(null);
    void fetchTicketOrderProof(order.id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [order.id, order.payment_declared_at]);

  return (
    <section aria-label={m.proofTitle}>
      <h3 className="card__title">{m.proofTitle}</h3>
      {error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}
      {!url && !error ? <LoadingState label={m.loadingProof} /> : null}
      {url && isPdf ? (
        <a className="btn" href={url} target="_blank" rel="noopener noreferrer" data-testid="proof-pdf-link">
          {m.openPdf}
        </a>
      ) : null}
      {url && !isPdf ? (
        <>
          <div className="table__actions" style={{ marginBottom: 8 }}>
            <Button small variant="ghost" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} disabled={zoom <= 1}>
              {m.zoomOut}
            </Button>
            <Button small variant="ghost" onClick={() => setZoom((z) => Math.min(4, z + 0.5))} disabled={zoom >= 4}>
              {m.zoomIn}
            </Button>
          </div>
          <div style={{ overflow: 'auto', maxHeight: 520, borderRadius: 'var(--radius-input)' }}>
            <img
              src={url}
              alt={m.proofAlt}
              data-testid="proof-image"
              onClick={() => setZoom((z) => (z >= 2 ? 1 : 2))}
              style={{
                display: 'block',
                width: `${zoom * 100}%`,
                maxWidth: zoom === 1 ? '100%' : 'none',
                margin: '0 auto',
                cursor: zoom >= 2 ? 'zoom-out' : 'zoom-in',
              }}
            />
          </div>
        </>
      ) : null}
    </section>
  );
}

function TicketOrderDetail({
  orderId,
  fallback,
  onClose,
  onChanged,
}: {
  orderId: string;
  fallback: TicketOrder | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}): JSX.Element {
  const m = useMessages(ticketsMessages).orders;
  const common = useMessages(ticketsMessages).common;
  const locale = INTL_LOCALE[useLanguage().language];
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<TicketOrderStatus | null>(null);
  const [picked, setPicked] = useState<TicketOrderStatus | ''>('');

  const details = useQuery({
    queryKey: ['ticket-order', orderId],
    queryFn: () => fetchTicketOrder(orderId),
  });
  const order = details.data ?? fallback;
  const allowed = order?.allowed_statuses ?? [];

  const done = async (): Promise<void> => {
    setPending(null);
    setPicked('');
    await queryClient.invalidateQueries({ queryKey: ['ticket-order', orderId] });
    await onChanged();
  };

  const title = order ? m.detailTitle(order.reference) : m.loadingDetails;
  const method = order?.payment_method ? m.method[order.payment_method] : m.method.unknown;

  return (
    <Modal title={title} wide onClose={onClose}>
      <div className="modal__body">
        {details.isPending && !order ? <LoadingState label={m.loadingDetails} /> : null}
        {details.isError ? <ErrorState message={errorMessage(details.error)} /> : null}
        {order ? (
          <>
            <div>
              <Badge tone={STATUS_TONE[order.status] ?? 'neutral'}>
                {statusLabel(m.status, order.status)}
              </Badge>
            </div>
            <div className="form-grid">
              <DetailRow
                label={m.fieldUser}
                value={`${order.user.email}${order.user.payment_ref ? ` · ${order.user.payment_ref}` : ''}`}
              />
              <DetailRow
                label={m.fieldAmount}
                value={formatPrice(order.total_amount ?? order.price, order.currency, locale)}
              />
              <DetailRow
                label={m.fieldReference}
                value={<span className="badge badge--count mono">{order.reference}</span>}
              />
              <DetailRow label={m.fieldMethod} value={method} />
              <DetailRow
                label={common.event}
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
              <DetailRow label={m.fieldUserNote} value={order.user_note ?? '—'} />
              <DetailRow label={m.fieldAdminNote} value={order.admin_note ?? '—'} />
              {order.ticket_code ? (
                <DetailRow label={m.fieldTicket} value={<span className="mono">{order.ticket_code}</span>} />
              ) : null}
            </div>

            {order.payment_proof_uploaded ? (
              <ProofViewer order={order} />
            ) : (
              <p className="muted">{m.noProof}</p>
            )}

            {allowed.length === 0 ? (
              <p className="muted" data-testid="order-final">
                {details.isPending ? '' : m.finalState}
              </p>
            ) : (
              <>
                <div className="modal__actions">
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
                  {allowed.includes('approved') ? (
                    <Button variant="primary" onClick={() => setPending('approved')}>
                      {m.approve}
                    </Button>
                  ) : null}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <Field label={m.changeStatus} htmlFor="ticket-order-status">
                    <Select
                      id="ticket-order-status"
                      value={picked}
                      onChange={(e) => setPicked(e.target.value as TicketOrderStatus | '')}
                    >
                      <option value="">{m.changeStatusPick}</option>
                      {allowed.map((st) => (
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
              </>
            )}
          </>
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
  onDone: () => Promise<void>;
}): JSX.Element {
  const m = useMessages(ticketsMessages);
  const [note, setNote] = useState('');
  const noteRequired = status === 'rejected' || status === 'additional_information_required';
  const mutation = useMutation({
    mutationFn: () => changeTicketOrderStatus(order.id, { status, note }),
    onSuccess: () => void onDone(),
  });
  const label = m.orders.confirmStatus(statusLabel(m.orders.status, status));
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (mutation.isPending || (noteRequired && note.trim() === '')) return;
    mutation.mutate();
  };
  return (
    <Modal title={label} onClose={onCancel}>
      <form className="modal__body" onSubmit={submit}>
        <p style={{ margin: 0 }}>{m.orders.noteNotice}</p>
        <Field
          label={noteRequired ? m.orders.noteRequiredLabel : m.orders.noteLabel}
          htmlFor="ticket-order-note"
        >
          <TextArea
            id="ticket-order-note"
            value={note}
            maxLength={500}
            required={noteRequired}
            onChange={(e) => setNote(e.target.value)}
            placeholder={m.orders.notePlaceholder}
          />
        </Field>
        {mutation.isError ? (
          <div className="alert" role="alert">
            {errorMessage(mutation.error)}
          </div>
        ) : null}
        <div className="modal__actions">
          <Button variant="ghost" onClick={onCancel} disabled={mutation.isPending}>
            {m.common.cancel}
          </Button>
          <Button
            type="submit"
            variant={status === 'rejected' || status === 'cancelled' ? 'danger' : 'primary'}
            disabled={mutation.isPending || (noteRequired && note.trim() === '')}
          >
            {mutation.isPending ? m.common.saving : m.orders.apply}
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
  const m = useMessages(ticketsMessages);
  const [reason, setReason] = useState('');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (busy) return;
    onSubmit(reason.trim() === '' ? undefined : reason.trim());
  };

  return (
    <Modal title={m.orders.rejectTitle} onClose={onCancel}>
      <form className="modal__body" onSubmit={submit}>
        <p style={{ margin: 0 }}>
          {m.orders.rejectIntro(order.reference, order.user.email)}
        </p>

        <Field label={m.orders.rejectReason} htmlFor="reject-reason">
          <TextArea
            id="reject-reason"
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            placeholder={m.orders.rejectPlaceholder}
          />
        </Field>

        {error ? <div className="alert">{error}</div> : null}

        <div className="modal__actions">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {m.common.cancel}
          </Button>
          <Button type="submit" variant="danger" disabled={busy}>
            {busy ? m.orders.rejecting : m.orders.rejectTitle}
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

/** Codul QR MIA: previzualizarea celui curent + Încarcă/Înlocuiește și Șterge. */
function MiaQrField({ qrUrl }: { qrUrl: string | null }): JSX.Element {
  const m = useMessages(ticketsMessages);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const onSaved = (settings: PaymentSettings): void => {
    setError(null);
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
    if (!file) return;
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
            <Button small variant="danger" disabled={busy} onClick={() => remove.mutate()}>
              {m.bank.miaQrRemove}
            </Button>
          ) : null}
        </div>
      </div>
      {error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}
    </div>
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

  const set = <K extends keyof BankForm>(key: K, value: BankForm[K]): void =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

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
      {query.isPending || form === null ? (
        <LoadingState label={m.bank.loading} />
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <form className="modal__body" onSubmit={submit}>
          <p className="muted" style={{ margin: 0 }}>
            {m.bank.intro}
          </p>

          {saved ? <div className="alert alert--success">{m.bank.saved}</div> : null}

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

          {error ? <div className="alert">{error}</div> : null}

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
