/**
 * Biletele mele, în Mini App (TZ secț. 6.3).
 *
 * Un singur ecran (`/tickets`), două secțiuni:
 *   1. comenzile de bilete la evenimente — fiecare un card în formă de bilet,
 *      cu cronologia Comandat → Plătit → Aprobat → Bilet; apăsat, se desface
 *      SUB el detaliul etapei curente: datele de plată (cu copiere), dovada,
 *      așteptarea, biletul cu QR sau motivul refuzului;
 *   2. biletul propriu Flirt Party, ca pass cu QR.
 *
 * `?order=<id>` deschide direct o comandă — așa ajunge omul aici din pagina
 * evenimentului, imediat după „Cumpără bilet".
 *
 * Cât timp un bilet VALID e pe ecran, îl reinterogăm la ~5 s (doar cu ecranul
 * vizibil — React Query oprește intervalul în fundal), ca la scanarea de la
 * intrare să se facă verde singur.
 *
 * Stările sunt oneste pe fiecare secțiune: biletul se poate încărca chiar dacă
 * lista de comenzi cade, și invers.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { formatEventDate } from '@/features/events/eventFormat';
import { EVENTS_PATH } from '@/features/events/eventRoutes';
import { ConfirmModal } from '@/features/social/ConfirmModal';
import { ProofUpload } from '@/features/ticketRequests/ProofUpload';

import { OrderStepper } from './OrderStepper';
import { PaymentDetails } from './PaymentDetails';
import { ChevronIcon, ClockIcon, TicketIcon } from './TicketIcons';
import { TicketPass } from './TicketPass';
import {
  isEventStartedError,
  isRequestOnlyStatus,
  isTicketSalesClosedError,
  orderStage,
  type OrderStage,
} from './orderStage';
import { useOrderStatusLabel } from './orderStatusLabel';
import { TICKET_ORDER_PARAM } from './ticketRoutes';
import {
  createTicketOrder,
  declareTicketPayment,
  fetchEvent,
  fetchMyTicketOrdersWithEvent,
  fetchMyTicketRequests,
  fetchTicket,
  fetchTicketOrder,
  uploadPaymentProof,
  type EventItem,
  type PaymentInstructions,
  type Ticket,
  type TicketOrderDetail,
  type TicketOrderListItem,
  type TicketRequest,
} from './ticketsApi';

import './tickets.css';

/** Cât de des reîntrebăm serverul cât timp un bilet valid e pe ecran. */
export const LIVE_TICKET_POLL_MS = 5000;

/* ------------------------------------------------- „deschiderea" biletului */

const REVEALED_KEY = 'flirt.tickets.revealed';

function readRevealed(): string[] {
  try {
    const raw = window.localStorage.getItem(REVEALED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * `true` o singură dată per bilet: prima oară când omul își vede biletul
 * aprobat. Ținut în `localStorage` (cu try/catch — în WebView poate lipsi);
 * fără stocare, animația doar se repetă, nimic nu se strică.
 */
function useFirstReveal(id: string, ready: boolean): boolean {
  const [reveal, setReveal] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const seen = readRevealed();
    if (seen.includes(id)) return;
    setReveal(true);
    try {
      window.localStorage.setItem(REVEALED_KEY, JSON.stringify([...seen, id].slice(-50)));
    } catch {
      /* stocare indisponibilă — animația se va repeta, atât */
    }
  }, [id, ready]);
  return reveal;
}

/* ------------------------------------------------------- biletul Flirt Party */

function MyTicketSection() {
  const { t } = useTranslation(['social', 'screens']);

  const { data, isPending, isError, refetch, isFetching } = useQuery<Ticket>({
    queryKey: ['ticket'],
    queryFn: fetchTicket,
    // Doar un bilet declarat VALID de server poate „deveni verde" la intrare.
    refetchInterval: (query) =>
      query.state.data?.status === 'valid' ? LIVE_TICKET_POLL_MS : false,
  });

  let body: ReactElement;
  if (isPending) {
    body = (
      <div className="tk-state">
        <div className="spinner" role="status" aria-label={t('social:myTicket.title')} />
      </div>
    );
  } else if (isError || !data) {
    body = (
      <div className="tk-state" data-testid="ticket-error">
        <p className="error-text">{t('social:myTicket.loadError')}</p>
        <button type="button" className="button" disabled={isFetching} onClick={() => void refetch()}>
          {t('social:myTicket.retry')}
        </button>
      </div>
    );
  } else {
    body = (
      <TicketPass
        code={data.code}
        title={t('screens:events.kind.flirt_party')}
        eyebrow={t('screens:tickets.pass.membership')}
        status={data.status ?? null}
        legacyUsed={data.status ? undefined : data.used}
        admittedAt={data.admittedAt ?? null}
        testId="my-ticket-pass"
      />
    );
  }

  return (
    <section className="tk-section">
      <h2 className="tk-section__title">{t('social:myTicket.title')}</h2>
      <p className="tk-section__hint">{t('social:myTicket.hint')}</p>
      {body}
    </section>
  );
}

/* --------------------------------------------- detaliul unei comenzi de bilet */

/** Butonul „Am făcut transferul" + confirmarea lui (cumpărarea directă). */
function DeclareAction({ orderId }: { orderId: string }) {
  const { t } = useTranslation(['social', 'screens']);
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const declare = useMutation({
    mutationFn: () => declareTicketPayment(orderId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ticket-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['ticket-order', orderId] });
    },
    // Fereastra se închide și la eșec: eroarea are locul ei în pagină.
    onSettled: () => setConfirming(false),
  });

  return (
    <>
      {declare.isError ? (
        <p className="error-text" role="alert">
          {isEventStartedError(declare.error)
            ? t('screens:tickets.eventStarted')
            : t('social:ticket.declareError')}
        </p>
      ) : null}
      <button
        type="button"
        className="button tk-cta"
        disabled={declare.isPending}
        onClick={() => setConfirming(true)}
        data-testid="declare-btn"
      >
        {t('social:ticket.pay.declare')}
      </button>
      {/*
       * „Am făcut transferul" trece comanda în coada adminului și nu se ia
       * înapoi → confirmare deliberată, prin ConfirmModal (nu `confirm()`, care
       * îngheață WebView-ul Telegram).
       */}
      <ConfirmModal
        open={confirming}
        title={t('screens:tickets.declareConfirm.title')}
        body={t('screens:tickets.declareConfirm.body')}
        confirmLabel={t('social:ticket.pay.declare')}
        busy={declare.isPending}
        onConfirm={() => declare.mutate()}
        onCancel={() => setConfirming(false)}
        testId="declare-confirm"
      />
    </>
  );
}

function StageBlock({
  testId,
  tone,
  icon,
  title,
  children,
}: {
  testId: string;
  tone: OrderStage;
  icon?: ReactElement;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={`tk-block tk-block--${tone}`} data-testid={testId}>
      <h3 className="tk-block__title">
        {icon ? <span className="tk-block__icon">{icon}</span> : null}
        {title}
      </h3>
      {children}
    </div>
  );
}

function OrderDetail({
  item,
  request,
  onSelect,
}: {
  item: TicketOrderListItem;
  request: TicketRequest | undefined;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation(['social', 'screens', 'events']);
  const queryClient = useQueryClient();

  const { data, isPending, isError, refetch, isFetching } = useQuery<TicketOrderDetail>({
    queryKey: ['ticket-order', item.id],
    queryFn: () => fetchTicketOrder(item.id),
    refetchInterval: (query) => {
      const order = query.state.data?.order;
      return order?.status === 'approved' && order.ticketStatus === 'valid'
        ? LIVE_TICKET_POLL_MS
        : false;
    },
  });

  const eventId = data?.order.eventId ?? item.eventId;
  const { data: event } = useQuery<EventItem>({
    queryKey: ['event', eventId],
    queryFn: () => fetchEvent(eventId ?? ''),
    enabled: Boolean(eventId),
  });

  const [salesClosed, setSalesClosed] = useState(false);
  const retry = useMutation({
    mutationFn: async () => {
      if (!eventId) throw new Error('missing event');
      return createTicketOrder(eventId);
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['ticket-orders'] });
      // Comanda veche e moartă; deschidem direct comanda nouă, cu instrucțiuni.
      onSelect(result.order.id);
    },
    onError: (error) => {
      if (isTicketSalesClosedError(error)) {
        setSalesClosed(true);
        if (eventId) void queryClient.invalidateQueries({ queryKey: ['event', eventId] });
      }
    },
  });

  const order = data?.order;
  const ready = Boolean(order && order.status === 'approved' && order.ticketCode);
  const reveal = useFirstReveal(item.id, ready);

  if (isPending) {
    return (
      <div className="tk-detail" data-testid="order-detail">
        <div className="tk-state">
          <div className="spinner" role="status" aria-label={t('social:ticket.pay.title')} />
        </div>
      </div>
    );
  }

  if (isError || !data || !order) {
    return (
      <div className="tk-detail" data-testid="order-detail">
        <div className="tk-state">
          <p className="error-text">{t('social:ticket.loadError')}</p>
          <button type="button" className="button" disabled={isFetching} onClick={() => void refetch()}>
            {t('social:ticket.retry')}
          </button>
        </div>
      </div>
    );
  }

  const stage = orderStage(order.status);
  const isRequest = Boolean(request) || isRequestOnlyStatus(order.status);
  const adminNote = order.adminNote ?? request?.admin_comment ?? null;

  let content: ReactElement;
  switch (stage) {
    case 'ordered': {
      // Datele bancare: din detaliu (cumpărare directă), din cache-ul creării
      // (cerere manuală — serverul nu le mai retrimite în listă), sau, în lipsă,
      // ce știe cererea însăși (sumă, destinație, telefon/cont).
      const bank =
        data.payment ??
        queryClient.getQueryData<PaymentInstructions>(['ticket-request-payment', item.id]) ??
        null;
      const amount = bank?.amount ?? request?.total_amount ?? order.price ?? 0;
      const currency = bank?.currency ?? request?.currency ?? order.currency ?? 'lei';
      const purpose = bank?.commentTemplate ?? request?.payment?.payment_description ?? null;
      const deadline = event?.ticketSalesEndAt ?? event?.startsAt ?? item.eventStartsAt ?? null;
      const hasAnything = Boolean(bank || purpose || request);

      content = (
        <>
          {order.status === 'additional_information_required' ? (
            <div className="tk-notice" data-testid="order-more-info">
              <strong>{t('screens:tickets.moreInfo.title')}</strong>
              <span>{adminNote ?? t('screens:tickets.moreInfo.body')}</span>
            </div>
          ) : null}
          {hasAnything ? (
            <>
              <h3 className="tk-block__title">{t('social:ticket.pay.title')}</h3>
              <PaymentDetails
                amount={amount}
                currency={currency}
                beneficiary={bank?.beneficiary}
                iban={bank?.iban}
                bankName={bank?.bankName}
                purpose={purpose}
                reference={bank?.reference ?? item.reference ?? null}
                phone={bank ? null : request?.payment?.phone}
                accountDetails={bank ? null : request?.payment?.account_details}
                instructions={bank?.instructions ?? request?.payment?.instructions ?? null}
                deadline={deadline}
                finalStep={isRequest ? 'proof' : 'declare'}
              />
              {isRequest ? (
                <ProofUpload requestId={item.id} upload={uploadPaymentProof} />
              ) : (
                <DeclareAction orderId={item.id} />
              )}
            </>
          ) : (
            <p className="tk-note">{t('social:ticket.instructionsUnavailable')}</p>
          )}
        </>
      );
      break;
    }
    case 'review':
      content = (
        <StageBlock
          testId="order-in-review"
          tone="review"
          icon={<ClockIcon width={22} height={22} />}
          title={t('social:ticket.review.title')}
        >
          <p className="tk-note">
            {isRequest ? t('screens:tickets.review.proofBody') : t('social:ticket.review.body')}
          </p>
        </StageBlock>
      );
      break;
    case 'approved':
      content = (
        <StageBlock testId="order-approved" tone="approved" title={t('social:ticket.approved.title')}>
          {order.ticketCode ? (
            <>
              <p className="tk-note">{t('social:ticket.approved.body')}</p>
              <TicketPass
                code={order.ticketCode}
                title={item.eventTitle || event?.title || ''}
                startsAt={event?.startsAt ?? item.eventStartsAt}
                venue={event?.venue ?? request?.event_venue ?? null}
                holder={request?.full_name ?? null}
                admits={request?.ticket_quantity ?? null}
                status={order.ticketStatus ?? null}
                admittedAt={order.admittedAt ?? null}
                reveal={reveal}
                statusTestId="order-ticket-status"
                testId="order-ticket-pass"
              />
            </>
          ) : (
            <p className="tk-note">{t('screens:tickets.approvedPending')}</p>
          )}
        </StageBlock>
      );
      break;
    case 'rejected':
      content = (
        <StageBlock testId="order-rejected" tone="rejected" title={t('social:ticket.rejected.title')}>
          <div className="tk-reason" data-testid="order-reject-reason">
            <span className="tk-eyebrow">{t('screens:tickets.rejected.reason')}</span>
            <span>{adminNote ?? t('screens:tickets.rejected.noReason')}</span>
          </div>
          <p className="tk-note">
            {isRequest ? t('screens:tickets.rejected.whatToDoProof') : t('screens:tickets.rejected.whatToDo')}
          </p>
          {isRequest ? (
            <ProofUpload requestId={item.id} upload={uploadPaymentProof} />
          ) : salesClosed ? (
            <p className="tk-note" data-testid="order-sales-closed">
              {t('screens:events.sales.closedError')}
            </p>
          ) : (
            <>
              {retry.isError ? <p className="error-text">{t('social:ticket.retryError')}</p> : null}
              <button
                type="button"
                className="button tk-cta"
                disabled={retry.isPending || !eventId}
                onClick={() => retry.mutate()}
                data-testid="order-retry-btn"
              >
                {t('social:ticket.rejected.retry')}
              </button>
            </>
          )}
        </StageBlock>
      );
      break;
    case 'cancelled':
      content = (
        <StageBlock testId="order-cancelled" tone="cancelled" title={t('screens:tickets.cancelled.title')}>
          <p className="tk-note">{t('screens:tickets.cancelled.body')}</p>
          <Link className="button button--ghost tk-link" to={EVENTS_PATH}>
            {t('screens:tickets.seeEvents')}
          </Link>
        </StageBlock>
      );
      break;
  }

  return (
    <div className="tk-detail" data-testid="order-detail">
      <OrderStepper stage={stage} hasCode={Boolean(order.ticketCode)} />
      {content}
    </div>
  );
}

/* -------------------------------------------------------------- lista + ecran */

function OrderCard({
  order,
  request,
  selected,
  onToggle,
  onSelect,
}: {
  order: TicketOrderListItem;
  request: TicketRequest | undefined;
  selected: boolean;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const statusLabel = useOrderStatusLabel();
  const stage = orderStage(order.status);
  const amount = request?.total_amount ?? order.price;
  const price = amount !== null && amount !== undefined && order.currency ? `${amount} ${order.currency}` : null;
  const ref = useRef<HTMLLIElement>(null);

  // Comanda deschisă din alt ecran (`?order=`) trebuie să se și VADĂ.
  useEffect(() => {
    if (selected && typeof ref.current?.scrollIntoView === 'function') {
      ref.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    // Doar la deschidere, nu la fiecare reîmprospătare.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return (
    <li ref={ref} className={`tk-order tk-order--${stage}${selected ? ' tk-order--open' : ''}`}>
      <button
        type="button"
        className="tk-order__card"
        aria-expanded={selected}
        data-testid={`order-row-${order.id}`}
        onClick={() => onToggle(order.id)}
      >
        <span className="tk-order__main">
          <span className="tk-order__title">{order.eventTitle}</span>
          <span className="tk-order__date">{formatEventDate(order.eventStartsAt)}</span>
          <span className="tk-order__status-row">
            <OrderStepper stage={stage} hasCode={Boolean(order.ticketCode)} compact />
            <span className={`tk-pill tk-pill--${stage}`}>{statusLabel(order.status)}</span>
          </span>
        </span>
        <span className="tk-order__stub">
          {stage === 'approved' ? (
            <span className="tk-order__ticket-icon">
              <TicketIcon width={26} height={26} />
            </span>
          ) : price ? (
            <span className="tk-order__price">{price}</span>
          ) : null}
          <ChevronIcon className="tk-order__chev" width={18} height={18} />
        </span>
      </button>
      {selected ? <OrderDetail item={order} request={request} onSelect={onSelect} /> : null}
    </li>
  );
}

function OrdersSection() {
  const { t } = useTranslation(['social', 'screens']);
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(
    () => searchParams.get(TICKET_ORDER_PARAM),
  );

  const { data, isPending, isError, refetch, isFetching } = useQuery<TicketOrderListItem[]>({
    queryKey: ['ticket-orders'],
    queryFn: fetchMyTicketOrdersWithEvent,
  });

  // Cererile manuale aduc titularul, cantitatea, locul și mesajul adminului.
  // Opționale: dacă ruta cade, cardurile merg mai departe fără ele.
  const { data: requests } = useQuery<TicketRequest[]>({
    queryKey: ['ticket-requests'],
    queryFn: fetchMyTicketRequests,
  });
  const requestById = useMemo(
    () => new Map((requests ?? []).map((r) => [r.id, r])),
    [requests],
  );

  const orders = data ?? [];
  // Comanda selectată poate dispărea din listă (ex. după o reîncercare).
  const selected = orders.some((o) => o.id === selectedId) ? selectedId : null;

  let body: ReactElement;
  if (isPending) {
    body = (
      <div className="tk-state">
        <div className="spinner" role="status" aria-label={t('screens:tickets.ordersTitle')} />
      </div>
    );
  } else if (isError) {
    body = (
      <div className="tk-state" data-testid="orders-error">
        <p className="error-text">{t('screens:tickets.ordersLoadError')}</p>
        <button type="button" className="button" disabled={isFetching} onClick={() => void refetch()}>
          {t('social:ticket.retry')}
        </button>
      </div>
    );
  } else if (orders.length === 0) {
    body = (
      <div className="tk-state tk-empty" data-testid="orders-empty">
        <span className="tk-empty__icon" aria-hidden="true">
          <TicketIcon width={30} height={30} />
        </span>
        <p className="tk-note">{t('screens:tickets.ordersEmpty')}</p>
        <Link className="button button--ghost tk-link" to={EVENTS_PATH}>
          {t('screens:tickets.seeEvents')}
        </Link>
      </div>
    );
  } else {
    body = (
      <ul className="tk-orders">
        {orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            request={requestById.get(order.id)}
            selected={order.id === selected}
            onToggle={(id) => setSelectedId((current) => (current === id ? null : id))}
            onSelect={setSelectedId}
          />
        ))}
      </ul>
    );
  }

  return (
    <section className="tk-section">
      <h2 className="tk-section__title">{t('screens:tickets.ordersTitle')}</h2>
      {body}
    </section>
  );
}

export function TicketsScreen() {
  const { t } = useTranslation('screens');
  return (
    <div className="tk-screen">
      <h1 className="tk-screen__title">{t('tickets.screenTitle')}</h1>
      <OrdersSection />
      <MyTicketSection />
    </div>
  );
}

export default TicketsScreen;
