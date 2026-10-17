/**
 * Cererea manuală de bilete (mai multe bilete / rezervare pe nume), cu plată
 * prin transfer și chitanță obligatorie.
 *
 * Sus: cererile omului pentru acest eveniment, fiecare cu starea ei (aceleași
 * etichete ca în „Biletele mele"), datele de plată cât timp se așteaptă plata
 * și încărcarea chitanței. Jos: formularul — doar când nu există deja o cerere
 * activă (serverul ar întoarce-o oricum pe cea existentă) și vânzarea e
 * deschisă.
 *
 * Datele bancare complete vin la creare; după o reîncărcare a paginii le
 * cerem din nou de la `GET /ticket-orders/{id}` (le dă cât timp cererea
 * așteaptă plata) — altfel omul ar rămâne doar cu codul de plată, fără IBAN.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import { formatEventDate } from '@/features/events/eventFormat';
import { fetchEvent, type EventItem } from '@/features/events/eventsApi';
import { salesNotice, salesRefusal, useSalesState, type SalesBlock } from '@/features/events/ticketSales';
import { formatPrice } from '@/features/loyalty/priceFormat';
import { OrderStepper } from '@/features/tickets/OrderStepper';
import { PaymentDetails } from '@/features/tickets/PaymentDetails';
import { ClockIcon, LockIcon } from '@/features/tickets/TicketIcons';
import { hasEventStarted, orderStage } from '@/features/tickets/orderStage';
import { useOrderStatusText } from '@/features/tickets/orderStatusLabel';
import type { PaymentInstructions, PaymentMethod } from '@/features/tickets/paymentModel';
import { ticketOrderPath } from '@/features/tickets/ticketRoutes';
import { fetchTicketOrder, uploadOrderProof, type TicketOrderDetail } from '@/features/tickets/ticketsApi';
import { getUnsafeUser } from '@/telegram/bridge';

import { ProofUpload } from './ProofUpload';
import { createTicketRequest, fetchMyTicketRequests, type TicketRequest } from './ticketRequestsApi';

import './ticketRequests.css';

/** Limitele cantității de bilete acceptate de formular (și de server). */
const MIN_TICKETS = 1;
const MAX_TICKETS = 20;

/** Stările în care cererea încă așteaptă plata → arătăm datele de plată. */
const AWAITING_PAYMENT = new Set(['pending_payment', 'additional_information_required']);

/** Stările unei cereri încă deschise: nu are sens o cerere nouă. */
const ACTIVE = new Set([
  'pending_payment',
  'payment_proof_submitted',
  'under_review',
  'additional_information_required',
]);

/** Numele din Telegram, ca precompletare (omul îl poate schimba). */
function telegramFullName(): string {
  const user = getUnsafeUser();
  return [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim();
}

function RequestSummary({ request }: { request: TicketRequest }) {
  const { t } = useTranslation('screens');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const statusText = useOrderStatusText();
  const stage = orderStage(request.status);
  const eventStarted = hasEventStarted(request.event_starts_at);
  const status = statusText({ status: request.status }, eventStarted);
  // Metoda aleasă în datele de plată (MIA / IBAN) — trimisă odată cu chitanța.
  const [payMethod, setPayMethod] = useState<PaymentMethod | null>(null);
  const awaiting = AWAITING_PAYMENT.has(request.status) && !eventStarted;
  const needsProof =
    !eventStarted &&
    (awaiting || (request.status === 'rejected' && Boolean(request.can_resubmit_proof)));

  // Datele bancare complete vin doar la creare; le păstrăm în cache ca ecranul
  // de bilete să le poată arăta și după ce omul pleacă de aici.
  const cached =
    request.bank_payment ??
    queryClient.getQueryData<PaymentInstructions>(['ticket-request-payment', request.id]) ??
    null;
  const { data: detail } = useQuery<TicketOrderDetail>({
    queryKey: ['ticket-order', request.id],
    queryFn: () => fetchTicketOrder(request.id),
    enabled: awaiting && !cached,
  });
  const bank = cached ?? detail?.payment ?? null;

  return (
    <article className="tr-card tr-card--ticket" data-testid={`ticket-request-${request.id}`}>
      <div className="tr-card__heading">
        <strong>{request.event_title}</strong>
        <span className={`tr-status tr-status--${status.tone}`} data-testid="request-status">
          {status.label}
        </span>
      </div>
      <p className="caption">
        {formatEventDate(request.event_starts_at)} · {t('ticketRequests.ticketsCount', { count: request.ticket_quantity })} ·{' '}
        {formatPrice(request.total_amount, request.currency ?? 'lei')}
      </p>
      <p className="tr-next" data-testid="request-next-step">
        {status.next}
      </p>
      <OrderStepper stage={stage} hasCode={false} />
      {request.status === 'approved' ? <p className="tr-success">{t('ticketRequests.approvedNote')}</p> : null}
      {request.admin_comment ? (
        <p className="tr-comment">
          <strong>{t('ticketRequests.adminMessage')}</strong> <span className="tr-selectable">{request.admin_comment}</span>
        </p>
      ) : null}
      {eventStarted && (AWAITING_PAYMENT.has(request.status) || request.status === 'rejected') ? (
        <div className="tr-closed" role="status" data-testid="request-event-started">
          <span className="tr-closed__icon" aria-hidden="true">
            <LockIcon width={22} height={22} />
          </span>
          <div>
            <p className="tr-closed__title">{t('tickets.closedOrder.title')}</p>
            <p className="tr-closed__body">{t('tickets.closedOrder.body')}</p>
          </div>
        </div>
      ) : null}
      {awaiting && (bank || request.payment) ? (
        <section className="tr-payment" aria-label={t('ticketRequests.payment.title')}>
          <h2 className="tr-payment__title">{t('ticketRequests.payment.title')}</h2>
          <PaymentDetails
            amount={bank?.amount ?? request.total_amount}
            currency={bank?.currency ?? request.currency ?? 'lei'}
            beneficiary={bank?.beneficiary}
            iban={bank?.iban}
            bankName={bank?.bankName}
            reference={bank?.reference}
            phone={bank ? null : request.payment?.phone}
            accountDetails={bank ? null : request.payment?.account_details}
            purpose={request.payment?.payment_description || bank?.commentTemplate || null}
            instructions={bank?.instructions ?? request.payment?.instructions ?? null}
            miaPhone={bank?.miaPhone}
            miaRecipientName={bank?.miaRecipientName}
            miaQrUrl={bank?.miaQrUrl}
            methods={bank?.methods}
            onMethodChange={setPayMethod}
            finalStep="proof"
          />
        </section>
      ) : null}
      {needsProof ? <ProofUpload requestId={request.id} upload={uploadOrderProof} method={payMethod} /> : null}
      {stage === 'approved' || stage === 'review' ? (
        <button
          type="button"
          className="button button--ghost"
          onClick={() => void navigate(ticketOrderPath(request.id))}
        >
          {t('tickets.openInTickets')}
        </button>
      ) : null}
    </article>
  );
}

type FormState = {
  fullName: string;
  phone: string;
  email: string;
  ticketQuantity: string;
  clientMessage: string;
};

export function TicketRequestScreen() {
  const eventId = useParams().eventId ?? '';
  const navigate = useNavigate();
  const { t } = useTranslation('screens');
  const client = useQueryClient();
  const [form, setForm] = useState<FormState>(() => ({
    fullName: telegramFullName(),
    phone: '',
    email: '',
    ticketQuantity: '1',
    clientMessage: '',
  }));
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [wantsAnother, setWantsAnother] = useState(false);
  /** Serverul a închis / oprit vânzarea între timp (refuz la creare). */
  const [blockedByServer, setBlockedByServer] = useState<Exclude<SalesBlock, 'soldOut'> | null>(null);
  const [soldOutByServer, setSoldOutByServer] = useState(false);

  const { data: event, isPending: eventPending, isError: eventError } = useQuery<EventItem>({
    queryKey: ['event', eventId],
    queryFn: () => fetchEvent(eventId),
    enabled: Boolean(eventId),
  });
  const {
    data: requests,
    isPending: requestsPending,
    isError: requestsError,
    refetch,
    isFetching: requestsFetching,
  } = useQuery({ queryKey: ['ticket-requests'], queryFn: fetchMyTicketRequests });
  const ownForEvent = useMemo(() => (requests ?? []).filter((r) => r.event_id === eventId), [eventId, requests]);
  const sales = useSalesState(event ?? {});

  const create = useMutation({
    mutationFn: () =>
      createTicketRequest(eventId, { ...form, ticketQuantity: Number(form.ticketQuantity) }),
    onSuccess: (created) => {
      if (created.bank_payment) client.setQueryData(['ticket-request-payment', created.id], created.bank_payment);
      setWantsAnother(false);
      void client.invalidateQueries({ queryKey: ['ticket-requests'] });
      void client.invalidateQueries({ queryKey: ['ticket-orders'] });
    },
    onError: (error) => {
      const reason = salesRefusal(error);
      if (reason === 'soldOut') {
        // Capacitatea nu mai ajunge pentru câte bilete s-au cerut — poate pentru mai puține.
        setSoldOutByServer(true);
      } else if (reason) {
        setBlockedByServer(reason);
      }
      if (reason) void client.invalidateQueries({ queryKey: ['event', eventId] });
    },
  });

  const set = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === 'ticketQuantity') setSoldOutByServer(false);
  };

  const quantity = Number(form.ticketQuantity) || 0;
  const step = (delta: number) => {
    const next = Math.min(MAX_TICKETS, Math.max(MIN_TICKETS, (quantity || MIN_TICKETS) + delta));
    set('ticketQuantity', String(next));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (create.isPending) return;
    const next: Partial<Record<keyof FormState, string>> = {};
    if (form.fullName.trim().length < 2) next.fullName = t('ticketRequests.errors.fullName');
    if (form.phone.replace(/\D/g, '').length < 6) next.phone = t('ticketRequests.errors.phone');
    if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) next.email = t('ticketRequests.errors.email');
    if (!Number.isInteger(quantity) || quantity < MIN_TICKETS || quantity > MAX_TICKETS) {
      next.ticketQuantity = t('ticketRequests.errors.quantity', { min: MIN_TICKETS, max: MAX_TICKETS });
    }
    setErrors(next);
    if (Object.keys(next).length === 0) create.mutate();
  };

  if (eventPending || requestsPending) {
    return (
      <div className="tr-state">
        <div className="spinner" role="status" aria-label={t('ticketRequests.loading')} />
      </div>
    );
  }
  if (eventError || !event) {
    return (
      <div className="tr-state" role="alert">
        <p className="error-text">{t('ticketRequests.eventLoadError')}</p>
        <button type="button" className="button" onClick={() => void navigate(-1)}>
          {t('common:actions.back')}
        </button>
      </div>
    );
  }
  if (requestsError) {
    return (
      <div className="tr-state" role="alert">
        <p className="error-text">{t('ticketRequests.requestsLoadError')}</p>
        <button type="button" className="button" disabled={requestsFetching} onClick={() => void refetch()}>
          {t('common:actions.retry')}
        </button>
      </div>
    );
  }

  const displayedRequests =
    ownForEvent.length > 0 ? ownForEvent : create.data ? [create.data] : [];
  const hasActive = displayedRequests.some((r) => ACTIVE.has(r.status));
  // Epuizarea anunțată de server la creare NU închide formularul (poate merge
  // cu mai puține bilete); închiderea și pauza, da.
  const salesBlock = blockedByServer ?? sales.block;
  const salesClosed = salesBlock !== null;
  const notice = salesBlock ? salesNotice(salesBlock, blockedByServer !== null) : null;
  const showForm = !salesClosed && !hasActive && (displayedRequests.length === 0 || wantsAnother);
  const price = event.ticketPrice ?? 0;
  const currency = event.ticketCurrency ?? 'lei';
  const fieldError = (key: keyof FormState) =>
    errors[key] ? (
      <span className="field__error" id={`tr-${key}-error`}>
        {errors[key]}
      </span>
    ) : null;
  const describedBy = (key: keyof FormState) => (errors[key] ? `tr-${key}-error` : undefined);

  return (
    <div className="tr-screen">
      <h1 className="title">{t('ticketRequests.title')}</h1>
      {displayedRequests.map((request) => (
        <RequestSummary key={request.id} request={request} />
      ))}

      {notice && !hasActive ? (
        <div
          className="tr-closed"
          role="status"
          data-testid={salesBlock === 'paused' ? 'request-sales-paused' : 'request-sales-closed'}
          data-sales-block={salesBlock}
        >
          <span className="tr-closed__icon" aria-hidden="true">
            {salesBlock === 'paused' ? <ClockIcon width={22} height={22} /> : <LockIcon width={22} height={22} />}
          </span>
          <div>
            <p className="tr-closed__title">{t(notice.title)}</p>
            <p className="tr-closed__body">{t(notice.body)}</p>
          </div>
        </div>
      ) : null}

      {!showForm && !salesClosed && !hasActive && displayedRequests.length > 0 ? (
        <button
          type="button"
          className="button button--ghost"
          data-testid="request-another-btn"
          onClick={() => setWantsAnother(true)}
        >
          {t('ticketRequests.newRequest')}
        </button>
      ) : null}

      {showForm ? (
        <form className="form tr-form" noValidate onSubmit={submit} data-testid="request-form">
          <section className="tr-card">
            <h2 className="tr-card__title">{event.title}</h2>
            <p>{formatEventDate(event.startsAt)}</p>
            <p>
              {event.venue} · {event.city}
            </p>
            <dl className="tr-totals">
              <dt>{t('ticketRequests.form.pricePerTicket')}</dt>
              <dd>{formatPrice(price, currency)}</dd>
              <dt>{t('ticketRequests.form.quantity')}</dt>
              <dd>{quantity}</dd>
              <dt>{t('ticketRequests.form.total')}</dt>
              <dd data-testid="request-total">{formatPrice(price * quantity, currency)}</dd>
            </dl>
          </section>
          <label className="field">
            <span className="field__label">
              {t('ticketRequests.form.fullName')} <span className="field__required">*</span>
            </span>
            <input
              className="input"
              name="name"
              autoComplete="name"
              maxLength={200}
              value={form.fullName}
              onChange={(e) => set('fullName', e.target.value)}
              aria-invalid={Boolean(errors.fullName)}
              aria-describedby={describedBy('fullName')}
              required
            />
            {fieldError('fullName')}
          </label>
          <label className="field">
            <span className="field__label">
              {t('ticketRequests.form.phone')} <span className="field__required">*</span>
            </span>
            <input
              className="input"
              type="tel"
              name="tel"
              autoComplete="tel"
              inputMode="tel"
              maxLength={40}
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              aria-invalid={Boolean(errors.phone)}
              aria-describedby={describedBy('phone')}
              required
            />
            {fieldError('phone')}
          </label>
          <label className="field">
            <span className="field__label">{t('ticketRequests.form.emailOptional')}</span>
            <input
              className="input"
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={describedBy('email')}
            />
            {fieldError('email')}
          </label>
          <div className="field">
            <label className="field__label" htmlFor="tr-quantity">
              {t('ticketRequests.form.quantity')} <span className="field__required">*</span>
            </label>
            <div className="tr-qty">
              <button
                type="button"
                className="tr-qty__btn"
                aria-label={t('ticketRequests.form.decrease')}
                disabled={quantity <= MIN_TICKETS}
                onClick={() => step(-1)}
                data-testid="request-qty-minus"
              >
                −
              </button>
              <input
                id="tr-quantity"
                className="input tr-qty__input"
                type="number"
                min={MIN_TICKETS}
                max={MAX_TICKETS}
                inputMode="numeric"
                value={form.ticketQuantity}
                onChange={(e) => set('ticketQuantity', e.target.value)}
                aria-invalid={Boolean(errors.ticketQuantity)}
                aria-describedby={describedBy('ticketQuantity')}
                data-testid="request-qty"
              />
              <button
                type="button"
                className="tr-qty__btn"
                aria-label={t('ticketRequests.form.increase')}
                disabled={quantity >= MAX_TICKETS}
                onClick={() => step(1)}
                data-testid="request-qty-plus"
              >
                +
              </button>
            </div>
            {fieldError('ticketQuantity')}
          </div>
          <label className="field">
            <span className="field__label">{t('ticketRequests.form.messageOptional')}</span>
            <textarea
              className="input input--multiline"
              maxLength={500}
              value={form.clientMessage}
              onChange={(e) => set('clientMessage', e.target.value)}
            />
          </label>
          {soldOutByServer ? (
            <p className="error-text" role="alert" data-testid="request-sold-out">
              {t('ticketRequests.errors.soldOut')}
            </p>
          ) : create.isError && !blockedByServer ? (
            <p className="error-text" role="alert">
              {t('ticketRequests.form.submitFailed')}
            </p>
          ) : null}
          <button className="button" type="submit" disabled={create.isPending} data-testid="request-submit">
            {create.isPending ? t('ticketRequests.form.submitting') : t('ticketRequests.form.submit')}
          </button>
        </form>
      ) : null}
    </div>
  );
}
