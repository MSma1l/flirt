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
 * intrare să se facă verde singur. O comandă ÎN VERIFICARE se reinterogă rar
 * (~30 s), ca aprobarea să apară fără ca omul să iasă și să revină; la
 * întoarcerea în aplicație (din aplicația băncii) datele se reîmprospătează.
 *
 * Fiecare card răspunde dintr-o privire la „în ce stare e biletul meu și ce
 * fac acum": eticheta colorată (culoare + text) și pasul următor, scris.
 *
 * Stările sunt oneste pe fiecare secțiune: biletul se poate încărca chiar dacă
 * lista de comenzi cade, și invers.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { formatEventDate } from '@/features/events/eventFormat';
import { EVENTS_PATH } from '@/features/events/eventRoutes';
import { salesNotice, salesRefusal, useSalesState, type SalesBlock } from '@/features/events/ticketSales';
import { formatPrice } from '@/features/loyalty/priceFormat';
import { ProofUpload } from '@/features/ticketRequests/ProofUpload';

import { OrderStepper } from './OrderStepper';
import { PaymentDetails } from './PaymentDetails';
import { ChevronIcon, ClockIcon, LockIcon, TicketIcon } from './TicketIcons';
import { TicketPass } from './TicketPass';
import {
  hasEventStarted,
  isRequestOnlyStatus,
  orderStage,
  type OrderStage,
} from './orderStage';
import { useOrderStatusText } from './orderStatusLabel';
import { TICKET_ORDER_PARAM } from './ticketRoutes';
import {
  createTicketOrder,
  fetchEvent,
  fetchMyTicketOrdersWithEvent,
  fetchMyTicketRequests,
  fetchTicket,
  fetchTicketOrder,
  uploadOrderProof,
  type EventItem,
  type PaymentInstructions,
  type PaymentMethod,
  type Ticket,
  type TicketOrderDetail,
  type TicketOrderListItem,
  type TicketRequest,
} from './ticketsApi';

import './tickets.css';

/** Cât de des reîntrebăm serverul cât timp un bilet valid e pe ecran. */
export const LIVE_TICKET_POLL_MS = 5000;

/** Cât de des reîntrebăm serverul cât timp plata e în verificare. */
export const REVIEW_POLL_MS = 30_000;

/**
 * O comandă rămâne „actuală" (sus în listă) până la 12 h după începutul
 * evenimentului — cât ține o petrecere; biletul se arată la intrare chiar și
 * după ora de început.
 */
const RELEVANT_AFTER_START_MS = 12 * 60 * 60 * 1000;

/** Comenzile la evenimente viitoare (sau în desfășurare) întâi, restul după. */
export function sortOrdersForDisplay<T extends { eventStartsAt: string }>(orders: readonly T[], now = Date.now()): T[] {
  const isPast = (o: T) => {
    const time = new Date(o.eventStartsAt).getTime();
    return Number.isFinite(time) && now - time > RELEVANT_AFTER_START_MS;
  };
  // Sortare stabilă: în fiecare grup rămâne ordinea serverului (cea mai nouă prima).
  return [...orders.filter((o) => !isPast(o)), ...orders.filter(isPast)];
}

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
    refetchOnWindowFocus: true,
    // Doar un bilet declarat VALID de server poate „deveni verde" la intrare.
    refetchInterval: (query) =>
      query.state.data?.status === 'valid' ? LIVE_TICKET_POLL_MS : false,
  });

  let body: ReactElement;
  if (isPending) {
    body = (
      <div className="tk-state">
        <div className="spinner" role="status" aria-label={t('screens:tickets.loading')} />
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

/** Un bloc de etapă: titlu (cu icon opțional) + conținut, colorat după etapă. */
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

/** Evenimentul a început: nu mai cerem nimic online, spunem ce rămâne de făcut. */
function ClosedOrderBlock() {
  const { t } = useTranslation('screens');
  return (
    <div className="tk-closed" data-testid="order-closed" role="status">
      <span className="tk-closed__icon" aria-hidden="true">
        <LockIcon width={20} height={20} />
      </span>
      <div>
        <p className="tk-closed__title">{t('tickets.closedOrder.title')}</p>
        <p className="tk-closed__body">{t('tickets.closedOrder.body')}</p>
      </div>
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
  // Metoda aleasă în datele de plată (MIA / IBAN) — trimisă odată cu chitanța.
  const [payMethod, setPayMethod] = useState<PaymentMethod | null>(null);

  const { data, isPending, isError, refetch, isFetching } = useQuery<TicketOrderDetail>({
    queryKey: ['ticket-order', item.id],
    queryFn: () => fetchTicketOrder(item.id),
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const order = query.state.data?.order;
      if (!order) return false;
      if (order.status === 'approved' && order.ticketStatus === 'valid') return LIVE_TICKET_POLL_MS;
      return orderStage(order.status) === 'review' ? REVIEW_POLL_MS : false;
    },
  });

  // Detaliul a adus o stare nouă (aprobată, respinsă, scanată la intrare):
  // și cardul din listă trebuie să o arate, nu pe cea veche.
  const fresh = data?.order;
  const listStale =
    fresh !== undefined &&
    (fresh.status !== item.status || (fresh.ticketStatus ?? null) !== (item.ticketStatus ?? null));
  useEffect(() => {
    if (listStale) void queryClient.invalidateQueries({ queryKey: ['ticket-orders'] });
  }, [listStale, queryClient]);

  const eventId = data?.order.eventId ?? item.eventId;
  const { data: event } = useQuery<EventItem>({
    queryKey: ['event', eventId],
    queryFn: () => fetchEvent(eventId ?? ''),
    enabled: Boolean(eventId),
  });
  const sales = useSalesState(event ?? {});

  const [salesClosed, setSalesClosed] = useState<SalesBlock | null>(null);
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
      const reason = salesRefusal(error);
      if (reason) {
        setSalesClosed(reason);
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
          <div className="spinner" role="status" aria-label={t('screens:tickets.loading')} />
        </div>
      </div>
    );
  }

  if (isError || !data || !order) {
    return (
      <div className="tk-detail" data-testid="order-detail">
        <div className="tk-state" role="alert">
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
  const eventStarted = hasEventStarted(event?.startsAt ?? item.eventStartsAt);
  // Toate chitanțele pleacă pe `/ticket-orders/{id}/payment-proof`: ruta
  // acceptă și comenzile directe, și cererile manuale, și păstrează metoda
  // aleasă (MIA / IBAN) — ruta istorică a cererilor o ignoră.
  const proofUploader = uploadOrderProof;

  let content: ReactElement;
  switch (stage) {
    case 'ordered': {
      if (eventStarted) {
        // Serverul ar refuza orice chitanță (`409 event_started`): nu mai
        // arătăm date de plată și formulare care nu duc nicăieri.
        content = <ClosedOrderBlock />;
        break;
      }
      // Datele bancare: din detaliu (serverul le dă cât timp se mai așteaptă
      // plata), din cache-ul creării (cerere manuală), sau, în lipsă, ce știe
      // cererea însăși (sumă, destinație, telefon/cont).
      const bank =
        data.payment ??
        queryClient.getQueryData<PaymentInstructions>(['ticket-request-payment', item.id]) ??
        null;
      const amount = bank?.amount ?? request?.total_amount ?? order.price ?? 0;
      const currency = bank?.currency ?? request?.currency ?? order.currency ?? 'lei';
      const purpose = bank?.commentTemplate ?? request?.payment?.payment_description ?? null;
      const deadline = event?.ticketSalesEndAt ?? event?.startsAt ?? item.eventStartsAt ?? null;
      const hasAnything = Boolean(bank || purpose || request);
      const moreInfo = order.status === 'additional_information_required';

      content = (
        <>
          {moreInfo ? (
            <div className="tk-notice" data-testid="order-more-info" role="status">
              <strong>{t('screens:tickets.moreInfo.title')}</strong>
              <span className="tk-selectable">{adminNote ?? t('screens:tickets.moreInfo.body')}</span>
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
                miaPhone={bank?.miaPhone}
                miaRecipientName={bank?.miaRecipientName}
                miaQrUrl={bank?.miaQrUrl}
                methods={bank?.methods}
                onMethodChange={setPayMethod}
                finalStep="proof"
              />
            </>
          ) : moreInfo ? null : (
            <p className="tk-note">{t('social:ticket.instructionsUnavailable')}</p>
          )}
          {/* Chitanța e obligatorie pe orice comandă: ea trece plata în
              verificare. Formularul rămâne și când datele de plată lipsesc
              (ex. „mai multe informații" pe o comandă deja plătită). */}
          <ProofUpload requestId={item.id} upload={proofUploader} method={payMethod} />
        </>
      );
      break;
    }
    case 'review': {
      // O comandă declarată „am plătit" fără chitanță (aplicația nativă) încă
      // NU poate fi confirmată: chitanța e obligatorie, deci o cerem limpede.
      const missingProof = !isRequest && order.paymentProofUploaded === false && order.status === 'payment_declared';
      content = (
        <StageBlock
          testId="order-in-review"
          tone="review"
          icon={<ClockIcon width={22} height={22} />}
          title={t('social:ticket.review.title')}
        >
          {missingProof && !eventStarted ? (
            <ProofUpload
              requestId={item.id}
              upload={proofUploader}
              title={t('screens:tickets.review.missingProofTitle')}
              intro={t('screens:tickets.review.missingProofBody')}
            />
          ) : (
            <>
              <p className="tk-note">
                {isRequest || order.paymentProofUploaded
                  ? t('screens:tickets.review.proofBody')
                  : t('social:ticket.review.body')}
              </p>
              {/* Chitanța greșită se poate înlocui cât timp plata e în
                  verificare (serverul păstrează ultima). Ascunsă implicit:
                  pentru cei mai mulți nu mai e nimic de făcut. */}
              {eventStarted ? null : (
                <details className="tk-more" data-testid="order-replace-proof">
                  <summary className="tk-more__summary">{t('screens:tickets.review.replace')}</summary>
                  <ProofUpload requestId={item.id} upload={proofUploader} showSuccess />
                </details>
              )}
            </>
          )}
        </StageBlock>
      );
      break;
    }
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
    case 'rejected': {
      // Cererea manuală își poate retrimite chitanța; comanda directă se reia
      // cu o comandă nouă — doar cât timp vânzarea online e deschisă.
      const directBlock = salesClosed ?? sales.block;
      content = (
        <StageBlock testId="order-rejected" tone="rejected" title={t('social:ticket.rejected.title')}>
          <div className="tk-reason" data-testid="order-reject-reason">
            <span className="tk-eyebrow">{t('screens:tickets.rejected.reason')}</span>
            <span>{adminNote ?? t('screens:tickets.rejected.noReason')}</span>
          </div>
          {isRequest ? (
            eventStarted ? (
              <ClosedOrderBlock />
            ) : (
              <>
                <p className="tk-note">{t('screens:tickets.rejected.whatToDoProof')}</p>
                <ProofUpload requestId={item.id} upload={proofUploader} />
              </>
            )
          ) : directBlock ? (
            <p
              className="tk-note"
              data-testid={directBlock === 'paused' ? 'order-sales-paused' : 'order-sales-closed'}
            >
              {t(salesNotice(directBlock, salesClosed !== null).body)}
            </p>
          ) : (
            <>
              <p className="tk-note">{t('screens:tickets.rejected.whatToDo')}</p>
              {retry.isError ? (
                <p className="error-text" role="alert">
                  {t('social:ticket.retryError')}
                </p>
              ) : null}
              <button
                type="button"
                className="button tk-cta"
                disabled={retry.isPending || !eventId}
                onClick={() => {
                  if (!retry.isPending) retry.mutate();
                }}
                data-testid="order-retry-btn"
              >
                {t('social:ticket.rejected.retry')}
              </button>
            </>
          )}
        </StageBlock>
      );
      break;
    }
    case 'cancelled':
      content = (
        <StageBlock testId="order-cancelled" tone="cancelled" title={t('screens:tickets.cancelled.title')}>
          {adminNote ? (
            <div className="tk-reason">
              <span className="tk-eyebrow">{t('screens:tickets.rejected.reason')}</span>
              <span>{adminNote}</span>
            </div>
          ) : null}
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
  const statusText = useOrderStatusText();
  const stage = orderStage(order.status);
  const { label, next, tone } = statusText(order, hasEventStarted(order.eventStartsAt));
  const amount = request?.total_amount ?? order.price;
  const price = amount !== null && amount !== undefined ? formatPrice(amount, order.currency ?? request?.currency ?? 'lei') : null;
  const ref = useRef<HTMLLIElement>(null);
  const detailId = useId();

  // Comanda deschisă din alt ecran (`?order=`) trebuie să se și VADĂ.
  useEffect(() => {
    if (selected && typeof ref.current?.scrollIntoView === 'function') {
      ref.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    // Doar la deschidere, nu la fiecare reîmprospătare.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return (
    <li ref={ref} className={`tk-order tk-order--${tone}${selected ? ' tk-order--open' : ''}`}>
      <button
        type="button"
        className="tk-order__card"
        aria-expanded={selected}
        aria-controls={selected ? detailId : undefined}
        data-testid={`order-row-${order.id}`}
        onClick={() => onToggle(order.id)}
      >
        <span className="tk-order__main">
          <span className="tk-order__title">{order.eventTitle}</span>
          <span className="tk-order__date">{formatEventDate(order.eventStartsAt)}</span>
          <span className="tk-order__status-row">
            <span className={`tk-pill tk-pill--${tone}`} data-testid={`order-status-${order.id}`}>
              {label}
            </span>
            <OrderStepper stage={stage} hasCode={Boolean(order.ticketCode)} compact />
          </span>
          <span className="tk-order__next" data-testid={`order-next-${order.id}`}>
            {next}
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
      {selected ? (
        <div id={detailId}>
          <OrderDetail item={order} request={request} onSelect={onSelect} />
        </div>
      ) : null}
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
    refetchOnWindowFocus: true,
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

  const orders = useMemo(() => sortOrdersForDisplay(data ?? []), [data]);
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
      <div className="tk-state" data-testid="orders-error" role="alert">
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
