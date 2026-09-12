/**
 * Detaliul evenimentului: randare, bilet online, participare, check-in.
 *
 * Două mock-uri, din două motive diferite:
 *   - `../eventsApi` — ca testele să verifice deciziile ecranului, nu axios;
 *   - `leaflet` — harta e testată separat, cu biblioteca adevărată
 *     (`EventMap.test.tsx`). Aici ar adăuga doar dependență de layout-ul din
 *     jsdom și zeci de milisecunde la fiecare test.
 *
 * Regula verificată peste tot mai jos: o acțiune EȘUATĂ scrie un mesaj în
 * pagină și NU golește ecranul. Datele evenimentului rămân pe loc.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventItem } from '@mobile/features/events/types';
import type { TicketOrder } from '@mobile/features/tickets/types';

import { TICKETS_PATH } from '@/features/tickets/ticketRoutes';
import { renderWithProviders } from '@/test/harness';

import { EventScreen } from '../EventScreen';
import { EVENT_ROUTE_PATTERN } from '../eventRoutes';

vi.mock('../eventsApi', () => ({
  fetchEvents: vi.fn(),
  fetchEvent: vi.fn(),
  setGoing: vi.fn(),
  checkin: vi.fn(),
  fetchMyTicketOrders: vi.fn(),
  createTicketOrder: vi.fn(),
}));

// Harta: un dublu minimal care imită lanțul `L.x(...).addTo(map)` din Leaflet.
vi.mock('leaflet', () => {
  const layer = {
    addTo: vi.fn(() => layer),
    bindPopup: vi.fn(() => layer),
  };
  return {
    map: vi.fn(() => ({ remove: vi.fn() })),
    tileLayer: vi.fn(() => layer),
    circleMarker: vi.fn(() => layer),
  };
});

const { checkin, createTicketOrder, fetchEvent, fetchMyTicketOrders, setGoing } =
  await import('../eventsApi');

const EVENT: EventItem = {
  id: 'e1',
  title: 'Flirt Party Chișinău',
  description: 'Seară de cunoștințe, muzică live și jocuri.',
  startsAt: '2026-07-04T19:00:00.000Z',
  city: 'Chișinău',
  venue: 'Club Mono',
  lat: 47.0245,
  lng: 28.8322,
  kind: 'flirt_party',
  attendeeCount: 42,
  iAmGoing: false,
  promoDiscountPercent: 20,
  promoCode: 'FLIRT20',
  promoDescription: 'Valabil doar în seara evenimentului.',
  ticketPrice: 150,
  ticketCurrency: 'lei',
};

/** Variantă minimală: fără promo, fără bilet online, fără coordonate. */
const BARE_EVENT: EventItem = {
  ...EVENT,
  lat: undefined,
  lng: undefined,
  promoDiscountPercent: null,
  promoCode: null,
  promoDescription: null,
  ticketPrice: null,
  ticketCurrency: null,
};

const ORDER: TicketOrder = {
  id: 'o1',
  eventId: 'e1',
  status: 'awaiting_payment',
  price: 150,
  currency: 'lei',
  ticketCode: null,
};

function renderDetail() {
  return renderWithProviders(
    <MemoryRouter initialEntries={['/events/e1']}>
      <Routes>
        <Route path={EVENT_ROUTE_PATTERN} element={<EventScreen />} />
        {/* Ținta navigărilor legate de bilet, ca să le putem observa. */}
        <Route path={TICKETS_PATH} element={<div data-testid="tickets-screen" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(fetchEvent).mockResolvedValue(EVENT);
  vi.mocked(fetchMyTicketOrders).mockResolvedValue([]);
});

describe('randarea detaliului', () => {
  it('arată un indicator cât timp datele nu au sosit', () => {
    vi.mocked(fetchEvent).mockReturnValue(new Promise<EventItem>(() => {}));
    renderDetail();

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('cere evenimentul din URL și arată tipul, titlul, locul, promo și participanții', async () => {
    renderDetail();

    expect(await screen.findByText('Flirt Party Chișinău')).toBeInTheDocument();
    expect(fetchEvent).toHaveBeenCalledWith('e1');

    expect(screen.getByText('Flirt Party')).toBeInTheDocument();
    expect(screen.getByText('Club Mono · Chișinău')).toBeInTheDocument();
    expect(screen.getByText('Seară de cunoștințe, muzică live și jocuri.')).toBeInTheDocument();
    expect(screen.getByText('42 participanți')).toBeInTheDocument();

    const promo = screen.getByTestId('event-promo');
    expect(promo).toHaveTextContent('Reducere la intrare −20%');
    expect(screen.getByTestId('event-promo-code')).toHaveTextContent('FLIRT20');
    expect(promo).toHaveTextContent('Valabil doar în seara evenimentului.');
  });

  it('un eveniment fără promo, fără bilet și fără coordonate nu inventează secțiuni goale', async () => {
    vi.mocked(fetchEvent).mockResolvedValue(BARE_EVENT);
    renderDetail();

    await screen.findByText('Flirt Party Chișinău');

    expect(screen.queryByTestId('event-promo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('buy-ticket-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ticket-status')).not.toBeInTheDocument();
    // Fără coordonate → caseta cu orașul, nu o hartă goală.
    expect(screen.getByTestId('event-map-fallback')).toHaveTextContent('📍 Chișinău');
  });

  it('eroarea de încărcare se anunță și se poate reîncerca cu succes', async () => {
    vi.mocked(fetchEvent).mockRejectedValueOnce(new Error('offline'));
    renderDetail();

    expect(await screen.findByTestId('event-error')).toHaveTextContent(
      'Nu am putut încărca evenimentul.',
    );

    vi.mocked(fetchEvent).mockResolvedValue(EVENT);
    fireEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }));

    expect(await screen.findByText('Flirt Party Chișinău')).toBeInTheDocument();
    expect(screen.queryByTestId('event-error')).not.toBeInTheDocument();
  });
});

describe('participare', () => {
  it('confirmarea reușită schimbă butonul în „Nu mai merg"', async () => {
    const going: EventItem = { ...EVENT, iAmGoing: true, attendeeCount: 43 };
    vi.mocked(setGoing).mockResolvedValue(going);
    // Prima interogare întoarce evenimentul neconfirmat; reinterogarea de după
    // invalidarea cheii `['event', 'e1']` întoarce varianta „merg".
    vi.mocked(fetchEvent).mockResolvedValueOnce(EVENT).mockResolvedValue(going);
    renderDetail();

    fireEvent.click(await screen.findByTestId('going-btn'));

    await waitFor(() => expect(setGoing).toHaveBeenCalledWith('e1', true));

    expect(await screen.findByRole('button', { name: 'Nu mai merg' })).toBeInTheDocument();
    expect(screen.getByText('43 participanți')).toBeInTheDocument();
  });

  it('eșecul scrie mesajul în pagină și NU golește ecranul', async () => {
    vi.mocked(setGoing).mockRejectedValue(new Error('500'));
    renderDetail();

    fireEvent.click(await screen.findByTestId('going-btn'));

    expect(
      await screen.findByText('Nu am putut actualiza participarea. Reîncearcă.'),
    ).toBeInTheDocument();
    // Datele evenimentului sunt tot acolo.
    expect(screen.getByText('Flirt Party Chișinău')).toBeInTheDocument();
    expect(screen.getByTestId('going-btn')).toBeEnabled();
  });
});

describe('check-in', () => {
  it('reușita arată mesajul de ștampilă Flirt Passport', async () => {
    vi.mocked(checkin).mockResolvedValue({
      eventId: 'e1',
      eventTitle: 'Flirt Party Chișinău',
      city: 'Chișinău',
      stampedAt: '2026-07-04T20:10:00.000Z',
    });
    renderDetail();

    fireEvent.click(await screen.findByTestId('checkin-btn'));

    expect(await screen.findByTestId('checkin-stamp')).toHaveTextContent(
      'Ai primit o ștampilă Flirt Passport',
    );
  });

  it('eșecul scrie mesajul în pagină, fără ștampilă și fără ecran gol', async () => {
    vi.mocked(checkin).mockRejectedValue(new Error('403'));
    renderDetail();

    fireEvent.click(await screen.findByTestId('checkin-btn'));

    expect(
      await screen.findByText('Nu am putut face check-in-ul. Reîncearcă.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('checkin-stamp')).not.toBeInTheDocument();
    expect(screen.getByText('Flirt Party Chișinău')).toBeInTheDocument();
  });
});

describe('bilet online', () => {
  it('fără comandă, arată butonul de cumpărare cu preț și duce la ecranul de bilete', async () => {
    vi.mocked(createTicketOrder).mockResolvedValue({
      order: ORDER,
      payment: null,
    });
    renderDetail();

    const buy = await screen.findByTestId('buy-ticket-btn');
    expect(buy).toHaveTextContent('Cumpără bilet online — 150 lei');

    fireEvent.click(buy);

    await waitFor(() => expect(createTicketOrder).toHaveBeenCalledWith('e1'));
    expect(await screen.findByTestId('tickets-screen')).toBeInTheDocument();
  });

  it('eșecul comenzii se vede în pagină, iar butonul rămâne apăsabil', async () => {
    vi.mocked(createTicketOrder).mockRejectedValue(new Error('502'));
    renderDetail();

    fireEvent.click(await screen.findByTestId('buy-ticket-btn'));

    expect(
      await screen.findByText('Nu am putut crea comanda. Reîncearcă.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('buy-ticket-btn')).toBeEnabled();
    expect(screen.queryByTestId('tickets-screen')).not.toBeInTheDocument();
  });

  it('cu o comandă activă, arată starea ei în locul butonului de cumpărare', async () => {
    vi.mocked(fetchMyTicketOrders).mockResolvedValue([
      { ...ORDER, id: 'o-vechi', status: 'rejected' },
      ORDER,
    ]);
    renderDetail();

    const status = await screen.findByTestId('ticket-status');
    expect(status).toHaveTextContent('Bilet: finalizează plata');
    expect(screen.queryByTestId('buy-ticket-btn')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continuă plata' }));
    expect(await screen.findByTestId('tickets-screen')).toBeInTheDocument();
  });

  it('o comandă aprobată e cea aleasă dintre mai multe și trimite la bilet', async () => {
    vi.mocked(fetchMyTicketOrders).mockResolvedValue([
      ORDER,
      { ...ORDER, id: 'o2', status: 'approved', ticketCode: 'ABC123' },
    ]);
    renderDetail();

    expect(await screen.findByTestId('ticket-status')).toHaveTextContent('Bilet aprobat');
    expect(screen.getByRole('button', { name: 'Vezi biletul' })).toBeInTheDocument();
  });
});
