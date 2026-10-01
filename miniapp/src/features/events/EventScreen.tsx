/**
 * Detaliul unui eveniment (TZ secț. 8) pentru Mini App.
 *
 * PORT al lui `mobile/app/events/[id].tsx`, cu aceeași ordine a informației:
 * tip → titlu → dată → loc → descriere → promo → bilet online → hartă →
 * participanți → „Merg"/„Nu mai merg" → check-in.
 *
 * O SINGURĂ DIFERENȚĂ DE FOND față de mobil, și e deliberată: pe mobil erorile
 * mutațiilor ies prin `alertMessage` (dialog nativ). Aici NU avem voie:
 * `alert()` blochează firul de randare al WebView-ului Telegram, iar pe unii
 * clienți Android fereastra nu apare deloc și aplicația rămâne înghețată. Deci
 * fiecare eroare se scrie ÎN PAGINĂ, lângă butonul care a produs-o — unde
 * utilizatorul se uită oricum.
 *
 * Ecranul NU se golește la o eroare de acțiune: datele evenimentului rămân pe
 * loc, se adaugă doar mesajul. Doar eroarea de ÎNCĂRCARE înlocuiește conținutul,
 * fiindcă atunci chiar nu avem ce arăta.
 *
 * FEREASTRA DE VÂNZARE ONLINE (`ticketSalesEndAt` / `ticketSalesOpen`, opționale):
 * cât timp e deschisă, arătăm când se închide, iar în ultimele 24 h o
 * numărătoare inversă; după închidere, butoanele de cumpărare sunt înlocuite de
 * un mesaj neutru. Dacă serverul refuză comanda cu 409 `ticket_sales_closed`
 * (s-a închis între timp), arătăm același mesaj și reîncărcăm evenimentul.
 *
 * PREȚUL BILETULUI e singurul lucru pe care ecranul NU-l ia din `Event`: pentru
 * un utilizator cu ștampile, cu promo sau cu o invitație, prețul de listă e o
 * minciună. Cotația vine de la `GET /loyalty/events/{id}/ticket-quote`, calculată
 * integral pe server (`features/loyalty`). Dacă ruta nu răspunde — eveniment fără
 * bilet online, rețea căzută —, butonul cade înapoi pe prețul de listă: mai bine
 * prețul întreg decât niciun preț.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import { TicketPriceBlock, useRefreshLoyalty, useTicketQuote } from '@/features/loyalty';
import { OrderStepper } from '@/features/tickets/OrderStepper';
import { ClockIcon, LockIcon, TicketIcon } from '@/features/tickets/TicketIcons';
import { isTicketSalesClosedError, orderStage, STAGE_RANK } from '@/features/tickets/orderStage';
import { useOrderStatusLabel } from '@/features/tickets/orderStatusLabel';
import { ticketOrderPath } from '@/features/tickets/ticketRoutes';
import { ticketRequestPath } from '@/features/ticketRequests/ticketRequestRoutes';

import { EventMap } from './EventMap';
import { formatEventDate, kindColorVar, kindLabel } from './eventFormat';
import { EVENT_ID_PARAM } from './eventRoutes';
import {
  checkin,
  createTicketOrder,
  fetchEvent,
  fetchMyTicketOrders,
  setGoing,
  type EventItem,
  type TicketOrder,
} from './eventsApi';
import { formatCountdown, useSalesState } from './ticketSales';

import './events.css';

export function EventScreen() {
  const { t } = useTranslation(['events', 'screens']);
  const params = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // `useParams` întoarce `string | undefined` (ruta poate fi montată oriunde),
  // iar `noUncheckedIndexedAccess` ne obligă să tratăm lipsa. Un id gol NU
  // pornește interogarea: o cerere `GET /events/` în locul detaliului ar
  // întoarce o listă și ar strica ecranul în tăcere.
  const eventId = params[EVENT_ID_PARAM] ?? '';

  const [stampMessage, setStampMessage] = useState<string | null>(null);
  /** Serverul a refuzat comanda: vânzarea s-a închis între timp. */
  const [closedByServer, setClosedByServer] = useState(false);
  const statusLabel = useOrderStatusLabel();

  const { data, isPending, isError, refetch, isFetching } = useQuery<EventItem>({
    queryKey: ['event', eventId],
    queryFn: () => fetchEvent(eventId),
    enabled: eventId !== '',
  });

  const { data: myOrders } = useQuery<TicketOrder[]>({
    queryKey: ['ticket-orders'],
    queryFn: fetchMyTicketOrders,
  });

  // Cotația se cere DOAR pentru evenimentele care vând bilete online; pentru
  // restul ruta ar răspunde 400, iar un 400 previzibil nu e informație.
  const { data: quote } = useTicketQuote(eventId, data?.ticketPrice != null);
  const refreshLoyalty = useRefreshLoyalty();

  /**
   * Comanda de bilet cea mai relevantă pentru acest eveniment: un utilizator
   * poate avea mai multe încercări (una respinsă, alta în curs); arătăm starea
   * care îl interesează, nu prima venită de la server.
   */
  const myOrder = useMemo<TicketOrder | null>(() => {
    const forEvent = (myOrders ?? []).filter((o) => o.eventId === eventId);
    const rank = (o: TicketOrder) => STAGE_RANK[orderStage(o.status)];
    const sorted = [...forEvent].sort((a, b) => rank(a) - rank(b));
    return sorted[0] ?? null;
  }, [myOrders, eventId]);

  const sales = useSalesState(data ?? {});
  const salesClosed = sales.closed || closedByServer;

  // Ceasul local a trecut de ora anunțată: cerem verdictul serverului, ca
  // ecranul să nu rămână pe o stare ghicită.
  useEffect(() => {
    if (sales.closed && eventId !== '') {
      void queryClient.invalidateQueries({ queryKey: ['event', eventId] });
    }
  }, [sales.closed, eventId, queryClient]);

  const buyMutation = useMutation({
    mutationFn: () => createTicketOrder(eventId),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['ticket-orders'] });
      // Instrucțiunile de plată (IBAN, destinația plății, termen) sunt treaba
      // ecranului de bilete; predăm omul acolo cu comanda deja deschisă.
      void navigate(ticketOrderPath(result.order.id));
    },
    onError: (error) => {
      if (isTicketSalesClosedError(error)) {
        setClosedByServer(true);
        void queryClient.invalidateQueries({ queryKey: ['event', eventId] });
      }
    },
  });

  const goingMutation = useMutation({
    mutationFn: (going: boolean) => setGoing(eventId, going),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['event', eventId] });
      // Și lista: numărul de participanți și indicatorul „Mergi" de pe card se
      // schimbă odată cu detaliul.
      void queryClient.invalidateQueries({ queryKey: ['events'] });
    },
  });

  const checkinMutation = useMutation({
    mutationFn: () => checkin(eventId),
    onSuccess: () => {
      setStampMessage(t('detail.stamp'));
      // O ștampilă nouă poate urca treapta, iar treapta schimbă prețul: nu doar
      // passportul se învechește, ci și cotațiile deja aduse.
      refreshLoyalty();
    },
  });

  if (eventId === '' || isError || (!isPending && !data)) {
    return (
      <div className="ev-detail">
        <div className="ev-state" data-testid="event-error">
          <p className="error-text">{t('detail.loadError')}</p>
          <button
            type="button"
            className="button button--ghost"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            {t('detail.retry')}
          </button>
        </div>
      </div>
    );
  }

  if (isPending || !data) {
    return (
      <div className="ev-detail">
        <div className="ev-state">
          <div className="spinner" role="status" aria-label={t('detail.retry')} />
        </div>
      </div>
    );
  }

  const event = data;

  /** Secțiunea de bilet online: starea comenzii existente sau butonul de cumpărare. */
  let ticketSection: ReactNode = null;
  const activeStage = myOrder ? orderStage(myOrder.status) : null;
  if (myOrder && activeStage !== 'rejected' && activeStage !== 'cancelled' && activeStage) {
    // Comandă activă → starea ei, cu cronologia, și drumul direct spre ea.
    const cta =
      activeStage === 'approved'
        ? t('detail.ticketCta.approved')
        : activeStage === 'review'
          ? t('detail.ticketCta.declared')
          : t('detail.ticketCta.awaiting');

    ticketSection = (
      <div className={`ev-ticket ev-ticket--${activeStage}`} data-testid="ticket-status">
        <div className="ev-ticket__head">
          <span className="ev-ticket__icon" aria-hidden="true">
            <TicketIcon width={22} height={22} />
          </span>
          <p
            className={
              activeStage === 'approved'
                ? 'ev-ticket__status ev-ticket__status--ok'
                : 'ev-ticket__status ev-ticket__status--pending'
            }
          >
            {statusLabel(myOrder.status)}
          </p>
        </div>
        <OrderStepper stage={activeStage} hasCode={Boolean(myOrder.ticketCode)} />
        <button
          type="button"
          className="button"
          onClick={() => void navigate(ticketOrderPath(myOrder.id))}
        >
          {cta}
        </button>
      </div>
    );
  } else if (event.ticketPrice != null && salesClosed) {
    // Vânzarea online s-a încheiat: niciun buton care ar duce la un refuz.
    ticketSection = (
      <div className="ev-sales-closed" data-testid="ticket-sales-closed" role="status">
        <span className="ev-sales-closed__icon" aria-hidden="true">
          <LockIcon width={22} height={22} />
        </span>
        <div className="ev-sales-closed__text">
          <p className="ev-sales-closed__title">{t('screens:events.sales.closedTitle')}</p>
          <p className="ev-sales-closed__body">
            {closedByServer
              ? t('screens:events.sales.closedError')
              : t('screens:events.sales.closedBody')}
          </p>
        </div>
      </div>
    );
  } else if (event.ticketPrice != null) {
    // Fără comandă activă, dar evenimentul vinde bilete online.
    //
    // Prețul de pe buton e CEL AL UTILIZATORULUI, când serverul ni l-a spus.
    // Nu se recalculează nimic aici: `quote.finalPrice` e exact suma pe care o
    // va înscrie backendul pe comandă. Fără cotație (rețea, rută indisponibilă)
    // rămâne prețul de listă din `Event`.
    ticketSection = (
      <div className="ev-buy">
        {quote ? <TicketPriceBlock quote={quote} /> : null}
        {sales.endAt ? (
          <p className="ev-sales" data-testid="ticket-sales-end">
            <ClockIcon width={16} height={16} />
            <span>
              {t('screens:events.sales.endsAt', {
                date: formatEventDate(sales.endAt.toISOString()),
              })}
            </span>
          </p>
        ) : null}
        {sales.showCountdown && sales.msLeft !== null ? (
          <p className="ev-sales__countdown" data-testid="ticket-sales-countdown">
            {t('screens:events.sales.countdown', { time: formatCountdown(sales.msLeft) })}
          </p>
        ) : null}
        <button
          type="button"
          className="button ev-detail__action ev-buy__primary"
          data-testid="buy-ticket-btn"
          disabled={buyMutation.isPending}
          onClick={() => buyMutation.mutate()}
        >
          {t('detail.buyTicket', {
            price: quote ? quote.finalPrice : event.ticketPrice,
            currency: quote ? quote.currency : (event.ticketCurrency ?? 'lei'),
          })}
        </button>
        <button
          type="button"
          className="button button--ghost ev-detail__action"
          data-testid="request-ticket-btn"
          onClick={() => void navigate(ticketRequestPath(eventId))}
        >
          {t('screens:events.requestTicket')}
        </button>
        <p className="ev-buy__hint">{t('screens:events.sales.requestHint')}</p>
      </div>
    );
  }

  const hasPromo = event.promoDiscountPercent != null && event.promoCode != null;

  return (
    <div className="ev-detail">
      <span className="ev-detail__pill" style={{ background: kindColorVar(event.kind) }}>
        {kindLabel(event.kind)}
      </span>

      <h1 className="title ev-detail__title">{event.title}</h1>

      <p className="ev-detail__date">{formatEventDate(event.startsAt)}</p>

      <p className="body-text">
        {event.venue} · {event.city}
      </p>

      {event.description ? <p className="ev-detail__desc">{event.description}</p> : null}

      {hasPromo ? (
        <div
          className="ev-promo"
          data-testid="event-promo"
          role="group"
          aria-label={t('detail.promo.a11yLabel', {
            percent: event.promoDiscountPercent,
            code: event.promoCode,
          })}
        >
          <p className="ev-promo__discount">
            {t('detail.promo.discount', { percent: event.promoDiscountPercent })}
          </p>
          <p
            className="ev-promo__code"
            data-testid="event-promo-code"
            aria-label={t('detail.promo.a11yCode', { code: event.promoCode })}
          >
            {event.promoCode}
          </p>
          {event.promoDescription ? (
            <p className="ev-promo__text">{event.promoDescription}</p>
          ) : null}
          {event.iAmGoing ? (
            <p className="ev-promo__hint">{t('detail.promo.showAtEntrance')}</p>
          ) : null}
        </div>
      ) : null}

      {ticketSection}
      {buyMutation.isError && !closedByServer ? (
        <p className="error-text ev-detail__error">{t('detail.createOrderError')}</p>
      ) : null}

      <EventMap lat={event.lat} lng={event.lng} title={event.title} city={event.city} />

      <p className="ev-detail__attendees">{t('detail.attendees', { n: event.attendeeCount })}</p>

      <button
        type="button"
        className={event.iAmGoing ? 'button button--ghost ev-detail__action' : 'button ev-detail__action'}
        data-testid="going-btn"
        disabled={goingMutation.isPending}
        onClick={() => goingMutation.mutate(!event.iAmGoing)}
      >
        {event.iAmGoing ? t('detail.notGoing') : t('detail.going')}
      </button>
      {goingMutation.isError ? (
        <p className="error-text ev-detail__error">{t('detail.goingError')}</p>
      ) : null}

      <button
        type="button"
        className="button button--ghost ev-detail__action"
        data-testid="checkin-btn"
        disabled={checkinMutation.isPending}
        onClick={() => checkinMutation.mutate()}
      >
        {t('detail.checkin')}
      </button>
      {checkinMutation.isError ? (
        <p className="error-text ev-detail__error">{t('detail.checkinError')}</p>
      ) : null}

      {stampMessage ? (
        <p className="ev-detail__stamp" data-testid="checkin-stamp">
          {stampMessage}
        </p>
      ) : null}
    </div>
  );
}

export default EventScreen;
