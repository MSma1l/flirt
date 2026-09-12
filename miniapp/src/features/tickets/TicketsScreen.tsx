/**
 * Biletele mele, în Mini App (TZ secț. 6.3).
 *
 * PORT COMBINAT al două ecrane native, pe o singură rută (`/tickets`):
 *   1. `mobile/app/ticket.tsx`       → biletul propriu Flirt Party, cu QR;
 *   2. `mobile/app/tickets/[id].tsx` → o comandă de bilet la un eveniment.
 *
 * DE CE într-un singur ecran: harta rutelor (`src/routes.tsx`) aparține altui
 * agent, iar modulul are o singură cale declarată (`ticketRoutes.ts`). În loc să
 * cerem o a doua rută parametrizată, comanda selectată se deschide într-un
 * panou de detaliu SUB listă, în același ecran. Efectul secundar e bun: omul
 * vede și biletul, și comenzile, fără navigare.
 *
 * Stările sunt oneste pe fiecare secțiune în parte: biletul se poate încărca
 * chiar dacă lista de comenzi cade, și invers — o eroare de rețea la una nu are
 * voie să golească ecranul celeilalte.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { formatEventDate } from '@/features/events/eventFormat';
import { EVENTS_PATH } from '@/features/events/eventRoutes';
import { ConfirmModal } from '@/features/social/ConfirmModal';

import { QrCode } from './QrCode';
import {
  createTicketOrder,
  declareTicketPayment,
  fetchMyTicketOrdersWithEvent,
  fetchTicket,
  fetchTicketOrder,
  type PaymentInstructions,
  type Ticket,
  type TicketOrderDetail,
  type TicketOrderListItem,
  type TicketOrderStatus,
} from './ticketsApi';

import './tickets.css';

/** Cât rămâne aprins indiciul „Copiat" după o copiere reușită. */
const COPY_FEEDBACK_MS = 1600;

/* ------------------------------------------------------------------ copiere */

/**
 * Copiere în clipboard cu indiciu vizual scurt.
 *
 * În WebView-ul Telegram `navigator.clipboard` poate lipsi cu totul (context
 * ne-securizat pe unele instalări Android) sau poate fi refuzat de utilizator.
 * De aceea totul e într-un `try/catch` și un eșec NU e o fundătură: valorile
 * rămân text selectabil (`user-select: text` în `tickets.css`), deci IBAN-ul se
 * poate copia oricum, cu degetul. Nu afișăm eroare — ar fi zgomot pentru ceva ce
 * utilizatorul poate face singur.
 */
function useCopy() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copy = useCallback((key: string, value: string) => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(value);
        setCopiedKey(key);
        window.setTimeout(
          () => setCopiedKey((current) => (current === key ? null : current)),
          COPY_FEEDBACK_MS,
        );
      } catch {
        // Clipboard indisponibil sau refuzat — câmpul rămâne selectabil.
        setCopiedKey(null);
      }
    })();
  }, []);

  return { copiedKey, copy };
}

/* ------------------------------------------------------- biletul Flirt Party */

function MyTicketSection() {
  const { t } = useTranslation('social');

  const { data, isPending, isError, refetch, isFetching } = useQuery<Ticket>({
    queryKey: ['ticket'],
    queryFn: fetchTicket,
  });

  let body: ReactElement;
  if (isPending) {
    body = (
      <div className="tk-state">
        <div className="spinner" role="status" aria-label={t('myTicket.title')} />
      </div>
    );
  } else if (isError || !data) {
    body = (
      <div className="tk-state" data-testid="ticket-error">
        <p className="error-text">{t('myTicket.loadError')}</p>
        <button
          type="button"
          className="button"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          {t('myTicket.retry')}
        </button>
      </div>
    );
  } else {
    body = (
      <div className="tk-card">
        <QrCode value={data.code} label={t('myTicket.code')} />
        <span
          className={`tk-badge ${data.used ? 'tk-badge--used' : 'tk-badge--free'}`}
          data-testid="ticket-status"
        >
          {data.used ? t('myTicket.used') : t('myTicket.unused')}
        </span>
      </div>
    );
  }

  return (
    <section className="tk-section">
      <h1 className="title">{t('myTicket.title')}</h1>
      <p className="body-text">{t('myTicket.hint')}</p>
      {body}
    </section>
  );
}

/* --------------------------------------------------------- comenzi de bilete */

/**
 * Eticheta stării unei comenzi.
 *
 * Primele trei chei există deja în catalogul `events` (folosite de cardul de
 * eveniment), deci le reutilizăm ca textul să fie identic în ambele locuri.
 * Pentru „respins" nu există o etichetă scurtă, așa că folosim titlul din
 * `social:ticket.rejected.title`.
 */
function useStatusLabel(): (status: TicketOrderStatus) => string {
  const { t } = useTranslation(['events', 'social']);
  return (status) => {
    switch (status) {
      case 'approved':
        return t('events:detail.ticketStatus.approved');
      case 'payment_declared':
        return t('events:detail.ticketStatus.declared');
      case 'awaiting_payment':
        return t('events:detail.ticketStatus.awaiting');
      case 'rejected':
        return t('social:ticket.rejected.title');
    }
  };
}

function OrderRow({
  order,
  selected,
  onSelect,
}: {
  order: TicketOrderListItem;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const statusLabel = useStatusLabel();
  const price =
    order.price !== null && order.currency ? `${order.price} ${order.currency}` : null;

  return (
    <li>
      <button
        type="button"
        className={`tk-row${selected ? ' tk-row--selected' : ''}`}
        aria-expanded={selected}
        data-testid={`order-row-${order.id}`}
        onClick={() => onSelect(order.id)}
      >
        <span className="tk-row__main">
          <span className="tk-row__title">{order.eventTitle}</span>
          <span className="caption">{formatEventDate(order.eventStartsAt)}</span>
        </span>
        <span className="tk-row__side">
          <span className={`tk-badge tk-badge--${order.status}`}>
            {statusLabel(order.status)}
          </span>
          {price ? <span className="caption">{price}</span> : null}
        </span>
      </button>
    </li>
  );
}

/* --------------------------------------------- detaliul unei comenzi de bilet */

/** Un rând etichetă + valoare, cu buton de copiere. */
function PayRow({
  label,
  value,
  mono,
  copyKey,
  copiedKey,
  onCopy,
  testId,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (key: string, value: string) => void;
  testId?: string;
}) {
  const copied = copiedKey === copyKey;
  return (
    <div className="tk-pay-row">
      <span className="caption">{label}</span>
      <div className="tk-pay-row__value">
        <span className={`tk-selectable${mono ? ' tk-mono' : ''}`} data-testid={testId}>
          {value}
        </span>
        <button
          type="button"
          className="tk-copy"
          onClick={() => onCopy(copyKey, value)}
          data-testid={`copy-${copyKey}`}
        >
          {/* Chei i18n inexistente pentru copiere — text în română, raportat. */}
          {copied ? 'Copiat' : 'Copiază'}
        </button>
      </div>
    </div>
  );
}

/** Instrucțiunile de plată + pașii numerotați + butonul de declarare. */
function AwaitingPayment({
  payment,
  declaring,
  declareFailed,
  onDeclare,
}: {
  payment: PaymentInstructions;
  declaring: boolean;
  declareFailed: boolean;
  onDeclare: () => void;
}) {
  const { t } = useTranslation('social');
  const { copiedKey, copy } = useCopy();
  const amountLabel = `${payment.amount} ${payment.currency}`;

  const steps = [
    t('ticket.pay.step1'),
    t('ticket.pay.step2', {
      amount: amountLabel,
      beneficiary: payment.beneficiary,
      iban: payment.iban,
    }),
    t('ticket.pay.step3', { comment: payment.commentTemplate }),
    t('ticket.pay.step4'),
  ];

  return (
    <div className="tk-block" data-testid="order-instructions">
      <h3 className="tk-block__title">{t('ticket.pay.title')}</h3>
      <p className="body-text">{t('ticket.pay.intro')}</p>

      <div className="tk-card tk-card--plain">
        <PayRow
          label={t('ticket.pay.beneficiary')}
          value={payment.beneficiary}
          copyKey="beneficiary"
          copiedKey={copiedKey}
          onCopy={copy}
        />
        <PayRow
          label={t('ticket.pay.iban')}
          value={payment.iban}
          mono
          copyKey="iban"
          copiedKey={copiedKey}
          onCopy={copy}
          testId="pay-iban"
        />
        {payment.bankName ? (
          <PayRow
            label={t('ticket.pay.bank')}
            value={payment.bankName}
            copyKey="bank"
            copiedKey={copiedKey}
            onCopy={copy}
          />
        ) : null}
        <PayRow
          label={t('ticket.pay.amount')}
          value={amountLabel}
          copyKey="amount"
          copiedKey={copiedKey}
          onCopy={copy}
          testId="pay-amount"
        />
        <PayRow
          label={t('ticket.pay.reference')}
          value={payment.reference}
          mono
          copyKey="reference"
          copiedKey={copiedKey}
          onCopy={copy}
          testId="pay-reference"
        />
        <PayRow
          label={t('ticket.pay.comment')}
          value={payment.commentTemplate}
          copyKey="comment"
          copiedKey={copiedKey}
          onCopy={copy}
          testId="pay-comment"
        />
      </div>

      {payment.instructions ? <p className="body-text">{payment.instructions}</p> : null}

      <ol className="tk-steps">
        {steps.map((step) => (
          <li key={step} className="tk-steps__item">
            <span className="tk-steps__text">{step}</span>
          </li>
        ))}
      </ol>

      {/* Eroarea mutației stă ÎN PAGINĂ, lângă buton: instrucțiunile de plată
          rămân pe ecran, ca omul să poată reîncerca fără să redeschidă comanda. */}
      {declareFailed ? <p className="error-text">{t('ticket.declareError')}</p> : null}

      <button
        type="button"
        className="button"
        disabled={declaring}
        onClick={onDeclare}
        data-testid="declare-btn"
      >
        {t('ticket.pay.declare')}
      </button>
    </div>
  );
}

function OrderDetailPanel({
  orderId,
  onSelect,
  onClose,
}: {
  orderId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation(['social', 'common']);
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const { data, isPending, isError, refetch, isFetching } = useQuery<TicketOrderDetail>({
    queryKey: ['ticket-order', orderId],
    queryFn: () => fetchTicketOrder(orderId),
  });

  const declare = useMutation({
    mutationFn: () => declareTicketPayment(orderId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ticket-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['ticket-order', orderId] });
    },
    // Fereastra de confirmare se închide și la succes, și la eșec: mesajul de
    // eroare are locul lui în pagină, nu peste un dialog rămas deschis.
    onSettled: () => setConfirming(false),
  });

  const retry = useMutation({
    mutationFn: async () => {
      const eventId = data?.order.eventId;
      if (!eventId) throw new Error('missing event');
      return createTicketOrder(eventId);
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['ticket-orders'] });
      // Comanda veche e moartă; deschidem direct comanda nouă, cu instrucțiuni.
      onSelect(result.order.id);
    },
  });

  let body: ReactElement;
  if (isPending) {
    body = (
      <div className="tk-state">
        <div className="spinner" role="status" aria-label={t('social:ticket.pay.title')} />
      </div>
    );
  } else if (isError || !data) {
    body = (
      <div className="tk-state">
        <p className="error-text">{t('social:ticket.loadError')}</p>
        <button
          type="button"
          className="button"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          {t('social:ticket.retry')}
        </button>
      </div>
    );
  } else {
    const { order, payment } = data;
    body = (
      <>
        {order.status === 'awaiting_payment' && payment ? (
          <AwaitingPayment
            payment={payment}
            declaring={declare.isPending}
            declareFailed={declare.isError}
            onDeclare={() => setConfirming(true)}
          />
        ) : null}

        {order.status === 'awaiting_payment' && !payment ? (
          <p className="body-text">{t('social:ticket.instructionsUnavailable')}</p>
        ) : null}

        {order.status === 'payment_declared' ? (
          <div className="tk-block" data-testid="order-in-review">
            <h3 className="tk-block__title">{t('social:ticket.review.title')}</h3>
            <p className="body-text">{t('social:ticket.review.body')}</p>
          </div>
        ) : null}

        {order.status === 'approved' && order.ticketCode ? (
          <div className="tk-block" data-testid="order-approved">
            <h3 className="tk-block__title">{t('social:ticket.approved.title')}</h3>
            <p className="body-text">{t('social:ticket.approved.body')}</p>
            <div className="tk-card">
              <QrCode value={order.ticketCode} label={t('social:ticket.approved.code')} />
            </div>
          </div>
        ) : null}

        {order.status === 'rejected' ? (
          <div className="tk-block" data-testid="order-rejected">
            <h3 className="tk-block__title tk-block__title--danger">
              {t('social:ticket.rejected.title')}
            </h3>
            <p className="body-text">{t('social:ticket.rejected.body')}</p>
            {retry.isError ? (
              <p className="error-text">{t('social:ticket.retryError')}</p>
            ) : null}
            <button
              type="button"
              className="button"
              disabled={retry.isPending || !order.eventId}
              onClick={() => retry.mutate()}
              data-testid="order-retry-btn"
            >
              {t('social:ticket.rejected.retry')}
            </button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="tk-detail" data-testid="order-detail">
      <div className="tk-detail__head">
        <button type="button" className="button button--ghost tk-detail__close" onClick={onClose}>
          {t('common:actions.close')}
        </button>
      </div>
      {body}

      {/*
       * „Am făcut transferul" e o declarație pe proprie răspundere: trece comanda
       * în coada de verificare a adminului și nu se poate lua înapoi. Deci cerem
       * o confirmare deliberată — prin ConfirmModal, nu prin `confirm()`, care
       * îngheață WebView-ul Telegram.
       * Chei i18n inexistente pentru textul confirmării — în română, raportate.
       */}
      <ConfirmModal
        open={confirming}
        title="Ai făcut transferul?"
        body="Confirmă doar după ce banii au plecat din contul tău. Verificăm plata manual."
        confirmLabel={t('social:ticket.pay.declare')}
        busy={declare.isPending}
        onConfirm={() => declare.mutate()}
        onCancel={() => setConfirming(false)}
        testId="declare-confirm"
      />
    </div>
  );
}

/* -------------------------------------------------------------- lista + ecran */

function OrdersSection() {
  const { t } = useTranslation('social');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isPending, isError, refetch, isFetching } = useQuery<TicketOrderListItem[]>({
    queryKey: ['ticket-orders'],
    queryFn: fetchMyTicketOrdersWithEvent,
  });

  const orders = data ?? [];
  // Comanda selectată poate dispărea din listă după o reîncercare; în acel caz
  // panoul se închide singur, în loc să rămână agățat de un id inexistent.
  const selected = orders.some((o) => o.id === selectedId) ? selectedId : null;

  let body: ReactElement;
  if (isPending) {
    body = (
      <div className="tk-state">
        {/* Cheie i18n inexistentă pentru titlul secțiunii — română, raportată. */}
        <div className="spinner" role="status" aria-label="Comenzile mele de bilete" />
      </div>
    );
  } else if (isError) {
    body = (
      <div className="tk-state" data-testid="orders-error">
        <p className="error-text">Nu am putut încărca comenzile de bilete.</p>
        <button
          type="button"
          className="button"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          {t('ticket.retry')}
        </button>
      </div>
    );
  } else if (orders.length === 0) {
    body = (
      <div className="tk-state" data-testid="orders-empty">
        <p className="body-text">
          Nu ai nicio comandă de bilet. Biletele se cumpără din pagina evenimentului.
        </p>
        <Link className="button button--ghost tk-link" to={EVENTS_PATH}>
          Vezi evenimentele
        </Link>
      </div>
    );
  } else {
    body = (
      <>
        <ul className="tk-rows">
          {orders.map((order) => (
            <OrderRow
              key={order.id}
              order={order}
              selected={order.id === selected}
              onSelect={(id) => setSelectedId((current) => (current === id ? null : id))}
            />
          ))}
        </ul>
        {selected ? (
          <OrderDetailPanel
            key={selected}
            orderId={selected}
            onSelect={setSelectedId}
            onClose={() => setSelectedId(null)}
          />
        ) : null}
      </>
    );
  }

  return (
    <section className="tk-section">
      <h2 className="tk-section__title">Comenzile mele de bilete</h2>
      {body}
    </section>
  );
}

export function TicketsScreen() {
  return (
    <div className="tk-screen">
      <MyTicketSection />
      <OrdersSection />
    </div>
  );
}

export default TicketsScreen;
