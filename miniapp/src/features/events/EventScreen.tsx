/**
 * Detaliul unui eveniment (TZ secț. 8) pentru Mini App.
 *
 * Structura (redesign după feedback-ul testerilor — „totul lipit"):
 *   poster (încadrarea setată de admin) cu badge-ul de tip → titlu → rânduri de
 *   informații cu iconițe (dată/oră, loc + oraș, participanți) → „Despre" →
 *   promo → bilete → locația (hartă mare + „Deschide în hărți") → acțiuni
 *   („Merg"/„Nu mai merg", check-in). Spațierea vine DOAR din scala de tokeni
 *   (`--space-*`), cu un ritm constant între secțiuni (`events.css`).
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
 * Pauza globală (`ticketSalesPaused`, sau 409 `online_sales_disabled`) are
 * mesajul ei — „oprită temporar, poți plăti la intrare" —, distinct de
 * „epuizat" și „închis". Motivul vine din modelul `ticketSales` (`SalesBlock`).
 * O comandă deja făcută rămâne vizibilă în orice caz.
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

import { Photo } from '@/components/Photo';
import { formatAmount, TicketPriceBlock, useRefreshLoyalty, useTicketQuote } from '@/features/loyalty';
import { OrderStepper } from '@/features/tickets/OrderStepper';
import { ClockIcon, LockIcon, TicketIcon } from '@/features/tickets/TicketIcons';
import { hasEventStarted, orderStage, STAGE_RANK } from '@/features/tickets/orderStage';
import { useOrderStatusText } from '@/features/tickets/orderStatusLabel';
import { ticketOrderPath } from '@/features/tickets/ticketRoutes';
import { ticketRequestPath } from '@/features/ticketRequests/ticketRequestRoutes';

import { coverImageStyle } from './coverFraming';
import { CalendarIcon, PinIcon, UsersIcon } from './EventIcons';
import { EventMap } from './EventMap';
import { formatEventDate, formatEventDateParts, kindColorVar, kindLabel } from './eventFormat';
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
import { formatCountdown, salesNotice, salesRefusal, useSalesState, type SalesBlock } from './ticketSales';
import { TicketTierPicker } from './TicketTierPicker';
import { needsTierChoice, resolveTier } from './ticketTiers';

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
  /** Serverul a refuzat comanda: vânzarea s-a închis / epuizat / oprit între timp. */
  const [refusal, setRefusal] = useState<SalesBlock | null>(null);
  /** Tipul de bilet ales de om (doar când evenimentul are mai multe). */
  const [tierChoice, setTierChoice] = useState<string | null>(null);
  const statusText = useOrderStatusText();

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
  // Cu mai multe tipuri de bilet, cotația și comanda sunt pentru tipul ales.
  const selectedTier = resolveTier(data?.ticketTiers, tierChoice);
  const chosenTierId = needsTierChoice(data?.ticketTiers) ? (selectedTier?.id ?? null) : null;
  const { data: quote } = useTicketQuote(eventId, data?.ticketPrice != null, chosenTierId);
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
  // Refuzul proaspăt al serverului câștigă peste ce știam din eveniment.
  const salesBlock = refusal ?? sales.block;

  /**
   * Ultima comandă a omului pentru eveniment, dacă a fost respinsă sau
   * anulată și nu are alta activă: îi arătăm unde vede motivul, ca „Cumpără"
   * să nu pară că ignoră ce s-a întâmplat.
   */
  const lastFailed = useMemo<TicketOrder | null>(() => {
    const forEvent = (myOrders ?? []).filter((o) => o.eventId === eventId);
    return forEvent.find((o) => orderStage(o.status) === 'rejected') ?? null;
  }, [myOrders, eventId]);

  // Ceasul local a trecut de ora anunțată: cerem verdictul serverului, ca
  // ecranul să nu rămână pe o stare ghicită.
  useEffect(() => {
    if (sales.closed && eventId !== '') {
      void queryClient.invalidateQueries({ queryKey: ['event', eventId] });
    }
  }, [sales.closed, eventId, queryClient]);

  const buyMutation = useMutation({
    mutationFn: () => (chosenTierId ? createTicketOrder(eventId, chosenTierId) : createTicketOrder(eventId)),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['ticket-orders'] });
      // Instrucțiunile de plată (IBAN, destinația plății, termen) sunt treaba
      // ecranului de bilete; predăm omul acolo cu comanda deja deschisă.
      void navigate(ticketOrderPath(result.order.id));
    },
    onError: (error) => {
      const reason = salesRefusal(error);
      if (reason) {
        setRefusal(reason);
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
    // Comandă activă → starea ei (etichetă + pasul următor), cu cronologia, și
    // drumul direct spre ea.
    const cta =
      activeStage === 'approved'
        ? t('detail.ticketCta.approved')
        : activeStage === 'review'
          ? t('detail.ticketCta.declared')
          : t('detail.ticketCta.awaiting');
    const status = statusText(myOrder, hasEventStarted(event.startsAt));

    ticketSection = (
      <div className={`ev-ticket ev-ticket--${activeStage} ev-ticket--tone-${status.tone}`} data-testid="ticket-status">
        <div className="ev-ticket__head">
          <span className="ev-ticket__icon" aria-hidden="true">
            <TicketIcon width={22} height={22} />
          </span>
          <div className="ev-ticket__text">
            <p
              className={
                activeStage === 'approved'
                  ? 'ev-ticket__status ev-ticket__status--ok'
                  : 'ev-ticket__status ev-ticket__status--pending'
              }
            >
              {status.label}
            </p>
            <p className="ev-ticket__next" data-testid="ticket-next-step">
              {status.next}
            </p>
          </div>
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
  } else if (event.ticketPrice != null && salesBlock) {
    // Vânzarea online e oprită / epuizată / încheiată: niciun buton care ar
    // duce la un refuz.
    const notice = salesNotice(salesBlock, refusal !== null);
    const paused = salesBlock === 'paused';
    ticketSection = (
      <div
        className="ev-sales-closed"
        data-testid={paused ? 'ticket-sales-paused' : 'ticket-sales-closed'}
        data-sales-block={salesBlock}
        role="status"
      >
        <span className="ev-sales-closed__icon" aria-hidden="true">
          {paused ? <ClockIcon width={22} height={22} /> : <LockIcon width={22} height={22} />}
        </span>
        <div className="ev-sales-closed__text">
          <p className="ev-sales-closed__title">{t(notice.title)}</p>
          <p className="ev-sales-closed__body">{t(notice.body)}</p>
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
        {lastFailed ? (
          <p className="ev-buy__last" data-testid="ticket-last-rejected">
            <span>{t('screens:tickets.lastRejected')}</span>{' '}
            <button
              type="button"
              className="ev-buy__link"
              onClick={() => void navigate(ticketOrderPath(lastFailed.id))}
            >
              {t('screens:tickets.lastRejectedLink')}
            </button>
          </p>
        ) : null}
        {chosenTierId ? (
          <TicketTierPicker
            tiers={event.ticketTiers ?? []}
            selectedId={chosenTierId}
            currency={event.ticketCurrency ?? 'lei'}
            onSelect={setTierChoice}
          />
        ) : null}
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
          onClick={() => {
            if (!buyMutation.isPending) buyMutation.mutate();
          }}
        >
          {t('detail.buyTicket', {
            price: formatAmount(quote ? quote.finalPrice : (selectedTier?.price ?? event.ticketPrice)),
            currency: quote ? quote.currency : (event.ticketCurrency ?? 'lei'),
          })}
        </button>
        <button
          type="button"
          className="button button--ghost ev-detail__action"
          data-testid="request-ticket-btn"
          onClick={() => void navigate(ticketRequestPath(eventId, chosenTierId))}
        >
          {t('screens:events.requestTicket')}
        </button>
        <p className="ev-buy__hint">{t('screens:events.sales.requestHint')}</p>
      </div>
    );
  }

  const hasPromo = event.promoDiscountPercent != null && event.promoCode != null;
  const when = formatEventDateParts(event.startsAt);
  const buyError =
    buyMutation.isError && !refusal ? (
      <p className="error-text ev-detail__error">{t('detail.createOrderError')}</p>
    ) : null;

  return (
    <div className="ev-detail">
      {/*
        Posterul: imaginea cu încadrarea aleasă de admin (punct focal + zoom),
        aceeași proporție ca în previzualizarea din panou. Fără imagine — fondul
        colorat după tip, cu o iconiță, ca pagina să nu înceapă cu un gol.
      */}
      <div
        className="ev-hero"
        style={{ background: kindColorVar(event.kind) }}
        data-testid="event-hero"
      >
        {event.coverUrl ? (
          <Photo
            className="ev-hero__img"
            src={event.coverUrl}
            size={800}
            priority
            /* Decorativ: titlul și detaliile sunt scrise dedesubt. */
            alt=""
            style={coverImageStyle(event)}
          />
        ) : (
          <span className="ev-hero__placeholder" aria-hidden="true">
            <CalendarIcon width={48} height={48} strokeWidth={1.4} />
          </span>
        )}
        <span className="ev-hero__badge">{kindLabel(event.kind)}</span>
        {event.iAmGoing ? (
          <span className="ev-hero__going">{t('screens:events.goingBadge')}</span>
        ) : null}
      </div>

      <h1 className="title ev-detail__title">{event.title}</h1>

      <ul className="ev-facts">
        <li className="ev-fact" data-testid="event-fact-date">
          <span className="ev-fact__icon" aria-hidden="true">
            <CalendarIcon />
          </span>
          <span className="ev-fact__text">
            <span className="ev-fact__label">{t('screens:events.detail.when')}</span>
            <span className="ev-fact__value">{when.day}</span>
            {when.time ? <span className="ev-fact__sub">{when.time}</span> : null}
          </span>
        </li>
        <li className="ev-fact" data-testid="event-fact-place">
          <span className="ev-fact__icon" aria-hidden="true">
            <PinIcon />
          </span>
          <span className="ev-fact__text">
            <span className="ev-fact__label">{t('screens:events.detail.where')}</span>
            <span className="ev-fact__value">{event.venue || event.city}</span>
            {event.venue ? <span className="ev-fact__sub">{event.city}</span> : null}
          </span>
        </li>
        <li className="ev-fact" data-testid="event-fact-attendees">
          <span className="ev-fact__icon" aria-hidden="true">
            <UsersIcon />
          </span>
          <span className="ev-fact__text">
            <span className="ev-fact__label">{t('screens:events.detail.participants')}</span>
            <span className="ev-fact__value ev-detail__attendees">
              {t('detail.attendees', { n: event.attendeeCount })}
            </span>
          </span>
        </li>
      </ul>

      {event.description ? (
        <section className="ev-section">
          <h2 className="ev-section__title">{t('screens:events.detail.about')}</h2>
          <p className="ev-detail__desc">{event.description}</p>
        </section>
      ) : null}

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

      {ticketSection ? (
        <section className="ev-section">
          <h2 className="ev-section__title">{t('screens:events.detail.tickets')}</h2>
          {ticketSection}
          {buyError}
        </section>
      ) : (
        buyError
      )}

      <section className="ev-section">
        <h2 className="ev-section__title">{t('screens:events.detail.location')}</h2>
        <EventMap lat={event.lat} lng={event.lng} title={event.title} city={event.city} />
      </section>

      <div className="ev-actions">
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
    </div>
  );
}

export default EventScreen;
